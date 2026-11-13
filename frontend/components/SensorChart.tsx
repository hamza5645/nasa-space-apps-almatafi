"use client";

// Yearly totals for the chosen area: raw MODIS, raw VIIRS and the harmonized record, so the
// 2012 jump (and its removal) is visible for this place, not only globally.

import type { Calendar } from "@/lib/api";
import { fmt, short } from "@/lib/format";

type Props = { harmonized?: Calendar; modis?: Calendar; viirs?: Calendar };
type Line = { key: string; label: string; cls: string; data?: Calendar };

/** Year totals with incomplete years (a month not observed or in progress) left out. */
export function fullYears(c?: Calendar): Map<number, number> {
  const out = new Map<number, number>();
  if (!c) return out;
  const partial = c.partial_month?.month.slice(0, 4);
  c.years.forEach((y, i) => {
    const t = c.year_totals[i];
    if (t === null || String(y) === partial || c.matrix[i].some((v) => v === null)) return;
    out.set(y, t);
  });
  return out;
}

export default function SensorChart({ harmonized, modis, viirs }: Props) {
  // Harmonized first, so raw VIIRS draws on top: after 2012 the two are the same S-NPP counts.
  const lines: Line[] = [
    { key: "harmonized", label: "Harmonized record", cls: "ln-harm", data: harmonized },
    { key: "modis", label: "Raw MODIS", cls: "ln-modis", data: modis },
    { key: "viirs", label: "Raw VIIRS S-NPP (same as harmonized from 2012)", cls: "ln-viirs", data: viirs },
  ];
  const series = lines.map((l) => ({ ...l, pts: fullYears(l.data) }));
  const years = [...new Set(series.flatMap((s) => [...s.pts.keys()]))].sort((a, b) => a - b);
  if (years.length < 2) return <div className="chart-empty">Loading the yearly totals…</div>;

  const W = 900, H = 260, L = 44, R = 12, T = 12, B = 28;
  const max = Math.max(1, ...series.flatMap((s) => [...s.pts.values()])) * 1.08;
  const x = (y: number) => L + ((y - years[0]) / (years.at(-1)! - years[0])) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const path = (pts: Map<number, number>) => {
    let d = "", prev: number | null = null;
    for (const yr of years) {
      const v = pts.get(yr);
      if (v === undefined) { prev = null; continue; }
      d += `${prev === yr - 1 ? "L" : "M"}${x(yr).toFixed(1)},${y(v).toFixed(1)}`;
      prev = yr;
    }
    return d;
  };
  const ticks = niceTicks(max);
  const x2012 = years.includes(2012) ? x(2012) - (x(2012) - x(2011)) / 2 : null;
  const unit = harmonized?.metric === "fire_days" ? "fire days" : "hotspots";
  return (
    <figure className="sensor-chart">
      <ul className="chart-legend">
        {series.map((s) => <li key={s.key}><i className={s.cls} />{s.label}</li>)}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label={`Yearly ${unit} for this area, ${years[0]} to ${years.at(-1)}: raw MODIS, raw VIIRS and the harmonized record.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid-line" />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="tick">{short(t)}</text>
          </g>
        ))}
        {x2012 !== null && (
          <g>
            <line x1={x2012} x2={x2012} y1={T} y2={H - B} className="mark-2012" />
            <text x={x2012 + 6} y={T + 12} className="tick">VIIRS starts</text>
          </g>
        )}
        {years.filter((yr) => yr % 5 === 0 || yr === years[0] || yr === years.at(-1)).map((yr) => (
          <text key={yr} x={x(yr)} y={H - 8} textAnchor="middle" className="tick">{yr}</text>
        ))}
        {series.map((s) => <path key={s.key} d={path(s.pts)} className={`ln ${s.cls}`} />)}
        {series.map((s) => [...s.pts].map(([yr, v]) => (
          <circle key={`${s.key}${yr}`} cx={x(yr)} cy={y(v)} r="3" className={`pt ${s.cls}`}><title>{`${s.label}, ${yr}: ${fmt(v)}`}</title></circle>
        )))}
      </svg>
    </figure>
  );
}

function niceTicks(max: number): number[] {
  const step = 10 ** Math.floor(Math.log10(max / 4));
  const k = [1, 2, 5, 10].find((m) => max / (m * step) <= 5) ?? 10;
  const out = [];
  for (let t = 0; t <= max; t += k * step) out.push(t);
  return out;
}
