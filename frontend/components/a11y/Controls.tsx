"use client";

// X37: the controls the panel and the guide share, so a setting can be tried inside the step
// that explains it.

import { useSyncExternalStore } from "react";
import { TEXT_SIZES, stepText, type Settings, type TextSize } from "@/lib/a11y";
import { getServerSettings, getSettings, setSettings, speak, subscribe } from "./runtime";

export function useA11y(): Settings {
  return useSyncExternalStore(subscribe, getSettings, getServerSettings);
}

const SIZE_NAMES: Record<TextSize, string> = { 100: "Normal", 115: "Large", 130: "Larger", 150: "Largest" };

export function TextSizeControl() {
  const s = useA11y();
  const set = (t: TextSize) => { setSettings({ text: t }); speak(`Text size ${SIZE_NAMES[t].toLowerCase()}, ${t} percent.`); };
  return (
    <div className="a11y-row a11y-text" role="group" aria-label="Text size">
      <span className="a11y-label">Text size</span>
      <div className="a11y-sizes">
        <button type="button" className="a11y-step" onClick={() => set(stepText(s.text, -1))} disabled={s.text === TEXT_SIZES[0]} aria-label="Smaller text">A−</button>
        <div className="a11y-seg" role="radiogroup" aria-label="Text size">
          {TEXT_SIZES.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={s.text === t} onClick={() => set(t)} aria-label={`${SIZE_NAMES[t]}, ${t} percent`}>
              {SIZE_NAMES[t]}
            </button>
          ))}
        </div>
        <button type="button" className="a11y-step" onClick={() => set(stepText(s.text, 1))} disabled={s.text === TEXT_SIZES[TEXT_SIZES.length - 1]} aria-label="Bigger text">A+</button>
      </div>
    </div>
  );
}

export function Switch({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="a11y-row">
      <div className="a11y-copy">
        <label htmlFor={id} className="a11y-label">{label}</label>
        {hint && <span className="a11y-hint" id={`${id}-hint`}>{hint}</span>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={checked} aria-describedby={hint ? `${id}-hint` : undefined}
              className="a11y-switch" onClick={() => onChange(!checked)}>
        <span className="a11y-knob" aria-hidden="true" />
        <span className="sr-only">{checked ? "on" : "off"}</span>
      </button>
    </div>
  );
}

/** A setting switch that also says what it did. */
export function SettingSwitch({ k, label, hint, onAfter }: { k: "contrast" | "motion" | "keys" | "voice"; label: string; hint?: string; onAfter?: (v: boolean) => void }) {
  const s = useA11y();
  return (
    <Switch id={`a11y-${k}`} label={label} hint={hint} checked={s[k]} onChange={(v) => {
      setSettings({ [k]: v });
      speak(`${label} ${v ? "on" : "off"}.`);
      onAfter?.(v);
    }} />
  );
}
