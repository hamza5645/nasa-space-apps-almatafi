"use client";

// X33 v2: one chart that morphs from the raw join to our record. One bar per year (that year's
// mean month). At the left end of the slider the bars are the raw join: MODIS (sand) until 2012,
// VIIRS (blue) from it, so the years after 2012 tower over the ones before. Slide right and every
// bar moves in a straight line to our harmonized record (fire orange) on the same scale: the 2012
// step is gone. The headline reads the jump off the bars as they move. It plays once on its own
// the first time it scrolls into view (not with reduced motion, not after the user touched it).

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { barAt, barJump, compare, sideMeans, yearBars, type Bar, type Grid } from "@/lib/compare";
import { fmt, short } from "@/lib/format";

type Props = { harmonized: Grid; modis: Grid; viirs: Grid; place: string; tone?: "dark" | "light"; unit?: string };

const DEMO_MS = 2200;          // the one-time 0 → 100 sweep
const DEMO_HOLD_MS = 600;      // show the raw jump first
const NO_JUMP = [0.8, 1.25];   // a harmonized ratio in here reads as "no jump"; outside it, a trend in the burning

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 11.6× or 0.85×, with fixed decimals so the number doesn't jitter while it moves. */
function times(r: number | null): string {
  if (r === null) return "–";
  const d = r < 2 ? 2 : r < 100 ? 1 : 0;
  return `${r.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}×`;
}

function niceTicks(max: number): number[] {
  if (max <= 0) return [0];
  const step = 10 ** Math.floor(Math.log10(max / 4));
  const k = ([1, 2, 5, 10].find((m) => max / (m * step) <= 4) ?? 10) * step;
  return Array.from({ length: Math.floor(max / k) + 1 }, (_, i) => i * k);
}

const tickLabel = (v: number) => (v >= 1000 ? short(v) : fmt(v, 1));

