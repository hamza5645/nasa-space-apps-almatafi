// Builds the landing globe's fire layer from one real week of NASA FIRMS near-real-time data:
// the public 7-day global files for MODIS (Terra + Aqua) and VIIRS (NOAA-20), no key needed.
//
//   node scripts/globe-fires.mjs                 download the current week, then build
//   node scripts/globe-fires.mjs --from <dir>    build from MODIS_C6_1_Global_7d.csv and J1_VIIRS_C2_Global_7d.csv in <dir>
//
// Detections are cleaned like the pipeline does (MODIS confidence >= 30, VIIRS without "low")
// and counted on our 0.1° grid, one record per sensor and cell. Output:
//   public/globe/fires.bin   10 bytes per record, little endian:
//                            u16 lat row (0..1799), u16 lon col (0..3599), u16 detections,
//                            u16 max FRP (MW), u8 first day (0..7) | 0x80 if any night pass, u8 sensor (0 MODIS, 1 VIIRS)
//   public/globe/fires.json  the counts and dates the page prints

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCES = {
  modis: ["MODIS_C6_1_Global_7d.csv", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv"],
  viirs: ["J1_VIIRS_C2_Global_7d.csv", "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv"],
};

const from = process.argv.includes("--from") ? process.argv[process.argv.indexOf("--from") + 1] : null;
const OUT = join(process.cwd(), "public", "globe");

async function text(sensor) {
  const [file, url] = SOURCES[sensor];
  if (from) return readFileSync(join(from, file), "utf8");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

function parse(csv) {
  const lines = csv.trim().split("\n");
  const head = lines[0].split(",");
  const col = (n) => { const i = head.indexOf(n); if (i < 0) throw new Error(`missing column ${n}`); return i; };
  const c = { lat: col("latitude"), lon: col("longitude"), date: col("acq_date"), conf: col("confidence"), frp: col("frp"), dn: col("daynight") };
  return lines.slice(1).map((l) => l.split(",")).map((f) => ({
    lat: +f[c.lat], lon: +f[c.lon], date: f[c.date], conf: f[c.conf], frp: +f[c.frp], night: f[c.dn] === "N",
  }));
}

const keep = { modis: (r) => Number(r.conf) >= 30, viirs: (r) => r.conf !== "low" && r.conf !== "l" };

const rowsBy = {};
for (const s of ["modis", "viirs"]) rowsBy[s] = parse(await text(s));
const dates = [...new Set(Object.values(rowsBy).flat().map((r) => r.date))].sort();

const meta = { source: "NASA FIRMS near-real-time, global 7-day files", built: new Date().toISOString().slice(0, 10), dates: [dates[0], dates.at(-1)], grid_deg: 0.1, sensors: {} };
const records = [];
for (const [si, s] of ["modis", "viirs"].entries()) {
  const kept = rowsBy[s].filter(keep[s]);
  const cells = new Map();
  for (const r of kept) {
    const row = Math.min(1799, Math.floor((r.lat + 90) * 10));
    const colI = Math.min(3599, Math.floor((r.lon + 180) * 10));
    const k = row * 3600 + colI;
    const day = dates.indexOf(r.date);
    const c = cells.get(k) ?? { row, col: colI, n: 0, frp: 0, day, night: false };
    c.n += 1; c.frp = Math.max(c.frp, r.frp); c.day = Math.min(c.day, day); c.night ||= r.night;
    cells.set(k, c);
  }
  for (const c of cells.values()) records.push({ ...c, sensor: si });
  meta.sensors[s] = {
    label: s === "modis" ? "MODIS (Terra and Aqua)" : "VIIRS (NOAA-20)",
    rows: rowsBy[s].length, detections: kept.length, cells: cells.size,
  };
}
meta.ratio_viirs_vs_modis = +(meta.sensors.viirs.detections / meta.sensors.modis.detections).toFixed(2);

// The demo regions' boxes (same as the explorer's fallback list), counted from the same week.
const REGIONS = { "nile-delta": [29.9, 30.0, 32.3, 31.6], "rio-negro": [-71.8, -41.8, -68.0, -39.5] };
meta.regions = {};
for (const [id, [w, so, e, n]] of Object.entries(REGIONS)) {
  const inBox = (r) => r.lon >= w && r.lon <= e && r.lat >= so && r.lat <= n;
  meta.regions[id] = Object.fromEntries(["modis", "viirs"].map((s) => [s, rowsBy[s].filter(keep[s]).filter(inBox).length]));
}

const buf = Buffer.alloc(records.length * 10);
records.forEach((r, i) => {
  const o = i * 10;
  buf.writeUInt16LE(r.row, o); buf.writeUInt16LE(r.col, o + 2);
  buf.writeUInt16LE(Math.min(65535, r.n), o + 4); buf.writeUInt16LE(Math.min(65535, Math.round(r.frp)), o + 6);
  buf.writeUInt8((Math.max(0, r.day) & 0x7f) | (r.night ? 0x80 : 0), o + 8); buf.writeUInt8(r.sensor, o + 9);
});
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "fires.bin"), buf);
writeFileSync(join(OUT, "fires.json"), JSON.stringify(meta, null, 1) + "\n");
console.log(JSON.stringify(meta));
