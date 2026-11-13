"use client";

// X33: one question on the stage. The host stands on the question card; two answer blocks hang
// over the ground with Khalid between them. Pick a block (click, ←/→, 1/2): Khalid runs under
// it (the runner sheet, mirrored to run left), jumps, and on the jump's peak frame his head
// hits the block: it bumps and turns right or wrong. Then the host celebrates or catches fire
// and runs, and on a wrong answer the firefighter sprays at once. The truck glows on the left.
// Everything is sized from the viewport height (`unit`), so a question fits the screen with
// no page scroll; the explanation comes in over the card's lower part.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Round } from "@/lib/game";
import { play, say } from "@/lib/sound";
import { Street } from "./Scene";
import Sprite, { Periodic, type Sheets } from "./Sprite";
import Visual from "./Visual";

type Phase = "ask" | "run" | "jump" | "react" | "done";

type Props = {
  round: Round;
  sheets: Sheets;
  index: number;            // round number in the chapter, 1-based
  total: number;
  onResult: (choice: string, right: boolean) => void;   // at the block hit
  onSettled: () => void;                                // the reaction has played
  explain?: ReactNode;                                  // shown over the card once settled
};

// Base sizes at unit 1 (a 900 px tall viewport); everything scales down to unit 0.58.
const KHALID_H = 210;       // display height of Khalid's jump frames; his run frames use the same scale
const HOST_IDLE_H = 120;    // the host's idle frames; his other sheets use the same scale
const FIREFIGHTER_H = 150;
const TRUCK_H = 128;
const RUN_SPEED = 620;      // px per second across the lane

const subscribeResize = (cb: () => void) => { window.addEventListener("resize", cb); return () => window.removeEventListener("resize", cb); };
const unitNow = () => Math.min(1, Math.max(0.58, (window.innerHeight - 60) / 840));

