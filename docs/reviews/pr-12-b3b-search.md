# Review of PR #12 (B3b `/search`)

Nov 3, 2026. One review pass. I checked a few real Nominatim answers through the PR's own client (Kafr El Sheikh, Fiji, Chukotka; about ten requests, after which Nominatim answered 429 to this machine, so I stopped) and saved Fiji's answer to test offline. I also compared with the top of the stack, where PR #13 moves the polygon simplification to `app/geometry.py`.

Two fixes in this PR (`search.py`), with tests. 139 backend tests pass with `main` merged in (no pipeline changes).

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | A place in parts on both sides of 180° gets a world-wide bbox from Nominatim: Fiji `[-180, -21.9, 180, -12.3]`, Chukotka `[-180, 61.6, 180, 71.8]`. A map that fits to it would zoom out to the whole world | **Fixed:** in that case the bbox is the smallest box around the polygon's parts, which crosses 180°: Fiji `[174.4, -21.9, -178.0, -12.3]`, Chukotka `[157.7, 61.6, -169.0, 71.8]`. Uses the PR #6 bbox function; test added. Board: at PR #23, check that the map can fit a bbox with west > east |
| 2 | Names come back in the local script: "كفر الشيخ" for Kafr El Sheikh, "Чукотский автономный округ", and "Viti" for Fiji | **Fixed:** requests ask for `accept-language=en` (now "Kafr El Sheikh", "Chukotka Autonomous Okrug"); the policy test checks it |
| 3 | A polygon with a spike (a ring that runs out and back along the same line) becomes a GeometryCollection after `make_valid`, and the whole geometry is dropped (`geometry: null`), so the UI offers a radius instead of the boundary | Fixed in the PR #13 review, where the function moves to `app/geometry.py` (fixing it here would conflict with that move) |
| 4 | Nominatim's 429 "Too many requests" (an HTML page) becomes `502 upstream_error` "unavailable right now", not cached | Fine as it is |

Checked and fine:
- **Usage policy:** at most 1 request per second, shared by all requests. The lock only books a time slot, so a slow upstream doesn't hold it, and waits over 5 s are refused.
- **Cache:** 24 h, keyed by the lowercased, space-normalized query and the limit; failures aren't cached.
- **Size:** polygons are capped at 2,000 vertices (Chukotka: 1,759).
- **Points and lines:** these get `geometry: null`.
- **Coordinate order:** `centroid` is `[lon, lat]`, and `bbox` is `[w, s, e, n]` from Nominatim's `[s, n, w, e]`.
- **Errors:** an empty `q` is a 400; `q` is limited to 200 characters and `limit` to 1–10.
