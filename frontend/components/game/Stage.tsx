"use client";

// X33: one question on the stage. The host stands on the question card; two answer blocks hang
// over the ground with Khalid between them. Pick a block (click, ←/→, 1/2): Khalid runs under
// it (the runner sheet, mirrored to run left), jumps, and on the jump's peak frame his head
// hits the block: it bumps and turns right or wrong. Then the host celebrates or catches fire
// and runs, and on a wrong answer the firefighter sprays at once. The truck glows on the left.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Round } from "@/lib/game";
import { play, say } from "@/lib/sound";
import { FireTruck } from "./Illus";
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
};

const KHALID_H = 210;       // display height of Khalid's jump frames, px; his run frames use the same scale
const HOST_IDLE_H = 150;    // display height of the host's idle frames; his other sheets use the same scale
const FIREFIGHTER_H = 150;
const RUN_SPEED = 620;      // px per second across the lane
const GROUND = 18;          // px of ground under the characters' feet
const HOST_PAD = 132;       // room above the card for the host

export default function Stage({ round, sheets, index, total, onResult, onSettled }: Props) {
  const [phase, setPhase] = useState<Phase>("ask");
  const [target, setTarget] = useState<0 | 1 | null>(null);
  const [dx, setDx] = useState(0);
  const [hit, setHit] = useState(false);
  const [hostRun, setHostRun] = useState<{ n: number; kind: "right" | "wrong" } | null>(null);
  const [spray, setSpray] = useState(0);
  const lane = useRef<HTMLDivElement>(null);
  const blocks = [useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null)];
  const settled = useRef(false);

  const jump = sheets["khalid-jump"], run = sheets["khalid-run"];
  const s = KHALID_H / jump.frameH;
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

  const hs = HOST_IDLE_H / sheets["host-idle"].frameH;
  const host = hostRun?.kind === "right" ? sheets["host-right"] : hostRun?.kind === "wrong" ? sheets["host-wrong"] : sheets["host-idle"];
  const khalidSheet = phase === "run" ? run : jump;
  const blockLift = Math.round(((jump.rise ?? jump.frameH * 0.28) * s) + (jump.baseline * s) * 0.62);

  return (
    <section className={`stage stage-${phase}`} aria-labelledby="q">
      <div className="stage-card-wrap" style={{ paddingTop: HOST_PAD }}>
        <div className="host" aria-hidden={hostRun ? undefined : true} style={{ top: HOST_PAD - host.baseline * hs }}>
          {hostRun ? (
            <Sprite key={hostRun.n} sheet={host} height={host.frameH * hs} run={hostRun.n} hold="first"
                    onEnd={() => { setHostRun(null); settle(); }}
                    label={hostRun.kind === "right" ? "The host jumps for joy" : "The host's shoes catch fire and he runs"} />
          ) : (
            <Sprite sheet={sheets["host-idle"]} height={sheets["host-idle"].frameH * hs} run="idle" loop />
          )}
        </div>
        <div className="q-card">
          <div className="q-meta">
            <span className="q-place">{round.place}</span>
            <span className="q-count">Question {index} of {total}</span>
          </div>
          <h1 id="q" className="q-text">{round.prompt}</h1>
          {round.context && <p className="q-ctx">{round.context}</p>}
          <Visual v={round.visual} answered={hit} sheets={sheets} />
        </div>
      </div>

      <div className="lane" ref={lane} style={{ ["--lift" as string]: `${blockLift + GROUND}px`, ["--kh" as string]: `${KHALID_H}px`, ["--ground" as string]: `${GROUND}px` }}>
        {round.choices.map((c, t) => {
          const state = !hit ? "" : c.id === round.answer ? (t === target ? " right" : " was-right") : t === target ? " wrong" : " dim";
          return (
            <button key={c.id} ref={blocks[t]} type="button" className={`block block-${t}${hit && t === target ? " hit" : ""}${state}`}
                    disabled={phase !== "ask"} onClick={() => pick(t as 0 | 1)}
                    aria-label={`${t === 0 ? "Left" : "Right"} answer: ${c.label}`}>
              <span className="block-key" aria-hidden="true">{t === 0 ? "←" : "→"}</span>
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

        <div className="ground" aria-hidden="true" />
        <div className="truck"><FireTruck width={200} /></div>
        {sheets["firefighter-spray"] && (
          <div className="firefighter" style={{ bottom: GROUND - (sheets["firefighter-spray"].frameH - sheets["firefighter-spray"].baseline) * (FIREFIGHTER_H / sheets["firefighter-spray"].frameH) }}>
            <Periodic sheet={sheets["firefighter-spray"]} height={FIREFIGHTER_H} rest={3000} poke={spray} label="A firefighter spraying water" />
          </div>
        )}
      </div>
      <p className="lane-hint" aria-hidden={phase !== "ask"}>{phase === "ask" ? "Pick a block: click it, or press ← or →." : " "}</p>
    </section>
  );
}
