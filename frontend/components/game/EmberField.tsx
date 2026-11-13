"use client";

// Embers drifting up behind the game, and a burst of sparks on a right answer. One canvas;
// it sleeps when the tab is hidden and does nothing with reduced motion.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type EmberFieldHandle = { burst: (x: number, y: number) => void };

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; spark: boolean };

const EmberField = forwardRef<EmberFieldHandle>(function EmberField(_, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const parts = useRef<P[]>([]);
  const still = useRef(true);

  useImperativeHandle(ref, () => ({
    burst(x, y) {
      if (still.current) return;
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 5;
        parts.current.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2, life: 0, max: 40 + Math.random() * 30, r: 1.5 + Math.random() * 2.2, spark: true });
      }
    },
  }));

  useEffect(() => {
    const c = canvas.current!;
    still.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still.current) return;
    const g = c.getContext("2d")!;
    let raf = 0, w = 0, h = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = () => { w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    window.addEventListener("resize", size);
    const spawn = (): P => ({ x: Math.random() * w, y: h + 10, vx: (Math.random() - 0.5) * 0.4, vy: -(0.4 + Math.random() * 0.9),
      life: 0, max: 260 + Math.random() * 240, r: 0.8 + Math.random() * 1.8, spark: false });
    for (let i = 0; i < 50; i++) { const p = spawn(); p.y = Math.random() * h; p.life = Math.random() * p.max; parts.current.push(p); }
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = "lighter";
      const ps = parts.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.life++; p.x += p.vx + (p.spark ? 0 : Math.sin((p.life + i) * 0.02) * 0.25); p.y += p.vy;
        if (p.spark) { p.vy += 0.12; p.vx *= 0.97; }
        const t = p.life / p.max;
        if (t >= 1 || p.y < -20) { if (p.spark) ps.splice(i, 1); else ps[i] = spawn(); continue; }
        const a = p.spark ? 1 - t : Math.sin(Math.PI * t) * 0.8;
        g.fillStyle = p.spark ? `rgba(255, ${190 - 90 * t | 0}, 90, ${a})` : `rgba(255, ${150 + 60 * (1 - t) | 0}, 70, ${a * 0.7})`;
        g.beginPath(); g.arc(p.x, p.y, p.r * (p.spark ? 1 - t * 0.5 : 1), 0, Math.PI * 2); g.fill();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", size); };
  }, []);

  return <canvas ref={canvas} className="game-embers" aria-hidden="true" />;
});

export default EmberField;
