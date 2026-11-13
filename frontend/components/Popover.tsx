"use client";

// A button that opens a panel under it. Closes on Escape, on a click outside, or when the
// content calls close(); focus goes back to the button.

import { useEffect, useId, useRef, useState } from "react";

type Props = {
  label: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "start" | "end";
  className?: string;
  ariaLabel?: string;
  tour?: string;
};

export default function Popover({ label, children, align = "start", className = "", ariaLabel, tour }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const btnId = `${id}-btn`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); document.getElementById(btnId)?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, btnId]);

  const close = () => { setOpen(false); document.getElementById(btnId)?.focus(); };
  return (
    <div className={`pop ${className}`} ref={root} data-tour={tour}>
      <button id={btnId} type="button" className="pop-btn" aria-expanded={open} aria-controls={id} aria-label={ariaLabel}
              onClick={() => setOpen((o) => !o)}>
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      {open && <div id={id} className={`pop-panel pop-${align}`}>{children(close)}</div>}
    </div>
  );
}
