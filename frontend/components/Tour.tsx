"use client";

// X34: the explorer's guided tour. A dark overlay with a cut-out around the current target
// (an element with data-tour="<id>"), a card beside it, Back / Next / Skip, arrow keys and
// Escape. Starts by itself on a first visit (remembered on this device); the "Tour" button
// replays it. Steps live in lib/tour.ts.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { STEPS, TOUR_KEY, place, type Placement, type Rect } from "@/lib/tour";
import "./tour.css";

type Props = { open: boolean; onClose: () => void };

function seen(): boolean {
  try { return localStorage.getItem(TOUR_KEY) === "done"; } catch { return true; }
}
function markSeen() {
  try { localStorage.setItem(TOUR_KEY, "done"); } catch { /* not remembered */ }
}

/** Opens the tour on a first visit, once the explorer has rendered. */
export function useFirstVisitTour(ready: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready || seen()) return;
    const t = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(t);
  }, [ready]);
  return [open, setOpen] as const;
}

export default function Tour({ open, onClose }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<Placement | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const step = STEPS[i];

  const close = useCallback(() => { markSeen(); onClose(); setI(0); }, [onClose]);

  // Find the target, scroll it into view, measure it and place the card.
  useLayoutEffect(() => {
    if (!open) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`);
    if (!el) { const t = setTimeout(() => (i + 1 < STEPS.length ? setI(i + 1) : close()), 0); return () => clearTimeout(t); }
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
  }, [open, i, step, close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); if (i + 1 < STEPS.length) setI(i + 1); else close(); }
      if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); setI(i - 1); }
    };
    window.addEventListener("keydown", onKey);
    card.current?.querySelector<HTMLButtonElement>(".tour-next")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, i, close]);

  if (!open) return null;
  const last = i + 1 === STEPS.length;
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {rect && <div className="tour-hole" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} onClick={close} />}
      <div ref={card} className={`tour-card side-${pos?.side ?? "bottom"}`} style={pos ? { top: pos.top, left: pos.left } : { top: 80, left: 16 }}>
        <div className="tour-head">
          <span className="tour-count">{i + 1} / {STEPS.length}</span>
          <button type="button" className="tour-skip" onClick={close}>Skip</button>
        </div>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-row">
          <button type="button" className="chip-btn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>Back</button>
          <button type="button" className="btn btn-fire tour-next" onClick={() => (last ? close() : setI(i + 1))}>{last ? "Done" : "Next"}</button>
          <span className="tour-dots" aria-hidden="true">{STEPS.map((s, k) => <i key={s.id} className={k === i ? "on" : k < i ? "done" : ""} />)}</span>
        </div>
      </div>
    </div>
  );
}
