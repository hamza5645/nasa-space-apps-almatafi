"use client";

// Details of the clicked hotspot (U4), plus the month's strongest fires to pick from.

import type { ApiError, Hotspots } from "@/lib/api";
import { fmt, utcLabel } from "@/lib/format";
import { PLATFORM_LABEL, PLATFORM_ORDER, countByPlatform } from "@/lib/platforms";
import type { SelectedHotspot } from "@/lib/store";

const PLATFORM: Record<string, string> = {
  Terra: "MODIS · Terra", Aqua: "MODIS · Aqua", SNPP: "VIIRS · Suomi NPP", NOAA20: "VIIRS · NOAA-20", NOAA21: "VIIRS · NOAA-21",
};

type Props = {
  data?: Hotspots; shown?: Hotspots; loading: boolean; error: ApiError | null;
  selected: SelectedHotspot | null; onSelect: (h: SelectedHotspot) => void;
  platform: string; refPlatform: string | null; onPlatform: (p: string) => void;
};

export default function HotspotPanel({ data, shown, loading, error, selected, onSelect, platform, refPlatform, onPlatform }: Props) {
  const top = (shown?.features ?? []).slice().sort((a, b) => (b.properties.frp ?? 0) - (a.properties.frp ?? 0)).slice(0, 5);
  const counts = data ? countByPlatform(data.features, data.by_platform) : {};
  const present = PLATFORM_ORDER.filter((p) => counts[p]);
  const refLabel = refPlatform ? PLATFORM_LABEL[refPlatform] ?? refPlatform : null;
  return (
    <div className="box">
      <h2>Hotspot details</h2>
      {selected ? <Details h={selected} /> : <p className="hint" style={{ fontSize: 13 }}>Click a dot on the map, or one of the strongest fires below.</p>}
      {error && (
        <p className="hint" style={{ fontSize: 13 }}>
          {error.code === "data_unavailable"
            ? "Individual hotspots are stored for the demo regions only; for other areas they load live for up to 31 days when the server has a FIRMS key."
            : error.message}
        </p>
      )}
      {loading && !data && <p className="hint" style={{ fontSize: 13 }}>Loading hotspots…</p>}
      {data && (
        <>
          {present.length > 1 && (
            <div className="seg plat-seg" role="group" aria-label="Satellites on the map">
              {refPlatform && counts[refPlatform] !== undefined && (
                <button type="button" aria-pressed={platform === "ref"} onClick={() => onPlatform("ref")}>
                  {refLabel} ({fmt(counts[refPlatform])})
                </button>
              )}
              <button type="button" aria-pressed={platform === "all"} onClick={() => onPlatform("all")}>
                All ({fmt(data.total)})
              </button>
              {present.filter((p) => p !== refPlatform).map((p) => (
                <button key={p} type="button" aria-pressed={platform === p} onClick={() => onPlatform(p)}>
                  {PLATFORM_LABEL[p] ?? p} ({fmt(counts[p])})
                </button>
              ))}
            </div>
          )}
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            {platform === "ref" && refLabel && present.length > 1
              ? `The map shows ${refLabel}, the satellite the calendar counts this month. Other satellites see many of the same fires, so adding them up would count fires twice.`
              : `${fmt(shown?.features.length ?? 0)} detections on the map.`}
            {data.truncated ? ` Showing the newest ${fmt(data.features.length)} of ${fmt(data.total)}.` : ""}
            {data.total === 0 && " No detections doesn't always mean no fire: clouds and smoke hide fires from satellites."}
          </p>
          {data.on_demand && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Fetched live from NASA FIRMS for this area.</p>}
          {top.length > 0 && (
            <ol className="toplist">
              {top.map((f) => {
                const p = f.properties;
                const [lon, lat] = f.geometry.coordinates;
                const on = selected?.point_id === p.point_id;
                return (
                  <li key={p.point_id}>
                    <button type="button" aria-pressed={on} onClick={() => onSelect({ ...p, lon, lat })}>
                      <strong>{fmt(p.frp, 1)} MW</strong>
                      <span className="muted">{utcLabel(p.acq_datetime_utc).split(",")[0]} · {p.sensor}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function Details({ h }: { h: SelectedHotspot }) {
  const conf = h.confidence_pct !== null ? `${h.confidence_class} (${h.confidence_pct}%)` : h.confidence_class;
  return (
    <dl className="kv">
      <dt>Detected</dt><dd>{utcLabel(h.acq_datetime_utc)}</dd>
      <dt>Pass</dt><dd>{h.daynight === "D" ? "Day" : "Night"}</dd>
      <dt>Latitude</dt><dd>{h.lat.toFixed(4)}</dd>
      <dt>Longitude</dt><dd>{h.lon.toFixed(4)}</dd>
      <dt>Fire power (FRP)</dt><dd>{fmt(h.frp, 1)} MW</dd>
      <dt>Confidence</dt><dd>{conf}</dd>
      <dt>Sensor</dt><dd>{PLATFORM[h.platform] ?? h.platform}</dd>
      <dt>Pixel</dt><dd>{fmt(h.scan_km, 2)} × {fmt(h.track_km, 2)} km</dd>
    </dl>
  );
}
