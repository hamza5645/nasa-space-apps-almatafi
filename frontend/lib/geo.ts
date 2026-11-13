// Client-side shapes for drawing the area of interest on the map. The backend stays the
// source of truth for what's inside; these are only for display and zooming.

import { EARTH_RADIUS_KM } from "./grid.ts";

export type Shape = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type Ring = [number, number][];

const box = (w: number, s: number, e: number, n: number): Ring => [[w, s], [e, s], [e, n], [w, n], [w, s]];

/** [w, s, e, n] as a polygon; west > east crosses 180° and becomes two parts. */
export function bboxShape([w, s, e, n]: [number, number, number, number]): Shape {
  if (w <= e) return { type: "Polygon", coordinates: [box(w, s, e, n)] };
  return { type: "MultiPolygon", coordinates: [[box(w, s, 180, n)], [box(-180, s, e, n)]] };
}

/** A geodesic circle (great-circle destinations), good enough to show a radius on the map. */
export function circleShape(lat: number, lon: number, km: number, steps = 64): Shape {
  const d = km / EARTH_RADIUS_KM, φ1 = (lat * Math.PI) / 180, λ1 = (lon * Math.PI) / 180;
  const ring: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    // Not wrapped into ±180: a circle near the 180° line stays one ring (MapLibre draws lon > 180).
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** [w, s, e, n] of a shape, for fitting the map. A shape split at 180° comes back as one
 *  box with east > 180 (MapLibre accepts that), not as the whole world. */
export function shapeBounds(shape: Shape): [number, number, number, number] {
  const rings = shape.type === "Polygon" ? shape.coordinates : shape.coordinates.flat();
  const box = (shift: boolean) => {
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings) for (const [x0, y] of ring) {
      const x = shift && x0 < 0 ? x0 + 360 : x0;
      w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
    }
    return [w, s, e, n] as [number, number, number, number];
  };
  const plain = box(false);
  if (plain[2] - plain[0] <= 180) return plain;
  const shifted = box(true);
  return shifted[2] - shifted[0] < plain[2] - plain[0] ? shifted : plain;
}

/** A GeoJSON Polygon/MultiPolygon with real coordinates, or null. For geometry from a URL. */
export function validShape(g: unknown): Shape | null {
  const pt = (p: unknown) => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) &&
    Math.abs(p[0] as number) <= 540 && Math.abs(p[1] as number) <= 90;
  const ring = (r: unknown) => Array.isArray(r) && r.length >= 4 && r.length <= 5000 && r.every(pt);
  const poly = (p: unknown) => Array.isArray(p) && p.length >= 1 && p.length <= 100 && p.every(ring);
  if (!g || typeof g !== "object") return null;
  const { type, coordinates } = g as { type?: unknown; coordinates?: unknown };
  if (type === "Polygon" && poly(coordinates)) return g as Shape;
  if (type === "MultiPolygon" && Array.isArray(coordinates) && coordinates.length >= 1 && coordinates.length <= 100 &&
      coordinates.every(poly)) return g as Shape;
  return null;
}

/** Adds vertices so no edge spans more than `maxStep` degrees of longitude. The backend reads
 *  an edge longer than 180° as crossing the 180° line, so a box drawn wider than that would
 *  otherwise come back as its mirror image. */
export function densify(ring: [number, number][], maxStep = 90): [number, number][] {
  const out: [number, number][] = [];
  ring.forEach(([x, y], i) => {
    if (i > 0) {
      const [px, py] = ring[i - 1];
      const n = Math.ceil(Math.abs(x - px) / maxStep);
      for (let k = 1; k < n; k++) out.push([px + ((x - px) * k) / n, py + ((y - py) * k) / n]);
    }
    out.push([x, y]);
  });
  return out;
}
