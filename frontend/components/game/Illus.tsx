// X33: the game's illustrations (chapter intros and fact questions) and the ALMATAFI fire truck.
// Flat SVG in the site's palette: VIIRS blue, MODIS sand, fire orange.

import type { Illus as IllusName } from "@/lib/game";

const FIRE = "url(#il-fire)";

function Defs() {
  return (
    <defs>
      <linearGradient id="il-fire" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#E14E22" /><stop offset=".55" stopColor="#FF9A3C" /><stop offset="1" stopColor="#FFE39A" /></linearGradient>
      <linearGradient id="il-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B1430" /><stop offset="1" stopColor="#1C2A44" /></linearGradient>
      <linearGradient id="il-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4C5A2A" /><stop offset="1" stopColor="#2E3618" /></linearGradient>
      <radialGradient id="il-glow"><stop offset="0" stopColor="#FFB547" stopOpacity=".8" /><stop offset="1" stopColor="#FFB547" stopOpacity="0" /></radialGradient>
      <linearGradient id="il-scan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6BD0E4" stopOpacity=".35" /><stop offset="1" stopColor="#6BD0E4" stopOpacity=".04" /></linearGradient>
    </defs>
  );
}

export function Flame({ x, y, h, w = h * 0.62, dim = false }: { x: number; y: number; h: number; w?: number; dim?: boolean }) {
  // Base centre at (x, y), height h.
  const d = `M${x} ${y - h} C${x + w * 0.32} ${y - h * 0.62} ${x + w * 0.5} ${y - h * 0.45} ${x + w * 0.5} ${y - h * 0.22} C${x + w * 0.5} ${y - h * 0.05} ${x + w * 0.25} ${y} ${x} ${y}` +
    ` C${x - w * 0.25} ${y} ${x - w * 0.5} ${y - h * 0.05} ${x - w * 0.5} ${y - h * 0.22} C${x - w * 0.5} ${y - h * 0.4} ${x - w * 0.22} ${y - h * 0.5} ${x - w * 0.12} ${y - h * 0.68}` +
    ` C${x - w * 0.02} ${y - h * 0.55} ${x + w * 0.05} ${y - h * 0.52} ${x + w * 0.08} ${y - h * 0.56} C${x + w * 0.04} ${y - h * 0.72} ${x - w * 0.02} ${y - h * 0.86} ${x} ${y - h} Z`;
  return <path d={d} fill={dim ? "#5A5048" : FIRE} className={dim ? undefined : "il-flicker"} style={{ transformOrigin: `${x}px ${y}px` }} />;
}

function Satellite({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className="il-float">
      <rect x="-34" y="-7" width="22" height="14" rx="2" fill="#3B6FA8" stroke="#9CC4EA" strokeWidth="1.5" />
      <rect x="12" y="-7" width="22" height="14" rx="2" fill="#3B6FA8" stroke="#9CC4EA" strokeWidth="1.5" />
      <path d="M-34 0h22M12 0h22M-23 -7v14M23 -7v14" stroke="#9CC4EA" strokeWidth="1" />
      <rect x="-10" y="-11" width="20" height="22" rx="4" fill="#D9DEE6" stroke="#8C96A6" strokeWidth="1.5" />
      <circle cx="0" cy="12" r="4" fill="#6BD0E4" />
    </g>
  );
}

function Cloud({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-46 10 C-58 10 -60 -8 -44 -10 C-42 -26 -18 -30 -10 -16 C-2 -30 26 -28 26 -10 C44 -12 50 10 34 12 Z" fill="#E8EDF4" />
      <path d="M-46 10 C-58 10 -60 -8 -44 -10" fill="none" stroke="#C5CFDC" strokeWidth="2" />
    </g>
  );
}

function Label({ x, y, children, anchor = "middle", color = "#F2EBE1" }: { x: number; y: number; children: string; anchor?: "start" | "middle" | "end"; color?: string }) {
  return <text x={x} y={y} textAnchor={anchor} className="il-label" fill={color}>{children}</text>;
}

function Hotspot() {
  return (
    <svg viewBox="0 0 420 250" className="illus" role="img" aria-label="A satellite scans the ground: a fire makes a hot pixel, a gas flare makes one too, and a fire under cloud makes none.">
      <Defs />
      <rect width="420" height="250" rx="18" fill="url(#il-sky)" />
      <path d="M210 52 L40 196 L380 196 Z" fill="url(#il-scan)" />
      <Satellite x={210} y={38} />
      <rect y="196" width="420" height="54" fill="url(#il-ground)" />
      <path d="M0 214h420M0 232h420" stroke="#5E6C34" strokeWidth="1.5" />
      {/* A fire: a hot pixel */}
      <circle cx="92" cy="186" r="34" fill="url(#il-glow)" />
      <Flame x={92} y={198} h={42} /><Flame x={78} y={198} h={26} /><Flame x={106} y={198} h={22} />
      <rect x="62" y="152" width="60" height="50" rx="3" fill="none" stroke="#FFC65C" strokeWidth="3" className="il-pulse" />
      <Label x={92} y={142}>hotspot</Label>
      {/* Under cloud: missed */}
      <Flame x={212} y={198} h={30} /><Cloud x={212} y={150} s={1.15} />
      <Label x={212} y={118} color="#C5CFDC">hidden by cloud</Label>
      {/* A gas flare: a hotspot too */}
      <rect x="318" y="140" width="14" height="58" fill="#8C96A6" /><rect x="312" y="136" width="26" height="8" fill="#6B7380" />
      <Flame x={325} y={136} h={26} w={14} />
      <rect x="296" y="102" width="58" height="50" rx="3" fill="none" stroke="#FFC65C" strokeWidth="3" strokeDasharray="6 4" />
      <Label x={325} y={92}>flare: a hotspot too</Label>
    </svg>
  );
}

