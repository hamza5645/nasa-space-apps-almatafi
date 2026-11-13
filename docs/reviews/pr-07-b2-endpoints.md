# Review of PR #7 (B2 /calendar, /stats, /hotspots)

Nov 3, 2026. One review pass (9 findings), checked on a two-region mock (Río Negro, Nile Delta; full to Oct 31, and a partial one to Oct 15) and against the top of the stack (`hamza/i1-deploy`). X13 (PR #31) later changes `series.py` and `analytics.py`; X6/X10 restructure `/hotspots`.

No code changes in this PR.

| # | Finding | Outcome |
|---|---|---|
| 1 | `/stats` gives a status with 1–2 baseline years (1 year: `unusual_high`); api.md §2.4 says `null` below 3 | Fixed later by X13 (`MIN_BASELINE_YEARS`) |
| 2 | Raw MODIS adds Terra and Aqua, so the series doubles when Aqua starts (Río Negro: 227 in 2001, 570 in 2004); api.md §1.2 says one platform per month | Fixed later by X13 (one reference platform per month) |
| 3 | The calendar counts S-NPP, `/hotspots` every VIIRS satellite: Nile Delta Oct 2026 is 579 vs 1,705 | Fixed later by X13 (`platforms` filter, `by_platform`). Check the frontend uses it (UI PRs) |
| 4 | The hotspot filter and the partial-month share use MODIS confidence ≥ 30, not the threshold the grid records (`modis_min_confidence`). With a grid built at 50: calendar 27, hotspots 52 | Board (after the stack merges): read it from the grid's metadata. `/nrt` (X6) has the same constant |
| 5 | Data paths are pasted into the SQL (the PR #5 pattern): a `'` in the data folder gives 500 on every endpoint | Board (after the stack merges): later PRs add more of these. Only the operator picks the folder |
| 6 | PR #1 finding #20: totals and medians come from the rounded matrix, so they add up to what's shown; even-count medians are rounded half up; `/stats` uses unrounded values to 1 decimal | Answered; one sentence for the 1.1 proposals |
| 7 | Speed at global scale | Fine: on a synthetic 100M-row grid (sorted like the real one) the calendar query takes 0.6–0.7 s on one CPU (0.3 s on 4), for both the Nile Delta and a 5M km² box |
| 8 | Partial month | Works: with data to Oct 15, 15 days of 2026 are compared with days 1–15 of past years (z 6.0 vs 5.7 for the full month) |
| 9 | `/hotspots` reads up to 1M points into memory to count them; the October median includes the current partial month | Kept: points are stored for the demo regions only; the contract says medians use every year with a value |

The choices the contract leaves open (raw fire days, origin per month, partial months, sd = 0) are already in `contracts/CHANGES-1.1.md` (PR #20).
