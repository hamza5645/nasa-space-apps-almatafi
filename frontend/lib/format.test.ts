import { test } from "node:test";
import assert from "node:assert/strict";
import { RAMP, ZERO, cellColor, fmt, inkOn, monthDays, monthLabel, rampIndex, short, utcLabel, ym } from "./format.ts";

test("months", () => {
  assert.equal(ym(2026, 7), "2026-07");
  assert.equal(monthLabel("2026-10"), "October 2026");
  assert.equal(monthLabel("2026-10", false), "Oct 2026");
  assert.deepEqual(monthDays("2024-02"), ["2024-02-01", "2024-02-29"]);
  assert.deepEqual(monthDays("2026-12"), ["2026-12-01", "2026-12-31"]);
});

test("numbers", () => {
  assert.equal(fmt(12345.6), "12,346");
  assert.equal(fmt(3.14159, 1), "3.1");
  assert.equal(fmt(null), "–");
  assert.deepEqual([987, 1200, 1000, 12_345, 1_250_000].map(short), ["987", "1.2k", "1k", "12k", "1.3M"]);
});

test("ramp: null is not observed, 0 is observed-but-nothing, max is the brightest", () => {
  assert.equal(cellColor(null, 100), null);
  assert.equal(cellColor(0, 100), ZERO);
  assert.equal(cellColor(100, 100), RAMP[RAMP.length - 1]);
  assert.equal(rampIndex(1, 100), 0); // 1% of the max still gets a colour, not ZERO
  assert.equal(rampIndex(10, 100), 2); // sqrt scale lifts quiet months
  const idx = [1, 5, 20, 50, 100].map((v) => rampIndex(v, 100));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx);
  assert.equal(inkOn(100, 100), "#1C0F04");
  assert.equal(inkOn(1, 100), "#F2EBE1");
});

test("UTC labels don't depend on the viewer's time zone", () => {
  assert.equal(utcLabel("2026-11-03T00:05:00Z"), "3 Nov 2026, 00:05 UTC");
});
