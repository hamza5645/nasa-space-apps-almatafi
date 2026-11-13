// X33: map snapshots for the game's map questions, taken from our own explorer, so the game
// shows the same map the explorer does. Needs the frontend (and backend) running and
// playwright-core; rerun after the data changes (real data on Nov 13):
//   NODE_PATH=<dir with playwright-core> node design/game/capture-maps.mjs [http://localhost:3100]
// Writes frontend/public/game/maps/<id>.png and maps.json (dot counts per snapshot).
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = new URL("../../frontend/public/game/maps/", import.meta.url).pathname;
const SHOTS = [
  { id: "delta-modis", q: "region=nile-delta&month=2026-10&view=modis" },
  { id: "delta-viirs", q: "region=nile-delta&month=2026-10&view=viirs" },
  { id: "delta-2026-10", q: "region=nile-delta&month=2026-10" },
  { id: "rio-2026-07", q: "region=rio-negro&month=2026-07" },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true, args: ["--use-angle=metal"],
});
const meta = {};
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/explore?${s.q}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".maplibregl-canvas", { timeout: 120000 });
  await page.waitForFunction(() => /\d+ detections/.test(document.querySelector(".maplabel")?.textContent ?? ""), null, { timeout: 60000 });
  // Tiles: wait until the network has been quiet a while (Patagonia's took longer than 5 s).
  await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(4000);
  const label = await page.locator(".maplabel").innerText();
  const dots = Number((label.match(/([\d,]+) detections/) ?? [])[1]?.replace(/,/g, "") ?? NaN);
  // Map only: no tools, labels, buttons or credit line in the picture.
  await page.addStyleTag({ content: ".maptools,.maplabel,.maplayers,.maplibregl-control-container,.maphelp{display:none!important}" });
  await page.waitForTimeout(300);
  await page.locator(".map-canvas").screenshot({ path: `${OUT}${s.id}.png` });
  // The game shows WebP: cwebp -q 82 <id>.png -o <id>.webp (see the commit that added this script).
  meta[s.id] = { dots, query: s.q };
  console.log(s.id, dots);
  await page.close();
}
writeFileSync(`${OUT}maps.json`, JSON.stringify(meta, null, 2) + "\n");
await browser.close();
