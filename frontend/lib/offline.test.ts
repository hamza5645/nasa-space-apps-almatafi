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

test("live answers pass straight through", async () => {
  const r = await withFallback(async () => ({ meta: { live: 1 } }), region, () => null);
  assert.deepEqual(r, { meta: { live: 1 } });
});
