import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildChapters, factRound, higherRound, pickStatus, points, stars, statusRound, trapRound, type RegionDoc } from "./game.ts";

// The committed offline copy and map counts: the same files the /play page reads at build time.
const doc = (id: string) => JSON.parse(readFileSync(new URL(`../public/cache/${id}.json`, import.meta.url), "utf8")) as RegionDoc;
const maps = JSON.parse(readFileSync(new URL("../public/game/maps/maps.json", import.meta.url), "utf8"));
const delta = doc("nile-delta"), rio = doc("rio-negro");
const week = { dates: ["27 Oct", "3 Nov 2026"] as [string, string], modis: 58127, viirs: 300095 };

test("five chapters, each round with two answers and its answer among them", () => {
  const ch = buildChapters([delta, rio], week, maps);
  assert.deepEqual(ch.map((c) => c.id), ["hotspots", "eyes", "normal", "trap", "map"]);
  const all = ch.flatMap((c) => c.rounds);
  assert.ok(all.length >= 11, `${all.length} rounds`);
  for (const r of all) {
    assert.equal(r.choices.length, 2, r.id);
    assert.ok(r.choices.some((c) => c.id === r.answer), r.id);
    assert.notEqual(r.choices[0].id, r.choices[1].id, r.id);
  }
  assert.equal(new Set(all.map((r) => r.id)).size, all.length);
  for (const c of ch) assert.ok(c.intro.length >= 2 && c.learned && c.tagline, c.id);
});

test("normal-or-not uses the real /stats status; the month's own year isn't among its past flames", () => {
  for (const want of ["case", "normal", "below_normal"] as const) {
    const s = pickStatus(delta, want) ?? pickStatus(rio, want)!;
    const d = delta.stats[s.month] === s ? delta : rio;
    const r = statusRound(d, s);
    assert.equal(r.answer, s.status === "normal" ? "normal" : "not");
    if (r.visual.type !== "years") throw new Error("years expected");
    assert.ok(!r.visual.past.some((p) => p.year === Number(s.month.slice(0, 4))));
    assert.equal(r.visual.typical, s.baseline.median);
  }
  assert.equal(statusRound(delta, delta.stats["2026-10"], { src: "/x.webp", dots: 589 }).visual.type, "map");
});

test("which-year: raw counts point one way, the harmonized record the other", () => {
  const r = higherRound(delta) ?? higherRound(rio);
  assert.ok(r);
  if (r!.visual.type !== "versus" || !r!.visual.after) throw new Error("versus expected");
  const v = r!.visual;
  assert.ok(v.right.value > v.left.value && v.after!.left > v.after!.right);
  assert.equal(r!.answer, r!.choices[0].id);
});

test("the trap: raw jumps at 2012, ours doesn't", () => {
  const r = trapRound(delta) ?? trapRound(rio);
  if (!r || r.visual.type !== "trap") throw new Error("trap expected");
  assert.ok(r.visual.raw[1] / r.visual.raw[0] > r.visual.ours[1] / r.visual.ours[0]);
});

test("the map rounds use the snapshot counts", () => {
  const ch = buildChapters([delta, rio], week, maps);
  const sensors = ch.find((c) => c.id === "eyes")!.rounds.find((r) => r.id === "map-sensors")!;
  if (sensors.visual.type !== "maps") throw new Error("maps expected");
  assert.equal(sensors.visual.right.dots, maps["delta-viirs"].dots);
  assert.ok(sensors.visual.right.dots > sensors.visual.left.dots);
  assert.equal(factRound("week", null), null);
  assert.equal(factRound("week", week)!.choices.find((c) => c.id === "more")!.label, "300,095");
});

test("stars and points", () => {
  assert.deepEqual([stars(3, 3), stars(2, 3), stars(1, 3), stars(0, 3), stars(0, 0)], [3, 2, 1, 0, 0]);
  assert.equal(points(0), 100);
  assert.equal(points(2), 150);
});
