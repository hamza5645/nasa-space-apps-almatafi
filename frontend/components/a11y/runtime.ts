// X37: the accessibility mode's state and voice. One settings object, saved on this device
// and mirrored as attributes on <html> for the CSS; speech through the browser's own voice.

import { DEFAULTS, SETTINGS_KEY, htmlAttributes, parseSettings, type Settings } from "@/lib/a11y";

let settings: Settings = DEFAULTS;
let loaded = false;
const subs = new Set<() => void>();

export function getSettings(): Settings {
  if (!loaded && typeof window !== "undefined") {
    try { settings = parseSettings(localStorage.getItem(SETTINGS_KEY)); } catch { settings = { ...DEFAULTS }; }
    loaded = true;
  }
  return settings;
}
export const getServerSettings = () => DEFAULTS;

export function subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; }

/** Writes the attributes the CSS keys on. Called on every change and once at start-up. */
export function applyToHtml(s: Settings = getSettings()) {
  const h = document.documentElement;
  for (const [k, v] of Object.entries(htmlAttributes(s))) {
    if (v === null) h.removeAttribute(k); else h.setAttribute(k, v);
  }
}

export function setSettings(patch: Partial<Settings>) {
  settings = { ...getSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* not remembered */ }
  applyToHtml(settings);
  if (!settings.on || !settings.voice) stopSpeech();
  subs.forEach((fn) => fn());
}

// ---------- Voice ----------

export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

// When the voice last finished a sentence by itself; stopSpeech() (the user's own Stop, or the
// microphone opening) doesn't count, so a command said right after it is still heard.
let spokeAt = 0, hushed = false;
// Chrome quirks, each of which makes the voice silent with no error:
//  - an utterance queued in the same tick as cancel() can be dropped, so speaking starts a moment later;
//  - utterances the garbage collector takes mid-queue stop the queue, so they're held here until they end;
//  - the engine can sit "paused" after a cancel, so resume() comes first;
//  - the default voice can be missing until the voice list has loaded, so an English voice is picked when there is one.
const held = new Set<SpeechSynthesisUtterance>();
let gen = 0;
let englishVoice: SpeechSynthesisVoice | null = null;
function pickVoice(): SpeechSynthesisVoice | null {
  if (englishVoice) return englishVoice;
  const vs = window.speechSynthesis.getVoices();
  englishVoice = vs.find((v) => /^en[-_]US/i.test(v.lang) && v.default) ?? vs.find((v) => /^en[-_]US/i.test(v.lang)) ?? vs.find((v) => /^en/i.test(v.lang)) ?? null;
  return englishVoice;
}
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  try { window.speechSynthesis.addEventListener?.("voiceschanged", () => { englishVoice = null; }); } catch { /* no voice list events */ }
}

/** Says text with the browser's voice when the mode and voice reading are on. Long text goes
 *  out sentence by sentence (Chrome drops utterances over ~15 s). interrupt=false queues it. */
export function speak(text: string, { interrupt = true, force = false }: { interrupt?: boolean; force?: boolean } = {}) {
  if (!canSpeak()) return;
  const s = getSettings();
  if (!force && (!s.on || !s.voice)) return;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  // Sentence ends: . ! ? followed by a space (so "2.4 times" stays whole).
  const chunks = clean.split(/(?<=[.!?…])\s+/);
  let buf = "";
  const out: string[] = [];
  for (const c of chunks) {
    if ((buf + c).length > 220 && buf) { out.push(buf); buf = c; } else buf = buf ? `${buf} ${c}` : c;
  }
  if (buf) out.push(buf);
  const synth = window.speechSynthesis;
  if (interrupt) { gen++; synth.cancel(); held.clear(); }
  const my = gen;
  hushed = false;
  const go = () => {
    if (my !== gen) return;   // cancelled or replaced while waiting
    try { synth.resume(); } catch { /* fine */ }
    const voice = pickVoice();
    for (const part of out) {
      const u = new SpeechSynthesisUtterance(part.trim());
      u.lang = "en-US";
      u.rate = 1;
      if (voice) u.voice = voice;
      held.add(u);
      u.onend = u.onerror = () => { held.delete(u); if (!hushed) spokeAt = Date.now(); };
      synth.speak(u);
    }
  };
  if (interrupt) setTimeout(go, 60); else go();
}

