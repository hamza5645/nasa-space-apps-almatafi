// Run with: node --test frontend/lib/grid.test.ts (Node 22.18+ strips the types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EARTH_RADIUS_KM,
  N_CELLS,
  N_COLS,
  N_ROWS,
  cellBounds,
  cellCenter,
  cellCol,
  cellId,
  cellPolygon,
  cellRow,
  cellRowCol,
  rowAreaKm2,
} from "./grid.ts";

type CellVector = {
  lat: number;
  lon: number;
  row: number;
  col: number;
  cell_id: number;
  cell_lat: number;
  cell_lon: number;
};

const vectors = JSON.parse(
  readFileSync(new URL("../../contracts/grid-test-vectors.json", import.meta.url), "utf8"),
);

const close = (a: number, b: number, tol: number) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

test("shared cell vectors", () => {
  for (const v of vectors.cells as CellVector[]) {
    const id = cellId(v.lat, v.lon);
    assert.equal(id, v.cell_id, `cellId(${v.lat}, ${v.lon})`);
    assert.equal(cellRow(v.lat), v.row);
    assert.equal(cellCol(v.lon), v.col);
    assert.deepEqual(cellRowCol(id), [v.row, v.col]);
    const [lat, lon] = cellCenter(id);
    close(lat, v.cell_lat, 1e-12);
    close(lon, v.cell_lon, 1e-12);
  }
});

test("invalid points and ids throw", () => {
  for (const v of vectors.invalid) {
    assert.throws(() => cellId(v.lat ?? NaN, v.lon ?? NaN), RangeError);
  }
  for (const bad of [-1, N_CELLS, 1.5]) {
    assert.throws(() => cellCenter(bad), RangeError);
  }
});

test("shared area vectors", () => {
  for (const v of vectors.areas) close(rowAreaKm2(v.row), v.area_km2, v.tolerance);
});

test("areas sum to the Earth's surface", () => {
  let total = 0;
  for (let r = 0; r < N_ROWS; r++) total += rowAreaKm2(r) * N_COLS;
  const sphere = 4 * Math.PI * EARTH_RADIUS_KM ** 2;
  assert.ok(Math.abs(total / sphere - 1) < 1e-9);
});

test("bounds and polygon wrap the centre", () => {
  for (const id of [0, 3241800, 4325712, N_CELLS - 1]) {
    const b = cellBounds(id);
    const [lat, lon] = cellCenter(id);
    assert.ok(b.west < lon && lon < b.east && b.south < lat && lat < b.north);
    const ring = cellPolygon(id);
    assert.equal(ring.length, 5);
    assert.deepEqual(ring[0], ring[4]);
  }
});

test("every centre maps back to its cell", () => {
  for (let id = 0; id < N_CELLS; id++) {
    const [lat, lon] = cellCenter(id);
    if (cellId(lat, lon) !== id) assert.fail(`centre of ${id} maps to ${cellId(lat, lon)}`);
  }
});

// FIRMS gives coordinates to at most 5 decimals; check all of them against integer maths.
test("every 5-decimal latitude", () => {
  for (let n = -9_000_000; n <= 9_000_000; n++) {
    const want = Math.min(Math.floor((n + 9_000_000) / 10_000), N_ROWS - 1);
    if (cellRow(n / 1e5) !== want) assert.fail(`lat ${n / 1e5}: got ${cellRow(n / 1e5)}, want ${want}`);
  }
});

test("every 5-decimal longitude", () => {
  for (let n = -18_000_000; n <= 18_000_000; n++) {
    const want = Math.min(Math.floor((n + 18_000_000) / 10_000), N_COLS - 1);
    if (cellCol(n / 1e5) !== want) assert.fail(`lon ${n / 1e5}: got ${cellCol(n / 1e5)}, want ${want}`);
  }
});
