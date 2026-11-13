"use client";

// X37: accessibility mode, on every page. A floating button (Alt + A) opens the panel with the
// master switch; while the mode is on the site reads itself aloud (focus, live regions, whole
// page, voice commands), the text can grow, contrast and motion can change, and the keyboard
// gets skip links, always-visible focus and shortcuts. The first time it's turned on, the
// guide (Guide.tsx) walks through all of it. Settings live on this device (runtime.ts).

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GUIDE_KEY, SHORTCUTS, monthFromLabel, neighbourMonth, parseCommand, shortcut, stepText, type Command } from "@/lib/a11y";
import { bboxShape } from "@/lib/geo";
import { useSelection } from "@/lib/store";
import Guide from "./Guide";
import { SettingSwitch, Switch, TextSizeControl, useA11y } from "./Controls";
import { applyToHtml, canListen, canSpeak, describeElement, findControl, getSettings, pageText, recognitionCtor, setSettings, speak, spokeWithin, stopSpeech } from "./runtime";
import "./a11y.css";

const REGIONS = {
  "nile-delta": { label: "Nile Delta, Egypt", month: "2026-10", bbox: [29.9, 30.0, 32.3, 31.6] as [number, number, number, number] },
  "rio-negro": { label: "Río Negro, Argentina", month: "2026-07", bbox: [-71.8, -41.8, -68.0, -39.5] as [number, number, number, number] },
};
const RESUME_KEY = "almatafi-a11y-resume";
const SKIP_TARGETS: { id: string; label: string }[] = [
  { id: "verdict", label: "Skip to the answer" }, { id: "calendar", label: "Skip to the calendar" },
  { id: "map", label: "Skip to the map" }, { id: "downloads", label: "Skip to the downloads" },
];

/** What a live region says: its headings and paragraphs when it has any (the answer's headline
 *  and detail, not every dot in its strip), else its visible text. */
function liveText(r: Element): string {
  const parts = Array.from(r.querySelectorAll<HTMLElement>("h1, h2, h3, p")).filter((el) => !el.closest("[aria-hidden='true']")).map((el) => el.innerText.trim()).filter(Boolean);
  const raw = parts.length ? parts.join(" ") : (r as HTMLElement).innerText ?? r.textContent ?? "";
  return raw.replace(/\s+/g, " ").trim();
}

function guideSeen() { try { return localStorage.getItem(GUIDE_KEY) === "done"; } catch { return true; } }
function markGuide() { try { localStorage.setItem(GUIDE_KEY, "done"); } catch { /* not remembered */ } }

