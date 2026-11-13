"""POST /api/calendar, /api/stats, /api/hotspots (api.md §2.3–2.5)."""

from __future__ import annotations

import calendar as cal
from datetime import date, timedelta
from typing import Annotated, Literal

import numpy as np
import pandas as pd
import shapely
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, StringConstraints

from almatafi.grid import keep_filter

from app import analytics
from app.aoi import LIMIT_GRID_KM2, LIMIT_POINTS_KM2, Aoi, cells_touching, resolve
from app.errors import ApiError
from app.meta import build_meta
from app.series import UNITS, YM, Reader, months, parse_ym

router = APIRouter(prefix="/api")

Month = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
View = Literal["harmonized", "modis", "viirs"]
Metric = Literal["detections", "fire_days"]
FIRST_MONTH: YM = (2000, 11)  # Terra's first FIRMS data
MAX_HOTSPOT_DAYS = 366
# A 500k km² AOI touches ~5k cells at the equator and ~25k near 80°; slivers beyond this are refused.
MAX_HOTSPOT_WINDOW = 200_000
# Points read before the exact shape test. Far above any real 366-day, 500k km² query.
MAX_HOTSPOT_ROWS = 1_000_000
# Longest span fetched from FIRMS for areas without stored points: 7 requests of 5 days per source.
ON_DEMAND_MAX_DAYS = 31


class CalendarRequest(BaseModel):
    aoi: Aoi
    start: Month = "2001-01"
    end: Month | None = None
    view: View = "harmonized"
    metric: Metric = "detections"


class StatsRequest(BaseModel):
    aoi: Aoi
    month: Month
    baseline: tuple[int, int] | None = None
    view: View = "harmonized"
    metric: Metric = "detections"


PlatformName = Literal["Terra", "Aqua", "SNPP", "NOAA20", "NOAA21"]


class HotspotsRequest(BaseModel):
    aoi: Aoi
    start: date
    end: date
    sensors: list[Literal["MODIS", "VIIRS"]] = Field(default=["MODIS", "VIIRS"], min_length=1)
    # Several satellites see the same fires; pick one to match a calendar count (null = all).
    platforms: list[PlatformName] | None = Field(default=None, min_length=1)
    include_filtered: bool = False
    limit: int = Field(default=5000, ge=1, le=50000)


def _today(request: Request) -> date:
    return request.app.state.today()


def _check_months(first: YM, last: YM, today: date) -> None:
    if first > last:
        raise ApiError(400, "bad_request", "start is after end.")
    current = (today.year, today.month)
    for ym in (first, last):
        if not FIRST_MONTH <= ym <= current:
            raise ApiError(422, "out_of_range",
                           f"{ym[0]}-{ym[1]:02d} is outside {FIRST_MONTH[0]}-{FIRST_MONTH[1]:02d}"
                           f" … {current[0]}-{current[1]:02d}.", {"month": f"{ym[0]}-{ym[1]:02d}"})


def _resolve(request: Request, aoi, limit: float, what: str):
    s = request.app.state
    return resolve(aoi, s.regions, s.admin, max_area_km2=limit, what=what)


@router.post("/calendar")
def calendar(body: CalendarRequest, request: Request):
    return calendar_payload(request, body.aoi, body.start, body.end, body.view, body.metric)


def calendar_payload(request: Request, aoi_body, start: str, end: str | None, view: str, metric: str) -> dict:
    """The /calendar response; /export reuses it for calendar files."""
    today = _today(request)
    first = parse_ym(start)
    last = parse_ym(end) if end else (today.year, today.month)
    _check_months(first, last, today)
    aoi = _resolve(request, aoi_body, LIMIT_GRID_KM2, "calendars and statistics")
    reader = Reader(request.app.state.data, aoi.cell_ids, today)
    series = reader.monthly(view, metric, first, last)

    years = list(range(first[0], last[0] + 1))
    in_range = set(months(first, last))
    matrix, origin = [], []
    for y in years:
        row, orow = [], []
        for m in range(1, 13):
            v = series.values.get((y, m)) if (y, m) in in_range else None
            row.append(None if v is None else analytics.round_half_up(v))
            orow.append(series.origin.get((y, m)) if v is not None else None)
        matrix.append(row)
        origin.append(orow)

    year_totals = [sum(v for v in row if v is not None) if any(v is not None for v in row) else None
                   for row in matrix]
    month_medians = []
    for j in range(12):
        col = [row[j] for row in matrix if row[j] is not None]
        month_medians.append(analytics.round_half_up(float(np.median(col))) if col else None)
    values = [v for row in matrix for v in row if v is not None]

    partial = None
    if last == (today.year, today.month):
        partial = {"month": f"{last[0]}-{last[1]:02d}", "days_observed": reader.days_observed(view, last)}

    out = {
        "view": view, "metric": metric, "unit": UNITS[(view, metric)],
        "years": years, "months": list(range(1, 13)), "matrix": matrix,
    }
    if view == "harmonized":
        out["origin"] = origin
    out |= {"year_totals": year_totals, "month_medians": month_medians,
            "max": max(values) if values else None, "partial_month": partial,
            "meta": build_meta(request.app.state.data.data_version(), aoi)}
    return out


