"""R1: download FIRMS files (docs/firms-research.md). Built and tested on fakes before Nov 13.

Two sources, as a real run needs both:
1. Yearly country files (standard processing, with `type`), no key needed:
   data/country/{product}/{year}/{product}_{year}_{Country}.csv
   They exist for past years only, and not for NOAA-21. NOAA-20's product is `viirs-jpss1`.
2. The area API (key needed, 1–5 days per request) for everything else, per country or box:
   standard processing (`*_SP`) from where the country files stop, then NRT from the day
   after standard data ends. `api_plan` makes the pieces meet without overlapping (NRT and
   standard positions differ, so ingest can't dedupe them).
   FIRMS's `/api/country` endpoint is marked "currently not available" (checked Nov 13, 2026),
   so a country is fetched as its bounding box and clipped to its outline (geoBoundaries ADM0,
   from the backend's `python -m app.admin EGY:0`), with ~1 km of slack for coastal pixels.
   The kept area then matches the yearly country files closely enough (borders may differ by
   a pixel or so; FIRMS doesn't say which outline its country files use).

Every file is checked (FIRMS header, size cap), written atomically, and logged in
`manifest.json` with its SHA-256. Reruns skip files already in the manifest. The MAP_KEY
never reaches the manifest, the file names or the logs.

    python -m almatafi.fetch countries --countries Egypt,Argentina,Chile --years 2000-2025
    FIRMS_MAP_KEY=... python -m almatafi.fetch api --country EGY --name egypt --admin-dir data/admin
    FIRMS_MAP_KEY=... python -m almatafi.fetch api --bbox 29,29,33,32 --name nile-delta
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

import numpy as np

REPO = Path(__file__).resolve().parents[2]
BASE = "https://firms.modaps.eosdis.nasa.gov"
ALLOWED_HOSTS = {"firms.modaps.eosdis.nasa.gov"}
MAX_BYTES = 400 * 1024 * 1024
USER_AGENT = "almatafi/0.1 (NASA Space Apps Cairo 2026)"
MAX_DAYS = 5  # the area API's DAY_RANGE limit

# Product (our folder name) → first year with data (the archive download page's coverage).
PRODUCTS = {"modis": 2000, "viirs-snpp": 2012, "viirs-noaa20": 2018, "viirs-noaa21": 2023}
# FIRMS's name for each product's yearly country files. NOAA-20 is JPSS-1 there, and NOAA-21
# has none (checked Nov 3, 2026: viirs-jpss2 and viirs-noaa21 answer 404), so it comes from the API.
COUNTRY_FILES = {"modis": "modis", "viirs-snpp": "viirs-snpp", "viirs-noaa20": "viirs-jpss1"}
# First day of standard data for products the country files don't cover at all.
API_FROM = {"viirs-noaa21": date(2023, 3, 1)}
# API source names, NRT and standard, per product.
SOURCES = {"modis": ("MODIS_NRT", "MODIS_SP"), "viirs-snpp": ("VIIRS_SNPP_NRT", "VIIRS_SNPP_SP"),
           "viirs-noaa20": ("VIIRS_NOAA20_NRT", "VIIRS_NOAA20_SP"),
           "viirs-noaa21": ("VIIRS_NOAA21_NRT", "VIIRS_NOAA21_SP")}
# FIRMS country names for the demo regions (spaces become underscores in file names).
DEMO_COUNTRIES = ["Egypt", "Argentina", "Chile"]


class FetchError(RuntimeError):
    pass


@dataclass(frozen=True)
class Response:
    status: int
    body: bytes


Getter = Callable[[str], Response]


def _get(url: str, timeout: float = 180) -> Response:
    """GET with a byte cap. Redirects are followed by urllib, so the final host is checked too."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (https + allowlist checked)
            final = urlsplit(r.geturl())
            if final.scheme != "https" or final.hostname not in ALLOWED_HOSTS:
                raise FetchError("redirected off the FIRMS host")
            body = r.read(MAX_BYTES + 1)
            return Response(r.status, body)
    except urllib.error.HTTPError as e:
        return Response(e.code, b"")


def _check_url(url: str) -> None:
    u = urlsplit(url)
    if u.scheme != "https" or u.hostname not in ALLOWED_HOSTS:
        raise FetchError(f"refusing {u.scheme}://{u.hostname}")


def redact(text: str, key: str | None) -> str:
    return text.replace(key, "***") if key else text


def country_url(product: str, year: int, country: str) -> str:
    c = country.strip().replace(" ", "_")
    name = COUNTRY_FILES[product]
    return f"{BASE}/data/country/{name}/{year}/{name}_{year}_{c}.csv"