export default function CompareSlider({ harmonized, modis, viirs, place, tone = "dark", unit = "hotspots" }: Props) {
  const bars = useMemo(() => yearBars(compare(harmonized, modis, viirs)), [harmonized, modis, viirs]);
  const [t, setT] = useState(0);           // 0 = raw join, 100 = harmonized
  const [w, setW] = useState(720);         // chart width in px; the SVG draws 1 unit = 1 px
  const root = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const tNow = useRef(0);
  const raf = useRef(0);
  const touched = useRef(false);
  const gid = `cmp-fire-${useId().replace(/[^\w-]/g, "")}`;

  const set = (v: number) => { tNow.current = v; setT(v); };

  function animateTo(target: number) {
    touched.current = true;
    cancelAnimationFrame(raf.current);
    const from = tNow.current, ms = 300 + 700 * Math.abs(target - from) / 100;
    if (from === target || reducedMotion()) { set(target); return; }
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      set(k === 1 ? target : from + (target - from) * ease(k));
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }

  function grab(v: number) {
    touched.current = true;
    cancelAnimationFrame(raf.current);
    set(Math.max(0, Math.min(100, v)));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    const d = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    grab(Math.round(tNow.current) + d);
  }

  // The chart is drawn in real pixels, so its labels stay readable at phone width.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The one-time demo: hold on the raw jump, then sweep to our record.
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion()) return;
    let hold = 0, frame = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || touched.current) return;
      io.disconnect();
      hold = window.setTimeout(() => {
        const t0 = performance.now();
        const step = (now: number) => {
          if (touched.current) return;
          const k = Math.min(1, (now - t0) / DEMO_MS);
          tNow.current = k === 1 ? 100 : 100 * ease(k);
          setT(tNow.current);
          if (k < 1) frame = requestAnimationFrame(step);
        };
        if (!touched.current) frame = requestAnimationFrame(step);
      }, DEMO_HOLD_MS);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(hold); cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => {
    const r = raf;
    return () => cancelAnimationFrame(r.current);
  }, []);

  const k = t / 100;
  const rawJ = barJump(bars, 0), harmJ = barJump(bars, 1), nowJ = barJump(bars, k);
  const first = bars[0]?.year, last = bars.at(-1)?.year;
  const span = first === undefined ? "" : `${first}–${last}`;
  // All three headlines sit in one grid cell, only the current one visible, so the block is as
  // tall as the longest and nothing below it moves when the words change.
  const phase = k <= 0.02 ? "raw" : k >= 0.98 ? "harm" : "mid";
  const says = (["raw", "mid", "harm"] as const).map((p) => ({ p, ...headline(p, rawJ, harmJ), num: p === "raw" ? rawJ : p === "harm" ? harmJ : nowJ }));
  const numColor = `color-mix(in oklch longer hue, var(--cmp-num-b) ${t.toFixed(1)}%, var(--cmp-num-a))`;
  const valueText = k === 0 ? `Raw: ${times(rawJ)} after 2012`
    : k === 1 ? `Harmonized: ${times(harmJ)} after 2012`
    : `${Math.round(t)}% of the way to harmonized: ${times(nowJ)} after 2012`;
  const summary = bars.length
    ? `Bar chart of the mean ${unit} per month for each year in ${place}, ${span}. On the raw join (MODIS until 2012, ` +
      `then VIIRS) the years from 2012 average ${times(rawJ)} the years before. On the harmonized record they average ${times(harmJ)}.`
    : `Not enough full years in ${place} to compare the raw join and the harmonized record.`;

  return (
    <figure ref={root} className={`cmp cmp-${tone}`}>
      <div className="cmp-head">
        <div className="cmp-say">
          {says.map(({ p, lead, tail, sub, num }) => (
            <div key={p} className={p === phase ? "cmp-phase on" : "cmp-phase"} aria-hidden={p !== phase}>
              <div className="cmp-big">
                {lead}{num !== null && <> <b className="cmp-num" style={{ color: numColor }}>{times(num)}</b></>}
                {tail && <> {tail}</>}
              </div>
              <div className="cmp-sub">{sub}</div>
            </div>
          ))}
        </div>
        <div className="cmp-seg" role="group" aria-label="Show one end">
          <button type="button" aria-pressed={t === 0} onClick={() => animateTo(0)}>Raw</button>
          <button type="button" aria-pressed={t === 100} onClick={() => animateTo(100)}>Harmonized</button>
        </div>
      </div>

      <div className="cmp-chart" ref={box}>
        {bars.length > 0
          ? <Chart bars={bars} k={k} w={w} gid={gid} unit={unit} label={summary} />
          : <div className="cmp-empty">{summary}</div>}
      </div>

      <div className="cmp-ctrl">
        <input type="range" className="cmp-range" min={0} max={100} step={1} value={Math.round(t)}
               style={{ "--fill": `${t}%` } as CSSProperties}
               aria-label="Morph the chart from the raw join to the harmonized record" aria-valuetext={valueText}
               onChange={(e) => grab(Number(e.target.value))} onKeyDown={onKey}
               onPointerDown={() => { touched.current = true; cancelAnimationFrame(raf.current); }} />
        <div className="cmp-ends" aria-hidden="true">
          <span><b>Raw:</b> <span><i className="cmp-sw cmp-sw-modis" />MODIS, then <i className="cmp-sw cmp-sw-viirs" />VIIRS glued on</span></span>
          <span><b>Harmonized:</b> <span><i className="cmp-sw cmp-sw-fire" />Almatafi</span></span>
        </div>
      </div>

      <figcaption>
        {place}: each bar is one year&apos;s average month, in {unit}{span && `, ${span}`}, on one scale at both ends.
        Dashed lines: the average year before 2012 and from 2012 on.
      </figcaption>
    </figure>
  );
}

function headline(phase: "raw" | "mid" | "harm", rawJ: number | null, harmJ: number | null) {
  if (rawJ === null || harmJ === null)
    return { lead: "Raw join and our record", tail: "", sub: "Too few full years on one side of 2012 to measure a jump here." };
  if (phase === "raw") return rawJ >= NO_JUMP[1]
    ? { lead: "Fires seem to jump", tail: "in 2012", sub: "VIIRS sees smaller fires than MODIS, so the same burning makes more hotspots." }
    : { lead: "Raw join:", tail: "after 2012", sub: "MODIS until 2012, then VIIRS glued on." };
  if (phase === "harm") return harmJ >= NO_JUMP[0] && harmJ <= NO_JUMP[1]
    ? { lead: "No jump:", tail: "", sub: "It was the satellite, not the fires." }
    : { lead: "Satellite jump gone:", tail: "after 2012", sub: "What's left is the burning's own trend, not the sensor." };
  return { lead: "Jump at 2012:", tail: "", sub: "Converting the MODIS years to what VIIRS would have counted…" };
}

type ChartProps = { bars: Bar[]; k: number; w: number; gid: string; unit: string; label: string };

