import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api.ts";
import { pickCalendar, pickStats, withFallback } from "./offline.ts";

const cache = {
  region: "nile-delta",
  calendar: { harmonized: { detections: { meta: {}, max: 589 } } },
  stats: { "2026-10": { meta: {}, value: 589 } },
  hotspots: {},
};

function serveCache() {
  globalThis.fetch = (async (url: string) => {
    assert.equal(url, "/cache/nile-delta.json");
    return new Response(JSON.stringify(cache), { status: 200 });
  }) as typeof fetch;
}

const region = { type: "region", region_id: "nile-delta" } as const;

test("an outage on a demo region answers from the offline copy", async () => {
  serveCache();
  const r = await withFallback(async () => { throw new ApiError(0, "network", "down"); }, region,
                               pickStats("2026-10", "harmonized", "detections") as never);
  assert.deepEqual(r, { meta: {}, value: 589, offline: true });
});

test("a bad request, another area, or a request the copy can't answer still fails", async () => {
  serveCache();
  const bad = new ApiError(422, "too_large", "too big");
  await assert.rejects(withFallback(async () => { throw bad; }, region, pickStats("2026-10", "harmonized", "detections") as never), bad);
  const down = new ApiError(503, "data_unavailable", "x");
  await assert.rejects(withFallback(async () => { throw down; }, { type: "bbox", bbox: [0, 0, 1, 1] }, () => ({ meta: {} })), down);
  await assert.rejects(withFallback(async () => { throw down; }, region, pickCalendar("harmonized", "detections", "2010-01", null) as never), down);
});

test("a 405 (another app on the API's port) counts as an outage", async () => {
  serveCache();
  const other = new ApiError(405, "http", "Request failed (405).");
  const r = await withFallback(async () => { throw other; }, region, () => ({ meta: { from: "copy" } }));
  assert.deepEqual(r, { meta: { from: "copy" }, offline: true });
});

test("live answers pass straight through", async () => {
  const r = await withFallback(async () => ({ meta: { live: 1 } }), region, () => null);
  assert.deepEqual(r, { meta: { live: 1 } });
});

test("the cloud-corrected copy answers cloud-corrected requests (X27)", () => {
  const c = { ...cache, calendar_clouds: { meta: {}, max: 700 }, stats_clouds: { "2026-10": { meta: {}, value: 650 } } } as never;
  assert.deepEqual(pickCalendar("harmonized", "detections", "2001-01", null, true)(c), { meta: {}, max: 700 });
  assert.deepEqual(pickStats("2026-10", "harmonized", "detections", true)(c), { meta: {}, value: 650 });
  assert.deepEqual(pickStats("2026-10", "harmonized", "detections")(c), { meta: {}, value: 589 });
  // An older copy without them can't answer, so the error stands.
  assert.equal(pickStats("2026-10", "harmonized", "detections", true)(cache as never), undefined);
});