def area_url(key: str, source: str, bbox: tuple[float, float, float, float] | None, days: int,
             start: date | None = None) -> str:
    if not 1 <= days <= MAX_DAYS:
        raise ValueError(f"days must be 1..{MAX_DAYS}")
    area = "world" if bbox is None else ",".join(f"{v:g}" for v in bbox)
    tail = f"/{start.isoformat()}" if start else ""
    return f"{BASE}/api/area/csv/{key}/{source}/{area}/{days}{tail}"


CLIP_SLACK_DEG = 0.01  # ~1 km: a coastal pixel's centre can sit just off a simplified coastline


class Boundary:
    """A country outline (GeoJSON Polygon/MultiPolygon features) for clipping area-API rows.

    Point in polygon is the even-odd rule over every ring (holes and islands included), with
    the edges binned into latitude bands so each point only meets the edges near it. A point
    also counts as inside when a point CLIP_SLACK_DEG away (N, S, E or W) is: a cheap buffer.
    """

    BAND = 0.25  # degrees of latitude per edge bin

    def __init__(self, geojson: dict, name: str = ""):
        self.name = name
        feats = geojson.get("features") if geojson.get("type") == "FeatureCollection" else [geojson]
        rings = []
        for f in feats or []:
            g = f.get("geometry", f) if isinstance(f, dict) else None
            if not g:
                continue
            polys = [g["coordinates"]] if g.get("type") == "Polygon" else \
                g.get("coordinates", []) if g.get("type") == "MultiPolygon" else []
            for poly in polys:
                for ring in poly:
                    r = np.asarray(ring, dtype=float)[:, :2]
                    if len(r) >= 3:
                        rings.append(r)
        if not rings:
            raise FetchError(f"no polygon in the boundary {name or ''}".strip())
        pts = np.concatenate(rings)
        self.bbox = (float(pts[:, 0].min()), float(pts[:, 1].min()), float(pts[:, 0].max()), float(pts[:, 1].max()))
        if self.bbox[2] - self.bbox[0] > 180:
            raise FetchError(f"{name}: the outline crosses the 180° line; fetch it with --bbox per side")
        a = np.concatenate([r for r in rings])
        b = np.concatenate([np.roll(r, -1, axis=0) for r in rings])
        keep = (a != b).any(axis=1)
        self.x1, self.y1, self.x2, self.y2 = a[keep, 0], a[keep, 1], b[keep, 0], b[keep, 1]
        lo, hi = np.minimum(self.y1, self.y2), np.maximum(self.y1, self.y2)
        self.bands: dict[int, np.ndarray] = {}
        for k in range(int(np.floor(lo.min() / self.BAND)), int(np.floor(hi.max() / self.BAND)) + 1):
            idx = np.nonzero((hi >= k * self.BAND) & (lo <= (k + 1) * self.BAND))[0]
            if idx.size:
                self.bands[k] = idx

    @classmethod
    def from_file(cls, path: Path) -> "Boundary":
        try:
            return cls(json.loads(path.read_text()), path.stem)
        except FileNotFoundError:
            raise FetchError(f"no boundary file {path}; prefetch it with the backend's "
                             f"`python -m app.admin {path.stem.replace('_ADM', ':')}`") from None

    def fetch_bbox(self, pad: float = 0.05) -> tuple[float, float, float, float]:
        w, s, e, n = self.bbox
        return (max(-180.0, round(w - pad, 2)), max(-90.0, round(s - pad, 2)),
                min(180.0, round(e + pad, 2)), min(90.0, round(n + pad, 2)))

    def _inside(self, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
        out = np.zeros(lon.shape, dtype=bool)
        band = np.floor(lat / self.BAND).astype(int)
        for k in np.unique(band):
            idx = self.bands.get(int(k))
            if idx is None:
                continue
            sel = np.nonzero(band == k)[0]
            px, py = lon[sel, None], lat[sel, None]
            x1, y1, x2, y2 = self.x1[idx], self.y1[idx], self.x2[idx], self.y2[idx]
            crosses = (y1 > py) != (y2 > py)
            with np.errstate(divide="ignore", invalid="ignore"):
                xint = (x2 - x1) * (py - y1) / (y2 - y1) + x1
            out[sel] = (crosses & (px < xint)).sum(axis=1) % 2 == 1
        return out

    def contains(self, lon, lat, slack: float = CLIP_SLACK_DEG) -> np.ndarray:
        lon, lat = np.asarray(lon, dtype=float), np.asarray(lat, dtype=float)
        w, s, e, n = self.bbox
        ok = (lon >= w - slack) & (lon <= e + slack) & (lat >= s - slack) & (lat <= n + slack)
        res = np.zeros(lon.shape, dtype=bool)
        i = np.nonzero(ok)[0]
        if i.size == 0:
            return res
        x, y = lon[i], lat[i]
        hit = self._inside(x, y)
        if slack:
            for dx, dy in ((slack, 0), (-slack, 0), (0, slack), (0, -slack)):
                todo = ~hit
                if not todo.any():
                    break
                hit[todo] = self._inside(x[todo] + dx, y[todo] + dy)
        res[i] = hit
        return res

    def clip_csv(self, body: bytes) -> tuple[bytes, int, int]:
        """Keep the header and the rows inside the outline: (new body, kept, dropped)."""
        text = body.decode("utf-8-sig", errors="replace")
        lines = text.splitlines()
        header, rows = lines[0], [ln for ln in lines[1:] if ln.strip()]
        cols = header.strip().lower().split(",")
        ilat, ilon = cols.index("latitude"), cols.index("longitude")
        lat, lon = np.empty(len(rows)), np.empty(len(rows))
        for j, ln in enumerate(rows):
            parts = ln.split(",")
            try:
                lat[j], lon[j] = float(parts[ilat]), float(parts[ilon])
            except (IndexError, ValueError):
                lat[j] = lon[j] = np.nan  # ingest reports unreadable rows; keep them for it
        bad = np.isnan(lat) | np.isnan(lon)
        keep = bad.copy()
        keep[~bad] = self.contains(lon[~bad], lat[~bad])
        kept = [ln for ln, k in zip(rows, keep) if k]
        return ("\n".join([header, *kept]) + "\n").encode(), len(kept), len(rows) - len(kept)


def availability_url(key: str) -> str:
    return f"{BASE}/api/data_availability/csv/{key}/all"


def check_firms_csv(body: bytes) -> int:
    """Rows in a FIRMS CSV; raises unless the header is a FIRMS one."""
    if len(body) > MAX_BYTES:
        raise FetchError("file larger than the size cap")
    text = body.decode("utf-8-sig", errors="replace")
    header = text.split("\n", 1)[0].strip().lower().split(",")
    if header[:1] == ["country_id"]:
        header = header[1:]
    if header[:2] != ["latitude", "longitude"] or not ({"brightness", "bright_ti4"} & set(header)):
        raise FetchError(f"not a FIRMS CSV (starts {text[:60]!r})")
    return max(sum(1 for line in text.splitlines()[1:] if line.strip()), 0)


class Manifest:
    """`manifest.json` in the output folder: one entry per file, keyed by its path."""

    def __init__(self, out: Path):
        self.path = out / "manifest.json"
        self.files: dict[str, dict] = json.loads(self.path.read_text())["files"] if self.path.exists() else {}

    def has(self, rel: str) -> bool:
        return rel in self.files

    def add(self, rel: str, entry: dict) -> None:
        self.files[rel] = entry
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps({"files": dict(sorted(self.files.items()))}, indent=2) + "\n")
        tmp.replace(self.path)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fetch_one(url: str, out: Path, rel: str, manifest: Manifest, get: Getter, key: str | None = None,
              retries: int = 3, pause: float = 2.0, sleep=time.sleep, clip: Boundary | None = None) -> dict:
    """Download one file into `out/rel` unless it's already in the manifest.

    Returns {"status": "ok"|"skipped"|"missing"|"empty"}. 404 = FIRMS has no such file
    (a country with no fires that year), not an error. 5xx and 429 are retried.
    With `clip`, only the rows inside that outline are written; the manifest keeps the
    fetched file's size, rows and SHA-256 next to the written one's.
    """
    if manifest.has(rel):
        return {"status": "skipped"}
    _check_url(url)
    safe_url = redact(url, key)
    for attempt in range(retries + 1):
        r = get(url)
        if r.status == 200:
            break
        if r.status == 404:
            return {"status": "missing", "url": safe_url}
        if r.status in (429, 500, 502, 503, 504) and attempt < retries:
            sleep(pause * 2 ** attempt)
            continue
        raise FetchError(f"HTTP {r.status} for {safe_url}")
    if not r.body.strip():
        return {"status": "empty", "url": safe_url}
    try:
        rows = check_firms_csv(r.body)
    except FetchError as e:
        raise FetchError(f"{safe_url}: {redact(str(e), key)}") from None
    body, extra = r.body, {}
    if clip is not None:
        body, kept, dropped = clip.clip_csv(r.body)
        extra = {"clipped_to": clip.name, "fetched_bytes": len(r.body), "fetched_rows": rows,
                 "fetched_sha256": hashlib.sha256(r.body).hexdigest(), "rows_outside": dropped}
        rows = kept
    path = out / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(body)
    tmp.replace(path)
    entry = {"url": safe_url, "bytes": len(body), "rows": rows,
             "sha256": hashlib.sha256(body).hexdigest(), **extra, "retrieved_utc": _now()}
    manifest.add(rel, entry)
    return {"status": "ok", **entry}


