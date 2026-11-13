"use client";

// "Search any place" (U2) through the backend's Nominatim proxy. A place with an outline
// becomes a polygon AOI; a point (a town, a farm) becomes a 25 km circle around it.

import { useState } from "react";
import { ApiError, api, type Place } from "@/lib/api";
import { circleShape } from "@/lib/geo";
import { useSelection } from "@/lib/store";

const POINT_RADIUS_KM = 25;

export default function PlaceSearch() {
  const setAoi = useSelection((s) => s.setAoi);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.search(q.trim());
      setResults(r.results);
      if (!r.results.length) setMsg("No places found. Try a bigger place, or another spelling.");
    } catch (err) {
      setResults(null);
      setMsg(err instanceof ApiError ? err.message : "Place search is unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  function choose(p: Place) {
    const [lon, lat] = p.centroid;
    if (p.geometry) {
      setAoi({ type: "polygon", geometry: p.geometry as unknown as Record<string, unknown> }, p.display_name, { shape: p.geometry });
    } else {
      setAoi({ type: "point", lat, lon, radius_km: POINT_RADIUS_KM }, `${POINT_RADIUS_KM} km around ${p.name}`,
              { shape: circleShape(lat, lon, POINT_RADIUS_KM) });
    }
    setResults(null);
    setQ(p.name);
  }

  return (
    <div className="stack">
      <form role="search" onSubmit={search} className="searchrow">
        <label className="sr-only" htmlFor="place-q">Search a place</label>
        <input id="place-q" type="search" placeholder="Search a place, e.g. Kafr El Sheikh" value={q}
               onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        <button className="chip-btn" type="submit" disabled={busy}>{busy ? "…" : "Search"}</button>
      </form>
      {msg && <p className="hint" style={{ fontSize: 13 }} role="status">{msg}</p>}
      {results && results.length > 0 && (
        <ul className="results" aria-label="Places found">
          {results.map((p) => (
            <li key={`${p.display_name}-${p.centroid.join(",")}`}>
              <button type="button" onClick={() => choose(p)}>
                <strong>{p.name}</strong>
                <span className="muted">{p.display_name.split(",").slice(1, 3).join(",")}{p.kind ? ` · ${p.kind}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
