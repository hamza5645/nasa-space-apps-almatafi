# Review of PR #37 (X27 FIRMS gaps)

Nov 13, 2026. One review pass at `bc74019`, then the fixes below on the same branch. Finding 1 was measured on the real geoBoundaries files. The fixes were checked with tests, on a full mock build, and in headless Chrome against a local API (the explorer with OpenFreeMap reachable and blocked).

After the fixes: 225 pipeline, 229 backend and 53 frontend tests pass; lint, typecheck and the static build are clean; the OpenAPI snapshot and API types are regenerated. The offline cache built by the new code is identical to the committed one, so `frontend/public/cache/` is unchanged.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | **Country fetches were clipped to the map's outline.** `fetch api --country` read `data/admin/{ISO3}_ADM0.geojson`, which `app.admin` cuts to 2,000 vertices. Against geoBoundaries' full file: Chile 0.086° off (9.5 km), 6.6% of its area on the wrong side; Egypt 0.004°; Argentina unchanged. Today's API fetch (all of 2026, NOAA-21, the NRT tail) would have lost Chilean hotspots near the border and the fjord coast, while earlier years come from FIRMS's own country files | **Fixed.** `python -m app.admin --outlines DIR EGY ARG CHL` writes geoBoundaries' full ADM0 file to `data/outlines/` (never `data/admin`), and `fetch api` reads it with `--outline-dir`. `build-data.sh` does both. On 200,000 random points per country the clip matches shapely on the full outline exactly, and the 0.01° slack keeps nothing beyond 0.01° |
| 2 | **"Day image" covered the area and the hotspots on the fallback style.** The image went before the first symbol layer. When OpenFreeMap's style doesn't arrive in 6 s the only symbol layer is Terra Draw's, at the very top (the review first read this as "no symbol layer") | **Fixed.** The image goes right under the Blue Marble layer, which is already placed under the labels in both styles. Layer order checked in Chrome: fallback `bg, day, relief, aoi-fill…`; OpenFreeMap: day at 8, first label at 10, area at 49 |
| 3 | **Calendar and grid exports ignored "Cloud-corrected".** The screen said 665, the file 589 | **Fixed.** `/export` takes `clouds` for calendar and grid; a corrected CSV names its value column `value_cloud_corrected`, a GeoTIFF's `unit` tag says it. The explorer sends it when the corrected view is on (request bodies checked in Chrome) |
| 4 | **A stale alert preview.** The preview stayed after the area, threshold or cloud mode changed, under the new area's title | **Fixed.** It is shown only for the request it answers |
| 5 | **Corrected and uncorrected months could be compared.** With `clouds=correct`, a month with no cloud row was left as it was next to months scaled up to 5×. Not reachable on the mock product (it covers every month); the real MOD14CMH trails the fire data by months | **Fixed.** A month the cloud product doesn't cover is not observed in the corrected view: `null` in the calendar, out of baselines, 422 `out_of_range` (`dataset: clouds`) from `/stats`. `method.md` §6 and `CHANGES-1.1.md` say so |
| 6 | **KML memory.** Measured: 200,000 points make a 186 MB file and take 940 MB (the text is held several times, once as 2-byte characters), on an API capped at 1 GB. GeoJSON at the same cap: 166 MB | **Fixed.** KML is capped at 50,000 points (230 MB) |
| 7 | **"The month's busiest day"** is the busiest among the newest 5,000 detections the map holds, and was recomputed on every render | **Fixed.** Computed once per hotspot set; the legend says when the month has more detections than the map loads |
| 8 | **Scientific notation in alert emails** from 1,000,000 (`:g`) | **Fixed.** `1,234,567.8` |
| 9 | **A refused area was checked twice** by the alert preview: every 422 fell back to the month before | **Fixed.** Only `out_of_range` falls back |
| 10 | **Cloud-cover work nobody uses.** Every `/calendar` ran the cloud join; the corrected view ran it twice | **Partly.** One cloud query per request, none for calendar CSV exports. On the mock it costs 5 ms of a 26–30 ms calendar, and reading the cloud file's schema 0.06 ms, so that isn't cached. The yearly chart's three calendars still get cloud cover they don't draw; a request flag is only worth it if the real product makes the join slow (noted under X28) |
| 11 | **KML files were saved as `….undefined`** (found while fixing 3): `download.ts` had no extension for `kml` | **Fixed.** The extension map is typed by the export formats, so a missing one fails the typecheck |

Not changed:
- **Chile's fetch box** spans 43° × 39° because of Easter Island, so each request also brings western Argentina, Bolivia and Paraguay, which the clip drops. Splitting it would add about 600 mostly empty requests; the runbook already notes the box.
- **`clouds real`** is a stub and the Method figure waits for a file: both are on the Board (X28, the Higgsfield still).
- `cloud_fields` lost its unused argument.

## For Khalid
- The fixes in `pipeline/` and `backend/` are yours to look over, most of all finding 5's rule (no cloud data = not observed in the corrected view).
- This PR changed about 20 files under `frontend/` before asking (TEAM.md rule 4). Fine this time; the frontend fixes above are the review of them.