function Pixels() {
  const fire = (ox: number) => (
    <g>
      <circle cx={ox + 80} cy="150" r="40" fill="url(#il-glow)" />
      {[[62, 172, 34], [84, 176, 46], [104, 170, 30], [72, 186, 20], [118, 184, 16], [48, 186, 14]].map(([x, y, h], i) => <Flame key={i} x={ox + x} y={y} h={h} />)}
    </g>
  );
  const grid = (ox: number, cell: number, lit: [number, number][], color: string) => {
    const cols = Math.round(160 / cell), rows = Math.round(120 / cell), out = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const on = lit.some(([cc, rr]) => cc === c && rr === r);
      out.push(<rect key={`${r}-${c}`} x={ox + c * cell} y={96 + r * cell} width={cell} height={cell}
                     fill={on ? color : "none"} fillOpacity={on ? 0.42 : 0} stroke={on ? color : "rgba(255,255,255,.22)"} strokeWidth={on ? 2 : 1} />);
    }
    return out;
  };
  const viirsLit: [number, number][] = [[3, 4], [4, 4], [5, 4], [4, 3], [5, 3], [6, 4], [3, 5], [6, 5], [2, 5], [5, 5], [4, 5]];
  return (
    <svg viewBox="0 0 420 250" className="illus" role="img" aria-label="The same fires seen through big MODIS pixels (2 hot) and small VIIRS pixels (11 hot).">
      <Defs />
      <rect width="420" height="250" rx="18" fill="url(#il-sky)" />
      {fire(20)}{fire(230)}
      {grid(20, 40, [[1, 2], [2, 2]], "#E8C79A")}
      {grid(230, 16, viirsLit, "#6BD0E4")}
      <Label x={100} y={44}>MODIS · 1 km pixels</Label><Label x={100} y={66} color="#E8C79A">2 hotspots</Label>
      <Label x={310} y={44}>VIIRS · 375 m pixels</Label><Label x={310} y={66} color="#6BD0E4">11 hotspots</Label>
      <Label x={210} y={238} color="#AEB8C6">Same fires. Smaller pixels catch smaller flames.</Label>
    </svg>
  );
}

function Years() {
  const hs = [40, 52, 34, 46, 60, 38, 50, 44, 56, 42];
  return (
    <svg viewBox="0 0 420 250" className="illus" role="img" aria-label="Ten past years as flames of different heights, and this year as a question mark.">
      <Defs />
      <rect width="420" height="250" rx="18" fill="url(#il-sky)" />
      <rect x="24" y="128" width="372" height="36" rx="8" fill="rgba(107,208,228,.12)" />
      <Label x={30} y={122} anchor="start" color="#6BD0E4">typical range</Label>
      {hs.map((h, i) => <g key={i}><Flame x={44 + i * 32} y={196} h={h * 1.5} /><text x={44 + i * 32} y={214} textAnchor="middle" className="il-tiny" fill="#AEB8C6">{`'${String(14 + i).padStart(2, "0")}`}</text></g>)}
      <g className="il-pulse"><path d="M376 196 C352 196 352 150 376 104 C400 150 400 196 376 196 Z" fill="none" stroke="#FFC65C" strokeWidth="3" strokeDasharray="6 5" /></g>
      <text x="376" y="168" textAnchor="middle" className="il-q" fill="#FFC65C">?</text>
      <text x="376" y="214" textAnchor="middle" className="il-tiny" fill="#FFC65C">this year</text>
      <Label x={210} y={40}>The same month, year after year</Label>
    </svg>
  );
}

