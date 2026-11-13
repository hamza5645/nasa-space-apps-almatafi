"use client";

// What a question shows, drawn as pictures rather than charts: past years as flames, two
// satellites side by side, the map snapshot with the explorer folding his map beside it.
// `answered` reveals what the question hid (this year's flame, the harmonized numbers, which
// map is which).

import { useEffect, useRef, useState } from "react";
import type { Visual as V } from "@/lib/game";
import { MONTHS, fmt } from "@/lib/format";
import Illus, { Flame } from "./Illus";
import Sprite, { type Sheets } from "./Sprite";

export default function Visual({ v, answered, sheets }: { v: V; answered: boolean; sheets: Sheets | null }) {
  if (v.type === "years") return <Years v={v} answered={answered} />;
  if (v.type === "versus") return <Versus v={v} answered={answered} />;
  if (v.type === "months") return <Months v={v} answered={answered} />;
  if (v.type === "trap") return <Trap v={v} />;
  if (v.type === "map") return <MapShot src={v.src} label={v.label} dots={answered ? v.dots : null} sheets={sheets} />;
  if (v.type === "maps") return <TwoMaps v={v} answered={answered} sheets={sheets} />;
  return <div className="vis-illus"><Illus name={v.name} /></div>;
}

function Years({ v, answered }: { v: Extract<V, { type: "years" }>; answered: boolean }) {
  const past = [...v.past].sort((a, b) => a.year - b.year);
  const max = Math.max(1, v.value, ...past.map((p) => p.value));
  const H = 150, base = 176, slot = Math.max(16, Math.min(30, 640 / (past.length + 1)));
  const W = slot * (past.length + 1) + 40;
  const h = (x: number) => Math.max(6, (x / max) * H);
  const tx = 20 + past.length * slot + slot / 2;
  return (
    <figure className="vis-years">
      <svg viewBox={`0 0 ${W} 200`} role="img"
           aria-label={`${v.monthName} in ${past.length} other years as flames; a typical one has ${fmt(v.typical)}${answered ? `; ${v.year} has ${fmt(v.value)}` : ""}.`}>
        <defs><linearGradient id="il-fire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#E14E22" /><stop offset=".55" stopColor="#FF9A3C" /><stop offset="1" stopColor="#FFE39A" /></linearGradient></defs>
        <line x1="10" x2={W - 10} y1={base - h(v.typical)} y2={base - h(v.typical)} className="vy-typical" />
        <text x="12" y={base - h(v.typical) - 6} className="vy-typical-label">typical {v.monthName}: {fmt(v.typical)}</text>
        {past.map((p, i) => (
          <g key={p.year}>
            <Flame x={20 + i * slot + slot / 2} y={base} h={h(p.value)} w={slot * 0.72} />
            <title>{`${v.monthName} ${p.year}: ${fmt(p.value)}`}</title>
            {(i % 2 === 0 || past.length < 14) && <text x={20 + i * slot + slot / 2} y={base + 16} className="vy-year">{`'${String(p.year % 100).padStart(2, "0")}`}</text>}
          </g>
        ))}
        {answered ? (
          <g className="vy-now">
            <circle cx={tx} cy={base - Math.min(h(v.value), 60) / 2} r={Math.min(28, Math.max(16, h(v.value) / 3))} className="vy-glow" />
            <Flame x={tx} y={base} h={h(v.value)} w={slot * 0.9} />
            <text x={tx} y={Math.max(14, base - h(v.value) - 8)} className="vy-now-label">{fmt(v.value)}</text>
          </g>
        ) : (
          <g className="vy-ask"><text x={tx} y={base - 20} className="vy-q">?</text></g>
        )}
        <text x={tx} y={base + 16} className="vy-year now">{v.year}</text>
      </svg>
      <figcaption>Each flame is {v.monthName} in another year; the taller, the more hotspots.</figcaption>
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

function Months({ v, answered }: { v: Extract<V, { type: "months" }>; answered: boolean }) {
  const max = Math.max(1, ...v.values.map((x) => x ?? 0));
  return (
    <figure className="vis-months">
      <svg viewBox="0 0 480 180" role="img" aria-label={`A typical year, month by month${answered ? `: highest in ${MONTHS[v.peak]}` : ""}.`}>
        <defs><linearGradient id="il-fire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#E14E22" /><stop offset=".55" stopColor="#FF9A3C" /><stop offset="1" stopColor="#FFE39A" /></linearGradient></defs>
        {v.values.map((x, j) => (
          <g key={j} opacity={answered && j !== v.peak ? 0.5 : 1}>
            <Flame x={22 + j * 39} y={150} h={Math.max(4, ((x ?? 0) / max) * 128)} w={26} />
            <text x={22 + j * 39} y={170} className={`vy-year${answered && j === v.peak ? " now" : ""}`}>{MONTHS[j]}</text>
          </g>
        ))}
      </svg>
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
          <Sprite sheet={step.part === "fold" ? fold : unfold} height={150} run={step.part === "rest" ? null : `${step.n}-${step.part}`}
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
