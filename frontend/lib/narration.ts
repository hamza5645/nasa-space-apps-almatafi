// X36: the landing page's narration, one line per chapter (docs/narration.md). The recordings
// are public/audio/n0.mp3 … n7.mp3 (Khalid's voice, Nov 13); the text is the caption.

export const NARRATION: { id: string; chapter: number; text: string }[] = [
  { id: "n0", chapter: 0, text: "Is this fire season normal?" },
  { id: "n1", chapter: 1, text: "In one week, satellites spotted three hundred thousand hotspots." },
  { id: "n2", chapter: 2, text: "Since 2000, MODIS has watched with one-kilometre pixels." },
  { id: "n3", chapter: 3, text: "In 2012, VIIRS joined: sharper eyes, five times more hotspots." },
  { id: "n4", chapter: 4, text: "Glue them together, and fire seems to explode. It didn't." },
  { id: "n5", chapter: 5, text: "In the Nile Delta, farmers burn rice straw every autumn." },
  { id: "n6", chapter: 6, text: "Almatafi turns both satellites into one record, from orbit to the field." },
  { id: "n7", chapter: 7, text: "Pick any place. See its fire history. Know when a season isn't normal." },
];

/** The chapter most in view: the one whose centre is nearest the viewport's middle among
 *  those at least `minVisible` of the viewport tall on screen; -1 when none. */
export function chapterInView(rects: { top: number; bottom: number }[], viewportH: number, minVisible = 0.35): number {
  let best = -1, bestDist = Infinity;
  rects.forEach((r, i) => {
    const visible = Math.min(r.bottom, viewportH) - Math.max(r.top, 0);
    if (visible < viewportH * minVisible) return;
    const d = Math.abs((r.top + r.bottom) / 2 - viewportH / 2);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}