def country_jobs(countries: list[str], years: range, products: list[str] | None = None,
                 this_year: int | None = None):
    """(url, relative path) per product × year × country. Skips years before a product existed,
    products without country files, and the current year (its file isn't published yet)."""
    this_year = this_year or date.today().year
    for product in products or list(PRODUCTS):
        if product not in COUNTRY_FILES:
            continue
        for year in years:
            if year < PRODUCTS[product] or year >= this_year:
                continue
            for c in countries:
                c = c.strip().replace(" ", "_")
                yield country_url(product, year, c), f"{product}/{year}_{c}.csv"


def read_availability(body: bytes) -> dict[str, tuple[date, date]]:
    """`data_availability` CSV → {data_id: (min_date, max_date)}."""
    rows = csv.DictReader(io.StringIO(body.decode("utf-8-sig")))
    out = {}
    for r in rows:
        try:
            out[r["data_id"].strip()] = (date.fromisoformat(r["min_date"].strip()),
                                         date.fromisoformat(r["max_date"].strip()))
        except (KeyError, ValueError, AttributeError):
            continue
    return out


def api_plan(avail: dict[str, tuple[date, date]], products: list[str] | None = None,
             until: date | None = None, this_year: int | None = None) -> list[tuple[str, str, date, int]]:
    """API requests that cover each product from where its country files stop up to the newest
    NRT day, in chunks of MAX_DAYS: [(product, source, first day, days)].

    Standard data (`*_SP`) first, from 1 January of this year (or the product's first day if
    it has no country files); then NRT from the day after standard data ends.
    """
    this_year = this_year or (until or date.today()).year
    plan = []
    for product in products or list(PRODUCTS):
        nrt, sp = SOURCES[product]
        start = API_FROM[product] if product not in COUNTRY_FILES else date(this_year, 1, 1)
        pieces = []
        if sp in avail:
            sp_min, sp_max = avail[sp]
            pieces.append((sp, max(start, sp_min), min(sp_max, until or sp_max)))
            start = max(start, sp_max + timedelta(days=1))
        if nrt in avail:
            nrt_min, nrt_max = avail[nrt]
            pieces.append((nrt, max(start, nrt_min), min(nrt_max, until or nrt_max)))
        for source, first, last in pieces:
            while first <= last:
                days = min(MAX_DAYS, (last - first).days + 1)
                plan.append((product, source, first, days))
                first += timedelta(days=days)
    return plan