@router.post("/stats")
def stats(body: StatsRequest, request: Request):
    today = _today(request)
    target = parse_ym(body.month)
    _check_months(target, target, today)
    last_complete = today.year - 1
    y0, y1 = body.baseline or (2001, last_complete)
    if y0 > y1 or y0 < FIRST_MONTH[0] or y1 > today.year:
        raise ApiError(422, "out_of_range", f"baseline {y0}–{y1} is outside 2000–{today.year}.",
                       {"baseline": [y0, y1]})
    aoi = _resolve(request, body.aoi, LIMIT_GRID_KM2, "calendars and statistics")
    reader = Reader(request.app.state.data, aoi.cell_ids, today)
    first_year = min(y0, target[0], 2000)
    series = reader.monthly(body.view, body.metric, (first_year, 1), (today.year, today.month))

    value = series.values.get(target)
    if value is None:
        raise ApiError(422, "out_of_range", f"{body.month} was not observed in the {body.view} view.",
                       {"month": body.month, "view": body.view})

    partial = None
    if target == (today.year, today.month):
        days = reader.days_observed(body.view, target)
        if days < cal.monthrange(*target)[1]:
            partial = {"days_observed": days, "comparison": "same_days_previous_years"}

    baseline = []
    for y in range(y0, y1 + 1):
        v = series.values.get((y, target[1]))
        if y == target[0] or v is None:
            continue  # the target year never sits in its own baseline
        if partial:
            v *= reader.share_of_month(body.view, (y, target[1]), partial["days_observed"])
        baseline.append((y, v))

    annual = [(y, sum(series.values[(y, m)] for m in range(1, 13)))
              for y in range(first_year, last_complete + 1)
              if all(series.values.get((y, m)) is not None for m in range(1, 13))]

    c = analytics.compare(value, baseline)
    return {
        "month": body.month,
        "value": analytics.r1(value),
        "baseline": {"years": [y0, y1], **{k: c[k] for k in
                     ("n_years", "mean", "median", "sd", "min", "max", "values")}},
        **{k: c[k] for k in ("percentile", "rank", "z", "ratio_to_median", "status")},
        "partial": partial,
        "trend": analytics.trend(annual),
        "meta": build_meta(request.app.state.data.data_version(), aoi),
    }


POINT_COLUMNS = ["point_id", "sensor", "platform", "lat", "lon", "acq_datetime_utc", "daynight", "frp",
                 "confidence_class", "confidence_pct", "fire_type", "brightness_k", "scan_km", "track_km",
                 "cell_id", "source"]


def _num(v, digits=2):
    return None if v is None or pd.isna(v) else round(float(v), digits)


@router.post("/hotspots")
def hotspots(body: HotspotsRequest, request: Request):
    df, aoi, on_demand = hotspot_frame(request, body.aoi, body.start, body.end, body.sensors, body.include_filtered)
    # Counts per satellite before the platform filter, so a client can show what it left out.
    by_platform = {str(k): int(v) for k, v in df["platform"].value_counts().sort_index().items()}
    if body.platforms:
        df = df[df["platform"].isin(body.platforms)]
    total = len(df)
    return {"type": "FeatureCollection", "features": [feature(r) for r in df.head(body.limit).itertuples(index=False)],
            "total": total, "truncated": total > body.limit, "on_demand": on_demand, "by_platform": by_platform,
            "meta": build_meta(request.app.state.data.data_version(), aoi)}


