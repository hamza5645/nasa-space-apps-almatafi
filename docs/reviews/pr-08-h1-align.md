# Review of PR #8 (H1 overpass alignment, month origins, calibration strata)

Nov 3, 2026. One review pass, checked on the full 6-region mock, a 2-region mock (Río Negro, Nile Delta) and against the top of the stack (`hamza/i1-deploy`), where X14 (PR #32) adds NOAA-21, fitting windows and `_big` columns to `align.py`. Plus a first look at real FIRMS files.

No code changes in this PR.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Coverage counts a day as observed only if the platform had a hotspot in the build's own area, and `overlap_pairs` needs the target observed on ≥ 90% of days. Small builds therefore drop their quiet months from the fits. 2-region mock: 277 of 292 Aqua months fall below 90%; at the top of the stack the Terra→Aqua fit keeps 6 of 108 months (391 pairs), and the S-NPP months it drops average 36 detections vs 198 kept. Full mock: 90 of 108 | Board **X21** (before Nov 13). Real check: in the 2010 MODIS files for Egypt, Argentina and Chile together, Aqua has a hotspot on ≥ 97% of days in every month (Terra: one month at 87%), so the runbook's three-country build is fine. Egypt alone: 121 of 365 days, so a build of small countries (the runbook allows `COUNTRIES=…`) would be hit |
| 2 | Memory: `align` peaks at ~165 B per grid row (pandas pivot tables and five string strata columns), ~16 GB for a 10⁸-row global grid; X14 adds `_big` columns | Added to **X18** (before R3) |
| 3 | PR #1 finding #17 (January 2012) | Answered: 2012-01 is `converted_aqua`, the Aqua→S-NPP overlap starts 2012-02, raw VIIRS is null before 2012-02 |
| 4 | NOAA-21 isn't handled (data-products lists `filled_noaa21`) | Fixed later by X14 (PR #32) |
| 5 | `g-mall` last-resort stratum isn't in grid.md | Already in `contracts/CHANGES-1.1.md` (PR #20) |

Origins on both mocks are right: 18 Terra, 115 Aqua, 175 S-NPP months, and NOAA-20 fills exactly the planted July–August 2022 outage. 166 pipeline tests pass with `main` merged in.

## Real FIRMS files (most of F2)

Yearly country files from `firms.modaps.eosdis.nasa.gov/data/country/` (no key), put through `almatafi.ingest` on `main`:

| Files | Rows | Kept | Dropped |
|---|---|---|---|
| MODIS 2010: Argentina, Chile, Egypt | 71,180 | 71,180 | 0 |
| VIIRS S-NPP and NOAA-20 (`viirs-jpss1`) 2019: Egypt | 67,424 | 67,424 | 0 |

- **Columns:** exactly as `contracts/firms-input.md`, including `type`. `acq_time` is always 4 digits.
- **Satellites:** `Terra`, `Aqua`, `N`, `N20`.
- **`version`:** MODIS `6.2` (the contract's example says 6.1), VIIRS `2`. Ingest keeps it as text, so nothing breaks; add 6.2 to the 1.1 text.
- **Decimals:** MODIS coordinates up to 4, brightness/FRP/scan 1; VIIRS coordinates up to 5, FRP and brightness 2. The mock matches, except MODIS values (2 decimals, harmless).
- **NOAA-20 start:** the first row of the 2018 file is 2018-04-01, as `platforms.py` says (PR #1 finding #18). NOAA-21 has no country files (404); check its start through the API.
- **Static sources:** 70% of Egypt's 2019 VIIRS detections are type 2 (gas flares, industry). The grid keeps type 0 only, but NRT data has no type, so the static mask decides the Nile Delta live layer.
