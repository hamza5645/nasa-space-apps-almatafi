# Review of PR #10 (H3 validation and automatic model choice)

Nov 3, 2026. One review pass. Checked on the full 6-region mock (78,136 cell-months) against the generator's true fires, with PR #10's code, and compared with the top of the stack (`hamza/i1-deploy`), where X14 adds placebo years, a season check and 1° scores to the same file.

One fix in this PR (`validate.py`), with tests. 190 pipeline and 98 backend tests pass with `main` merged in.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The break test's raw join added Terra and Aqua together, so 2002-07 → 2011 counted both satellites. The app's raw MODIS view shows Aqua (Terra before July 2002), so the published raw jump didn't match what users see and understated it: 2.9× over all cells, against 4.6× with the app's rule; against the true fires 1.7–11.6× per region, against 3.2–14.8×. The raw series also doubled in July 2002 | **Fixed:** `annual_series` uses `align.AQUA_FIRST` like the backend; test added; README numbers updated. The Method and landing pages (later PRs) show this number from `validation.json`; the copy cached in `frontend/public/cache/` says 2.87× until `scripts/build-data.sh` runs again |
| 2 | `choose_model` treated an R² of exactly 0 as missing (`r2 or -inf`) | **Fixed** (edge case); test added |
| 3 | The model is picked only on Aqua → S-NPP, but the same model also converts Terra → Aqua, and how good the Terra months are depends a lot on the model (table below). Nothing scores the Terra era | Board **X22** updated: also score Terra → Aqua, or the Terra-era level, when choosing |
| 4 | The truth check starts in 2003 and the break test only looks at 2012, so the July 2002 step can't show up | Already in X22 (Khalid: a July 2002 check) |
| 5 | Run time: leave-one-year-out takes ~40 s of the 65 s full-mock run here (one CPU): 3 models × 2 metrics. It also runs when `--model` is forced, and the `fire_days` pass fits all 3 models to report one. The README says 15 s | Added to **X18** (time it on the Nov 13 build before R3) |
| 6 | `last_year` is the newest year in the data minus 1, so a build that ends in December leaves out its last full year | Not fixed: the Nov 13 data ends in November, so it doesn't matter yet |

Checked and fine:
- the Pettitt p-value formula (the usual approximation; a step gives p < 0.05, noise gives p > 0.5);
- `validation.json` has every key in `data-products.md` §4 and no NaN;
- each held-out year is never in its own fit;
- on a tie the simpler model wins;
- the truth check uses cell centres correctly and is skipped on real data;
- all 4 charts and `validation.md` are written;
- the 2012 break against the truth is 0.97–1.02× in all 6 regions;
- Pettitt p is 0.0003 for the raw join and 0.85 harmonized.

## The model choice and the Terra months

Held-out R² on 10° tile × month totals, full mock:

| Step | M0 | M1 | M2 |
|---|---|---|---|
| Aqua → S-NPP (what PR #10 scores) | **0.976** | 0.966 | 0.971 |
| Terra → Aqua (not scored) | **0.943** | 0.941 | 0.932 |

Here both steps rank M0 first, and PR #10 picks M0. With M0 the Nile Delta's Terra months (2001-01 → 2002-06) come out at 0.95 of the S-NPP-era level against the truth, against 0.52 with PR #9's default M1. But month by month it's still unreliable: 9 of the 18 Terra months are 0, and the others range up to 5× the truth (median 0.34×). At the top of the stack the automatic choice picks X14's M3, and the Delta's Terra months drop to 0.71. That's why X22 now says: also score the Terra step when choosing, and mark the Terra months as less certain in the calendar whatever the model.
