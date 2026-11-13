# pipeline

Python package `almatafi`: FIRMS ingest, gridding, harmonization, validation.

```
uv sync
uv run pytest
uv run python -m almatafi.mock          # writes data/raw/mock/ (about 75 MB, 6 s)
uv run python -m almatafi.ingest ../data/raw/mock/modis/*.csv ../data/raw/mock/viirs-*/*.csv
                                        # → data/clean/ (GeoParquet) + data/reports/ingest_*.json
uv run python -m almatafi.grid          # → data/grid/ (monthly grid, coverage, static mask)
```

## Ingest → clean points

`python -m almatafi.ingest FILES…` reads FIRMS CSVs (archive, NRT or mock), applies `contracts/firms-input.md` and writes clean points to `data/clean/sensor=…/year=…/` as GeoParquet (`contracts/data-products.md` §1). Every run writes an ingest report saying how many rows were dropped and why.

- **Columns:** strict. A file that's neither MODIS nor VIIRS, or misses a required column, stops the run. Extra columns are allowed and listed in the report.
- **Spellings:** lenient. `T`/`aqua`/`NPP`/`N20`/`1`…, `l`/`low`/`Nominal`, `d`/`n`, unpadded times.
- **Drop reasons:** each dropped row is counted once, under the first check it fails, in the contract's order. `bad_value` (unreadable confidence, brightness, scan, track or type) is an extra key not in the contract yet.
- **Duplicates:** removed within a file and across files in the same run.
- **Re-runs:** new points are merged into the sensor/year partitions already there, so a second file for the same year (another country, satellite or the NRT tail) keeps the first one's points. A point already stored is kept once, archive copy first. To rebuild from scratch, delete `data/clean/` first (`scripts/build-data.sh` does).
- **Reading back:** `almatafi.ingest.read_clean("data/clean")` gives a DataFrame with `sensor` and `year` restored. geopandas and DuckDB read the files directly.
- **Memory:** one run holds its input in memory. For the real global archive, run one year at a time.

## Downloading real FIRMS data (from Nov 13)

`python -m almatafi.fetch` downloads into `data/raw/firms/`, one folder per product, like the mock. Formats and URLs: `docs/firms-research.md`. Built and tested against a fake FIRMS only.

```
uv run python -m almatafi.fetch countries --countries Egypt,Argentina,Chile --years 2000-2026
FIRMS_MAP_KEY=... uv run python -m almatafi.fetch nrt --bbox 29,29,33,32 --name nile-delta
FIRMS_MAP_KEY=... uv run python -m almatafi.fetch nrt --bbox world --name world   # global NRT tail
uv run python -m almatafi.ingest ../data/raw/firms/*/*.csv
```

- `countries`: yearly country files (standard processing, with `type`). No key. A country-year with no file is counted as `missing`, not an error.
- `nrt`: the months after standard processing ends, from the area API in 5-day requests. It asks `data_availability` where each product's standard data stops and starts the day after, so the two sources never overlap (their positions differ slightly, so ingest could not dedupe them).
- **Checks:** every file must have a FIRMS header and stay under 400 MB, and it's written atomically. https to `firms.modaps.eosdis.nasa.gov` only.
- **Retries:** 429 and 5xx are retried with backoff. One bad file is logged as `failed` and the run goes on; the exit code is 1 if any failed.
- **Manifest:** `manifest.json` records URL, size, rows, SHA-256 and time per file. Reruns skip what's already there.
- **Key:** the MAP_KEY is replaced by `***` in the manifest and in logs.

## Mock data (until Nov 13)

`python -m almatafi.mock` writes FIRMS CSVs that follow `contracts/firms-input.md` exactly, laid out like a real FIRMS download. Same seed, same bytes for everyone.

```
data/raw/mock/
├── modis/2000.csv … 2026.csv    Terra + Aqua, standard processing (version 6.1, with `type`)
├── modis/2026_nrt.csv           the last 4 months as NRT (version 6.1NRT, no `type` column)
├── viirs-snpp/2012.csv …        S-NPP (N); same split, NRT version 2.0NRT
├── viirs-noaa20/2018.csv …      NOAA-20 (N20)
├── viirs-noaa21/2023.csv …      NOAA-21 (N21)
├── truth/events.csv.gz          every simulated fire: region, location, start, days, peak FRP
├── truth/monthly.csv            fires started and burning days per region and month
├── messy/{modis,viirs}_2016.csv one year with known faults and odd spellings
├── messy/expected_report.json   the ingest report D2 must produce for those files
└── manifest.json                seed, end date, regions, planted events, row counts, SHA-256
```

Why the NRT tail: FIRMS replaces near real-time data with standard processing a few months later, so a download made on Nov 13 has NRT rows for the newest months, and those rows have no `type` column (no volcano or static-source label). Río Negro July 2026 lands in the NRT part, just like it will on real data, so the static-source mask built from the older standard months has to carry it.

How it works: fires are simulated first per region (season, trend, yearly noise, fire size). Each satellite then observes them at its own overpass time through shared clouds, a random viewing angle and its pixel size. MODIS misses small fires; VIIRS sees them and splits big ones into several pixels. That makes VIIRS ÷ MODIS about 3.5–4.5 in most regions and about 12 in the Nile Delta (small farm fires), which is what harmonization has to learn per stratum.

| Region | Season peak | What's planted |
|---|---|---|
| `nile-delta` | Oct–Nov (rice straw) | Oct 2026 above normal (z > 2) |
| `rio-negro` | Dec–Mar | Jul 2026 winter outbreak, far above any July |
| `amazon`, `central-africa`, `northern-australia`, `california` | various | none; for testing "anywhere" |

