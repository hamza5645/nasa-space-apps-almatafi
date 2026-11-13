# Review of PR #28 (X10 on-demand hotspots outside stored areas)

Nov 3, 2026. One review pass, compared with the top of the stack (`hamza/i1-deploy`), where the on-demand logic is unchanged and X13 only adjusts which FIRMS sources are asked for.

No code changes in this PR. With `main` merged in, 204 backend tests pass, and lint, typecheck and the 27 frontend tests pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | On-demand points are fetched only when the stored-points query comes back empty (`df.empty`). An area that is partly inside the stored points' coverage gets only the stored part's points, with no warning, while its calendar counts the whole area. A stored area's quiet month (zero points) goes to FIRMS for nothing. On Nov 13 the stored points cover all of Egypt, Argentina and Chile, so the demo regions are fine, but an area across a border (Egypt–Sudan, Chile–Bolivia) would show part of its hotspots | Board **X24** (backend): decide on demand by what the stored points cover (e.g. the countries or bboxes in the build's manifest), not by an empty answer, and fetch the uncovered part |
| 2 | `fetch_range` caches its answers in the same 32-entry cache as `/nrt`, up to 31 days × 4 sources | Already in **X19** (cap the cache by rows or bytes) |

Checked and fine:
- **Span limit:** on demand is only for spans of at most 31 days (7 requests of 5 days per source).
- **FIRMS sources:** each source switches from standard to NRT at its own last standard day, from FIRMS's `data_availability` (cached 6 h, with a ~120-day fallback).
- **Same rows as stored points:** on-demand rows go through the same filter and the exact shape test, and are labelled `on_demand` in the response.
- **Exports:** they use the same path.
- **Frontend:**
  - the hotspot panel says when points came live from FIRMS;
  - a shared link's area is fitted on the map even when it's restored after the map opened.
