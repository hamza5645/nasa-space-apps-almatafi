"use client";

// A sprite strip (public/game/sprites/, one row of equal frames) played frame by frame from
// JavaScript, so the game can act on an exact frame: the block bumps on the jump's peak frame,
// the firefighter sprays when the fire appears. `run` is a token: change it to restart.

import { useEffect, useRef, useState } from "react";

export type SheetMeta = {
  src: string; frameW: number; frameH: number; frames: number; fps: number; baseline: number;
  facing?: string; rise?: number; peak?: number;
};
export type Sheets = Record<string, SheetMeta>;

type Props = {
  sheet: SheetMeta;
  height: number;                 // display height of a frame, px (width follows)
  run?: number | string | null;   // null = show `still`; any other value plays (a new value restarts)
  loop?: boolean;
  fps?: number;
  flip?: boolean;
  still?: number;                 // frame shown when not playing (default 0)
  hold?: "first" | "last";        // after a one-shot: stay on the last frame (default) or go back to the first
  onFrame?: (i: number) => void;
  onEnd?: () => void;
  className?: string;
  label?: string;
};

export default function Sprite({ sheet, height, run = null, loop = false, fps, flip, still = 0, hold = "last", onFrame, onEnd, className = "", label }: Props) {
  const [frame, setFrame] = useState(still);
  const cb = useRef({ onFrame, onEnd });
  useEffect(() => { cb.current = { onFrame, onEnd }; });

  useEffect(() => {
    if (run === null || run === undefined) return;
    const rate = fps ?? sheet.fps, n = sheet.frames;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // No animation: jump to the end state, but still report the frames the game listens for.
      const t = setTimeout(() => {
        for (let i = 0; i < n; i++) cb.current.onFrame?.(i);
        setFrame(loop ? still : hold === "first" ? 0 : n - 1);
        cb.current.onEnd?.();
      }, 120);
      return () => clearTimeout(t);
    }
    let raf = 0, last = -1, ended = false;
    const t0 = performance.now();
    const tick = (now: number) => {
      const f = Math.floor(((now - t0) / 1000) * rate);
      const i = loop ? f % n : Math.min(f, n - 1);
      if (f !== last) {
        // Report every frame passed since the last tick, so a slow tick can't skip a cue.
        for (let k = last + 1; k <= f; k++) cb.current.onFrame?.(loop ? k % n : Math.min(k, n - 1));
        last = f;
        setFrame(i);
      }
      if (!loop && f >= n) {
        if (!ended) { ended = true; if (hold === "first") setFrame(0); cb.current.onEnd?.(); }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, sheet, loop, fps, still, hold]);

  const shown = run === null || run === undefined ? still : frame;
  const s = height / sheet.frameH, w = Math.round(sheet.frameW * s);
  return (
    <div className={`sprite ${className}`} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}
         style={{
           width: w, height, backgroundImage: `url(${sheet.src})`,
           backgroundSize: `${sheet.frames * w}px ${height}px`, backgroundPosition: `${-shown * w}px 0`,
           transform: flip ? "scaleX(-1)" : undefined,
         }} />
  );
}

/** Plays a one-shot animation, rests, and plays again, forever. A new `poke` value replays it
 *  at once (hovering the map, a wrong answer). */
export function Periodic({ sheet, height, rest = 3000, poke = 0, flip, className, still, label }:
  { sheet: SheetMeta; height: number; rest?: number; poke?: number; flip?: boolean; className?: string; still?: number; label?: string }) {
  const [cycle, setCycle] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <Sprite sheet={sheet} height={height} run={`${cycle}:${poke}`} flip={flip} className={className} still={still} label={label}
            onEnd={() => {
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => setCycle((c) => c + 1), rest);
            }} />
  );
}
