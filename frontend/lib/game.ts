// X33: "Normal or not?", a game in five chapters built on Almatafi's own record. Every number
// comes from the demo regions' offline copy (public/cache/), the globe's real FIRMS week, or
// map snapshots taken from our own explorer (public/game/maps/), so the game teaches exactly
// what the calendar does. Each question has two answers (the player's character runs to one
// of two blocks). Pure functions, tested in lib/game.test.ts; the page builds the chapters at
// build time.

import type { Stats, Status } from "./api.ts";
import { compare, type Grid } from "./compare.ts";
import { MONTHS_LONG, fmt, parseYm } from "./format.ts";

export type Choice = { id: string; label: string };

export type Illus = "hotspot" | "pixels" | "years" | "trap" | "map";

/** What a question shows (and how it changes once answered). */
export type Visual =
  | { type: "years"; monthName: string; year: number; value: number; past: { year: number; value: number }[]; typical: number }
  | { type: "versus"; left: Side; right: Side; after: { left: number; right: number; label: string } | null }
  | { type: "months"; values: (number | null)[]; peak: number }
  | { type: "trap"; raw: [number, number]; ours: [number, number] }
  | { type: "map"; src: string; dots: number; label: string }
  | { type: "maps"; left: { src: string; dots: number }; right: { src: string; dots: number } }
  | { type: "illus"; name: Illus };

export type Side = { title: string; value: number; sensor: "MODIS" | "VIIRS" | null; note: string };

export type Round = {
  id: string;
  region: string | null;       // demo region id, or null for general rounds
  place: string;               // "Nile Delta, Egypt"
  prompt: string;
  context: string | null;
  choices: [Choice, Choice];
  answer: string;              // a choice id
  explain: string;
  visual: Visual;
  link: string | null;         // the case in the explorer
};

export type Chapter = {
  id: string;
  title: string;
  tagline: string;             // one line on the level map
  illus: Illus;
  intro: string[];             // the illustrated intro, two or three short lines
  learned: string;             // shown when the chapter is done
  rounds: Round[];
};

export type RegionDoc = {
  region: { region_id: string; name: string; country: string; default_month: string; story?: string };
  calendar: Record<"harmonized" | "modis" | "viirs", { detections?: Grid & { month_medians?: (number | null)[] } }>;
  stats: Record<string, Stats>;
};

export type Week = { dates: [string, string]; modis: number; viirs: number };
export type MapShots = Record<string, { dots: number }>;

const n = (v: number) => fmt(Math.round(v));
const monthOf = (ym: string) => MONTHS_LONG[parseYm(ym)[1] - 1];
const explore = (region: string, month: string) => `/explore?region=${region}&month=${month}`;
const placeOf = (d: RegionDoc) => `${d.region.name}, ${d.region.country}`;
const SAY: Record<Status, string> = { below_normal: "below normal", normal: "within the normal range", above_normal: "above normal", unusual_high: "unusually high" };
const NORMAL_CHOICES: [Choice, Choice] = [{ id: "normal", label: "Normal" }, { id: "not", label: "Not normal" }];

/** Months worth asking about: judged against 10+ past years, not in progress, busy enough. */
export function judgeable(s: Stats, minMedian = 15): boolean {
  return s.status !== null && s.partial === null && s.baseline.n_years >= 10 && (s.baseline.median ?? 0) >= minMedian;
}

