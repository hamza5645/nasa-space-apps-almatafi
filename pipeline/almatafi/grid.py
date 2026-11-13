"""Clean points → monthly 0.1° grid per platform, coverage table and static-source mask.

Implements contracts/data-products.md §2. DuckDB streams the Parquet files, so the
same code works on the real global archive without loading it into memory.

    python -m almatafi.grid [--clean data/clean] [--out data/grid] [--modis-min-confidence 30]
"""

from __future__ import annotations

import argparse
import calendar
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

REPO = Path(__file__).resolve().parents[2]

STATIC_MIN_MONTHS = 6  # a cell is masked when type 2 shows up in this many distinct months
# Volcanoes (type 1) and offshore flares (type 3) are rarer per cell but just as persistent.
OTHER_MIN_MONTHS = 2

# MODIS C6.1's FRP detection limit grows with pixel area A (km²): Dp = λ·A + μ MW, by pass
# (Sofiev & Kouznetsov 2026, EGUsphere, doi:10.5194/egusphere-2026-89). A VIIRS fire whose
# pixels add up to less than that is one MODIS would most likely have missed.
MODIS_FLOOR = {"D": (4.44, 0.52), "N": (4.43, 1.01)}
DEFAULT_MODIS_AREA_KM2 = 2.0   # typical MODIS pixel (scan × track) when the run has no MODIS
# VIIRS splits a fire's FRP over its pixels, so the floor is tested on clusters: same
# satellite, same overpass minute, same 0.02° box (about one MODIS pixel off nadir).
CLUSTER_DEG = 0.02

GRID_SCHEMA = pa.schema([
    ("cell_id", pa.int32()),
    ("year", pa.int16()),
    ("month", pa.int8()),
    ("platform", pa.string()),
    ("daynight", pa.string()),
    ("detections", pa.int32()),
    ("fire_days", pa.int16()),
    ("frp_sum", pa.float32()),
    # X14: the part MODIS could have seen. MODIS rows: all of it. VIIRS rows: detections in
    # fire clusters whose summed FRP reaches MODIS's detection floor (see MODIS_FLOOR).
    ("detections_big", pa.int32()),
    ("fire_days_big", pa.int16()),
])
COVERAGE_SCHEMA = pa.schema([
    ("platform", pa.string()),
    ("year", pa.int16()),
    ("month", pa.int8()),
    ("observed_days", pa.int8()),
])
MASK_SCHEMA = pa.schema([("cell_id", pa.int32()), ("months_flagged", pa.int16())])


def _connect(clean: Path) -> duckdb.DuckDBPyConnection:
    files = sorted(clean.glob("sensor=*/year=*/*.parquet"))
    if not files:
        raise FileNotFoundError(f"no clean points under {clean}; run almatafi.ingest first")
    con = duckdb.connect()
    con.execute("SET TimeZone = 'UTC'")  # so CAST(timestamptz AS DATE) is the UTC day
    # The file list goes in as a value, not pasted into SQL, so any folder name works.
    con.read_parquet([f.as_posix() for f in files], hive_partitioning=True).create_view("pts")
    return con


def _version_key(v: str) -> tuple[str, str]:
    """Sort key for `{source}-{YYYYMMDD}`: by date first, so the newest build wins whatever
    its source name (a plain max() picks `nrt-…` over a newer `archive-…`)."""
    m = re.search(r"(\d{8})$", v)
    return (m.group(1) if m else "", v)


def data_version_of(clean: Path) -> str:
    """The clean points' data_version (the newest one if a run mixed several)."""
    versions = {pq.read_schema(f).metadata.get(b"data_version", b"").decode()
                for f in clean.glob("sensor=*/year=*/*.parquet")}
    return max(versions - {""}, key=_version_key, default="unknown")


def static_mask(con) -> pa.Table:
    """Cells the archive flags as not vegetation often enough. NRT and API rows have no `type`,
    so this mask is what keeps flares, volcanoes and offshore platforms out of those months."""
    return con.sql(f"""
        SELECT cell_id, CAST(COUNT(DISTINCT year * 100 + month) AS SMALLINT) AS months_flagged
        FROM pts WHERE fire_type IN (1, 2, 3)
        GROUP BY cell_id
        HAVING COUNT(DISTINCT CASE WHEN fire_type = 2 THEN year * 100 + month END) >= {STATIC_MIN_MONTHS}
            OR COUNT(DISTINCT CASE WHEN fire_type IN (1, 3) THEN year * 100 + month END) >= {OTHER_MIN_MONTHS}
        ORDER BY cell_id
    """).to_arrow_table()


