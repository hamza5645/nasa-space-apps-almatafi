import assert from "node:assert/strict";
import { test } from "node:test";
import type { Stats } from "./api.ts";
import { ASK, FACTS, contextLines, highlights, pageOf } from "./wel3a.ts";
import { LIMITS, answerText, messages, parseChat, recentTurns, type Turn } from "./wel3a-chat.ts";

function stats(extra: Partial<Stats> = {}): Stats {
  const past = [200, 220, 236, 250, 300];
  return {
    month: "2026-10", value: 589,
    baseline: { years: [2001, 2005], n_years: past.length, mean: null, median: 236, sd: null, min: null, max: null,
                values: past.map((value, i) => ({ year: 2001 + i, value })) },
    percentile: null, rank: 1, z: null, ratio_to_median: null, status: "unusual_high", partial: null, trend: null,
    meta: { data_version: "real-20261113", generated_at: "" },
    ...extra,
  };
}
const sel = { label: "Nile Delta, Egypt", view: "harmonized", metric: "detections" } as const;

test("pageOf maps every route to its page", () => {
  assert.equal(pageOf("/"), "home");
  assert.equal(pageOf("/explore"), "explore");
  assert.equal(pageOf("/explore/"), "explore");
  assert.equal(pageOf("/method"), "method");
  assert.equal(pageOf("/play"), "play");
  assert.equal(pageOf("/nope"), "home");
});

test("every page has tips and questions that fit the bubble and the request", () => {
  for (const page of ["home", "explore", "method", "play"] as const) {
    assert.ok(FACTS[page].length >= 3, page);
    for (const tip of FACTS[page]) assert.ok(tip.length <= LIMITS.line, tip);
    assert.equal(ASK[page].length, 3);
    for (const q of ASK[page]) assert.ok(q.length <= LIMITS.question, q);
  }
});

test("highlights lead with the selected month's verdict for the area", () => {
  const [first, ...rest] = highlights(stats(), sel);
  assert.equal(first, "Nile Delta, Egypt. October 2026: 589 hotspots. Unusually high: 2.5 times a typical October, and the most for October in 6 years.");
  assert.deepEqual(rest, []);
});

test("a long place name leaves room for the verdict in a context line", () => {
  const [first] = highlights(stats(), { ...sel, label: "Municipio de ".repeat(20) });
  assert.ok(first.length <= LIMITS.line, String(first.length));
  assert.match(first, /…\. October 2026: 589 hotspots\. .*in 6 years\.$/);
});

