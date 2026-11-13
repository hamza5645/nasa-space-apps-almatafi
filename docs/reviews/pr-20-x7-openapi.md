# Review of PR #20 (X7 OpenAPI snapshot and contract 1.1 proposals)

Nov 3, 2026. One review pass. I checked `contracts/CHANGES-1.1.md` against what the PR #1–#19 reviews found and fixed, and checked that the OpenAPI snapshot still matches the backend with today's review fixes merged in. I also compared with the top of the stack, where X13 and X14 add their own 1.1 items.

One change in this PR (`contracts/CHANGES-1.1.md`). With `main` merged in, the OpenAPI snapshot test and all 197 backend tests pass. Today's backend fixes (export cap, search names and bbox, simplification) don't change any request or response shape.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The 1.1 list said standard MODIS files have version `6.1`. Real 2010 country files say `6.2` | **Fixed** |
| 2 | The 1.1 list said GeoTIFF exports go up to 30M pixels; the PR #11 review lowered that to 10M | **Fixed** |
| 3 | Seven items from the PR #1–#19 reviews were waiting for this list (Board, open items): `bad_value` covers `instrument`; a bad `acq_time` counts as `bad_date`; the grid's MODIS confidence threshold and its metadata; calendar rounding; error codes 413 and 500 (X19); the covered area for small AOIs (X20); `/search`'s English names and crossing bbox | **Added** as a new section at the end, so the X13/X14 items later PRs add merge cleanly |

Checked and fine:
- **Snapshot:** `openapi.json` is generated from the app with the FIRMS key off, and the staleness test lists every endpoint.
- **Accuracy:** the rest of the 1.1 list matches the code (`/nrt` fields and errors, `point_id`, `acq_datetime_utc` in ms, `models.parquet`'s `metric`, the harmonized file's metadata, fallback strata, the WGS84 cell area, raw `fire_days`, `origin`, partial months, sd = 0, the export and admin caps).

Nothing in `CHANGES-1.1.md` is agreed yet: Khalid and Hamza go through it together (TEAM.md rule 5).
