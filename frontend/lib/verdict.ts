// The plain-language answer at the top of the explorer: "is this month unusual here?"
// Pure functions over a /stats response, so the wording is tested (verdict.test.ts).

import type { Metric, Stats, View } from "./api.ts";
import { MONTHS_LONG, fmt, parseYm } from "./format.ts";

export type Verdict = { headline: string; detail: string; tone: "high" | "above" | "normal" | "below" | "none" };

const NOUN: Record<Metric, [string, string]> = { detections: ["hotspot", "hotspots"], fire_days: ["fire day", "fire days"] };

export function noun(metric: Metric, v: number, view: View = "harmonized"): string {
  const [one, many] = NOUN[metric];
  const word = Math.round(v) === 1 ? one : many;
  return view === "modis" ? `raw MODIS ${word}` : view === "viirs" ? `raw VIIRS ${word}` : word;
}

/** Linear-interpolated quantile, like numpy's default. */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** The middle half of past years: where a "typical" month falls. */
export function usualRange(stats: Stats): [number, number] | null {
  const v = stats.baseline.values.map((x) => x.value);
  const lo = quantile(v, 0.25), hi = quantile(v, 0.75);
  return lo === null || hi === null ? null : [lo, hi];
}

function times(r: number): string {
  if (r >= 10) return `${fmt(r)} times`;
  if (r >= 1.95) return `${fmt(r, 1)} times`;
  return `${fmt(Math.round(r * 100))}% of`;
}

export function verdict(stats: Stats, metric: Metric, view: View = "harmonized"): Verdict {
  const [y, m] = parseYm(stats.month);
  const month = MONTHS_LONG[m - 1];
  const v = stats.value;
  const b = stats.baseline;
  const years = b.n_years + 1;
  const headline = stats.partial
    ? `${month} ${y} so far: ${fmt(v)} ${noun(metric, v, view)}`
    : `${month} ${y}: ${fmt(v)} ${noun(metric, v, view)}`;
  const median = b.median ?? 0;

  if (b.n_years === 0) return { headline, detail: "There are no past years to compare with yet.", tone: "none" };
  // The backend gives no status when it has too few past years to judge (fewer than 3);
  // don't call the month normal then.
  if (stats.status === null) {
    return { headline, detail: `Too few past years to say whether this ${month} is unusual.`, tone: "none" };
  }
  if (v === 0 && median === 0) return { headline, detail: `None, as usual for ${month} here.`, tone: "normal" };
  if (median === 0) {
    const most = stats.rank === 1 ? ` The most for ${month} in ${years} years.` : "";
    return { headline, detail: `In most years ${month} has none here.${most}`, tone: stats.status === "unusual_high" ? "high" : "above" };
  }

  const r = v / median;
  const most = stats.rank === 1 && v > 0 ? `, and the most for ${month} in ${years} years` : "";
  const least = stats.rank === years && v < median ? `, and the fewest for ${month} in ${years} years` : "";
  switch (stats.status) {
    case "unusual_high":
      return { headline, detail: `Unusually high: ${times(r)} a typical ${month}${most}.`, tone: "high" };
    case "above_normal":
      return { headline, detail: `Above normal: ${times(r)} a typical ${month}${most}.`, tone: "above" };
    case "below_normal":
      return { headline, detail: `Below normal: ${times(r)} a typical ${month}${least}.`, tone: "below" };
    default:
      return { headline, detail: `A normal ${month}: within the range of past years.`, tone: "normal" };
  }
}
