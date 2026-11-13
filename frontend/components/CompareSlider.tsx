"use client";

// X33: drag a line across one calendar. Left of it, the raw join (MODIS, then VIIRS from 2012);
// right of it, our harmonized record. Same colours for the same numbers on both sides, so the
// sensor jump at 2012 lights up on the raw side and is gone on ours. Keyboard: arrow keys move
// the line (role="slider"); it sweeps once on its own the first time it comes into view.

import { useEffect, useMemo, useRef, useState } from "react";
import { compare, type Grid } from "@/lib/compare";
import { MONTHS, cellColor, fmt } from "@/lib/format";

type Props = { harmonized: Grid; modis: Grid; viirs: Grid; place: string; tone?: "dark" | "light"; unit?: string };

export default function CompareSlider({ harmonized, modis, viirs, place, tone = "dark", unit = "hotspots" }: Props) {
  const c = useMemo(() => compare(harmonized, modis, viirs), [harmonized, modis, viirs]);
  const [x, setX] = useState(50);
  const area = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const touched = useRef(false);

  // A one-time sweep when it first scrolls into view, so it's clear the line moves.
  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || touched.current) return;
      io.disconnect();
      const t0 = performance.now(), keys = [50, 84, 18, 50], seg = 700;
      const step = (t: number) => {
        if (touched.current) return;
        const k = Math.min(keys.length - 1.0001, (t - t0) / seg);
        const i = Math.floor(k), f = k - i, ease = f * f * (3 - 2 * f);
        setX(keys[i] + (keys[i + 1] - keys[i]) * ease);
        if (k < keys.length - 1.0001) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  function moveTo(clientX: number) {
    const r = area.current!.getBoundingClientRect();
    touched.current = true;
    setX(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  }

  const rows = c.years.map((y, i) => ({ y, i })).reverse(); // newest on top, like the calendar
  const split = rows.findIndex(({ y }) => y < 2012);          // first row before 2012
  const layer = (m: (number | null)[][]) => (
    <div className="cmp-grid" aria-hidden="true">
      {rows.map(({ y, i }) => (
        <div className="cmp-row" key={y}>
          {m[i].map((v, j) => <i key={j} className={v === null ? "na" : undefined} style={v === null ? undefined : { background: cellColor(v, c.max) ?? undefined }} />)}
        </div>
      ))}
    </div>
  );

  return (
    <figure ref={root} className={`cmp cmp-${tone}`}>
      <div className="cmp-head">
        <span className="cmp-side cmp-raw-label"><b>Raw join</b> MODIS, then VIIRS from 2012
          {c.rawJump !== null && <em>{fmt(c.rawJump, 1)}× after 2012</em>}</span>
        <span className="cmp-side cmp-harm-label"><b>Harmonized</b> our record
          {c.harmJump !== null && <em>{fmt(c.harmJump, 2)}×</em>}</span>
      </div>
      <div className="cmp-body">
        <div className="cmp-years" aria-hidden="true">
          {rows.map(({ y }) => <span key={y}>{y % 5 === 0 || y === rows[0].y ? y : ""}</span>)}
        </div>
        <div className="cmp-area" ref={area}
             onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); moveTo(e.clientX); }}
             onPointerMove={(e) => { if (e.buttons) moveTo(e.clientX); }}>
          <div className="cmp-months" aria-hidden="true">{MONTHS.map((m) => <span key={m}>{m[0]}</span>)}</div>
          <div className="cmp-layers">
            {layer(c.harmonized)}
            <div className="cmp-top" style={{ clipPath: `inset(0 ${100 - x}% 0 0)` }}>{layer(c.raw)}</div>
            {split > 0 && <div className="cmp-2012" style={{ top: `${(split / rows.length) * 100}%` }}><span>2012: VIIRS joins</span></div>}
            <div className="cmp-line" style={{ left: `${x}%` }}>
              <button type="button" className="cmp-handle" role="slider" aria-label="Raw join on the left, harmonized on the right"
                      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(x)} aria-valuetext={`${Math.round(x)}% raw`}
                      onKeyDown={(e) => {
                        const d = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, Home: -100, End: 100 }[e.key];
                        if (d === undefined) return;
                        e.preventDefault(); touched.current = true;
                        setX((v) => Math.max(0, Math.min(100, v + d)));
                      }}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" /></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      <figcaption>
        {place}, {unit} per month since {c.years[0]}. Drag the line: on the raw side the years after 2012 light up because
        VIIRS sees more, not because more burned. On our side the same months keep their meaning.
      </figcaption>
    </figure>
  );
}
