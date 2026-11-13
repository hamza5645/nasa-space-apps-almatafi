// What Wel3a (the flame guide, components/wel3a/) says without the AI: fun facts per page,
// and in the explorer the important points about the selected month. Pure, so it is tested.

import type { Metric, Stats, View } from "./api.ts";
import { verdict } from "./verdict.ts";
import { LIMITS } from "./wel3a-chat.ts";

export type Page = "home" | "explore" | "method" | "play";

const PAGE_NAME: Record<Page, string> = { home: "home (story)", explore: "explorer", method: "Method", play: "game" };

export function pageOf(pathname: string): Page {
  const first = pathname.split("/")[1];
  return first === "explore" || first === "method" || first === "play" ? first : "home";
}

/** The first tip of a page is its most important point; the rest are fun facts. */
export const FACTS: Record<Page, string[]> = {
  home: [
    "The one thing to remember: VIIRS counts several times more hotspots than MODIS for the same fires, over 10 times where fires are small. Glue the two records together and 2012 looks like the world caught fire.",
    "A hotspot isn't always a fire. Gas flares, volcanoes and factories glow hot from orbit too.",
    "Terra passes over at about 10:30 in the morning. Aqua and the VIIRS satellites come at about 1:30 in the afternoon, when fires are usually at their busiest.",
    "A fire doesn't have to fill a pixel to be seen. A hot one much smaller than the pixel is enough.",
    "Terra has watched fires since November 2000. The record is older than some of the people reading this.",
    "My name, ولعة, means a little flame in Egyptian Arabic.",
  ],
  explore: [
    "Pick an area, then click any month in the calendar. I'll tell you whether it was normal for that place.",
    "Read down a column to see the same month across 25 years. Brighter cells mean more hotspots.",
    "Fire days count the days with at least one hotspot. They care less about pixel size than the hotspot count does.",
    "No hotspots doesn't prove no fire. Clouds and thick smoke hide fires from the satellites.",
    "Try Raw MODIS, then Raw VIIRS, and watch 2012. That jump is the sensors, not the fires.",
  ],
  method: [
    "This page is the proof. The number to look for: after harmonization, the jump at 2012 is gone.",
    "We test the method by hiding one year at a time and predicting it from the others.",
    "MODIS misses small fires that VIIRS sees. For those we lean on each place's own VIIRS years.",
    "Day and night passes are fitted separately, because fires behave differently after dark.",
    "The first 18 months, 2001 to mid-2002, had only Terra, a morning satellite. They're the least certain part of the record.",
  ],
  play: [
    "A hint: judge a month against the same month in other years, never against last month.",
    "A hotspot is a hot pixel, and not every hot pixel is a fire.",
    "MODIS and VIIRS disagree on counts for the same fires. A bigger number doesn't always mean a bigger fire season.",
  ],
};

/** Questions offered as buttons in the chat. */
export const ASK: Record<Page, [string, string, string]> = {
  home: ["Why not just add MODIS and VIIRS?", "Is a hotspot always a fire?", "What does Wel3a mean?"],
  explore: ["Is this month normal here?", "What is a z-score?", "Why is 2012 special?"],
  method: ["What is harmonization?", "How do you know it works?", "What are the limits?"],
  play: ["What is a hotspot?", "Why are there two sensors?", "What happened in 2012?"],
};

const RAW: Record<Exclude<View, "harmonized">, string> = { modis: "MODIS", viirs: "VIIRS" };

/** The explorer's important points for the current selection, most important first. */
export function highlights(stats: Stats, sel: { label: string; view: View; metric: Metric }): string[] {
  const v = verdict(stats, sel.metric, sel.view);
  // A searched place's full name can run long; the verdict after it has to fit in LIMITS.line.
  const place = sel.label.length > 80 ? `${sel.label.slice(0, 79)}…` : sel.label;
  const out = [`${place}. ${v.headline}. ${v.detail}`];
  if (stats.partial) out.push("This month isn't over yet, so I compare it with the same days in past years.");
  if (stats.month < "2002-07") out.push("Only Terra, a morning satellite, was flying before July 2002. Treat this month as less certain.");
  if (sel.view !== "harmonized") {
    out.push(`You're on the raw ${RAW[sel.view]} view. Don't compare years across 2012 here: the two sensors count the same fires differently.`);
  }
  return out;
}

/** What the AI is told about the screen, so "is this month normal here?" has an answer. */
export function contextLines(page: Page, tip: string, points: string[], dataVersion?: string): string[] {
  const lines = [`The visitor is on the ${PAGE_NAME[page]} page.`, ...points];
  if (dataVersion?.startsWith("mock")) lines.push("The numbers on screen are simulated test data, not real FIRMS data yet.");
  lines.push(`Wel3a's bubble currently says: ${tip}`);
  return lines.map((l) => l.slice(0, LIMITS.line));
}
