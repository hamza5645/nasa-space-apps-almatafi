import assert from "node:assert/strict";
import { test } from "node:test";
import type { Stats } from "./api.ts";
import { noun, quantile, usualRange, verdict } from "./verdict.ts";

function stats(value: number, past: number[], extra: Partial<Stats> = {}): Stats {
  const values = past.map((v, i) => ({ year: 2001 + i, value: v }));
  const sorted = [...past].sort((a, b) => a - b);
  const median = past.length ? quantile(sorted, 0.5) : null;
  const rank = 1 + past.filter((p) => p > value).length;
  return {
    month: "2026-10", value,
    baseline: { years: [2001, 2001 + past.length - 1], n_years: past.length, mean: null, median, sd: null, min: null, max: null, values },
    percentile: null, rank, z: null, ratio_to_median: null, status: "normal", partial: null, trend: null,
    meta: { data_version: "mock", generated_at: "" },
    ...extra,
  };
}

test("quantile interpolates like numpy", () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([5], 0.25), 5);
  assert.equal(quantile([], 0.5), null);
});

test("usual range is the middle half of past years", () => {
  assert.deepEqual(usualRange(stats(0, [0, 10, 20, 30, 40])), [10, 30]);
});

test("record high says how many times typical and that it is the most", () => {
  const v = verdict(stats(589, [200, 240, 230, 250], { status: "unusual_high" }), "detections");
  assert.equal(v.headline, "October 2026: 589 hotspots");
  assert.equal(v.detail, "Unusually high: 2.5 times a typical October, and the most for October in 5 years.");
  assert.equal(v.tone, "high");
});

test("below normal uses a share and can be the fewest", () => {
  const v = verdict(stats(40, [100, 100, 100], { status: "below_normal" }), "detections");
  assert.equal(v.detail, "Below normal: 40% of a typical October, and the fewest for October in 4 years.");
});

test("normal month", () => {
  assert.equal(verdict(stats(100, [90, 110, 100]), "fire_days").detail, "A normal October: within the range of past years.");
});

test("quiet places: zero and a zero median", () => {
  assert.equal(verdict(stats(0, [0, 0, 0]), "detections").detail, "None, as usual for October here.");
  const v = verdict(stats(3, [0, 0, 0], { status: "unusual_high" }), "detections");
  assert.equal(v.detail, "In most years October has none here. The most for October in 4 years.");
});

test("partial month and raw views change the wording", () => {
  const v = verdict(stats(1, [2, 2], { partial: { days_observed: 3, comparison: "" } }), "detections", "modis");
  assert.equal(v.headline, "October 2026 so far: 1 raw MODIS hotspot");
  assert.equal(noun("fire_days", 2, "viirs"), "raw VIIRS fire days");
});

test("no baseline years", () => {
  assert.equal(verdict(stats(5, []), "detections").tone, "none");
});

test("no status from the backend (too few past years): not called normal", () => {
  const v = verdict(stats(100, [90, 110], { status: null }), "detections");
  assert.equal(v.tone, "none");
  assert.equal(v.detail, "Too few past years to say whether this October is unusual.");
});
