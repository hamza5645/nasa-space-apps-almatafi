// Wel3a's body: a small flame with a face, drawn in SVG. The mood only switches CSS
// (wel3a.css): idle sways and blinks, talk moves the mouth, think looks up, happy smiles.

export type Mood = "idle" | "talk" | "think" | "happy";

export default function Flame({ mood }: { mood: Mood }) {
  return (
    <svg className="w3-svg" data-mood={mood} viewBox="0 0 64 72" aria-hidden="true">
      <defs>
        <linearGradient id="w3-outer" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFB23E" /><stop offset="1" stopColor="#E8501C" />
        </linearGradient>
        <linearGradient id="w3-core" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF4C4" /><stop offset="1" stopColor="#FFC65C" />
        </linearGradient>
      </defs>
      <g className="w3-body">
        <path fill="url(#w3-outer)" d="M33 3C36 15 55 25 55 46C55 60 45 69 32 69C19 69 9 60 9 46C9 35 16 30 19 20C22 25 25 26 26 24C27 16 30 9 33 3Z" />
        <path className="w3-core" fill="url(#w3-core)" d="M32 31C37 38 47 43 47 53C47 61 40 66 32 66C24 66 17 61 17 53C17 44 27 40 32 31Z" />
        <g className="w3-face" fill="#2A1608">
          <g className="w3-eyes">
            <ellipse cx="25.5" cy="50" rx="2.8" ry="3.8" /><ellipse cx="38.5" cy="50" rx="2.8" ry="3.8" />
            <circle cx="26.5" cy="48.5" r="1" fill="#FFF8E2" /><circle cx="39.5" cy="48.5" r="1" fill="#FFF8E2" />
          </g>
          <path className="w3-arcs" d="M22 51q3.5-4.5 7 0M35 51q3.5-4.5 7 0" fill="none" stroke="#2A1608" strokeWidth="2" strokeLinecap="round" />
          <path className="w3-smile" d="M28.5 57q3.5 3 7 0" fill="none" stroke="#2A1608" strokeWidth="1.8" strokeLinecap="round" />
          <ellipse className="w3-o" cx="32" cy="58" rx="2.6" ry="2.8" />
        </g>
      </g>
    </svg>
  );
}
