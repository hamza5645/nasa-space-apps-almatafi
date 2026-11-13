import { test } from "node:test";
import assert from "node:assert/strict";
import type { Aoi } from "./api.ts";
import { decode, encode } from "./share.ts";

const NOW = new Date("2026-11-03T12:00:00Z");
const base = { adminRef: null, aoiLabel: "Nile Delta, Egypt", start: "2001-01", end: null, view: "harmonized", metric: "detections", month: "2026-10" } as const;

test("region links are short", () => {
  assert.equal(encode({ ...base, aoi: { type: "region", region_id: "nile-delta" } }), "region=nile-delta&month=2026-10");
});

test("every AOI type survives a round trip", () => {
  const polygon = { type: "Polygon", coordinates: [[[31, 30], [32, 30], [32, 31], [31, 30]]] };
  const aois: Aoi[] = [
    { type: "bbox", bbox: [29.9, 30, 32.3, 31.6] },
    { type: "point", lat: -40.8, lon: -69, radius_km: 150 },
    { type: "admin", admin_id: "EGY-ADM1-3_8" },
    { type: "polygon", geometry: polygon },
  ];
  for (const aoi of aois) {
    const s = { ...base, aoi, aoiLabel: "Kafr El Sheikh, Égypte", view: "modis" as const, metric: "fire_days" as const, end: "2020-12" };
    const back = decode(encode(s), NOW);
    assert.deepEqual(back.aoi, aoi);
    assert.equal(back.aoiLabel, "Kafr El Sheikh, Égypte");
    assert.deepEqual([back.view, back.metric, back.month, back.end], ["modis", "fire_days", "2026-10", "2020-12"]);
  }
});

test("junk in a link is ignored", () => {
  assert.deepEqual(decode("bbox=1,2,x,4&point=1,2&month=2026-13&view=evil&metric=x&region=../../etc&shape=!!!", NOW), {});
  assert.deepEqual(decode("shape=" + btoa(JSON.stringify({ type: "Point", coordinates: [0, 0] })), NOW), {});
  assert.deepEqual(decode("shape=" + btoa(JSON.stringify({ type: "Polygon", coordinates: [1] })), NOW), {});
});

test("months the backend would refuse are dropped", () => {
  assert.deepEqual(decode("region=rio-negro&month=2026-12&from=2000-01&to=2026-12", NOW), {
    aoi: { type: "region", region_id: "rio-negro" }, aoiLabel: "" });
  assert.equal(decode("region=x&from=2000-11&to=2026-11", NOW).end, "2026-11");
});

test("admin links carry the country and level", () => {
  const q = encode({ ...base, aoi: { type: "admin", admin_id: "ARG-ADM1-9" }, aoiLabel: "Mendoza, ARG",
                     adminRef: { country: "ARG", level: 1 } });
  assert.deepEqual(decode(q, NOW).adminRef, { country: "ARG", level: 1 });
  assert.equal(decode("admin=X&ac=evil&al=7", NOW).adminRef, undefined);
});

test("the cloud correction is in the link only when on (X27)", () => {
  const aoi = { type: "region", region_id: "nile-delta" } as const;
  assert.equal(encode({ ...base, aoi, clouds: true }), "region=nile-delta&month=2026-10&clouds=1");
  assert.equal(decode("region=nile-delta&clouds=1", NOW).clouds, true);
  assert.equal(decode("region=nile-delta&clouds=yes", NOW).clouds, undefined);
});