/** "Normal or not?" for one month, its past years drawn as flames (or its map). */
export function statusRound(doc: RegionDoc, s: Stats, map?: { src: string; dots: number } | null): Round {
  const r = doc.region, [year] = parseYm(s.month), month = monthOf(s.month);
  const typical = s.baseline.median ?? 0;
  const normal = s.status === "normal";
  const z = s.z === null ? "" : ` (z ${s.z > 0 ? "+" : ""}${fmt(s.z, 1)})`;
  const ratio = typical > 0 ? s.value / typical : null;
  const how = ratio === null ? "" : ratio >= 1.95 ? `, ${fmt(ratio, 1)} times a typical ${month}` : ratio < 0.8 ? `, ${fmt(Math.round(ratio * 100))}% of a typical ${month}` : "";
  return {
    id: `status-${r.region_id}-${s.month}${map ? "-map" : ""}`, region: r.region_id, place: placeOf(doc),
    prompt: map ? `This map is ${month} ${year}: ${n(s.value)} hotspots. Normal for ${month}?` : `${month} ${year}: ${n(s.value)} hotspots. Normal for ${month}?`,
    context: `A typical ${month} here has ${n(typical)}.`,
    choices: NORMAL_CHOICES, answer: normal ? "normal" : "not",
    explain: `${normal ? "Normal" : "Not normal"}: ${SAY[s.status!]}${z}${how}.` +
      `${s.rank ? ` It ranks ${s.rank} of ${s.baseline.n_years + 1} ${month}s.` : ""} The calendar asks this for any place on Earth.`,
    visual: map ? { type: "map", src: map.src, dots: map.dots, label: `${r.name}, ${month} ${year}` }
                : { type: "years", monthName: month, year, value: s.value, past: s.baseline.values.map((v) => ({ year: v.year, value: v.value })), typical },
    link: explore(r.region_id, s.month),
  };
}

/** Status months to ask about: the showcase month, or the busiest month with a given status. */
export function pickStatus(doc: RegionDoc, want: "case" | Status): Stats | null {
  if (want === "case") {
    const s = doc.stats[doc.region.default_month];
    return s && s.status && s.partial === null ? s : null;
  }
  return Object.values(doc.stats).filter((s) => judgeable(s) && s.status === want && s.month !== doc.region.default_month)
    .sort((a, b) => (b.baseline.median ?? 0) - (a.baseline.median ?? 0) || b.month.localeCompare(a.month))[0] ?? null;
}

/** "Which year burned more?" where raw counts point the wrong way (MODIS year vs VIIRS year). */
export function higherRound(doc: RegionDoc): Round | null {
  const { harmonized: h, modis: m, viirs: v } = doc.calendar;
  if (!h.detections || !m.detections || !v.detections) return null;
  const at = (g: Grid, y: number, j: number) => { const i = g.years.indexOf(y); return i < 0 ? null : g.matrix[i][j]; };
  let best: { y1: number; y2: number; j: number; r1: number; r2: number; h1: number; h2: number; score: number } | null = null;
  for (let j = 0; j < 12; j++) for (let y1 = 2003; y1 <= 2011; y1++) for (let y2 = 2013; y2 <= 2025; y2++) {
    const r1 = at(m.detections, y1, j), r2 = at(v.detections, y2, j), h1 = at(h.detections, y1, j), h2 = at(h.detections, y2, j);
    if (r1 === null || r2 === null || h1 === null || h2 === null) continue;
    if (r1 < 5 || h2 < 5 || r2 < 1.5 * r1 || h1 < 1.15 * h2) continue;
    const score = (r2 / r1) * (h1 / h2);
    if (!best || score > best.score) best = { y1, y2, j, r1, r2, h1, h2, score };
  }
  if (!best) return null;
  const r = doc.region, month = MONTHS_LONG[best.j], { y1, y2 } = best;
  return {
    id: `higher-${r.region_id}-${y1}-${y2}`, region: r.region_id, place: placeOf(doc),
    prompt: `Which ${month} really burned more?`,
    context: `MODIS counted ${n(best.r1)} hotspots in ${month} ${y1}. VIIRS counted ${n(best.r2)} in ${month} ${y2}.`,
    choices: [{ id: String(y1), label: `${month} ${y1}` }, { id: String(y2), label: `${month} ${y2}` }], answer: String(y1),
    explain: `${y1} burned more: ${n(best.h1)} against ${n(best.h2)} on our record. VIIRS's sharper pixels find several times more ` +
      `hotspots for the same fires, so a MODIS year and a VIIRS year can't be compared raw. That's why we harmonize.`,
    visual: { type: "versus",
      left: { title: `${month} ${y1}`, value: best.r1, sensor: "MODIS", note: "1 km pixels" },
      right: { title: `${month} ${y2}`, value: best.r2, sensor: "VIIRS", note: "375 m pixels" },
      after: { left: best.h1, right: best.h2, label: "On our harmonized record" } },
    link: explore(r.region_id, `${y1}-${String(best.j + 1).padStart(2, "0")}`),
  };
}

