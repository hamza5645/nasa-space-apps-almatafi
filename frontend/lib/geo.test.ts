import { test } from "node:test";
import assert from "node:assert/strict";
import { bboxShape, circleShape, densify, shapeBounds, validShape } from "./geo.ts";

test("bbox shapes, including across 180°", () => {
  assert.deepEqual(bboxShape([29.9, 30, 32.3, 31.6]), {
    type: "Polygon", coordinates: [[[29.9, 30], [32.3, 30], [32.3, 31.6], [29.9, 31.6], [29.9, 30]]],
  });
  const split = bboxShape([177, -20, -178, -15]); // Fiji
  assert.equal(split.type, "MultiPolygon");
  assert.deepEqual(shapeBounds(split), [177, -20, 182, -15]); // one small box, not the world
});

test("a 111 km circle at the equator spans about 1° each way", () => {
  const [w, s, e, n] = shapeBounds(circleShape(0, 0, 111.195));
  for (const [got, want] of [[w, -1], [s, -1], [e, 1], [n, 1]]) assert.ok(Math.abs(got - want) < 1e-3, `${got} vs ${want}`);
  const ring = (circleShape(-40.8, -69, 150) as GeoJSON.Polygon).coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test("a circle near 180° stays one compact ring", () => {
  const [w, , e] = shapeBounds(circleShape(-17, 179.5, 100));
  assert.ok(e - w < 2.5 && e > 180, `${w}..${e}`);
});

test("only real polygons pass validShape", () => {
  const ok = { type: "Polygon", coordinates: [[[31, 30], [32, 30], [32, 31], [31, 30]]] };
  assert.equal(validShape(ok), ok);
  for (const bad of [null, 5, { type: "Polygon", coordinates: [1] }, { type: "Polygon", coordinates: [] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 1]]] }, { type: "Polygon", coordinates: [[[0, 0], [1, NaN], [2, 2], [0, 0]]] },
    { type: "Polygon", coordinates: [[[0, 0], [1, 95], [2, 2], [0, 0]]] }, { type: "Point", coordinates: [0, 0] },
    { type: "MultiPolygon", coordinates: [[1]] }]) {
    assert.equal(validShape(bad), null, JSON.stringify(bad));
  }
});

test("densify keeps every edge under 180° of longitude", () => {
  const ring: [number, number][] = [[-100, 60], [100, 60], [100, 62], [-100, 62], [-100, 60]];
  const d = densify(ring);
  for (let i = 1; i < d.length; i++) assert.ok(Math.abs(d[i][0] - d[i - 1][0]) <= 90);
  assert.deepEqual(d[0], [-100, 60]);
  assert.deepEqual(d.at(-1), [-100, 60]);
  assert.equal(d.length, ring.length + 4); // 200° edges get 2 extra points each
});
