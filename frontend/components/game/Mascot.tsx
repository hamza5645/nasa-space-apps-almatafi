"use client";

// The game's host: a sprite sheet when lib/mascot.ts names one, otherwise a drawn ember with a
// face. Its mood follows the game (idle, happy, sad, win, out).

import { MASCOT, type Mood } from "@/lib/mascot";

export default function Mascot({ mood, size = 120 }: { mood: Mood; size?: number }) {
  if (MASCOT) {
    const m = MASCOT.moods[mood] ?? MASCOT.moods.idle;
    const s = MASCOT.scale ?? 1, fw = MASCOT.frameW * s, fh = MASCOT.frameH * s;
    return (
      <div key={mood} className="mascot-sprite" role="img" aria-label={`The host looks ${mood}`}
           style={{
             width: fw, height: fh, backgroundImage: `url(${MASCOT.src})`,
             backgroundSize: `${MASCOT.cols * fw}px ${MASCOT.rows * fh}px`, backgroundPositionY: `${-m.row * fh}px`,
             ["--sprite-end" as string]: `${-m.frames * fw}px`,
             animation: `sprite ${m.frames / m.fps}s steps(${m.frames}) ${"loop" in m && m.loop === false ? "1 forwards" : "infinite"}`,
           }} />
    );
  }
  return <Ember mood={mood} size={size} />;
}

const MOUTH: Record<Mood, string> = {
  idle: "M50 101 Q60 108 70 101",
  happy: "M46 99 Q60 116 74 99 Q60 106 46 99 Z",
  win: "M44 98 Q60 120 76 98 Q60 108 44 98 Z",
  sad: "M50 106 Q60 98 70 106",
  out: "M51 104 L69 104",
};

function Ember({ mood, size }: { mood: Mood; size: number }) {
  const dim = mood === "out";
  return (
    <svg className={`ember-mascot mood-${mood}`} width={size} height={size * 1.15} viewBox="0 0 120 138" role="img"
         aria-label={dim ? "The ember has gone out" : `The ember looks ${mood === "idle" ? "curious" : mood}`}>
      <defs>
        <radialGradient id="emb-body" cx="50%" cy="68%" r="62%">
          <stop offset="0" stopColor={dim ? "#9A8F86" : "#FFF1B8"} />
          <stop offset=".45" stopColor={dim ? "#6B625B" : "#FFB547"} />
          <stop offset="1" stopColor={dim ? "#3A3430" : "#E14E22"} />
        </radialGradient>
        <filter id="emb-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7" /></filter>
      </defs>
      {!dim && <ellipse className="emb-glow" cx="60" cy="92" rx="46" ry="38" fill="#F08A24" opacity=".45" filter="url(#emb-blur)" />}
      <g className="emb-flame">
        <path d="M60 6 C70 30 98 46 99 84 C100 112 82 132 60 132 C38 132 20 112 21 84 C22 62 36 52 42 33 C47 44 51 50 57 52 C55 37 55 21 60 6 Z"
              fill="url(#emb-body)" />
        <path className="emb-tip" d="M78 46 C84 52 90 60 91 70" stroke={dim ? "#8A817A" : "#FFE39A"} strokeWidth="3" strokeLinecap="round" fill="none" opacity=".7" />
      </g>
      <g className="emb-face">
        {mood === "happy" || mood === "win" ? (
          <>
            <path d="M40 86 Q47 78 54 86" stroke="#2A140A" strokeWidth="4" strokeLinecap="round" fill="none" />
            <path d="M66 86 Q73 78 80 86" stroke="#2A140A" strokeWidth="4" strokeLinecap="round" fill="none" />
          </>
        ) : (
          <>
            <ellipse cx="47" cy="86" rx="6.5" ry={mood === "sad" ? 7 : 8.5} fill="#2A140A" />
            <ellipse cx="73" cy="86" rx="6.5" ry={mood === "sad" ? 7 : 8.5} fill="#2A140A" />
            {!dim && <><circle cx="49" cy="83" r="2.2" fill="#fff" /><circle cx="75" cy="83" r="2.2" fill="#fff" /></>}
            {mood === "sad" && <><path d="M39 79 L52 74" stroke="#2A140A" strokeWidth="3" strokeLinecap="round" /><path d="M81 79 L68 74" stroke="#2A140A" strokeWidth="3" strokeLinecap="round" /></>}
          </>
        )}
        <path d={MOUTH[mood]} stroke="#2A140A" strokeWidth="3.5" strokeLinecap="round" fill={mood === "happy" || mood === "win" ? "#7A2412" : "none"} />
        {!dim && <><circle cx="37" cy="98" r="5" fill="#FF7A59" opacity=".45" /><circle cx="83" cy="98" r="5" fill="#FF7A59" opacity=".45" /></>}
      </g>
      {dim && <g className="emb-smoke" fill="none" stroke="#9A8F86" strokeWidth="3" strokeLinecap="round" opacity=".7">
        <path d="M60 4 C54 -6 66 -12 60 -22" /><path d="M70 10 C66 2 76 -4 72 -12" />
      </g>}
    </svg>
  );
}

/** One life: a small flame, lit or spent. */
export function EmberIcon({ lit }: { lit: boolean }) {
  return (
    <svg className={`ember-life${lit ? " lit" : ""}`} width="22" height="26" viewBox="0 0 24 28" aria-hidden="true">
      <path d="M12 1 C15 7 21 10 21 17 C21 23 17 27 12 27 C7 27 3 23 3 17 C3 12 7 10 8 6 C9 9 10 10 11 11 C11 7 11 4 12 1 Z"
            fill={lit ? "url(#life-g)" : "#3A332D"} stroke={lit ? "none" : "#5A5048"} />
      <defs><radialGradient id="life-g" cx="50%" cy="70%" r="60%"><stop offset="0" stopColor="#FFF1B8" /><stop offset=".5" stopColor="#FFB547" /><stop offset="1" stopColor="#E14E22" /></radialGradient></defs>
    </svg>
  );
}
