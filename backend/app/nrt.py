"""POST /api/nrt: the last days of hotspots anywhere, live from the FIRMS area API (api.md §2.6).

The MAP_KEY stays here: it never reaches the browser, the logs or an error message.
FIRMS answers at most 5 days per request, so longer windows are split. Rows go through
the pipeline's own `clean()` (same checks, same point_id) and the grid's filter, so live
points look exactly like archive points. Answers are cached for 15 minutes, and the
backend keeps its own transaction budget well under FIRMS's 5,000 per 10 minutes.
"""

from __future__ import annotations

import hashlib
import io
import logging
import threading
import time
from collections import OrderedDict, deque
from datetime import date, timedelta
from typing import Callable, Literal

import duckdb
import httpx
import pandas as pd
import shapely
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from almatafi.grid import keep_filter
from almatafi.ingest import FirmsFormatError, clean, read_firms_csv

from app.aoi import LIMIT_POINTS_KM2, Aoi, geodesic_area_km2
from app.errors import ApiError
from app.meta import build_meta, now_utc
from app.routes import _resolve, _today, feature

router = APIRouter(prefix="/api")
log = logging.getLogger(__name__)

FIRMS = "https://firms.modaps.eosdis.nasa.gov/api"
FIRMS_API = f"{FIRMS}/area/csv"
SOURCES = {"MODIS": ("MODIS_NRT",), "VIIRS": ("VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT")}
# The first day each source has data.
SOURCE_START = {"MODIS_SP": date(2000, 11, 1), "VIIRS_SNPP_SP": date(2012, 1, 20), "VIIRS_NOAA20_SP": date(2018, 4, 1),
                "VIIRS_NOAA21_SP": date(2023, 3, 1), "VIIRS_NOAA20_NRT": date(2018, 4, 1), "VIIRS_NOAA21_NRT": date(2023, 3, 1)}
# Each standard source with its NRT twin: NRT starts where that source's standard data ends.
PAIRS = {"MODIS": [("MODIS_SP", "MODIS_NRT")],
         "VIIRS": [("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"), ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
                   ("VIIRS_NOAA21_SP", "VIIRS_NOAA21_NRT")]}
# FIRMS FAQ: Suomi NPP data delivery ceased on Nov. 2, 2026; no requests after that.
SOURCE_END = {"VIIRS_SNPP_SP": date(2026, 11, 2), "VIIRS_SNPP_NRT": date(2026, 11, 2)}
SP_LAG_DAYS = 120              # if data_availability can't be read: standard data ends about 4 months back
AVAILABILITY_TTL_S = 6 * 3600
MAX_DAYS_PER_CALL = 5          # FIRMS DAY_RANGE limit
CACHE_TTL_S = 15 * 60
CACHE_MAX = 32               # answers can be tens of MB; the free host has 512 MB
BUDGET = 1000                  # FIRMS transactions we allow ourselves per window (FIRMS allows 5,000)
BUDGET_WINDOW_S = 10 * 60
MAX_BYTES = 50 * 1024 * 1024
# Largest FIRMS query box: 4× the AOI limit, so compact shapes always pass.
MAX_BOX_KM2 = 4 * LIMIT_POINTS_KM2
MODIS_MIN_CONFIDENCE = 30      # same as the grid build (almatafi.grid.build default)


class NrtRequest(BaseModel):
    aoi: Aoi
    days: int = Field(default=7, ge=1, le=10)
    sensors: list[Literal["MODIS", "VIIRS"]] = Field(default=["MODIS", "VIIRS"], min_length=1)
    include_filtered: bool = False
    limit: int = Field(default=5000, ge=1, le=50000)


def windows(today: date, days: int) -> list[tuple[date, int]]:
    """(first day, length) chunks of at most 5 days covering today − (days − 1) … today."""
    return span_windows(today - timedelta(days=days - 1), today)


def span_windows(first: date, last: date) -> list[tuple[date, int]]:
    """(first day, length) chunks of at most 5 days covering first … last."""
    out = []
    while first <= last:
        n = min(MAX_DAYS_PER_CALL, (last - first).days + 1)
        out.append((first, n))
        first += timedelta(days=n)
    return out


def plan(sensors, first: date, last: date, sp_until: date | dict[str, date]) -> list[tuple[str, date, int]]:
    """(source, first day, days) for a date range: each standard product up to its own last
    day (`sp_until`, one date for all or one per SP source), its NRT twin after that, and no
    requests before a satellite flew or after it stopped."""
    calls = []
    for s in sorted(set(sensors)):
        for sp, nrt in PAIRS[s]:
            until = sp_until.get(sp, min(sp_until.values())) if isinstance(sp_until, dict) else sp_until
            for src, lo, hi in ((sp, first, min(last, until)), (nrt, max(first, until + timedelta(days=1)), last)):
                lo = max(lo, SOURCE_START.get(src, lo))
                hi = min(hi, SOURCE_END.get(src, hi))
                calls += [(src, a, n) for a, n in span_windows(lo, hi)]
    return calls


