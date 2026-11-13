"""R1: download FIRMS files (docs/firms-research.md). Built and tested on fakes before Nov 13.

Two sources, as a real run needs both:
1. Yearly country files (standard processing, with `type`), no key needed:
   data/country/{product}/{year}/{product}_{year}_{Country}.csv
   They exist for past years only, and not for NOAA-21. NOAA-20's product is `viirs-jpss1`.
2. The API (key needed, 1–5 days per request) for everything else, per country or box:
   standard processing (`*_SP`) from where the country files stop, then NRT from the day
   after standard data ends. `api_plan` makes the pieces meet without overlapping (NRT and
   standard positions differ, so ingest can't dedupe them).

Every file is checked (FIRMS header, size cap), written atomically, and logged in
`manifest.json` with its SHA-256. Reruns skip files already in the manifest. The MAP_KEY
never reaches the manifest, the file names or the logs.

    python -m almatafi.fetch countries --countries Egypt,Argentina,Chile --years 2000-2025
    FIRMS_MAP_KEY=... python -m almatafi.fetch api --country EGY --name egypt
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


def country_api_url(key: str, source: str, iso3: str, days: int, start: date | None = None) -> str:
    if not 1 <= days <= MAX_DAYS:
        raise ValueError(f"days must be 1..{MAX_DAYS}")
    if not (len(iso3) == 3 and iso3.isalpha() and iso3.isupper()):
        raise ValueError("country must be an ISO 3166 alpha-3 code, e.g. EGY")
    tail = f"/{start.isoformat()}" if start else ""
    return f"{BASE}/api/country/csv/{key}/{source}/{iso3}/{days}{tail}"


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
              retries: int = 3, pause: float = 2.0, sleep=time.sleep) -> dict:
    """Download one file into `out/rel` unless it's already in the manifest.

    Returns {"status": "ok"|"skipped"|"missing"|"empty"}. 404 = FIRMS has no such file
    (a country with no fires that year), not an error. 5xx and 429 are retried.
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
    path = out / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(r.body)
    tmp.replace(path)
    entry = {"url": safe_url, "bytes": len(r.body), "rows": rows,
             "sha256": hashlib.sha256(r.body).hexdigest(), "retrieved_utc": _now()}
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
    """API files for one area after the country files stop. `area` is an ISO3 country code,
    a (w, s, e, n) box, or None for the whole world."""
    if not key:
        raise FetchError("FIRMS_MAP_KEY is not set")
    url = availability_url(key)
    r = get(url)
    if r.status != 200:
        raise FetchError(f"HTTP {r.status} for {redact(url, key)}")
    plan = api_plan(read_availability(r.body), products, until)
    manifest, counts = Manifest(out), dict.fromkeys(STATUSES, 0)

    def request(source, days, first):
        if isinstance(area, str):
            return country_api_url(key, source, area, days, first)
        return area_url(key, source, area, days, first)

    for product, source, first, days in plan:
        kind = "sp" if source.endswith("_SP") else "nrt"
        rel = f"{product}/{kind}_{name}_{first.isoformat()}_{days}d.csv"
        res = _try(lambda: fetch_one(request(source, days, first), out, rel, manifest, get,
                                     key=key, sleep=sleep), rel, log, key)
        counts[res["status"]] += 1
        if res["status"] not in ("skipped", "failed"):
            log(f"{res['status']:8} {rel}" + (f"  {res['rows']:,} rows" if res["status"] == "ok" else ""))
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
    where.add_argument("--country", help="ISO 3166 alpha-3 code, e.g. EGY")
    where.add_argument("--bbox", type=_bbox, help="west,south,east,north or world")
    n.add_argument("--name", required=True, help="short tag for the file names, e.g. nile-delta")
    n.add_argument("--products", default=",".join(PRODUCTS))
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
            area = args.country.upper() if args.country else args.bbox
            counts = fetch_api(os.environ.get("FIRMS_MAP_KEY", ""), area, args.name, args.out, products=products)
    except FetchError as e:
        print(f"error: {redact(str(e), os.environ.get('FIRMS_MAP_KEY'))}", file=sys.stderr)
        return 1
    print(" ".join(f"{k}={v}" for k, v in counts.items()), f"→ {args.out}")
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
