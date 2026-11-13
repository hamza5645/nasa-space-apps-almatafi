"""The 0.1° global grid: cell ids, centres, bounds, areas and calibration strata.

Implements contracts/grid.md. frontend/lib/grid.ts is the TypeScript twin; both
must pass contracts/grid-test-vectors.json.
"""

from __future__ import annotations

import math
from typing import NamedTuple

import numpy as np

RES_DEG = 0.1
N_ROWS = 1800
N_COLS = 3600
N_CELLS = N_ROWS * N_COLS
EARTH_RADIUS_KM = 6371.0088

# Rows and columns per 10° stratum tile.
TILE_CELLS = 100
TILE_COLS = 36


def _check_point(lat: float, lon: float) -> None:
    # Also rejects NaN, since every comparison with NaN is False.
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        raise ValueError(f"point out of range: lat={lat}, lon={lon}")


def _index(v: float, n: int) -> int:
    # Snapping to 9 decimals stops 30.1 (stored as 30.0999…) from landing one cell south.
    # Multiply, round to an integer, divide (grid.md §2), exactly like np.round in cell_ids
    # and Math.round in grid.ts. Not round(x, 9): that rounds the exact decimal value and
    # picks a different cell for some points within ~5e-11° below an edge.
    return min(max(math.floor(round(v * 10 * 1e9) / 1e9), 0), n - 1)


def _int(x, what: str) -> int:
    """x as an int; whole floats are fine (like Number.isInteger in grid.ts), 1.5 is not."""
    if isinstance(x, (int, np.integer)) and not isinstance(x, (bool, np.bool_)):
        return int(x)
    if isinstance(x, (float, np.floating)) and float(x).is_integer():
        return int(x)
    raise ValueError(f"{what} must be a whole number: {x!r}")


def cell_row(lat: float) -> int:
    _check_point(lat, 0.0)
    return _index(lat + 90.0, N_ROWS)


def cell_col(lon: float) -> int:
    _check_point(0.0, lon)
    return _index(lon + 180.0, N_COLS)


def cell_id(lat: float, lon: float) -> int:
    _check_point(lat, lon)
    return _index(lat + 90.0, N_ROWS) * N_COLS + _index(lon + 180.0, N_COLS)


def cell_ids(lat, lon) -> np.ndarray:
    """Vectorised cell_id for arrays or pandas Series. Returns int32."""
    lat = np.asarray(lat, dtype=np.float64)
    lon = np.asarray(lon, dtype=np.float64)
    ok = (lat >= -90.0) & (lat <= 90.0) & (lon >= -180.0) & (lon <= 180.0)
    if not ok.all():
        bad = int((~ok).sum())
        raise ValueError(f"{bad} point(s) out of range or NaN; drop them before gridding")
    # np.round(x, 9) is x * 1e9, rint, / 1e9: the same steps as _index.
    row = np.clip(np.floor(np.round((lat + 90.0) * 10, 9)), 0, N_ROWS - 1)
    col = np.clip(np.floor(np.round((lon + 180.0) * 10, 9)), 0, N_COLS - 1)
    return (row * N_COLS + col).astype(np.int32)


class Bounds(NamedTuple):
    west: float
    south: float
    east: float
    north: float


def cell_row_col(cid: int) -> tuple[int, int]:
    cid = _int(cid, "cell_id")
    if not 0 <= cid < N_CELLS:
        raise ValueError(f"cell_id out of range: {cid}")
    return divmod(cid, N_COLS)


def cell_center(cid: int) -> tuple[float, float]:
    """(lat, lon) of the cell centre."""
    row, col = cell_row_col(cid)
    # Written as k/20 so the result is the nearest float to the exact centre.
    return (2 * row + 1 - N_ROWS) / 20, (2 * col + 1 - N_COLS) / 20


def cell_bounds(cid: int) -> Bounds:
    """Bounds(west, south, east, north) in degrees. Note: lon first, unlike cell_center."""
    row, col = cell_row_col(cid)
    r0, c0 = row - N_ROWS // 2, col - N_COLS // 2
    return Bounds(west=c0 / 10, south=r0 / 10, east=(c0 + 1) / 10, north=(r0 + 1) / 10)


def row_area_km2(row: int) -> float:
    """Area of any cell in this row (all cells in a row are equal)."""
    row = _int(row, "row")
    if not 0 <= row < N_ROWS:
        raise ValueError(f"row out of range: {row}")
    bottom = math.radians((row - N_ROWS // 2) / 10)
    top = math.radians((row + 1 - N_ROWS // 2) / 10)
    return EARTH_RADIUS_KM**2 * math.radians(RES_DEG) * abs(math.sin(top) - math.sin(bottom))


def cell_area_km2(cid: int) -> float:
    return row_area_km2(cell_row_col(cid)[0])


def tile_id(lat: float, lon: float) -> int:
    """10° stratum tile, 0..647. Derived from the cell so edges match the grid."""
    row, col = cell_row_col(cell_id(lat, lon))
    return (row // TILE_CELLS) * TILE_COLS + col // TILE_CELLS


def stratum_chain(lat: float, lon: float, month: int) -> list[str]:
    """Stratum ids to try in order: tile×month, tile all months, lat band×month, global×month."""
    month = _int(month, "month")
    if not 1 <= month <= 12:
        raise ValueError(f"month out of range: {month}")
    tid = tile_id(lat, lon)
    band = tid // TILE_COLS
    return [f"t{tid}-m{month:02d}", f"t{tid}-mall", f"b{band}-m{month:02d}", f"g-m{month:02d}"]
