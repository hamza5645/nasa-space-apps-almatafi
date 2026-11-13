// Number, month and colour helpers shared by the calendar, stats and map.

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

/** Lightness-ordered ember ramp (dark → bright, inferno-like), readable for colour-blind viewers. */
export const RAMP = ["#3A1F2B", "#5E2236", "#8C2B35", "#C2412C", "#E9702A", "#F7A43C", "#FFDA7A"];
export const ZERO = "#262019";

export function ym(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseYm(s: string): [number, number] {
  const [y, m] = s.split("-").map(Number);
  return [y, m];
}

export function monthLabel(s: string, long = true): string {
  const [y, m] = parseYm(s);
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}

/** First and last day of a month, as YYYY-MM-DD. */
export function monthDays(s: string): [string, string] {
  const [y, m] = parseYm(s);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${s}-01`, `${s}-${String(last).padStart(2, "0")}`];
}

/** Full number with thousands separators, e.g. 12,345 or 3.4. */
export function fmt(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Short number for calendar cells: 987, 1.2k, 12k, 1.2M. */
export function short(v: number): string {
  const a = Math.abs(v);
  if (a < 1000) return String(Math.round(v));
  if (a < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (a < 1_000_000) return `${Math.round(v / 1000)}k`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Ramp index for a value: square-root scale, so quiet months still show some colour. */
export function rampIndex(v: number, max: number): number {
  if (v <= 0 || max <= 0) return -1;
  return Math.min(RAMP.length - 1, Math.floor(Math.sqrt(v / max) * RAMP.length));
}

export function cellColor(v: number | null, max: number): string | null {
  if (v === null) return null;
  const i = rampIndex(v, max);
  return i < 0 ? ZERO : RAMP[i];
}

/** Text colour that stays readable on a ramp colour (dark ink on the bright end). */
export function inkOn(v: number | null, max: number): string {
  return v !== null && rampIndex(v, max) >= 4 ? "#1C0F04" : "#F2EBE1";
}

export const STATUS = {
  unusual_high: { label: "Unusual: well above normal", bg: "#4A1C08", ink: "#FFB27A" },
  above_normal: { label: "Above normal", bg: "#3A2C10", ink: "#FFD58A" },
  normal: { label: "Within normal range", bg: "#16263F", ink: "#A9C8FF" },
  below_normal: { label: "Below normal", bg: "#10283A", ink: "#8FD3FF" },
} as const;

export const ORIGIN: Record<string, string> = {
  observed: "observed by VIIRS S-NPP",
  observed_snpp: "observed by VIIRS S-NPP",
  filled_noaa21: "filled from VIIRS NOAA-21 (S-NPP gap)",
  converted_aqua: "converted from MODIS Aqua",
  converted_terra: "converted from MODIS Terra",
  filled_noaa20: "filled from VIIRS NOAA-20 (S-NPP gap)",
};

/** "2026-10-14T11:24:00Z" → "14 Oct 2026, 11:24 UTC" */
export function utcLabel(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}
