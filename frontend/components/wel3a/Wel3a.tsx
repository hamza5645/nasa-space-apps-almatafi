"use client";

// Wel3a (ولعة, "a little flame"): the guide in the corner of every page. It pops up with the
// page's important point or a fun fact (lib/wel3a.ts, no AI), and opens into a small chat
// whose typed questions go to /api/wel3a (worker/index.ts, Workers AI). When that function
// can't answer (offline, `next dev`, the daily allowance used up) the tips still work.

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStats } from "@/lib/queries";
import { useSelection } from "@/lib/store";
import { ASK, FACTS, contextLines, highlights, pageOf } from "@/lib/wel3a";
import { LIMITS, type Turn } from "@/lib/wel3a-chat";
import Flame, { type Mood } from "./Flame";
import "./wel3a.css";

const QUIET_KEY = "wel3a-quiet";
const BUBBLE_MS = 12_000;
const DOWN = "I can't reach my AI brain right now. My tips still work: try “Another fact”.";

function storedQuiet(): boolean {
  try { return localStorage.getItem(QUIET_KEY) === "1"; } catch { return false; }
}

export default function Wel3a() {
  const page = pageOf(usePathname());
  const onExplore = page === "explore";
  const { aoi, aoiLabel, month, view, metric, clouds } = useSelection();
  // The same query the explorer runs, so this reads its cached answer.
  const stats = useStats(aoi, onExplore ? month : null, view, metric, clouds).data;

  // What Wel3a is talking about: the page, or in the explorer the selected month once its
  // numbers are in. A new subject starts again from the most important point and pops up.
  const points = onExplore && stats ? highlights(stats, { label: aoiLabel, view, metric }) : null;
  const head = onExplore ? points?.join("|") : page;
  const [subject, setSubject] = useState({ head: page as string, points: [] as string[], i: 0, bubble: true });
  if (head !== undefined && head !== subject.head) setSubject({ head, points: points ?? [], i: 0, bubble: true });
  const tips = [...subject.points, ...FACTS[page]];
  const tip = tips[subject.i % tips.length];

  const [ready, setReady] = useState(false);   // a moment after load, so it doesn't pop over the first paint
  const [quiet, setQuiet] = useState(false);
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Mood>("idle");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const flameRef = useRef<HTMLButtonElement>(null);

  const react = (mood: Mood) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash(mood);
    flashTimer.current = setTimeout(() => setFlash("idle"), 2400);
  };

  useEffect(() => {
    const t = setTimeout(() => { setQuiet(storedQuiet()); setReady(true); }, 1500);
    return () => { clearTimeout(t); if (flashTimer.current) clearTimeout(flashTimer.current); };
  }, []);

  const bubble = ready && !open && !quiet && subject.bubble && page !== "play";
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setSubject((s) => ({ ...s, bubble: false })), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [bubble, subject.head]);

  useEffect(() => {
    if (!open) return;
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); flameRef.current?.focus(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log, pending, error, open]);

  const ask = async (text: string) => {
    const question = text.trim().slice(0, LIMITS.question);
    if (!question || pending) return;
    const history = log;
    setLog([...history, { role: "user", content: question }]);
    setInput(""); setError(null); setPending(true);
    let answer: string | null = null, why = DOWN;
    try {
      const r = await fetch("/api/wel3a", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history, context: contextLines(page, tip, subject.points, stats?.meta.data_version) }),
      });
      const data = await r.json().catch(() => null) as { answer?: unknown; error?: unknown } | null;
      if (r.ok && typeof data?.answer === "string") answer = data.answer;
      else if (r.status === 429 && typeof data?.error === "string") why = data.error;
    } catch { /* offline: `why` already says so */ }
    setPending(false);
    if (answer) {
      setLog([...history, { role: "user", content: question }, { role: "assistant", content: answer }]);
      react("happy");
    } else {
      // Give the question back, so it can be sent again, and keep the failure out of the chat.
      setLog(history); setInput(question); setError(why);
    }
  };

  const toggleQuiet = () => {
    const next = !quiet;
    setQuiet(next);
    try { if (next) localStorage.setItem(QUIET_KEY, "1"); else localStorage.removeItem(QUIET_KEY); } catch { /* private mode */ }
  };

  const mood: Mood = pending ? "think" : flash !== "idle" ? flash : bubble ? "talk" : "idle";
  return (
    // Keys typed here stay here: the game listens on the window for 1, 2, the arrows and Enter.
    <aside className="wel3a" data-page={page} aria-label="Wel3a, the fire guide" onKeyDown={(e) => e.stopPropagation()}>
      {open && (
        <div className="w3-panel" role="dialog" aria-label="Chat with Wel3a" data-lenis-prevent>
          <header className="w3-head">
            <div>
              <strong>Wel3a <span lang="ar" dir="rtl">ولعة</span></strong>
              <span>Your fire guide. Ask me anything.</span>
            </div>
            <button type="button" className="w3-x" aria-label="Close the chat" onClick={() => { setOpen(false); flameRef.current?.focus(); }}>×</button>
          </header>

          <div className="w3-log" ref={logRef} aria-live="polite">
            <p className="w3-msg w3-bot">{tip}</p>
            <button type="button" className="w3-more" onClick={() => { setSubject((s) => ({ ...s, i: s.i + 1 })); react("talk"); }}>Another fact</button>
            {log.map((t, k) => <p key={k} dir="auto" className={`w3-msg ${t.role === "user" ? "w3-me" : "w3-bot"}`}>{t.content}</p>)}
            {pending && <p className="w3-msg w3-bot w3-dots" aria-label="Wel3a is thinking"><i /><i /><i /></p>}
            {error && <p className="w3-msg w3-bot w3-err">{error}</p>}
          </div>

          {log.length === 0 && !pending && (
            <div className="w3-ask">
              {ASK[page].map((q) => <button key={q} type="button" onClick={() => ask(q)}>{q}</button>)}
            </div>
          )}

          <form className="w3-form" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input ref={inputRef} dir="auto" value={input} onChange={(e) => setInput(e.target.value)} maxLength={LIMITS.question}
                   placeholder="Ask about fires from space" aria-label="Your question for Wel3a" enterKeyHint="send" />
            <button type="submit" disabled={pending || !input.trim()} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 9h13M10 4l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>

          <footer className="w3-foot">
            <span>AI answers can be wrong. Trust the numbers on the page.</span>
            {page !== "play" && (
              <label><input type="checkbox" checked={!quiet} onChange={toggleQuiet} /> Pop-up tips</label>
            )}
          </footer>
        </div>
      )}

      {bubble && (
        <div className="w3-bubble">
          <button type="button" className="w3-bubble-text" onClick={() => setOpen(true)}>{tip}</button>
          <button type="button" className="w3-x" aria-label="Hide this tip" onClick={() => setSubject((s) => ({ ...s, bubble: false }))}>×</button>
        </div>
      )}

      <button ref={flameRef} type="button" className="w3-flame" aria-expanded={open}
              aria-label={open ? "Close Wel3a's chat" : "Ask Wel3a, the fire guide"} onClick={() => setOpen((o) => !o)}>
        <Flame mood={mood} />
      </button>
    </aside>
  );
}