function Chart({ bars, k, w, gid, unit, label }: ChartProps) {
  const narrow = w < 560;
  const W = w, H = narrow ? 230 : 280, L = narrow ? 32 : 42, R = 6, T = 30, B = 24;
  const y0 = bars[0].year, y1 = bars.at(-1)!.year;
  const band = (W - L - R) / (y1 - y0 + 1);
  const bw = Math.max(2, band * (narrow ? 0.72 : 0.64));
  const top = Math.max(...bars.flatMap((b) => [b.raw, b.harm])) * 1.08 || 1;
  const yv = (v: number) => T + (1 - v / top) * (H - T - B);
  const bx = (year: number) => L + (year - y0) * band + (band - bw) / 2;
  const base = H - B;
  const x12 = y0 < 2012 && y1 >= 2012 ? L + (2012 - y0) * band : null;
  const m = sideMeans(bars, k);
  const yb = m.before === null ? null : yv(m.before), ya = m.after === null ? null : yv(m.after);
  const rise = yb !== null && ya !== null ? yb - ya : 0;   // > 0 when the years after 2012 sit higher
  const labelled = bars.map((b) => b.year).filter((y, _, all) =>
    y % 5 === 0 || ((y === y0 || y === y1) && !all.some((o) => o % 5 === 0 && o !== y && Math.abs(o - y) < 3)));
  const r = Math.min(3, bw / 3);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1={base} x2="0" y2={T}>
          <stop offset="0" className="cmp-stop-a" />
          <stop offset="1" className="cmp-stop-b" />
        </linearGradient>
      </defs>

      {niceTicks(top).map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={yv(v)} y2={yv(v)} className={v === 0 ? "cmp-base" : "cmp-grid"} />
          <text x={L - 7} y={yv(v) + 4} textAnchor="end" className="cmp-tick">{tickLabel(v)}</text>
        </g>
      ))}

      {bars.map((b) => {
        const v = barAt(b, k), y = Math.min(yv(v), base - (v > 0 ? 1 : 0)), x = bx(b.year);
        return (
          <g key={b.year}>
            <title>{`${b.year}: ${fmt(b.raw, 1)} on the raw join, ${fmt(b.harm, 1)} harmonized (${unit} per month)`}</title>
            <rect x={x} y={y} width={bw} height={base - y} rx={r} fill={`url(#${gid})`} />
            <rect x={x} y={y} width={bw} height={base - y} rx={r} opacity={1 - k} style={{ fill: sensorFill(b.year, k) }} />
          </g>
        );
      })}

      {/* the two averages, as a step at 2012, and an arrow up the step on the raw side */}
      {x12 !== null && yb !== null && ya !== null && (
        <g className="cmp-means" aria-hidden="true">
          <line x1={L} x2={x12} y1={yb} y2={yb} className="cmp-mean" />
          <line x1={x12} x2={W - R} y1={ya} y2={ya} className="cmp-mean" />
          {Math.abs(rise) > 14 && (
            <g opacity={Math.min(1, (Math.abs(rise) - 14) / 16) * (1 - fade(k, 0.5, 0.95))}>
              <path d={arrow(x12, yb, ya)} className="cmp-halo" />
              <path d={arrow(x12, yb, ya)} className="cmp-arrow" />
            </g>
          )}
        </g>
      )}

      {x12 !== null && (
        <g aria-hidden="true">
          <line x1={x12} x2={x12} y1={T - 12} y2={base} className="cmp-2012" />
          <text x={x12 + 6} y={T - 16} className="cmp-2012-label">2012: VIIRS joins</text>
          {x12 - L > 70 && (
            <>
              <text x={L} y={T - 16} className="cmp-side-label cmp-side-modis" opacity={1 - fade(k, 0, 0.45)}>MODIS years</text>
              <text x={L} y={T - 16} className="cmp-side-label cmp-side-fire" opacity={fade(k, 0.55, 1)}>MODIS, converted</text>
            </>
          )}
        </g>
      )}

      {labelled.map((y) => (
        <text key={y} x={bx(y) + bw / 2} y={H - 6} textAnchor="middle" className="cmp-tick">{y}</text>
      ))}
    </svg>
  );
}

/** 0 before a, 1 after b, a smooth step between. */
function fade(k: number, a: number, b: number): number {
  const x = Math.max(0, Math.min(1, (k - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** A bar's sensor colour on its way to the record's orange. Blue turns warm the long way round
 *  the hue circle (through violet and red, like a flame) instead of through a muddy green. */
function sensorFill(year: number, k: number): string {
  const p = (100 * k).toFixed(1);
  return year < 2012
    ? `color-mix(in oklch, var(--cmp-fire-a) ${p}%, var(--cmp-modis))`
    : `color-mix(in oklch longer hue, var(--cmp-fire-a) ${p}%, var(--cmp-viirs))`;
}

/** A vertical arrow at x from the level before (y from) to the level after (y to). */
function arrow(x: number, from: number, to: number): string {
  const dir = to < from ? 1 : -1, tip = to + dir * 2;
  return `M${x},${from} L${x},${tip} M${x - 5},${tip + dir * 7} L${x},${tip} L${x + 5},${tip + dir * 7}`;
}