test("highlights warn about raw views, unfinished months and the Terra-only months", () => {
  assert.match(highlights(stats(), { ...sel, view: "modis" }).at(-1)!, /raw MODIS view.*2012/);
  assert.match(highlights(stats(), { ...sel, view: "viirs" }).at(-1)!, /raw VIIRS view/);
  assert.match(highlights(stats({ partial: { days_observed: 13, comparison: "" } }), sel)[1], /isn't over/);
  assert.match(highlights(stats({ month: "2002-06" }), sel)[1], /Terra/);
  assert.equal(highlights(stats({ month: "2002-07" }), sel).length, 1);
});

test("contextLines describe the page, the tip on screen and simulated data", () => {
  const lines = contextLines("explore", "A tip.", highlights(stats(), sel), "mock-20261113");
  assert.equal(lines[0], "The visitor is on the explorer page.");
  assert.ok(lines.some((l) => l.includes("589 hotspots")));
  assert.ok(lines.some((l) => l.includes("simulated")));
  assert.ok(lines.includes("Wel3a's bubble currently says: A tip."));
  assert.ok(!contextLines("home", "A tip.", [], "real-1").some((l) => l.includes("simulated")));
  for (const l of lines) assert.ok(l.length <= LIMITS.line);
});

test("parseChat accepts a question and trims it", () => {
  assert.deepEqual(parseChat({ question: "  Why 2012?  " }), { question: "Why 2012?", history: [], context: [] });
});

test("parseChat refuses what isn't a usable question", () => {
  for (const bad of [null, 3, [], {}, { question: "" }, { question: "   " }, { question: 7 }, { question: "x".repeat(LIMITS.question + 1) }]) {
    assert.equal(typeof parseChat(bad), "string", JSON.stringify(bad));
  }
});

test("parseChat keeps only recent, alternating turns that end with an answer", () => {
  const turn = (role: string, content: unknown) => ({ role, content });
  const r = parseChat({
    question: "q",
    history: [turn("assistant", "tip"), turn("user", "a"), turn("user", "b"), turn("assistant", "c"), turn("system", "x"),
              turn("user", 5), turn("user", "d")],
  });
  assert.ok(typeof r !== "string");
  assert.deepEqual(r.history, [{ role: "user", content: "a" }, { role: "assistant", content: "c" }]);

  const long = Array.from({ length: 20 }, (_, i) => turn(i % 2 ? "assistant" : "user", `t${i}`));
  const capped = parseChat({ question: "q", history: long });
  assert.ok(typeof capped !== "string");
  assert.equal(capped.history.length, LIMITS.history);
  assert.equal(capped.history[0].role, "user");
  assert.equal(capped.history.at(-1)!.content, "t19");

  const big = parseChat({ question: "q", history: [turn("user", "u".repeat(5000)), turn("assistant", "ok")] });
  assert.ok(typeof big !== "string");
  assert.equal(big.history[0].content.length, LIMITS.turn);
  assert.equal(typeof parseChat({ question: "q", history: "no" }), "string");
});

test("parseChat keeps a few short context lines and drops the rest", () => {
  const r = parseChat({ question: "q", context: ["a", 4, "", "y".repeat(999), ...Array(20).fill("z")] });
  assert.ok(typeof r !== "string");
  assert.equal(r.context.length, LIMITS.context);
  assert.equal(r.context[0], "a");
  assert.equal(r.context[1].length, LIMITS.line);
});

test("recentTurns sends what parseChat keeps, and a full request fits the body limit", () => {
  // Arabic: 2 bytes a letter. A long chat, the longest question and a full set of page notes.
  const log: Turn[] = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `${i} ` + "ح".repeat(900) }));
  const sent = { question: "س".repeat(LIMITS.question), history: recentTurns(log), context: Array(LIMITS.context).fill("ن".repeat(LIMITS.line)) };
  assert.ok(new TextEncoder().encode(JSON.stringify(sent)).length <= LIMITS.body);
  const kept = parseChat(sent);
  assert.ok(typeof kept !== "string");
  assert.deepEqual(kept.history, sent.history);
  assert.ok(kept.history.at(-1)!.content.startsWith("39 "));
});

test("messages keep the rules alone in the system message; page notes travel with the question", () => {
  const m = messages({ question: "Why 2012?", history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
                       context: ["The visitor is on the explorer page."] });
  assert.deepEqual(m.map((x) => x.role), ["system", "user", "assistant", "user"]);
  assert.match(m[0].content, /Wel3a/);
  assert.doesNotMatch(m[0].content, /The visitor is on the explorer page\./);
  assert.match(m.at(-1)!.content, /^Page notes .*\n- The visitor is on the explorer page\.\n\nThe visitor asks: Why 2012\?$/);
  assert.equal(messages({ question: "q", history: [], context: [] }).at(-1)!.content, "q");
});

test("answerText reads a Workers AI answer", () => {
  assert.equal(answerText({ choices: [{ message: { role: "assistant", content: "  Hello.  " } }] }), "Hello.");
  for (const bad of [null, "x", {}, { response: "Hi." }, { choices: [] }, { choices: [{ message: {} }] }, { choices: [{ message: { content: " " } }] }]) {
    assert.equal(answerText(bad), null, JSON.stringify(bad));
  }
});
