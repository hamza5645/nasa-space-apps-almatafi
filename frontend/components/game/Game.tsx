"use client";

// X33: "Normal or not?". Seven rounds from Almatafi's own record (lib/game.ts builds the pool
// at build time), three embers for lives, a host whose mood follows the game. Keys 1–4 answer,
// Enter goes on. Sound is off until the player turns it on.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Brand from "@/components/Brand";
import { LIVES, pickGame, points, verdictLine, type Round } from "@/lib/game";
import type { Mood } from "@/lib/mascot";
import { play, say, setSoundOn, soundOn, subscribeSound } from "@/lib/sound";
import EmberField, { type EmberFieldHandle } from "./EmberField";
import Mascot, { EmberIcon } from "./Mascot";
import RevealViz from "./RevealViz";
import "./game.css";

type Phase = "intro" | "play" | "end";
type Result = { round: Round; right: boolean };

const SCENE: Record<string, string> = { "nile-delta": "/media/nile-delta.webp", "rio-negro": "/media/rio-negro.webp" };
const sceneOf = (r: Round | null) => (r?.region && SCENE[r.region]) || "/media/night-orbit.webp";

export default function Game({ pool, winScene = "/media/delta-high.webp", loseScene = "/media/nile-delta.webp" }:
  { pool: Round[]; winScene?: string; loseScene?: string }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [lives, setLives] = useState(LIVES);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [mood, setMood] = useState<Mood>("idle");
  const sound = useSyncExternalStore(subscribeSound, soundOn, () => false);
  const [shake, setShake] = useState(false);
  const embers = useRef<EmberFieldHandle>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);

  const round = phase === "play" ? rounds[i] : null;
  const out = lives === 0;

  const start = useCallback(() => {
    setRounds(pickGame(pool));
    setI(0); setPicked(null); setLives(LIVES); setScore(0); setStreak(0); setResults([]); setMood("idle");
    setPhase("play");
    play("tap"); say("game-intro");
  }, [pool]);

  const answer = useCallback((id: string, el?: HTMLElement | null) => {
    if (!round || picked) return;
    const right = id === round.answer;
    setPicked(id);
    setResults((rs) => [...rs, { round, right }]);
    if (right) {
      setScore((s) => s + points(streak));
      setStreak((s) => s + 1);
      setMood("happy");
      play("right"); say(Math.random() < 0.5 ? "right-1" : "right-2");
      const b = (el ?? card.current)?.getBoundingClientRect();
      if (b) embers.current?.burst(b.left + b.width / 2, b.top + b.height / 2);
    } else {
      const left = lives - 1;
      setLives(left);
      setStreak(0);
      setMood(left === 0 ? "out" : "sad");
      play("wrong"); say(left === 1 ? "last-ember" : Math.random() < 0.5 ? "wrong-1" : "wrong-2");
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShake(true); setTimeout(() => setShake(false), 500); }
    }
  }, [round, picked, streak, lives]);

  const next = useCallback(() => {
    if (!picked) return;
    if (out || i + 1 >= rounds.length) {
      setPhase("end");
      setMood(out ? "out" : "win");
      play(out ? "lose" : "win"); say(out ? "lose" : "win");
      return;
    }
    setI(i + 1); setPicked(null); setMood("idle"); play("tap");
  }, [picked, out, i, rounds.length]);

  // Focus "Next" once the answer is shown; keys 1–4 answer, Enter goes on.
  useEffect(() => { if (picked) nextBtn.current?.focus({ preventScroll: true }); }, [picked]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== "play" || !round || e.altKey || e.ctrlKey || e.metaKey) return;
      const k = Number(e.key);
      if (!picked && k >= 1 && k <= round.choices.length) {
        e.preventDefault();
        answer(round.choices[k - 1].id, document.querySelector<HTMLElement>(`[data-choice="${round.choices[k - 1].id}"]`));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, round, picked, answer]);

  function toggleSound() {
    const on = !sound;
    setSoundOn(on);
    if (on) play("tap");
  }

  const bg = phase === "end" ? (out ? loseScene : winScene) : sceneOf(round ?? pool[0] ?? null);
  const right = results.filter((r) => r.right).length;

  return (
    <div className="game" data-phase={phase}>
      <div className="game-bg" style={{ backgroundImage: `url(${bg})` }} aria-hidden="true" />
      <EmberField ref={embers} />
      <header className="game-top">
        <Brand size={22} />
        {phase === "play" && (
          <div className="game-hud" aria-label="Progress">
            <span className="hud-round">Round {i + 1} of {rounds.length}</span>
            <span className="hud-lives" role="img" aria-label={`${lives} of ${LIVES} embers left`}>
              {Array.from({ length: LIVES }, (_, k) => <EmberIcon key={k} lit={k < lives} />)}
            </span>
            <span className="hud-score" aria-live="polite">{score.toLocaleString("en-US")} pts</span>
          </div>
        )}
        <button type="button" className="game-sound" aria-pressed={sound} onClick={toggleSound}
                aria-label={sound ? "Sound on. Turn it off" : "Sound off. Turn it on"} title={sound ? "Sound on" : "Sound off"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
            {sound ? <><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></> : <path d="m16 9 5 6m0-6-5 6" />}
          </svg>
        </button>
      </header>

      <main className="game-main">
        {phase === "intro" && (
          <section className="game-intro">
            <Mascot mood="idle" size={140} />
            <h1 className="display">Normal <em>or not?</em></h1>
            <p className="game-lede">
              Seven questions on real NASA fire records. Can you tell a strange fire season from a normal one, and spot
              the trap that fools a raw satellite count?
            </p>
            <ul className="game-rules">
              <li><EmberIcon lit /> Three embers. A wrong answer puts one out.</li>
              <li><span className="rule-key">1–4</span> to answer, <span className="rule-key">Enter</span> for the next one.</li>
              <li><span className="rule-key">♪</span> Sound is off; the speaker button turns it on.</li>
            </ul>
            <button type="button" className="btn btn-fire big-btn game-start" onClick={start} autoFocus>Start</button>
          </section>
        )}

        {phase === "play" && round && (
          <section key={round.id} className={`game-card${shake ? " shake" : ""}`} ref={card} aria-labelledby="q">
            <div className="game-ask">
              <Mascot mood={mood} size={104} />
              <div className="bubble">
                <span className="bubble-place">{round.place}</span>
                <h1 id="q" className="bubble-q">{round.prompt}</h1>
                {round.context && <p className="bubble-ctx">{round.context}</p>}
              </div>
            </div>
            {round.hint && <RevealViz r={picked ? round.reveal : round.hint} answered={Boolean(picked)} />}
            <div className={`choices n${round.choices.length}`} role="group" aria-label="Answers">
              {round.choices.map((c, k) => {
                const state = !picked ? "" : c.id === round.answer ? " right" : c.id === picked ? " wrong" : " dim";
                return (
                  <button key={c.id} type="button" data-choice={c.id} className={`choice${state}`} disabled={Boolean(picked)}
                          onClick={(e) => answer(c.id, e.currentTarget)}>
                    <span className="choice-key" aria-hidden="true">{k + 1}</span>{c.label}
                  </button>
                );
              })}
            </div>
            {picked && (
              <div className="answer" role="status">
                <p className={`answer-flag ${picked === round.answer ? "ok" : "no"}`}>
                  {picked === round.answer ? `Right! +${points(Math.max(0, streak - 1))}` : out ? "Wrong, and that was your last ember." : "Not quite."}
                </p>
                {!round.hint && <RevealViz r={round.reveal} answered />}
                <p className="answer-text">{round.explain}</p>
                <div className="answer-row">
                  <button ref={nextBtn} type="button" className="btn btn-fire" onClick={next}>
                    {out || i + 1 >= rounds.length ? "See your result" : "Next question"}
                  </button>
                  {round.link && <Link className="answer-link" href={round.link}>See it in the calendar</Link>}
                </div>
              </div>
            )}
          </section>
        )}

        {phase === "end" && (
          <section className="game-end" aria-labelledby="end-h">
            <Mascot mood={out ? "out" : "win"} size={140} />
            <h1 id="end-h" className="display">{right} of {results.length} <em>right</em></h1>
            <p className="end-score">{score.toLocaleString("en-US")} points</p>
            <p className="game-lede">{verdictLine(right, results.length, out)}</p>
            <ol className="end-list">
              {results.map(({ round: r, right: ok }) => (
                <li key={r.id} className={ok ? "ok" : "no"}>
                  <span className="end-mark" aria-label={ok ? "right" : "wrong"}>{ok ? "✓" : "✗"}</span>
                  <span className="end-q"><b>{r.place}</b> · {r.prompt}</span>
                  {r.link && <Link href={r.link}>Open</Link>}
                </li>
              ))}
            </ol>
            <div className="end-row">
              <button type="button" className="btn btn-fire big-btn" onClick={start}>Play again</button>
              <Link className="btn btn-glass big-btn" href="/explore">Open the calendar</Link>
            </div>
            <p className="end-note">Every number comes from NASA FIRMS fire data, harmonized by Almatafi.</p>
          </section>
        )}
      </main>
    </div>
  );
}
