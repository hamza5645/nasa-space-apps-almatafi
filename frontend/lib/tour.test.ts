import assert from "node:assert/strict";
import { test } from "node:test";
import { NARRATE_STEPS, NARRATE_KEY, STEPS, TOUR_KEY, place } from "./tour.ts";

const view = { w: 1000, h: 700 }, card = { width: 320, height: 160 };

test("steps are unique and complete", () => {
  assert.equal(new Set(STEPS.map((s) => s.id)).size, STEPS.length);
  for (const s of STEPS) assert.ok(s.title && s.text.length > 20, s.id);
});

test("the narration stepper has its own key and points at the button", () => {
  assert.notEqual(NARRATE_KEY, TOUR_KEY);
  assert.ok(NARRATE_STEPS.length >= 2);
  for (const s of NARRATE_STEPS) { assert.equal(s.id, "narrate"); assert.ok(s.title && s.text.length > 20); }
  assert.ok(NARRATE_STEPS.some((s) => /caption/i.test(s.text)), "says the words show as captions");
  assert.ok(NARRATE_STEPS.some((s) => /remembered/i.test(s.text)), "says the choice is remembered");
});

test("the card goes on the preferred side when it fits, else the opposite", () => {
  const p = place({ top: 20, left: 100, width: 200, height: 40 }, card, view, "bottom");
  assert.equal(p.side, "bottom"); assert.equal(p.top, 74); assert.equal(p.left, 40);
  const q = place({ top: 600, left: 100, width: 200, height: 40 }, card, view, "bottom");
  assert.equal(q.side, "top"); assert.equal(q.top, 600 - 14 - 160);
  const r = place({ top: 300, left: 0, width: 300, height: 200 }, card, view, "left");
  assert.equal(r.side, "right"); assert.equal(r.left, 314);
});

test("the card never leaves the viewport", () => {
  const p = place({ top: 10, left: 950, width: 40, height: 30 }, card, view, "bottom");
  assert.ok(p.left + card.width <= view.w - 12 && p.left >= 12);
  const q = place({ top: 350, left: 400, width: 200, height: 1200 }, card, view, "right");
  assert.ok(q.top >= 12 && q.top + card.height <= view.h - 12);
});
