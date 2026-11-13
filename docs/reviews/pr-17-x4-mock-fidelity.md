# Review of PR #17 (X4 mock fidelity: real FIRMS layout, NRT tail, NOAA-21 start)

Nov 3, 2026. One review pass. I built PR #17's full mock, ingested and gridded it, and compared that with the grid from before X4. I checked `docs/firms-research.md` against the real FIRMS files from the PR #8 review, and compared with the top of the stack.

One fix in this PR (`docs/firms-research.md`). With `main` merged in, 194 pipeline and 181 backend tests pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | `firms-research.md` says standard MODIS files have `version` `6.1`. The real 2010 yearly country files (Egypt, Argentina, Chile; PR #8 review) say `6.2` | **Fixed** in both places it's said; already on the Board's 1.1 list |
| 2 | The mock's standard and NRT files never overlap: standard ends where NRT begins. A real download overlaps by days to weeks, and X16 (both copies of a hotspot survive ingest) only shows up then, so the mock can't catch X16 | Board: added to X16. When fixing it, give the mock an overlap week |

Checked on the full mock:
- **NRT tail:** 63 files, one folder per product; the last 4 months (2026-07 → 10) are `{year}_nrt.csv` with `6.1NRT` / `2.0NRT` and no `type` column.
- **Ingest and grid:** all 875,820 rows ingest (NRT rows get `fire_type` null), and the grid leaves out 1,260 points in the same 4 static cells as before.
- **Static mask in NRT months:** Nile Delta S-NPP detections in the NRT months are within noise of the pre-X4 build (Jul–Oct 2026: 60, 49, 85, 589 vs 65, 42, 80, 579), so static sources stay out without `type`.
- **Year-to-year size:** 2026 is about 3× 2025 in the Delta all year, but the mock's true fires are too (e.g. May: 213 vs 85 fire-days), so that's the generator's yearly noise, not the pipeline.
- **NOAA-21:** it starts 2023-03-01, as on FIRMS's download page.
- **Docker:** the image's ingest step follows the new `viirs-*` folders.
