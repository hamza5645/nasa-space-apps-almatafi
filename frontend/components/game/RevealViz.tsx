// The small charts that come with a question (the past years) and with its answer. SVG only.

import type { Reveal } from "@/lib/game";
import { MONTHS, fmt } from "@/lib/format";

export default function RevealViz({ r, answered }: { r: Reveal; answered: boolean }) {
  if (r.type === "strip") return <Strip r={r} answered={answered} />;
  if (r.type === "bars") return <Bars r={r} />;
  if (r.type === "months") return <Months r={r} />;
  if (r.type === "trap") return <Trap r={r} />;
  return (
    <div className="viz-fact"><strong>{r.big}</strong><span>{r.small}</span></div>
  );
}

function Strip({ r, answered }: { r: Extract<Reveal, { type: "strip" }>; answered: boolean }) {
  const W = 560, H = 86, pad = 14, mid = 38;
  const show = answered && Number.isFinite(r.value);
  const max = Math.max(1, ...r.past.map((p) => p.value), Number.isFinite(r.value) ? r.value : 0) * 1.05;
  const x = (v: number) => pad + (v / max) * (W - 2 * pad);
  const placed: { cx: number; cy: number; year: number; value: number }[] = [];
  for (const p of [...r.past].sort((a, b) => a.value - b.value)) {
    const cx = x(p.value);
    let k = 0;
    while (k < 6 && placed.some((q) => Math.abs(q.cx - cx) < 10 && q.cy === mid + off(k))) k++;
    placed.push({ cx, cy: mid + off(k), year: p.year, value: p.value });
  }
  return (
    <svg className="viz viz-strip" viewBox={`0 0 ${W} ${H}`} role="img"
         aria-label={`${r.monthName} in ${r.past.length} other years, from ${fmt(Math.min(...r.past.map((p) => p.value)))} to ${fmt(Math.max(...r.past.map((p) => p.value)))}${show ? `; ${r.year}: ${fmt(r.value)}` : ""}.`}>
      {r.range && <rect x={x(r.range[0])} y={mid - 18} width={Math.max(3, x(r.range[1]) - x(r.range[0]))} height={36} rx="6" className="v-band" />}
      <line x1={pad} x2={W - pad} y1={mid} y2={mid} className="v-axis" />
      {placed.map((p) => <circle key={p.year} cx={p.cx} cy={p.cy} r="5" className="v-dot"><title>{`${p.year}: ${fmt(p.value)}`}</title></circle>)}
      {show && (
        <g className="v-now-g">
          <circle cx={x(r.value)} cy={mid} r="10" className="v-now" />
          <text x={Math.min(W - pad, Math.max(pad, x(r.value)))} y={H - 6} textAnchor={x(r.value) > W - 60 ? "end" : x(r.value) < 60 ? "start" : "middle"} className="v-now-label">
            {r.year}: {fmt(r.value)}
          </text>
        </g>
      )}
      <text x={pad} y={H - 6} className="v-tick">0</text>
    </svg>
  );
}

function off(k: number) { return k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 10; }

function Bars({ r }: { r: Extract<Reveal, { type: "bars" }> }) {
  const max = Math.max(1, ...r.groups.flatMap((g) => g.bars.map((b) => b.value)));
  return (
    <div className="viz viz-bars">
      {r.groups.map((g) => (
        <div key={g.label} className="vb-group">
          <span className="vb-title">{g.label}</span>
          {g.bars.map((b) => (
            <div key={b.label} className="vb-row">
              <span className="vb-label">{b.label}</span>
              <span className="vb-track"><i className={`vb-bar ${b.tone}`} style={{ width: `${(b.value / max) * 100}%` }} /></span>
              <span className="vb-val">{fmt(Math.round(b.value))}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Months({ r }: { r: Extract<Reveal, { type: "months" }> }) {
  const max = Math.max(1, ...r.values.map((v) => v ?? 0));
  return (
    <div className="viz viz-months" role="img" aria-label={`Typical month: highest in ${MONTHS[r.peak]}.`}>
      {r.values.map((v, j) => (
        <div key={j} className={`vm-col${j === r.peak ? " peak" : ""}`}>
          <i style={{ height: `${((v ?? 0) / max) * 100}%` }} />
          <span>{MONTHS[j][0]}</span>
        </div>
      ))}
    </div>
  );
}

function Trap({ r }: { r: Extract<Reveal, { type: "trap" }> }) {
  const max = Math.max(1, ...r.raw, ...r.ours);
  const pair = (label: string, [a, b]: [number, number], tone: string) => (
    <div className="vt-pair">
      <span className="vb-title">{label}</span>
      <div className="vt-cols">
        {[["before 2012", a], ["after", b]].map(([t, v]) => (
          <div key={t as string} className="vt-col"><i className={tone} style={{ height: `${((v as number) / max) * 100}%` }} /><span>{t}</span></div>
        ))}
      </div>
      <span className="vt-ratio">{fmt(b / Math.max(a, 1e-9), 2)}×</span>
    </div>
  );
  return <div className="viz viz-trap">{pair("Raw join", r.raw, "raw")}{pair("Our record", r.ours, "ours")}</div>;
}
