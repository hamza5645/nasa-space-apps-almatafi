// Small explanatory drawings for the Method page's "three differences" (server-rendered SVG).
// Schematic, not data: they show the idea, the numbers live in the text and charts.

export function PixelArt() {
  // A fire inside one 1 km MODIS pixel, and the same ground as 375 m VIIRS pixels.
  const v = 240 / 8; // 8 VIIRS pixels across the drawing, ~3 km
  const hot = new Set(["3,3", "4,3", "3,4", "4,4", "5,4", "4,5"]);
  return (
    <svg className="art" viewBox="0 0 520 260" role="img" aria-label="One fire covers part of one 1 km MODIS pixel but several 375 m VIIRS pixels.">
      <defs>
        <radialGradient id="fireg" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#FFD27A" /><stop offset=".45" stopColor="#F08A24" /><stop offset="1" stopColor="#F08A24" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(10,10)">
        <rect width="240" height="240" rx="10" fill="#F4EEE5" />
        <ellipse cx="138" cy="138" rx="44" ry="36" fill="url(#fireg)" />
        <rect x="40" y="40" width="160" height="160" fill="none" stroke="#2E9AB0" strokeWidth="2.5" />
        <rect x="40" y="40" width="160" height="160" fill="rgba(240,138,36,.14)" />
        <text x="120" y="232" textAnchor="middle" className="art-l">MODIS · one 1 km pixel</text>
      </g>
      <g transform="translate(270,10)">
        <rect width="240" height="240" rx="10" fill="#F4EEE5" />
        <ellipse cx="138" cy="138" rx="44" ry="36" fill="url(#fireg)" />
        {Array.from({ length: 64 }, (_, i) => {
          const x = i % 8, y = Math.floor(i / 8);
          return <rect key={i} x={x * v} y={y * v} width={v} height={v} fill={hot.has(`${x},${y}`) ? "rgba(240,138,36,.22)" : "none"}
                       stroke={hot.has(`${x},${y}`) ? "#2E9AB0" : "#DDD3C5"} strokeWidth={hot.has(`${x},${y}`) ? 2 : 1} />;
        })}
        <text x="120" y="232" textAnchor="middle" className="art-l">VIIRS · six 375 m pixels</text>
      </g>
    </svg>
  );
}

export function FloorArt() {
  // Fires by power (log scale): MODIS only flags those above its detection floor.
  const bars = [4, 9, 16, 22, 26, 25, 21, 16, 11, 7, 4, 2, 1];
  const floor = 4.5;
  return (
    <svg className="art" viewBox="0 0 520 260" role="img" aria-label="Most fires are small. VIIRS sees fires of all sizes; MODIS only sees fires above its detection floor.">
      <g transform="translate(30,20)">
        {bars.map((b, i) => {
          const x = i * 36, h = b * 7;
          const seen = i >= floor;
          return <rect key={i} x={x} y={200 - h} width="28" height={h} rx="4" fill={seen ? "#F08A24" : "#F7C99A"} />;
        })}
        <line x1={floor * 36 - 4} x2={floor * 36 - 4} y1="10" y2="206" stroke="#2E9AB0" strokeWidth="2.5" strokeDasharray="6 5" />
        <text x={floor * 36 + 4} y="22" className="art-l art-blue">MODIS detection floor</text>
        <text x="0" y="230" className="art-l">small fires (low FRP)</text>
        <text x="460" y="230" textAnchor="end" className="art-l">large fires →</text>
        <text x="40" y="64" className="art-s">VIIRS only</text>
        <text x="300" y="64" className="art-s">both</text>
      </g>
    </svg>
  );
}

export function ClockArt() {
  // Fire activity over a day peaks in the afternoon; the passes sample it at different hours.
  const W = 460, top = 30, base = 190;
  const x = (h: number) => 30 + (h / 24) * W;
  const act = (h: number) => 0.08 + 0.92 * Math.exp(-Math.pow((h - 14.5) / 3.2, 2));
  const path = Array.from({ length: 97 }, (_, i) => i / 4).map((h, i) => `${i ? "L" : "M"}${x(h).toFixed(1)},${(base - act(h) * (base - top)).toFixed(1)}`).join("");
  const passes: [number, string][] = [[1.5, "VIIRS, Aqua"], [10.5, "Terra"], [13.5, "Aqua, VIIRS"], [22.5, "Terra"]];
  return (
    <svg className="art" viewBox="0 0 520 260" role="img" aria-label="Fires peak in the afternoon. Terra passes at 10:30 and 22:30, Aqua and VIIRS at 13:30 and 01:30.">
      <path d={`${path}L${x(24)},${base}L${x(0)},${base}Z`} fill="rgba(240,138,36,.14)" />
      <path d={path} fill="none" stroke="#E8701E" strokeWidth="3" />
      <line x1={x(0)} x2={x(24)} y1={base} y2={base} stroke="#D9D0C3" />
      {[0, 6, 12, 18, 24].map((h) => <text key={h} x={x(h)} y={base + 18} textAnchor="middle" className="art-s">{String(h).padStart(2, "0")}:00</text>)}
      {passes.map(([h, who]) => (
        <g key={h}>
          <line x1={x(h)} x2={x(h)} y1={top - 6} y2={base} stroke="#2E9AB0" strokeWidth="2" strokeDasharray="4 4" />
          <circle cx={x(h)} cy={base - act(h) * (base - top)} r="5.5" fill="#fff" stroke="#2E9AB0" strokeWidth="2.5" />
          <text x={x(h) + (h === 10.5 ? -6 : h === 13.5 ? 6 : 0)} y={top - 12} textAnchor={h === 10.5 ? "end" : h === 13.5 ? "start" : "middle"}
                className="art-s art-blue">{who}</text>
        </g>
      ))}
      <text x={x(12)} y={base + 44} textAnchor="middle" className="art-l">time of day (local solar)</text>
    </svg>
  );
}
