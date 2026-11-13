"use client";

// The answer first (U4, redesigned in X12): one sentence on whether the selected month is
// unusual, a strip of the same month in every past year, then the numbers behind it.

import type { ApiError, Metric, Stats, View } from "@/lib/api";
import { MONTHS_LONG, fmt, parseYm } from "@/lib/format";
import { usualRange, verdict } from "@/lib/verdict";

type Props = { stats?: Stats; loading: boolean; error: ApiError | null; month: string | null; metric: Metric; view: View };

export default function Verdict({ stats, loading, error, month, metric, view }: Props) {
  if (!month) return <section className="verdict"><p className="verdict-detail">Pick a month in the calendar.</p></section>;
  if (error) return <section className="verdict"><p className="error" role="alert">{error.message}</p></section>;
  if (!stats) return <section className="verdict" aria-busy="true"><p className="verdict-detail">Comparing with past years…</p></section>;

  const v = verdict(stats, metric, view);
  const b = stats.baseline;
  const range = usualRange(stats);
  const monthName = MONTHS_LONG[parseYm(stats.month)[1] - 1];
  return (
    <section className={`verdict tone-${v.tone}`} aria-live="polite" aria-busy={loading} style={{ opacity: loading ? 0.6 : 1 }}>
      <div className="verdict-text">
        <h1 className="verdict-head">{v.headline}</h1>
        <p className="verdict-detail">{v.detail}</p>
        {stats.partial && (
          <p className="verdict-note">Month in progress: compared with days 1 to {stats.partial.days_observed} of past {monthName}s.</p>
        )}
      </div>
      <Strip stats={stats} range={range} monthName={monthName} />
      <dl className="facts">
        <div><dt>Typical {monthName}</dt><dd>{fmt(b.median, 0)}</dd></div>
        <div><dt>Usual range</dt><dd>{range ? `${fmt(range[0])} to ${fmt(range[1])}` : "–"}</dd></div>
        <div><dt>Rank</dt><dd>{stats.rank === null ? "–" : `${stats.rank} of ${b.n_years + 1}`}</dd></div>
        <div><dt>Percentile</dt><dd>{stats.percentile === null ? "–" : fmt(stats.percentile)}</dd></div>
        {stats.cloud_fraction != null && (
          <div>
            <dt>Cloud cover{stats.clouds?.source === "mock" ? " (simulated)" : ""}</dt>
            <dd>{Math.round(stats.cloud_fraction * 100)}%{stats.clouds?.mode === "correct" && <span className="muted"> · corrected</span>}</dd>
          </div>
        )}
        <div><dt>z score</dt><dd>{stats.z === null ? "–" : `${stats.z > 0 ? "+" : ""}${fmt(stats.z, 1)}`}</dd></div>
        <div>
          <dt>Trend in yearly totals</dt>
          <dd>{stats.trend?.sen_slope_per_year == null ? "–" : `${stats.trend.sen_slope_per_year > 0 ? "+" : ""}${fmt(stats.trend.sen_slope_per_year, 1)} a year`}
            {stats.trend?.p_value != null && <span className="muted"> (p {fmt(stats.trend.p_value, 2)})</span>}</dd>
        </div>
      </dl>
      {stats.meta.aoi?.coarse_warning && (
        <p className="warn">This area covers fewer than 4 grid cells (about 10 km each), so the numbers are coarse.</p>
      )}
    </section>
  );
}

/** Every past year's value for this month as a dot; the middle half shaded; this year marked. */
function Strip({ stats, range, monthName }: { stats: Stats; range: [number, number] | null; monthName: string }) {
  const W = 560, H = 74, pad = 10, mid = 34;
  const year = parseYm(stats.month)[0];
  const past = stats.baseline.values;
  const max = Math.max(1, stats.value, ...past.map((p) => p.value)) * 1.04;
  const x = (v: number) => pad + (v / max) * (W - 2 * pad);
  // Spread dots that would overlap, a little up and down.
  const placed: { cx: number; cy: number; year: number; value: number }[] = [];
  for (const p of [...past].sort((a, b) => a.value - b.value)) {
    const cx = x(p.value);
    let k = 0;
    while (k < 6 && placed.some((q) => Math.abs(q.cx - cx) < 9 && q.cy === mid + offset(k))) k++;
    placed.push({ cx, cy: mid + offset(k), year: p.year, value: p.value });
  }
  const label = `${monthName} in each past year, from ${fmt(Math.min(...past.map((p) => p.value)))} to ` +
    `${fmt(Math.max(...past.map((p) => p.value)))}; ${year} is ${fmt(stats.value)}.`;
  return (
    <figure className="strip">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={past.length ? label : `${year}: ${fmt(stats.value)}`}>
        {range && <rect x={x(range[0])} y={mid - 16} width={Math.max(2, x(range[1]) - x(range[0]))} height={32} rx="4" className="strip-band" />}
        <line x1={pad} x2={W - pad} y1={mid} y2={mid} className="strip-axis" />
        {placed.map((p) => (
          <circle key={p.year} cx={p.cx} cy={p.cy} r="4.5" className="strip-dot"><title>{`${p.year}: ${fmt(p.value)}`}</title></circle>
        ))}
        <circle cx={x(stats.value)} cy={mid} r="8" className="strip-now"><title>{`${year}: ${fmt(stats.value)}`}</title></circle>
        <text x={Math.min(W - pad, Math.max(pad, x(stats.value)))} y={H - 4} textAnchor={x(stats.value) > W - 40 ? "end" : x(stats.value) < 40 ? "start" : "middle"} className="strip-now-label">{year}</text>
        <text x={pad} y={H - 4} className="strip-tick">0</text>
      </svg>
      <figcaption>Each dot is {monthName} in a past year; the shaded band is the middle half of them.</figcaption>
    </figure>
  );
}

function offset(k: number): number {
  return k === 0 ? 0 : (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 9;
}
