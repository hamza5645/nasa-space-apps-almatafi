"use client";

// The explorer map (U2): a labelled dark basemap, NASA GIBS imagery one click away (no key
// needed), the area of interest, the selected month's hotspots (click one for details), and
// drawing a polygon or box with Terra Draw. X27 adds what FIRMS's own map shows: each
// detection's pixel footprint when zoomed in, the day's satellite image and its smoke.

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawRenderMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Hotspots } from "@/lib/api";
import { busiestDay, footprints, gibsTiles, smokeLayer, trueColorLayer } from "@/lib/firms";
import { monthLabel } from "@/lib/format";
import { densify, shapeBounds, type Shape } from "@/lib/geo";
import { useSelection } from "@/lib/store";

const GIBS = "gibs://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs"); // see scripts/copy-worker.mjs

// GIBS tiles go through this loader: a few at a time, retried with backoff (MapLibre never
// retries a failed tile), and a tile that keeps failing is drawn transparent instead of
// logging an error. GIBS answers 500 for empty label tiles, which is the usual case.
const BLANK = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)).buffer;
const MAX_FETCHES = 4;
let active = 0;
const queue: (() => void)[] = [];
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= MAX_FETCHES) await new Promise<void>((r) => queue.push(r));
  active++;
  try { return await job(); } finally { active--; queue.shift()?.(); }
}
maplibregl.addProtocol("gibs", (params, abort) => slot(async () => {
  const url = `https://${params.url.slice("gibs://".length)}`;
  const tries = url.endsWith(".png") ? 2 : 6; // empty label tiles always fail; imagery is worth waiting for
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { signal: abort.signal });
      if (res.ok) return { data: await res.arrayBuffer() };
      if (res.status < 500) break;
    } catch (e) {
      // GIBS's 500s carry no CORS header, so the browser reports them as a network error.
      if (abort.signal.aborted) throw e;
    }
    if (attempt === tries - 1) break; // no wait after the last try
    // The wait holds a slot, so stop it as soon as MapLibre no longer wants the tile.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, Math.min(4000, 400 * 2 ** attempt) + Math.random() * 300);
      abort.signal.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("aborted", "AbortError")); }, { once: true });
    });
  }
  return { data: BLANK };
}));
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// The base map: OpenFreeMap's dark vector style (OpenStreetMap data, no key). If it can't be
// reached, a plain background keeps the area, hotspots and NASA imagery working.
const BASE_STYLE = "https://tiles.openfreemap.org/styles/dark";
const FALLBACK: maplibregl.StyleSpecification = {
  version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#1B1F22" } }],
};

const SOURCES: maplibregl.StyleSpecification["sources"] = {
  relief: {
    type: "raster", tileSize: 256, maxzoom: 8,
    tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
    attribution: '<a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> Blue Marble · fires: <a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a>',
  },
  aoi: { type: "geojson", data: EMPTY },
  hotspots: { type: "geojson", data: EMPTY },
  footprints: { type: "geojson", data: EMPTY },
};

const FRP_COLOR: maplibregl.ExpressionSpecification = ["interpolate", ["linear"], ["get", "frp"], 0, "#C9472E", 10, "#F08A24", 50, "#FFE08A"];

// Under the base map's labels, so place names stay readable on the imagery.
const IMAGERY: maplibregl.LayerSpecification = {
  id: "relief", type: "raster", source: "relief", layout: { visibility: "none" },
  paint: { "raster-brightness-max": 0.75, "raster-saturation": -0.2 },
};

const OVERLAYS: maplibregl.LayerSpecification[] = [
  { id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#6BD0E4", "fill-opacity": 0.06 } },
  { id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#6BD0E4", "line-width": 2, "line-dasharray": [3, 2.5] } },
  // Each detection's pixel on the ground (scan × track): a MODIS pixel is ~1 km, VIIRS ~375 m.
  { id: "footprints-fill", type: "fill", source: "footprints", minzoom: 8, paint: { "fill-color": FRP_COLOR, "fill-opacity": 0.28 } },
  { id: "footprints-line", type: "line", source: "footprints", minzoom: 8,
    paint: { "line-color": FRP_COLOR, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 12, 1.5] } },
  {
    id: "hotspots", type: "circle", source: "hotspots",
    paint: {
      // Bigger and brighter with fire radiative power.
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["interpolate", ["linear"], ["get", "frp"], 0, 1.5, 50, 3.5],
                        10, ["interpolate", ["linear"], ["get", "frp"], 0, 4, 50, 9]],
      "circle-color": FRP_COLOR,
      // Fainter once the footprints show, so the pixels read.
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.9, 10, 0.55],
      "circle-stroke-color": "#1C0F04", "circle-stroke-width": 0.6,
    },
  },
  {
    id: "hotspot-selected", type: "circle", source: "hotspots", filter: ["==", ["get", "point_id"], ""],
    paint: { "circle-radius": 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 2.5 },
  },
];

