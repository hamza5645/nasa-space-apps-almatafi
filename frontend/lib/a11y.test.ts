import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, describe, htmlAttributes, monthFromLabel, neighbourMonth, parseCommand, parseSettings, shiftMonth, shortcut, stepText, GUIDE, SHORTCUTS } from "./a11y.ts";

test("settings: defaults, saved values, junk", () => {
  assert.deepEqual(parseSettings(null), DEFAULTS);
  assert.deepEqual(parseSettings("not json"), DEFAULTS);
  assert.deepEqual(parseSettings('{"on":true,"text":130,"contrast":true}'), { ...DEFAULTS, on: true, text: 130, contrast: true });
  assert.equal(parseSettings('{"text":999}').text, 100);
  assert.equal(parseSettings('{"voice":"yes"}').voice, DEFAULTS.voice);
  assert.equal(parseSettings('[1,2]').on, false);
});

test("html attributes: nothing while off, one per feature while on", () => {
  const off = htmlAttributes({ ...DEFAULTS, text: 150, contrast: true });
  assert.ok(Object.values(off).every((v) => v === null));
  const on = htmlAttributes({ on: true, text: 150, contrast: true, motion: false, keys: true, voice: false });
  assert.deepEqual(on, { "data-a11y": "on", "data-a11y-text": "150", "data-a11y-contrast": "high", "data-a11y-motion": null, "data-a11y-keys": "on", "data-a11y-voice": null });
  assert.equal(htmlAttributes({ ...DEFAULTS, on: true })["data-a11y-text"], null);
});

test("text size steps and stays in range", () => {
  assert.equal(stepText(100, 1), 115);
  assert.equal(stepText(150, 1), 150);
  assert.equal(stepText(115, -1), 100);
  assert.equal(stepText(100, -1), 100);
});

test("describe: name, role and state in one sentence", () => {
  assert.equal(describe({ tag: "button", name: "Tour", pressed: null }), "Tour, button");
  assert.equal(describe({ tag: "button", name: "Nile Delta", pressed: "true" }), "Nile Delta, button, pressed");
  assert.equal(describe({ tag: "a", name: "Method", current: "page" }), "Method, link, current page");
  assert.equal(describe({ tag: "input", type: "checkbox", name: "High contrast", checked: false }), "High contrast, checkbox, not checked");
  assert.equal(describe({ tag: "button", role: "switch", name: "Voice reading", checked: true }), "Voice reading, switch, checked");
  assert.equal(describe({ tag: "select", name: "From", value: "2001" }), "From, menu, 2001");
  assert.equal(describe({ tag: "button", name: "Area: Nile Delta", expanded: "false" }), "Area: Nile Delta, button, collapsed");
  assert.equal(describe({ tag: "h2", name: "The burning  calendar", level: 2 }), "The burning calendar, heading level 2");
  assert.equal(describe({ tag: "button", name: "Back", disabled: true }), "Back, button, unavailable");
  assert.equal(describe({ tag: "div", name: "" }), "");
});

