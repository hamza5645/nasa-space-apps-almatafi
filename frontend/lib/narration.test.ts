import assert from "node:assert/strict";
import { test } from "node:test";
import { NARRATION, chapterInView } from "./narration.ts";

test("eight lines, one per chapter, in order", () => {
  assert.deepEqual(NARRATION.map((n) => n.chapter), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(NARRATION.map((n) => n.id), ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7"]);
});

test("the chapter in view is the one nearest the middle, if enough of it shows", () => {
  const H = 800;
  assert.equal(chapterInView([{ top: -600, bottom: 200 }, { top: 200, bottom: 1000 }, { top: 1000, bottom: 1800 }], H), 1);
  assert.equal(chapterInView([{ top: 0, bottom: 100 }, { top: 900, bottom: 1700 }], H), -1);   // nothing is 35 % tall on screen
  assert.equal(chapterInView([{ top: -100, bottom: 700 }, { top: 700, bottom: 1500 }], H), 0);
});
