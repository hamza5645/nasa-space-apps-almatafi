"use client";

// The explorer (U1, redesigned in X12): a toolbar of choices, the answer for the selected
// month, then the burning calendar beside the map, and the yearly totals by sensor.
// Everything reads the shared selection.

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Aoi } from "@/lib/api";
import { api, type ApiError, type Region } from "@/lib/api";
import { monthLabel } from "@/lib/format";
import { bboxShape, circleShape, type Shape } from "@/lib/geo";
import { referencePlatform } from "@/lib/platforms";
import { decode, encode } from "@/lib/share";
import { cloudsApply, useCalendar, useHotspots, useRegions, useStats } from "@/lib/queries";
import { DEFAULT, useSelection } from "@/lib/store";
import AlertMenu from "./AlertMenu";
import AreaPanel from "./AreaPanel";
import Brand from "./Brand";
import Calendar from "./Calendar";
import CompareSlider from "./CompareSlider";
import "./compare.css";
import ExportMenu from "./ExportMenu";
import HotspotPanel from "./HotspotPanel";
import Popover from "./Popover";
import SensorChart from "./SensorChart";
import Verdict from "./Verdict";
import "./explorer.css";
import "./explorer-x15.css";
import "./explorer-x27.css";

// MapLibre needs the browser, so the map is only rendered on the client.
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="map map-placeholder"><p className="hint">Loading the map…</p></div>,
});

type RegionInfo = Pick<Region, "region_id" | "name" | "country" | "default_month" | "bbox"> & { geometry?: Region["geometry"] };

// Built in, so the pills and the map still work when /api/regions can't be reached.
const FALLBACK_REGIONS: RegionInfo[] = [
  { region_id: "nile-delta", name: "Nile Delta", country: "Egypt", default_month: "2026-10", bbox: [29.9, 30.0, 32.3, 31.6] },
  { region_id: "rio-negro", name: "Río Negro", country: "Argentina", default_month: "2026-07", bbox: [-71.8, -41.8, -68.0, -39.5] },
];

const regionShape = (r: RegionInfo): Shape => r.geometry ?? bboxShape(r.bbox);

// The calendar starts in 2001 (Terra's first full year). "To" this year means the newest month.
const THIS_YEAR = new Date().getUTCFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 2001 + 1 }, (_, i) => 2001 + i);

const UNIT_NOTE = {
  harmonized: "harmonized to VIIRS S-NPP",
  modis: "raw MODIS, Terra and Aqua",
  viirs: "raw VIIRS S-NPP",
} as const;

const VIEWS = [["harmonized", "Harmonized"], ["modis", "MODIS only"], ["viirs", "VIIRS only"]] as const;
const METRICS = [["detections", "Hotspots"], ["fire_days", "Fire days"]] as const;
const CLOUDS = [["seen", "As seen"], ["fixed", "Cloud-corrected"]] as const;

