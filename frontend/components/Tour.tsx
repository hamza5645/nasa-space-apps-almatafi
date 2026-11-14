"use client";

// X34: the explorer's guided tour. A dark overlay with a cut-out around the current target
// (an element with data-tour="<id>"), a card beside it, Back / Next / Skip, arrow keys and
// Escape. Starts by itself on a first visit (remembered on this device); the "Tour" button
// replays it. Steps live in lib/tour.ts. X43: the same overlay runs any list of steps under
// its own storage key (the landing's narration stepper, NARRATE_STEPS).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { STEPS, TOUR_KEY, place, type Placement, type Rect, type Step } from "@/lib/tour";
import "./tour.css";

type Props = { open: boolean; onClose: () => void; steps?: Step[]; storageKey?: string };

function seen(key: string): boolean {
  try { return localStorage.getItem(key) === "done"; } catch { return true; }
}
function markSeen(key: string) {
  try { localStorage.setItem(key, "done"); } catch { /* not remembered */ }
}

/** Opens the tour on a first visit, once the page has rendered (`ready`), after `delay` ms. */
export function useFirstVisitTour(ready: boolean, key = TOUR_KEY, delay = 900) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || seen(key)) return;
    const t = setTimeout(() => setOpen(true), delay);
    return () => clearTimeout(t);
  }, [ready, key, delay]);
  return [open, setOpen] as const;
}

export default function Tour({ open, onClose, steps = STEPS, storageKey = TOUR_KEY }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<Placement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[i];

  const close = useCallback(() => { markSeen(storageKey); onClose(); setI(0); }, [onClose, storageKey]);

  // Find the target, scroll it into view, measure it and place the card.
  useLayoutEffect(() => {
    if (!open) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`);
    if (!el) { const t = setTimeout(() => (i + 1 < steps.length ? setI(i + 1) : close()), 0); return () => clearTimeout(t); }
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    let raf = 0;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const pad = 8;
      const target = { top: r.top - pad, left: r.left - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
      setRect(target);
      const c = card.current?.getBoundingClientRect();
      setPos(place(target, { width: c?.width ?? 340, height: c?.height ?? 180 }, { w: window.innerWidth, h: window.innerHeight }, step.side));
    };
    // The smooth scroll takes a moment; keep measuring until it settles.
    const t0 = performance.now();
    const tick = () => { measure(); if (performance.now() - t0 < 700) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); window.removeEventListener("scroll", onResize); };
  }, [open, i, step, steps.length, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (i + 1 < steps.length) setI(i + 1); else close(); }
      if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); setI(i - 1); }
    };
    window.addEventListener("keydown", onKey);
    card.current?.querySelector<HTMLButtonElement>(".tour-next")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, i, steps.length, close]);

  if (!open) return null;
  const last = i + 1 === steps.length;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect && <div className="tour-hole" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} onClick={close} />}
      <div ref={card} className={`tour-card side-${pos?.side ?? "bottom"}`} style={pos ? { top: pos.top, left: pos.left } : { top: 80, left: 16 }}>
        <div className="tour-head">
          <span className="tour-count">{i + 1} / {steps.length}</span>
          <button type="button" className="tour-skip" onClick={close}>Skip</button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-row">
          <button type="button" className="chip-btn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>Back</button>
          <button type="button" className="btn btn-fire tour-next" onClick={() => (last ? close() : setI(i + 1))}>{last ? "Done" : "Next"}</button>
          <span className="tour-dots" aria-hidden="true">{steps.map((s, k) => <i key={k} className={k === i ? "on" : k < i ? "done" : ""} />)}</span>
        </div>
      </div>
    </div>
  );
}
