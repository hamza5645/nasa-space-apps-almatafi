# FIRMS input contract

Version 1.0.1 · 2026-11-03

What the pipeline reads from NASA FIRMS, and how every raw value is normalised. The mock generator (`pipeline/almatafi/mock/`, run `python -m almatafi.mock`) must write files that pass this exact parser.

> Written from the FIRMS documentation, not checked against a real file yet. On the first real download, compare every column and enum below and fix this file (bump to 1.1). The parser must be strict about columns and lenient about enum spellings, because FIRMS archive, NRT and API files spell some values differently.

## 1. Files we accept

| Source | Sensor | Format | Notes |
|---|---|---|---|
| FIRMS archive download (standard processing) | MODIS C6.1, VIIRS 375 m | CSV | Has the `type` column |
| FIRMS yearly country files | MODIS C6.1, VIIRS 375 m | CSV | Same columns as archive |
| FIRMS area API, NRT (`/api/area/csv/...`) | MODIS, VIIRS | CSV | No `type` column |
| Mock generator | both | CSV | Must match the archive layout, including `type` |

One file holds one sensor. The parser detects the sensor from the header (`brightness` → MODIS, `bright_ti4` → VIIRS) and refuses files that match neither.

## 2. MODIS C6.1 columns

| Column | Type | Unit / values | Required |
|---|---|---|---|
| `latitude` | float | degrees, −90..90 | yes |
| `longitude` | float | degrees, −180..180 | yes |
| `brightness` | float | K, channel 21/22 brightness temperature | yes |
| `scan` | float | km, pixel size along scan (≥ 1.0) | yes |
| `track` | float | km, pixel size along track (≥ 1.0) | yes |
| `acq_date` | string | `YYYY-MM-DD`, UTC | yes |
| `acq_time` | string or int | `HHMM` UTC; may arrive unpadded (`5` = 00:05, `130` = 01:30) | yes |
| `satellite` | string | see §4 | yes |
| `instrument` | string | `MODIS` | yes |
| `confidence` | int | 0–100 | yes |
| `version` | string | e.g. `6.1`, `6.03`, `6.1NRT`; kept as text | yes |
| `bright_t31` | float | K, channel 31 | yes |
| `frp` | float | MW, fire radiative power | yes |
| `daynight` | string | `D` or `N` | yes |
| `type` | int | 0 vegetation fire, 1 active volcano, 2 other static land source, 3 offshore | archive only |

## 3. VIIRS 375 m columns

Same as MODIS except:

| Column | Type | Unit / values | Replaces |
|---|---|---|---|
| `bright_ti4` | float | K, I-4 channel | `brightness` |
| `bright_ti5` | float | K, I-5 channel | `bright_t31` |
| `confidence` | string | `l`/`n`/`h` or `low`/`nominal`/`high` | MODIS 0–100 |
| `scan`, `track` | float | km, ≥ 0.375 | |
| `instrument` | string | `VIIRS` | |

## 4. Normalisation rules

### 4.1 Platform (`satellite` → `platform`)

| Raw values (case-insensitive, trimmed) | `platform` | Sensor |
|---|---|---|
| `Terra`, `T` | `Terra` | MODIS |
| `Aqua`, `A` | `Aqua` | MODIS |
| `N`, `NPP`, `SNPP`, `Suomi NPP`, `Suomi-NPP` | `SNPP` | VIIRS |
| `N20`, `1`, `J1`, `NOAA-20`, `NOAA20` | `NOAA20` | VIIRS |
| `N21`, `2`, `J2`, `NOAA-21`, `NOAA21` | `NOAA21` | VIIRS |

Anything else: drop the row and count it in the ingest report under `unknown_platform`.

### 4.2 Confidence (`confidence` → `confidence_class`)

| Sensor | Raw | `confidence_class` |
|---|---|---|
| MODIS | 0–29 | `low` |
| MODIS | 30–79 | `nominal` |
| MODIS | 80–100 | `high` |
| VIIRS | `l`, `low` | `low` |
| VIIRS | `n`, `nominal` | `nominal` |
| VIIRS | `h`, `high` | `high` |

The original MODIS number is also kept as `confidence_pct` (null for VIIRS).

### 4.3 Time

- `acq_time` → zero-pad to 4 digits → `HH:MM`.
- `acq_datetime_utc` = `acq_date` + `acq_time`, timezone UTC.
- Reject rows where HH > 23 or MM > 59.

### 4.4 Validity checks (row dropped and counted if any fails)

| Check | Report key |
|---|---|
| `latitude` in −90..90 and `longitude` in −180..180 | `bad_coords` |
| `acq_date` parses and is not in the future | `bad_date` |
| `frp` ≥ 0 (missing `frp` is allowed and stored as null) | `bad_frp` |
| `daynight` is `D` or `N` | `bad_daynight` |
| Platform active on that date (§5) | `platform_out_of_range` |
| Exact duplicate of (`platform`, `latitude`, `longitude`, `acq_datetime_utc`) | `duplicate` |

### 4.5 Ingest report

Every ingest run writes `data/reports/ingest_<run_id>.json`:

```json
{
  "run_id": "2026-11-13T09-12-00Z",
  "files": ["data/raw/modis/2024_EGY.csv"],
  "rows_read": 120334,
  "rows_kept": 118902,
  "dropped": { "unknown_platform": 0, "bad_coords": 0, "bad_date": 3, "bad_frp": 0,
               "bad_daynight": 0, "platform_out_of_range": 0, "duplicate": 1429 },
  "by_platform": { "Terra": 51022, "Aqua": 67880 }
}
```

## 5. Platform timelines

Used for the `platform_out_of_range` check and by the mock generator.

| Platform | Sensor | Data from | Overpass (local solar time, approx.) |
|---|---|---|---|
| Terra | MODIS | 2000-11-01 | 10:30 / 22:30 |
| Aqua | MODIS | 2002-07-04 | 13:30 / 01:30 |
| SNPP | VIIRS | 2012-01-20 | 13:30 / 01:30 |
| NOAA20 | VIIRS | 2018-04-01 | 13:30 / 01:30 (about 50 min after SNPP) |
| NOAA21 | VIIRS | 2023-04-01 | 13:30 / 01:30 |

Dates are the start of usable FIRMS records as we understand them; check on the first real download.

## Changelog

- 1.0.1 (2026-11-03): mock generator path is `pipeline/almatafi/mock/` (text only).
- 1.0 (2026-11-01): first version.
