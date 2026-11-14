// Data hooks over lib/api.ts. Query keys hold the whole request, so the same area and
// month are fetched once per session.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type Aoi, type Metric, type View } from "./api.ts";
import { monthDays } from "./format.ts";

export function useRegions() {
  return useQuery({ queryKey: ["regions"], queryFn: ({ signal }) => api.regions(signal), staleTime: Infinity });
}

/** The cloud correction applies to harmonized hotspots only (backend X27). */
export const cloudsApply = (view: View, metric: Metric, clouds: boolean) => clouds && view === "harmonized" && metric === "detections";

export function useCalendar(aoi: Aoi, start: string, end: string | null, view: View, metric: Metric, clouds = false) {
  const fix = cloudsApply(view, metric, clouds);
  const body = { aoi, start, end, view, metric, ...(fix ? { clouds: "correct" as const } : {}) };
  return useQuery({
    queryKey: ["calendar", body],
    queryFn: ({ signal }) => api.calendar(body, signal),
    placeholderData: keepPreviousData,
  });
}

export function useStats(aoi: Aoi, month: string | null, view: View, metric: Metric, clouds = false) {
  const fix = cloudsApply(view, metric, clouds);
  const body = { aoi, month: month ?? "", view, metric, ...(fix ? { clouds: "correct" as const } : {}) };
  return useQuery({
    queryKey: ["stats", body],
    queryFn: ({ signal }) => api.stats(body, signal),
    enabled: month !== null,
  });
}

export function sensorsFor(view: View): ("MODIS" | "VIIRS")[] {
  // Raw views show only that sensor's points; harmonized shows both.
  return view === "modis" ? ["MODIS"] : view === "viirs" ? ["VIIRS"] : ["MODIS", "VIIRS"];
}

export function useHotspots(aoi: Aoi, month: string | null, view: View) {
  const [start, end] = month ? monthDays(month) : ["", ""];
  const sensors = sensorsFor(view);
  const body = { aoi, start, end, sensors, limit: 5000 };
  return useQuery({
    queryKey: ["hotspots", body],
    queryFn: ({ signal }) => api.hotspots(body, signal),
    enabled: month !== null,
    retry: false,
  });
}
