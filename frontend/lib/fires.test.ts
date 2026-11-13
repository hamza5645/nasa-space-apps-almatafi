// The landing globe's fire layer (scripts/globe-fires.mjs): the binary file must match its
// own metadata, so the numbers printed on the page are the dots drawn on the globe.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const dir = join(import.meta.dirname, "..", "public", "globe");
const meta = JSON.parse(readFileSync(join(dir, "fires.json"), "utf8"));
const buf = readFileSync(join(dir, "fires.bin"));

test("fires.bin is whole 10-byte records", () => {
  assert.equal(buf.length % 10, 0);
});

test("cells and detections per sensor add up to fires.json", () => {
  const sum = { modis: { cells: 0, det: 0 }, viirs: { cells: 0, det: 0 } };
  const seen = new Set<string>();
  for (let o = 0; o < buf.length; o += 10) {
    const row = buf.readUInt16LE(o), col = buf.readUInt16LE(o + 2), n = buf.readUInt16LE(o + 4);
    const sensor = buf.readUInt8(o + 9) === 0 ? "modis" : "viirs";
    assert.ok(row < 1800 && col < 3600, "cell inside the 0.1° grid");
    assert.ok(n > 0, "no empty cells");
    const key = `${sensor}:${row}:${col}`;
    assert.ok(!seen.has(key), "one record per sensor and cell");
    seen.add(key);
    sum[sensor].cells += 1;
    sum[sensor].det += n;
  }
  for (const s of ["modis", "viirs"] as const) {
    assert.equal(sum[s].cells, meta.sensors[s].cells);
    assert.equal(sum[s].det, meta.sensors[s].detections);
  }
  assert.equal(meta.ratio_viirs_vs_modis, +(meta.sensors.viirs.detections / meta.sensors.modis.detections).toFixed(2));
});
