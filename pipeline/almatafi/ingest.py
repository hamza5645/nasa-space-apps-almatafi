"""FIRMS CSV → clean points (GeoParquet).

Implements contracts/firms-input.md (parsing, normalisation, validity checks, ingest
report) and contracts/data-products.md §1 (clean points). Strict about columns,
lenient about enum spellings.

    python -m almatafi.ingest data/raw/mock/modis/*.csv data/raw/mock/viirs-*/*.csv
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.dataset as ds

from almatafi import cells
from almatafi.platforms import PLATFORMS, SATELLITE_ALIASES

REPO = Path(__file__).resolve().parents[2]

COMMON = ["latitude", "longitude", "scan", "track", "acq_date", "acq_time", "satellite",
          "instrument", "confidence", "version", "frp", "daynight"]
REQUIRED = {
    "MODIS": COMMON + ["brightness", "bright_t31"],
    "VIIRS": COMMON + ["bright_ti4", "bright_ti5"],
}
BRIGHTNESS = {"MODIS": ("brightness", "bright_t31"), "VIIRS": ("bright_ti4", "bright_ti5")}

# Order matters: a row is counted under the first check it fails.
# `bad_value` is not in firms-input.md 1.0 yet (unreadable confidence, brightness, scan, track or type).
DROP_KEYS = ["unknown_platform", "bad_coords", "bad_date", "bad_frp", "bad_daynight",
             "platform_out_of_range", "bad_value", "duplicate"]

VIIRS_CONFIDENCE = {"l": "low", "low": "low", "n": "nominal", "nominal": "nominal",
                    "h": "high", "high": "high"}

SCHEMA = pa.schema([
    ("point_id", pa.string()),
    ("sensor", pa.string()),
    ("platform", pa.string()),
    ("lat", pa.float64()),
    ("lon", pa.float64()),
    ("geometry", pa.binary()),
    # Parquet has no seconds unit; data-products.md 1.0 says [s], values are whole seconds.
    ("acq_datetime_utc", pa.timestamp("ms", tz="UTC")),
    ("year", pa.int16()),
    ("month", pa.int8()),
    ("daynight", pa.string()),
    ("frp", pa.float32()),
    ("brightness_k", pa.float32()),
    ("brightness2_k", pa.float32()),
    ("scan_km", pa.float32()),
    ("track_km", pa.float32()),
    ("confidence_class", pa.string()),
    ("confidence_pct", pa.int8()),
    ("fire_type", pa.int8()),
    ("version", pa.string()),
    ("cell_id", pa.int32()),
    ("source", pa.string()),
])


class FirmsFormatError(ValueError):
    pass


def read_firms_csv(path: Path) -> tuple[pd.DataFrame, str, list[str]]:
    """Read a FIRMS CSV as text. Returns (rows, sensor, extra columns)."""
    raw = pd.read_csv(path, dtype=str, keep_default_na=False)
    raw.columns = [c.strip().lower() for c in raw.columns]
    cols = set(raw.columns)
    if "brightness" in cols:
        sensor = "MODIS"
    elif "bright_ti4" in cols:
        sensor = "VIIRS"
    else:
        raise FirmsFormatError(f"{path}: neither a MODIS nor a VIIRS FIRMS file")
    missing = [c for c in REQUIRED[sensor] if c not in cols]
    if missing:
        raise FirmsFormatError(f"{path}: {sensor} file is missing columns {missing}")
    extra = sorted(cols - set(REQUIRED[sensor]) - {"type"})
    return raw, sensor, extra


def _num(s: pd.Series) -> pd.Series:
    """Text → float; unreadable and non-finite values (`inf`, `nan`) become NaN."""
    v = pd.to_numeric(s.str.strip(), errors="coerce")
    return v.where(np.isfinite(v))


def _is_nrt(version: pd.Series) -> pd.Series:
    """FIRMS near real time rows: version `6.1NRT`, `2.0NRT`, or RT / URT."""
    return version.astype(str).str.strip().str.upper().str.endswith("RT")


def _parse_time(s: pd.Series) -> tuple[pd.Series, pd.Series]:
    """`HHMM`, possibly unpadded ("5" = 00:05). Returns (minutes after midnight, ok)."""
    t = s.str.strip()
    ok = t.str.fullmatch(r"\d{1,4}").fillna(False).astype(bool)
    padded = t.where(ok, "0").str.zfill(4)
    hh, mm = padded.str[:2].astype(int), padded.str[2:].astype(int)
    ok &= (hh <= 23) & (mm <= 59)
    return hh * 60 + mm, ok


def clean(raw: pd.DataFrame, sensor: str, source: str, today: date | None = None
          ) -> tuple[pd.DataFrame, Counter]:
    """Normalise and validate one file. Returns (clean rows, dropped counts)."""
    today = today or datetime.now(timezone.utc).date()
    n = len(raw)
    fails: dict[str, pd.Series] = {}

    platform = raw["satellite"].str.strip().str.lower().map(SATELLITE_ALIASES)
    fails["unknown_platform"] = platform.isna() | (platform.map(
        {p.name: p.sensor for p in PLATFORMS.values()}) != sensor)

    lat, lon = _num(raw["latitude"]), _num(raw["longitude"])
    fails["bad_coords"] = ~(lat.between(-90, 90) & lon.between(-180, 180))

    day = pd.to_datetime(raw["acq_date"].str.strip(), format="%Y-%m-%d", errors="coerce")
    minutes, time_ok = _parse_time(raw["acq_time"])
    fails["bad_date"] = day.isna() | (day > pd.Timestamp(today)) | ~time_ok

    frp_text = raw["frp"].str.strip()
    frp = _num(frp_text)
    fails["bad_frp"] = (frp_text != "") & ~(frp >= 0)

    daynight = raw["daynight"].str.strip().str.upper()
    fails["bad_daynight"] = ~daynight.isin(["D", "N"])

    start = platform.map({p.name: pd.Timestamp(p.start) for p in PLATFORMS.values()})
    # Platforms that stopped (S-NPP on 2026-11-02) carry an `end` in platforms.py.
    end = platform.map({p.name: pd.Timestamp(getattr(p, "end", None) or pd.Timestamp.max)
                        for p in PLATFORMS.values()})
    fails["platform_out_of_range"] = ((day < start) | (day > end)).fillna(False).astype(bool)

    b1, b2 = (_num(raw[c]) for c in BRIGHTNESS[sensor])
    scan, track = _num(raw["scan"]), _num(raw["track"])
    conf_text = raw["confidence"].str.strip()
    if sensor == "MODIS":
        pct = _num(conf_text)
        conf_ok = pct.between(0, 100) & (pct == pct.round())
        conf_class = pd.cut(pct, [-1, 29, 79, 100], labels=["low", "nominal", "high"]).astype(object)
    else:
        pct = pd.Series(np.nan, index=raw.index)
        conf_class = conf_text.str.lower().map(VIIRS_CONFIDENCE)
        conf_ok = conf_class.notna()
    if "type" in raw.columns:
        type_text = raw["type"].str.strip()
        fire_type = _num(type_text)
        type_ok = (type_text == "") | fire_type.isin([0, 1, 2, 3])
    else:
        fire_type = pd.Series(np.nan, index=raw.index)
        type_ok = pd.Series(True, index=raw.index)
    instrument_ok = raw["instrument"].str.strip().str.upper() == sensor
    fails["bad_value"] = ~(conf_ok & type_ok & instrument_ok & b1.notna() & b2.notna()
                           & (scan > 0) & (track > 0))

    when = day + pd.to_timedelta(minutes.where(time_ok, 0), unit="min")
    dupe_key = pd.DataFrame({"p": platform, "lat": lat, "lon": lon, "t": when})

    dropped = Counter({k: 0 for k in DROP_KEYS})
    alive = pd.Series(True, index=raw.index)
    for key in DROP_KEYS[:-1]:
        hit = alive & fails[key].fillna(True).astype(bool)
        dropped[key] = int(hit.sum())
        alive &= ~hit
    dup = pd.Series(False, index=raw.index)
    dup[alive] = dupe_key[alive].duplicated(keep="first")
    dropped["duplicate"] = int(dup.sum())
    alive &= ~dup

    k = alive.to_numpy()
    when_k = when[k].dt.tz_localize("UTC")
    out = pd.DataFrame({
        "sensor": sensor,
        "platform": platform[k],
        "lat": lat[k],
        "lon": lon[k],
        "acq_datetime_utc": when_k,
        "year": when_k.dt.year,
        "month": when_k.dt.month,
        "daynight": daynight[k],
        "frp": frp[k],
        "brightness_k": b1[k],
        "brightness2_k": b2[k],
        "scan_km": scan[k],
        "track_km": track[k],
        "confidence_class": conf_class[k],
        "confidence_pct": pct[k],
        "fire_type": fire_type[k],
        "version": raw["version"].str.strip()[k],
        "source": source_of(raw["version"][k]) if source == "auto" else source,
    }).reset_index(drop=True)
    out.insert(0, "point_id", point_ids(out))
    out["cell_id"] = cells.cell_ids(out["lat"], out["lon"])
    assert len(out) + sum(dropped.values()) == n
    return out, dropped


def source_of(version: pd.Series) -> np.ndarray:
    """`nrt` for FIRMS near real time rows (version `6.1NRT`, `2.0NRT`, or RT/URT), else `archive`.
    A real download mixes both, and they share year partitions, so one run labels each row."""
    return np.where(version.str.strip().str.upper().str.endswith("RT"), "nrt", "archive")


def point_ids(df: pd.DataFrame) -> list[str]:
    """First 16 hex chars of SHA-1 of `platform|lat|lon|acq_datetime_utc`.
    lat/lon use Python's shortest float text (30.1, not 30.10); time is ISO 8601 with Z."""
    times = df["acq_datetime_utc"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    # repr(float(x)) on purpose: repr of a NumPy float is "np.float64(30.1)" in NumPy 2.
    return [hashlib.sha1(f"{p}|{float(a)!r}|{float(o)!r}|{t}".encode()).hexdigest()[:16]
            for p, a, o, t in zip(df["platform"], df["lat"], df["lon"], times)]


def _wkb_points(lon: np.ndarray, lat: np.ndarray) -> pa.BinaryArray:
    """Little-endian WKB points, built in one go instead of row by row."""
    rec = np.empty(lon.size, dtype=np.dtype([("order", "u1"), ("kind", "<u4"), ("x", "<f8"), ("y", "<f8")]))
    rec["order"], rec["kind"], rec["x"], rec["y"] = 1, 1, lon, lat
    offsets = np.arange(lon.size + 1, dtype=np.int32) * rec.itemsize
    return pa.BinaryArray.from_buffers(pa.binary(), lon.size,
                                       [None, pa.py_buffer(offsets), pa.py_buffer(rec.tobytes())])


def to_table(df: pd.DataFrame, data_version: str) -> pa.Table:
    arrays = []
    for f in SCHEMA:
        if f.name == "geometry":
            arrays.append(_wkb_points(df["lon"].to_numpy(float), df["lat"].to_numpy(float)))
        else:
            col = df[f.name]
            if pa.types.is_integer(f.type):
                col = col.astype("Int64")  # keeps nulls for confidence_pct / fire_type
            arrays.append(pa.array(col, type=f.type, from_pandas=True))
    bbox = [float(df["lon"].min()), float(df["lat"].min()), float(df["lon"].max()), float(df["lat"].max())] \
        if len(df) else []
    geo = {
        "version": "1.0.0",
        "primary_column": "geometry",
        # No "crs" key means OGC:CRS84, i.e. WGS84 with lon/lat order (EPSG:4326 axes swapped).
        "columns": {"geometry": {"encoding": "WKB", "geometry_types": ["Point"], "bbox": bbox}},
    }
    meta = {b"geo": json.dumps(geo).encode(), b"data_version": data_version.encode()}
    return pa.Table.from_arrays(arrays, schema=SCHEMA.with_metadata(meta))


def _prefer(df: pd.DataFrame) -> pd.DataFrame:
    """Rows in keep-first order for de-duplication: standard (archive) before NRT,
    otherwise the order given. A stable sort, so equal rows keep their order."""
    return df.iloc[np.argsort(_is_nrt(df["version"]).to_numpy(), kind="stable")]


def write_clean(df: pd.DataFrame, out: Path, data_version: str) -> tuple[list[str], int]:
    """Write Hive partitions sensor=…/year=….

    New points are merged into what a partition already holds, so ingesting a second file
    for the same year (another country, satellite or the NRT tail) keeps the first file's
    points. A point already stored (same `point_id`) is kept once: the archive copy over
    the NRT one, otherwise this run's copy. Re-running the same files changes nothing.
    To rebuild from scratch, delete the output folder first (scripts/build-data.sh does).
    Returns (partition folders written, points that were already stored).
    """
    written, already = [], 0
    for (sensor, year), part in df.groupby(["sensor", "year"], sort=True):
        folder = out / f"sensor={sensor}" / f"year={year}"
        if any(folder.glob("*.parquet")):
            old = ds.dataset(folder, format="parquet").to_table().to_pandas()
            old = old.assign(sensor=sensor, year=year)
            both = _prefer(pd.concat([part, old[part.columns]], ignore_index=True))
            seen = both.duplicated("point_id")
            already += int(seen.sum())
            part = both[~seen]
        table = to_table(part.sort_values(["acq_datetime_utc", "point_id"]), data_version)
        table = table.drop_columns(["sensor", "year"])  # carried by the folder names
        ds.write_dataset(table, folder, format="parquet", basename_template="part-{i}.parquet",
                         existing_data_behavior="delete_matching")
        written.append(str(folder))
    return written, already


def read_clean(path: Path) -> pd.DataFrame:
    """Read clean points back with the partition columns restored."""
    keys = pa.schema([("sensor", pa.string()), ("year", pa.int16())])
    dataset = ds.dataset(path, format="parquet", partitioning=ds.partitioning(keys, flavor="hive"))
    return dataset.to_table().to_pandas()


def ingest(files: list[Path], out: Path, reports: Path, source: str,
           today: date | None = None, run_id: str | None = None) -> dict:
    now = datetime.now(timezone.utc)
    run_id = run_id or now.strftime("%Y-%m-%dT%H-%M-%SZ")
    data_version = f"{'firms' if source == 'auto' else source}-{(today or now.date()):%Y%m%d}"

    frames, dropped, rows_read, extra = [], Counter({k: 0 for k in DROP_KEYS}), 0, {}
    for path in files:
        raw, sensor, extra_cols = read_firms_csv(path)
        if extra_cols:
            extra[str(path)] = extra_cols
        df, d = clean(raw, sensor, source, today)
        frames.append(df)
        dropped.update(d)
        rows_read += len(raw)

    # The same hotspot can sit in two input files (e.g. overlapping downloads).
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=[f.name for f in SCHEMA])
    # Keep the archive copy over the NRT one, whatever order the files came in.
    df = _prefer(df)
    cross = df.duplicated(["platform", "lat", "lon", "acq_datetime_utc"])
    dropped["duplicate"] += int(cross.sum())
    df = df[~cross]

    partitions, already = write_clean(df, out, data_version) if len(df) else ([], 0)
    report = {
        "run_id": run_id,
        "data_version": data_version,
        "source": source,
        "files": [str(p) for p in files],
        "rows_read": rows_read,
        "rows_kept": len(df),
        "dropped": dict(dropped),
        "by_platform": {k: int(v) for k, v in sorted(df["platform"].value_counts().items())},
        "extra_columns": extra,
        "partitions": partitions,
        # Kept rows that were already in the output from an earlier run (stored once).
        "already_stored": already,
    }
    reports.mkdir(parents=True, exist_ok=True)
    path, i = reports / f"ingest_{run_id}.json", 1
    while path.exists():  # two runs in the same second
        i += 1
        path = reports / f"ingest_{run_id}-{i}.json"
    report["report_path"] = str(path)
    path.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Clean FIRMS CSVs into GeoParquet points.")
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=REPO / "data" / "clean")
    ap.add_argument("--reports", type=Path, default=REPO / "data" / "reports")
    ap.add_argument("--source", choices=["auto", "archive", "nrt", "mock"],
                    help="default: mock if every file is under a mock/ folder, else auto (nrt or archive per row, from version)")
    args = ap.parse_args(argv)
    source = args.source or ("mock" if all("mock" in p.parts for p in args.files) else "auto")
    r = ingest(args.files, args.out, args.reports, source)
    print(f"{r['rows_kept']:,} of {r['rows_read']:,} rows kept; "
          f"dropped {sum(r['dropped'].values()):,} {dict((k, v) for k, v in r['dropped'].items() if v)}")
    print(f"report: {r['report_path']}")


if __name__ == "__main__":
    main()