def filters(modis_min_confidence: int) -> dict[str, str]:
    """The harmonization filter (PLAN.md §5.2), one SQL condition per reason a point is left
    out, in the order the report counts them. A NULL condition counts as failing."""
    return {
        "low_confidence": f"""COALESCE(CASE WHEN sensor = 'MODIS' THEN confidence_pct >= {int(modis_min_confidence)}
                                       ELSE confidence_class <> 'low' END, FALSE)""",
        "not_vegetation": "COALESCE(fire_type IS NULL OR fire_type = 0, FALSE)",
        "static_mask": "COALESCE(cell_id NOT IN (SELECT cell_id FROM mask), FALSE)",
    }


def keep_filter(modis_min_confidence: int) -> str:
    """The harmonization filter as SQL over `pts`; needs a `mask` table."""
    return "\n        AND ".join(filters(modis_min_confidence).values())


def modis_area(con, modis_min_confidence: int) -> float:
    """Median MODIS pixel area of the kept points: the A in the detection floor."""
    rows = con.sql(f"""SELECT MEDIAN(scan_km * track_km) FROM pts
                       WHERE sensor = 'MODIS' AND {keep_filter(modis_min_confidence)}""").fetchall()
    row = rows[0] if rows else None
    return float(row[0]) if row and row[0] is not None else DEFAULT_MODIS_AREA_KM2


def floors(area_km2: float) -> dict[str, float]:
    return {dn: round(lam * area_km2 + mu, 3) for dn, (lam, mu) in MODIS_FLOOR.items()}


def grid_monthly(con, modis_min_confidence: int, floor: dict[str, float] | None = None) -> pa.Table:
    floor = floor or floors(DEFAULT_MODIS_AREA_KM2)
    big = f"""(sensor = 'MODIS' OR cluster_frp >= CASE WHEN daynight = 'N' THEN {floor['N']}
                                                     ELSE {floor['D']} END)"""
    return con.sql(f"""
        WITH kept AS (
            SELECT *, SUM(COALESCE(frp, 0)) OVER (
                PARTITION BY platform, acq_datetime_utc,
                             CAST(floor(lat / {CLUSTER_DEG}) AS BIGINT), CAST(floor(lon / {CLUSTER_DEG}) AS BIGINT)
            ) AS cluster_frp
            FROM pts WHERE {keep_filter(modis_min_confidence)}
        )
        SELECT cell_id, year, month, platform, daynight,
               COUNT(*) AS detections,
               COUNT(DISTINCT CAST(acq_datetime_utc AS DATE)) AS fire_days,
               SUM(frp) AS frp_sum,
               COUNT(*) FILTER (WHERE {big}) AS detections_big,
               COUNT(DISTINCT CAST(acq_datetime_utc AS DATE)) FILTER (WHERE {big}) AS fire_days_big
        FROM kept
        GROUP BY ALL
        ORDER BY year, month, cell_id, platform, daynight
    """).to_arrow_table()


PARTIAL_COVERAGE = 0.9  # a platform-month is flagged when it observed fewer than 90% of its days


def partial_coverage(cov: pa.Table) -> list[str]:
    """Platform-months that look partly unobserved, e.g. "Aqua 2024-07 (12/31 days)".

    Each platform's first and last month are skipped (they start and end mid-month). On the
    global archive this lists real outages only; many entries mean the input covers a small
    area, where quiet days look unobserved (see `coverage`).
    """
    out = []
    df = cov.to_pandas().sort_values(["platform", "year", "month"])
    for plat, g in df.groupby("platform"):
        for r in g.iloc[1:-1].itertuples(index=False):
            days = calendar.monthrange(int(r.year), int(r.month))[1]
            if r.observed_days < PARTIAL_COVERAGE * days:
                out.append(f"{plat} {int(r.year)}-{int(r.month):02d} ({int(r.observed_days)}/{days} days)")
    return out


