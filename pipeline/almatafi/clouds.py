"""Cloud cover per 0.5° cell and month, for the cloud correction (X27, docs/method.md §6).

A hotspot needs a clear view: a fire under cloud is not detected, so a cloudy month looks
quieter than it was. NASA's MODIS climate modelling grid fire products (MOD14CMH for Terra,
MYD14CMH for Aqua; monthly, 0.5°, from UMD's sftp) carry the mean cloud fraction per cell,
and FIRMS's FAQ points to them for cloud-aware analysis. Giglio et al. 2006 correct counts
by the clear share of the observations, which the backend does at query time:

    corrected = Σ over cells  value / max(1 − cloud_fraction, CLEAR_MIN)

**The product here is simulated** (`source = "mock"`): a latitude × season pattern with dry
deserts and year-to-year noise, seeded, so the whole path (pipeline → API → calendar) can be
built and tested before the real files are read. It is not observed cloud cover and it is
not the cloud that hid the mock's fires (the mock sensors aren't thinned by cloud), so it
can't be validated on the mock. `real` is not built yet: it needs the HDF4 files and a reader.

Output: `clouds/cloud_monthly.parquet` with
    cmg_id (int32), year (int16), month (int8), platform (Terra|Aqua), cloud_fraction (float32)
and file metadata `source` (mock | MOD14CMH/MYD14CMH) and `generated_utc`.

The 0.5° cells nest the 0.1° grid exactly (5 × 5), so a grid cell's CMG cell is
    cmg_id = (cell_id // 3600 // 5) * 720 + (cell_id % 3600) // 5

    python -m almatafi.clouds mock --grid data/grid --out data/clouds
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from almatafi.platforms import PLATFORMS

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
    sub.add_parser("real", help="MOD14CMH/MYD14CMH (not built yet)")
    args = ap.parse_args(argv)
    if args.cmd == "real":
        print("not built yet: needs MOD14CMH/MYD14CMH (HDF4, UMD sftp fuoco.geog.umd.edu) and a reader; "
              "see docs/method.md §6. Use `mock` meanwhile.", file=sys.stderr)
        return 2
    ids, last = grid_cmg_ids(args.grid)
    table = build_mock(ids, last, args.seed)
    path = write(table, args.out, "mock")
    print(f"{table.num_rows:,} rows, {ids.size:,} cells × months to {last[0]}-{last[1]:02d} (mock) → {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