def hotspot_frame(request: Request, aoi_body, start: date, end: date, sensors, include_filtered: bool):
    """Points inside the AOI, newest first; /export reuses it for hotspot files."""
    if end < start:
        raise ApiError(400, "bad_request", "start is after end.")
    span = (end - start).days + 1
    if span > MAX_HOTSPOT_DAYS:
        raise ApiError(422, "too_large", f"Date span is {span} days; the limit for hotspots is {MAX_HOTSPOT_DAYS}.",
                       {"days": span, "limit_days": MAX_HOTSPOT_DAYS})
    aoi = _resolve(request, aoi_body, LIMIT_POINTS_KM2, "hotspots")
    today = _today(request)
    # Filter by the cells the shape touches, not its bbox: a thin or 180°-crossing shape
    # has a small area but a huge bbox.
    reader = Reader(request.app.state.data, cells_touching(aoi.geometry, MAX_HOTSPOT_WINDOW), today)
    try:
        reader.points_view()
    except ApiError as e:
        if e.code != "data_unavailable":
            raise
        missing = e  # no stored points at all: on demand below, or this 503
    else:
        missing = None

    df = pd.DataFrame(columns=POINT_COLUMNS)
    if missing is None:
        w, s, e, n = aoi.geometry.bounds
        sensors_sql = ", ".join(f"'{x}'" for x in sorted(set(sensors)))
        years = ", ".join(str(y) for y in range(start.year, end.year + 1))
        where = [f"sensor IN ({sensors_sql})", f"year IN ({years})",
                 f"acq_datetime_utc >= TIMESTAMPTZ '{start.isoformat()} 00:00:00+00'",
                 f"acq_datetime_utc < TIMESTAMPTZ '{(end + timedelta(days=1)).isoformat()} 00:00:00+00'",
                 f"lat BETWEEN {s} AND {n}", f"lon BETWEEN {w} AND {e}"]
        if not include_filtered:
            where.append(keep_filter(30))
        df = reader.con.sql(f"""SELECT {", ".join(POINT_COLUMNS)} FROM pts JOIN aoi_cells USING (cell_id)
                                WHERE {" AND ".join(where)}
                                ORDER BY acq_datetime_utc DESC, point_id LIMIT {MAX_HOTSPOT_ROWS + 1}""").df()
        if len(df) > MAX_HOTSPOT_ROWS:
            raise ApiError(422, "too_large", "Too many hotspots in this area and period; narrow the dates or the area.",
                           {"limit_points": MAX_HOTSPOT_ROWS})
        # The bbox query is a prefilter; keep only points inside the actual shape.
        df = df[shapely.contains_xy(aoi.geometry, df["lon"].to_numpy(), df["lat"].to_numpy())]

    # Points are stored for the demo regions only (PLAN.md §3); anywhere else they come from
    # the FIRMS area API, for spans short enough to stay cheap.
    firms = request.app.state.firms
    on_demand = df.empty and firms.enabled and span <= ON_DEMAND_MAX_DAYS
    if on_demand:
        from app.nrt import keep  # app.nrt imports this module
        live = firms.fetch_range(aoi.geometry, sensors, start, end, today)
        if len(live):
            day = live["acq_datetime_utc"].dt.date
            live = live[(day >= start) & (day <= end)]
            if not include_filtered and len(live):
                live = keep(live, request.app.state.data.root / "grid" / "static_mask.parquet")
        df = (live[POINT_COLUMNS].sort_values(["acq_datetime_utc", "point_id"], ascending=[False, True])
              if len(live) else pd.DataFrame(columns=POINT_COLUMNS))
    elif missing is not None:
        raise missing

    return df.reset_index(drop=True), aoi, bool(on_demand)


def _utc(ts) -> pd.Timestamp:
    ts = pd.Timestamp(ts)
    return ts.tz_localize("UTC") if ts.tzinfo is None else ts.tz_convert("UTC")


def feature(r) -> dict:
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [r.lon, r.lat]},
        "properties": {
            "point_id": r.point_id, "sensor": r.sensor, "platform": r.platform,
            "acq_datetime_utc": _utc(r.acq_datetime_utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "daynight": r.daynight, "frp": _num(r.frp), "confidence_class": r.confidence_class,
            "confidence_pct": None if _num(r.confidence_pct) is None else int(r.confidence_pct),
            "fire_type": None if _num(r.fire_type) is None else int(r.fire_type),
            "brightness_k": _num(r.brightness_k), "scan_km": _num(r.scan_km), "track_km": _num(r.track_km),
            "cell_id": int(r.cell_id), "source": r.source,
        },
    }