STATUSES = ("ok", "skipped", "missing", "empty", "failed")


def _try(job, rel: str, log, key: str | None = None) -> dict:
    """One file's failure is logged and counted; the run goes on to the next file."""
    try:
        return job()
    except (FetchError, OSError) as e:
        log(f"failed   {rel}: {redact(str(e), key)}")
        return {"status": "failed"}


def fetch_countries(countries, years, out: Path, get: Getter = _get, products=None, pause: float = 1.0,
                    sleep=time.sleep, log=print, this_year: int | None = None) -> dict:
    """Yearly country files. A country with no file at all is a wrong name, so it fails."""
    manifest, counts = Manifest(out), dict.fromkeys(STATUSES, 0)
    found: dict[str, int] = {}
    for url, rel in country_jobs(countries, years, products, this_year):
        res = _try(lambda: fetch_one(url, out, rel, manifest, get, sleep=sleep), rel, log)
        counts[res["status"]] += 1
        country = rel.rsplit("_", 1)[1].removesuffix(".csv")
        found[country] = found.get(country, 0) + (res["status"] != "missing")
        if res["status"] not in ("skipped", "failed"):
            log(f"{res['status']:8} {rel}" + (f"  {res['rows']:,} rows" if res["status"] == "ok" else ""))
            sleep(pause)
    for country, n in found.items():
        if n == 0:
            log(f"failed   {country}: FIRMS has no file for it at all; check the spelling (e.g. United_States)")
            counts["failed"] += 1
    return counts