def boxes(geometry) -> list[tuple[float, float, float, float]]:
    """Query boxes: the AOI's bbox, or, when it crosses 180° (split into parts east and
    west of it), one box per side. Never more than 2, so a many-island AOI stays cheap."""
    w, s, e, n = geometry.bounds
    parts = list(getattr(geometry, "geoms", [geometry]))
    if len(parts) > 1 and e - w > 180:
        sides = [[p for p in parts if p.centroid.x < 0], [p for p in parts if p.centroid.x >= 0]]
        return [tuple(round(v, 4) for v in shapely.MultiPolygon(side).bounds) for side in sides if side]
    return [tuple(round(v, 4) for v in (w, s, e, n))]


class Firms:
    def __init__(self, key: str | None, transport: httpx.BaseTransport | None = None,
                 clock: Callable[[], float] = time.monotonic):
        self.key = key
        self.client = httpx.Client(transport=transport, timeout=30.0, follow_redirects=False,
                                   headers={"User-Agent": "almatafi/0.1 (NASA Space Apps Cairo)"})
        self.clock = clock
        self.lock = threading.Lock()
        self.spent: deque[float] = deque()
        self.cache: OrderedDict[tuple, tuple[float, pd.DataFrame, str]] = OrderedDict()
        self.availability: tuple[float, date] | None = None

    @property
    def enabled(self) -> bool:
        return bool(self.key)

    def _book(self, n: int) -> None:
        with self.lock:
            now = self.clock()
            while self.spent and self.spent[0] <= now - BUDGET_WINDOW_S:
                self.spent.popleft()
            if len(self.spent) + n > BUDGET:
                raise ApiError(503, "upstream_busy", "Live hotspots are busy; try again in a few minutes.",
                               {"upstream": "firms"})
            self.spent.extend([now] * n)

    def _call(self, source: str, box, first: date, days: int) -> bytes:
        area = ",".join(f"{v:g}" for v in box)
        url = f"{FIRMS_API}/{self.key}/{source}/{area}/{days}/{first.isoformat()}"
        failed = ApiError(502, "upstream_error", "Live hotspots are unavailable right now.", {"upstream": "firms"})
        try:
            with self.client.stream("GET", url) as r:
                if r.status_code != 200:
                    log.warning("FIRMS %s %s: HTTP %s", source, first, r.status_code)
                    raise failed
                body = bytearray()
                for chunk in r.iter_bytes():  # stop at the cap instead of downloading it all first
                    body += chunk
                    if len(body) > MAX_BYTES:
                        log.warning("FIRMS %s %s: answer over %d bytes", source, first, MAX_BYTES)
                        raise failed
        except httpx.HTTPError as e:
            log.warning("FIRMS %s %s: %s", source, first, type(e).__name__)
            raise failed from None
        return bytes(body)

    def fetch(self, geometry, sensors: list[str], days: int, today: date) -> tuple[pd.DataFrame, str]:
        """Clean points (all of them, unfiltered) for the AOI's boxes and the window. Cached."""
        key = (hashlib.sha256(shapely.to_wkb(geometry)).hexdigest(), tuple(sorted(set(sensors))), days, today)
        with self.lock:
            hit = self.cache.get(key)
            if hit and hit[0] > self.clock():
                self.cache.move_to_end(key)
                return hit[1], hit[2]
        query = self._boxes(geometry)
        calls = [(src, box, first, n) for s in sorted(set(sensors)) for src in SOURCES[s]
                 for box in query for first, n in windows(today, days)
                 if SOURCE_END.get(src, first) >= first]  # S-NPP has stopped
        self._book(len(calls))
        df = self._collect(calls, geometry, today)
        fetched_at = now_utc()
        with self.lock:
            self.cache[key] = (self.clock() + CACHE_TTL_S, df, fetched_at)
            if len(self.cache) > CACHE_MAX:
                self.cache.popitem(last=False)
        return df, fetched_at

    def sp_until(self, today: date) -> dict[str, date]:
        """Last day of standard processing per SP source, from FIRMS's data_availability,
        cached; a source it doesn't list (or any failure) gets today minus SP_LAG_DAYS."""
        with self.lock:
            hit = self.availability
            if hit and hit[0] > self.clock():
                return hit[1]
        lag = today - timedelta(days=SP_LAG_DAYS)
        until = {sp: lag for pairs in PAIRS.values() for sp, _ in pairs}
        try:
            self._book(1)
            r = self.client.get(f"{FIRMS}/data_availability/csv/{self.key}/all")
            if r.status_code == 200:
                rows = pd.read_csv(io.BytesIO(r.content), dtype=str)
                ends = rows.set_index(rows["data_id"].str.strip())["max_date"]
                until.update({k: date.fromisoformat(ends[k].strip()) for k in until if k in ends.index})
            else:
                log.warning("FIRMS data_availability: HTTP %s", r.status_code)
        except ApiError:
            raise
        except Exception as e:  # noqa: BLE001: any odd answer falls back to the usual lag
            log.warning("FIRMS data_availability: %s", type(e).__name__)
        with self.lock:
            self.availability = (self.clock() + AVAILABILITY_TTL_S, until)
        return until

    def fetch_range(self, geometry, sensors: list[str], first: date, last: date, today: date) -> pd.DataFrame:
        """Clean points (unfiltered) for any date range, standard or NRT as FIRMS has them.
        Used for areas without stored points (PLAN.md §3). Cached like `fetch`."""
        key = ("range", hashlib.sha256(shapely.to_wkb(geometry)).hexdigest(), tuple(sorted(set(sensors))), first, last)
        with self.lock:
            hit = self.cache.get(key)
            if hit and hit[0] > self.clock():
                self.cache.move_to_end(key)
                return hit[1]
        query = self._boxes(geometry)
        calls = [(src, box, a, n) for src, a, n in plan(sensors, first, last, self.sp_until(today)) for box in query]
        self._book(len(calls))
        df = self._collect(calls, geometry, today)
        with self.lock:
            self.cache[key] = (self.clock() + CACHE_TTL_S, df, now_utc())
            if len(self.cache) > CACHE_MAX:
                self.cache.popitem(last=False)
        return df

    @staticmethod
    def _boxes(geometry):
        query = boxes(geometry)
        widest = max(geodesic_area_km2(shapely.box(*b)) for b in query)
        if widest > MAX_BOX_KM2:
            # A thin or diagonal shape can be small but have a near-global bbox, and FIRMS
            # is queried by bbox: refuse rather than download everything inside it.
            raise ApiError(422, "too_large", "This shape's bounding box is too large for live hotspots; "
                           "draw a more compact area.", {"bbox_area_km2": round(widest), "limit_km2": MAX_BOX_KM2})
        return query

    def _collect(self, calls, geometry, today: date) -> pd.DataFrame:
        frames = [f for f in (self._parse(self._call(*c), c[0], today) for c in calls) if len(f)]
        df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        if len(df):
            df = df.drop_duplicates("point_id")
            # Only what's inside the shape is kept (and cached), not the whole bbox.
            df = df[shapely.contains_xy(geometry, df["lon"].to_numpy(), df["lat"].to_numpy())].reset_index(drop=True)
        return df

    @staticmethod
    def _parse(body: bytes, source: str, today: date) -> pd.DataFrame:
        if not body.strip():
            return pd.DataFrame()  # FIRMS sends an empty body when nothing burned
        try:
            raw, sensor, _ = read_firms_csv(io.BytesIO(body))
        except (FirmsFormatError, pd.errors.ParserError, UnicodeDecodeError):
            # e.g. "Invalid MAP_KEY." or an HTML maintenance page; never log the body or the URL.
            log.warning("FIRMS %s: not a FIRMS CSV (%d bytes)", source, len(body))
            raise ApiError(502, "upstream_error", "Live hotspots are unavailable right now.", {"upstream": "firms"}) from None
        rows, _ = clean(raw, sensor, "auto", today)  # `nrt` or `archive` per row, from its version
        return rows


