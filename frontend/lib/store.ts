// One shared selection (PLAN.md §8): area, period, view and selected month/hotspot.
// Every panel reads from here, so clicking a calendar cell updates the map and stats.

import { create } from "zustand";
import type { Aoi, HotspotProps, Metric, View } from "./api.ts";
import { bboxShape, type Shape } from "./geo.ts";

export type SelectedHotspot = HotspotProps & { lon: number; lat: number };

export type Selection = {
  aoi: Aoi;
  aoiLabel: string;
  shape: Shape | null;         // for drawing the area on the map
  adminRef: { country: string; level: number } | null; // where an admin AOI's outline comes from
  start: string;
  end: string | null;          // null = up to the newest month
  view: View;
  metric: Metric;
  month: string | null;        // selected calendar month, YYYY-MM
  hotspot: SelectedHotspot | null;
};

type Actions = {
  setAoi: (aoi: Aoi, label: string, opts?: { month?: string | null; shape?: Shape | null;
                                              adminRef?: Selection["adminRef"] }) => void;
  setRange: (start: string, end: string | null) => void;
  setView: (view: View) => void;
  setMetric: (metric: Metric) => void;
  selectMonth: (month: string | null) => void;
  selectHotspot: (h: SelectedHotspot | null) => void;
  replace: (s: Partial<Selection>) => void;
};

export const DEFAULT: Selection = {
  aoi: { type: "region", region_id: "nile-delta" },
  aoiLabel: "Nile Delta, Egypt",
  shape: bboxShape([29.9, 30.0, 32.3, 31.6]),
  adminRef: null,
  start: "2001-01",
  end: null,
  view: "harmonized",
  metric: "detections",
  month: "2026-10",
  hotspot: null,
};

export const useSelection = create<Selection & Actions>()((set) => ({
  ...DEFAULT,
  setAoi: (aoi, aoiLabel, opts = {}) => set((s) => ({
    aoi, aoiLabel, shape: opts.shape ?? null, adminRef: opts.adminRef ?? null, hotspot: null,
    month: opts.month === undefined ? s.month : opts.month,
  })),
  setRange: (start, end) => set({ start, end }),
  setView: (view) => set({ view, hotspot: null }),
  setMetric: (metric) => set({ metric }),
  selectMonth: (month) => set({ month, hotspot: null }),
  selectHotspot: (hotspot) => set({ hotspot }),
  replace: (s) => set(s),
}));
