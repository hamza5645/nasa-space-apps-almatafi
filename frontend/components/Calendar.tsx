"use client";

// Burning activity calendar (U3): years × months, one button per month, so it works with a
// keyboard (arrow keys move, Enter selects) and screen readers (each cell says what it is).

import { useMemo, useRef } from "react";
import type { Calendar as CalendarData } from "@/lib/api";
import { MONTHS, MONTHS_LONG, ORIGIN, RAMP, ZERO, cellColor, fmt, inkOn, short, ym } from "@/lib/format";

type Props = {
  data: CalendarData;
  selected: string | null;
  onSelect: (month: string) => void;
};

export default function Calendar({ data, selected, onSelect }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const max = data.max ?? 0;
  const maxTotal = useMemo(() => Math.max(0, ...data.year_totals.map((t) => t ?? 0)), [data.year_totals]);
  const partial = data.partial_month?.month;
  // Newest year on top: that's where people look first.
  const rows = data.years.map((y, i) => ({ year: y, i })).reverse();

  function move(e: React.KeyboardEvent<HTMLButtonElement>, r: number, c: number) {
    const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (!d) return;
    e.preventDefault();
    // Step over "not observed" months (they aren't buttons) until a month or the edge of the grid.
    for (let i = 1; i <= Math.max(rows.length, 12); i++) {
      const [rr, cc] = [r + d[0] * i, c + d[1] * i];
      if (rr < 0 || rr >= rows.length || cc < 0 || cc > 11) return;
      const next = grid.current?.querySelector<HTMLButtonElement>(`[data-r="${rr}"][data-c="${cc}"]`);
      if (next) return next.focus();
    }
  }

  return (
    <div className="cal-scroll">
      <div className="cal-grid" ref={grid} role="grid" aria-label={`Burning calendar, ${data.unit}`}>
        <div role="row" className="cal-row">
          <span role="columnheader" className="cal-lab" />
          {MONTHS.map((m) => <span key={m} role="columnheader" className="cal-mh">{m}</span>)}
          <span role="columnheader" className="cal-mh cal-tot-h">Year total</span>
        </div>
        {rows.map(({ year, i }, r) => (
          <div role="row" className="cal-row" key={year}>
            <span role="rowheader" className="cal-lab">{year}</span>
            {data.matrix[i].map((v, c) => {
              const month = ym(year, c + 1);
              if (v === null) {
                return <span role="gridcell" key={c} className="cal-cell none" aria-label={`${MONTHS_LONG[c]} ${year}: not observed`}>–</span>;
              }
              const origin = data.origin?.[i]?.[c];
              const isPartial = month === partial;
              const label = `${MONTHS_LONG[c]} ${year}: ${fmt(v)}${isPartial ? " so far" : ""}` +
                (origin ? `, ${ORIGIN[origin] ?? origin}` : "");
              return (
                <button
                  key={c}
                  role="gridcell"
                  type="button"
                  className={`cal-cell${month === selected ? " sel" : ""}${isPartial ? " partial" : ""}${max && v >= max * 0.6 ? " hot" : ""}`}
                  style={{ background: cellColor(v, max) ?? undefined, color: inkOn(v, max) }}
                  aria-label={label}
                  aria-selected={month === selected}
                  title={label}
                  data-r={r}
                  data-c={c}
                  tabIndex={month === selected || (selected === null && r === 0 && c === 0) ? 0 : -1}
                  onClick={() => onSelect(month)}
                  onKeyDown={(e) => move(e, r, c)}
                >
                  {short(v)}{isPartial ? "*" : ""}
                </button>
              );
            })}
            <span role="gridcell" className="cal-tot" aria-label={`${year} total: ${fmt(data.year_totals[i])}`}>
              <span className="cal-tot-bar" style={{ width: `${maxTotal ? ((data.year_totals[i] ?? 0) / maxTotal) * 70 : 0}%` }} />
              <span>{data.year_totals[i] === null ? "–" : short(data.year_totals[i]!)}</span>
            </span>
          </div>
        ))}
        <div role="row" className="cal-row cal-medians">
          <span role="rowheader" className="cal-lab">Median</span>
          {data.month_medians.map((v, c) => (
            <span role="gridcell" key={c} className="cal-med" aria-label={`${MONTHS_LONG[c]} median: ${fmt(v)}`}>
              {v === null ? "–" : short(v)}
            </span>
          ))}
          <span />
        </div>
      </div>
      <div className="cal-ramp" aria-hidden="true">
        <span>Fewer</span>
        <i style={{ background: ZERO }} />
        {RAMP.map((c) => <i key={c} style={{ background: c }} />)}
        <span>More</span>
        <span className="cal-none-key">– not observed</span>
        {partial && <span>* month in progress</span>}
      </div>
    </div>
  );
}
