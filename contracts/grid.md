# Grid contract

Version 1.0.2 · 2026-11-03

One global grid that every product, query and export uses. The `cell_id` function must give identical results in Python (`pipeline/`, `backend/`) and TypeScript (`frontend/`); task F4 implements both with shared test vectors (§4).

## 1. The grid

- Regular lat/lon grid, **0.1°** cells, WGS84.
- 1800 rows (latitude) × 3600 columns (longitude) = 6 480 000 cells.
- Row 0 starts at latitude −90; column 0 starts at longitude −180.
- A cell is about 11 km × 11 km at the equator and narrower towards the poles. Its area is computed, never assumed (§3).

## 2. `cell_id`

```
row = floor((lat + 90)  * 10)    clamped to 0..1799
col = floor((lon + 180) * 10)    clamped to 0..3599
cell_id = row * 3600 + col       integer, 0..6 479 999
```

Inverse (cell centre):

```
row = cell_id // 3600
col = cell_id %  3600
cell_lat = -90  + (row + 0.5) / 10
cell_lon = -180 + (col + 0.5) / 10
```

Rules:
- Points exactly on a boundary belong to the cell to the north / east (that is what `floor` does).
- `lat = 90` and `lon = 180` are clamped into the last row / column.
- To avoid floating-point surprises (e.g. `30.1` stored as `30.099999…`), snap to 9 decimals before `floor`, in exactly these steps on 64-bit floats:
  ```
  x   = (lat + 90) * 10                 (lon: (lon + 180) * 10)
  y   = round(x * 1e9)                  to the nearest integer; ties either way give the same cell
  row = floor(y / 1e9)                  then clamp
  ```
  NumPy `np.round(x, 9)` and TypeScript `Math.round(x * 1e9) / 1e9` follow these steps. Python's `round(x, 9)` on a plain float does **not** (it rounds the exact decimal value), and gives a different cell for some points within about 5e-11° below an edge. FIRMS coordinates (5 decimals) are far from that zone, so this only matters for typed or computed coordinates.

## 3. Cell area

```
area_km2 = R² × radians(0.1) × |sin(radians(lat_top)) − sin(radians(lat_bottom))|
R = 6371.0088 km
lat_bottom = -90 + row / 10
lat_top    = lat_bottom + 0.1
```

Reference values: row 900 (equator) = 123.64 km², row 1200 (30°N) = 107.02 km².

## 4. Test vectors (both implementations must pass)

The full set, with extra edge cases, is in [`grid-test-vectors.json`](grid-test-vectors.json), which both test suites read.

| lat | lon | row | col | cell_id | cell_lat | cell_lon |
|---|---|---|---|---|---|---|
| 0.0 | 0.0 | 900 | 1800 | 3241800 | 0.05 | 0.05 |
| −90.0 | −180.0 | 0 | 0 | 0 | −89.95 | −179.95 |
| 90.0 | 180.0 | 1799 | 3599 | 6479999 | 89.95 | 179.95 |
| 30.1 | 31.2 | 1201 | 2112 | 4325712 | 30.15 | 31.25 |
| −40.84 | −68.97 | 491 | 1110 | 1768710 | −40.85 | −68.95 |
| 30.0999 | 31.1999 | 1200 | 2111 | 4322111 | 30.05 | 31.15 |

## 5. Area of interest → cells

- A cell is **inside** an area of interest (AOI) when its **centre** lies inside the AOI polygon.
- If the AOI contains **fewer than 4 cell centres**, the API still answers using the cells it touches (polygon intersects the cell), and sets `aoi.coarse_warning = true` (see `api.md`).
- AOIs crossing the antimeridian are split into two polygons before lookup.

## 6. Calibration strata

The MODIS → VIIRS conversion is fitted per stratum (PLAN.md §5.4).

```
row, col = the cell's row and col from §2 (already clamped)
tile_row = row // 100                   0..17
tile_col = col // 100                   0..35
tile_id  = tile_row * 36 + tile_col     0..647
stratum_id = "t{tile_id}-m{month:02d}"  e.g. "t453-m10" (Nile Delta, October)
```

The tile comes from the clamped cell, not from raw lat/lon, so `lat = 90` or `lon = 180` stays in range and every cell sits in exactly one tile.

- `month` is the calendar month 1..12 (the season).
- **Fallback** when a stratum has fewer than 30 overlap cell-months with detections: use the same tile with all months pooled (`"t453-mall"`), then the latitude band (`"b{tile_row}-m{month:02d}"`), then global for that month (`"g-m10"`). The stratum actually used is stored in the harmonized output.
- Stretch (land-cover strata) would add a suffix, e.g. `"t453-m10-lc12"`; not in v1.

## Changelog

- 1.0.2 (2026-11-03): §2 spells out the exact rounding steps (multiply, round to an integer, divide), because "round to 9 decimals" was read two ways and the Python scalar disagreed with NumPy and TypeScript near cell edges. No cell changes for FIRMS 5-decimal coordinates. `grid-test-vectors.json` adds four near-edge cases.
- 1.0.1 (2026-11-03): tile from the clamped cell row/col (§6), so lat 90 / lon 180 stay in 0..647; stratum examples use the Nile Delta tile (453, not 417).
- 1.0 (2026-11-01): first version.
