# Review of PR #9 (H2 conversion models and the harmonized product)

Nov 3, 2026. One review pass, checked on the full 6-region mock against the generator's true fires (`raw/truth/monthly.csv`), with PR #9's code and with the top of the stack (`hamza/i1-deploy`, built with `scripts/build-data.sh mock`), where H3 picks the model automatically and X14 adds M3 and fitting windows.

No code changes in this PR. 180 pipeline tests pass with `main` merged in.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The Terra-only months (2001-01 → 2002-06) are far too low where Terra sees little (table below). The series steps up in July 2002, when Aqua starts. Tests and H3's break test only look at the 2012 break, from 2003 on | Board **X22** (before Nov 13) |
| 2 | A month in the middle of the record that no platform observed reads as 0, not null | Fixed later by X13 (`month_origins` in the product's metadata) |
| 3 | At the top of the stack, rows filled from NOAA-20/21 record the chosen model (`M3`) in `model`, although X14 converts them with M0 | Board (open items): check at the PR #32 review |
| 4 | Memory: `apply` and `harmonize` build the same pandas tables as H1 | Covered by X18 |

Checked and fine: S-NPP months pass through unchanged; the mass factor makes M1/M2 totals equal the target's over the overlap; leave-one-year-out never fits on its own year; `fire_days` is capped at the month's length; `covered_start` / `covered_end` match what the backend reads; the 2012 break is level against the truth in all 6 regions.

## The Terra-only months

Harmonized level against the true fire-days, per era, relative to the S-NPP era (1.0 = as level as after 2012):

| Region | PR #9 M1 (default) Terra / Aqua | PR #9 M0 | PR #9 M2 | Top of stack M3 (auto) | Top of stack M1 | Top of stack M0 |
|---|---|---|---|---|---|---|
| Nile Delta | **0.52** / 0.94 | 0.95 / 1.00 | 0.93 / 1.00 | **0.71** / 0.93 | 0.66 / 0.95 | 0.73 / 0.97 |
| Río Negro | 1.12 / 1.05 | 1.10 / 1.02 | 1.36 / 1.02 | 1.11 / 1.00 | 1.09 / 1.04 | 1.08 / 1.00 |
| Amazon | 0.95 / 0.96 | 0.93 / 0.96 | 1.04 / 0.97 | 0.94 / 0.97 | 0.98 / 0.96 | 0.94 / 0.97 |

(PR #9's M0 and M2 numbers come from its own grid; the top of the stack uses X4's mock and X14's grid, so the columns aren't directly comparable across code versions.)

Month by month at the top of the stack, the Delta's Terra months range from 0.2× to 3× of the Aqua years' level for the same calendar month (Nov 2001: 105 harmonized vs 1,055 true fire-days; Oct 2001: 259 vs 989).

**Cause:** Terra sees 0–4 hotspots a month in the Delta (Nov 2001: 2). Delta fires burn in the afternoon, after Terra's 10:30 pass, so in the Delta tile Aqua sees 3.77× what Terra sees, against 1.54× over all pairs. With so few Terra detections, the conversion is mostly noise; a better model can't recover it. Real Egypt MODIS data is as sparse (PR #8 notes: Aqua had a hotspot in Egypt on 121 of 365 days in 2010).

**What to do (X22):**
- Validation (Khalid, X14 code): a July 2002 break check next to the 2012 one, per region and globally.
- Calendar (Hamza): show `converted_terra` months as less certain; `/calendar` already returns `origin`.
- Method page (both): list it under limitations.
- Maybe a 1.1 proposal: the default `/stats` baseline starts in 2002-07, so 2001 doesn't sit in every baseline.