export default function Explorer() {
  const s = useSelection();
  const regions = useRegions();
  const cal = useCalendar(s.aoi, s.start, s.end, s.view, s.metric, s.clouds);
  const stats = useStats(s.aoi, s.month, s.view, s.metric, s.clouds);
  // X27: cloud cover comes with every calendar when the backend has it; the correction only
  // applies to harmonized hotspots.
  const cloudInfo = cal.data?.clouds;
  const canFix = Boolean(cloudInfo) && cloudsApply(s.view, s.metric, true);
  const fixed = canFix && s.clouds;
  // The yearly-totals chart compares all three views; the selected one is already cached
  // (except the cloud-corrected calendar, which is its own request).
  const harm = useCalendar(s.aoi, s.start, s.end, "harmonized", s.metric);
  const modis = useCalendar(s.aoi, s.start, s.end, "modis", s.metric);
  const viirs = useCalendar(s.aoi, s.start, s.end, "viirs", s.metric);

  const hotspots = useHotspots(s.aoi, s.month, s.view);

  // Several satellites see the same fires. By default the map shows the one the calendar
  // counts that month, so the dots and the number agree; "all" shows every satellite.
  const [platform, setPlatform] = useState<string>("ref");
  const ref = s.month ? referencePlatform(s.view, s.month) : null;
  const shown = useMemo(() => {
    const d = hotspots.data;
    const want = platform === "ref" ? ref : platform === "all" ? null : platform;
    return d && want ? { ...d, features: d.features.filter((f) => f.properties.platform === want) } : d;
  }, [hotspots.data, platform, ref]);

  // A month outside the calendar (new area, raw VIIRS before 2012) falls back to the newest one.
  const data = cal.data;
  const observed = useMemo(() => (data ? data.years.flatMap((y, i) => data.matrix[i]
    .map((v, m) => (v === null ? null : `${y}-${String(m + 1).padStart(2, "0")}`))).filter((x): x is string => x !== null) : []), [data]);
  useEffect(() => {
    if (!data || cal.isPlaceholderData) return;
    if (observed.length && (s.month === null || !observed.includes(s.month))) s.selectMonth(observed[observed.length - 1]);
  }, [observed, cal.isPlaceholderData]); // eslint-disable-line react-hooks/exhaustive-deps

  // The URL holds the view (U5): read it once, then keep it up to date.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const shared = decode(window.location.search);
    if (!shared.aoi) return;
    const a = shared.aoi;
    const region = a.type === "region" ? FALLBACK_REGIONS.find((r) => r.region_id === a.region_id) : undefined;
    const shape: Shape | null = region ? regionShape(region)
      : a.type === "bbox" ? bboxShape(a.bbox as [number, number, number, number])
      : a.type === "point" ? circleShape(a.lat, a.lon, a.radius_km)
      : a.type === "polygon" ? (a.geometry as unknown as Shape) : null;
    // Start from the defaults: a link only lists what differs from them, and the store
    // survives client-side navigation.
    s.replace({ ...DEFAULT, ...shared, aoiLabel: region ? `${region.name}, ${region.country}` : shared.aoiLabel, shape, hotspot: null });
    if (a.type === "admin" && shared.adminRef) {
      const { country, level } = shared.adminRef;
      api.admin(country, level).then((doc) => {
        const f = doc.features.find((x) => x.properties.admin_id === a.admin_id);
        const now = useSelection.getState();
        if (f && now.aoi.type === "admin" && now.aoi.admin_id === a.admin_id) now.replace({ shape: f.geometry });
      }).catch(() => { /* the data still loads; only the outline is missing */ });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!restored.current) return;
    const q = encode(s);
    if (`?${q}` !== window.location.search) window.history.replaceState(null, "", `?${q}`);
  }, [s.aoi, s.aoiLabel, s.start, s.end, s.view, s.metric, s.month, s.clouds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Region outlines arrive with /api/regions; fill in the shape if the page started without one.
  useEffect(() => {
    const r = regions.data?.regions.find((x) => s.aoi.type === "region" && x.region_id === s.aoi.region_id);
    if (r && !s.shape) s.replace({ shape: r.geometry });
  }, [regions.data, s.aoi]); // eslint-disable-line react-hooks/exhaustive-deps

  const offline = [cal.data, stats.data, hotspots.data].some((d) => d && "offline" in d && d.offline);
  const regionList = regions.data?.regions ?? FALLBACK_REGIONS;
  const activeRegion = s.aoi.type === "region" ? s.aoi.region_id : null;

  // Behind the answer: a faint, blurred scene of the place (generated stills for the demo
  // areas, Earth at night elsewhere), fading into the page.
  const sky = activeRegion === "nile-delta" ? "/media/nile-delta.webp" : activeRegion === "rio-negro" ? "/media/rio-negro.webp" : "/media/night-orbit.webp";

  return (
    <div className="explorer">
      <div className="xp-sky" aria-hidden="true" style={{ backgroundImage: `url(${sky})` }} />
      <header className="topbar">
        <Brand size={24} />
        <div className="choices">
          <Popover className="area-pop" ariaLabel={`Area: ${s.aoiLabel}. Change the area`}
                   label={<><span className="pop-key">Area</span><span className="pop-val">{s.aoiLabel}</span></>}>
            {(close) => (
              <div className="area-menu">
                <CloseOnChange value={s.aoi} close={close} />
                <p className="menu-title">Demo areas</p>
                <div className="area-regions">
                  {regionList.map((r) => (
                    <button key={r.region_id} type="button" aria-pressed={activeRegion === r.region_id}
                            onClick={() => s.setAoi({ type: "region", region_id: r.region_id }, `${r.name}, ${r.country}`,
                                                    { month: r.default_month, shape: regionShape(r) })}>
                      <strong>{r.name}</strong><span>{r.country}</span>
                    </button>
                  ))}
                </div>
                <p className="menu-title">Anywhere else</p>
                <AreaPanel />
              </div>
            )}
          </Popover>
          <div className="years" role="group" aria-label="Years">
            <label><span className="sr-only">From</span>
              <select value={Math.max(2001, Number(s.start.slice(0, 4)))} onChange={(e) => s.setRange(`${e.target.value}-01`, s.end)}>
                {YEARS.map((y) => <option key={y} value={y} disabled={s.end !== null && `${y}` > s.end.slice(0, 4)}>{y}</option>)}
              </select>
            </label>
            <span aria-hidden="true">to</span>
            <label><span className="sr-only">To</span>
              <select value={s.end ? s.end.slice(0, 4) : "newest"}
                      onChange={(e) => s.setRange(s.start, e.target.value === "newest" || Number(e.target.value) >= THIS_YEAR
                        ? null : `${e.target.value}-12`)}>
                <option value="newest">now</option>
                {YEARS.filter((y) => y < THIS_YEAR).map((y) => <option key={y} value={y} disabled={`${y}` < s.start.slice(0, 4)}>{y}</option>)}
              </select>
            </label>
          </div>
          <Segmented label="Data" options={VIEWS} value={s.view} onChange={s.setView} />
          <Segmented label="Count" options={METRICS} value={s.metric} onChange={s.setMetric} />
        </div>
        <AlertMenu />
        <ExportMenu latest={observed.at(-1) ?? null} />
      </header>
      {offline && (
        <p className="warn offline" role="status">
          The server isn&apos;t answering, so this is the saved copy of the demo area. Other areas, months and
          downloads come back when it does.
        </p>
      )}

      <Verdict stats={stats.data} loading={stats.isFetching} error={stats.error as ApiError | null}
               month={s.month} metric={s.metric} view={s.view} />

      <div className="xp-grid">
        <section className="cal" aria-label="Burning calendar">
          <div className="calhead">
            <h2>Burning calendar</h2>
            <p className="muted">
              {s.aoiLabel}: {s.metric === "detections" ? "hotspots" : "fire days"} per month, {UNIT_NOTE[s.view]}.
              Pick a month to see it on the map.
            </p>
          </div>
          {s.view !== "harmonized" && (
            <p className="warn" role="note">
              Raw counts can&apos;t be compared across 2012: VIIRS sees 3 to 5 times more hotspots than MODIS for
              the same fires. Switch to Harmonized to compare years.
            </p>
          )}
          {cloudInfo && (
            <div className="cloud-row">
            {canFix && (
              <Segmented label="Clouds" options={CLOUDS} value={s.clouds ? "fixed" : "seen"} onChange={(v) => s.setClouds(v === "fixed")} />
            )}
            <p className="cloud-note" role="note">
              <CloudIcon /> marks months when more than half of the area was under cloud at the satellite&apos;s pass,
              so fires there could be hidden.{" "}
              {fixed ? "Counts are corrected for it: each cell's count divided by its clear-sky share, at most 5 times. "
                     : canFix ? "Cloud-corrected makes up for them. " : ""}
              {cloudInfo.source === "mock" && <strong>Cloud cover is simulated for now: NASA&apos;s MODIS cloud product (MOD14CMH) isn&apos;t loaded yet.</strong>}
            </p>
            </div>
          )}
          {cal.error && <p className="error" role="alert">{(cal.error as ApiError).message}</p>}
          {!cal.data && !cal.error && <div className="cal-skeleton" aria-busy="true">Loading the calendar…</div>}
          {cal.data && (
            <div className="cal-body" style={{ opacity: cal.isPlaceholderData ? 0.5 : 1 }}>
              <Calendar data={cal.data} selected={s.month} onSelect={s.selectMonth} />
            </div>
          )}
        </section>

        <section className="mapcol" aria-label="Map and hotspots">
          <MapView hotspots={shown} loading={hotspots.isFetching} />
          <HotspotPanel data={hotspots.data} shown={shown} loading={hotspots.isFetching} error={hotspots.error as ApiError | null}
                        selected={s.hotspot} onSelect={s.selectHotspot}
                        platform={platform} refPlatform={ref} onPlatform={setPlatform} />
        </section>
      </div>

      {harm.data && modis.data && viirs.data && (
        <section className="xp-sensors xp-compare" aria-label="Raw join against the harmonized record">
          <div className="sensors-text">
            <h2>Drag the line</h2>
            <p>
              The same calendar twice. Left of the line, MODIS glued to VIIRS as they come; right of it, our record.
              Same colours for the same numbers.
            </p>
            <p className="muted">If the raw side brightens from 2012 and ours doesn&apos;t, that brightening was the satellite, not the fires.</p>
            <Link href="/play">Test your eye: play Normal or not?</Link>
          </div>
          <CompareSlider harmonized={harm.data} modis={modis.data} viirs={viirs.data} place={s.aoiLabel}
                         unit={s.metric === "detections" ? "hotspots" : "fire days"} />
        </section>
      )}

      <section className="xp-sensors" aria-label="Yearly totals by sensor">
        <div className="sensors-text">
          <h2>Why harmonize</h2>
          <p>
            VIIRS joined MODIS in 2012 with sharper pixels, so the same fires suddenly made more hotspots. Glue the raw
            counts together and every place looks like it started burning more in 2012. The harmonized record converts
            MODIS years to what VIIRS would have counted, so years can be compared.
          </p>
          <Link href="/method">How the conversion works</Link>
        </div>
        <SensorChart harmonized={harm.data} modis={modis.data} viirs={viirs.data} />
      </section>
    </div>
  );
}

function Segmented<T extends string>({ label, options, value, onChange }:
  { label: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export function CloudIcon() {
  return (
    <svg className="cloud-ico" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-label="cloud" role="img">
      <path d="M7 18a5 5 0 0 1-.6-9.96A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z" />
    </svg>
  );
}

/** Closes the area menu once a new area is chosen. */
function CloseOnChange({ value, close }: { value: Aoi; close: () => void }) {
  const first = useRef(value);
  useEffect(() => { if (value !== first.current) close(); }, [value, close]);
  return null;
}
