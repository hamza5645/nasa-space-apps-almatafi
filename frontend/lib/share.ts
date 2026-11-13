// The explorer's state in the URL (U5), so a link opens the same area, month and view.

import type { Aoi, Metric, View } from "./api.ts";
import { validShape } from "./geo.ts";
import type { Selection } from "./store.ts";

const VIEWS: View[] = ["harmonized", "modis", "viirs"];
const METRICS: Metric[] = ["detections", "fire_days"];
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const FIRST = "2000-11"; // Terra's first FIRMS month; the backend refuses anything earlier

/** The current UTC month, YYYY-MM: no month after it exists yet. */
export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

const inRange = (m: string | null, now: Date) => m !== null && YM.test(m) && m >= FIRST && m <= currentMonth(now);

function b64url(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Short, readable params for the common cases; base64 JSON only for drawn polygons. */
export function encode(s: Pick<Selection, "aoi" | "aoiLabel" | "start" | "end" | "view" | "metric" | "month" | "adminRef">): string {
  const p = new URLSearchParams();
  const a = s.aoi;
  if (a.type === "region") p.set("region", a.region_id);
  else if (a.type === "bbox") p.set("bbox", a.bbox.join(","));
  else if (a.type === "point") p.set("point", `${a.lat},${a.lon},${a.radius_km}`);
  else if (a.type === "admin") {
    p.set("admin", a.admin_id);
    // Country and level, so the link can fetch the outline again.
    if (s.adminRef) { p.set("ac", s.adminRef.country); p.set("al", String(s.adminRef.level)); }
  }
  else p.set("shape", b64url(JSON.stringify(a.geometry)));
  if (a.type !== "region") p.set("label", s.aoiLabel);
  if (s.month) p.set("month", s.month);
  if (s.view !== "harmonized") p.set("view", s.view);
  if (s.metric !== "detections") p.set("metric", s.metric);
  if (s.start !== "2001-01") p.set("from", s.start);
  if (s.end) p.set("to", s.end);
  return p.toString();
}

/** Parse what `encode` wrote. Anything malformed is ignored, never trusted. */
export function decode(query: string, now = new Date()): Partial<Selection> {
  const p = new URLSearchParams(query);
  const out: Partial<Selection> = {};
  const nums = (v: string | null, n: number) => {
    const xs = (v ?? "").split(",").map(Number);
    return xs.length === n && xs.every(Number.isFinite) ? xs : null;
  };
  let aoi: Aoi | null = null;
  if (p.get("region") && /^[a-z0-9-]{1,40}$/.test(p.get("region")!)) aoi = { type: "region", region_id: p.get("region")! };
  const bbox = nums(p.get("bbox"), 4);
  if (!aoi && bbox) aoi = { type: "bbox", bbox };
  const pt = nums(p.get("point"), 3);
  if (!aoi && pt) aoi = { type: "point", lat: pt[0], lon: pt[1], radius_km: pt[2] };
  if (!aoi && p.get("admin") && /^[\w.-]{1,80}$/.test(p.get("admin")!)) aoi = { type: "admin", admin_id: p.get("admin")! };
  if (aoi?.type === "admin" && /^[A-Z]{3}$/.test(p.get("ac") ?? "") && /^[0-2]$/.test(p.get("al") ?? "")) {
    out.adminRef = { country: p.get("ac")!, level: Number(p.get("al")) };
  }
  if (!aoi && p.get("shape")) {
    try {
      const g = validShape(JSON.parse(unb64url(p.get("shape")!)));
      if (g) aoi = { type: "polygon", geometry: g as unknown as Record<string, unknown> };
    } catch { /* ignore a broken link */ }
  }
  if (aoi) {
    out.aoi = aoi;
    out.aoiLabel = aoi.type === "region" ? "" : (p.get("label") ?? "Shared area").slice(0, 120);
  }
  const month = p.get("month");
  if (inRange(month, now)) out.month = month!;
  const view = p.get("view") as View;
  if (VIEWS.includes(view)) out.view = view;
  const metric = p.get("metric") as Metric;
  if (METRICS.includes(metric)) out.metric = metric;
  if (inRange(p.get("from"), now)) out.start = p.get("from")!;
  if (inRange(p.get("to"), now) && p.get("to")! >= (out.start ?? "2001-01")) out.end = p.get("to")!;
  return out;
}
