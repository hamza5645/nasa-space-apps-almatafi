import assert from "node:assert/strict";
import { test } from "node:test";
import { countByPlatform, referencePlatform } from "./platforms.ts";

test("one satellite per month, like the backend", () => {
  assert.equal(referencePlatform("modis", "2002-06"), "Terra");
  assert.equal(referencePlatform("modis", "2002-07"), "Aqua");
  assert.equal(referencePlatform("harmonized", "2011-12"), "Aqua");
  assert.equal(referencePlatform("harmonized", "2012-02"), "SNPP");
  assert.equal(referencePlatform("viirs", "2026-10"), "SNPP");
  assert.equal(referencePlatform("viirs", "2026-11"), "NOAA20"); // S-NPP stopped on Nov 2, 2026
});

test("counts per platform", () => {
  const f = (platform: string) => ({ properties: { platform } });
  assert.deepEqual(countByPlatform([f("SNPP"), f("SNPP"), f("Aqua")]), { SNPP: 2, Aqua: 1 });
  assert.deepEqual(countByPlatform([f("SNPP")], { SNPP: 9 }), { SNPP: 9 });
});