export default function Stage({ round, sheets, index, total, onResult, onSettled, explain }: Props) {
  const [phase, setPhase] = useState<Phase>("ask");
  const [target, setTarget] = useState<0 | 1 | null>(null);
  const [dx, setDx] = useState(0);
  const [hit, setHit] = useState(false);
  const [hostRun, setHostRun] = useState<{ n: number; kind: "right" | "wrong" } | null>(null);
  const [spray, setSpray] = useState(0);
  const lane = useRef<HTMLDivElement>(null);
  const blocks = [useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null)];
  const settled = useRef(false);
  const unit = useSyncExternalStore(subscribeResize, unitNow, () => 1);
  const GROUND = Math.round(16 * unit);  // the pavement's top edge, under the characters' feet

  const jump = sheets["khalid-jump"], run = sheets["khalid-run"];
  const s = (KHALID_H * unit) / jump.frameH;
  const peak = jump.peak ?? Math.floor(jump.frames / 2);
  const picked = target === null ? null : round.choices[target].id;
  const right = picked !== null && picked === round.answer;

  const pick = useCallback((t: 0 | 1) => {
    if (phase !== "ask") return;
    const l = lane.current?.getBoundingClientRect(), b = blocks[t].current?.getBoundingClientRect();
    const d = l && b ? (b.left + b.width / 2) - (l.left + l.width / 2) : (t === 0 ? -160 : 160);
    setTarget(t); setDx(d); setPhase("run");
    play("tap");
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys: ← / 1 for the left block, → / 2 for the right one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || phase !== "ask") return;
      if (e.key === "ArrowLeft" || e.key === "1") { e.preventDefault(); pick(0); }
      if (e.key === "ArrowRight" || e.key === "2") { e.preventDefault(); pick(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, pick]);

  // The run lasts as long as the distance needs; with reduced motion it's instant.
  const runMs = Math.max(260, (Math.abs(dx) / RUN_SPEED) * 1000);
  const still = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useLayoutEffect(() => {
    if (phase !== "run") return;
    const t = setTimeout(() => setPhase("jump"), still ? 0 : runMs);
    return () => clearTimeout(t);
  }, [phase, runMs, still]);

  const onJumpFrame = (i: number) => {
    if (i !== peak || hit || picked === null) return;
    setHit(true);
    onResult(picked, right);
    play(right ? "right" : "wrong");
    say(right ? (Math.random() < 0.5 ? "right-1" : "right-2") : (Math.random() < 0.5 ? "wrong-1" : "wrong-2"));
  };
  const onJumpEnd = () => {
    setPhase("react");
    setHostRun({ n: Date.now(), kind: right ? "right" : "wrong" });
    if (!right) setSpray((n) => n + 1);
  };
  const settle = () => {
    if (settled.current) return;
    settled.current = true;
    setPhase("done");
    onSettled();
  };
  // The explanation needn't wait for the whole wrong-answer run: show it after a beat.
  useEffect(() => {
    if (phase !== "react") return;
    const t = setTimeout(settle, right ? 1100 : 1500);
    return () => clearTimeout(t);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // The host: one scale for all his sheets. The band above the card holds his standing
  // height; a jump may rise above it, over the header (the host draws above it).
  const idle = sheets["host-idle"];
  const hs = (HOST_IDLE_H * unit) / idle.frameH;
  const host = hostRun?.kind === "right" ? sheets["host-right"] : hostRun?.kind === "wrong" ? sheets["host-wrong"] : idle;
  const band = Math.round(idle.baseline * hs) + 6;
  const khalidSheet = phase === "run" ? run : jump;
  // The block's underside sits where Khalid's head is at the top of his jump, less a little, so it's a hit.
  const blockLift = Math.round((jump.baseline + (jump.rise ?? jump.frameH * 0.28)) * s * 0.95);
  const ff = sheets["firefighter-spray"];
  const ffH = FIREFIGHTER_H * unit;

  return (
    <section className={`stage stage-${phase}`} aria-labelledby="q" style={{ ["--unit" as string]: unit }}>
      <div className="stage-card-wrap" style={{ paddingTop: band }}>
        <div className="host" aria-hidden={hostRun ? undefined : true} style={{ top: band - 6 - host.baseline * hs }}>
          {hostRun ? (
            <Sprite key={hostRun.n} sheet={host} height={host.frameH * hs} run={hostRun.n} hold="first"
                    onEnd={() => { setHostRun(null); settle(); }}
                    label={hostRun.kind === "right" ? "The host jumps for joy" : "The host's shoes catch fire and he runs"} />
          ) : (
            <Sprite sheet={idle} height={idle.frameH * hs} run="idle" loop />
          )}
        </div>
        <div className="q-card">
          <div className="q-meta">
            <span className="q-place">{round.place}</span>
            <span className="q-count">Question {index} of {total}</span>
          </div>
          <h1 id="q" className="q-text">{round.prompt}</h1>
          {round.context && <p className="q-ctx">{round.context}</p>}
          <div className="q-visual"><Visual v={round.visual} answered={hit} sheets={sheets} /></div>
        </div>
        {explain}
      </div>

      <div className="lane" ref={lane} style={{ ["--lift" as string]: `${blockLift + GROUND}px`, ["--ground" as string]: `${GROUND}px` }}>
        {round.choices.map((c, t) => {
          const state = !hit ? "" : c.id === round.answer ? (t === target ? " right" : " was-right") : t === target ? " wrong" : " dim";
          return (
            <button key={c.id} ref={blocks[t]} type="button" className={`block block-${t}${hit && t === target ? " hit" : ""}${state}`}
                    disabled={phase !== "ask"} onClick={() => pick(t as 0 | 1)}
                    aria-label={`${t === 0 ? "Left" : "Right"} answer: ${c.label}`}>
              <span className="block-key" aria-hidden="true">{t === 0 ? "←" : "→"}</span>
              <span className="block-ico" aria-hidden="true">{t === 0 ? (
                <svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 15a9 9 0 0 1 18 0v2H3v-2Z" fill="#E0473A" /><rect x="2" y="16" width="20" height="4" rx="1.5" fill="#FFD27A" /><rect x="10" y="4" width="4" height="7" rx="1" fill="#FFF3C4" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2c2 5 7 7 7 13a7 7 0 0 1-14 0c0-3 2-5 3-7 1 2 2 3 3 3 0-3 0-6 1-9Z" fill="#FFC14A" /><path d="M12 13c1 2 3 3 3 5a3 3 0 0 1-6 0c0-2 2-3 3-5Z" fill="#FFF4C4" /></svg>
              )}</span>
              <span className="block-label">{c.label}</span>
              {hit && t === target && <span className="block-mark" aria-hidden="true">{right ? "✓" : "✗"}</span>}
              {hit && t === target && <span className={`block-burst ${right ? "ok" : "no"}`} aria-hidden="true">{Array.from({ length: 10 }, (_, k) => <i key={k} style={{ ["--a" as string]: `${k * 36}deg` }} />)}</span>}
            </button>
          );
        })}

        <div className="khalid" style={{ transform: `translateX(${phase === "ask" ? 0 : dx}px)`, transitionDuration: phase === "run" ? `${still ? 0 : runMs}ms` : "0ms",
                                          bottom: `${GROUND - (khalidSheet.frameH - khalidSheet.baseline) * s}px` }}>
          <div className="khalid-c">
          <Sprite sheet={khalidSheet} height={khalidSheet.frameH * s} flip={phase === "run" && dx < 0}
                  run={phase === "run" ? "run" : phase === "jump" ? "jump" : null} loop={phase === "run"} still={0} hold="first"
                  onFrame={phase === "jump" ? onJumpFrame : undefined} onEnd={phase === "jump" ? onJumpEnd : undefined}
                  label={phase === "ask" ? "Khalid, waiting for your answer" : undefined} />
          </div>
        </div>

        <div className="street-wrap" aria-hidden="true"><Street /></div>
        <div className="ground" aria-hidden="true">
          <span className="ground-hint">{phase === "ask" ? "Pick a block: click it, or press ← or →" : ""}</span>
        </div>
        {sheets["truck-idle"] && (
          <div className="truck" style={{ bottom: GROUND - (sheets["truck-idle"].frameH - sheets["truck-idle"].baseline) * (TRUCK_H * unit / sheets["truck-idle"].frameH) }}>
            <Sprite sheet={sheets["truck-idle"]} height={TRUCK_H * unit} run="idle" loop label="The ALMATAFI fire truck" />
          </div>
        )}
        {ff && (
          <div className="firefighter" style={{ bottom: GROUND - (ff.frameH - ff.baseline) * (ffH / ff.frameH) }}>
            <Periodic sheet={ff} height={ffH} rest={3000} poke={spray} label="A firefighter spraying water" />
          </div>
        )}
      </div>
    </section>
  );
}
