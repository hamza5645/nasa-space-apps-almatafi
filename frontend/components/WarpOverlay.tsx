"use client";

// The transition behind WarpLink. In: the smoke film plays forward from the click point,
// thickening to an opaque amber cloud while the page behind pushes in. Then the route
// changes, and out: the cloud thins and lifts off the new page.

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { drawSequence, frameUrls, loadSequence, type Sequence } from "@/lib/orbit/sequence";
import { WARP_EVENT } from "./WarpLink";

const IN_MS = 820, OUT_MS = 900;
// Frames 1–31 of the smoke flight are the thick part of the cloud.
const URLS = frameUrls("/media/smoke", 61).slice(0, 31).filter((_, i) => i % 2 === 0);

export default function WarpOverlay() {
  const router = useRouter();
  const pathname = usePathname();
  const canvas = useRef<HTMLCanvasElement>(null);
  const seq = useRef<Sequence | null>(null);
  const state = useRef<{ phase: "idle" | "in" | "hold" | "out"; t0: number; x: number; y: number }>({ phase: "idle", t0: 0, x: 0.5, y: 0.5 });
  const [on, setOn] = useState(false);

  // Preload the frames once the page is idle.
  useEffect(() => {
    const id = window.setTimeout(() => { seq.current ??= loadSequence(URLS); }, 2500);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const start = (e: Event) => {
      const { href, x, y } = (e as CustomEvent<{ href: string; x: number; y: number }>).detail;
      seq.current ??= loadSequence(URLS);
      const s = state.current;
      if (s.phase !== "idle") return;
      router.prefetch(href);
      Object.assign(s, { phase: "in", t0: performance.now(), x: x / window.innerWidth, y: y / window.innerHeight });
      setOn(true);
      // warp-in: the page being left pushes in under the thickening smoke (globals.css).
      document.documentElement.classList.add("warping", "warp-in");
      window.setTimeout(() => {
        // warp-covered: the smoke is opaque now, so the scenes underneath may stop drawing.
        s.phase = "hold";
        document.documentElement.classList.remove("warp-in");
        document.documentElement.classList.add("warp-covered");
        router.push(href);
        // Same pathname (only the query changes): clear right away.
        if (href.split("?")[0] === window.location.pathname) { s.phase = "out"; s.t0 = performance.now(); document.documentElement.classList.remove("warp-covered"); }
      }, IN_MS);
    };
    window.addEventListener(WARP_EVENT, start);
    return () => window.removeEventListener(WARP_EVENT, start);
  }, [router]);

  // The new route rendered: clear the smoke.
  useEffect(() => {
    const s = state.current;
    if (s.phase === "hold") {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => { s.phase = "out"; s.t0 = performance.now(); document.documentElement.classList.remove("warp-covered"); });
    }
  }, [pathname]);

  useEffect(() => {
    if (!on) return;
    const c = canvas.current!, ctx = c.getContext("2d")!;
    let raf = 0, W = 0, H = 0;
    // Sized on start and resize, not per frame (innerWidth can force a layout of the page that is
    // changing underneath); no more pixels than the 1600×900 smoke frames show under cover.
    const size = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const d = Math.min(window.devicePixelRatio || 1, 1.5, Math.max(1, Math.min(1600 / w, 900 / h)));
      W = c.width = Math.round(w * d); H = c.height = Math.round(h * d);
    };
    size();
    window.addEventListener("resize", size);
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const s = state.current;
      ctx.clearRect(0, 0, W, H);
      const k = (now - s.t0) / (s.phase === "out" ? OUT_MS : IN_MS);
      let cover = 1, t = 1, scale = 1;
      if (s.phase === "in") { const e = easeIn(Math.min(1, k)); cover = e; t = e; scale = 1.35 - 0.35 * e; }
      if (s.phase === "out") { const e = easeOut(Math.min(1, k)); cover = 1 - e; t = 1 - e * 0.4; scale = 1 + e * 0.25; }
      if (s.phase === "out" && k >= 1) { s.phase = "idle"; document.documentElement.classList.remove("warping"); setOn(false); return; }
      // Full frame, no wipe: the camera flies into the cloud (it rushes in and thickens),
      // and on the far side the cloud thins and lifts away.
      ctx.globalAlpha = Math.min(1, cover * 1.35);
      if (!seq.current || !drawSequence(ctx, seq.current, t, W, H, scale)) {
        ctx.fillStyle = "#6E5236"; ctx.fillRect(0, 0, W, H);
      }
      ctx.globalAlpha = 1;
      // Warm glow from where the reader clicked, as if the light came through the smoke there.
      const g = ctx.createRadialGradient(s.x * W, s.y * H, 0, s.x * W, s.y * H, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, `rgba(255,190,110,${0.28 * cover})`);
      g.addColorStop(1, "rgba(255,190,110,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, [on]);

  return <canvas ref={canvas} className="warp" aria-hidden="true" style={{ display: on ? "block" : "none" }} />;
}

const easeIn = (x: number) => x * x * x;
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
