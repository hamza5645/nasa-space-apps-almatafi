"use client";

// Area of interest (U1): demo regions, a bounding box, a point + radius, or an admin area.
// Place search sits on top; drawing lives on the map (MapView).

import { useState } from "react";
import { ApiError, api, type Aoi } from "@/lib/api";
import { bboxShape, circleShape, type Shape } from "@/lib/geo";
import { useSelection } from "@/lib/store";
import PlaceSearch from "./PlaceSearch";

type Tab = "box" | "point" | "admin";
type AdminArea = { id: string; name: string; shape: Shape };

function num(s: string): number | null {
  const v = Number(s.trim());
  return s.trim() !== "" && Number.isFinite(v) ? v : null;
}

export default function AreaPanel() {
  const setAoi = useSelection((s) => s.setAoi);
  const [tab, setTab] = useState<Tab>("box");
  const [err, setErr] = useState<string | null>(null);

  function apply(aoi: Aoi, label: string, shape: Shape, adminRef?: { country: string; level: number }) {
    setErr(null);
    setAoi(aoi, label, { shape, adminRef });
  }

  return (
    <div className="area-panel">
      <PlaceSearch />
      <p className="hint" style={{ fontSize: 13 }}>Or type an area in. To draw one, use the tools on the map.</p>
      <div className="tabs" role="tablist" aria-label="Area type">
        {([["box", "Box"], ["point", "Lat/Lon"], ["admin", "Admin"]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id}
                  aria-controls={`panel-${id}`} className="tab" onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === "box" && <BoxForm onApply={apply} onError={setErr} />}
      {tab === "point" && <PointForm onApply={apply} onError={setErr} />}
      {tab === "admin" && <AdminForm onApply={apply} onError={setErr} />}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

type FormProps = {
  onApply: (aoi: Aoi, label: string, shape: Shape, adminRef?: { country: string; level: number }) => void;
  onError: (e: string) => void;
};

function BoxForm({ onApply, onError }: FormProps) {
  const [v, setV] = useState({ n: "31.6", s: "30.0", w: "29.9", e: "32.3" });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const [n, s, w, east] = [num(v.n), num(v.s), num(v.w), num(v.e)];
    if (n === null || s === null || w === null || east === null) return onError("Fill in all four edges as numbers.");
    if (!(s < n) || s < -90 || n > 90) return onError("South must be below north, both between −90 and 90.");
    if (w < -180 || east > 180 || w === east) return onError("West and east must be between −180 and 180.");
    onApply({ type: "bbox", bbox: [w, s, east, n] }, `Box ${s}…${n}°, ${w}…${east}°`, bboxShape([w, s, east, n]));
  }
  return (
    <form id="panel-box" role="tabpanel" aria-labelledby="tab-box" onSubmit={submit} className="stack">
      <div className="grid2">
        {(["n", "s", "w", "e"] as const).map((k) => (
          <label key={k} className="field">{{ n: "North", s: "South", w: "West", e: "East" }[k]}
            <input inputMode="decimal" value={v[k]} onChange={(ev) => setV({ ...v, [k]: ev.target.value })} />
          </label>
        ))}
      </div>
      <p className="hint" style={{ fontSize: 13 }}>Degrees. West greater than east crosses the 180° line.</p>
      <button className="chip-btn" type="submit">Use this box</button>
    </form>
  );
}

function PointForm({ onApply, onError }: FormProps) {
  const [v, setV] = useState({ lat: "-40.8", lon: "-69.0", km: "150" });
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const [lat, lon, km] = [num(v.lat), num(v.lon), num(v.km)];
    if (lat === null || lat < -90 || lat > 90) return onError("Latitude must be between −90 and 90.");
    if (lon === null || lon < -180 || lon > 180) return onError("Longitude must be between −180 and 180.");
    if (km === null || km < 1 || km > 500) return onError("Radius must be between 1 and 500 km.");
    onApply({ type: "point", lat, lon, radius_km: km }, `${km} km around ${lat}°, ${lon}°`, circleShape(lat, lon, km));
  }
  return (
    <form id="panel-point" role="tabpanel" aria-labelledby="tab-point" onSubmit={submit} className="stack">
      <div className="grid2">
        <label className="field">Latitude<input inputMode="decimal" value={v.lat} onChange={(e) => setV({ ...v, lat: e.target.value })} /></label>
        <label className="field">Longitude<input inputMode="decimal" value={v.lon} onChange={(e) => setV({ ...v, lon: e.target.value })} /></label>
      </div>
      <label className="field">Radius (km)<input inputMode="decimal" value={v.km} onChange={(e) => setV({ ...v, km: e.target.value })} /></label>
      <button className="chip-btn" type="submit">Use this circle</button>
    </form>
  );
}

function AdminForm({ onApply, onError }: FormProps) {
  const [country, setCountry] = useState("EGY");
  const [level, setLevel] = useState(1);
  const [areas, setAreas] = useState<AdminArea[] | null>(null);
  const [loaded, setLoaded] = useState<{ country: string; level: number } | null>(null); // what `areas` belongs to
  const [busy, setBusy] = useState(false);

  async function load(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[A-Za-z]{3}$/.test(country)) return onError("Use a 3-letter country code, e.g. EGY, ARG, CHL.");
    setBusy(true);
    try {
      const body = await api.admin(country.toUpperCase(), level);
      setLoaded({ country: country.toUpperCase(), level });
      setAreas(body.features
        .map((f) => ({ id: f.properties.admin_id, name: f.properties.name ?? f.properties.admin_id, shape: f.geometry }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Boundaries are unavailable right now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="panel-admin" role="tabpanel" aria-labelledby="tab-admin" className="stack">
      <form onSubmit={load} className="grid2">
        <label className="field">Country (ISO3)<input value={country} maxLength={3} onChange={(e) => setCountry(e.target.value)} /></label>
        <label className="field">Level
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            <option value={0}>Country</option><option value={1}>Province</option><option value={2}>District</option>
          </select>
        </label>
        <button className="chip-btn" type="submit" disabled={busy} style={{ gridColumn: "1 / -1" }}>
          {busy ? "Loading…" : "Load areas"}
        </button>
      </form>
      {areas && (
        <label className="field">Area
          <select defaultValue="" onChange={(e) => {
            const a = areas.find((x) => x.id === e.target.value);
            if (a && loaded) onApply({ type: "admin", admin_id: a.id }, `${a.name}, ${loaded.country}`, a.shape, loaded);
          }}>
            <option value="" disabled>Pick one of {areas.length}</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}
