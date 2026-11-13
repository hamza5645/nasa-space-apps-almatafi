// X33: "Normal or not?", a quiz built on Almatafi's own record. Every number in a round comes
// from the demo regions' offline copy (public/cache/) or the landing globe's real FIRMS week,
// so the game teaches exactly what the calendar does: read a month against its past, don't
// compare raw MODIS with raw VIIRS, and know what a hotspot is. Pure functions (tested in
// lib/game.test.ts); the page builds the pool at build time, the client picks rounds.

import type { Stats, Status } from "./api.ts";
import { compare, type Grid } from "./compare.ts";
import { MONTHS_LONG, fmt, parseYm } from "./format.ts";
import { usualRange } from "./verdict.ts";

export type Choice = { id: string; label: string };

export type Reveal =
  | { type: "strip"; monthName: string; year: number; value: number; past: { year: number; value: number }[]; range: [number, number] | null }
  | { type: "bars"; groups: { label: string; bars: { label: string; value: number; tone: "raw" | "ours" }[] }[] }
  | { type: "months"; values: (number | null)[]; peak: number }
  | { type: "trap"; raw: [number, number]; ours: [number, number] }
  | { type: "fact"; big: string; small: string };

export type Round = {
  id: string;
  kind: "status" | "higher" | "season" | "trap" | "fact";
  region: string | null;       // demo region id, or null for general rounds
  place: string;               // "Nile Delta, Egypt"
  prompt: string;
  context: string | null;      // a line of numbers shown with the question
  choices: Choice[];
  answer: string;              // a choice id
  explain: string;             // shown after answering
  reveal: Reveal;
  hint: Reveal | null;         // drawn with the question (the past years, without this one)
  link: string | null;         // the case in the explorer
};

export type RegionDoc = {
  region: { region_id: string; name: string; country: string; default_month: string; story?: string };
  calendar: Record<"harmonized" | "modis" | "viirs", { detections?: Grid & { month_medians?: (number | null)[] } }>;
  stats: Record<string, Stats>;
};

export type Week = { dates: [string, string]; modis: number; viirs: number };

export const STATUS_CHOICES: Choice[] = [
  { id: "below_normal", label: "Below normal" },
  { id: "normal", label: "Normal" },
  { id: "above_normal", label: "Above normal" },
  { id: "unusual_high", label: "Unusually high" },
];
const SAY: Record<Status, string> = { below_normal: "below normal", normal: "within the normal range", above_normal: "above normal", unusual_high: "unusually high" };

const n = (v: number) => fmt(Math.round(v));
const monthOf = (ym: string) => MONTHS_LONG[parseYm(ym)[1] - 1];
const explore = (region: string, month: string) => `/explore?region=${region}&month=${month}`;

/** Months worth asking about: judged against 10+ past years, not in progress, busy enough that
 *  the dots mean something. */
function judgeable(s: Stats, minMedian: number): boolean {
  return s.status !== null && s.partial === null && s.baseline.n_years >= 10 && (s.baseline.median ?? 0) >= minMedian;
}

function statusRound(doc: RegionDoc, s: Stats, tag: string): Round {
  const r = doc.region, place = `${r.name}, ${r.country}`;
  const [year] = parseYm(s.month), month = monthOf(s.month);
  const past = s.baseline.values.map((v) => ({ year: v.year, value: v.value }));
  const range = usualRange(s);
  const z = s.z === null ? "" : ` (z ${s.z > 0 ? "+" : ""}${fmt(s.z, 1)})`;
  return {
    id: `status-${r.region_id}-${s.month}-${tag}`, kind: "status", region: r.region_id, place,
    prompt: `${month} ${year}: ${n(s.value)} hotspots. Is that…`,
    context: `The dots are ${month} in the other ${s.baseline.n_years} years since ${s.baseline.years[0]}; the band is the middle half of them.`,
    choices: STATUS_CHOICES, answer: s.status!,
    explain: `${SAY[s.status!].replace(/^./, (c) => c.toUpperCase())}${z}. A typical ${month} here has ${n(s.baseline.median ?? 0)}` +
      `${s.rank ? `, and this one ranks ${s.rank} of ${s.baseline.n_years + 1}` : ""}. That is the question the calendar answers for any place.`,
    reveal: { type: "strip", monthName: month, year, value: s.value, past, range },
    hint: { type: "strip", monthName: month, year, value: Number.NaN, past, range },
    link: explore(r.region_id, s.month),
  };
}

