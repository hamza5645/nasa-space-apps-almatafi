// The 0.1° global grid: cell ids, centres, bounds and areas.
// Implements contracts/grid.md. pipeline/almatafi/cells.py is the Python twin;
// both must pass contracts/grid-test-vectors.json.

export const RES_DEG = 0.1;
export const N_ROWS = 1800;
export const N_COLS = 3600;
export const N_CELLS = N_ROWS * N_COLS;
export const EARTH_RADIUS_KM = 6371.0088;

export type Bounds = { west: number; south: number; east: number; north: number };

function checkPoint(lat: number, lon: number): void {
  // Also rejects NaN, since every comparison with NaN is false.
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) {
    throw new RangeError(`point out of range: lat=${lat}, lon=${lon}`);
  }
}

function index(v: number, n: number): number {
  // Snapping to 9 decimals stops 30.1 (stored as 30.0999…) from landing one cell south.
  // Multiply, round to an integer, divide (grid.md §2), the same steps as cells.py.
  const i = Math.floor(Math.round(v * 10 * 1e9) / 1e9);
  return Math.min(Math.max(i, 0), n - 1);
}

export function cellRow(lat: number): number {
  checkPoint(lat, 0);
  return index(lat + 90, N_ROWS);
}

export function cellCol(lon: number): number {
  checkPoint(0, lon);
  return index(lon + 180, N_COLS);
}

export function cellId(lat: number, lon: number): number {
  checkPoint(lat, lon);
  return index(lat + 90, N_ROWS) * N_COLS + index(lon + 180, N_COLS);
}

export function cellRowCol(id: number): [row: number, col: number] {
  if (!Number.isInteger(id) || id < 0 || id >= N_CELLS) {
    throw new RangeError(`cell_id out of range: ${id}`);
  }
  return [Math.floor(id / N_COLS), id % N_COLS];
}

/** [lat, lon] of the cell centre. */
export function cellCenter(id: number): [lat: number, lon: number] {
  const [row, col] = cellRowCol(id);
  // Written as k/20 so the result is the nearest float to the exact centre.
  return [(2 * row + 1 - N_ROWS) / 20, (2 * col + 1 - N_COLS) / 20];
}

export function cellBounds(id: number): Bounds {
  const [row, col] = cellRowCol(id);
  const r0 = row - N_ROWS / 2;
  const c0 = col - N_COLS / 2;
  return { west: c0 / 10, south: r0 / 10, east: (c0 + 1) / 10, north: (r0 + 1) / 10 };
}

/** Area of any cell in this row (all cells in a row are equal). */
export function rowAreaKm2(row: number): number {
  if (!Number.isInteger(row) || row < 0 || row >= N_ROWS) {
    throw new RangeError(`row out of range: ${row}`);
  }
  const rad = Math.PI / 180;
  const bottom = ((row - N_ROWS / 2) / 10) * rad;
  const top = ((row + 1 - N_ROWS / 2) / 10) * rad;
  return EARTH_RADIUS_KM ** 2 * RES_DEG * rad * Math.abs(Math.sin(top) - Math.sin(bottom));
}

export function cellAreaKm2(id: number): number {
  return rowAreaKm2(cellRowCol(id)[0]);
}

/** Cell outline as a closed GeoJSON ring ([lon, lat] order), for drawing on the map. */
export function cellPolygon(id: number): [number, number][] {
  const { west, south, east, north } = cellBounds(id);
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}
