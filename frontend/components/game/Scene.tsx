// X34/X36: the game's night-street scene, after Khalid's mockup: a deep starry sky with a
// crescent moon, a low old-city skyline far away (minarets and domes), leafy trees and ornate
// lamp posts glowing warm, a bench and a hydrant, a tiled pavement. Drawn in SVG to match the
// pixel-art characters; when the Higgsfield street plate exists (design/higgsfield:
// game_street), `Backdrop` shows it instead. Pure decoration (aria-hidden).

/** The generated street plate, cover-fitted and anchored to the bottom so its sidewalk is the
 *  stage's ground (Stage.tsx, PLATE_GROUND). Phones get the 9:16 plate when it exists. */
export function Backdrop({ tall }: { tall: boolean }) {
  return (
    <picture className="scene-plate">
      {tall && <source media="(max-width: 760px) and (orientation: portrait)" srcSet="/media/game-street-tall.webp" />}
      <img src="/media/game-street.webp" alt="" decoding="async" />
    </picture>
  );
}

export function Sky() {
  // Stars at fixed positions (no randomness, so the server and the client agree).
  const stars = Array.from({ length: 90 }, (_, i) => {
    const x = (i * 137.508) % 1000, y = ((i * 97.31) % 520) + 8, r = i % 7 === 0 ? 1.8 : i % 3 === 0 ? 1.3 : 0.9;
    return <rect key={i} x={x} y={y} width={r * 2} height={r * 2} fill="#FFFFFF" opacity={0.35 + ((i * 31) % 60) / 100} className={i % 4 === 0 ? "sc-twinkle" : undefined} />;
  });
  return (
    <svg className="scene-sky" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="sc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#141A52" /><stop offset=".6" stopColor="#1F2468" /><stop offset="1" stopColor="#3C2F72" /></linearGradient>
        <radialGradient id="sc-moon"><stop offset="0" stopColor="#FFF6D0" stopOpacity=".5" /><stop offset="1" stopColor="#FFF6D0" stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1000" height="600" fill="url(#sc-sky)" />
      {stars}
      <circle cx="120" cy="90" r="80" fill="url(#sc-moon)" />
      <path d="M126 44 a46 46 0 1 0 0 92 a36 36 0 1 1 0 -92 Z" fill="#FFF3C4" />
      {/* soft clouds, far and few */}
      <g fill="#2B2D6A" opacity=".85">
        <path d="M640 120 h110 a16 16 0 0 0 0 -32 a28 28 0 0 0 -52 -12 a24 24 0 0 0 -42 14 a15 15 0 0 0 -16 30 Z" />
        <path d="M250 200 h90 a13 13 0 0 0 0 -26 a22 22 0 0 0 -42 -10 a20 20 0 0 0 -34 12 a12 12 0 0 0 -14 24 Z" />
        <path d="M840 250 h120 a16 16 0 0 0 0 -32 a28 28 0 0 0 -54 -12 a24 24 0 0 0 -42 16 a14 14 0 0 0 -24 28 Z" />
        <path d="M40 330 h100 a14 14 0 0 0 0 -28 a24 24 0 0 0 -46 -10 a20 20 0 0 0 -36 14 a12 12 0 0 0 -18 24 Z" />
      </g>
    </svg>
  );
}

function Lamp({ x, h = 170 }: { x: number; h?: number }) {
  return (
    <g className="sc-lamp">
      <circle cx={x} cy={-h + 14} r="78" fill="url(#sc-glow)" className="sc-lamp-glow" />
      <rect x={x - 4} y={-h + 30} width="8" height={h - 30} fill="#1E1E2E" />
      <rect x={x - 14} y="-12" width="28" height="12" fill="#1E1E2E" /><rect x={x - 10} y="-22" width="20" height="10" fill="#2A2A3C" />
      <path d={`M${x - 14} ${-h + 4} h28 l-4 28 h-20 Z`} fill="#2A2A3C" />
      <path d={`M${x - 10} ${-h + 8} h20 l-3 20 h-14 Z`} fill="#FFD36A" />
      <rect x={x - 16} y={-h - 2} width="32" height="6" fill="#1E1E2E" /><rect x={x - 4} y={-h - 10} width="8" height="8" fill="#1E1E2E" />
    </g>
  );
}

function Tree({ x, s = 1 }: { x: number; s?: number }) {
  return (
    <g transform={`translate(${x} 0) scale(${s})`}>
      <rect x="-8" y="-54" width="16" height="54" fill="#4A2E1C" />
      <circle cx="0" cy="-92" r="44" fill="#2A7A42" />
      <circle cx="-30" cy="-68" r="30" fill="#1F6B3A" />
      <circle cx="30" cy="-70" r="30" fill="#2E8448" />
      <circle cx="-8" cy="-116" r="26" fill="#3A9452" />
      <circle cx="14" cy="-100" r="18" fill="#4AA85E" opacity=".8" />
    </g>
  );
}

/** The ground band: a low old-city skyline far behind, trees, lamps, a bench and a hydrant.
 *  y = 0 is the pavement's back edge; the pavement itself is the stage's `.ground` strip. */
export function Street() {
  return (
    <svg className="scene-street" viewBox="0 -400 1400 400" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="sc-glow"><stop offset="0" stopColor="#FFB84C" stopOpacity=".5" /><stop offset="1" stopColor="#FFB84C" stopOpacity="0" /></radialGradient>
      </defs>
      {/* the old city, far away: a silhouette with minarets and domes and a few lit windows */}
      <g fill="#2A2C66">
        <path d="M0 0 V-70 h60 v-20 h30 v20 h40 v-40 h20 v-70 l8 -16 l8 16 v110 h50 v-30 h40 v30 h30 a35 35 0 0 1 70 0 h40 v-50 h60 v50 h30 v-25 h40 v25 h60 v-40 h20 v-80 l7 -14 l7 14 v120 h40 v-30 h70 v30 h40 a28 28 0 0 1 56 0 h50 v-45 h50 v45 h30 v-20 h50 v20 h40 v-60 h20 v-70 l8 -16 l8 16 v130 h60 v-35 h50 v35 h40 a40 40 0 0 1 80 0 h40 v-25 h50 v25 H1400 V0 Z" />
      </g>
      <g fill="#FFD27A" opacity=".85">
        {[[72, -56], [96, -42], [224, -40], [300, -20], [452, -30], [466, -18], [620, -34], [790, -24], [860, -36], [1010, -26], [1100, -40], [1196, -30], [1330, -16]].map(([x, y]) => (
          <rect key={x} x={x} y={y} width="5" height="6" />
        ))}
      </g>
      {/* lamps glow over the trees; the trees stand at the sides, out of the stage's way */}
      <Tree x={70} s={1.15} /><Tree x={1330} s={1.2} /><Tree x={1250} s={0.8} /><Tree x={160} s={0.75} />
      <Lamp x={215} /><Lamp x={1180} />
      {/* bench */}
      <g transform="translate(560 0)">
        <rect x="0" y="-40" width="120" height="9" fill="#9A6433" /><rect x="0" y="-26" width="120" height="8" fill="#8B5A2B" />
        <rect x="8" y="-16" width="8" height="16" fill="#2A2A3C" /><rect x="104" y="-16" width="8" height="16" fill="#2A2A3C" />
        <rect x="8" y="-54" width="8" height="40" fill="#2A2A3C" /><rect x="104" y="-54" width="8" height="40" fill="#2A2A3C" />
      </g>
      {/* hydrant */}
      <g transform="translate(360 0)">
        <rect x="-9" y="-44" width="18" height="44" rx="3" fill="#D63B2F" /><rect x="-12" y="-48" width="24" height="8" rx="2" fill="#B82E24" />
        <rect x="-16" y="-30" width="32" height="8" rx="2" fill="#D63B2F" /><rect x="-4" y="-55" width="8" height="7" rx="2" fill="#B82E24" />
      </g>
      {/* the grass strip at the pavement's back edge */}
      <rect x="0" y="-10" width="1400" height="10" fill="#3F7A32" />
      <g fill="#4F9A3C">{Array.from({ length: 70 }, (_, i) => <rect key={i} x={i * 20 + (i % 3) * 3} y={-14 - (i % 4) * 2} width="4" height={6 + (i % 4) * 2} />)}</g>
    </svg>
  );
}
