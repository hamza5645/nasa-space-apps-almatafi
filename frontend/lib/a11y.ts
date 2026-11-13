// X37: accessibility mode. One switch turns on screen reading by voice, text size, high
// contrast, reduced motion and keyboard-only control, with a guide the first time. The pure
// parts live here (tested): the settings, what a focused element is called out as, the voice
// commands, and the guide's steps. The DOM side is components/a11y/.

export type TextSize = 100 | 115 | 130 | 150;
export const TEXT_SIZES: TextSize[] = [100, 115, 130, 150];

export type Settings = {
  on: boolean;          // the master switch
  text: TextSize;       // text size, % of the normal size
  contrast: boolean;    // high contrast
  motion: boolean;      // reduce motion, whatever the system says
  keys: boolean;        // keyboard mode: always-visible focus, skip links, shortcuts
  voice: boolean;       // screen reading by voice
};

export const DEFAULTS: Settings = { on: false, text: 100, contrast: false, motion: false, keys: true, voice: true };
export const SETTINGS_KEY = "almatafi-a11y-v1";
export const GUIDE_KEY = "almatafi-a11y-guide-v1";

/** Reads settings saved as JSON; anything missing or malformed falls back to the defaults. */
export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return { ...DEFAULTS };
  try {
    const o = JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>;
    if (!o || typeof o !== "object") return { ...DEFAULTS };
    const bool = (k: keyof Settings) => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULTS[k] as boolean);
    const text = TEXT_SIZES.includes(o.text as TextSize) ? (o.text as TextSize) : DEFAULTS.text;
    return { on: bool("on"), text, contrast: bool("contrast"), motion: bool("motion"), keys: bool("keys"), voice: bool("voice") };
  } catch {
    return { ...DEFAULTS };
  }
}

/** The attributes the <html> element carries for the CSS: nothing at all while the mode is off. */
export function htmlAttributes(s: Settings): Record<string, string | null> {
  const off = { "data-a11y": null, "data-a11y-text": null, "data-a11y-contrast": null, "data-a11y-motion": null, "data-a11y-keys": null, "data-a11y-voice": null };
  if (!s.on) return off;
  return {
    "data-a11y": "on",
    "data-a11y-text": s.text === 100 ? null : String(s.text),
    "data-a11y-contrast": s.contrast ? "high" : null,
    "data-a11y-motion": s.motion ? "reduce" : null,
    "data-a11y-keys": s.keys ? "on" : null,
    "data-a11y-voice": s.voice ? "on" : null,
  };
}

/** The next text size up or down, staying inside the range. */
export function stepText(t: TextSize, dir: 1 | -1): TextSize {
  const i = TEXT_SIZES.indexOf(t);
  return TEXT_SIZES[Math.min(TEXT_SIZES.length - 1, Math.max(0, i + dir))];
}

// ---------- What the voice says about a focused element ----------

export type Focused = {
  tag: string;                  // lower-case tag name
  role?: string | null;         // explicit role
  name: string;                 // accessible name (label, text, aria-label, title, alt)
  type?: string | null;         // input type
  value?: string | null;        // input/select value or selected option's text
  pressed?: string | null;      // aria-pressed
  expanded?: string | null;     // aria-expanded
  checked?: boolean | null;     // checkbox/radio/switch state
  current?: string | null;      // aria-current
  disabled?: boolean;
  level?: number | null;        // heading level
};

const ROLE_WORDS: Record<string, string> = {
  button: "button", link: "link", checkbox: "checkbox", radio: "radio", switch: "switch", tab: "tab", menuitem: "menu item",
  combobox: "menu", listbox: "list", slider: "slider", textbox: "text field", searchbox: "search field", dialog: "dialog",
  option: "option", heading: "heading", img: "image", group: "group", region: "section", navigation: "navigation", main: "main content",
};

/** The role word for an element: its explicit role, else what the tag implies. */
export function roleOf(f: Focused): string {
  if (f.role && ROLE_WORDS[f.role]) return ROLE_WORDS[f.role];
  switch (f.tag) {
    case "a": return "link";
    case "button": return "button";
    case "select": return "menu";
    case "textarea": return "text field";
    case "summary": return "disclosure";
    case "input":
      switch (f.type) {
        case "checkbox": return "checkbox"; case "radio": return "radio"; case "range": return "slider";
        case "search": return "search field"; case "number": return "number field"; case "button": case "submit": return "button";
        default: return "text field";
      }
    case "h1": case "h2": case "h3": case "h4": return "heading";
    default: return f.role ? f.role.replace(/_/g, " ") : "";
  }
}