def coverage(con) -> pa.Table:
    """Days each platform was observing, per month.

    A day counts when the platform has at least one hotspot anywhere, before any
    filtering. On the global archive that is every day the satellite worked. On a
    small area, quiet days would look unobserved, so build coverage from global data.
    """
    return con.sql("""
        SELECT platform, year, month, COUNT(DISTINCT CAST(acq_datetime_utc AS DATE)) AS observed_days
        FROM pts GROUP BY ALL ORDER BY platform, year, month
    """).to_arrow_table()


def drop_counts(con, modis_min_confidence: int) -> dict:
    """How many points each filter removes, for the report. Same conditions as the grid."""
    whens = "\n".join(f"WHEN NOT {cond} THEN '{reason}'"
                      for reason, cond in filters(modis_min_confidence).items())
    rows = con.sql(f"""
        SELECT CASE {whens} ELSE 'kept' END AS reason, COUNT(*) FROM pts GROUP BY reason
    """).fetchall()
    counts = {"low_confidence": 0, "not_vegetation": 0, "static_mask": 0, "kept": 0}
    counts.update(dict(rows))
    return counts


def _write(table: pa.Table, schema: pa.Schema, path: Path, data_version: str,
           extra: dict[str, str] | None = None) -> None:
    table = table.select(schema.names).cast(schema)
    meta = {b"data_version": data_version.encode(),
            **{k.encode(): str(v).encode() for k, v in (extra or {}).items()}}
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table.replace_schema_metadata(meta), path)


def build(clean: Path, out: Path, reports: Path, modis_min_confidence: int = 30) -> dict:
    con = _connect(clean)
    data_version = data_version_of(clean)

    mask = static_mask(con)
    con.register("mask", mask)
    area = modis_area(con, modis_min_confidence)
    floor = floors(area)
    grid = grid_monthly(con, modis_min_confidence, floor)
    cov = coverage(con)

    _write(mask, MASK_SCHEMA, out / "static_mask.parquet", data_version)
    # Which filter built this grid, so a 30 and a 50 run can't be mixed up downstream.
    _write(grid, GRID_SCHEMA, out / "grid_monthly.parquet", data_version,
           {"modis_min_confidence": modis_min_confidence})
    _write(cov, COVERAGE_SCHEMA, out / "coverage.parquet", data_version)

    run_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    report = {
        "run_id": run_id,
        "data_version": data_version,
        "modis_min_confidence": modis_min_confidence,
        "modis_floor": {"pixel_area_km2": round(area, 3), "frp_mw": floor},
        "points": drop_counts(con, modis_min_confidence),
        "grid_rows": grid.num_rows,
        "cells_with_fire": int(pc.count_distinct(grid.column("cell_id")).as_py()),
        "masked_cells": mask.num_rows,
        "coverage_rows": cov.num_rows,
        "coverage_partial": partial_coverage(cov),
        "outputs": [str(out / n) for n in ("grid_monthly.parquet", "coverage.parquet", "static_mask.parquet")],
    }
    reports.mkdir(parents=True, exist_ok=True)
    path, i = reports / f"grid_{run_id}.json", 1
    while path.exists():
        i += 1
        path = reports / f"grid_{run_id}-{i}.json"
    report["report_path"] = str(path)
    path.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Aggregate clean points into the monthly 0.1° grid.")
    ap.add_argument("--clean", type=Path, default=REPO / "data" / "clean")
    ap.add_argument("--out", type=Path, default=REPO / "data" / "grid")
    ap.add_argument("--reports", type=Path, default=REPO / "data" / "reports")
    ap.add_argument("--modis-min-confidence", type=int, default=30, help="PLAN.md §5.2: test 30 vs 50")
    args = ap.parse_args(argv)
    r = build(args.clean, args.out, args.reports, args.modis_min_confidence)
    p = r["points"]
    print(f"{p['kept']:,} points gridded into {r['grid_rows']:,} rows over {r['cells_with_fire']:,} cells; "
          f"left out: {p['low_confidence']:,} low confidence, {p['not_vegetation']:,} non-vegetation, "
          f"{p['static_mask']:,} in {r['masked_cells']} static cells")
    if r["coverage_partial"]:
        print(f"warning: {len(r['coverage_partial'])} platform-months look partly unobserved, e.g. "
              f"{', '.join(r['coverage_partial'][:3])}. Coverage comes from detections, so a small-area "
              "build undercounts it; build it from global data (R3).", file=sys.stderr)
    print(f"report: {r['report_path']}")


if __name__ == "__main__":
    main()