/** Is the site's own voice talking, or did it stop less than `ms` ago? A microphone that is open then hears it. */
export function spokeWithin(ms: number): boolean {
  return canSpeak() && (window.speechSynthesis.speaking || window.speechSynthesis.pending || Date.now() - spokeAt < ms);
}

export function stopSpeech() {
  hushed = true;
  gen++;   // anything waiting to start stays silent
  held.clear();
  if (canSpeak()) window.speechSynthesis.cancel();
}

// ---------- What a focused element is called ----------

import { describe, type Focused } from "@/lib/a11y";

function textOf(el: Element | null, max = 220): string {
  if (!el) return "";
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[aria-hidden='true'], script, style, select, input, textarea").forEach((n) => n.remove());
  const t = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** The accessible name, close enough: aria-labelledby, aria-label, a <label>, the text, a title or an image's alt. */
export function nameOf(el: HTMLElement): string {
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = by.split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(" ");
    if (t) return t;
  }
  const label = el.getAttribute("aria-label");
  if (label) return label;
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el instanceof HTMLButtonElement) {
    const l = Array.from(el.labels ?? []).map((x) => textOf(x)).filter(Boolean).join(" ");
    if (l) return l;
    if ("placeholder" in el && el.placeholder) return el.placeholder;
  }
  const own = textOf(el);
  if (own) return own;
  if (el.title) return el.title;
  const img = el.querySelector("img[alt]");
  return img?.getAttribute("alt") ?? "";
}

export function focusedInfo(el: HTMLElement): Focused {
  const tag = el.tagName.toLowerCase();
  let value: string | null = null;
  let checked: boolean | null = null;
  if (el instanceof HTMLSelectElement) value = el.selectedOptions[0]?.textContent?.trim() ?? el.value;
  else if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") checked = el.checked;
    else value = el.value || null;
  }
  const ac = el.getAttribute("aria-checked");
  if (ac === "true") checked = true; else if (ac === "false") checked = false;
  const role = el.getAttribute("role");
  return {
    tag, role, name: nameOf(el), type: el.getAttribute("type"), value,
    pressed: el.getAttribute("aria-pressed"), expanded: el.getAttribute("aria-expanded"), checked,
    current: el.getAttribute("aria-current"), disabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
    level: /^h([1-6])$/.test(tag) ? Number(tag[1]) : role === "heading" ? Number(el.getAttribute("aria-level") ?? 2) : null,
  };
}

export const describeElement = (el: HTMLElement) => describe(focusedInfo(el));

/** Is the element shown on the page (not display:none, not aria-hidden, not in our own panels)? */
export function visible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[aria-hidden='true'], .a11y-root, .tour, nav, footer, [hidden]")) return false;
  return el.getClientRects().length > 0;
}

/** The page's readable text in order: headings, paragraphs, list items, the answer. */
export function pageText(): string {
  const root = document.querySelector("main, .explorer, .game") ?? document.body;
  const seen = new Set<Element>();
  const out: string[] = [];
  const title = document.title.split("·")[0].trim();
  if (title) out.push(title + ".");
  root.querySelectorAll("h1, h2, h3, h4, p, li, dt, dd, figcaption, summary, .verdict-head, .verdict-detail").forEach((el) => {
    if (!visible(el) || seen.has(el)) return;
    // Skip an element whose ancestor is already taken (a <p> inside an <li>).
    for (let p = el.parentElement; p; p = p.parentElement) if (seen.has(p)) return;
    const t = textOf(el, 600);
    if (t.length < 2) return;
    seen.add(el);
    out.push(/[.!?…:]$/.test(t) ? t : t + ".");
  });
  return out.join(" ");
}

/** The first visible button or link whose name contains every word. */
export function findControl(words: string): HTMLElement | null {
  const ws = words.toLowerCase().split(/\s+/).filter(Boolean);
  const all = Array.from(document.querySelectorAll<HTMLElement>("button, a[href], [role='button'], [role='tab'], input, select, summary"));
  const match = (el: HTMLElement) => { const n = nameOf(el).toLowerCase(); return ws.every((w) => n.includes(w)); };
  // Not our skip links: "Skip to the downloads" comes first in the page and isn't the Download button.
  return all.find((el) => el.getClientRects().length > 0 && !el.closest("[aria-hidden='true'], .a11y-skips") && match(el)) ?? null;
}

// ---------- Speech recognition ----------

type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
export const canListen = () => recognitionCtor() !== null;
