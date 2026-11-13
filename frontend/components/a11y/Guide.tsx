"use client";

// X37: the guide. A stepper that opens the first time the mode is turned on (and from the
// panel's "Open the guide"): six steps, each with the controls it explains, spoken aloud when
// voice reading is on. Back / Next / Skip, arrow keys, Escape; focus comes back where it was.

import { useCallback, useEffect, useRef, useState } from "react";
import { GUIDE, SHORTCUTS } from "@/lib/a11y";
import { SettingSwitch, TextSizeControl } from "./Controls";
import { speak, stopSpeech } from "./runtime";

type Props = { step?: number; paused?: boolean; onClose: () => void; onReadPage: () => void; onListen: (() => void) | null; onMotion: (step: number) => void };

export default function Guide({ step: start = 0, paused = false, onClose, onReadPage, onListen, onMotion }: Props) {
  const [i, setI] = useState(start);
  const next = useRef<HTMLButtonElement>(null);
  // Mounted only while open, so the element that had focus is the one that opened it.
  const [opener] = useState<HTMLElement | null>(() => (typeof document === "undefined" ? null : document.activeElement as HTMLElement | null));
  const step = GUIDE[i];
  const last = i + 1 === GUIDE.length;

  const close = useCallback(() => { stopSpeech(); onClose(); opener?.focus(); }, [onClose, opener]);

  // The explorer's tour opens by itself on a first visit; two overlays at once would be a mess, so
  // it's skipped here and offered again on the last step (its Tour button stays).
  const [tourBtn] = useState<HTMLElement | null>(() => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".tour-btn")));
  useEffect(() => { document.querySelector<HTMLElement>(".tour .tour-skip")?.click(); }, []);

  // Focus first, then speak, so the step's words win over "Next, button". While the shortcut
  // list is open over the guide (paused) the keys and the focus are its own; they come back after.
  useEffect(() => {
    if (paused) return;
    next.current?.focus();
    const t = setTimeout(() => speak(`${step.speak} Step ${i + 1} of ${GUIDE.length}.`), 80);
    return () => clearTimeout(t);
  }, [i, step, paused]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused || e.altKey || e.ctrlKey || e.metaKey) return;
      const inField = (e.target as HTMLElement).matches("input, select, textarea");
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === "ArrowRight" && !inField) { e.preventDefault(); e.stopPropagation(); if (!last) setI(i + 1); else close(); }
      else if (e.key === "ArrowLeft" && !inField && i > 0) { e.preventDefault(); e.stopPropagation(); setI(i - 1); }
      else if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON" && !inField) { e.preventDefault(); e.stopPropagation(); if (!last) setI(i + 1); else close(); }
      else if (e.key === "Enter") e.stopPropagation();   // the button handles it; the explorer's tour must not also step
      else if (e.key === "Tab") {
        // Keep Tab inside the dialog.
        const f = Array.from(document.querySelectorAll<HTMLElement>(".a11y-guide button:not(:disabled), .a11y-guide a[href], .a11y-guide [tabindex='0']"));
        if (!f.length) return;
        const first = f[0], end = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
        else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
      }
    };
    // Capture phase: the explorer's tour and the calendar listen for the same keys on window.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [i, last, close, paused]);

  return (
    <div className="a11y-scrim" onClick={close}>
      <div className="a11y-guide" role="dialog" aria-modal="true" aria-labelledby="a11y-guide-title" onClick={(e) => e.stopPropagation()}>
        <div className="a11y-guide-head">
          <span className="a11y-count">Step {i + 1} of {GUIDE.length}</span>
          <button type="button" className="a11y-skip" onClick={close}>Skip the guide</button>
        </div>
        <ol className="a11y-steps" aria-label="Steps">
          {GUIDE.map((g, k) => <li key={g.id} className={k === i ? "on" : k < i ? "done" : ""} aria-current={k === i ? "step" : undefined}><span>{k + 1}</span></li>)}
        </ol>
        <h2 id="a11y-guide-title">{step.title}</h2>
        <p>{step.text}</p>
        {step.id === "done" && tourBtn && (
          <div className="a11y-try">
            <div className="a11y-actions">
              <span className="a11y-hint">This page also has its own tour of the area, calendar and map.</span>
              <button type="button" className="chip-btn" onClick={() => { close(); setTimeout(() => tourBtn.click(), 50); }}>Start the explorer tour</button>
            </div>
          </div>
        )}
        {step.id !== "welcome" && step.id !== "done" && <div className="a11y-try">
          {step.id === "text" && <TextSizeControl />}
          {step.id === "contrast" && <>
            <SettingSwitch k="contrast" label="High contrast" hint="Black and white, thick outlines, underlined links" />
            <SettingSwitch k="motion" label="Reduce motion" hint="Still images instead of the globe, films and transitions" onAfter={() => onMotion(i)} />
          </>}
          {step.id === "keyboard" && (
            <dl className="a11y-keys">
              {SHORTCUTS.slice(0, 6).map((s) => <div key={s.keys}><dt><kbd>{s.keys}</kbd></dt><dd>{s.does}</dd></div>)}
            </dl>
          )}
          {step.id === "voice" && <>
            <SettingSwitch k="voice" label="Voice reading" hint="Says what you focus on and reads the answer" />
            <div className="a11y-actions">
              <button type="button" className="chip-btn" onClick={onReadPage}>Read this page</button>
              {onListen ? <button type="button" className="chip-btn" onClick={onListen}>🎤 Say a command</button>
                        : <span className="a11y-hint">Voice commands need Chrome, Edge or Safari.</span>}
            </div>
          </>}
        </div>}
        <div className="a11y-guide-row">
          <button type="button" className="chip-btn" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>Back</button>
          <button ref={next} type="button" className="btn btn-fire a11y-next" onClick={() => (last ? close() : setI(i + 1))}>{last ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
