// MapLibre finds its web worker next to its own bundle, which Turbopack moves. Serve a copy
// from public/ instead (MapView calls setWorkerUrl). Runs before `dev` and `build`.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("public/maplibre", { recursive: true });
copyFileSync("node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "public/maplibre/maplibre-gl-worker.mjs");
