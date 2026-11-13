// The Worker's request handling (worker/index.ts), with stand-ins for its three bindings.

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import worker, { AnswerBudget } from "../worker/index.ts";
import { DAILY_ANSWERS, LIMITS } from "./wel3a-chat.ts";

const SITE = "https://almatafi.test";

function setup(over: { allowed?: boolean; budget?: number; ai?: () => Promise<unknown> } = {}) {
  const calls = { ai: 0, limit: 0, budget: 0 };
  const env = {
    ASSETS: { fetch: async () => new Response("a page") },
    AI: { run: async () => { calls.ai++; return over.ai ? over.ai() : { choices: [{ message: { content: " A hot pixel. " } }] }; } },
    WEL3A_LIMIT: { limit: async () => { calls.limit++; return { success: over.allowed ?? true }; } },
    WEL3A_BUDGET: { getByName: () => ({ fetch: async () => { calls.budget++; return new Response(null, { status: over.budget ?? 204 }); } }) },
  };
  return { env, calls };
}

function post(body: unknown, headers: Record<string, string> = { origin: SITE }): Request {
  return new Request(`${SITE}/api/wel3a`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

test("a question from the site's own page gets the model's answer", async () => {
  const { env, calls } = setup();
  const r = await worker.fetch(post({ question: "What is a hotspot?" }), env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { answer: "A hot pixel." });
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(calls.ai, 1);
  assert.equal(calls.budget, 1);
});

test("other paths are served as files, and only POST is accepted", async () => {
  const { env, calls } = setup();
  assert.equal(await (await worker.fetch(new Request(`${SITE}/api/other`), env)).text(), "a page");
  const get = await worker.fetch(new Request(`${SITE}/api/wel3a`), env);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal(calls.ai + calls.limit, 0);
});

test("requests from another site, or with no Origin, are refused before anything is spent", async () => {
  const { env, calls } = setup();
  assert.equal((await worker.fetch(post({ question: "q" }, { origin: "https://elsewhere.test" }), env)).status, 403);
  assert.equal((await worker.fetch(post({ question: "q" }, {}), env)).status, 403);
  assert.equal(calls.ai + calls.limit + calls.budget, 0);
});

test("a visitor over the rate limit is told to wait, and the model isn't called", async () => {
  const { env, calls } = setup({ allowed: false });
  const r = await worker.fetch(post({ question: "q" }), env);
  assert.equal(r.status, 429);
  assert.match((await r.json() as { error: string }).error, /minute/);
  assert.equal(calls.ai + calls.budget, 0);
});

test("when the day's answers are used up, the visitor is told and the model isn't called", async () => {
  const { env, calls } = setup({ budget: 429 });
  const r = await worker.fetch(post({ question: "q" }), env);
  assert.equal(r.status, 429);
  assert.match((await r.json() as { error: string }).error, /today/);
  assert.equal(calls.ai, 0);
});

test("the budget gives out a day's answers, then refuses until the next UTC day", async () => {
  const kept = new Map<string, { day: string; answers: number }>();
  const budget = new AnswerBudget({ storage: { get: async (k) => kept.get(k), put: async (k, v) => { kept.set(k, v); } } });
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 10, 13, 23, 59) });
  try {
    for (let i = 0; i < DAILY_ANSWERS; i++) assert.equal((await budget.fetch()).status, 204);
    assert.equal((await budget.fetch()).status, 429);
    assert.deepEqual(kept.get("spent"), { day: "2026-11-13", answers: DAILY_ANSWERS });
    mock.timers.tick(60_000);   // 00:00 UTC
    assert.equal((await budget.fetch()).status, 204);
    assert.deepEqual(kept.get("spent"), { day: "2026-11-14", answers: 1 });
  } finally { mock.timers.reset(); }
});

test("oversized, malformed and empty requests are refused without calling the model", async () => {
  const { env, calls } = setup();
  assert.equal((await worker.fetch(post("x".repeat(LIMITS.body + 1)), env)).status, 413);
  assert.equal((await worker.fetch(post("x", { origin: SITE, "content-length": String(LIMITS.body + 1) }), env)).status, 413);
  assert.equal((await worker.fetch(post("{not json"), env)).status, 400);
  assert.equal((await worker.fetch(post({ question: "  " }), env)).status, 400);
  assert.equal(calls.ai + calls.budget, 0);
});

test("when the model fails or says nothing, the answer is a 502", async () => {
  const error = console.error;
  console.error = () => {};   // the handler logs these; keep the test output clean
  try {
    assert.equal((await worker.fetch(post({ question: "q" }), setup({ ai: async () => { throw new Error("out of neurons"); } }).env)).status, 502);
    assert.equal((await worker.fetch(post({ question: "q" }), setup({ ai: async () => ({ choices: [] }) }).env)).status, 502);
  } finally { console.error = error; }
});
