// X34: the game's night-city scene, drawn in SVG to match the pixel-art characters: a starry
// sky with a crescent moon, a city skyline with lit windows, trees, lamp posts that glow, a
// bench and a hydrant on a brick pavement. Pure decoration (aria-hidden).

export function Sky() {
  // Stars at fixed positions (no randomness, so the server and the client agree).
  const stars = Array.from({ length: 70 }, (_, i) => {
    const x = (i * 137.508) % 1000, y = ((i * 97.31) % 520) + 8, r = i % 7 === 0 ? 1.8 : i % 3 === 0 ? 1.3 : 0.9;
    return <rect key={i} x={x} y={y} width={r * 2} height={r * 2} fill="#FFFFFF" opacity={0.35 + ((i * 31) % 60) / 100} className={i % 4 === 0 ? "sc-twinkle" : undefined} />;
  });
  return (
    <svg className="scene-sky" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="sc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B1030" /><stop offset=".55" stopColor="#1A1C4E" /><stop offset="1" stopColor="#3B2A5E" /></linearGradient>
        <radialGradient id="sc-moon"><stop offset="0" stopColor="#FFF6D0" stopOpacity=".55" /><stop offset="1" stopColor="#FFF6D0" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1000" height="600" fill="url(#sc-sky)" />
      {stars}
      <circle cx="120" cy="90" r="70" fill="url(#sc-moon)" />
      <path d="M118 48 a40 40 0 1 0 0 84 a32 32 0 1 1 0 -84 Z" fill="#FFF3C4" />
      {/* soft clouds */}
      <g fill="#2B2D6A" opacity=".8">
        <path d="M640 120 h110 a16 16 0 0 0 0 -32 a28 28 0 0 0 -52 -12 a24 24 0 0 0 -42 14 a15 15 0 0 0 -16 30 Z" />
        <path d="M250 190 h90 a13 13 0 0 0 0 -26 a22 22 0 0 0 -42 -10 a20 20 0 0 0 -34 12 a12 12 0 0 0 -14 24 Z" />
        <path d="M820 230 h120 a16 16 0 0 0 0 -32 a28 28 0 0 0 -54 -12 a24 24 0 0 0 -42 16 a14 14 0 0 0 -24 28 Z" />
      </g>
    </svg>
  );
}

function Windows({ x, y, w, h, cols, rows, seed }: { x: number; y: number; w: number; h: number; cols: number; rows: number; seed: number }) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lit = ((r * 7 + c * 13 + seed) % 5) < 2;
    out.push(<rect key={`${r}-${c}`} x={x + 6 + c * ((w - 12) / cols)} y={y + 8 + r * ((h - 12) / rows)} width={Math.max(3, (w - 12) / cols - 4)} height={Math.max(3, (h - 12) / rows - 5)} fill={lit ? "#FFD27A" : "#0E1024"} opacity={lit ? 0.9 : 0.6} />);
  }
  return <>{out}</>;
}

function Lamp({ x, h = 150 }: { x: number; h?: number }) {
  return (
    <g className="sc-lamp">
      <circle cx={x} cy={-h + 12} r="46" fill="url(#sc-glow)" className="sc-lamp-glow" />
      <rect x={x - 3} y={-h + 24} width="6" height={h - 24} fill="#2A2A3C" />
      <rect x={x - 9} y="-10" width="18" height="10" fill="#2A2A3C" />
      <rect x={x - 11} y={-h + 2} width="22" height="22" rx="2" fill="#3A3A50" />
      <rect x={x - 7} y={-h + 6} width="14" height="14" fill="#FFE39A" />
      <rect x={x - 13} y={-h - 2} width="26" height="5" fill="#2A2A3C" />
    </g>
  );
}

function Tree({ x, s = 1 }: { x: number; s?: number }) {
  return (
    <g transform={`translate(${x} 0) scale(${s})`}>
      <rect x="-7" y="-46" width="14" height="46" fill="#4A2E1C" />
      <circle cx="0" cy="-76" r="38" fill="#1F6B3A" />
      <circle cx="-24" cy="-58" r="26" fill="#1A5A30" />
      <circle cx="24" cy="-60" r="26" fill="#246E3C" />
      <circle cx="-8" cy="-96" r="22" fill="#2A7A42" />
    </g>
  );
}