/** One short sentence for a focused element: name, role, state. Empty name → the role only. */
export function describe(f: Focused): string {
  const parts: string[] = [];
  const name = f.name.replace(/\s+/g, " ").trim();
  const role = roleOf(f);
  if (name) parts.push(name);
  if (role) parts.push(role + (role === "heading" && f.level ? ` level ${f.level}` : ""));
  if (f.value && !["checkbox", "radio", "switch"].includes(role)) parts.push(f.value);
  if (f.pressed === "true") parts.push("pressed");
  if (f.pressed === "false") parts.push("not pressed");
  if (f.expanded === "true") parts.push("expanded");
  if (f.expanded === "false") parts.push("collapsed");
  if (f.checked === true) parts.push("checked");
  if (f.checked === false && ["checkbox", "radio", "switch"].includes(role)) parts.push("not checked");
  if (f.current === "page") parts.push("current page");
  if (f.disabled) parts.push("unavailable");
  return parts.join(", ");
}

// ---------- Voice commands ----------

export type Command =
  | { kind: "go"; to: "/" | "/explore" | "/method" | "/play" }
  | { kind: "read" } | { kind: "stop" } | { kind: "help" } | { kind: "panel" }
  | { kind: "text"; dir: 1 | -1 }
  | { kind: "contrast"; on: boolean } | { kind: "motion"; on: boolean }
  | { kind: "region"; id: "nile-delta" | "rio-negro" }
  | { kind: "month"; dir: 1 | -1 }
  | { kind: "view"; view: "harmonized" | "modis" | "viirs" }
  | { kind: "click"; name: string };

