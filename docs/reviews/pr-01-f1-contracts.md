# Review of PR #1 (F1 data and API contracts)

Nov 3, 2026. Two automated review passes over `contracts/` on `khalid/f1-data-contract`, about 28 findings in total. Each one was then checked against the code at the top of the PR stack (`khalid/x14-harmonization-v2`).

## Done

- **Fixed in the contract text (1.0.1, X15).** These are the worked-example errors and the places where the code was already right but the text was wrong or vague. See the changelog at the bottom of `api.md`, `grid.md` and `data-products.md`.
- **Real bugs, now Board tasks:**
  - **X16** Archive (SP) and NRT copies of the same hotspot both survive ingest. `pipeline/almatafi/ingest.py` only drops exact `(platform, lat, lon, acq_datetime_utc)` matches, and reprocessed archive rows differ slightly from NRT, so the overlap weeks are double-counted.
  - **X17** `data_version` is `{source}-{YYYYMMDD}` (`ingest.py`), so two builds on the same day (likely on Nov 13) share a version and cached responses can't tell them apart.

## Still to check, by the PR where the code lives

| # | Finding | Check in |
|---|---|---|
| 16 | `floor(round(x, 9))`: Python's `round` (half to even) and the usual TS `Math.round(x*1e9)/1e9` can disagree within ~1e-9 of a cell edge | **Done** in PR #2: it was the Python scalar against NumPy and TS; fixed, grid contract 1.0.2. See `pr-02-f4-cell-id.md` |
| 11 | Rows with a bad `acq_time` (HH > 23, MM > 59) are dropped but no ingest-report counter covers them | **Done** in PR #4: counted under `bad_date`. Add that sentence to firms-input 1.1 (`contracts/CHANGES-1.1.md`, PR #20) |
| **15** | `point_id` = SHA-1 of `platform\|lat\|lon\|acq_datetime_utc`, but the text formats (float repr, `Z` vs `+00:00`) aren't defined, so one hotspot can get different ids in archive, on-demand fetches, cache and exports | PR #4: pinned in `ingest.point_ids` and listed in `contracts/CHANGES-1.1.md` (PR #20); agree it there |
| 18 | Platform start dates (NOAA-20 2018-04-01, NOAA-21 2023-04-01) are hard-coded and unverified; `platform_out_of_range` drops rows outside them | NOAA-20 verified Nov 3: the first row of FIRMS's 2018 NOAA-20 country file is 2018-04-01. NOAA-21 has no country files; check it through the API on Nov 13 |
| 14 | Grid filter fixed at `confidence_class != 'low'` (MODIS ≥ 30), so the planned 30 vs 50 test can't run within the contract | PR #5: `--modis-min-confidence` runs the test, and the grid now records the threshold in its metadata. Contract text still says "not low": add to the 1.1 proposals. Check H3 in PR #10 |
| **7** | AOI cell selection switches from "centre inside" to "touches" below 4 centres, so growing an AOI slightly can lower its count | Confirmed in PR #6 (3 centres → 12 cells; 4 centres → 4). Kept as the contract rule; Board X20 shows the covered area. See `pr-06-b1-api.md` |
| 20 | Are `year_totals` / `month_medians` computed from rounded or unrounded values? Even-count medians can be fractional | Answered in PR #7: totals and medians come from the rounded matrix values (so they add up to what's shown); even-count medians are rounded half up; `/stats` uses unrounded values to 1 decimal. Add a sentence to the 1.1 proposals. See `pr-07-b2-endpoints.md` |
| **17** | January 2012 has only 11 S-NPP days (data starts 2012-01-20). Nothing says whether harmonized 2012-01 is observed S-NPP or converted Aqua; a dip right at the 2012 break would hurt the break test | Answered in PR #8: 2012-01 is `converted_aqua`, the Aqua→S-NPP overlap starts 2012-02, and raw VIIRS is null before 2012-02, so there's no S-NPP dip at the break. See `pr-08-h1-align.md` |
| R1 | GeoTIFF export sets cells whose centre is outside the AOI to nodata, so a small AOI (no centre inside) exports an all-nodata raster while the calendar uses touched cells | PR #11 B3a |
| R1 | 366-day on-demand hotspot requests need about 74 FIRMS calls (10 days per call, 2 sensors); a 500 km point radius (785 000 km²) is over the 500 000 km² hotspot limit | PR #28 X10, PR #31 X13 |
| 19 | Share link uses `point:{lat},{lon}` while bbox and centroid are lon-first | PR #24 U5 |
| R1 | Share link `poly:` keeps only the outer ring (MultiPolygons and holes are lost) and needs percent-encoding | PR #24 U5 |
| 22 | Process: PR #1 edits `PLAN.md` and `TEAM.md` although `contracts/README.md` rule 1 says contract PRs touch only `contracts/` | Decide together; harmless |

Numbers are from the second (uncapped) pass; R1 marks findings only the first pass found. Bold rows are the ones most likely to matter.
