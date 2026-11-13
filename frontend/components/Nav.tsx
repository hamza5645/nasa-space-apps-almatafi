"use client";

// Floating nav for the story pages: clear over the dark scenes, frosted over the light
// sections (it checks what is under it), and it tucks away while you scroll down.

import { useEffect, useRef, useState } from "react";
import Brand from "./Brand";
import WarpLink from "./WarpLink";

export default function Nav({ current }: { current?: "explore" | "method" }) {
  const ref = useRef<HTMLElement>(null);
  const [tone, setTone] = useState<"dark" | "light">("dark");
  const [tucked, setTucked] = useState(false);
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    // Tone: is a .light section under the nav's bottom edge? An observer on a 1 px strip there
    // answers only when it changes, instead of a hit test (forced style + layout) every scroll frame.
    const lights = new Set<Element>();
    let io: IntersectionObserver | undefined;
    const watch = () => {
      io?.disconnect(); lights.clear();
      const h = ref.current?.offsetHeight ?? 72;
      io = new IntersectionObserver((es) => {
        es.forEach((e) => { if (e.isIntersecting) lights.add(e.target); else lights.delete(e.target); });
        setTone(lights.size ? "light" : "dark");
      }, { rootMargin: `-${h + 2}px 0px -${Math.max(0, window.innerHeight - h - 3)}px 0px` });
      document.querySelectorAll(".light").forEach((el) => io!.observe(el));
    };
    watch();
    window.addEventListener("resize", watch);
    // The nav can change height without a window resize (web fonts arriving, links wrapping).
    const ro = new ResizeObserver(watch);
    if (ref.current) ro.observe(ref.current);

    let lastY = window.scrollY, raf = 0;
    const check = () => {
      raf = 0;
      const y = window.scrollY;
      setSolid(y > 40);
      setTucked(y > 320 && y > lastY + 2);
      if (y < lastY - 2) setTucked(false);
      lastY = y;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", watch); ro.disconnect(); io?.disconnect(); cancelAnimationFrame(raf); };
  }, []);

  return (
    <nav ref={ref} className="nav-float" data-tone={tone} data-solid={solid || undefined} data-tucked={tucked || undefined} aria-label="Main">
      <div className="nav-inner wrap">
        <Brand />
        <div className="nav-links">
          <WarpLink href="/method" aria-current={current === "method" ? "page" : undefined}>Method</WarpLink>
          <WarpLink className="btn btn-fire" href="/explore" aria-current={current === "explore" ? "page" : undefined}>
            Open the calendar
          </WarpLink>
        </div>
      </div>
    </nav>
  );
}