test("voice commands", () => {
  assert.deepEqual(parseCommand("Open the explorer"), { kind: "go", to: "/explore" });
  assert.deepEqual(parseCommand("go to the method page"), { kind: "go", to: "/method" });
  assert.deepEqual(parseCommand("play the game"), { kind: "go", to: "/play" });
  assert.deepEqual(parseCommand("take me home"), { kind: "go", to: "/" });
  assert.deepEqual(parseCommand("read the page"), { kind: "read" });
  assert.deepEqual(parseCommand("stop"), { kind: "stop" });
  assert.deepEqual(parseCommand("bigger text please"), { kind: "text", dir: 1 });
  assert.deepEqual(parseCommand("smaller"), { kind: "text", dir: -1 });
  assert.deepEqual(parseCommand("high contrast"), { kind: "contrast", on: true });
  assert.deepEqual(parseCommand("contrast off"), { kind: "contrast", on: false });
  assert.deepEqual(parseCommand("reduce motion"), { kind: "motion", on: true });
  assert.deepEqual(parseCommand("turn animations back on"), { kind: "motion", on: false });
  assert.deepEqual(parseCommand("reduce motion on"), { kind: "motion", on: true });
  assert.deepEqual(parseCommand("turn on reduce motion"), { kind: "motion", on: true });
  assert.deepEqual(parseCommand("reduce motion off"), { kind: "motion", on: false });
  assert.deepEqual(parseCommand("turn off reduce motion"), { kind: "motion", on: false });
  assert.deepEqual(parseCommand("animations off"), { kind: "motion", on: true });
  assert.deepEqual(parseCommand("reduce animations"), { kind: "motion", on: true });
  assert.deepEqual(parseCommand("click next"), { kind: "click", name: "next" });
  assert.deepEqual(parseCommand("press back"), { kind: "click", name: "back" });
  assert.deepEqual(parseCommand("click next question"), { kind: "click", name: "next question" });
  assert.deepEqual(parseCommand("show the Nile Delta"), { kind: "region", id: "nile-delta" });
  assert.deepEqual(parseCommand("Río Negro"), { kind: "region", id: "rio-negro" });
  assert.deepEqual(parseCommand("next month"), { kind: "month", dir: 1 });
  assert.deepEqual(parseCommand("previous month"), { kind: "month", dir: -1 });
  assert.deepEqual(parseCommand("show VIIRS only"), { kind: "view", view: "viirs" });
  assert.deepEqual(parseCommand("harmonised"), { kind: "view", view: "harmonized" });
  assert.deepEqual(parseCommand("click download"), { kind: "click", name: "download" });
  assert.deepEqual(parseCommand("what can I say"), { kind: "help" });
  assert.deepEqual(parseCommand("open accessibility settings"), { kind: "panel" });
  assert.equal(parseCommand("blah blah"), null);
  assert.equal(parseCommand(""), null);
});

test("month arithmetic", () => {
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-07", 0), "2026-07");
});

test("Alt shortcuts, by physical key so a Mac's Alt symbols don't matter", () => {
  const k = (code: string, key = "", mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
    shortcut({ key, code, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });
  assert.deepEqual(k("KeyA", "å"), { kind: "panel" });
  assert.deepEqual(k("KeyR", "®"), { kind: "read" });
  assert.deepEqual(k("Digit2", "™"), { kind: "go", to: "/explore" });
  assert.deepEqual(k("Equal", "≠"), { kind: "text", dir: 1 });
  assert.deepEqual(k("Equal", "+", { shiftKey: true }), { kind: "text", dir: 1 });
  assert.deepEqual(k("Minus", "–"), { kind: "text", dir: -1 });
  assert.equal(k("KeyA", "a", { ctrlKey: true }), null);
  assert.equal(k("KeyA", "A", { shiftKey: true }), null);
  assert.equal(shortcut({ key: "a", code: "KeyA", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }), null);
  assert.equal(k("KeyZ", "z"), null);
});

test("guide and shortcut list are complete", () => {
  assert.deepEqual(GUIDE.map((g) => g.id), ["welcome", "text", "contrast", "keyboard", "voice", "done"]);
  assert.ok(GUIDE.every((g) => g.title && g.text && g.speak));
  assert.ok(SHORTCUTS.length >= 8);
});

test("months from the calendar's labels, and the neighbour", () => {
  assert.equal(monthFromLabel("October 2026: 589 hotspots, observed, 11% cloud"), "2026-10");
  assert.equal(monthFromLabel("January 2001: 3 hotspots"), "2001-01");
  assert.equal(monthFromLabel("2026 total: 1,004"), null);
  assert.equal(monthFromLabel("Smarch 2026: 1"), null);
  const shown = ["2026-10", "2026-08", "2026-09", "2025-12", "2026-10"];
  assert.equal(neighbourMonth(shown, "2026-09", 1), "2026-10");
  assert.equal(neighbourMonth(shown, "2026-10", 1), null);
  assert.equal(neighbourMonth(shown, "2026-08", -1), "2025-12");
  assert.equal(neighbourMonth(shown, null, 1), "2026-10");
  assert.equal(neighbourMonth([], "2026-10", 1), null);
});
