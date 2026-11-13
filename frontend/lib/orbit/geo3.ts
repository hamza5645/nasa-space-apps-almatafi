// Latitude/longitude ↔ 3D on a unit globe, matching three.js SphereGeometry's UV layout
// (u = 0 at 180° W, north at +y), so equirectangular textures line up with the points.

import * as THREE from "three";

const D = Math.PI / 180;

export function llToVec(lat: number, lon: number, r = 1, out = new THREE.Vector3()) {
  const phi = (90 - lat) * D;
  const theta = (lon + 180) * D;
  return out.set(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

/** Unit vector toward the sun for a subsolar point. */
export function sunVec(lat: number, lon: number, out = new THREE.Vector3()) {
  return llToVec(lat, lon, 1, out);
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
