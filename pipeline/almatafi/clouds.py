"""Cloud cover per 0.5° cell and month, for the cloud correction (X27, docs/method.md §6).

A hotspot needs a clear view: a fire under cloud is not detected, so a cloudy month looks
quieter than it was. NASA's MODIS climate modelling grid fire products (MOD14CMH for Terra,
MYD14CMH for Aqua; monthly, 0.5°, from UMD's sftp) carry the mean cloud fraction per cell,
and FIRMS's FAQ points to them for cloud-aware analysis. Giglio et al. 2006 correct counts
by the clear share of the observations, which the backend does at query time:

    corrected = Σ over cells  value / max(1 − cloud_fraction, CLEAR_MIN)

Two builders:
- `mock`: a simulated product (`source = "mock"`): a latitude × season pattern with dry
  deserts and year-to-year noise, seeded, so the whole path can be built and tested without
  the network. It is not observed cloud and can't be validated on the mock.
- `real`: NASA's daily MODIS cloud fraction (MOD06/MYD06, Terra and Aqua) as served by GIBS,
  read for the cells our grid covers. GIBS gives each day as a colour-mapped image; one WMS
  request per day and platform returns the whole world at one pixel per 0.5° cell (720 × 360),
  the colours are decoded with GIBS's published colour map (value 0–100 %, a transparent "no
  data" where the satellite didn't see the cell), and the month's cloud fraction per cell is
  the mean of its sampled days. GIBS allows about 1.5 requests a second from one address, so
  the request count is what matters, not the image size: a world image costs the same as a
  small one and serves every region, and every second day (--every 2, the default) is enough
  for a monthly mean (daily cloud is autocorrelated). No login, no key. The MOD14CMH/MYD14CMH
  fire products carry the same kind of cloud fraction, but need UMD's sftp and an HDF4 reader;
  GIBS's layers come from the same MODIS cloud mask. Images are cached under --cache (about
  20 KB each) so reruns only fetch new days.

Output: `clouds/cloud_monthly.parquet` with
    cmg_id (int32), year (int16), month (int8), platform (Terra|Aqua), cloud_fraction (float32)
and file metadata `source` (mock | MOD14CMH/MYD14CMH) and `generated_utc`.

The 0.5° cells nest the 0.1° grid exactly (5 × 5), so a grid cell's CMG cell is
    cmg_id = (cell_id // 3600 // 5) * 720 + (cell_id % 3600) // 5

    python -m almatafi.clouds mock --grid data/grid --out data/clouds
    python -m almatafi.clouds real --grid data/grid --out data/clouds --cache data/raw/gibs-clouds
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from almatafi.platforms import PLATFORMS

REPO = Path(__file__).resolve().parents[2]
CMG_COLS = 720  # 0.5° cells per row
CLEAR_MIN = 0.2  # the correction never scales a cell by more than 1 / 0.2 = 5×
FIRST_YEAR = 2000

SCHEMA = pa.schema([("cmg_id", pa.int32()), ("year", pa.int16()), ("month", pa.int8()),
                    ("platform", pa.string()), ("cloud_fraction", pa.float32())])

# Dry boxes (west, south, east, north) where the mock keeps skies mostly clear.
DESERTS = [(-17, 15, 60, 32.5),     # Sahara, Egypt and Arabia
           (120, -30, 145, -18),    # Australian interior
           (-72, -28, -68, -18),    # Atacama
           (-118, 30, -105, 37)]    # US southwest


def cmg_of_cell(cell_id):
    """0.1° cell id(s) → the 0.5° CMG cell that contains it."""
    c = np.asarray(cell_id, dtype=np.int64)
    return ((c // 3600) // 5) * CMG_COLS + (c % 3600) // 5


def cmg_centre(cmg_id):
    c = np.asarray(cmg_id, dtype=np.int64)
    return (c // CMG_COLS) * 0.5 - 90 + 0.25, (c % CMG_COLS) * 0.5 - 180 + 0.25


def mock_fraction(lat, lon, month, platform: str, noise) -> np.ndarray:
    """Simulated mean cloud fraction (0–1). Mid-latitudes are cloudier in winter, the tropics
    in their wet season (sun overhead), the subtropical belt and deserts stay clear; Aqua's
    13:30 pass sees a little more convective cloud than Terra's 10:30 one in the tropics."""
    lat, lon, month = (np.asarray(a, dtype=float) for a in (lat, lon, month))
    a = np.abs(lat)
    north = lat >= 0
    winter = np.cos(2 * np.pi * (month - np.where(north, 1, 7)) / 12)   # +1 in local midwinter
    wet = np.cos(2 * np.pi * (month - np.where(north, 8, 2)) / 12)      # +1 in the tropical wet season
    w_trop = np.clip((20 - a) / 10, 0, 1)
    w_mid = np.clip((a - 25) / 10, 0, 1)
    w_dry = np.clip(1 - w_trop - w_mid, 0, 1)
    f = (w_trop * (0.55 + 0.25 * wet) + w_dry * (0.18 + 0.08 * winter) + w_mid * (0.45 + 0.2 * winter))
    if platform == "Aqua":
        f = f + 0.04 * w_trop
    dry = np.zeros(lat.shape, dtype=bool)
    for w, s, e, n in DESERTS:
        dry |= (lon >= w) & (lon <= e) & (lat >= s) & (lat <= n)
    f = np.where(dry, f * 0.35, f)
    return np.clip(f + noise, 0.02, 0.95)


