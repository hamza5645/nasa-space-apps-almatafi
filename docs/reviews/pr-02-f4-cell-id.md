# Review of PR #2 (F4 shared `cell_id`)

Nov 3, 2026. One automated review pass (13 findings) plus a rounding experiment for finding #16 from the PR #1 review. The grid files in this PR are unchanged up to the top of the stack (`khalid/x14-harmonization-v2`), so the review covers the whole stack's grid code.

## Finding #16 (Python vs TS rounding): real, but it was Python against itself

- `_index` used Python's `round(x, 9)`, which rounds the exact decimal value of the float. `cell_ids` (NumPy `np.round`: multiply by 1e9, round, divide) and `grid.ts` (`Math.round(x * 1e9) / 1e9`) both multiply first.
- Over 600 000 test values (400 000 placed within ~5e-11° below a cell edge), the old scalar disagreed with NumPy 2 965 times; NumPy and TypeScript agreed on all of them.
- It also depended on the input type: `round()` on a `np.float64` uses NumPy's rounding, so the old scalar was only wrong for plain Python floats.
- Impact was close to zero: FIRMS coordinates have 5 decimals and all of them were already tested exhaustively; the frontend uses only `EARTH_RADIUS_KM` from `grid.ts`. The backend's `aoi._grid_window` uses the scalar for bbox row and column ranges, so typed coordinates could have hit it.

## What changed (grid contract 1.0.2)

| Finding | Outcome |
|---|---|
| Scalar `cell_id` rounds differently from `cell_ids` and TS | Fixed: `_index` now does `floor(round(x * 1e9) / 1e9)`, the same steps as NumPy and TS. 0 disagreements on the 600 000 values. |
| "Round to 9 decimals" is ambiguous | Fixed: `grid.md` §2 spells out the steps (1.0.2). Contract change: needs both to agree. |
| No near-edge tests | Fixed: 4 near-edge vectors in `grid-test-vectors.json` (both suites read them), plus a 100 000-point near-edge scalar-vs-vector test using plain floats. All fail on the old code. |
| Non-integer cell ids and rows accepted in Python | Fixed: `cell_row_col` and `row_area_km2` reject 1.5, NaN, bools and strings; whole floats and NumPy ints are fine (like `Number.isInteger`). |
| `stratum_chain(…, 10.0)` crashed with a format error | Fixed: month is checked as a whole number first. |
| Vectors file said version 1.0 | Fixed: 1.0.2. |
| Hard-coded 900 / 1800 / 3600 in the centre and bounds formulas | Fixed in `cells.py` and `grid.ts` (use `N_ROWS` / `N_COLS`). |
| `cell_bounds` is lon-first, `cell_center` lat-first | Fixed: `cell_bounds` returns a `Bounds` named tuple (still unpacks as before). |
| TEAM.md conflict with `main`; F4 listed as Done while in review | Fixed: `main` merged in, F4 listed under In review until merged. |
| `pipeline/uv.lock` not committed | Skipped: PR #14 (X1) adds it; adding it here would conflict there. |
| New files in `frontend/` (Hamza's area) and `contracts/` (shared) | `frontend/lib/` is fine (Hamza's area, Hamza merged it). The `contracts/` file still needs Khalid's OK (TEAM.md rule 5). |
