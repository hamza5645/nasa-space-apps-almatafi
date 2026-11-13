# Data products contract

Version 1.0.1 · 2026-11-03

The files the pipeline writes and the backend reads. All live under `data/` (gitignored). Types are Apache Arrow / Parquet logical types.

```
data/
├── raw/{modis,viirs,mock}/          FIRMS CSVs as downloaded / generated
├── clean/sensor=MODIS/year=2024/    1. clean points (GeoParquet)
├── grid/                            2. monthly grid per platform (Parquet)
├── harmonized/                      3. harmonized monthly grid (Parquet)
├── validation/                      4. validation results (JSON)
├── cog/                             5. GeoTIFF exports (generated on request, cached)
└── reports/                         ingest / run reports (JSON)
```

Every product carries a **`data_version`** string, `"{source}-{YYYYMMDD}"` (e.g. `"mock-20261103"`, `"firms-20261113"`), stored in the Parquet file metadata and returned by the API, so the UI can show which build it is looking at.

## 1. Clean points · `data/clean/` · GeoParquet

One row per hotspot that passed `firms-input.md` §4. Partitioned by `sensor` and `year` (Hive style).

| Column | Type | Notes |
|---|---|---|
| `point_id` | string | first 16 hex chars of SHA-1 of `platform|lat|lon|acq_datetime_utc` |
| `sensor` | string | `MODIS` / `VIIRS` (partition key) |
| `platform` | string | `Terra` / `Aqua` / `SNPP` / `NOAA20` / `NOAA21` |
| `lat` | float64 | |
| `lon` | float64 | |
| `geometry` | WKB point | EPSG:4326, GeoParquet 1.0 metadata |
| `acq_datetime_utc` | timestamp[s, UTC] | |
| `year` | int16 | partition key |
| `month` | int8 | 1..12 |
| `daynight` | string | `D` / `N` |
| `frp` | float32 | MW, nullable |
| `brightness_k` | float32 | MODIS `brightness` or VIIRS `bright_ti4` |
| `brightness2_k` | float32 | MODIS `bright_t31` or VIIRS `bright_ti5` |
| `scan_km` | float32 | |
| `track_km` | float32 | |
| `confidence_class` | string | `low` / `nominal` / `high` |
| `confidence_pct` | int8 | MODIS only, nullable |
| `fire_type` | int8 | FIRMS `type`, nullable (NRT has none) |
| `version` | string | FIRMS version text |
| `cell_id` | int32 | `grid.md` §2 |
| `source` | string | `archive` / `nrt` / `mock` |

**Filtering for harmonization** (`PLAN.md` §5.2) happens when building the grid, not here: clean points keep low-confidence and non-vegetation rows so they can be shown or exported with their flags.

## 2. Monthly grid per platform · `data/grid/grid_monthly.parquet`

Aggregates of clean points after the harmonization filter (`confidence_class != 'low'`, `fire_type` is null or 0, cell not in the static-source mask). Only non-zero rows are stored.

| Column | Type | Notes |
|---|---|---|
| `cell_id` | int32 | |
| `year` | int16 | |
| `month` | int8 | |
| `platform` | string | |
| `daynight` | string | `D` / `N` |
| `detections` | int32 | number of hotspots |
| `fire_days` | int16 | distinct days with ≥ 1 hotspot, 0..31 |
| `frp_sum` | float32 | MW, sum |

**Coverage table** · `data/grid/coverage.parquet`: which platform was observing which month, so a missing row can be read as zero (observed, nothing found) rather than unknown.

| Column | Type | Notes |
|---|---|---|
| `platform` | string | |
| `year` | int16 | |
| `month` | int8 | |
| `observed_days` | int8 | days with data for this platform in that month |

**Static-source mask** · `data/grid/static_mask.parquet`: `cell_id` (int32), `months_flagged` (int16). A cell is masked when `fire_type = 2` appears in ≥ 6 distinct months.

## 3. Harmonized monthly grid · `data/harmonized/harmonized_monthly.parquet`

The product the calendar is built from. Units: **VIIRS SNPP-equivalent detections** (day + night summed). Only non-zero rows are stored; a missing (cell, month) inside the covered period means 0.

