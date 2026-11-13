"use client";

// What a question shows, drawn as pictures rather than charts: past years as flames, two
// satellites side by side, the map snapshot with the explorer folding his map beside it.
// `answered` reveals what the question hid (this year's flame, the harmonized numbers, which
// map is which).

import { useEffect, useRef, useState } from "react";
import type { Visual as V } from "@/lib/game";
import { MONTHS, fmt } from "@/lib/format";
import Illus from "./Illus";
import Sprite, { type Sheets } from "./Sprite";

export default function Visual({ v, answered, sheets, unit = 1 }: { v: V; answered: boolean; sheets: Sheets | null; unit?: number }) {
  if (v.type === "years") return <Years v={v} answered={answered} sheets={sheets} unit={unit} />;
  if (v.type === "versus") return <Versus v={v} answered={answered} />;
  if (v.type === "months") return <Months v={v} answered={answered} sheets={sheets} unit={unit} />;
  if (v.type === "trap") return <Trap v={v} />;
  if (v.type === "map") return <MapShot src={v.src} label={v.label} dots={answered ? v.dots : null} sheets={sheets} />;
  if (v.type === "maps") return <TwoMaps v={v} answered={answered} sheets={sheets} />;
  return <div className="vis-illus"><Illus name={v.name} /></div>;
}

/** A flame of the fire sheet, `h` px tall at its tallest frame, flickering; `delay` offsets
 *  the loop so a row of flames doesn't move in step. */
function FlameSprite({ sheets, h, delay = 0, dim = false }: { sheets: Sheets | null; h: number; delay?: number; dim?: boolean }) {
  const fire = sheets?.["fire-chart"];
  if (!fire) return <i className="flame-fallback" style={{ height: h }} />;
  return (
    <div className={`flame-sprite${dim ? " dim" : ""}`} style={{ height: h, animationDelay: `${delay}ms` }}>
      <Sprite sheet={fire} height={h} run="loop" loop fps={fire.fps + (delay % 3)} />
    </div>
  );
}

const eased = (v: number, max: number, H: number) => Math.max(10, Math.pow(Math.max(0, v) / max, 0.75) * H);
/** The tallest flame a chart of n columns can hold without its flames crowding into a wall:
 *  the sheet's frame is 0.72 wide for 1 tall, and a flame may overlap its neighbours by half. */
const chartHeight = (n: number, max = 130) => Math.round(Math.min(max, Math.max(56, (820 / (n + 1.3)) * 2.0)));

function Years({ v, answered, sheets, unit }: { v: Extract<V, { type: "years" }>; answered: boolean; sheets: Sheets | null; unit: number }) {
  // The last 12 years, so each flame is big enough to read (the question's numbers still use every year).
  const past = [...v.past].sort((a, b) => a.year - b.year).slice(-12);
  const max = Math.max(1, v.value, ...past.map((p) => p.value));
  const H = chartHeight(past.length, Math.round(150 * unit ** 1.8));   // much shorter on short screens, so the card fits
  const typicalTop = H - eased(v.typical, max, H);
  return (
    <figure className="vis-years">
      <div className="fl-chart" role="img"
           aria-label={`${v.monthName} in the last ${past.length} years as flames; a typical one has ${fmt(v.typical)}${answered ? `; ${v.year} has ${fmt(v.value)}` : ""}.`}>
        <div className="fl-typical" style={{ top: typicalTop }}><span>Typical {v.monthName}: {fmt(v.typical)}</span></div>
        <div className="fl-row" style={{ height: H }}>
          {past.map((p, i) => (
            <div key={p.year} className="fl-col" title={`${v.monthName} ${p.year}: ${fmt(p.value)}`}>
              <FlameSprite sheets={sheets} h={eased(p.value, max, H)} delay={i * 137} />
              <span className="fl-year">{(i % 2 === past.length % 2 || past.length < 14) ? `'${String(p.year % 100).padStart(2, "0")}` : ""}</span>
            </div>
          ))}
          <div className="fl-col fl-now">
            {answered ? (
              <><div className="fl-now-glow" /><FlameSprite sheets={sheets} h={eased(v.value, max, H)} /><b className="fl-now-label">{fmt(v.value)}</b></>
            ) : (
              <div className="fl-ask" style={{ height: eased(v.typical, max, H) }}><span>?</span></div>
            )}
            <span className="fl-year now">{v.year}</span>
          </div>
        </div>
      </div>
      <figcaption>Each flame is {v.monthName} in one of the last {past.length} years: the taller, the more hotspots.</figcaption>
    </figure>
  );
}

function SatIcon({ kind }: { kind: "MODIS" | "VIIRS" | null }) {
  const c = kind === "VIIRS" ? "#6BD0E4" : "#E8C79A";
  const cells = kind === "VIIRS" ? 6 : 3;
  return (
    <svg viewBox="0 0 60 60" width="54" height="54" aria-hidden="true">
      {Array.from({ length: cells * cells }, (_, i) => <rect key={i} x={6 + (i % cells) * (48 / cells)} y={6 + Math.floor(i / cells) * (48 / cells)} width={48 / cells - 2} height={48 / cells - 2} rx="1.5" fill={c} opacity={(i * 7) % 5 === 0 ? 0.95 : 0.22} />)}
    </svg>
  );
}

