// Offline fallback (PLAN.md §14.4): if the backend is asleep or down, the two demo regions
// still work from the static copy the backend wrote (backend/app/cache.py → public/cache/).

import { ApiError, type Aoi, type Calendar, type Hotspots, type Metric, type Stats, type View } from "./api.ts";

type RegionCache = {
  region: string;
  calendar: Record<string, Record<string, Calendar>>;
  stats: Record<string, Stats>;
  hotspots: Record<string, Hotspots | null>;
  /** X27: the cloud-corrected harmonized calendar and stats, when the backend had cloud data. */
  calendar_clouds?: Calendar;
  stats_clouds?: Record<string, Stats>;
};

const loaded = new Map<string, Promise<RegionCache | null>>();

export function regionCache(regionId: string, base = ""): Promise<RegionCache | null> {
  if (!/^[a-z0-9-]+$/.test(regionId)) return Promise.resolve(null);
  if (!loaded.has(regionId)) {
    const p = fetch(`${base}/cache/${regionId}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    loaded.set(regionId, p);
    // Only keep a copy that loaded; a failed fetch (a network blip) is tried again next time.
    p.then((c) => { if (!c) loaded.delete(regionId); });
  }
  return loaded.get(regionId)!;
}

/** Worth trying the copy: the server couldn't be reached or failed, not a bad request. A 405
 *  means whatever answers at the API's address isn't our API (another app on the port). */
export function isOutage(e: unknown): boolean {
  return e instanceof ApiError && (e.code === "network" || e.status >= 500 || e.status === 405);
}

export type Offline = { offline?: true };

/** Run `live`; on an outage, answer from the region's copy when there's one that fits. */
export async function withFallback<T extends { meta: object }>(
  live: () => Promise<T>, aoi: Aoi, pick: (c: RegionCache) => T | null | undefined, base = "",
): Promise<T & Offline> {
  try {
    return await live();
  } catch (e) {
    if (!isOutage(e) || aoi.type !== "region") throw e;
    const cache = await regionCache(aoi.region_id, base);
    const hit = cache ? pick(cache) : null;
    if (!hit) throw e;
    return { ...hit, offline: true };
  }
}

export const pickCalendar = (view: View, metric: Metric, start: string, end: string | null, clouds = false) => (c: RegionCache) =>
  start !== "2001-01" || end !== null ? null : clouds ? c.calendar_clouds : c.calendar[view]?.[metric];
export const pickStats = (month: string, view: View, metric: Metric, clouds = false) => (c: RegionCache) =>
  view !== "harmonized" || metric !== "detections" ? null : clouds ? c.stats_clouds?.[month] : c.stats[month];
export const pickHotspots = (month: string, sensors: string[]) => (c: RegionCache) =>
  sensors.length === 2 ? c.hotspots[month] : null;
