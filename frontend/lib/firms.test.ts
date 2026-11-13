import assert from "node:assert/strict";
import { test } from "node:test";
import type { Hotspots } from "./api.ts";
import { busiestDay, cloudText, footprintRing, footprints, gibsTiles, smokeLayer, trueColorLayer } from "./firms.ts";

const fc = (rows: [number, number, string, number | null, number | null][]): Hotspots => ({
  type: "FeatureCollection", total: rows.length, truncated: false, meta: { data_version: "x", generated_at: "x" },
  features: rows.map(([lon, lat, t, scan, track], i) => ({
    type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] },
    properties: { point_id: `p${i}`, sensor: "VIIRS", platform: "SNPP", acq_datetime_utc: t, daynight: "D", frp: 3,
                  confidence_class: "nominal", confidence_pct: null, fire_type: 0, brightness_k: 330,
                  scan_km: scan, track_km: track, cell_id: 1, source: "archive" },
  })),
});

test("footprint is scan × track km, like the backend's KML", () => {
  const r = footprintRing(31, 30, 1, 1)!;
  assert.equal(r.length, 5);
  assert.deepEqual(r[0], r[4]);
  const w = (r[1][0] - r[0][0]) * 111.32 * Math.cos(Math.PI / 6);
  const h = (r[2][1] - r[1][1]) * 110.57;
  assert.ok(Math.abs(w - 1) < 1e-9 && Math.abs(h - 1) < 1e-9);
  assert.equal(footprintRing(31, 30, null, 0.4), null);
  const f = footprints(fc([[31, 30, "2026-10-01T11:00:00Z", 0.4, 0.4], [31, 30, "2026-10-01T11:00:00Z", null, null]]));
  assert.equal(f.features.length, 1);
  assert.equal(f.features[0].properties!.point_id, "p0");
});

test("busiest day", () => {
  assert.equal(busiestDay(undefined), null);
  assert.equal(busiestDay(fc([[0, 0, "2026-10-02T01:00:00Z", 1, 1], [0, 0, "2026-10-05T11:00:00Z", 1, 1],
                              [0, 0, "2026-10-05T23:00:00Z", 1, 1], [0, 0, "2026-10-02T13:00:00Z", 1, 1]])), "2026-10-02");
  assert.equal(busiestDay(fc([[0, 0, "2026-10-09T01:00:00Z", 1, 1], [0, 0, "2026-10-05T11:00:00Z", 1, 1],
                              [0, 0, "2026-10-09T23:00:00Z", 1, 1]])), "2026-10-09");
});

test("the day's image comes from the satellite flying then", () => {
  assert.equal(trueColorLayer("2026-10-14")!.id, "VIIRS_NOAA20_CorrectedReflectance_TrueColor");
  assert.equal(trueColorLayer("2016-08-01")!.id, "VIIRS_SNPP_CorrectedReflectance_TrueColor");
  assert.equal(trueColorLayer("2010-10-01")!.id, "MODIS_Aqua_CorrectedReflectance_TrueColor");
  assert.equal(trueColorLayer("2001-03-01")!.id, "MODIS_Terra_CorrectedReflectance_TrueColor");
  assert.equal(trueColorLayer("1999-01-01"), null);
  assert.equal(trueColorLayer("2026-10"), null);
  assert.equal(smokeLayer("2026-10-14")!.id, "OMPS_NOAA20_NadirMapper_AerosolIndex_360");
  assert.equal(smokeLayer("2020-10-14")!.id, "OMPS_Aerosol_Index");
  assert.equal(smokeLayer("2008-10-14")!.id, "OMI_Aerosol_Index");
  assert.equal(smokeLayer("2002-10-14"), null);
  assert.equal(gibsTiles(trueColorLayer("2026-10-14")!, "2026-10-14"),
    "gibs://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/2026-10-14/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg");
});

test("cloud text", () => {
  assert.equal(cloudText(0.624), "62% cloud");
  assert.equal(cloudText(null), null);
});
