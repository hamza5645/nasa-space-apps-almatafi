# Review of PR #5 (D3 monthly grid, coverage, static mask)

Nov 3, 2026. One automated review pass (10 findings), checked by running the grid on the mock and against the top of the stack (`khalid/x14-harmonization-v2`). X13 later widens the static mask to types 1 and 3 and X14 adds `detections_big` / `fire_days_big`; neither fixes the findings below.

On the full 6-region mock and the 2-region demo mock, `grid_monthly`, `coverage` and `static_mask` are identical to the original code, and so is every report number.

| Finding | Outcome |
|---|---|
| `data_version` "newest" was an alphabetical max (reproduced: `nrt-20261101` chosen over `archive-20261113`) | Fixed: the newest date wins. |
| Clean path pasted into SQL; a `'` in a folder name broke the build (reproduced) | Fixed: DuckDB gets the file list as a value. The backend's `series.py` (later PRs) has the same pattern: check it in B2/PR #7. |
| Whole grid sorted and held in memory before writing (~10⁸ rows globally) | Not fixed here, because X14 rewrites `grid_monthly`: added to Board task **X18** (stream with `COPY … TO`). |
| TEAM.md conflict with `main`; D3 listed as Done | Fixed: `main` merged in, D3 under In review. |
| Grid files didn't record the MODIS confidence threshold (PR #1 finding #14) | Fixed: `grid_monthly.parquet` metadata has `modis_min_confidence`. The contract still says "not low"; add the threshold to the 1.1 proposals (PR #20). |
| Coverage from detections undercounts small-area builds | Warned: the report lists platform-months below 90% observed (`coverage_partial`) and the CLI prints a warning. On the mock it flags 96 months (6 regions) and 598 (2 demo regions), so harmonization on mock already sees "partial" months. The real fix is R3's global coverage. |
| `drop_counts` re-typed the filter and treated NULLs differently | Fixed: one `filters()` list feeds both the grid's WHERE and the report; NULL counts as failing in both. |
| Static mask drops a whole 10 km cell for all 25 years | Kept (design trade-off). Put it on the Method page's limitations list (docs/method.md, PR #26). |
| `cells_with_fire` built a Python set of every row | Fixed: `pyarrow.compute.count_distinct`. |
| `test_grid.py` imports helpers from `test_ingest.py` | Skipped: later PRs' tests use the same imports; move the helpers once the stack is merged. |