/** The ground band: skyline behind, trees, lamps, a bench and a hydrant, on a brick pavement.
 *  Placed so y = 0 is the pavement's top edge; the characters stand on it. */
export function Street() {
  return (
    <svg className="scene-street" viewBox="0 -400 1400 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="sc-glow"><stop offset="0" stopColor="#FFC65C" stopOpacity=".45" /><stop offset="1" stopColor="#FFC65C" stopOpacity="0" /></radialGradient>
        <pattern id="sc-brick" width="36" height="18" patternUnits="userSpaceOnUse">
          <rect width="36" height="18" fill="#6B4A3A" />
          <rect x="1" y="1" width="16" height="7" fill="#8A5F49" /><rect x="19" y="1" width="16" height="7" fill="#7E5642" />
          <rect x="-8" y="10" width="16" height="7" fill="#80583F" /><rect x="10" y="10" width="16" height="7" fill="#8A5F49" /><rect x="28" y="10" width="16" height="7" fill="#7E5642" />
        </pattern>
      </defs>
      {/* skyline */}
      <g>
        <rect x="0" y="-400" width="1400" height="400" fill="#141638" opacity=".0" />
        {[[40, -250, 90, 250, 3, 9, 1], [150, -210, 70, 210, 2, 8, 2], [250, -300, 110, 300, 4, 11, 3], [380, -190, 60, 190, 2, 7, 4], [470, -260, 95, 260, 3, 10, 5],
          [600, -170, 80, 170, 3, 6, 6], [700, -230, 70, 230, 2, 9, 7], [800, -290, 120, 290, 4, 11, 8], [950, -200, 85, 200, 3, 8, 9], [1060, -250, 65, 250, 2, 10, 10],
          [1150, -180, 100, 180, 3, 7, 11], [1270, -270, 90, 270, 3, 10, 12]].map(([x, y, w, h, c, r, sd]) => (
          <g key={x}><rect x={x} y={y} width={w} height={h} fill="#1C1E48" /><Windows x={x} y={y} w={w} h={h} cols={c} rows={r} seed={sd} /></g>
        ))}
        {/* a minaret and a dome, for Cairo */}
        <rect x="560" y="-330" width="14" height="330" fill="#1C1E48" /><path d="M556 -330 l11 -26 l11 26 Z" fill="#1C1E48" />
        <path d="M1030 -200 a40 40 0 0 1 80 0 Z" fill="#1C1E48" />
      </g>
      {/* trees and lamps at the back */}
      <Tree x={95} s={0.9} /><Tree x={1290} s={0.95} /><Tree x={1360} s={0.7} />
      <Lamp x={190} /><Lamp x={700} h={140} /><Lamp x={1020} h={140} /><Lamp x={1230} />
      {/* bench */}
      <g transform="translate(470 0)">
        <rect x="0" y="-34" width="110" height="8" fill="#8B5A2B" /><rect x="0" y="-22" width="110" height="7" fill="#8B5A2B" />
        <rect x="6" y="-14" width="7" height="14" fill="#3A3A50" /><rect x="97" y="-14" width="7" height="14" fill="#3A3A50" />
        <rect x="6" y="-46" width="7" height="34" fill="#3A3A50" /><rect x="97" y="-46" width="7" height="34" fill="#3A3A50" />
      </g>
      {/* hydrant */}
      <g transform="translate(330 0)">
        <rect x="-8" y="-40" width="16" height="40" rx="3" fill="#D63B2F" /><rect x="-11" y="-44" width="22" height="8" rx="2" fill="#B82E24" />
        <rect x="-14" y="-28" width="28" height="7" rx="2" fill="#D63B2F" /><rect x="-4" y="-50" width="8" height="7" rx="2" fill="#B82E24" />
      </g>
      {/* grass edge and the pavement */}
      <rect x="0" y="-8" width="1400" height="8" fill="#3F7A32" />
      <rect x="0" y="0" width="1400" height="20" fill="url(#sc-brick)" />
      <rect x="0" y="0" width="1400" height="3" fill="#A87A5E" />
    </svg>
  );
}
