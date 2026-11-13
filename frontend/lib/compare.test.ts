import assert from "node:assert/strict";
import { test } from "node:test";
import { barAt, barJump, compare, jumpAt2012, lastFullYear, onYears, rawJoin, sideMeans, yearBars, yearlyMeans } from "./compare.ts";

const row = (v: number | null) => Array<number | null>(12).fill(v);

test("the raw join switches from MODIS to VIIRS in February 2012", () => {
  const modis = { years: [2011, 2012], matrix: [row(1), row(1)] };
  const viirs = { years: [2012, 2013], matrix: [[null, ...row(5).slice(1)], row(5)] };
  const raw = rawJoin(modis, viirs, [2011, 2012, 2013]);
  assert.deepEqual(raw[0], row(1));
  assert.deepEqual(raw[1], [1, ...row(5).slice(1)]);       // Jan 2012 MODIS, Feb on VIIRS
  assert.deepEqual(raw[2], row(5));
  assert.deepEqual(onYears(modis, [2010]), [row(null)]);
});

test("jump at 2012: mean after ÷ mean before, over observed months", () => {
  assert.equal(jumpAt2012([2011, 2012], [row(2), [2, ...row(8).slice(1)]]), 4);
  assert.equal(jumpAt2012([2013], [row(3)]), null);       // nothing before
  assert.equal(jumpAt2012([2011, 2013], [row(0), row(3)]), null);
});

test("compare puts both on one scale and measures both jumps", () => {
  const harm = { years: [2011, 2012, 2013], matrix: [row(5), row(5), row(5)] };
  const modis = { years: [2011, 2012], matrix: [row(1), row(1)] };
  const viirs = { years: [2012, 2013], matrix: [[null, ...row(5).slice(1)], row(5)] };
  const c = compare(harm, modis, viirs);
  assert.equal(c.max, 5);
  assert.equal(c.harmJump, 1);
  assert.equal(c.rawJump, 5); // MODIS 1 until Jan 2012, VIIRS 5 from Feb 2012
});

test("yearly means: mean of the observed months, null under 10 of them", () => {
  const nine = [...row(4).slice(0, 9), null, null, null];
  const ten = [...row(4).slice(0, 8), 7, 7, null, null];
  assert.deepEqual(yearlyMeans([2001, 2002, 2003], [row(3), nine, ten]), [3, null, 4.6]);
  assert.deepEqual(yearlyMeans([2001], [row(null)]), [null]);
  assert.deepEqual(yearlyMeans([2001], [nine], 9), [4]);
});

test("last full year: the year of the latest observed month, or the one before", () => {
  const toOct = [...row(1).slice(0, 10), null, null];
  assert.equal(lastFullYear([2024, 2025, 2026], [row(1), row(1), toOct]), 2025);
  assert.equal(lastFullYear([2024, 2025], [row(1), row(1)]), 2025);
  // The latest month counts on any side, and a gap inside a year doesn't end the record.
  assert.equal(lastFullYear([2024, 2025], [row(1), [null, ...row(1).slice(1)]], [row(1), row(null)]), 2025);
  assert.equal(lastFullYear([2024], [row(null)]), null);
});

test("year bars: 2001 to the last full year, skipping years either side saw under 10 months", () => {
  const years = [2000, 2001, 2002, 2003, 2011, 2012, 2013];
  const gap = [...row(2).slice(0, 9), null, null, null];
  const partial = [...row(9).slice(0, 10), null, null];
  const c = {
    years,
    raw: [row(1), row(1), gap, row(1), row(1), row(10), partial],
    harmonized: [row(5), row(5), row(5), row(6), row(5), row(10), partial],
  };
  assert.deepEqual(yearBars(c), [
    { year: 2001, raw: 1, harm: 5 },
    { year: 2003, raw: 1, harm: 6 },
    { year: 2011, raw: 1, harm: 5 },
    { year: 2012, raw: 10, harm: 10 },
  ]);
  assert.deepEqual(yearBars(c, 2011).map((b) => b.year), [2011, 2012]);
  assert.deepEqual(yearBars({ years: [2001], raw: [row(null)], harmonized: [row(null)] }), []);
});

test("bars morph in a straight line, and so does each side's mean", () => {
  const bars = [{ year: 2010, raw: 2, harm: 10 }, { year: 2011, raw: 4, harm: 10 }, { year: 2013, raw: 30, harm: 10 }];
  assert.equal(barAt(bars[0], 0), 2);
  assert.equal(barAt(bars[0], 1), 10);
  assert.equal(barAt(bars[0], 0.25), 4);
  assert.deepEqual(sideMeans(bars, 0), { before: 3, after: 30 });
  assert.deepEqual(sideMeans(bars, 0.5), { before: 6.5, after: 20 });
  assert.equal(barJump(bars, 0), 10);        // the raw join's fake jump
  assert.equal(barJump(bars, 1), 1);         // gone on ours
  assert.equal(barJump(bars, 0.5), 20 / 6.5);
});

test("bar jump is null without a side, or when the years before average 0", () => {
  assert.equal(barJump([{ year: 2013, raw: 3, harm: 3 }], 0), null);
  assert.equal(barJump([{ year: 2010, raw: 3, harm: 3 }], 0), null);
  assert.equal(barJump([{ year: 2010, raw: 0, harm: 2 }, { year: 2012, raw: 5, harm: 2 }], 0), null);
  assert.equal(barJump([{ year: 2010, raw: 0, harm: 2 }, { year: 2012, raw: 5, harm: 2 }], 1), 1);
  assert.deepEqual(sideMeans([], 0), { before: null, after: null });
});