- **`fire_days` is not summed over day and night.** Per platform and cell-month it is the larger of the day and night `fire_days` from §2, so a day with both a day and a night detection counts once and the value stays within 0..31.
- **Zero maps to zero.** Every conversion model gives 0 for a MODIS value of 0: M0 does by construction, and M1 and M2 are fitted on cell-months with MODIS > 0 and return 0 for MODIS = 0. So a cell-month with no MODIS row has no harmonized row, and reads as 0.

| Column | Type | Notes |
|---|---|---|
| `cell_id` | int32 | |
| `year` | int16 | |
| `month` | int8 | |
| `value` | float32 | harmonized detections (≥ 0, not rounded) |
| `value_fire_days` | float32 | same, for the `fire_days` metric |
| `origin` | string | `observed_snpp` / `filled_noaa20` / `filled_noaa21` / `converted_aqua` / `converted_terra` |
| `stratum_id` | string | stratum used for conversion (`grid.md` §6); null when observed |
| `model` | string | `M0` / `M1` / `M2`; null when observed |

Covered period: 2001-01 to the last complete month, plus the current partial month.

**Model parameters** · `data/harmonized/models.parquet`: `stratum_id`, `model`, `step` (`terra_to_aqua` / `aqua_to_snpp` / `noaa20_to_snpp` / `noaa21_to_snpp`), `daynight`, `params` (JSON text, e.g. `{"k": 3.62}` or `{"a": 0.41, "b": 1.07}`), `n_obs`, `r2_cv`.

## 4. Validation · `data/validation/validation.json`

Read as-is by `GET /api/validation`.

```json
{
  "data_version": "mock-20261103",
  "metric": "detections",
  "model": "M1",
  "overlap_period": ["2012-02", "2025-12"],
  "cross_validation": "leave-one-year-out",
  "overall": { "r2": 0.0, "bias": 0.0, "mae": 0.0, "rmse": 0.0, "n": 0 },
  "by_model": [
    { "model": "M0", "r2": 0.0, "bias": 0.0, "mae": 0.0, "rmse": 0.0 },
    { "model": "M1", "r2": 0.0, "bias": 0.0, "mae": 0.0, "rmse": 0.0 },
    { "model": "M2", "r2": 0.0, "bias": 0.0, "mae": 0.0, "rmse": 0.0 }
  ],
  "break_test": {
    "raw_ratio_after_vs_before_2012": 0.0,
    "harmonized_ratio_after_vs_before_2012": 0.0,
    "pettitt_p_raw": 0.0,
    "pettitt_p_harmonized": 0.0
  },
  "series": {
    "years": [2001, 2002],
    "raw": [0, 0],
    "harmonized": [0, 0]
  },
  "scatter_sample": [[12, 41], [3, 9]],
  "strata": { "total": 0, "fallback_used": 0 }
}
```

`0.0` values above are placeholders showing types, not results. `series` is global annual totals; `scatter_sample` is up to 2 000 `[modis, viirs]` monthly cell-region pairs from the overlap period.

## 5. Calendar and stats are computed on request

The backend computes calendars and statistics from `harmonized_monthly.parquet` per request (DuckDB). Nothing per-AOI is pre-stored, except the **demo-region cache** below.

One exception reads the clean points: for a **partial current month** (`api.md` §2.4), each past year's value is scaled by the share of that month's filtered detections in the AOI that fell on days 1..`days_observed`, counted from the clean points of that view's reference platform. Without points for that month, the share is `days_observed / days in month`.

**Demo-region cache** · `data/cache/{region_id}.json`: the full responses of `/api/calendar`, `/api/stats` (every month) and `/api/hotspots` for each demo region, so the frontend can fall back to static files when the backend is down (`PLAN.md` §14.4). Same JSON shapes as `api.md`.

## Changelog

- 1.0.1 (2026-11-03): `fire_days` is the larger of day and night, not their sum; zero MODIS maps to zero; `filled_noaa21` origin and `noaa21_to_snpp` step; how a partial current month is compared (§5).
- 1.0 (2026-11-01): first version.
