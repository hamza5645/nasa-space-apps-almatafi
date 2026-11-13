// Typed client for the backend (contracts/api.md, contracts/openapi.json).
// Request types come from the generated lib/api-types.ts; the backend returns plain
// dicts, so response types are written here from api.md and the backend code.

import type { components } from "./api-types.ts";

type Schemas = components["schemas"];
export type Aoi =
  | Schemas["PolygonAoi"] | Schemas["BboxAoi"] | Schemas["PointAoi"] | Schemas["AdminAoi"] | Schemas["RegionAoi"];
export type CalendarRequest = Schemas["CalendarRequest"];
export type StatsRequest = Schemas["StatsRequest"];
export type HotspotsRequest = Schemas["HotspotsRequest"];
export type NrtRequest = Schemas["NrtRequest"];
export type ExportRequest = Schemas["ExportRequest"];

export type View = "harmonized" | "modis" | "viirs";
export type Metric = "detections" | "fire_days";
export type Status = "unusual_high" | "above_normal" | "normal" | "below_normal";
export type Origin = "observed" | "converted_aqua" | "converted_terra" | "filled_noaa20" | string;

export type AoiMeta = { area_km2: number; cells: number; bbox: [number, number, number, number]; coarse_warning: boolean };
export type Meta = { data_version: string; generated_at: string; aoi?: AoiMeta; fetched_at?: string };

export type Region = {
  region_id: string; name: string; country: string;
  bbox: [number, number, number, number];
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  default_month: string; story: string;
};

export type Calendar = {
  view: View; metric: Metric; unit: string;
  years: number[]; months: number[];
  /** matrix[yearIndex][monthIndex]; null = not observed, 0 = observed, nothing detected. */
  matrix: (number | null)[][];
  origin?: (Origin | null)[][];
  year_totals: (number | null)[]; month_medians: (number | null)[];
  max: number | null;
  partial_month: { month: string; days_observed: number } | null;
  meta: Meta;
};

export type Stats = {
  month: string; value: number;
  baseline: {
    years: [number, number]; n_years: number;
    mean: number | null; median: number | null; sd: number | null; min: number | null; max: number | null;
    values: { year: number; value: number }[];
  };
  percentile: number | null; rank: number | null; z: number | null; ratio_to_median: number | null;
  status: Status | null;
  partial: { days_observed: number; comparison: string } | null;
  trend: { sen_slope_per_year: number | null; p_value: number | null; series: string } | null;
  meta: Meta;
};

export type HotspotProps = {
  point_id: string; sensor: "MODIS" | "VIIRS"; platform: string;
  acq_datetime_utc: string; daynight: "D" | "N";
  frp: number | null; confidence_class: "low" | "nominal" | "high"; confidence_pct: number | null;
  fire_type: number | null; brightness_k: number | null; scan_km: number | null; track_km: number | null;
  cell_id: number; source: string;
};
export type Hotspots = GeoJSON.FeatureCollection<GeoJSON.Point, HotspotProps> & {
  total: number; truncated: boolean; source?: "nrt";
  /** Detections per satellite, before any `platforms` filter (backend X13). */
  by_platform?: Record<string, number>;
  /** Fetched live from the FIRMS area API: the area has no stored points (backend X10). */
  on_demand?: boolean;
  meta: Meta;
};

export type Place = {
  name: string; display_name: string; kind: string | null;
  centroid: [number, number]; bbox: [number, number, number, number];
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
};

export type Validation = {
  data_version: string; metric: Metric; model: string;
  overlap_period: [string, string]; cross_validation: string; unit_of_scoring?: string;
  overall: { r2: number; bias: number; mae: number; rmse: number; n: number };
  by_model: { model: string; r2: number; bias: number; mae: number; rmse: number; r2_1deg?: number | null }[];
  break_test: {
    raw_ratio_after_vs_before_2012: number; harmonized_ratio_after_vs_before_2012: number;
    pettitt_p_raw: number; pettitt_p_harmonized: number;
    /** X14: the same ratio at fake break years. */
    placebo_ratios_harmonized?: Record<string, number>;
  };
  season_check?: { corr_month_shares: number; peak_month_before: number; peak_month_after: number };
  series: { years: number[]; raw: number[]; harmonized: number[] };
  scatter_sample: [number, number][];
  strata: { total: number; fallback_used: number };
};

export type AdminAreas = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { admin_id: string; name: string | null; level?: number; country?: string }> & { meta: Meta };

export type Health = {
  status: string; data_version: string; uptime_s: number;
  sources: { harmonized: boolean; points: boolean; nrt: boolean };
};

/** The backend's error body (api.md §1.5), or a network failure (`code: "network"`). */
export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  // No parameter properties: Node's type stripping (npm test) doesn't support them.
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

async function call<T>(path: string, init?: RequestInit, base = API_URL): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, init);
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? "http_error", e?.message ?? `Request failed (${res.status}).`, e?.details ?? {});
  }
  return res.json() as Promise<T>;
}

function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
}

export const api = {
  health: (signal?: AbortSignal) => call<Health>("/api/health", { signal }),
  regions: (signal?: AbortSignal) => call<{ regions: Region[]; meta: Meta }>("/api/regions", { signal }),
  calendar: (body: CalendarRequest, signal?: AbortSignal) => post<Calendar>("/api/calendar", body, signal),
  stats: (body: StatsRequest, signal?: AbortSignal) => post<Stats>("/api/stats", body, signal),
  hotspots: (body: HotspotsRequest, signal?: AbortSignal) => post<Hotspots>("/api/hotspots", body, signal),
  nrt: (body: NrtRequest, signal?: AbortSignal) => post<Hotspots>("/api/nrt", body, signal),
  search: (q: string, signal?: AbortSignal) =>
    call<{ results: Place[]; meta: Meta }>(`/api/search?q=${encodeURIComponent(q)}&limit=5`, { signal }),
  validation: (signal?: AbortSignal) => call<Validation>("/api/validation", { signal }),
  admin: (country: string, level: number, signal?: AbortSignal) =>
    call<AdminAreas>(`/api/admin?country=${encodeURIComponent(country)}&level=${level}`, { signal }),
  /** Full URL for a file download; the browser posts the form itself (see lib/download.ts). */
  exportUrl: () => `${API_URL}/api/export`,
};