/** One status round per status per region (the busiest, most recent cases), plus the region's
 *  showcase month. */
export function statusRounds(doc: RegionDoc): Round[] {
  const all = Object.values(doc.stats).filter((s) => judgeable(s, 15));
  const out: Round[] = [];
  const show = doc.stats[doc.region.default_month];
  if (show && show.status && show.partial === null) out.push(statusRound(doc, show, "case"));
  for (const st of ["unusual_high", "above_normal", "normal", "below_normal"] as Status[]) {
    const pick = all.filter((s) => s.status === st && s.month !== doc.region.default_month)
      .sort((a, b) => (b.baseline.median ?? 0) - (a.baseline.median ?? 0) || b.month.localeCompare(a.month))
      .slice(0, 2);
    pick.forEach((s) => out.push(statusRound(doc, s, st)));
  }
  return out;
}

/** "Which year burned more?" where the raw counts point the wrong way: MODIS in a year before
 *  2012 against VIIRS after, while the harmonized record says the earlier year burned more. */
export function higherRound(doc: RegionDoc): Round | null {
  const { harmonized: h, modis: m, viirs: v } = doc.calendar;
  if (!h.detections || !m.detections || !v.detections) return null;
  const at = (g: Grid, y: number, j: number) => { const i = g.years.indexOf(y); return i < 0 ? null : g.matrix[i][j]; };
  let best: { y1: number; y2: number; j: number; r1: number; r2: number; h1: number; h2: number; score: number } | null = null;
  for (let j = 0; j < 12; j++) {
    for (let y1 = 2003; y1 <= 2011; y1++) {
      for (let y2 = 2013; y2 <= 2025; y2++) {
        const r1 = at(m.detections, y1, j), r2 = at(v.detections, y2, j), h1 = at(h.detections, y1, j), h2 = at(h.detections, y2, j);
        if (r1 === null || r2 === null || h1 === null || h2 === null) continue;
        if (r1 < 5 || h2 < 5 || r2 < 1.5 * r1 || h1 < 1.15 * h2) continue;
        const score = (r2 / r1) * (h1 / h2);
        if (!best || score > best.score) best = { y1, y2, j, r1, r2, h1, h2, score };
      }
    }
  }
  if (!best) return null;
  const r = doc.region, month = MONTHS_LONG[best.j], { y1, y2 } = best;
  return {
    id: `higher-${r.region_id}-${y1}-${y2}-${best.j}`, kind: "higher", region: r.region_id, place: `${r.name}, ${r.country}`,
    prompt: `In which ${month} did more burn?`,
    context: `${month} ${y1}: MODIS counted ${n(best.r1)} hotspots. ${month} ${y2}: VIIRS counted ${n(best.r2)}.`,
    choices: [{ id: String(y1), label: `${month} ${y1}` }, { id: String(y2), label: `${month} ${y2}` }],
    answer: String(y1),
    explain: `${y1} burned more. On our record it is ${n(best.h1)} against ${n(best.h2)}. VIIRS's sharper pixels find several times ` +
      `more hotspots for the same fires, so a MODIS year and a VIIRS year can't be compared raw. That is why we harmonize.`,
    reveal: { type: "bars", groups: [
      { label: "Raw counts", bars: [{ label: `${y1} MODIS`, value: best.r1, tone: "raw" }, { label: `${y2} VIIRS`, value: best.r2, tone: "raw" }] },
      { label: "Our record", bars: [{ label: String(y1), value: best.h1, tone: "ours" }, { label: String(y2), value: best.h2, tone: "ours" }] },
    ] },
    hint: null, link: explore(r.region_id, `${y1}-${String(best.j + 1).padStart(2, "0")}`),
  };
}

