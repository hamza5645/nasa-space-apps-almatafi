import assert from "node:assert/strict";
import { test } from "node:test";
import { compare, jumpAt2012, onYears, rawJoin } from "./compare.ts";

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