async function loadStyle(): Promise<maplibregl.StyleSpecification> {
  let base = FALLBACK;
  try {
    const res = await fetch(BASE_STYLE, { signal: AbortSignal.timeout(6000) });
    if (res.ok) base = await res.json();
  } catch { /* offline or blocked: the plain background will do */ }
  const firstLabel = base.layers.findIndex((l) => l.type === "symbol");
  const layers = [...base.layers];
  layers.splice(firstLabel < 0 ? layers.length : firstLabel, 0, IMAGERY);
  return { ...base, sources: { ...base.sources, ...SOURCES }, layers: [...layers, ...OVERLAYS] };
}

type Props = { hotspots?: Hotspots; loading: boolean };
type Tool = "none" | "polygon" | "rectangle";
type Base = "map" | "relief" | "day";

export default function MapView({ hotspots, loading }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const draw = useRef<TerraDraw | null>(null);
  const [ready, setReady] = useState(false);
  // The shape the map opened on; a different one (a shared link restored a moment later) still gets fitted.
  const opened = useRef<Shape | null | undefined>(undefined);
  const [tool, setTool] = useState<Tool>("none");
  const [base, setBase] = useState<Base>("map");
  const [smoke, setSmoke] = useState(false);
  const { shape, aoiLabel, month, hotspot, setAoi, selectHotspot } = useSelection();
  // The day the satellite image and smoke show: the picked hotspot's, else the month's busiest.
  const day = hotspot?.acq_datetime_utc.slice(0, 10) ?? busiestDay(hotspots);
  const dayLayer = day ? trueColorLayer(day) : null;
  const smokeOf = day ? smokeLayer(day) : null;

  // Create the map once, when its style has arrived and the page has settled.
  useEffect(() => {
    let cancelled = false;
    let m: maplibregl.Map | null = null;
    // The wait is a nicety: an error or a stuck animation must not keep the map away for good.
    const waited = Promise.race([settled(el.current).catch(() => {}), new Promise((done) => setTimeout(done, 4000))]);
    Promise.all([loadStyle(), waited]).then(([style]) => {
      if (cancelled || !el.current) return;
      const start = useSelection.getState().shape;
      opened.current = start;
      const mm = new maplibregl.Map({
        container: el.current, style, maxZoom: 12,
        // Open straight on the area: no zoom animation, so no tiles fetched and thrown away.
        ...(start ? { bounds: shapeBounds(start) as [number, number, number, number], fitBoundsOptions: { padding: 40, maxZoom: 10 } }
                  : { center: [0, 20] as [number, number], zoom: 1.5 }),
        attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
      });
      mm.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      // The base style names a few POI icons it has no sprite for; draw them as nothing.
      mm.on("styleimagemissing", (e) => { if (!mm.hasImage(e.id)) mm.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) }); });
      // style.load, not load: load waits for every tile, and GIBS tiles can be slow.
      mm.once("style.load", () => {
        const td = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map: mm }),
          modes: [
            new TerraDrawPolygonMode({ styles: { fillColor: "#6BD0E4", fillOpacity: 0.15, outlineColor: "#6BD0E4", closingPointColor: "#F08A24" } }),
            new TerraDrawRectangleMode({ styles: { fillColor: "#6BD0E4", fillOpacity: 0.15, outlineColor: "#6BD0E4" } }),
            new TerraDrawRenderMode({ modeName: "static", styles: {} }),
          ],
        });
        td.start();
        td.setMode("static");
        draw.current = td;
        setReady(true);
      });
      mm.on("click", "hotspots", (e: MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties as Record<string, unknown>;
        // MapLibre flattens null properties away; put them back.
        selectHotspot({
          point_id: String(p.point_id), sensor: p.sensor as "MODIS" | "VIIRS", platform: String(p.platform),
          acq_datetime_utc: String(p.acq_datetime_utc), daynight: p.daynight as "D" | "N",
          frp: (p.frp as number) ?? null, confidence_class: p.confidence_class as "low" | "nominal" | "high",
          confidence_pct: (p.confidence_pct as number) ?? null, fire_type: (p.fire_type as number) ?? null,
          brightness_k: (p.brightness_k as number) ?? null, scan_km: (p.scan_km as number) ?? null,
          track_km: (p.track_km as number) ?? null, cell_id: Number(p.cell_id), source: String(p.source), lon, lat,
        });
      });
      mm.on("mouseenter", "hotspots", () => { mm.getCanvas().style.cursor = "pointer"; });
      mm.on("mouseleave", "hotspots", () => { mm.getCanvas().style.cursor = ""; });
      map.current = mm;
      m = mm;
    });
    return () => { cancelled = true; draw.current?.stop(); m?.remove(); map.current = null; draw.current = null; };
  }, [selectHotspot]);

  // A finished drawing becomes the area of interest.
  useEffect(() => {
    const td = draw.current;
    if (!ready || !td) return;
    const onFinish = (id: string | number) => {
      const f = td.getSnapshotFeature(id);
      if (f && f.geometry.type === "Polygon") {
        const rings = (f.geometry.coordinates as [number, number][][]).map((r) => densify(r));
        const geometry: GeoJSON.Polygon = { type: "Polygon", coordinates: rings };
        setAoi({ type: "polygon", geometry: geometry as unknown as Record<string, unknown> },
               tool === "rectangle" ? "Drawn box" : "Drawn area", { shape: geometry });
      }
      td.clear();
      td.setMode("static");
      setTool("none");
    };
    td.on("finish", onFinish);
    return () => td.off("finish", onFinish);
  }, [ready, tool, setAoi]);

  // Area outline + zoom to it.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("aoi") as GeoJSONSource).setData(shape ? { type: "Feature", geometry: shape, properties: {} } : EMPTY);
    if (shape && shape !== opened.current) fit(m, shape);
    opened.current = undefined;
  }, [ready, shape]);

  // Hotspots of the selected month, and their pixel footprints.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    (m.getSource("hotspots") as GeoJSONSource).setData(hotspots ?? EMPTY);
    (m.getSource("footprints") as GeoJSONSource).setData(footprints(hotspots));
  }, [ready, hotspots]);

  // NASA imagery on or off (hidden layers fetch no tiles). The basemap stays underneath, so a
  // slow or failed GIBS tile shows the map instead of a hole.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setLayoutProperty("relief", "visibility", base === "relief" ? "visible" : "none");
  }, [ready, base]);

  // The day's true-colour image (under the labels, like the Blue Marble) and the smoke over it.
  // Each is one daily GIBS layer, swapped when the day changes.
  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const labels = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
    swapRaster(m, "day", base === "day" && dayLayer && day ? gibsTiles(dayLayer, day) : null, labels, 9, {});
    swapRaster(m, "smoke", smoke && smokeOf && day ? gibsTiles(smokeOf, day) : null, "aoi-fill", 6, { "raster-opacity": 0.7 });
  }, [ready, base, smoke, day, dayLayer, smokeOf]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setFilter("hotspot-selected", ["==", ["get", "point_id"], hotspot?.point_id ?? ""]);
  }, [ready, hotspot]);

  function pick(t: Tool) {
    const td = draw.current;
    if (!td) return;
    const next = tool === t ? "none" : t;
    td.clear();
    td.setMode(next === "none" ? "static" : next);
    setTool(next);
  }

  return (
    <figure className="mapwrap">
    <div className="map">
      <div ref={el} className="map-canvas" role="region" aria-label={`Map of ${aoiLabel}`} />
      <div className="maptools" role="group" aria-label="Draw an area">
        <button type="button" aria-pressed={tool === "polygon"} aria-label="Draw a polygon" title="Draw a polygon: click to add points, click the first point to finish" onClick={() => pick("polygon")} disabled={!ready}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 7 L12 3 L20 8 L17 19 L6 18 Z" /></svg>
        </button>
        <button type="button" aria-pressed={tool === "rectangle"} aria-label="Draw a box" title="Draw a box: click two corners" onClick={() => pick("rectangle")} disabled={!ready}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="1" /></svg>
        </button>
        {shape && (
          <button type="button" aria-label="Zoom to the area" title="Zoom to the area" onClick={() => map.current && fit(map.current, shape)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
        )}
      </div>
      <div className="maplabel">
        {aoiLabel}{month && <> · <strong>{monthLabel(month, false)}</strong></>}
        {loading && <span className="muted"> · loading…</span>}
        {hotspots && !loading && <span className="muted"> · {hotspots.features.length.toLocaleString("en-US")} detections</span>}
      </div>
      {tool !== "none" && (
        <div className="maphelp" role="status">
          {tool === "polygon" ? "Click to add points; click the first point to finish." : "Click one corner, then the opposite corner."}
          {" "}<button type="button" className="linkish" onClick={() => pick(tool)}>Cancel</button>
        </div>
      )}
      <div className="maplayers" role="group" aria-label="Map layers">
        <button type="button" aria-pressed={base === "map"} onClick={() => setBase("map")}>Map</button>
        <button type="button" aria-pressed={base === "relief"} onClick={() => setBase("relief")}>NASA imagery</button>
        <button type="button" aria-pressed={base === "day"} disabled={!dayLayer}
                title={dayLayer ? `The satellite image of ${day} (${dayLayer.label})` : "Pick a month with hotspots"}
                onClick={() => setBase("day")}>Day image</button>
        <button type="button" aria-pressed={smoke} disabled={!smokeOf}
                title={smokeOf ? `Smoke and dust on ${day}: ${smokeOf.label}` : "No smoke layer for this day"}
                onClick={() => setSmoke((v) => !v)}>Smoke</button>
      </div>
    </div>
    <figcaption className="maplegend">
      <span><i className="dot" />One detection from the satellite picked under the map; bigger means more fire power.
        Zoom in to see each detection&apos;s pixel on the ground.</span>
      <span><i className="dash" />Your area.</span>
      {(base === "day" || smoke) && day && (
        <span className="maplegend-day">
          {base === "day" && dayLayer && <>Image: {day}, {dayLayer.label}{hotspot ? " (the picked hotspot's day)" : " (the month's busiest day)"}. </>}
          {smoke && smokeOf && <>Smoke: {smokeOf.label}; yellow to red is more smoke or dust. </>}
          From NASA GIBS.
        </span>
      )}
    </figcaption>
    </figure>
  );
}

