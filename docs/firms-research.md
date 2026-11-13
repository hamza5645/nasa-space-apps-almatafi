# What the real FIRMS files look like

Checked Nov 3, 2026, from FIRMS's own pages and real output shown in its API tutorial. No data was downloaded. Use this for R1 (download), R2 (contract surprises) and R4 (`/nrt`).

## Sources

| What | Where |
|---|---|
| Area API docs | https://firms.modaps.eosdis.nasa.gov/api/area/ |
| API tutorial with real output tables | https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html |
| Archive download page (temporal coverage) | https://firms.modaps.eosdis.nasa.gov/download/ |
| Yearly country files | `https://firms.modaps.eosdis.nasa.gov/data/country/{product}/{year}/{product}_{year}_{Country}.csv`, zips at `…/data/country/zips/{product}_{year}_all_countries.zip` (from public scripts on GitHub that use them, e.g. ClickHouse/adsb.exposed `prepare-firms.sh`) |

## API

- Area: `/api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north | world}/{DAY_RANGE}[/{YYYY-MM-DD}]`. Without a date it returns today back to today − (DAY_RANGE − 1); with a date, DATE … DATE + DAY_RANGE − 1.
- Country: `/api/country/csv/{MAP_KEY}/{SOURCE}/{ISO3}/{DAY_RANGE}[/{DATE}]`. Adds a first column `country_id`.
- `SOURCE`: `MODIS_NRT`, `MODIS_SP`, `VIIRS_SNPP_NRT`, `VIIRS_SNPP_SP`, `VIIRS_NOAA20_NRT`, `VIIRS_NOAA20_SP`, `VIIRS_NOAA21_NRT`, `VIIRS_NOAA21_SP`, `LANDSAT_NRT` (US/Canada only).
- **`DAY_RANGE` is 1 to 5** now (PLAN.md §7 still says 1–10 for `/nrt`).
- Limit: **5,000 transactions per 10 minutes per MAP_KEY**; a multi-day request can count as several.
- `/mapserver/mapkey_status/?MAP_KEY=…` returns JSON `{transaction_limit, current_transactions, transaction_interval}`.
- `/api/data_availability/csv/{MAP_KEY}/all` returns `data_id,min_date,max_date`. Example from the tutorial (Jun 2025): `MODIS_SP` 2000-11-01 → 2025-01-31, `MODIS_NRT` 2025-02-01 → 2025-06-06, `VIIRS_SNPP_SP` 2012-01-20 → 2025-02-28. So standard processing ends about 4 months before today, and NRT covers the rest.

## Columns and values seen in real output

VIIRS NOAA-20 NRT (area API), 14 columns, no `type`:

```
latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight
-16.28359,29.40531,295.78,0.50,0.66,2025-06-06,1,N20,VIIRS,n,2.0NRT,284.11,1.17,N
```

MODIS NRT (country API), with `country_id` first and no `type`:

```
country_id,latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight
PER,-6.99466,-76.58813,311.65,1.03,1.02,2025-06-03,236,Terra,MODIS,83,6.1NRT,292.65,10.58,N
```

- `acq_time` is an unpadded number (`1` = 00:01, `236` = 02:36). Our parser already zero-pads.
- `satellite`: `Terra`, `Aqua`, `N`, `N20`, `N21` (older files also use `1` for NOAA-20).
- VIIRS `confidence`: `l` / `n` / `h`. MODIS: 0–100.
- `version`: `6.1NRT` and `2.0NRT` for NRT; standard VIIRS files say `2` (VIIRS C2). Standard MODIS files say `6.2`, not `6.1`: real 2010 yearly country files for Egypt, Argentina and Chile, checked Nov 3 (`docs/reviews/pr-08-h1-align.md`).
- Yearly country files (standard processing) have the archive's 15 columns, **with `type`**.
- Lat/lon have 5 decimals in API output; brightness, scan, track and FRP 2.

## Temporal coverage (download page)

MODIS C6.1 from 2000-11-01 · VIIRS S-NPP from 2012-01-20 · NOAA-20 from 2018-04-01 · **NOAA-21 from 2023-03-01** (we had 04-01; fixed in X4).

## What this changed in our code (X4)

- The mock now writes one folder per FIRMS product (`modis`, `viirs-snpp`, `viirs-noaa20`, `viirs-noaa21`), and the last 4 months as NRT files with no `type` column and `NRT` versions. Río Negro Jul 2026 falls in the NRT part, just like on real data.
- New tests: NRT rows ingest with `fire_type` null; static sources in NRT months stay out of the grid through the static mask built from standard months.
- Ingest already accepted a missing `type` and extra columns like `country_id`, and already zero-padded `acq_time`; no parser change was needed.

## For the contract (1.1)

- firms-input.md §1: the area API has no `type`; the country API adds `country_id`; standard versions are `6.2` (MODIS) and `2` (VIIRS).
- firms-input.md §5: NOAA-21 starts 2023-03-01.
- api.md / PLAN §7: `/nrt` `days` is 1–5.

## Checked Nov 3, 2026 (X13)

- **NOAA-20's yearly country files are `viirs-jpss1`**, not `viirs-noaa20`: `…/data/country/viirs-jpss1/2023/viirs-jpss1_2023_Egypt.csv` answers 200, `viirs-noaa20` answers 404.
- **NOAA-21 has no country files** (`viirs-jpss2` and `viirs-noaa21` answer 404), so it comes from the API (`VIIRS_NOAA21_SP`, then `_NRT`).
- **The current year has no country files yet** (2026 answers 404, 2025 answers 200). This year's standard data comes from the API's `*_SP` sources.
- **S-NPP has stopped.** FIRMS FAQ: "Delivery of new Suomi NPP data ceases on Nov. 2, 2026", at 13:00 UTC. NOAA-20 and NOAA-21 carry VIIRS after that.
