// Plain SVG charts that render on the server, so the numbers are in the HTML.

import { fmt } from "@/lib/format";

type SeriesProps = { years: number[]; raw: number[]; harmonized: number[]; mock: boolean };

/** Raw join vs harmonized annual totals, with the 2012 VIIRS switch marked. */
export function SeriesChart({ years, raw, harmonized, mock }: SeriesProps) {
  const W = 1000, H = 320, top = 16, bottom = 300;
  const max = Math.max(...raw, ...harmonized) * 1.08;
  const x = (i: number) => (i / (years.length - 1)) * W;
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const i2012 = years.indexOf(2012);
  const xs = i2012 >= 0 ? x(i2012) : W / 2;
  const ticks = years.filter((yr) => yr % 5 === 0 || yr === years[0]).filter((yr, i, a) => i === 0 || yr - a[i - 1] >= 3);
  return (
    <figure className="card chart">
      <div className="legend">
        <span><i style={{ width: 28, borderTop: "3px dashed #8C7B68" }} />Raw MODIS then VIIRS, glued together</span>
        <span><i style={{ width: 28, height: 3, background: "#C8501A" }} />Harmonized (our record)</span>
        {mock && <span className="mono tag">Mock data until Nov 13</span>}
      </div>
      <div style={{ position: "relative" }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" style={{ width: "100%", height: "auto", display: "block" }}
             aria-label={`Yearly hotspot totals ${years[0]}–${years.at(-1)}. Raw counts jump at 2012; the harmonized series stays continuous.`}>
          <line x1="0" y1={bottom} x2={W} y2={bottom} stroke="#D5DCE6" />
          <line x1="0" y1={(top + bottom) / 2} x2={W} y2={(top + bottom) / 2} stroke="#EDF1F6" />
          <rect x={xs} y={top} width={W - xs} height={bottom - top} fill="#FBF1E6" />
          <line x1={xs} y1={top} x2={xs} y2={bottom} stroke="#C9B49A" strokeWidth="1.5" strokeDasharray="4 4" />
          <path d={path(raw)} fill="none" stroke="#8C7B68" strokeWidth="3" strokeDasharray="8 6" data-len="" data-dash="8 6" />
          <path d={path(harmonized)} fill="none" stroke="#C8501A" strokeWidth="3.5" data-len="" />
        </svg>
        <div className="chart-note" style={{ left: `${(xs / W) * 100 + 1}%` }}>
          <strong>2012: VIIRS arrives.</strong> Raw counts leap; same fires, sharper eyes.
        </div>
      </div>
      <div className="axis" aria-hidden="true">
        {ticks.map((t) => <span key={t} style={{ left: `${(x(years.indexOf(t)) / W) * 100}%` }}>{t}</span>)}
      </div>
    </figure>
  );
}

type ScatterProps = { pairs: [number, number][]; k?: number };

/** MODIS vs VIIRS on the overlap years (log scale), one dot per 10° tile × month. */
export function ScatterChart({ pairs }: ScatterProps) {
  const S = 320, pad = 34;
  const max = Math.log10(1 + Math.max(...pairs.flat()));
  const p = (v: number) => pad + (Math.log10(1 + v) / max) * (S - 2 * pad);
  const ticks = [0, 10, 100, 1000, 10000].filter((t) => Math.log10(1 + t) <= max);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} role="img" className="scatter"
         aria-label={`${fmt(pairs.length)} tile-months from the overlap years: MODIS detections against VIIRS detections, log scale.`}>
      <rect x={pad} y={pad} width={S - 2 * pad} height={S - 2 * pad} fill="#F5F7FA" />
      {ticks.map((t) => (
        <g key={t} fontSize="9" fill="#5A6578" fontFamily="var(--mono)">
          <line x1={p(t)} y1={pad} x2={p(t)} y2={S - pad} stroke="#E1E6EE" />
          <line x1={pad} y1={S - p(t)} x2={S - pad} y2={S - p(t)} stroke="#E1E6EE" />
          <text x={p(t)} y={S - pad + 12} textAnchor="middle">{t >= 1000 ? `${t / 1000}k` : t}</text>
          <text x={pad - 4} y={S - p(t) + 3} textAnchor="end">{t >= 1000 ? `${t / 1000}k` : t}</text>
        </g>
      ))}
      {pairs.map(([m, v], i) => <circle key={i} cx={p(m)} cy={S - p(v)} r="1.6" fill="#C8501A" fillOpacity="0.35" />)}
      <text x={S / 2} y={S - 4} textAnchor="middle" fontSize="10" fill="#3E4A5E">MODIS Aqua detections</text>
      <text x={10} y={S / 2} textAnchor="middle" fontSize="10" fill="#3E4A5E" transform={`rotate(-90 10 ${S / 2})`}>VIIRS S-NPP detections</text>
    </svg>
  );
}
