"use client";

// X36: the landing page's narration. A speaker button (off by default, remembered on this
// device); when it's on, each chapter plays its recorded line as it comes into view, with the
// words as a caption at the bottom of the screen. Leaving the page stops the voice.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NARRATION, chapterInView } from "@/lib/narration";
import { say, setSoundOn, soundOn, stopVoice, subscribeSound } from "@/lib/sound";

export default function Narration() {
  const on = useSyncExternalStore(subscribeSound, soundOn, () => false);
  const [caption, setCaption] = useState<string | null>(null);
  const current = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!on) { stopVoice(); current.current = -1; return; }   // the caption only renders while on
    const chapters = Array.from(document.querySelectorAll<HTMLElement>("[data-ch]"));
    let raf = 0;
    const check = () => {
      raf = 0;
      const i = chapterInView(chapters.map((el) => el.getBoundingClientRect()), window.innerHeight);
      if (i === current.current) return;
      current.current = i;
      const line = NARRATION.find((n) => n.chapter === i);
      if (!line) return;
      say(line.id);
      setCaption(line.text);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCaption(null), 7000);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); if (timer.current) clearTimeout(timer.current); stopVoice(); };
  }, [on]);

  return (
    <>
      <button type="button" className="narrate" aria-pressed={on} onClick={() => setSoundOn(!on)}
              title={on ? "Narration on" : "Narration: hear the story"} aria-label={on ? "Narration on. Turn it off" : "Narration off. Turn it on"}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" stroke="none" />
          {on ? <><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a8 8 0 0 1 0 11" /></> : <path d="m16 9 5 6m0-6-5 6" />}
        </svg>
        <span>{on ? "Narration on" : "Hear the story"}</span>
      </button>
      {on && caption && <p className="caption" role="status">{caption}</p>}
    </>
  );
}