def fetch_api(key: str, area, name: str, out: Path, get: Getter = _get, products=None,
              until: date | None = None, pause: float = 1.0, sleep=time.sleep, log=print) -> dict:
    """API files for one area after the country files stop. `area` is a country `Boundary`
    (fetched as its box, clipped to its outline), a (w, s, e, n) box, or None for the world."""
    if not key:
        raise FetchError("FIRMS_MAP_KEY is not set")
    url = availability_url(key)
    r = get(url)
    if r.status != 200:
        raise FetchError(f"HTTP {r.status} for {redact(url, key)}")
    plan = api_plan(read_availability(r.body), products, until)
    manifest, counts = Manifest(out), dict.fromkeys(STATUSES, 0)

    clip = area if isinstance(area, Boundary) else None
    box = clip.fetch_bbox() if clip else area

    def request(source, days, first):
        return area_url(key, source, box, days, first)

    for product, source, first, days in plan:
        kind = "sp" if source.endswith("_SP") else "nrt"
        rel = f"{product}/{kind}_{name}_{first.isoformat()}_{days}d.csv"
        res = _try(lambda: fetch_one(request(source, days, first), out, rel, manifest, get,
                                     key=key, sleep=sleep, clip=clip), rel, log, key)
        counts[res["status"]] += 1
        if res["status"] not in ("skipped", "failed"):
            log(f"{res['status']:8} {rel}" + (f"  {res['rows']:,} rows" if res["status"] == "ok" else "")
                + (f" ({res['rows_outside']:,} outside {clip.name} dropped)" if res.get("rows_outside") else ""))
            sleep(pause)
    return counts


def _years(text: str) -> range:
    a, _, b = text.partition("-")
    return range(int(a), int(b or a) + 1)


def _bbox(text: str) -> tuple[float, float, float, float] | None:
    if text == "world":
        return None
    w, s, e, n = (float(v) for v in text.split(","))
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise argparse.ArgumentTypeError("bbox must be west,south,east,north")
    return (w, s, e, n)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Download FIRMS files (docs/firms-research.md).")
    ap.add_argument("--out", type=Path, default=REPO / "data" / "raw" / "firms")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("countries", help="yearly country files (standard processing, no key)")
    c.add_argument("--countries", default=",".join(DEMO_COUNTRIES))
    c.add_argument("--years", type=_years, default=_years(f"2000-{date.today().year - 1}"),
                   help="the current year has no country file yet; `api` fetches it")
    c.add_argument("--products", default=",".join(PRODUCTS))
    n = sub.add_parser("api", aliases=["nrt"],
                       help="API for this year, NOAA-21 and the NRT tail (needs FIRMS_MAP_KEY)")
    where = n.add_mutually_exclusive_group(required=True)
    where.add_argument("--country", help="ISO 3166 alpha-3 code, e.g. EGY: its box, clipped to its outline")
    where.add_argument("--bbox", type=_bbox, help="west,south,east,north or world")
    n.add_argument("--name", required=True, help="short tag for the file names, e.g. nile-delta")
    n.add_argument("--products", default=",".join(PRODUCTS))
    n.add_argument("--admin-dir", type=Path, default=REPO / "data" / "admin",
                   help="where {ISO3}_ADM0.geojson lives (backend: python -m app.admin EGY:0)")
    args = ap.parse_args(argv)

    products = [p.strip() for p in args.products.split(",") if p.strip()]
    if set(products) - set(PRODUCTS):
        ap.error(f"products must be from: {', '.join(PRODUCTS)}")
    try:
        if args.cmd == "countries":
            counts = fetch_countries(args.countries.split(","), args.years, args.out, products=products)
        else:
            if not args.name.replace("-", "").isalnum():
                ap.error("--name: letters, digits and dashes only")
            if args.country and not (len(args.country) == 3 and args.country.isalpha()):
                ap.error("--country: an ISO 3166 alpha-3 code, e.g. EGY")
            area = (Boundary.from_file(args.admin_dir / f"{args.country.upper()}_ADM0.geojson")
                    if args.country else args.bbox)
            counts = fetch_api(os.environ.get("FIRMS_MAP_KEY", ""), area, args.name, args.out, products=products)
    except FetchError as e:
        print(f"error: {redact(str(e), os.environ.get('FIRMS_MAP_KEY'))}", file=sys.stderr)
        return 1
    print(" ".join(f"{k}={v}" for k, v in counts.items()), f"→ {args.out}")
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
