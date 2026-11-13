// Run with: npm test (node --test, Node 22.18+ strips the types itself)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, api } from "./api.ts";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

test("posts JSON to the backend", async () => {
  const calls = fakeFetch(200, { matrix: [] });
  await api.calendar({ aoi: { type: "region", region_id: "nile-delta" }, start: "2001-01" });
  assert.equal(calls[0].url, "http://localhost:8000/api/calendar");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { aoi: { type: "region", region_id: "nile-delta" }, start: "2001-01" });
});

test("turns the api.md error body into an ApiError", async () => {
  fakeFetch(422, { error: { code: "too_large", message: "Area is 812 000 km².", details: { area_km2: 812000 } } });
  await assert.rejects(api.stats({ aoi: { type: "bbox", bbox: [0, 0, 10, 10] }, month: "2026-07" }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 422);
    assert.equal(e.code, "too_large");
    assert.equal(e.details.area_km2, 812000);
    return true;
  });
});

test("network failures and non-JSON errors still give an ApiError", async () => {
  globalThis.fetch = (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch;
  await assert.rejects(api.health(), (e: unknown) => e instanceof ApiError && e.code === "network");
  globalThis.fetch = (async () => new Response("<html>502</html>", { status: 502 })) as typeof fetch;
  await assert.rejects(api.health(), (e: unknown) => e instanceof ApiError && e.status === 502 && e.code === "http_error");
});

test("search escapes the query", async () => {
  const calls = fakeFetch(200, { results: [] });
  await api.search("Kafr El Sheikh & co");
  assert.equal(calls[0].url, "http://localhost:8000/api/search?q=Kafr%20El%20Sheikh%20%26%20co&limit=5");
});
