"use client";

// Links that leave the page through the smoke: the screen rushes into the Higgsfield smoke
// bank, the next page loads behind it, then the smoke clears. Plain navigation for modified
// clicks, reduced motion, or anything outside the site.

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { reducedMotion } from "@/lib/motion";

export const WARP_EVENT = "almatafi:warp";

export default function WarpLink({ href, onClick, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!href.startsWith("/") || reducedMotion()) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent(WARP_EVENT, { detail: { href, x: e.clientX, y: e.clientY } }));
  };
  return <Link href={href} onClick={go} {...rest} />;
}