// Building the map (WebGL context, shader programs, first tiles) blocks the main thread for about
// a second, so it waits for the page transition's smoke to clear (WarpOverlay drops html.warping),
// for the explorer's entrance to finish (nothing to wait for with reduced motion), then for an
// idle moment. The sky's slow fade runs on the compositor and is all but done by then.
async function settled(node: Element | null) {
  const html = document.documentElement;
  if (html.classList.contains("warping")) await new Promise<void>((done) => {
    const mo = new MutationObserver(() => { if (!html.classList.contains("warping")) { mo.disconnect(); done(); } });
    mo.observe(html, { attributes: true, attributeFilter: ["class"] });
  });
  const busy = node?.closest(".explorer")?.getAnimations({ subtree: true }).filter((a) =>
    a.effect?.getComputedTiming().endTime !== Infinity && !(a instanceof CSSAnimation && a.animationName === "xp-sky")) ?? [];
  await Promise.allSettled(busy.map((a) => a.finished));
  await new Promise<void>((done) => {
    if ("requestIdleCallback" in window) requestIdleCallback(() => done(), { timeout: 500 });
    else setTimeout(done, 50); // Safari
  });
}

/** Replace raster layer `id` with one showing `tiles` (null removes it). */
function swapRaster(m: maplibregl.Map, id: string, tiles: string | null, before: string | undefined, maxzoom: number,
                    paint: maplibregl.RasterLayerSpecification["paint"]) {
  const src = m.getSource(id) as maplibregl.RasterTileSource | undefined;
  if (src && tiles && src.tiles?.[0] === tiles) return;
  if (m.getLayer(id)) m.removeLayer(id);
  if (src) m.removeSource(id);
  if (!tiles) return;
  m.addSource(id, { type: "raster", tiles: [tiles], tileSize: 256, maxzoom,
                    attribution: '<a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>' });
  m.addLayer({ id, type: "raster", source: id, paint }, before && m.getLayer(before) ? before : undefined);
}

function fit(m: maplibregl.Map, shape: Shape) {
  const [w, s, e, n] = shapeBounds(shape);
  m.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 10, duration: 600 });
}