/** The 2012 trap: the raw join jumps when VIIRS arrives; the harmonized record doesn't. */
export function trapRound(doc: RegionDoc): Round | null {
  const { harmonized: h, modis: m, viirs: v } = doc.calendar;
  if (!h.detections || !m.detections || !v.detections) return null;
  const c = compare(h.detections, m.detections, v.detections);
  if (c.rawJump === null || c.harmJump === null || c.rawJump < 1.8 || c.harmJump > 1.6 || c.harmJump < 0.6) return null;
  const means = (mx: (number | null)[][]) => {
    let a = 0, na = 0, b = 0, nb = 0;
    c.years.forEach((y, i) => mx[i].forEach((x, j) => { if (x === null) return; if (y * 12 + j < 2012 * 12 + 1) { b += x; nb++; } else { a += x; na++; } }));
    return [nb ? b / nb : 0, na ? a / na : 0] as [number, number];
  };
  const r = doc.region;
  return {
    id: `trap-${r.region_id}`, region: r.region_id, place: placeOf(doc),
    prompt: `Glued together, MODIS then VIIRS, the average month jumps ${fmt(c.rawJump, 1)}× in 2012. Did burning really jump?`,
    context: null,
    choices: [{ id: "yes", label: "Yes, fires surged" }, { id: "no", label: "No, the satellite changed" }], answer: "no",
    explain: `The satellite changed. VIIRS (375 m pixels) joined MODIS (1 km) in 2012 and finds smaller fires. On our harmonized record ` +
      `the same comparison is ${fmt(c.harmJump, 2)}×.`,
    visual: { type: "trap", raw: means(c.raw), ours: means(c.harmonized) },
    link: explore(r.region_id, r.default_month),
  };
}

/** "Which month is the season?" between the peak month and the quietest one. */
export function seasonRound(doc: RegionDoc, map?: { src: string; dots: number; month: string } | null): Round | null {
  const meds = doc.calendar.harmonized.detections?.month_medians;
  if (!meds || meds.every((x) => x === null)) return null;
  let peak = 0, low = 0;
  meds.forEach((x, j) => { if ((x ?? -1) > (meds[peak] ?? -1)) peak = j; if ((x ?? Infinity) < (meds[low] ?? Infinity)) low = j; });
  if (map) peak = parseYm(map.month)[1] - 1;
  if (peak === low) return null;
  const r = doc.region, ids = [peak, low].sort((a, b) => a - b);
  return {
    id: `season-${r.region_id}${map ? "-map" : ""}`, region: r.region_id, place: placeOf(doc),
    prompt: map ? `This map shows ${n(map.dots)} hotspots in one month. Which month is it?` : "In a typical year, which month burns most?",
    context: null,
    choices: ids.map((j) => ({ id: String(j), label: MONTHS_LONG[j] })) as [Choice, Choice], answer: String(peak),
    explain: `${MONTHS_LONG[peak]}: a typical ${MONTHS_LONG[peak]} has ${n(meds[peak] ?? 0)} hotspots, a typical ${MONTHS_LONG[low]} ` +
      `${n(meds[low] ?? 0)}.${r.story?.includes(MONTHS_LONG[peak]) ? ` ${r.story}` : ""} Knowing the season is how the calendar tells a heavy month from a normal one.`,
    visual: map ? { type: "map", src: map.src, dots: map.dots, label: r.name } : { type: "months", values: meds, peak },
    link: map ? explore(r.region_id, map.month) : null,
  };
}

