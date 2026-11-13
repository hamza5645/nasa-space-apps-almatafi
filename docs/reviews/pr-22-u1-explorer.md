# Review of PR #22 (U1 + U3 + U4 explorer core: layout, shared selection, calendar, stats, hotspots)

Nov 3, 2026. One review pass. I ran the PR's explorer in headless Chromium against the backend on the full 6-region mock (at 1440 px and 390 px) and compared with the top of the stack (`hamza/i1-deploy`), where X12 (PR #30) redesigns the explorer but keeps the calendar, the store, the queries and the formatting helpers.

No code changes in this PR. With `main` merged in, lint, typecheck, the 18 frontend tests and `next build` pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The calendar's single tab stop is the selected month, or January of the newest year when nothing is selected. If the selected month were off screen, or that January not observed, no cell could be reached with Tab | Not a bug in practice: the explorer moves the selection into the calendar as soon as it loads, and the calendar is only used there. In the browser, narrowing the range to 2001–2010 moved the selection to Dec 2010, and Tab reached it |
| 2 | Calendar cells read the raw origin code ("observed_snpp") to screen readers, because the label table only knows `observed` | Fixed later (the top of the stack adds `observed_snpp` and `filled_noaa21`) |

Checked in the browser:
- **Stats panel:** for the Nile Delta, Oct 2026, it shows exactly what `/api/stats` returns: 579, unusual high, z +2.8, median 234, percentile 96%, rank 2 of 26.
- **Layout and errors:** no horizontal overflow at 390 px, and no console errors at either width.
- **Keyboard:** the calendar is a grid of buttons, arrow keys move between cells, and each cell has a spoken label with its value and origin.

Checked in the code:
- **Store and queries:** one shared selection (zustand); query keys hold the whole request; raw views only ask for that sensor's hotspots.
- **Colours:** the colour ramp is ordered by lightness, and the text colour flips to dark ink on the bright cells.
- **Area forms:** the box and lat/lon forms check ranges before sending.
