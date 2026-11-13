// X27: what NASA FIRMS's own map shows that the explorer didn't: each detection's pixel
// footprint, the day's satellite image and its smoke. Pure functions, so they're tested
// (lib/firms.test.ts); MapView draws them.

import type { Hotspots } from "./api.ts";

/** The pixel's ground footprint: scan × track km around the centre, scan east-west and
 *  track north-south (polar orbits; an approximation, like FIRMS's footprint KMZ files).
 *  Same as the backend's KML export (backend/app/export.py `footprint`). */
export function footprintRing(lon: number, lat: number, scanKm: number | null, trackKm: number | null): [number, number][] | null {
  if (!scanKm || !trackKm) return null;
  const dlon = scanKm / 2 / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const dlat = trackKm / 2 / 110.57;
  return [[lon - dlon, lat - dlat], [lon + dlon, lat - dlat], [lon + dlon, lat + dlat], [lon - dlon, lat + dlat], [lon - dlon, lat - dlat]];
}

export function footprints(fc: Hotspots | undefined): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (const f of fc?.features ?? []) {
    const [lon, lat] = f.geometry.coordinates;
    const ring = footprintRing(lon, lat, f.properties.scan_km, f.properties.track_km);
    if (ring) features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] },
                              properties: { point_id: f.properties.point_id, frp: f.properties.frp ?? 0, sensor: f.properties.sensor } });
  }
  return { type: "FeatureCollection", features };
}

/** The UTC day with the most detections, YYYY-MM-DD (the earliest on a tie). */
export function busiestDay(fc: Hotspots | undefined): string | null {
  const n = new Map<string, number>();
  for (const f of fc?.features ?? []) {
    const d = f.properties.acq_datetime_utc.slice(0, 10);
    n.set(d, (n.get(d) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [d, k] of [...n.entries()].sort()) if (best === null || k > n.get(best)!) best = d;
  return best;
}

export type GibsLayer = { id: string; label: string; level: 6 | 9; ext: "jpg" | "png" };

// NASA GIBS daily layers (epsg3857 "best"), checked in GIBS's capabilities on Nov 13, 2026.
// Newest first: the first one flying on that day wins.
const TRUE_COLOR: [string, GibsLayer][] = [
  ["2018-01-05", { id: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", label: "VIIRS NOAA-20", level: 9, ext: "jpg" }],
  ["2015-11-24", { id: "VIIRS_SNPP_CorrectedReflectance_TrueColor", label: "VIIRS Suomi NPP", level: 9, ext: "jpg" }],
  ["2002-07-03", { id: "MODIS_Aqua_CorrectedReflectance_TrueColor", label: "MODIS Aqua", level: 9, ext: "jpg" }],
  ["2000-02-24", { id: "MODIS_Terra_CorrectedReflectance_TrueColor", label: "MODIS Terra", level: 9, ext: "jpg" }],
];
// Smoke: the UV aerosol index (above about 1, absorbing aerosols such as smoke and dust).
// Suomi NPP's OMPS stopped with the satellite on Nov 2, 2026.
const SMOKE: [string, string, GibsLayer][] = [
  ["2025-04-28", "9999-12-31", { id: "OMPS_NOAA20_NadirMapper_AerosolIndex_360", label: "OMPS NOAA-20 aerosol index", level: 6, ext: "png" }],
  ["2012-01-26", "2026-11-02", { id: "OMPS_Aerosol_Index", label: "OMPS Suomi NPP aerosol index", level: 6, ext: "png" }],
  ["2004-10-01", "9999-12-31", { id: "OMI_Aerosol_Index", label: "OMI Aura aerosol index", level: 6, ext: "png" }],
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function trueColorLayer(day: string): GibsLayer | null {
  if (!DAY.test(day)) return null;
  return TRUE_COLOR.find(([from]) => day >= from)?.[1] ?? null;
}

export function smokeLayer(day: string): GibsLayer | null {
  if (!DAY.test(day)) return null;
  return SMOKE.find(([from, to]) => day >= from && day <= to)?.[2] ?? null;
}

/** Tile URL template for MapLibre (through MapView's `gibs://` loader). */
export function gibsTiles(layer: GibsLayer, day: string): string {
  return `gibs://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer.id}/default/${day}/GoogleMapsCompatible_Level${layer.level}/{z}/{y}/{x}.${layer.ext}`;
}

/** The share of cloud as words for labels: "62% cloud". */
export function cloudText(fraction: number | null | undefined): string | null {
  return fraction == null ? null : `${Math.round(fraction * 100)}% cloud`;
}
