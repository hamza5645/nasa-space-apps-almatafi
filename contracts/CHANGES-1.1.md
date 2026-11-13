# Proposed contract 1.1

Everything the code does that the 1.0 contracts (PR #1) don't say, or say differently. Collected from the TEAM.md log and code comments, Nov 3. **Nothing here is agreed yet** (TEAM.md rule 5): go through it together, tick what you accept, then fold it into the contract files and bump them to 1.1.

`contracts/openapi.json` is the exact shape of every request and response today. It is generated from the backend (`cd backend && python -m app.openapi`), and a test fails when it is out of date.

## firms-input.md

- [ ] **NRT files have no `type` column.** That covers the area API and the NRT part of an archive download. The country API adds a first column `country_id`. Ingest already accepts both. (docs/firms-research.md)
- [ ] **Version strings.** Standard: `6.2` (MODIS: real 2010 country files for Egypt, Argentina and Chile; `docs/reviews/pr-08-h1-align.md`), `2` (VIIRS). NRT: `6.1NRT`, `2.0NRT`.
- [ ] **NOAA-21 starts 2023-03-01**, not 04-01, per the FIRMS download page.
- [ ] **New drop key `bad_value`.** It covers unreadable confidence, brightness, scan, track or type, and is checked after `platform_out_of_range`, before `duplicate`.
- [ ] **Run IDs in a clash.** When two ingest runs start in the same second, the second report gets a `-2` suffix.

## data-products.md

- [ ] **`acq_datetime_utc` is `timestamp[ms, UTC]`,** not `[s]`: Parquet has no seconds unit. Values are still whole seconds.
- [ ] **`point_id` format.** The first 16 hex characters of SHA-1 of `platform|lat|lon|acq_datetime_utc`, with lat/lon as Python's shortest float text and the time as ISO 8601 with `Z`. The live `/nrt` points use the same ids.
- [ ] **`models.parquet` gets a `metric` column** (`detections` / `fire_days`), because each metric has its own fit.
- [ ] **`harmonized_monthly.parquet` metadata.** `covered_start`, `covered_end` (`YYYY-MM`), `model`, `data_version`.
- [ ] **`validation.json` additions.** `unit_of_scoring` (tile × month totals), `by_metric`, and `mock_truth` (mock runs only).

## grid.md

- [ ] **Last fallback stratum.** After `g-m{MM}` comes `g-mall` (global, all months).
- [ ] **Coverage comes from detections.** A platform observed a day when it has any hotspot anywhere. That's right on the global archive and wrong on small areas, so R3 must build coverage from global data.
- [ ] **AOI areas use the WGS84 ellipsoid.** An equator cell is 123.09 km², against 123.64 km² on grid.md's sphere (0.4%).

## grid.md / data-products.md

- [ ] **Static mask (X13).** Built from types 1, 2 and 3: type 2 in ≥ 6 months, or types 1/3 in ≥ 2 months. NRT and API rows have no `type`, so the mask is what keeps volcanoes and offshore flares out of those months.
- [ ] **S-NPP has stopped (X13).** FIRMS: delivery of new S-NPP data ceased on Nov. 2, 2026. `platforms.py` records the end date.

- [ ] **Grid (X14).** `grid_monthly` adds `detections_big` and `fire_days_big`: the part MODIS could have seen. VIIRS fire clusters (same satellite, overpass minute and 0.02° box) at or above MODIS's FRP floor, 4.44A + 0.52 MW by day and 4.43A + 1.01 MW by night (A = median MODIS pixel area). For MODIS rows they equal `detections` and `fire_days`. The grid report gives the floor used.
- [ ] **Harmonization v2 (X14).**
  - New model M3, "split": k × MODIS + small(c, m) × r (docs/method.md §4.5).
  - New step `noaa21_to_snpp` and origin `filled_noaa21`. VIIRS → VIIRS steps are always M0.
  - Fitting windows: Aqua → S-NPP 2012-02 to 2022-12, Terra → Aqua 2003 to 2011.
  - `stratum_id = "climatology"` marks M3 rows with no detection at all that month.
- [ ] **validation.json (X14).** `by_model[].r2_1deg`, `break_test.placebo_ratios_harmonized` and `season_check`. `overlap_period` is now the Aqua → S-NPP fitting window.

## api.md

- [ ] **`/nrt`:**
  - `days` stays 1–10; FIRMS allows 5 per request, so the backend splits.
  - New fields `include_filtered` and `limit`, as in `/hotspots`.
  - The response adds `source: "nrt"` and `meta.fetched_at`.
  - Errors: 503 `upstream_busy` when our transaction budget is spent; 502 `upstream_error` on FIRMS failures.
- [ ] **Raw `fire_days`.** Fire days can't be added across platforms, so each cell takes its best platform and pass: a lower bound.
- [ ] **Harmonized `origin` per month.** The origin carrying most of the value in the AOI. With no rows, it follows the era: Terra before 2002-07, Aqua before 2012-02, S-NPP after.
- [ ] **Partial current month.** `days_observed` is the last UTC day with any hotspot. Past years are scaled by their own share of filtered detections on days 1..N.
- [ ] **Status when the baseline sd is 0.** `z` is `null`, and `status` compares the value with the mean.
- [ ] **Export caps:**
  - GeoTIFF ≤ 10M pixels (lowered in the PR #11 review: 30M took +640 MB on an API capped at 1 GB); CSV ≤ 5M rows.
  - ≤ 200k points in a hotspot export; ≤ 120 bands.
  - The GeoTIFF refuses AOIs crossing 180°: export each side.
- [ ] **`/search`.** Polygons are simplified to ≤ 2,000 vertices; failures are 502.
- [ ] **`/admin`.** It downloads only from geoBoundaries/GitHub hosts and is capped at 60 MB per file.
- [ ] **Raw views use one platform per month (X13).** Raw MODIS is Aqua, or Terra before 2002-07; raw VIIRS is S-NPP, or NOAA-20 after S-NPP's last full month (2026-10). Adding Terra to Aqua doubled the series when Aqua started. The `unit` strings say so.
- [ ] **Harmonized months nobody observed are `null` (X13).** `harmonized_monthly.parquet` carries `month_origins` in its metadata (month → origin, `null` = no platform); the backend returns `null` for those months and `/stats` refuses them.
- [ ] **`/hotspots` platforms (X13).** New `platforms` filter (null = all) and `by_platform` counts (before that filter), so a client can show the one satellite the calendar counts.
- [ ] **No status on a short baseline (X13).** With fewer than 3 baseline years, `status` is `null`.
- [ ] **AOI polygons (X13).** An edge longer than 180° of longitude is read as crossing 180°; send shapes wider than that with extra vertices (the explorer does). Holes are shifted by whole turns to sit on their shell.
- [ ] **`/nrt` and on-demand hotspots (X13).** Each FIRMS source switches from standard to NRT at its own last standard day, and S-NPP is not asked for after Nov 2, 2026.

## PLAN.md (not a contract, but out of date)

- §7 `/nrt` says "days (1–10)": still true for our API; FIRMS's own limit is 5.
- §10 Phase 6: the Cairo final submission is a **30-second video or exactly 7 slides**, with no live pitch (docs/registration.md).
- §11: the mock lives in `pipeline/almatafi/mock/`, the downloader in `pipeline/almatafi/fetch.py`.

## From the PR #1–#19 reviews (Hamza, Nov 3)

Details in `docs/reviews/`.

- [ ] **firms-input.md: `bad_value` also covers `instrument`.** A value that doesn't match the file's sensor is dropped as `bad_value` (PR #4 review).
- [ ] **firms-input.md: a bad `acq_time` counts as `bad_date`.** HH > 23 or MM > 59 drops the row under `bad_date` (PR #1 finding #11).
- [ ] **grid.md: the MODIS confidence threshold.** The grid keeps MODIS rows at confidence ≥ 30 by default (`--modis-min-confidence`, PLAN §5.2's 30 vs 50) and records it as `modis_min_confidence` in `grid_monthly.parquet`'s metadata (PR #5 review). The contract only says "not low".
- [ ] **api.md: calendar rounding.** `year_totals` and `month_medians` come from the rounded matrix values, so they add up to what's shown; even-count medians round half up; `/stats` uses unrounded values to 1 decimal (PR #7 review).
- [ ] **api.md: error codes 413 and 500.** 413 for a body over the size limit, and 500 for a crash, returned as `{"error": …}` with CORS headers (X19, PR #6 review).
- [ ] **api.md: small areas show what they cover.** Below 4 cell centres every touched cell counts, so `meta.aoi` should give the covered cells' area too (X20).
- [ ] **api.md: `/search`.** Names are in English (`accept-language=en`). A place in parts on both sides of 180° gets the small bbox that crosses it (west > east, as RFC 7946 allows) instead of Nominatim's world-wide one (PR #12 review).

## From X27 (FIRMS gaps, Khalid with Claude, Nov 13)

Additive only: every new field is optional, and clients that ignore it see 1.0 responses.

- [ ] **data-products.md: `clouds/cloud_monthly.parquet`.** `cmg_id` (int32, 0.5° cell: `((cell_id // 3600) // 5) * 720 + (cell_id % 3600) // 5`), `year`, `month`, `platform` (Terra|Aqua), `cloud_fraction` (float32, 0–1); metadata `source` (`mock` until MOD14CMH/MYD14CMH are read), `generated_utc`, `clear_min`. Bundles may carry `clouds/`; without it the backend drops its built-in copy.
- [ ] **api.md: `clouds` on `/calendar` and `/stats`.** `"off"` (default) or `"correct"`: harmonized detections ÷ max(1 − cloud fraction, 0.2) per cell (Aqua's cloud, Terra's before 2002-07). 422 for raw views and fire days, 503 `data_unavailable` (`dataset: clouds`) without a cloud product. `unit` gains ", corrected for cloud cover".
- [ ] **api.md: cloud fields in responses.** With a cloud product, `/calendar` adds `cloud` (matrix like `matrix`, the area's mean cloud fraction, 2 decimals, `null` where unknown) and `clouds` (`{mode, source, cloudy_from, note}`); `/stats` adds `cloud_fraction` and `clouds`.
- [ ] **api.md: `/export` hotspots as `kml`.** One placemark per hotspot with its approximate pixel footprint (scan × track km), FRP colour classes, one folder per satellite.
- [ ] **api.md: `POST /api/alerts/preview`.** Body `{aoi, name?, threshold: above_normal|unusual_high, clouds?}`; returns the month checked (this month so far, else last month), `triggered`, `status`, `value`, `z`, `partial`, `email {subject, text, html}` (every value escaped), `sent: false`. Takes no email address, stores nothing.
- [ ] **data-products.md §5 (cache): `calendar_clouds` and `stats_clouds`** in each region file when the backend has a cloud product.
