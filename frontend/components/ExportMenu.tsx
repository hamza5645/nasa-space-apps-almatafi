"use client";

// Exports and the share link (U5).

import { useState } from "react";
import Popover from "./Popover";
import { ApiError, type ExportRequest } from "@/lib/api";
import { download } from "@/lib/download";
import { monthDays } from "@/lib/format";
import { sensorsFor } from "@/lib/queries";
import { useSelection } from "@/lib/store";

type Item = { id: string; label: string; title: string; body: () => ExportRequest | null };

export default function ExportMenu({ latest }: { latest: string | null }) {
  const s = useSelection();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const monthRange = s.month ? monthDays(s.month) : null;
  const lastMonth = s.end ?? latest ?? s.month ?? s.start;
  const items: Item[] = [
    { id: "csv", label: "Hotspots, CSV", title: "Every hotspot of the selected month, one row each",
      body: () => monthRange && { aoi: s.aoi, what: "hotspots", format: "csv", start: monthRange[0], end: monthRange[1], sensors: sensorsFor(s.view) } },
    { id: "geojson", label: "Hotspots, GeoJSON", title: "The same points, for QGIS or any web map",
      body: () => monthRange && { aoi: s.aoi, what: "hotspots", format: "geojson", start: monthRange[0], end: monthRange[1], sensors: sensorsFor(s.view) } },
    { id: "kml", label: "Hotspots, KML", title: "For Google Earth: each hotspot with its pixel footprint, coloured by fire power",
      body: () => monthRange && { aoi: s.aoi, what: "hotspots", format: "kml", start: monthRange[0], end: monthRange[1], sensors: sensorsFor(s.view) } },
    { id: "geotiff", label: "Grid, GeoTIFF", title: "The selected month on the 0.1° grid (Cloud-Optimized GeoTIFF)",
      body: () => s.month === null ? null : { aoi: s.aoi, what: "grid", format: "geotiff", start: s.month, end: s.month, view: s.view, metric: s.metric } },
    { id: "calendar", label: "Calendar, CSV", title: "Every month in the calendar, one row each",
      body: () => ({ aoi: s.aoi, what: "calendar", format: "csv", start: s.start, end: lastMonth, view: s.view, metric: s.metric }) },
  ];

  async function run(item: Item) {
    const body = item.body();
    if (!body) return setMsg("Pick a month in the calendar first.");
    setBusy(item.id);
    setMsg("Preparing the file…");
    try {
      await download(body);
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "The export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setMsg("Link copied.");
    } catch {
      setMsg("Copy the address bar to share this view.");
    }
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <div className="exports">
      <Popover label="Download" align="end">
        {(close) => (
          <ul className="menu" aria-label="Downloads">
            {items.map((it) => (
              <li key={it.id}>
                <button type="button" disabled={busy !== null} onClick={() => { run(it); close(); }}>
                  <strong>{busy === it.id ? "Preparing…" : it.label}</strong>
                  <span>{it.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Popover>
      <button type="button" className="chip-btn" onClick={share}>Copy link</button>
      <span role="status" className="export-msg">{msg}</span>
    </div>
  );
}
