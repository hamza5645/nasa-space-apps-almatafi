// X34: the explorer's guided tour. Each step points at an element marked data-tour="<id>"
// and says what that part does. Pure data and placement maths here (tested); the overlay
// is components/Tour.tsx.

export type Step = { id: string; title: string; text: string; side?: "bottom" | "top" | "left" | "right" };

export const STEPS: Step[] = [
  { id: "area", title: "Pick a place", text: "Start with a demo area (the Nile Delta, Río Negro), or search any place on Earth, draw a box, type a point, or pick a province.", side: "bottom" },
  { id: "years", title: "Choose the years", text: "The record runs from 2001 to this month. Narrow it to the years you care about.", side: "bottom" },
  { id: "view", title: "One record, or the raw satellites", text: "Harmonized is our record: MODIS and VIIRS merged so every year counts the same way. MODIS only and VIIRS only show each satellite's raw counts, which can't be compared across 2012.", side: "bottom" },
  { id: "metric", title: "Hotspots or fire days", text: "Hotspots are detections; fire days count the days a cell burned. Fire days are less sensitive to pixel size.", side: "bottom" },
  { id: "verdict", title: "The answer", text: "For the selected month: is it normal for this place? The dots are the same month in every other year; the band is the typical range. Rank, percentile and z-score are below.", side: "bottom" },
  { id: "calendar", title: "The burning calendar", text: "Every month since 2001 in one grid, brighter for more burning. Click a month to judge it. A corner mark means the month was mostly cloud.", side: "right" },
  { id: "map", title: "The map", text: "Each dot is one hotspot that month, sized by fire power. Zoom in for each detection's pixel on the ground; switch to the day's satellite image and its smoke.", side: "left" },
  { id: "compare", title: "Why we harmonize", text: "Slide from the raw join to our record: the fake 2012 jump disappears. That's the core of this project.", side: "top" },
  { id: "downloads", title: "Take it with you", text: "Download hotspots (CSV, GeoJSON, KML), the month's grid as a GeoTIFF, or the whole calendar. Copy link shares exactly this view.", side: "bottom" },
  { id: "data", title: "Where the numbers come from", text: "Three NASA FIRMS sources: the yearly archive, this year's API data, and the public 7-day files. This button lists what covers which months.", side: "bottom" },
];

export const TOUR_KEY = "almatafi-tour-v1";

// X43: the landing's first-visit stepper on the "Hear the story" button (data-tour="narrate").
export const NARRATE_STEPS: Step[] = [
  { id: "narrate", title: "Hear the story", text: "This button turns on narration. As you scroll, each chapter of the story is read aloud.", side: "top" },
  { id: "narrate", title: "Read along", text: "Each line also shows as a caption at the bottom of the screen while it plays, so you can follow with the sound low.", side: "top" },
  { id: "narrate", title: "Off until you want it", text: "Narration is off by default. One click turns it on, another turns it off; your choice is remembered on this device, and leaving the page stops the voice.", side: "top" },
];
export const NARRATE_KEY = "almatafi-narrate-tip-v1";

export type Rect = { top: number; left: number; width: number; height: number };
export type Placement = { top: number; left: number; side: "bottom" | "top" | "left" | "right" };

/** Where the card goes for a target rect inside a viewport of w × h: on the preferred side if
 *  it fits, else the opposite, else below; always kept inside the viewport with a margin. */
export function place(target: Rect, card: { width: number; height: number }, view: { w: number; h: number },
                      side: Step["side"] = "bottom", gap = 14, margin = 12): Placement {
  const fits = (s: Placement["side"]) =>
    s === "bottom" ? target.top + target.height + gap + card.height <= view.h - margin
    : s === "top" ? target.top - gap - card.height >= margin
    : s === "right" ? target.left + target.width + gap + card.width <= view.w - margin
    : target.left - gap - card.width >= margin;
  const opposite: Record<Placement["side"], Placement["side"]> = { bottom: "top", top: "bottom", left: "right", right: "left" };
  const s = fits(side) ? side : fits(opposite[side]) ? opposite[side] : fits("bottom") ? "bottom" : "top";
  let top: number, left: number;
  if (s === "bottom" || s === "top") {
    top = s === "bottom" ? target.top + target.height + gap : target.top - gap - card.height;
    left = target.left + target.width / 2 - card.width / 2;
  } else {
    top = target.top + target.height / 2 - card.height / 2;
    left = s === "right" ? target.left + target.width + gap : target.left - gap - card.width;
  }
  left = Math.max(margin, Math.min(view.w - margin - card.width, left));
  top = Math.max(margin, Math.min(view.h - margin - card.height, top));
  return { top, left, side: s };
}