function Trap() {
  const raw = [22, 26, 20, 24, 28, 92, 100, 88, 96, 104], ours = [70, 78, 66, 74, 82, 76, 80, 70, 74, 78];
  const bars = (ox: number, vals: number[], colors: (i: number) => string) =>
    vals.map((v, i) => <rect key={i} x={ox + i * 17} y={196 - v} width="12" height={v} rx="2" fill={colors(i)} />);
  return (
    <svg viewBox="0 0 420 250" className="illus" role="img" aria-label="Raw counts jump when VIIRS arrives in 2012; the harmonized record stays level.">
      <Defs />
      <rect width="420" height="250" rx="18" fill="url(#il-sky)" />
      {bars(24, raw, (i) => (i < 5 ? "#C9B596" : "#6BD0E4"))}
      <path d="M106 96 L106 206" stroke="#6BD0E4" strokeDasharray="4 4" strokeWidth="2" />
      <Label x={106} y={86} color="#6BD0E4">2012</Label>
      <Label x={100} y={226}>Raw: glued together</Label>
      <path d="M200 140 h26 m-8 -8 l8 8 -8 8" stroke="#FFC65C" strokeWidth="3" fill="none" />
      {bars(244, ours, () => "url(#il-fire)")}
      <Label x={322} y={226}>Harmonized: level</Label>
      <text x="62" y="60" textAnchor="middle" className="il-big" fill="#FF9A8A">jump?</text>
      <text x="322" y="60" textAnchor="middle" className="il-big" fill="#8BE3A6">no jump</text>
    </svg>
  );
}

function MapIllus() {
  const dots: [number, number][] = [[150, 110], [170, 124], [186, 106], [204, 138], [222, 118], [240, 150], [196, 160], [262, 128], [176, 150], [230, 98], [272, 160], [160, 172]];
  return (
    <svg viewBox="0 0 420 250" className="illus" role="img" aria-label="A folded map dotted with hotspots.">
      <Defs />
      <rect width="420" height="250" rx="18" fill="url(#il-sky)" />
      <path d="M96 64 L176 52 L250 64 L330 52 L330 200 L250 212 L176 200 L96 212 Z" fill="#E9D3A6" stroke="#B48A52" strokeWidth="2" />
      <path d="M176 52 L176 200 M250 64 L250 212" stroke="#C9A876" strokeWidth="2" />
      <path d="M118 180 C150 150 170 170 200 130 C230 96 270 120 306 86" stroke="#7FA4C9" strokeWidth="5" fill="none" strokeLinecap="round" />
      {dots.map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="9" fill="url(#il-glow)" /><circle cx={x} cy={y} r="4" fill="#E9702A" stroke="#FFE39A" strokeWidth="1.5" /></g>)}
      <Label x={213} y={238}>Each dot: one hotspot that month</Label>
    </svg>
  );
}

export default function Illus({ name }: { name: IllusName }) {
  if (name === "hotspot") return <Hotspot />;
  if (name === "pixels") return <Pixels />;
  if (name === "years") return <Years />;
  if (name === "trap") return <Trap />;
  return <MapIllus />;
}

/** Decor: the ALMATAFI fire truck, its light bar flashing and a soft glow under it. */
export function FireTruck({ width = 220 }: { width?: number }) {
  return (
    <svg className="firetruck" width={width} height={width * 0.5} viewBox="0 0 240 120" role="img" aria-label="An ALMATAFI fire truck">
      <defs>
        <linearGradient id="ft-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F0453A" /><stop offset="1" stopColor="#A81E1A" /></linearGradient>
        <radialGradient id="ft-glow"><stop offset="0" stopColor="#FF6A3D" stopOpacity=".55" /><stop offset="1" stopColor="#FF6A3D" stopOpacity="0" /></radialGradient>
      </defs>
      <ellipse className="ft-glow" cx="120" cy="104" rx="118" ry="16" fill="url(#ft-glow)" />
      {/* ladder */}
      <g stroke="#D8DDE4" strokeWidth="3"><path d="M30 30 H170" /><path d="M30 40 H170" />{[40, 60, 80, 100, 120, 140, 160].map((x) => <path key={x} d={`M${x} 30 V40`} />)}</g>
      {/* body and cab */}
      <rect x="18" y="44" width="150" height="46" rx="5" fill="url(#ft-body)" stroke="#6E1410" strokeWidth="2" />
      <path d="M168 50 H200 L222 70 V90 H168 Z" fill="url(#ft-body)" stroke="#6E1410" strokeWidth="2" />
      <path d="M176 56 H198 L212 70 H176 Z" fill="#9FD7F0" stroke="#3B6FA8" strokeWidth="2" />
      <rect x="18" y="74" width="204" height="5" fill="#F7D046" />
      {[30, 62, 94, 126].map((x) => <rect key={x} x={x} y="52" width="24" height="16" rx="2" fill="#7A1410" opacity=".5" />)}
      <text x="93" y="70" textAnchor="middle" className="ft-name">ALMATAFI</text>
      {/* light bar */}
      <rect x="182" y="42" width="24" height="7" rx="3" fill="#333" />
      <rect className="ft-light a" x="183" y="43" width="10" height="5" rx="2" fill="#FF3B30" />
      <rect className="ft-light b" x="195" y="43" width="10" height="5" rx="2" fill="#2E7BFF" />
      {/* wheels */}
      {[52, 140, 196].map((x) => <g key={x}><circle cx={x} cy="92" r="13" fill="#1E1E22" /><circle cx={x} cy="92" r="6" fill="#9AA3AE" /></g>)}
    </svg>
  );
}
