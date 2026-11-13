# Review of PR #23 (U2 map: MapLibre on NASA GIBS, hotspot dots, Terra Draw, place search)

Nov 3, 2026. One review pass. I ran the explorer in headless Chromium against the backend on the full mock, and compared with the top of the stack (`hamza/i1-deploy`), where later PRs keep `MapView`, `PlaceSearch` and `lib/geo.ts` and add the crossing-180° handling.

No code changes in this PR. With `main` merged in, lint, typecheck, the 20 frontend tests and `next build` pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Carried over from the PR #12 review: can the map fit a search result whose bbox crosses 180° (Fiji, Chukotka)? | Fine: the map fits to the area's own geometry, not to the API's bbox. At the top of the stack, `shapeBounds` turns a shape split at 180° into one box with east > 180, which MapLibre accepts. Board item removed |
| 2 | The browser console shows a few HTTP 500s while the map loads | Not ours: the API answered every request with 200. They're GIBS label tiles, which answer 500 where there are no labels (the tile loader expects it and doesn't retry those much) |
| 3 | In the harmonized view, the map shows MODIS and VIIRS dots (1,757 for the Nile Delta, Oct 2026), while the calendar counts S-NPP-equivalent detections | Already handled later: X13's `platforms` filter and `by_platform` counts (PR #7 finding 3) |

Checked in the browser: the map opens on the area with the Blue Marble imagery, the dashed area outline and the hotspot dots sized by FRP; the stats panel and the strongest-fires list match the selected month; GIBS and FIRMS are credited.

Checked in the code: place search runs on submit, not on every keystroke (Nominatim allows 1 request a second); a place without an outline becomes a 25 km circle; GIBS tiles load a few at a time with retries.
