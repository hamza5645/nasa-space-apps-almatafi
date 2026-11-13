// Which satellite a calendar month counts, so the map can show the same detections.
// Mirrors backend/app/series.py `reference_platform`.

import type { View } from "./api.ts";

export const PLATFORM_LABEL: Record<string, string> = {
  Terra: "Terra", Aqua: "Aqua", SNPP: "Suomi NPP", NOAA20: "NOAA-20", NOAA21: "NOAA-21",
};
export const PLATFORM_ORDER = ["SNPP", "NOAA20", "NOAA21", "Aqua", "Terra"];

const AQUA_FIRST = "2002-07";
const VIIRS_FIRST = "2012-02";
const SNPP_LAST = "2026-10"; // FIRMS: S-NPP data ceased on Nov 2, 2026

export function referencePlatform(view: View, month: string): string {
  if (view === "modis" || (view === "harmonized" && month < VIIRS_FIRST)) return month >= AQUA_FIRST ? "Aqua" : "Terra";
  return month <= SNPP_LAST ? "SNPP" : "NOAA20";
}

/** Detections per platform: the server's counts when it sent them, else counted here. */
export function countByPlatform(features: { properties: { platform: string } }[], server?: Record<string, number>) {
  if (server) return server;
  const out: Record<string, number> = {};
  for (const f of features) out[f.properties.platform] = (out[f.properties.platform] ?? 0) + 1;
  return out;
}
