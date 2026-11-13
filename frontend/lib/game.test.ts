import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GAME_LENGTH, buildPool, factRounds, higherRound, pickGame, points, statusRounds, trapRound, verdictLine, type RegionDoc } from "./game.ts";

// The committed offline copy: the same files the /play page reads at build time.
const doc = (id: string) => JSON.parse(readFileSync(new URL(`../public/cache/${id}.json`, import.meta.url), "utf8")) as RegionDoc;
const delta = doc("nile-delta"), rio = doc("rio-negro");
const week = { dates: ["27 Oct", "3 Nov 2026"] as [string, string], modis: 58127, viirs: 300095 };

function seeded(seed: number) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

test("every round's answer is one of its choices, and ids are unique", () => {
  const pool = buildPool([delta, rio], week);
  assert.ok(pool.length >= 14, `pool has ${pool.length}`);
  for (const r of pool) assert.ok(r.choices.some((c) => c.id === r.answer), r.id);
  assert.equal(new Set(pool.map((r) => r.id)).size, pool.length);
});

test("status rounds use the real /stats answer and hide the month from its hint", () => {
  const rounds = statusRounds(delta);
  assert.ok(new Set(rounds.map((r) => r.answer)).size >= 3);
  for (const r of rounds) {
    const month = r.link!.split("month=")[1];
    const s = delta.stats[month];
    assert.equal(r.answer, s.status);
    assert.ok(r.prompt.includes(Math.round(s.value).toLocaleString("en-US")), r.prompt);
    assert.equal(r.hint?.type, "strip");
    if (r.hint?.type === "strip") assert.ok(!r.hint.past.some((p) => p.year === Number(month.slice(0, 4))));
  }
  assert.ok(rounds.some((r) => r.id.endsWith("-case") && r.answer === delta.stats[delta.region.default_month].status));
});

test("the higher-or-lower round is a real case where raw counts point the wrong way", () => {
  const r = higherRound(rio) ?? higherRound(delta);
  assert.ok(r, "no such case in the demo data");
  if (r!.reveal.type !== "bars") throw new Error("bars expected");
  const [raw, ours] = r!.reveal.groups;
  assert.ok(raw.bars[1].value > raw.bars[0].value);     // raw: the VIIRS year looks bigger
  assert.ok(ours.bars[0].value > ours.bars[1].value);   // ours: the MODIS-era year burned more
  assert.equal(r!.answer, r!.choices[0].id);
});

test("the trap round: raw jumps at 2012, ours doesn't", () => {
  const r = trapRound(delta) ?? trapRound(rio);
  assert.ok(r);
  if (r!.reveal.type !== "trap") throw new Error("trap expected");
  const { raw, ours } = r!.reveal;
  assert.ok(raw[1] / raw[0] > ours[1] / ours[0]);
  assert.equal(r!.answer, "no");
});

test("the week round's right answer is the real VIIRS count", () => {
  const r = factRounds(week).find((x) => x.id === "fact-week")!;
  assert.equal(r.choices.find((c) => c.id === r.answer)!.label, "300,095");
  assert.equal(factRounds(null).some((x) => x.id === "fact-week"), false);
});

test("a game has 7 different rounds, a status round first", () => {
  const pool = buildPool([delta, rio], week);
  for (let s = 1; s < 30; s++) {
    const g = pickGame(pool, seeded(s));
    assert.equal(g.length, GAME_LENGTH);
    assert.equal(new Set(g.map((r) => r.id)).size, GAME_LENGTH);
    assert.equal(g[0].kind, "status");
  }
  assert.deepEqual(pickGame(pool, seeded(7)).map((r) => r.id), pickGame(pool, seeded(7)).map((r) => r.id));
});

test("points and the closing line", () => {
  assert.equal(points(0), 100);
  assert.equal(points(3), 175);
  assert.match(verdictLine(7, 7, false), /Every one right/);
  assert.match(verdictLine(2, 4, true), /Out of embers/);
});
