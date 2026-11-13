"use client";

// X33: "Normal or not?" in five chapters. A level map (stars kept on this device), an
// illustrated intro per chapter, then its questions on the stage (components/game/Stage.tsx),
// an explanation after each answer, and the chapter's stars at the end.

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Brand from "@/components/Brand";
import { points, stars, type Chapter } from "@/lib/game";
import { play, say, setSoundOn, soundOn, subscribeSound } from "@/lib/sound";
import Illus from "./Illus";
import { Backdrop, Sky } from "./Scene";
import Sprite, { preload, type Sheets } from "./Sprite";
import Stage from "./Stage";
import "./game.css";

type Screen = "map" | "intro" | "play" | "end";
const KEY = "almatafi-game-stars";

function loadStars(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; }
}
function saveStars(s: Record<string, number>) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not remembered */ }
}

export type Plate = { wide: boolean; tall: boolean };

export default function Game({ chapters, sheets, plate = null }: { chapters: Chapter[]; sheets: Sheets; plate?: Plate | null }) {
  const [screen, setScreen] = useState<Screen>("map");
  const [ci, setCi] = useState(0);
  const [ri, setRi] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [explain, setExplain] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState<Record<string, number>>({});
  const sound = useSyncExternalStore(subscribeSound, soundOn, () => false);

  useEffect(() => { const t = setTimeout(() => setBest(loadStars()), 0); return () => clearTimeout(t); }, []);
  useEffect(() => preload(sheets), [sheets]);   // every sheet is fetched once, before the first question

  const chapter = chapters[ci];
  const round = chapter?.rounds[ri];
  const done = Object.keys(best).filter((k) => chapters.some((c) => c.id === k)).length;
  const nextUp = chapters.findIndex((c) => !(c.id in best));
  const totalStars = chapters.reduce((a, c) => a + (best[c.id] ?? 0), 0);

  const open = (i: number) => { setCi(i); setScreen("intro"); play("tap"); };
  const start = () => { setRi(0); setResults([]); setExplain(false); setScreen("play"); play("tap"); if (ci === 0) say("game-intro"); };

  const onResult = useCallback((_: string, right: boolean) => {
    setResults((r) => [...r, right]);
    if (right) { setScore((s) => s + points(streak)); setStreak((s) => s + 1); } else setStreak(0);
  }, [streak]);

  const next = useCallback(() => {
    if (!explain) return;
    if (ri + 1 < chapter.rounds.length) { setRi(ri + 1); setExplain(false); play("tap"); return; }
    const got = stars(results.filter(Boolean).length, chapter.rounds.length);
    const nb = { ...best, [chapter.id]: Math.max(best[chapter.id] ?? 0, got) };
    setBest(nb); saveStars(nb);
    setScreen("end");
    play(got >= 2 ? "win" : "lose"); say(got >= 2 ? "win" : "lose");
  }, [explain, ri, chapter, results, best]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.altKey || e.ctrlKey || e.metaKey) return;
      if (screen === "play" && explain) { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, explain, next]);

  const right = results.filter(Boolean).length;
  const got = chapter ? stars(right, chapter.rounds.length) : 0;

  return (
    <div className="game" data-screen={screen}>
      {plate ? <Backdrop tall={plate.tall} /> : <Sky />}
      <header className="game-top">
        <Brand size={22} />
        <nav className="game-links" aria-label="Site">
          <Link href="/explore">Explorer</Link>
          <Link href="/method">Method</Link>
        </nav>
        {screen === "play" && chapter && (
          <div className="game-hud" aria-label="Progress">
            <span className="hud-chapter">Chapter {ci + 1} · {chapter.title}</span>
            <span className="hud-dots" aria-label={`Question ${ri + 1} of ${chapter.rounds.length}`}>
              {chapter.rounds.map((_, k) => <i key={k} className={k < results.length ? (results[k] ? "ok" : "no") : k === ri ? "now" : ""} />)}
            </span>
            <span className="hud-score" aria-live="polite">{score.toLocaleString("en-US")} pts</span>
          </div>
        )}
        {screen !== "map" && (
          <button type="button" className="chip-btn game-mapbtn" onClick={() => setScreen("map")}>Chapters</button>
        )}
        <button type="button" className="game-sound" aria-pressed={sound} onClick={() => { setSoundOn(!sound); if (!sound) play("tap"); }}
                aria-label={sound ? "Sound on. Turn it off" : "Sound off. Turn it on"} title={sound ? "Sound on" : "Sound off"}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
            {sound ? <><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></> : <path d="m16 9 5 6m0-6-5 6" />}
          </svg>
        </button>
      </header>

      <main className="game-main">
        {screen === "map" && (
          <section className="levels" aria-labelledby="levels-h">
            <div className="levels-head">
              <div className="levels-host"><Sprite sheet={sheets["host-idle"]} height={150} run="idle" loop label="Your host" /></div>
              <div className="levels-copy">
                <p className="eyebrow">A game on real NASA fire data</p>
                <h1 id="levels-h" className="display">Normal <em>or not?</em></h1>
                <p className="game-lede">Five short chapters, two answers every time. Learn what a satellite fire record can and can&apos;t
                  tell you, then read one like an analyst.</p>
                <p className="levels-progress">{done} of {chapters.length} chapters · {totalStars} of {chapters.length * 3} stars</p>
              </div>
            </div>
            <ol className="level-path">
              {chapters.map((c, i) => {
                const st = best[c.id];
                const state = st !== undefined ? "done" : i === nextUp ? "next" : "open";
                return (
                  <li key={c.id} className={`level ${state}`}>
                    <button type="button" onClick={() => open(i)} autoFocus={i === nextUp}
                            aria-label={`Chapter ${i + 1}: ${c.title}. ${st !== undefined ? `${st} of 3 stars` : state === "next" ? "Up next" : "Not played yet"}`}>
                      <span className="level-art"><Illus name={c.illus} /></span>
                      <span className="level-n">Chapter {i + 1}</span>
                      <span className="level-title">{c.title}</span>
                      <span className="level-tag">{c.tagline}</span>
                      <span className="level-stars" aria-hidden="true">{[0, 1, 2].map((k) => <i key={k} className={st !== undefined && k < st ? "on" : ""}>★</i>)}</span>
                      {state === "next" && <span className="level-badge">Start here</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {screen === "intro" && chapter && (
          <section className="intro" aria-labelledby="intro-h">
            <div className="intro-art"><Illus name={chapter.illus} /></div>
            <div className="intro-text">
              <p className="eyebrow">Chapter {ci + 1} of {chapters.length}</p>
              <h1 id="intro-h" className="display">{chapter.title}</h1>
              <ol className="intro-steps">{chapter.intro.map((l, k) => <li key={k}><span>{k + 1}</span>{l}</li>)}</ol>
              <p className="intro-how">{chapter.rounds.length} questions. Pick a block and Khalid jumps to it.</p>
              <div className="intro-row">
                <button type="button" className="btn btn-fire big-btn" onClick={start} autoFocus>Start chapter</button>
                <button type="button" className="btn btn-glass big-btn" onClick={() => setScreen("map")}>All chapters</button>
              </div>
            </div>
          </section>
        )}

        {screen === "play" && round && (
          <>
            <Stage key={`${chapter.id}-${round.id}`} round={round} sheets={sheets} index={ri + 1} total={chapter.rounds.length} plate={!!plate}
                   onResult={onResult} onSettled={() => setExplain(true)}
                   explain={explain && (
                     <div className={`explain ${results[ri] ? "ok" : "no"}`} role="status">
                       <p className="explain-text">
                         <b className="explain-flag">{results[ri] ? `Right! +${points(Math.max(0, streak - 1))}` : "Not quite."}</b>{" "}
                         {round.explain}
                         {round.link && <>{" "}<Link className="explain-link" href={round.link}>See it in the calendar →</Link></>}
                       </p>
                       <button type="button" className="btn btn-fire" onClick={next} autoFocus>
                         {ri + 1 < chapter.rounds.length ? "Next question" : "Finish the chapter"}
                       </button>
                     </div>
                   )} />
          </>
        )}

        {screen === "end" && chapter && (
          <section className="chapter-end" aria-labelledby="end-h">
            <Sprite sheet={got >= 2 ? sheets["host-right"] : sheets["host-idle"]} height={(got >= 2 ? sheets["host-right"] : sheets["host-idle"]).frameH * (150 / sheets["host-idle"].frameH)}
                    run="end" loop label="Your host" />
            <p className="eyebrow">Chapter {ci + 1} done</p>
            <h1 id="end-h" className="display">{right} of {chapter.rounds.length} <em>right</em></h1>
            <p className="end-stars" aria-label={`${got} of 3 stars`}>{[0, 1, 2].map((k) => <i key={k} className={k < got ? "on" : ""}>★</i>)}</p>
            <p className="end-learned"><b>What you learned:</b> {chapter.learned}</p>
            <div className="end-row">
              {ci + 1 < chapters.length ? (
                <button type="button" className="btn btn-fire big-btn" onClick={() => open(ci + 1)} autoFocus>Chapter {ci + 2}: {chapters[ci + 1].title}</button>
              ) : (
                <Link className="btn btn-fire big-btn" href="/explore">Now read your own place</Link>
              )}
              <button type="button" className="btn btn-glass big-btn" onClick={() => setScreen("map")}>All chapters</button>
              {right < chapter.rounds.length && <button type="button" className="btn btn-glass big-btn" onClick={start}>Try again</button>}
            </div>
            <p className="end-note">Every number comes from NASA FIRMS fire data, harmonized by Almatafi.</p>
          </section>
        )}
      </main>
    </div>
  );
}