export default function Accessibility() {
  const s = useA11y();
  const router = useRouter();
  const pathname = usePathname();
  const [panel, setPanel] = useState(false);
  const [guide, setGuide] = useState<{ open: boolean; step: number }>({ open: false, step: 0 });
  const [help, setHelp] = useState(false);
  const [listening, setListening] = useState<"off" | "on" | "always">("off");
  const [heard, setHeard] = useState<string | null>(null);
  const [skips, setSkips] = useState<typeof SKIP_TARGETS>([]);
  const fab = useRef<HTMLButtonElement>(null);
  const rec = useRef<InstanceType<NonNullable<ReturnType<typeof recognitionCtor>>> | null>(null);
  const always = useRef(false);
  const mounted = useRef(false);
  const runRef = useRef<(cmd: Command, from: "keys" | "voice") => void>(() => {});

  // ----- start-up: attributes on <html>, and resume a guide interrupted by a reload (reduce motion) -----
  useEffect(() => {
    applyToHtml();
    try {
      const r = sessionStorage.getItem(RESUME_KEY);
      if (r) {
        sessionStorage.removeItem(RESUME_KEY);
        const o = JSON.parse(r) as { guide?: number; panel?: boolean };
        const t = setTimeout(() => { if (typeof o.guide === "number") setGuide({ open: true, step: o.guide }); if (o.panel) setPanel(true); }, 0);
        return () => clearTimeout(t);
      }
    } catch { /* nothing to resume */ }
  }, []);

  // ----- skip links: the content, plus the explorer's parts when they exist -----
  useEffect(() => {
    const t = setTimeout(() => setSkips(SKIP_TARGETS.filter((x) => document.querySelector(`[data-tour="${x.id}"]`))), 800);
    return () => clearTimeout(t);
  }, [pathname]);

  const jump = (sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // ----- voice: say what gets focus, what live regions announce, and each new page -----
  useEffect(() => {
    if (!s.on || !s.voice) return;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (!(el instanceof HTMLElement) || el === document.body) return;
      const text = describeElement(el);
      if (text) speak(text);
    };
    const last = new WeakMap<Element, string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<Element>();
    const LIVE = "[aria-live], [role='status'], [role='alert']";
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        const node = m.target instanceof Element ? m.target : m.target.parentElement;
        // The region the change is in, and regions that arrive with their message already in them
        // (an error, "nothing found", the game's explanation): there the change is on the parent.
        const regions: (Element | null | undefined)[] = [node?.closest(LIVE)];
        m.addedNodes.forEach((n) => { if (n instanceof Element) regions.push(n.matches(LIVE) ? n : null, ...n.querySelectorAll(LIVE)); });
        for (const region of regions) if (region && !region.closest(".a11y-root")) pending.add(region);
      }
      if (!pending.size) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const r of pending) {
          if (r.getAttribute("aria-busy") === "true") continue;
          const t = liveText(r).slice(0, 500);
          if (!t || last.get(r) === t) continue;
          last.set(r, t);
          speak(t, { interrupt: false });
        }
        pending.clear();
      }, 500);
    });
    document.addEventListener("focusin", onFocus);
    mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => { document.removeEventListener("focusin", onFocus); mo.disconnect(); if (timer) clearTimeout(timer); };
  }, [s.on, s.voice]);

  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (!s.on || !s.voice) return;
    const t = setTimeout(() => speak(`${document.title.split("·")[0].trim()} page.`), 700);
    return () => clearTimeout(t);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- the master switch -----
  const turn = (on: boolean) => {
    setSettings({ on });
    if (!on) { stopListening(); setHelp(false); return; }
    {
      stopSpeech();
      if (!guideSeen()) { setPanel(false); setGuide({ open: true, step: 0 }); }
      else speak("Accessibility mode on.");
    }
  };
  const closeGuide = useCallback(() => { markGuide(); setGuide((g) => ({ ...g, open: false })); }, []);

  // Reduce motion takes full effect on a fresh page (the globe and films decide at load), so the
  // page reloads and comes back where it was: same guide step, same panel.
  const onMotion = (step: number | null) => {
    try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ guide: step, panel: step === null ? panel : false })); } catch { /* fine */ }
    setTimeout(() => window.location.reload(), 350);
  };

  // ----- commands (keyboard shortcuts and the microphone share them) -----
  const readPage = useCallback(() => {
    if (!getSettings().voice) setSettings({ voice: true });
    speak(pageText());
  }, []);

  const listenOnce = useCallback((keep = false) => {
    const Ctor = recognitionCtor();
    if (!Ctor) { speak("Voice commands aren't available in this browser.", { force: true }); return; }
    rec.current?.abort();
    const r = new Ctor();
    rec.current = r;
    r.lang = "en-US"; r.interimResults = false; r.continuous = false; r.maxAlternatives = 1;
    always.current = keep || always.current;
    setListening(always.current ? "always" : "on");
    stopSpeech();
    r.onresult = (e) => {
      if (spokeWithin(1200)) return;   // the microphone heard the site's own voice, not a command
      const text = e.results[e.results.length - 1][0].transcript;
      setHeard(text);
      const cmd = parseCommand(text);
      if (cmd) runRef.current(cmd, "voice"); else speak(`I heard "${text}" but don't know that command. Say help for the list.`, { force: true });
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      // Anything else (no microphone, no network) fails the same way on the next try: stop, don't loop.
      always.current = false;
      speak(e.error === "not-allowed" || e.error === "service-not-allowed" ? "The microphone isn't allowed. Check the browser's permission for this site."
        : "Voice commands aren't working right now. Check the microphone and the connection.", { force: true });
    };
    r.onend = () => {
      if (rec.current !== r) return;   // stopped, or replaced by a newer one
      const again = () => {
        if (rec.current !== r) return;
        if (!always.current) { setListening("off"); return; }
        // Keep listening: the microphone stays closed while the site talks, or it hears itself.
        if (spokeWithin(0)) { setTimeout(again, 300); return; }
        try { r.start(); } catch { setListening("off"); }
      };
      again();
    };
    try { r.start(); } catch { setListening("off"); }
  }, []);

  const stopListening = useCallback(() => { always.current = false; rec.current?.abort(); rec.current = null; setListening("off"); }, []);

  const run = useCallback((cmd: Command, from: "keys" | "voice") => {
    const st = useSelection.getState();
    const onExplorer = window.location.pathname.startsWith("/explore");
    if (guide.open) {
      // The guide is modal: the panel waits under it, and leaving the page closes it (the
      // explorer's own tour would open underneath and take the focus).
      if (cmd.kind === "panel") return;
      if (cmd.kind === "go" || (cmd.kind === "region" && !onExplorer)) closeGuide();
    }
    switch (cmd.kind) {
      case "panel": setPanel((p) => !p); break;
      case "help": setHelp(true); break;
      case "stop": stopSpeech(); break;
      case "read": readPage(); break;
      case "go": { speak(`Opening ${cmd.to === "/" ? "the story" : cmd.to === "/explore" ? "the explorer" : cmd.to === "/method" ? "the Method page" : "the game"}.`); router.push(cmd.to); break; }
      case "text": { const t = stepText(getSettings().text, cmd.dir); setSettings({ text: t }); speak(`Text size ${t} percent.`); break; }
      case "contrast": setSettings({ contrast: cmd.on }); speak(`High contrast ${cmd.on ? "on" : "off"}.`); break;
      case "motion": setSettings({ motion: cmd.on }); speak(`Reduce motion ${cmd.on ? "on" : "off"}. Reloading.`); onMotion(null); break;
      case "region": {
        const r = REGIONS[cmd.id];
        if (onExplorer) st.setAoi({ type: "region", region_id: cmd.id }, r.label, { month: r.month, shape: bboxShape(r.bbox) });
        else router.push(`/explore?region=${cmd.id}&month=${r.month}`);
        speak(`${r.label}.`);
        break;
      }
      case "month": {
        if (!onExplorer) { speak("Open the explorer first.", { force: true }); break; }
        // Only months the calendar shows (observed ones are buttons; "not observed" months aren't).
        const shown = Array.from(document.querySelectorAll<HTMLElement>("button.cal-cell")).map((b) => monthFromLabel(b.getAttribute("aria-label") ?? "")).filter((m): m is string => m !== null);
        const m = neighbourMonth(shown, st.month, cmd.dir);
        if (m) st.selectMonth(m);   // the answer's live region reads the new month
        else speak(cmd.dir === 1 ? "That's the newest month." : "That's the first month.", { force: true });
        break;
      }
      case "view": {
        if (!onExplorer) { speak("Open the explorer first.", { force: true }); break; }
        st.setView(cmd.view); speak(`${cmd.view === "harmonized" ? "Harmonized" : cmd.view.toUpperCase()} view.`); break;
      }
      case "click": {
        if (cmd.name === "__voice") { const v = !getSettings().voice; setSettings({ voice: v }); speak(`Voice reading ${v ? "on" : "off"}.`); break; }
        if (cmd.name === "__mic") { if (listening !== "off") stopListening(); else listenOnce(); break; }
        const el = findControl(cmd.name);
        if (el) { speak(`${cmd.name}.`); el.focus(); el.click(); } else speak(`I can't find ${cmd.name} on this page.`, { force: from === "voice" });
        break;
      }
    }
  }, [router, readPage, listenOnce, stopListening, listening, guide.open, closeGuide]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { runRef.current = run; }, [run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.altKey) { stopSpeech(); setHelp(false); return; }
      // In a text field Alt + key types a character (a Mac's Option + A is å, a Spanish keyboard's Option + 2 is @).
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.matches("textarea, input:not([type='checkbox'], [type='radio'], [type='range'])"))) return;
      const cmd = shortcut(e);
      if (!cmd) return;
      if (cmd.kind !== "panel" && !getSettings().on) return;   // Alt + A always works, the rest with the mode
      e.preventDefault();
      run(cmd, "keys");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run]);

  // ----- the panel: Escape closes, focus returns to the button -----
  useEffect(() => {
    if (!panel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setPanel(false); fab.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (!(e.target as Element).closest(".a11y-panel, .a11y-fab")) setPanel(false); };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    document.querySelector<HTMLElement>(".a11y-panel [role='switch']")?.focus();
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [panel]);

  const listen = canListen();
  return (
    <div className="a11y-root">
      {/* Skip links: first in the tab order on every page */}
      <nav className="a11y-skips" aria-label="Skip links">
        <a href="#main" onClick={(e) => { e.preventDefault(); jump("main, .explorer, .game-main"); }}>Skip to content</a>
        {skips.map((x) => <a key={x.id} href={`#${x.id}`} onClick={(e) => { e.preventDefault(); jump(`[data-tour="${x.id}"]`); }}>{x.label}</a>)}
        <a href="#a11y" onClick={(e) => { e.preventDefault(); setPanel(true); }}>Accessibility options (Alt + A)</a>
      </nav>

      <button ref={fab} type="button" className="a11y-fab" data-on={s.on || undefined} aria-expanded={panel} aria-controls="a11y-panel"
              aria-label={s.on ? "Accessibility mode is on. Open the options" : "Accessibility options"} title="Accessibility (Alt + A)"
              onClick={() => setPanel((p) => !p)}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="4.5" r="1.9" fill="currentColor" stroke="none" />
          <path d="M4 8.5c5.3 1.4 10.7 1.4 16 0M12 9.5v4.5M12 14l-3.2 6.5M12 14l3.2 6.5" />
        </svg>
        <span className="a11y-fab-text">Accessibility</span>
      </button>

      {panel && (
        <section id="a11y-panel" className="a11y-panel" role="dialog" aria-labelledby="a11y-title">
          <div className="a11y-head">
            <h2 id="a11y-title">Accessibility</h2>
            <button type="button" className="a11y-x" onClick={() => { setPanel(false); fab.current?.focus(); }} aria-label="Close">×</button>
          </div>
          <Switch id="a11y-on" label="Accessibility mode" checked={s.on} onChange={turn}
                  hint="Screen reading by voice, bigger text, high contrast, reduced motion and full keyboard control. A guide shows how." />
          {s.on ? (
            <>
              <TextSizeControl />
              <SettingSwitch k="contrast" label="High contrast" hint="Black and white, thick outlines, underlined links" />
              <SettingSwitch k="motion" label="Reduce motion" hint="Stills instead of the globe, films and transitions (reloads the page)" onAfter={() => onMotion(null)} />
              <SettingSwitch k="keys" label="Keyboard mode" hint="Always-visible focus ring, skip links, Alt shortcuts" />
              <SettingSwitch k="voice" label="Voice reading" hint={canSpeak() ? "Says what you focus on and reads the answer" : "This browser has no speech voice"} />
              <div className="a11y-actions">
                <button type="button" className="chip-btn" onClick={readPage}>Read this page</button>
                {listen && (listening === "off"
                  ? <button type="button" className="chip-btn" onClick={() => listenOnce()}>🎤 Say a command</button>
                  : <button type="button" className="chip-btn a11y-listening" onClick={stopListening} aria-pressed="true">● Listening… stop</button>)}
                <button type="button" className="chip-btn" onClick={() => setHelp(true)}>Shortcuts and commands</button>
                <button type="button" className="chip-btn" onClick={() => { setPanel(false); setGuide({ open: true, step: 0 }); }}>Open the guide</button>
              </div>
              {listen && <Switch id="a11y-always" label="Keep listening" hint="The microphone stays on for commands until you turn it off" checked={listening === "always"}
                                 onChange={(v) => (v ? listenOnce(true) : stopListening())} />}
              {heard && <p className="a11y-heard" role="status">Heard: “{heard}”</p>}
            </>
          ) : (
            <p className="a11y-hint">Turn it on to choose text size, contrast, motion, keyboard and voice settings. Alt + A opens this panel anywhere.</p>
          )}
        </section>
      )}

      {guide.open && <Guide step={guide.step} paused={help} onClose={closeGuide} onReadPage={readPage} onListen={listen ? () => listenOnce() : null} onMotion={onMotion} />}

      {/* After the guide, so "Alt + K" pressed inside the guide shows on top of it. */}
      {help && (
        <div className="a11y-scrim" onClick={() => setHelp(false)}>
          <div className="a11y-guide a11y-help" role="dialog" aria-modal="true" aria-labelledby="a11y-help-title" onClick={(e) => e.stopPropagation()}>
            <div className="a11y-guide-head"><h2 id="a11y-help-title">Shortcuts and voice commands</h2><button type="button" className="a11y-skip" onClick={() => setHelp(false)} autoFocus>Close</button></div>
            <h3>Keyboard</h3>
            <dl className="a11y-keys">{SHORTCUTS.map((x) => <div key={x.keys}><dt><kbd>{x.keys}</kbd></dt><dd>{x.does}</dd></div>)}</dl>
            <h3>Say</h3>
            <p className="a11y-say">“open the explorer” · “method” · “play the game” · “home” · “read the page” · “stop” · “bigger text” · “smaller text” · “high contrast” / “contrast off” · “reduce motion” · “Nile Delta” · “Río Negro” · “next month” · “previous month” · “show MODIS” / “VIIRS” / “harmonized” · “click Download” · “help”</p>
          </div>
        </div>
      )}

    </div>
  );
}
