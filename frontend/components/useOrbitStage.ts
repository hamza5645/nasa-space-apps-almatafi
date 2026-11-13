"use client";

// Shared mechanics of a sticky orbit stage with chapters scrolling over it (landing story,
// Method header): creates the WebGL scene, reads the story position from the chapters, fades
// the chapter text around the middle of the screen, and pauses the scene off screen.
// The section's data-mode becomes "live" once the globe drew, or "static" without WebGL or
// with reduced motion (the CSS then shows a still image). The still also shows while a slow
// connection is still bringing the globe's maps (X27: the live site showed an empty black
// stage there), and stays if the globe never comes; a globe that arrives later takes over.

import { useEffect, type RefObject } from "react";
import type { OrbitScene, Preset } from "@/lib/orbit/scene";
import { reducedMotion } from "@/lib/motion";

export type StageTick = (p: number, onStage: boolean) => { pause?: boolean } | void;

const clamp = (x: number) => Math.min(1, Math.max(0, x));
// How long the stage may stay empty before the still image fills in for the globe.
const STILL_AFTER_MS = 6000;

export function useOrbitStage(root: RefObject<HTMLElement | null>, canvas: RefObject<HTMLCanvasElement | null>,
  preset: Preset, maxP: number, onTick?: StageTick) {
  useEffect(() => {
    const section = root.current!, gl = canvas.current!;
    const setMode = (m: "live" | "static") => section.setAttribute("data-mode", m);
    const still = reducedMotion();
    const chapters = Array.from(section.querySelectorAll<HTMLElement>("[data-ch]"));
    let scene: OrbitScene | null = null, gone = false, raf = 0;
    // Last frame's inputs and outputs: a frame where nothing moved does no work, and only changed styles are written.
    let key = "", pStr = "", off: boolean | null = null;
    const looks = chapters.map(() => "");

    let slow = 0;
    if (still || !webglOk()) setMode("static");
    else {
      slow = window.setTimeout(() => { if (!gone && section.getAttribute("data-mode") !== "live") setMode("static"); }, STILL_AFTER_MS);
      import("@/lib/orbit/scene").then(({ createOrbitScene }) => {
        if (gone) return;
        try {
          scene = createOrbitScene(gl, preset);
          key = ""; // the new scene needs its progress and active state on the next frame
          scene.ready.then(() => { if (!gone) { clearTimeout(slow); setMode("live"); } });
        } catch { setMode("static"); }
      }).catch(() => { if (!gone) setMode("static"); }); // the scene's code didn't load
    }

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const vh = window.innerHeight, mid = vh * 0.5, rect = section.getBoundingClientRect();
      const onStage = rect.bottom > 0 && rect.top < vh;
      // Asleep only while the transition's smoke fully covers the page, not while it thickens or clears.
      const covered = document.documentElement.classList.contains("warp-covered");
      // Same scroll, viewport and warp as last frame, or still off screen: nothing to do (off screen this rect is all).
      const k = onStage ? `${rect.top}|${rect.height}|${vh}|${window.innerWidth}|${covered}` : "off";
      if (k === key) return;
      key = k;
      // Read every rect before any write, so the writes don't force a style recalc per chapter.
      const rs = chapters.map((el) => el.getBoundingClientRect());
      // p = i + how far chapter i's middle has passed the screen's middle, in chapter heights.
      let p = 0;
      rs.forEach((r, i) => { if (r.top <= mid) p = i + (mid - r.top) / r.height - 0.5; });
      p = Math.max(0, p);
      const res = onTick?.(p, onStage);
      // The scene sleeps off screen, when the caller asks, and under the smoke of a page transition.
      scene?.setActive(onStage && !covered && !(res && res.pause));
      scene?.setProgress(Math.min(maxP, p));
      if (!still && onStage) {
        rs.forEach((r, i) => {
          const c = (r.top + r.height / 2 - mid) / (vh * 0.62);
          const a = clamp(1.25 - Math.abs(c) * 1.15).toFixed(3), y = (c * -26).toFixed(1), look = `${a}|${y}`;
          const inner = chapters[i].firstElementChild as HTMLElement | null;
          // Opacity and lift only: a blur filter on the glass panels (backdrop-filter over WebGL) is very costly.
          if (inner && looks[i] !== look) { looks[i] = look; inner.style.opacity = a; inner.style.transform = `translate3d(0, ${y}px, 0)`; }
        });
      }
      const ps = p.toFixed(3);
      if (ps !== pStr) { pStr = ps; section.style.setProperty("--p", ps); }
      // Lets the CSS stop the stage's grain animation off screen.
      if (off !== !onStage) { off = !onStage; section.toggleAttribute("data-offstage", off); }
    };
    raf = requestAnimationFrame(tick);
    return () => { gone = true; clearTimeout(slow); cancelAnimationFrame(raf); scene?.dispose(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

function webglOk() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch { return false; }
}