def _months(platform: str, last: tuple[int, int]) -> list[tuple[int, int]]:
    p = PLATFORMS[platform]
    first = (p.start.year, p.start.month)
    end = (p.end.year, p.end.month) if p.end else last
    end = min(end, last)
    out, (y, m) = [], first
    while (y, m) <= end:
        out.append((y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def build_mock(cmg_ids: np.ndarray, last: tuple[int, int], seed: int = 20261113) -> pa.Table:
    cmg_ids = np.unique(np.asarray(cmg_ids, dtype=np.int64))
    lat, lon = cmg_centre(cmg_ids)
    parts = []
    for k, platform in enumerate(("Terra", "Aqua")):
        yms = _months(platform, last)
        rng = np.random.default_rng([seed, k])
        n, c = len(yms), cmg_ids.size
        # Year-to-year noise shared by neighbouring months (a wet year is wet for a while).
        noise = rng.normal(0, 0.06, (n, c)) * 0.6 + np.repeat(rng.normal(0, 0.06, (n // 12 + 1, c)), 12, axis=0)[:n] * 0.4
        ys = np.array([y for y, _ in yms])
        ms = np.array([m for _, m in yms])
        frac = mock_fraction(lat[None, :], lon[None, :], ms[:, None], platform, noise)
        parts.append(pa.table({
            "cmg_id": pa.array(np.tile(cmg_ids, n), pa.int32()),
            "year": pa.array(np.repeat(ys, c), pa.int16()),
            "month": pa.array(np.repeat(ms, c), pa.int8()),
            "platform": pa.array([platform] * (n * c), pa.string()),
            "cloud_fraction": pa.array(np.round(frac.ravel(), 3), pa.float32()),
        }, schema=SCHEMA))
    return pa.concat_tables(parts)


def grid_cmg_ids(grid: Path) -> tuple[np.ndarray, tuple[int, int]]:
    """CMG cells holding any grid cell, and the grid's last month."""
    path = (grid / "grid_monthly.parquet").as_posix()
    con = duckdb.connect()
    cells = con.execute(f"SELECT DISTINCT cell_id FROM read_parquet('{path}')").fetchnumpy()["cell_id"]
    y, m = con.execute(f"SELECT year, month FROM read_parquet('{path}') ORDER BY year DESC, month DESC LIMIT 1").fetchone()
    return np.unique(cmg_of_cell(cells)), (int(y), int(m))


# ---- Real cloud fraction from GIBS ------------------------------------------------------------

GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
GIBS_COLORMAP = "https://gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_Cloud_Fraction.xml"
GIBS_LAYERS = {"Terra": "MODIS_Terra_Cloud_Fraction_Day", "Aqua": "MODIS_Aqua_Cloud_Fraction_Day"}
GIBS_FIRST = {"Terra": date(2000, 2, 24), "Aqua": date(2002, 7, 4)}  # the layers' first days
USER_AGENT = "almatafi/0.1 (NASA Space Apps Cairo 2026; cloud fraction for a fire record)"
WORLD = (-180.0, -90.0, 180.0, 90.0)   # one image per day: 720 × 360 px at 0.5°
MAX_BOX_DEG = 60.0                       # boxes_for: regional boxes, kept for callers that want them
Fetcher = Callable[[str], bytes]


def parse_colormap(xml: str) -> dict[tuple[int, int, int], float]:
    """GIBS colour map → {rgb: cloud fraction 0–1}; the no-data colour is left out."""
    out = {}
    for tag in re.findall(r"<ColorMapEntry\b[^>]*/?>", xml):
        if 'nodata="true"' in tag:
            continue
        rgb = re.search(r'rgb="(\d+),(\d+),(\d+)"', tag)
        value = re.search(r'\bvalue="([^"]+)"', tag)
        if rgb and value:
            out[tuple(int(v) for v in rgb.groups())] = float(value.group(1)) / 100.0  # type: ignore[index]
    if len(out) < 50:
        raise ValueError("colour map has too few entries; GIBS changed its format")
    return out


def boxes_for(cmg_ids: np.ndarray) -> list[tuple[float, float, float, float]]:
    """Group the 0.5° cells into request boxes (west, south, east, north): connected groups
    of occupied 10° tiles, each box at most MAX_BOX_DEG wide and tall."""
    ids = np.unique(np.asarray(cmg_ids, dtype=np.int64))
    if ids.size == 0:
        return []
    lat, lon = cmg_centre(ids)
    tiles = {(int(np.floor(a / 10)), int(np.floor(o / 10))) for a, o in zip(lat, lon)}
    seen, groups = set(), []
    for t in sorted(tiles):
        if t in seen:
            continue
        group, stack = [], [t]
        while stack:
            u = stack.pop()
            if u in seen or u not in tiles:
                continue
            seen.add(u); group.append(u)
            stack += [(u[0] + dy, u[1] + dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1)]
        groups.append(group)
    boxes = []
    for g in groups:
        inside = np.array([(int(np.floor(a / 10)), int(np.floor(o / 10))) in set(g) for a, o in zip(lat, lon)])
        w, e = np.floor(lon[inside].min() * 2) / 2, np.ceil(lon[inside].max() * 2) / 2
        s, n = np.floor(lat[inside].min() * 2) / 2, np.ceil(lat[inside].max() * 2) / 2
        for x0 in np.arange(w, e, MAX_BOX_DEG):
            for y0 in np.arange(s, n, MAX_BOX_DEG):
                boxes.append((float(x0), float(y0), float(min(e, x0 + MAX_BOX_DEG)), float(min(n, y0 + MAX_BOX_DEG))))
    return boxes


def wms_url(layer: str, box: tuple[float, float, float, float], day: date) -> str:
    w, s, e, n = box
    width, height = int(round((e - w) * 2)), int(round((n - s) * 2))
    # WMS 1.3.0 with EPSG:4326 orders the box south, west, north, east.
    return (f"{GIBS_WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS={layer}&CRS=EPSG:4326"
            f"&BBOX={s:g},{w:g},{n:g},{e:g}&WIDTH={width}&HEIGHT={height}&FORMAT=image/png&TRANSPARENT=TRUE&TIME={day.isoformat()}")


def decode(png: bytes, box: tuple[float, float, float, float], cmap: dict[tuple[int, int, int], float]) -> dict[int, float]:
    """One day's image → {cmg_id: cloud fraction} for the cells the satellite saw."""
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    w, s, e, n = box
    width, height = int(round((e - w) * 2)), int(round((n - s) * 2))
    if im.size != (width, height):
        raise ValueError(f"image is {im.size}, expected {(width, height)}")
    px = np.asarray(im, dtype=np.int64)
    keys = np.array(sorted((r << 16) | (g << 8) | b for r, g, b in cmap), dtype=np.int64)
    vals = np.array([cmap[((k >> 16) & 255, (k >> 8) & 255, k & 255)] for k in keys], dtype=np.float64)
    code = (px[:, :, 0] << 16) | (px[:, :, 1] << 8) | px[:, :, 2]
    pos = np.searchsorted(keys, code)
    pos[pos >= keys.size] = 0
    ok = (px[:, :, 3] > 0) & (keys[pos] == code)
    rows, cols = np.nonzero(ok)
    lat = n - (rows + 0.5) * 0.5
    lon = w + (cols + 0.5) * 0.5
    ids = (np.floor((lat + 90) * 2).astype(np.int64) * CMG_COLS + np.floor((lon + 180) * 2).astype(np.int64))
    return dict(zip(ids.tolist(), vals[pos[ok]].tolist()))


def _ssl_context():
    """A python.org Python on macOS has no root certificates until "Install Certificates" is
    run; certifi's bundle (installed with the pipeline's dependencies) covers that case."""
    import ssl
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


_SSL = None
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _get(url: str, retries: int = 4) -> bytes:
    global _SSL
    if _SSL is None:
        _SSL = _ssl_context()
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60, context=_SSL) as r:  # noqa: S310 (fixed https host)
                return r.read()
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            if attempt == retries:
                raise
            time.sleep(1.5 * 2 ** attempt)
    raise RuntimeError("unreachable")


def build_gibs(cmg_ids: np.ndarray, first: tuple[int, int], last: tuple[int, int], cache: Path,
               fetch: Fetcher = _get, workers: int = 6, log=print, colormap_xml: str | None = None,
               only: set[int] | None = None, every: int = 2, retries: int = 3,
               retry_wait: float = 3.0) -> tuple[pa.Table, dict]:
    """Monthly mean cloud fraction per 0.5° cell from GIBS's daily MODIS cloud fraction,
    Terra and Aqua, for the months first..last, sampling every `every`-th day. One world image
    per day and platform, cached in `cache/<platform>/world/`."""
    cmap = parse_colormap(colormap_xml if colormap_xml is not None else fetch(GIBS_COLORMAP).decode())
    want = set(int(i) for i in np.unique(np.asarray(cmg_ids, dtype=np.int64)))
    if only is not None:
        want &= only
    boxes = [WORLD]
    end = date(last[0], last[1], 1) + timedelta(days=32)
    end = min(date(end.year, end.month, 1) - timedelta(days=1), date.today())
    jobs = []
    for platform, layer in GIBS_LAYERS.items():
        day = max(GIBS_FIRST[platform], date(first[0], first[1], 1))
        while day <= end:
            jobs.append((platform, layer, "world", WORLD, day))
            day += timedelta(days=max(1, every))
    log(f"{len(jobs):,} world images to read, every {every} day(s), for {len(want)} cells")

    sums: dict[tuple[str, int, int, int], float] = {}
    counts: dict[tuple[str, int, int, int], int] = {}
    stats = {"fetched": 0, "cached": 0, "failed": 0, "empty": 0}

    def one(job):
        platform, layer, k, box, day = job
        path = cache / platform / str(k) / f"{day.isoformat()}.png"  # k is "world"
        data, stats_key = (path.read_bytes() if path.exists() else b""), "cached"
        # GIBS answers some days with HTTP 200 and an XML error report (its own backend's 500).
        # That is not an image: ask again, and never keep it, or reruns would skip the day
        # for good. A cached file that isn't a PNG is such a reply from an older run.
        for attempt in range(retries + 1):
            if data.startswith(PNG_MAGIC):
                break
            if attempt:
                time.sleep(retry_wait * attempt)
            try:
                data = fetch(wms_url(layer, box, day))
            except Exception as e:  # one bad day doesn't stop the month
                return platform, day, None, f"failed: {type(e).__name__}"
            stats_key = "fetched"
        if not data.startswith(PNG_MAGIC):
            path.unlink(missing_ok=True)
            return platform, day, None, "failed: not an image"
        if stats_key == "fetched":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        try:
            vals = decode(data, box, cmap)
        except Exception as e:
            return platform, day, None, f"failed: {type(e).__name__}"
        return platform, day, vals, stats_key

    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for platform, day, vals, note in pool.map(one, jobs):
            done += 1
            if vals is None:
                stats["failed"] += 1
            else:
                stats[note] += 1
                if not vals:
                    stats["empty"] += 1
                for cid, v in vals.items():
                    if cid not in want:
                        continue
                    key = (platform, day.year, day.month, cid)
                    sums[key] = sums.get(key, 0.0) + v
                    counts[key] = counts.get(key, 0) + 1
            if done % 2000 == 0:
                log(f"  {done:,}/{len(jobs):,} days read ({stats['fetched']:,} fetched, {stats['cached']:,} cached, {stats['failed']} failed)")

    keys = sorted(sums)
    table = pa.table({
        "cmg_id": pa.array([k[3] for k in keys], pa.int32()),
        "year": pa.array([k[1] for k in keys], pa.int16()),
        "month": pa.array([k[2] for k in keys], pa.int8()),
        "platform": pa.array([k[0] for k in keys], pa.string()),
        "cloud_fraction": pa.array([round(sums[k] / counts[k], 3) for k in keys], pa.float32()),
    }, schema=SCHEMA)
    return table, stats | {"days_per_cell_month": (sum(counts.values()) / max(1, len(counts)))}


def write(table: pa.Table, out: Path, source: str) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    path = out / "cloud_monthly.parquet"
    meta = {b"source": source.encode(), b"generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").encode(),
            b"clear_min": str(CLEAR_MIN).encode()}
    table = table.replace_schema_metadata(meta).sort_by([("platform", "ascending"), ("year", "ascending"),
                                                         ("month", "ascending"), ("cmg_id", "ascending")])
    tmp = path.with_suffix(".tmp")
    pq.write_table(table, tmp, compression="zstd")
    tmp.replace(path)
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Cloud cover per 0.5° cell and month (docs/method.md §6).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mock", help="simulated cloud cover for the cells in a grid (labelled mock)")
    m.add_argument("--grid", type=Path, required=True)
    m.add_argument("--out", type=Path, required=True)
    m.add_argument("--seed", type=int, default=20261113)
    r = sub.add_parser("real", help="NASA GIBS daily MODIS cloud fraction (Terra, Aqua), monthly mean per cell")
    r.add_argument("--grid", type=Path, required=True)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--cache", type=Path, default=REPO / "data" / "raw" / "gibs-clouds", help="where the day images are kept")
    r.add_argument("--since", default=None, help="first month, YYYY-MM (default: the grid's first month)")
    r.add_argument("--bbox", action="append", default=None, help="west,south,east,north: only cells inside (repeatable; default: every grid cell)")
    r.add_argument("--workers", type=int, default=6)
    r.add_argument("--every", type=int, default=2, help="sample every N-th day (2: about 15 days a month)")
    args = ap.parse_args(argv)
    ids, last = grid_cmg_ids(args.grid)
    if args.cmd == "mock":
        table = build_mock(ids, last, args.seed)
        path = write(table, args.out, "mock")
        print(f"{table.num_rows:,} rows, {ids.size:,} cells × months to {last[0]}-{last[1]:02d} (mock) → {path}")
        return 0
    first = tuple(int(x) for x in args.since.split("-")) if args.since else grid_first_month(args.grid)
    only = None
    if args.bbox:
        lat, lon = cmg_centre(ids)
        keep = np.zeros(ids.size, dtype=bool)
        for b in args.bbox:
            w, s_, e, n = (float(v) for v in b.split(","))
            keep |= (lon >= w) & (lon <= e) & (lat >= s_) & (lat <= n)
        only = set(int(i) for i in ids[keep])
    table, stats = build_gibs(ids, first, last, args.cache, workers=args.workers, only=only, every=args.every)  # type: ignore[arg-type]
    path = write(table, args.out, f"GIBS MODIS cloud fraction, day (MOD06/MYD06 Terra and Aqua), monthly mean per 0.5° cell of every {args.every}. day")
    print(f"{table.num_rows:,} rows → {path}; {stats['fetched']:,} fetched, {stats['cached']:,} cached, "
          f"{stats['failed']} failed, {stats['days_per_cell_month']:.1f} days per cell-month")
    return 1 if table.num_rows == 0 else 0


def grid_first_month(grid: Path) -> tuple[int, int]:
    path = (grid / "grid_monthly.parquet").as_posix()
    y, m = duckdb.connect().execute(f"SELECT year, month FROM read_parquet('{path}') ORDER BY year, month LIMIT 1").fetchone()
    return int(y), int(m)


if __name__ == "__main__":
    sys.exit(main())
