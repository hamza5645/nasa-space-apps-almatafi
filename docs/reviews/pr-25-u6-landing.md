# Review of PR #25 (U6 landing page with the globe, and the Method page)

Nov 3, 2026. One review pass. I built the pages and read the numbers in the static HTML, and compared with the top of the stack (`hamza/i1-deploy`), where X15 (PR #33) redesigns both pages but keeps how they get their numbers (`lib/content.ts` reads the committed offline copy at build time).

No code changes in this PR. With `main` merged in, lint, typecheck, the 27 frontend tests and `next build` pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The Method page's limits don't mention two things the reviews found: the static mask drops a cell for all 25 years (PR #5 review), and the Terra-only months (2001-01 → 2002-06) are unreliable where Terra sees little (X22) | Not added here: X15 rewrites the page, so cards added now would conflict. Board: add both to the Limits section at PR #34 (the top of the stack), and to `docs/method.md` at PR #26 |
| 2 | The pages show the raw 2012 jump from the committed `public/cache/validation.json` (2.87×); since the PR #10 fix the pipeline measures 4.6× with the app's raw MODIS rule | Already noted (PR #10 review): rebuild the cache with `scripts/build-data.sh` |

Checked and fine:
- **No counters that start at 0** (PLAN §14.2): every number is in the HTML at build time: R² 0.977, the 2012 jump, the Pettitt p values, the per-region truth table.
- **Mock labels:** mock data is labelled as mock on both pages and in the chart.
- **Sources:** the sources list links FIRMS, GIBS and the papers behind the method.
- **Imagery:** the Blue Marble texture is NASA imagery (public domain).