def keep(df: pd.DataFrame, mask_path) -> pd.DataFrame:
    """The grid's filter (almatafi.grid.keep_filter), run on the live rows."""
    con = duckdb.connect()
    con.execute("SET TimeZone = 'UTC'")  # otherwise timestamps come back in the server's local time
    con.register("pts", df)
    if mask_path.exists():
        con.execute(f"CREATE VIEW mask AS SELECT cell_id FROM read_parquet('{mask_path.as_posix()}')")
    else:
        con.execute("CREATE VIEW mask AS SELECT 0::INTEGER AS cell_id WHERE false")
    return con.execute(f"SELECT * FROM pts WHERE {keep_filter(MODIS_MIN_CONFIDENCE)}").df()


@router.post("/nrt")
def nrt(body: NrtRequest, request: Request):
    firms: Firms = request.app.state.firms
    if not firms.enabled:
        raise ApiError(503, "data_unavailable", "Live hotspots are not configured on this server.", {"dataset": "nrt"})
    aoi = _resolve(request, body.aoi, LIMIT_POINTS_KM2, "live hotspots")
    df, fetched_at = firms.fetch(aoi.geometry, body.sensors, body.days, _today(request))
    if len(df):
        if not body.include_filtered:
            df = keep(df, request.app.state.data.root / "grid" / "static_mask.parquet")
        df = df.sort_values(["acq_datetime_utc", "point_id"], ascending=[False, True]).reset_index(drop=True)
    total = len(df)
    meta = build_meta(request.app.state.data.data_version(), aoi) | {"fetched_at": fetched_at}
    return {"type": "FeatureCollection",
            "features": [feature(r) for r in df.head(body.limit).itertuples(index=False)] if total else [],
            "total": total, "truncated": total > body.limit, "source": "nrt", "meta": meta}
