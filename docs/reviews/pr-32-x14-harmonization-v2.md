# Review of PR #32 (X14 harmonization v2: M3 split at the MODIS floor, fitting windows, NOAA-21)

Nov 3, 2026. One review pass. I rebuilt the full mock with `scripts/build-data.sh mock` in a scratch folder and compared the harmonized Terra era against the generator's true fires. No later PR changes the pipeline.

Two fixes in this PR (`harmonize/align.py`, `harmonize/build.py`), with tests, and the demo cache rebuilt. With `main` merged in, 218 pipeline and 212 backend tests pass, and lint, typecheck, the 43 frontend tests and `next build` pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | From the PR #31 review: after S-NPP's end (Nov 2, 2026), NOAA-20 stood for a month only when it covered ≥ 90% of it. On a regional build, quiet days count as gaps (X21), so November 2026 could stand on S-NPP's last 2 days and later months on converted Aqua | **Fixed:** from S-NPP's end month (taken from `platforms.py`) on, NOAA-20 (else NOAA-21) stands for the month whenever it has data and at least S-NPP's coverage; test added (it fails on the old code). The mock ends in October 2026, so mock results don't change |
| 2 | Board item from the PR #9 review: rows filled from NOAA-20/21 recorded the chosen model (`M3`) in `model`, although `step_model` converts them with M0 | **Fixed:** they record `M0`; `test_product_rows` checks both |
| 3 | The committed demo cache (`frontend/public/cache/`) still had the raw 2012 jump from before the PR #10 fix (2.87×) | **Rebuilt** with the fixed pipeline: raw 4.6×, harmonized 1.03×; per region against the truth: raw 3.2–15.0×, harmonized 0.95–1.08× |
| 4 | X22: the automatic choice picks M3 (LOYO R² 0.976), and with M3 the Nile Delta's Terra-only months come out at 0.71 of the S-NPP-era level against the truth (Aqua era 0.93). X14's placebo break years (2005, 2007, 2017, 2020) don't look at July 2002 | Still on the Board (X22): Khalid adds a July 2002 check and scores Terra → Aqua when choosing the model |

Checked and fine:
- **Fitting windows:** Aqua → S-NPP 2012-02 to 2022-12 (before Aqua's orbit drift) and Terra → Aqua 2003–2011, as `docs/method.md` §4.2 says.
- **VIIRS → VIIRS:** these steps are always a ratio.
- **M3 climatology rows:** they're marked `climatology` and left out of the strata counts.
- **Placebo ratios:** 0.85–1.08 harmonized, so 2012 doesn't stand out.
- **Season shape:** across the switch, the correlation of month shares is 0.99.
