# Review of PR #6 (B1 FastAPI skeleton, /health, /regions, AOI parsing)

Nov 3, 2026. One review pass (13 findings). Each was checked by running it against the PR's code and against the top of the stack (`hamza/i1-deploy`). Later PRs change `aoi.py` (B3c: `AdminStore.add`; X13: holes across 180°; B2: `cells_touching`) but don't touch the code behind the findings below, except where noted.

The four bigger ones (1–5) are on the Board as **X19** and **X20** instead of being fixed here. The small ones are fixed.

| # | Finding | Outcome |
|---|---|---|
| 1 | No request-size limit. The vertex check runs after the whole body is parsed: a 40 MB polygon body raised memory by ~700 MB. The API runs with a 1 GB cap and Cloudflare passes bodies up to 100 MB, so one request can kill it | Board **X19**: refuse bodies over 1 MB with 413 (2,000 vertices is under 100 KB) |
| 2 | Fewer than 4 cell centres → the fallback builds a box for every cell in the bounding box (up to 1.5M). A thin diagonal sliver with no centres: 5 s, ~700 MB | Board **X19**: test only cells next to the boundary (a cell the shape overlaps is either fully inside, so its centre is inside, or crossed by the boundary). Same result |
| 3 | NaN or Infinity in a point or bbox (Python's JSON parser accepts them) goes into the error details, which can't be serialized: plain-text 500 | Board **X19**: reject non-finite numbers in the schema (`allow_inf_nan=False`) → 400 |
| 4 | Any crash is a plain-text 500 from outside the CORS middleware, so the browser sees no CORS headers and the site says "Can't reach the server" | Board **X19**: return crashes as `{"error": …}` from inside CORS. 413 and 500 are new codes: add them to the 1.1 proposals (PR #20) |
| 5 | PR #1 finding #7 confirmed: below 4 centres the AOI counts every cell it touches. `[30.99, 30.49, 31.29, 30.61]` (383 km², 3 centres) counts 12 cells (~1,300 km²); widen it to 31.36 (472 km², 4 centres) and it counts 4 | Kept: it's the agreed contract rule (grid.md §5). Board **X20**: add the covered cells' area to `meta.aoi` (1.1 proposals) and say it in the coarse warning (frontend) |
| 6 | A circle containing a pole became the whole polar cap: 500 km at 86°N measured 2.82M km² instead of 0.79M (3.6×) | Fixed: the circle is closed along the pole and keeps its true size (within 1% of πr² in the tests) |
| 7 | The bbox of a shape given as separate parts on each side of 180° (Fiji, Chukotka, the Aleutians in geoBoundaries) spanned the whole world, so the GeoTIFF export's "export each side" check (B3a) missed it and made a 3,600-column raster | Fixed: smallest box around the parts; it crosses 180° when that's smaller |
| 8 | A JSON syntax error was reported for field `"1"` (the character offset); 405 responses dropped the `Allow` header | Fixed |
| 9 | Cell centres exactly on the AOI's edge are left out (a box drawn through centres loses its outer ring) | Kept: the contract says "inside" |
| 10 | Without a grid, `data_version` falls back to the last clean file by name, not the newest build | Kept: the grid is always built after ingest |
| 11 | A ring that loops the world more than once is rejected; a polygon drawn around a pole as a ring is rejected as self-intersecting | Kept: the map can't draw either (Mercator stops at 85°) |
| 12 | A hole crossing 180° was unwrapped on its own and landed 360° away ("Hole lies outside shell") | Fixed later by X13 (PR #31, `_align`) |
| 13 | Admin shapes are read once, so boundaries fetched while running weren't usable | Fixed later by B3c (PR #13, `AdminStore.add`) |
