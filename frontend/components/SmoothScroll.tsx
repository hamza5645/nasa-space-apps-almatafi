"use client";

// Smooth scrolling (Lenis) and the scroll-driven reveals for the story pages (landing, Method).
//   [data-reveal]          fades and lifts in once (opacity + transform only, so it stays on the compositor)
//   [data-reveal="stagger"] the same for each direct child, one after another
//   [data-parallax]        drifts against the scroll inside its parent (images, video)
//   [data-draw]            SVG paths inside draw themselves as the element scrolls in
//   video[autoplay][loop]  plays only while near the screen (reduced motion too: it autoplayed there before)
// Nothing is hidden without JS, and reduced motion gets the plain page.

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

export default function SmoothScroll() {
  useEffect(() => {
    // Looping films keep decoding off screen otherwise; pause them until they come within 200 px.
    const films = new IntersectionObserver((es) => es.forEach((e) => {
      const v = e.target as HTMLVideoElement;
      if (e.isIntersecting) v.play().catch(() => {}); else v.pause();
    }), { rootMargin: "200px 0px" });
    document.querySelectorAll<HTMLVideoElement>("video[autoplay][loop]").forEach((v) => films.observe(v));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => films.disconnect();
    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (t: number) => lenis.raf(t * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    const ctx = gsap.context(() => {
      // No filter blur: it repaints the whole layer every frame, and the big ones hold videos, charts and photos.
      const enter = { y: 0, opacity: 1, duration: 1.15, ease: "power3.out" };
      const from = { y: 46, opacity: 0 };
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
        const targets = el.dataset.reveal === "stagger" ? Array.from(el.children) : [el];
        gsap.fromTo(targets, from, { ...enter, stagger: 0.12, scrollTrigger: { trigger: el, start: "top 86%", once: true } });
      });
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((el) => {
        const amt = Number(el.dataset.parallax || 10);
        gsap.fromTo(el, { yPercent: -amt }, { yPercent: amt, ease: "none",
          scrollTrigger: { trigger: el.parentElement, start: "top bottom", end: "bottom top", scrub: true } });
      });
      gsap.utils.toArray<HTMLElement>("[data-draw]").forEach((el) => {
        el.querySelectorAll<SVGPathElement>("path[data-len]").forEach((p) => {
          const len = p.getTotalLength();
          gsap.fromTo(p, { strokeDasharray: `${len} ${len}`, strokeDashoffset: len }, { strokeDashoffset: 0, ease: "none",
            scrollTrigger: { trigger: el, start: "top 80%", end: "top 25%", scrub: 0.6 },
            onComplete: () => { if (p.dataset.dash) p.style.strokeDasharray = p.dataset.dash; } });
        });
      });
    });

    // Leaving through a WarpLink: stop the smooth scroll so the page holds still behind the smoke.
    const obs = new MutationObserver(() => {
      if (document.documentElement.classList.contains("warping")) lenis.stop(); else lenis.start();
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      films.disconnect();
      obs.disconnect();
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
  return null;
}