Also built in: 2 static industrial sources in the Delta (`type = 2`), an S-NPP outage 2022-07-26 → 2022-08-10 (NOAA-20 must fill it), unpadded `acq_time`, real platform start dates.

Options: `--seed`, `--end YYYY-MM-DD` (default 2026-10-31; future dates refused), `--regions nile-delta,rio-negro`, `--messy-year 0` to skip messy files.

## Grid

`python -m almatafi.grid` turns clean points into `contracts/data-products.md` §2, using DuckDB so it streams instead of loading everything:

- `grid_monthly.parquet`: per cell × month × platform × day/night: `detections`, `fire_days` (distinct UTC days), `frp_sum`.
  - **Kept:** MODIS confidence ≥ 30 (`--modis-min-confidence 50` to compare), VIIRS not `low`, and `type` 0 or empty.
  - **Left out:** cells in the static mask.
- `static_mask.parquet`: cells where `type = 2` appears in ≥ 6 distinct months.
- `coverage.parquet`: days each platform observed per month. A day counts when the platform has any hotspot anywhere, before filtering. That's right on the global archive. On a small area, quiet days look unobserved, so build coverage from global data (or treat `observed_days ≥ 1` as "observed").

The run report (`data/reports/grid_*.json`) says how many points each filter removed.

## Harmonization

### H1 · alignment and strata (`almatafi/harmonize/align.py`)

- **Who stands for each month** (`month_status`), from the coverage table:

  | Months | Origin |
  |---|---|
  | 2001-01 … 2002-06 | `converted_terra` |
  | 2002-07 … 2012-01 | `converted_aqua` |
  | 2012-02 onwards | `observed_snpp` |
  | S-NPP outage | `filled_noaa20` |

  NOAA-20 fills a month only when it observed ≥ 90% of the days **and** at least 15% more of them than S-NPP. A quiet day without fires isn't a gap. On the mock, this picks exactly the planted July–August 2022 outage.
- **Side by side** (`wide`): one row per cell-month with a column per platform. `detections` keeps day and night apart. `fire_days` uses each platform's best pass.
- **Strata:** every row carries its fallback chain from `grid.md` §6 (`t{tile}-m{MM}` → `t{tile}-mall` → `b{band}-m{MM}` → `g-m{MM}`), plus `g-mall` as a last resort. `assign_strata` picks the first one that has a fitted model.
- **Overlap pairs** (`overlap_pairs`): what the models learn from.

  | Step | Overlap from |
  |---|---|
  | `aqua_to_snpp` | 2012-02 |
  | `terra_to_aqua` | 2002-07 |
  | `noaa20_to_snpp` | 2018-04 |

  The target platform must have observed ≥ 90% of the month.

### H2 · conversion models and the harmonized product

```
uv run python -m almatafi.harmonize      # → data/harmonized/ + data/validation/ (15 s on the full mock)
```

- **Models** (`models.py`), fitted per stratum and pass, for every step and both metrics:

  | Model | Formula |
  |---|---|
  | M0 | ratio, `k = Σy/Σx` |
  | M1 | `log(1+y) = a + b·log(1+x)` |
  | M2 | quantile mapping (101 quantiles) |

  The source can't say where only the target saw fire, so converted values are 0 where the source saw nothing. M1 and M2 then carry a mass factor `s` so totals over the overlap match the target's.
- **Applied** (`build.py`) to whichever platform stands for each month:

  | Month | Conversion |
  |---|---|
  | S-NPP | unchanged |
  | NOAA-20 fill | NOAA-20 → S-NPP |
  | Aqua | Aqua → S-NPP |
  | Terra | Terra → Aqua → S-NPP |

  Day and night are converted separately, then summed.
- **Outputs:** `harmonized_monthly.parquet` (metadata: `covered_start`, `covered_end`, `model`, `data_version`) and `models.parquet` (every fit; `r2_cv` from leave-one-year-out for the chosen model).
- **On the mock**, against the true fires: the raw stitched series (MODIS before 2012, VIIRS after) jumps 1.9–12.6× at 2012. The harmonized series stays at 0.95–1.11× in all 6 regions.

### H3 · validation (`almatafi/harmonize/validate.py`)

`python -m almatafi.harmonize` validates first, then builds with the best model (`--model auto`, the default; or force `M0`/`M1`/`M2`). It writes `data/validation/`:

- **`validation.json`** (`data-products.md` §4, read by `GET /api/validation`):
  - leave-one-year-out on the Aqua → S-NPP overlap for each model, scored on 10° tile × month totals (what an area calendar shows);
  - the 2012 break test (mean after ÷ mean before, Pettitt p) for the raw join vs the harmonized series;
  - annual series, a scatter sample, strata counts.
  - Additions: `by_metric.fire_days`, and on mock data `mock_truth`, the 2012 jump per region measured against the true fires.
- **Charts:** `series.png`, `scatter.png`, `models.png`, `residual_map.png`.
- **`validation.md`:** a short report; R6 turns the real-data version into `docs/validation.md`.

On the full mock:

| Model | Held-out R² |
|---|---|
| **M0 (chosen)** | **0.976** |
| M2 | 0.971 |
| M1 | 0.966 |

The 2012 jump against the true fires is 3.2–14.8× for the raw join (Aqua from July 2002, Terra before, like the app's raw MODIS view) and 0.97–1.02× harmonized. Over all cells: raw 4.6×, harmonized 1.03×.