function Versus({ v, answered }: { v: Extract<V, { type: "versus" }>; answered: boolean }) {
  const card = (s: typeof v.left, after: number | undefined, side: "l" | "r") => (
    <div className={`vv-card ${s.sensor === "VIIRS" ? "viirs" : "modis"}`}>
      <SatIcon kind={s.sensor} />
      <div className="vv-sensor">{s.sensor}<span>{s.note}</span></div>
      <div className="vv-title">{s.title}</div>
      <div className="vv-num">{fmt(s.value)}<span>hotspots</span></div>
      {answered && after !== undefined && (
        <div className={`vv-after ${side}`}><b>{fmt(Math.round(after))}</b> on our record</div>
      )}
    </div>
  );
  return (
    <div className="vis-versus">
      {card(v.left, v.after?.left, "l")}
      <div className="vv-vs" aria-hidden="true">vs</div>
      {card(v.right, v.after?.right, "r")}
      {answered && v.after && <p className="vv-note">{v.after.label}: the earlier year burned more.</p>}
    </div>
  );
}

function Months({ v, answered, sheets, unit }: { v: Extract<V, { type: "months" }>; answered: boolean; sheets: Sheets | null; unit: number }) {
  const max = Math.max(1, ...v.values.map((x) => x ?? 0));
  const H = chartHeight(12, Math.round(130 * unit ** 1.8));
  return (
    <figure className="vis-months">
      <div className="fl-chart" role="img" aria-label={`A typical year, month by month${answered ? `: highest in ${MONTHS[v.peak]}` : ""}.`}>
        <div className="fl-row" style={{ height: H }}>
          {v.values.map((x, j) => (
            <div key={j} className={`fl-col${answered && j === v.peak ? " fl-peak" : ""}`}>
              <FlameSprite sheets={sheets} h={eased(x ?? 0, max, H)} delay={j * 151} dim={answered && j !== v.peak} />
              <span className={`fl-year${answered && j === v.peak ? " now" : ""}`}>{MONTHS[j]}</span>
            </div>
          ))}
        </div>
      </div>
      <figcaption>A typical year here, month by month.</figcaption>
    </figure>
  );
}

function Trap({ v }: { v: Extract<V, { type: "trap" }> }) {
  const max = Math.max(1, ...v.raw, ...v.ours);
  const pair = (label: string, [a, b]: [number, number], before: string, after: string) => (
    <div className="vt-pair">
      <span className="vt-title">{label}</span>
      <div className="vt-cols">
        <div className="vt-col"><i className={before} style={{ height: `${(a / max) * 100}%` }} /><span>before 2012</span></div>
        <div className="vt-col"><i className={after} style={{ height: `${(b / max) * 100}%` }} /><span>after</span></div>
      </div>
      <span className="vt-ratio">{fmt(b / Math.max(a, 1e-9), 2)}×</span>
    </div>
  );
  return <div className="vis-trap">{pair("Raw, glued", v.raw, "modis", "viirs")}{pair("Harmonized", v.ours, "ours", "ours")}</div>;
}

type Step = { n: number; part: "fold" | "unfold" | "rest" };

/** The map snapshot. Beside it the explorer folds his map shut and opens it again, rests 3 s
 *  and repeats; hovering (or focusing) the map replays it at once. */
function MapShot({ src, label, dots, sheets, tag }: { src: string; label: string; dots: number | null; sheets: Sheets | null; tag?: string }) {
  const [step, setStep] = useState<Step>({ n: 1, part: "fold" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const fold = sheets?.["explorer-fold"], unfold = sheets?.["explorer-unfold"];
  const replay = () => {
    if (step.part !== "rest") return;
    if (timer.current) clearTimeout(timer.current);
    setStep((s) => ({ n: s.n + 1, part: "fold" }));
  };
  const ended = () => {
    if (step.part === "fold") { setStep((s) => ({ ...s, part: "unfold" })); return; }
    setStep((s) => ({ ...s, part: "rest" }));
    timer.current = setTimeout(() => setStep((s) => ({ n: s.n + 1, part: "fold" })), 3000);
  };
  return (
    <figure className="vis-map" onMouseEnter={replay} onFocus={replay} tabIndex={0}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static snapshot of our own map */}
      <img src={src} alt={`Map of ${label}: each dot is a hotspot`} loading="eager" decoding="async" />
      <figcaption>
        {tag && <span className="vm-tag">{tag}</span>}
        <span>{label}</span>
        {dots !== null && <b>{fmt(dots)} hotspots</b>}
      </figcaption>
      {fold && unfold && (
        <div className="explorer-guy"><div className="explorer-c">
          <Sprite sheet={step.part === "fold" ? fold : unfold} height={130} run={step.part === "rest" ? null : `${step.n}-${step.part}`}
                  still={unfold.frames - 1} onEnd={ended} label="An explorer folding and unfolding his map" />
        </div></div>
      )}
    </figure>
  );
}

function TwoMaps({ v, answered, sheets }: { v: Extract<V, { type: "maps" }>; answered: boolean; sheets: Sheets | null }) {
  return (
    <div className="vis-maps">
      <MapShot src={v.left.src} label={answered ? "MODIS" : "Left map"} dots={answered ? v.left.dots : null} sheets={sheets} tag="L" />
      <MapShot src={v.right.src} label={answered ? "VIIRS" : "Right map"} dots={answered ? v.right.dots : null} sheets={null} tag="R" />
    </div>
  );
}