/** "When does it burn most?" from the harmonized month medians. */
export function seasonRound(doc: RegionDoc): Round | null {
  const meds = doc.calendar.harmonized.detections?.month_medians;
  if (!meds || meds.every((x) => x === null)) return null;
  let peak = 0;
  meds.forEach((x, j) => { if ((x ?? -1) > (meds[peak] ?? -1)) peak = j; });
  const others = [3, 6, 9].map((k) => (peak + k) % 12);
  const ids = [peak, ...others].sort((a, b) => a - b);
  const r = doc.region;
  return {
    id: `season-${r.region_id}`, kind: "season", region: r.region_id, place: `${r.name}, ${r.country}`,
    prompt: `In a typical year, which month burns most?`, context: null,
    choices: ids.map((j) => ({ id: String(j), label: MONTHS_LONG[j] })), answer: String(peak),
    explain: `${MONTHS_LONG[peak]}: its median is ${n(meds[peak] ?? 0)} hotspots.${r.story?.includes(MONTHS_LONG[peak]) ? ` ${r.story}` : ""} Knowing the season ` +
      `is how the calendar can tell a heavy ${MONTHS_LONG[peak]} from a normal one.`,
    reveal: { type: "months", values: meds, peak }, hint: null, link: null,
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
    id: `trap-${r.region_id}`, kind: "trap", region: r.region_id, place: `${r.name}, ${r.country}`,
    prompt: `Glue its MODIS years to its VIIRS years and the average month jumps ${fmt(c.rawJump, 1)}× from 2012. Did burning really jump?`,
    context: null,
    choices: [{ id: "yes", label: "Yes, fires surged" }, { id: "no", label: "No, the satellite changed" }], answer: "no",
    explain: `The satellite changed. VIIRS (375 m pixels) joined MODIS (1 km) in 2012 and finds smaller fires. On our harmonized ` +
      `record the same comparison is ${fmt(c.harmJump, 2)}×.`,
    reveal: { type: "trap", raw: means(c.raw), ours: means(c.harmonized) }, hint: null, link: explore(r.region_id, r.default_month),
  };
}

