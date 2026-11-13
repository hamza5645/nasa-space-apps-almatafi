// The globe's fire layer: one real week of FIRMS detections on our 0.1° grid
// (scripts/globe-fires.mjs writes public/globe/fires.bin; the format is documented there).

import * as THREE from "three";
import { llToVec } from "./geo3";

export type FireCells = {
  geometry: THREE.BufferGeometry;
  /** Equirectangular glow map: red = MODIS, green = VIIRS. */
  heat: THREE.CanvasTexture;
  /** Cell centres (lat, lon) per sensor, for things like "fires near the Delta". */
  count: { modis: number; viirs: number };
};

const RECORD = 10;

export async function loadFires(url = "/globe/fires.bin", radius = 1.003): Promise<FireCells> {
  const buf = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.arrayBuffer();
  });
  const view = new DataView(buf);
  const n = Math.floor(buf.byteLength / RECORD);
  const pos = new Float32Array(n * 3);
  const count = new Float32Array(n);
  const frp = new Float32Array(n);
  const sensor = new Float32Array(n);
  const seed = new Float32Array(n);
  const night = new Float32Array(n);

  const W = 2048, H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "lighter";
  const tally = { modis: 0, viirs: 0 };

  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const o = i * RECORD;
    const row = view.getUint16(o, true), col = view.getUint16(o + 2, true);
    const lat = (row + 0.5) / 10 - 90, lon = (col + 0.5) / 10 - 180;
    // Jitter inside the 0.1° cell so the grid doesn't show as a lattice up close.
    const j = hash(i);
    llToVec(lat + (j - 0.5) * 0.08, lon + (hash(i + 7919) - 0.5) * 0.08, radius, v);
    pos.set([v.x, v.y, v.z], i * 3);
    count[i] = view.getUint16(o + 4, true);
    frp[i] = view.getUint16(o + 6, true);
    const flags = view.getUint8(o + 8);
    night[i] = flags & 0x80 ? 1 : 0;
    sensor[i] = view.getUint8(o + 9);
    seed[i] = j;
    if (sensor[i] === 0) tally.modis += 1; else tally.viirs += 1;

    const x = (col / 3600) * W, y = (1 - row / 1800) * H;
    const a = Math.min(1, 0.18 + Math.log2(1 + count[i]) * 0.16);
    ctx.fillStyle = sensor[i] === 0 ? `rgba(255,0,0,${a})` : `rgba(0,255,0,${a})`;
    ctx.fillRect(x - 1, y - 1, 2.4, 2.4);
  }

  // Soften into a glow: blur a copy and add it back over the sharp cells.
  const glow = document.createElement("canvas");
  glow.width = W; glow.height = H;
  const g = glow.getContext("2d")!;
  g.filter = "blur(5px)"; g.drawImage(canvas, 0, 0);
  g.filter = "blur(1.5px)"; g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.8; g.drawImage(canvas, 0, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("aCount", new THREE.BufferAttribute(count, 1));
  geometry.setAttribute("aFrp", new THREE.BufferAttribute(frp, 1));
  geometry.setAttribute("aSensor", new THREE.BufferAttribute(sensor, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geometry.setAttribute("aNight", new THREE.BufferAttribute(night, 1));
  geometry.computeBoundingSphere();

  const heat = new THREE.CanvasTexture(glow);
  heat.colorSpace = THREE.NoColorSpace;
  heat.wrapS = THREE.RepeatWrapping;
  heat.anisotropy = 4;
  return { geometry, heat, count: tally };
}

function hash(i: number) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
