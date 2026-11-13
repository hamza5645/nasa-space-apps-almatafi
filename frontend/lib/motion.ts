// Reduced motion: the system setting, or the site's own accessibility switch (X37), which
// sets data-a11y-motion="reduce" on <html>. Every place that picks a still over an animation
// asks here, so one switch covers the globe, the films, the sprites and the page transitions.

export function reducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.a11yMotion === "reduce";
}
