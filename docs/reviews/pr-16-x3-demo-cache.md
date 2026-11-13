# Review of PR #16 (X3 demo-region cache)

Nov 3, 2026. One review pass. I built the cache on the full 6-region mock (PR #10's harmonized product) and compared with the top of the stack (`hamza/i1-deploy`), where the cache is copied to `frontend/public/cache/` and read by the offline fallback (U5, PR #24).

No code changes in this PR. 181 backend tests pass with `main` merged in (no pipeline changes).

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | `bootstrap.install` checks for `staged/cache` **after** the loop has moved it into the data folder, so it always deletes the cache that a real bundle brought | Fixed later by X9 (PR #27: `has_cache` is checked before the move) |
| 2 | The cache holds `/stats` for the harmonized view and the default baseline only, and hotspots only for each region's default month. Offline, other views' stats and other months' dots aren't there | Board (open items): at PR #24, check the offline mode says what's missing instead of showing blanks |
| 3 | An endpoint that fails while building is skipped silently (its calendar or month just isn't in the file) | Not fixed: `index.json` counts the stats months, which shows a broken cache |

Checked on the full mock:
- 44 s here, 1.0 MB for the Nile Delta and 0.7 MB for Río Negro;
- 6 calendars (3 views × 2 metrics) per region;
- 310 months of stats each;
- the default months' hotspots are complete (Nile Delta Oct 2026: 1,757 points, Río Negro Jul 2026: 756, neither truncated);
- the shapes are the endpoints' own responses;
- the image builds the cache as the `app` user into `/app/data/cache`, which it owns;
- the `plots` extra goes only into the throwaway data stage.