/** The rounds from FIRMS's own guidance and the globe's real week. */
export function factRound(id: "hotspot" | "clouds" | "count" | "overpass" | "week", week: Week | null): Round | null {
  if (id === "hotspot") return {
    id: "fact-hotspot", region: null, place: "Anywhere on Earth", prompt: "Is every hotspot a fire?", context: "A hotspot is one pixel that looked hot from orbit.",
    choices: [{ id: "yes", label: "Yes, always" }, { id: "no", label: "No, not always" }], answer: "no",
    explain: "Not always. Gas flares, volcanoes and hot factories make hotspots too. Our record leaves out cells that are hot month after month.",
    visual: { type: "illus", name: "hotspot" }, link: null,
  };
  if (id === "clouds") return {
    id: "fact-clouds", region: null, place: "Anywhere on Earth", prompt: "A field burns under thick cloud as the satellite passes. What does it record?", context: null,
    choices: [{ id: "spot", label: "A hotspot, through the cloud" }, { id: "nothing", label: "Nothing" }], answer: "nothing",
    explain: "Nothing: these sensors can't see through thick cloud. No hotspot is not proof of no fire, so the calendar marks the months that were mostly cloud.",
    visual: { type: "illus", name: "hotspot" }, link: null,
  };
  if (id === "count") return {
    id: "fact-count", region: null, place: "Anywhere on Earth", prompt: "The map shows ten hotspots in one field. Is that ten fires?", context: "Each dot is one hot pixel.",
    choices: [{ id: "ten", label: "Yes, ten fires" }, { id: "unknown", label: "Not necessarily" }], answer: "unknown",
    explain: "Not necessarily. One big fire can fill ten pixels, and several small fires can share one. So the calendar counts hotspots, not fires.",
    visual: { type: "illus", name: "pixels" }, link: null,
  };
  if (id === "overpass") return {
    id: "fact-overpass", region: "nile-delta", place: "Nile Delta, Egypt", prompt: "Farmers burn straw in the afternoon. Which satellite sees more of it?",
    context: "Terra passes over at 10:30, Aqua at 13:30.",
    choices: [{ id: "terra", label: "Terra, 10:30" }, { id: "aqua", label: "Aqua, 13:30" }], answer: "aqua",
    explain: "Aqua: it passes after the fires are lit. VIIRS crosses at the same time as Aqua, so we bridge MODIS to VIIRS through Aqua.",
    visual: { type: "illus", name: "pixels" }, link: null,
  };
  if (!week || week.modis <= 0 || week.viirs <= 0) return null;
  const k = week.viirs / week.modis;
  return {
    id: "fact-week", region: null, place: "The whole planet",
    prompt: `In one real week, MODIS found ${fmt(week.modis)} hotspots. Same fires: how many did VIIRS find?`, context: `${week.dates[0]} to ${week.dates[1]}`,
    choices: [{ id: "same", label: `About ${fmt(Math.round(week.modis / 1000) * 1000)}` }, { id: "more", label: fmt(week.viirs) }], answer: "more",
    explain: `${fmt(week.viirs)}, ${fmt(k, 1)} times more for the same fires. VIIRS's 375 m pixels catch fires MODIS's 1 km pixels miss.`,
    visual: { type: "versus", left: { title: "MODIS", value: week.modis, sensor: "MODIS", note: "1 km pixels" },
      right: { title: "VIIRS", value: week.viirs, sensor: "VIIRS", note: "375 m pixels" }, after: null },
    link: null,
  };
}

/** "Same month, two satellites: which map is VIIRS?" from two explorer snapshots. */
export function sensorMapRound(doc: RegionDoc, maps: MapShots, month: string): Round | null {
  const mo = maps["delta-modis"], vi = maps["delta-viirs"];
  if (!mo || !vi || !(vi.dots > mo.dots)) return null;
  const [y, m] = parseYm(month);
  return {
    id: "map-sensors", region: doc.region.region_id, place: placeOf(doc),
    prompt: `Same fires, same month (${MONTHS_LONG[m - 1]} ${y}), two satellites. Which map is VIIRS?`, context: null,
    choices: [{ id: "left", label: "Left map" }, { id: "right", label: "Right map" }], answer: "right",
    explain: `The right one: VIIRS mapped ${fmt(vi.dots)} hotspots, MODIS (on Aqua) ${fmt(mo.dots)}. Smaller pixels see smaller fires, ` +
      "which is why raw counts can't be glued together.",
    visual: { type: "maps", left: { src: "/game/maps/delta-modis.webp", dots: mo.dots }, right: { src: "/game/maps/delta-viirs.webp", dots: vi.dots } },
    link: explore(doc.region.region_id, month),
  };
}

