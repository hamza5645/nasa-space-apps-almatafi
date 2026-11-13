# Review of PR #30 (X12 explorer redesign: answer first, calendar beside the map)

Nov 3, 2026. One review pass. I ran the redesigned explorer in headless Chromium against the backend on the full mock (1440 px and 390 px) and compared with the top of the stack (`hamza/i1-deploy`), where `lib/verdict.ts` is unchanged.

One fix in this PR (`lib/verdict.ts`), with a test. With `main` merged in, lint, typecheck, the 40 frontend tests and `next build` pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The plain-language verdict fell through to "A normal October: within the range of past years." whenever `/stats` had no `status`. From X13 on (PR #31), the backend leaves `status` empty when it has fewer than 3 past years to compare with, so the page would call a month normal exactly when the backend refuses to judge it | **Fixed:** with no status the verdict says "Too few past years to say whether this October is unusual." (tone `none`); test added |

Checked in the browser:
- **Verdict:** for the Nile Delta, Oct 2026: "October 2026: 579 hotspots. Unusually high: 2.5 times a typical October." It matches `/stats` (median 234, z +2.8, rank 2 of 26, percentile 96).
- **Usual range:** the middle half of past years is 167 to 301.
- **Layout:** no horizontal overflow at 390 px, and the calendar scrolls sideways on the phone.
- **Errors:** no console errors besides GIBS's empty label tiles.

Checked in the code:
- **Quantiles:** `quantile` interpolates like numpy's default.
- **Wording:** "times" only from 1.95× up, and below that a percentage of a typical month.
- **Superlatives:** "most" and "fewest" use the backend's rank over all years including this one.
