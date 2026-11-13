// Build-time reads of the committed offline copy (public/cache/), so the landing and method
// pages ship their numbers in the HTML (PLAN.md §14.2: no counters that start at 0).
// Server-only: uses the file system.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Validation } from "./api.ts";
import type { RegionDoc } from "./game.ts";

const CACHE = join(process.cwd(), "public", "cache");

function read<T>(name: string): T | null {
  try {
    return JSON.parse(readFileSync(join(CACHE, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export type MockTruth = { metric: string; regions: { region: string; raw_jump_vs_truth: number; harmonized_jump_vs_truth: number; corr_harmonized_truth: number }[] };

export function validation(): (Validation & { mock_truth?: MockTruth }) | null {
  return read("validation.json");
}

export function isMock(dataVersion: string | undefined): boolean {
  return !dataVersion || dataVersion.startsWith("mock");
}

export type FireWeek = {
  dates: [string, string];
  sensors: Record<"modis" | "viirs", { label: string; rows: number; detections: number; cells: number }>;
  ratio_viirs_vs_modis: number;
  regions: Record<string, { modis: number; viirs: number }>;
};

/** The landing globe's real FIRMS week (scripts/globe-fires.mjs). */
export function fireWeek(): FireWeek | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), "public", "globe", "fires.json"), "utf8")) as FireWeek;
  } catch {
    return null;
  }
}

export type MiniCalendar = { years: number[]; matrix: (number | null)[][]; max: number };

/** A demo region's harmonized calendar from the offline copy, for the landing's small preview. */
export function demoCalendar(id = "nile-delta"): MiniCalendar | null {
  const c = read<{ calendar: { harmonized: { detections: { years: number[]; matrix: (number | null)[][] } } } }>(`${id}.json`);
  const cal = c?.calendar?.harmonized?.detections;
  if (!cal) return null;
  const max = Math.max(...cal.matrix.flat().map((v) => v ?? 0));
  return { years: cal.years, matrix: cal.matrix, max };
}

export type CompareGrids = Record<"harmonized" | "modis" | "viirs", { years: number[]; matrix: (number | null)[][] }>;

/** A demo region's three detection calendars from the offline copy, for the slider (X33). */
export function demoCompare(id = "nile-delta"): CompareGrids | null {
  type Cal = { years: number[]; matrix: (number | null)[][] };
  const c = read<{ calendar: Record<"harmonized" | "modis" | "viirs", { detections?: Cal }> }>(`${id}.json`);
  const h = c?.calendar?.harmonized?.detections, m = c?.calendar?.modis?.detections, v = c?.calendar?.viirs?.detections;
  if (!h || !m || !v) return null;
  const pick = (x: Cal) => ({ years: x.years, matrix: x.matrix });
  return { harmonized: pick(h), modis: pick(m), viirs: pick(v) };
}

/** The demo regions' offline copies, as the game's round builder reads them (X33). */
export function gameDocs(ids = ["nile-delta", "rio-negro"]): RegionDoc[] {
  return ids.map((id) => read<RegionDoc>(`${id}.json`)).filter((d): d is RegionDoc => Boolean(d?.stats && d?.calendar));
}

/** Whether a file is in public/media/ (generated media that may not be made yet, X27). */
export function hasMedia(name: string): boolean {
  return /^[\w.-]+$/.test(name) && existsSync(join(process.cwd(), "public", "media", name));
}