const keep = (rs: (Round | null)[]) => rs.filter((r): r is Round => r !== null);

/** The five chapters. Rounds the data can't support are left out; an empty chapter goes. */
export function buildChapters(docs: RegionDoc[], week: Week | null, maps: MapShots): Chapter[] {
  const delta = docs.find((d) => d.region.region_id === "nile-delta"), rio = docs.find((d) => d.region.region_id === "rio-negro");
  const st = (d: RegionDoc | undefined, want: "case" | Status, map?: { src: string; dots: number } | null) => {
    const s = d ? pickStatus(d, want) : null;
    return d && s ? statusRound(d, s, map) : null;
  };
  const chapters: Chapter[] = [
    {
      id: "hotspots", title: "What's a hotspot?", tagline: "What the satellites actually see", illus: "hotspot",
      intro: ["Twice a day, satellites scan every place on Earth for heat.", "A pixel that looks hot is a hotspot: one dot on our map.", "But a dot isn't always a fire, and no dot isn't always no fire."],
      learned: "Hotspots are hot pixels: most are fires, some are flares or factories, and cloud hides fires.",
      rounds: keep([factRound("hotspot", week), factRound("clouds", week), factRound("count", week)]),
    },
    {
      id: "eyes", title: "Two eyes in orbit", tagline: "MODIS and VIIRS don't count alike", illus: "pixels",
      intro: ["MODIS has watched since 2000 with 1 km pixels.", "VIIRS joined in 2012 with 375 m pixels: sharper, so it finds smaller fires.", "Same fires, very different counts."],
      learned: "VIIRS counts several times more hotspots than MODIS for the same fires.",
      rounds: keep([factRound("week", week), delta ? sensorMapRound(delta, maps, delta.region.default_month) : null, factRound("overpass", week)]),
    },
    {
      id: "normal", title: "Normal or not?", tagline: "Judge a month against its past", illus: "years",
      intro: ["Every place has its fire season.", "To judge a month, compare it with the same month in every other year.", "Each flame is one past year. Is this year's tall, short, or like the rest?"],
      learned: "A month is only big or small next to the same month in other years.",
      rounds: keep([st(delta, "case"), st(rio, "normal"), st(delta, "below_normal")]),
    },
    {
      id: "trap", title: "The 2012 trap", tagline: "Don't glue raw records together", illus: "trap",
      intro: ["Glue MODIS's years to VIIRS's years and fire seems to explode in 2012.", "It didn't: the new satellite just sees more.", "Almatafi converts MODIS to what VIIRS would have counted."],
      learned: "Compare years only on a harmonized record, never raw MODIS against raw VIIRS.",
      rounds: keep([delta ? higherRound(delta) : null, delta ? trapRound(delta) : rio ? trapRound(rio) : null]),
    },
    {
      id: "map", title: "Read the map", tagline: "Put it all together", illus: "map",
      intro: ["Each dot on the map is one hotspot that month.", "Use the season and the past years to read it."],
      learned: "You can read a fire map like the calendar does: the season, the past, and the satellite.",
      rounds: keep([
        rio && maps["rio-2026-07"] ? st(rio, "case", { src: "/game/maps/rio-2026-07.webp", dots: maps["rio-2026-07"].dots }) : null,
        delta && maps["delta-2026-10"] ? seasonRound(delta, { src: "/game/maps/delta-2026-10.webp", dots: maps["delta-2026-10"].dots, month: delta.region.default_month }) : null,
        rio ? seasonRound(rio) : null,
      ]),
    },
  ];
  return chapters.filter((c) => c.rounds.length > 0);
}

/** 0–3 stars for a chapter. */
export function stars(right: number, total: number): number {
  if (!total) return 0;
  return right === total ? 3 : right / total >= 0.5 ? 2 : right > 0 ? 1 : 0;
}

/** Points for a right answer: 100, plus 25 per answer in the current streak before it. */
export function points(streak: number): number {
  return 100 + 25 * streak;
}