/** Turns what the microphone heard into a command, or null when nothing matches. */
export function parseCommand(heard: string): Command | null {
  const t = heard.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const has = (...ws: string[]) => ws.some((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (has("stop", "quiet", "silence", "be quiet")) return { kind: "stop" };
  // "click next" means the button called Next, whatever other command its name sounds like.
  const click = t.match(/^(?:click|press) (?:on )?(.+)$/);
  if (click) return { kind: "click", name: click[1] };
  if (has("help", "shortcuts", "commands", "what can i say")) return { kind: "help" };
  if (/\b(open |show )?(accessibility|settings)\b/.test(t)) return { kind: "panel" };
  if (has("read")) return { kind: "read" };
  if (has("explorer", "explore", "calendar")) return { kind: "go", to: "/explore" };
  if (has("method", "how it works")) return { kind: "go", to: "/method" };
  if (has("play", "game")) return { kind: "go", to: "/play" };
  if (has("home", "story", "landing", "start page")) return { kind: "go", to: "/" };
  if (/\b(bigger|larger|increase|zoom in)\b/.test(t)) return { kind: "text", dir: 1 };
  if (/\b(smaller|decrease|reduce|zoom out)\b/.test(t) && !/\b(motion|animation|animations)\b/.test(t)) return { kind: "text", dir: -1 };
  if (/\bcontrast\b/.test(t)) return { kind: "contrast", on: !/\b(off|normal|no)\b/.test(t) };
  // "reduce motion on/off" names the setting; "animations on/off" names what the setting stops.
  if (/\b(motion|animation|animations)\b/.test(t)) return { kind: "motion", on: /\breduced?\b/.test(t) ? !/\b(off|disable|no)\b/.test(t) : !/\b(on|allow|enable|back)\b/.test(t) };
  if (/\b(nile|delta|egypt)\b/.test(t)) return { kind: "region", id: "nile-delta" };
  if (/\b(rio|negro|argentina|chile|patagonia)\b/.test(t)) return { kind: "region", id: "rio-negro" };
  if (/\b(next|following)\b/.test(t)) return { kind: "month", dir: 1 };
  if (/\b(previous|last|back)\b/.test(t)) return { kind: "month", dir: -1 };
  if (/\bharmoni[sz]ed\b/.test(t)) return { kind: "view", view: "harmonized" };
  if (/\bmodis\b/.test(t)) return { kind: "view", view: "modis" };
  if (/\bviirs\b/.test(t)) return { kind: "view", view: "viirs" };
  const m = /^(?:open|choose|select) (.+)$/.exec(t);
  if (m) return { kind: "click", name: m[1] };
  return null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "October 2026: 589 hotspots, …" → "2026-10" (the calendar cells' labels), or null. */
export function monthFromLabel(label: string): string | null {
  const m = /^([A-Za-z]+) (\d{4})\b/.exec(label.trim());
  if (!m) return null;
  const i = MONTHS.indexOf(m[1].toLowerCase());
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

/** The month next to `current` among the months the calendar shows, or null at the edge. */
export function neighbourMonth(shown: string[], current: string | null, dir: 1 | -1): string | null {
  const sorted = Array.from(new Set(shown)).sort();
  if (!sorted.length) return null;
  if (!current) return dir === 1 ? sorted[sorted.length - 1] : sorted[0];
  return dir === 1 ? sorted.find((m) => m > current) ?? null : [...sorted].reverse().find((m) => m < current) ?? null;
}

/** YYYY-MM shifted by n months. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------- The guide ----------

export type GuideStep = { id: "welcome" | "text" | "contrast" | "keyboard" | "voice" | "done"; title: string; text: string; speak: string };

export const GUIDE: GuideStep[] = [
  { id: "welcome", title: "Accessibility mode is on",
    text: "This guide walks through what changed, one step at a time. Each step has the controls in it, so you can try them as you go. You can reopen it any time from the Accessibility button, or with Alt + A.",
    speak: "Accessibility mode is on. This short guide walks through text size, contrast, keyboard control and voice reading. Press Enter or the right arrow for the next step, Escape to skip." },
  { id: "text", title: "Make the text bigger",
    text: "Pick a size. Everything written on the site grows with it: headings, numbers, buttons and the calendar's labels. It's remembered on this device.",
    speak: "Step two, text size. Use the buttons to make the text bigger or smaller. The site remembers your choice." },
  { id: "contrast", title: "Turn up the contrast",
    text: "High contrast swaps the warm dark theme for pure black and white with bright, thick outlines, underlines every link, and removes the faint scenery behind the numbers. Reduce motion stops the 3D globe, films and page transitions and shows still images instead.",
    speak: "Step three, contrast and motion. High contrast gives black and white with thick outlines. Reduce motion stops the globe, the films and the page transitions." },
  { id: "keyboard", title: "Use only the keyboard",
    text: "Tab moves forward, Shift + Tab back, Enter or Space presses. The focused control always has a thick ring. On every page, Tab from the very top reaches skip links that jump straight to the content, the calendar, the map or the downloads. In the calendar the arrow keys move between months.",
    speak: "Step four, the keyboard. Tab moves between controls, Enter presses. Press Tab from the top of a page for skip links to the calendar, the map and the downloads. Arrow keys move inside the calendar. Alt and K lists every shortcut." },
  { id: "voice", title: "Hear the screen",
    text: "With voice reading on, the site says what you land on (its name, what kind of control it is, and its state), reads the answer when it changes, and announces each new page. Alt + R reads the page from the top; Escape stops. If your browser supports speech recognition, the microphone takes commands like \"open the explorer\", \"next month\", \"bigger text\" or \"read the page\".",
    speak: "Step five, voice. The site says what you focus on and reads the answer when it changes. Alt and R reads the whole page. Escape stops the voice. With the microphone you can say: open the explorer, next month, bigger text, or read the page." },
  { id: "done", title: "That's all",
    text: "Your choices are saved on this device. The Accessibility button in the corner, or Alt + A, opens them again. Turning the mode off puts everything back.",
    speak: "That's all. Your choices are saved. The Accessibility button, or Alt and A, opens them again. Enjoy the site." },
];

/** The keyboard shortcuts, for the help list. */
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: "Alt + A", does: "Open or close the accessibility panel" },
  { keys: "Alt + K", does: "This list of shortcuts" },
  { keys: "Alt + R", does: "Read the page aloud from the top" },
  { keys: "Alt + V", does: "Voice reading on or off" },
  { keys: "Alt + M", does: "Listen for a voice command" },
  { keys: "Alt + +  /  Alt + −", does: "Bigger or smaller text" },
  { keys: "Alt + 1 / 2 / 3 / 4", does: "Go to the story, the explorer, Method, the game" },
  { keys: "Escape", does: "Stop the voice; close a panel or dialog" },
  { keys: "Tab / Shift + Tab", does: "Next or previous control; from the top of a page, the skip links" },
  { keys: "Arrow keys", does: "Move inside the calendar and between the guide's steps" },
];

/** What Alt + key does, or null. Browsers own Alt with Shift/Ctrl/Meta, so those are left alone. */
export function shortcut(e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; code?: string }): Command | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  const code = e.code ?? "";
  // On a Mac, Alt + letter types a symbol (å, ∫…) so e.key is useless; e.code names the physical key.
  const k = /^Key([A-Z])$/.exec(code)?.[1]?.toLowerCase() ?? /^Digit([0-9])$/.exec(code)?.[1] ?? e.key.toLowerCase();
  if (e.shiftKey && !(k === "=" || code === "Equal")) return null;
  switch (k) {
    case "a": return { kind: "panel" };
    case "k": return { kind: "help" };
    case "r": return { kind: "read" };
    case "v": return { kind: "click", name: "__voice" };
    case "m": return { kind: "click", name: "__mic" };
    case "1": return { kind: "go", to: "/" };
    case "2": return { kind: "go", to: "/explore" };
    case "3": return { kind: "go", to: "/method" };
    case "4": return { kind: "go", to: "/play" };
    case "=": case "+": return { kind: "text", dir: 1 };
    case "-": case "_": return { kind: "text", dir: -1 };
    default:
      if (code === "Equal" || code === "NumpadAdd") return { kind: "text", dir: 1 };
      if (code === "Minus" || code === "NumpadSubtract") return { kind: "text", dir: -1 };
      return null;
  }
}