/** General rounds from FIRMS's own guidance and the globe's real week. */
export function factRounds(week: Week | null): Round[] {
  const out: Round[] = [
    {
      id: "fact-hotspot", kind: "fact", region: null, place: "Anywhere",
      prompt: "Is every hotspot a fire?", context: null,
      choices: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }], answer: "no",
      explain: "A hotspot is a pixel that looked hot from orbit. Gas flares, volcanoes and hot industry make them too. Our record " +
        "leaves out cells that are hot month after month.",
      reveal: { type: "fact", big: "Not always", small: "Flares, volcanoes and factories can look like fire from orbit." }, hint: null, link: null,
    },
    {
      id: "fact-clouds", kind: "fact", region: null, place: "Anywhere",
      prompt: "A field burns under thick cloud as the satellite passes. What does it record?", context: null,
      choices: [{ id: "through", label: "A hotspot, seen through the cloud" }, { id: "nothing", label: "Nothing" }, { id: "weak", label: "A weaker hotspot" }],
      answer: "nothing",
      explain: "Nothing: these sensors can't see through thick cloud, so no hotspot doesn't mean no fire. The calendar marks the months " +
        "that were mostly cloud.",
      reveal: { type: "fact", big: "Hidden", small: "No hotspot is not proof of no fire." }, hint: null, link: null,
    },
    {
      id: "fact-overpass", kind: "fact", region: "nile-delta", place: "Nile Delta, Egypt",
      prompt: "Terra passes over at 10:30, Aqua at 13:30. Which sees more of the Delta's straw fires?", context: null,
      choices: [{ id: "terra", label: "Terra, in the morning" }, { id: "aqua", label: "Aqua, after midday" }], answer: "aqua",
      explain: "Aqua. Farmers burn in the afternoon, after Terra has gone by. That is why we bridge MODIS to VIIRS through Aqua, " +
        "which crosses at the same time as VIIRS.",
      reveal: { type: "fact", big: "13:30", small: "Aqua and VIIRS cross at the same time of day." }, hint: null, link: null,
    },
  ];
  if (week && week.modis > 0 && week.viirs > 0) {
    const k = week.viirs / week.modis;
    const opts = [1, 2, Math.round(k), 20].map((x) => Math.round((week.modis * x) / 1000) * 1000);
    const right = week.viirs;
    const choices = [
      { id: "a", label: `About ${fmt(opts[0])}` }, { id: "b", label: `About ${fmt(opts[1])}` },
      { id: "c", label: `${fmt(right)}` }, { id: "d", label: `About ${fmt(opts[3])}` },
    ];
    out.push({
      id: "fact-week", kind: "fact", region: null, place: "The whole planet",
      prompt: `One real week (${week.dates[0]} to ${week.dates[1]}): MODIS found ${fmt(week.modis)} hotspots. How many did VIIRS find?`,
      context: null, choices, answer: "c",
      explain: `${fmt(right)}, ${fmt(k, 1)} times more for the same fires. VIIRS's 375 m pixels catch fires MODIS's 1 km pixels miss.`,
      reveal: { type: "bars", groups: [{ label: "Same week, same planet", bars: [
        { label: "MODIS", value: week.modis, tone: "raw" }, { label: "VIIRS", value: week.viirs, tone: "ours" }] }] },
      hint: null, link: null,
    });
  }
  return out;
}

export function buildPool(docs: RegionDoc[], week: Week | null): Round[] {
  const pool: Round[] = [];
  for (const d of docs) {
    pool.push(...statusRounds(d));
    for (const f of [higherRound, seasonRound, trapRound]) {
      const r = f(d);
      if (r) pool.push(r);
    }
  }
  pool.push(...factRounds(week));
  return pool;
}

export const GAME_LENGTH = 7;
export const LIVES = 3;
// The order of round kinds in a game: a status round first (the core skill), the trap late.
const PLAN: Round["kind"][] = ["status", "higher", "status", "season", "fact", "trap", "status"];

/** A game: one round per PLAN slot, drawn from the pool without repeats; a slot whose kind has
 *  run out takes any unused round. The showcase months open the game half the time. */
export function pickGame(pool: Round[], rand: () => number = Math.random): Round[] {
  const left = [...pool];
  const take = (pred: (r: Round) => boolean) => {
    const c = left.filter(pred);
    if (!c.length) return null;
    const r = c[Math.floor(rand() * c.length)];
    left.splice(left.indexOf(r), 1);
    return r;
  };
  const game: Round[] = [];
  PLAN.forEach((kind, i) => {
    const first = i === 0 && rand() < 0.5 ? take((r) => r.id.endsWith("-case")) : null;
    const r = first ?? take((x) => x.kind === kind) ?? take(() => true);
    if (r) game.push(r);
  });
  return game.slice(0, GAME_LENGTH);
}

/** Points for a correct answer: 100, plus 25 for each answer in the current streak before it. */
export function points(streak: number): number {
  return 100 + 25 * streak;
}

export function verdictLine(correct: number, total: number, out: boolean): string {
  if (out) return `Out of embers after ${total} rounds. Fire data has traps; now you know three of them.`;
  if (correct === total) return "Every one right. You read a fire season the way the calendar does.";
  if (correct >= total - 2) return "Sharp eye. You can tell a heavy season from a sensor change.";
  return "A good start. The calendar does this for any place on Earth; try it on yours.";
}
