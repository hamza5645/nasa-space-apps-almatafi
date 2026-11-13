// Data hooks over lib/api.ts. Query keys hold the whole request, so the same area and
// month are fetched once per session. Demo regions fall back to the offline copy.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type Aoi, type Metric, type View } from "./api.ts";
import { monthDays } from "./format.ts";
import { pickCalendar, pickHotspots, pickStats, withFallback } from "./offline.ts";

export function useRegions() {
  return useQuery({ queryKey: ["regions"], queryFn: ({ signal }) => api.regions(signal), staleTime: Infinity });
}

export function useCalendar(aoi: Aoi, start: string, end: string | null, view: View, metric: Metric) {
  const body = { aoi, start, end, view, metric };
  return useQuery({
    queryKey: ["calendar", body],
    queryFn: ({ signal }) => withFallback(() => api.calendar(body, signal), aoi, pickCalendar(view, metric, start, end)),
    placeholderData: keepPreviousData,
  });
}

export function useStats(aoi: Aoi, month: string | null, view: View, metric: Metric) {
  const body = { aoi, month: month ?? "", view, metric };
  return useQuery({
    queryKey: ["stats", body],
    queryFn: ({ signal }) => withFallback(() => api.stats(body, signal), aoi, pickStats(body.month, view, metric)),
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
    queryFn: ({ signal }) => withFallback(() => api.hotspots(body, signal), aoi, pickHotspots(month ?? "", sensors)),
    enabled: month !== null,
    retry: false,
  });
}
