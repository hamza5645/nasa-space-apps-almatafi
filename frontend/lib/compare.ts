// X33: the raw-vs-harmonized slider's data. The "raw join" is what you get by gluing the two
// sensors' own counts together: MODIS until January 2012, VIIRS from February 2012 (raw VIIRS
// starts then, api.md §1.2). The harmonized record is ours. Both go on one colour scale, so the
// sensor jump at 2012 shows on the raw side and is gone on ours.

export type Grid = { years: number[]; matrix: (number | null)[][] };

const VIIRS_FROM = 2012 * 12 + 1; // February 2012, as year * 12 + month index

/** One grid's values on a given list of years (missing years are all null). */
export function onYears(g: Grid, years: number[]): (number | null)[][] {
  const at = new Map(g.years.map((y, i) => [y, g.matrix[i]]));
  return years.map((y) => at.get(y) ?? Array<null>(12).fill(null));
}

/** MODIS before February 2012, VIIRS from then on, on the harmonized grid's years. */
export function rawJoin(modis: Grid, viirs: Grid, years: number[]): (number | null)[][] {
  const m = onYears(modis, years), v = onYears(viirs, years);
  return years.map((y, i) => m[i].map((mv, j) => (y * 12 + j < VIIRS_FROM ? mv : v[i][j])));
}

/** Mean monthly value from February 2012 on ÷ before it, over observed months. null when
 *  either side has no months or averages 0. */
export function jumpAt2012(years: number[], matrix: (number | null)[][]): number | null {
  let a = 0, na = 0, b = 0, nb = 0;
  years.forEach((y, i) => matrix[i].forEach((v, j) => {
    if (v === null) return;
    if (y * 12 + j < VIIRS_FROM) { b += v; nb++; } else { a += v; na++; }
  }));
  if (!na || !nb || b === 0) return null;
  return (a / na) / (b / nb);
}

export type Compare = {
  years: number[];
  raw: (number | null)[][];
  harmonized: (number | null)[][];
  max: number;
  rawJump: number | null;
  harmJump: number | null;
};

export function compare(harmonized: Grid, modis: Grid, viirs: Grid): Compare {
  const years = harmonized.years;
  const raw = rawJoin(modis, viirs, years);
  const harm = onYears(harmonized, years);
  const max = Math.max(0, ...raw.flat().map((v) => v ?? 0), ...harm.flat().map((v) => v ?? 0));
  return { years, raw, harmonized: harm, max, rawJump: jumpAt2012(years, raw), harmJump: jumpAt2012(years, harm) };
}

// The morph chart: one bar per year, the mean month of that year. t = 0 is the raw join,
// t = 1 our record; in between every bar's height moves in a straight line.

/** Mean monthly value of each year over its observed months; null for a year with fewer than
 *  `minMonths` observed months. */
export function yearlyMeans(years: number[], matrix: (number | null)[][], minMonths = 10): (number | null)[] {
  return years.map((_, i) => {
    const seen = (matrix[i] ?? []).filter((v): v is number => v !== null);
    return seen.length < minMonths ? null : seen.reduce((a, b) => a + b, 0) / seen.length;
  });
}

/** The last year whose December is in the record: the year of the latest observed month in any
 *  of the matrices, or the year before when that month isn't December. null when nothing is observed. */
export function lastFullYear(years: number[], ...matrices: (number | null)[][][]): number | null {
  let last = -1;
  for (const m of matrices) years.forEach((y, i) => (m[i] ?? []).forEach((v, j) => {
    if (v !== null) last = Math.max(last, y * 12 + j);
  }));
  if (last < 0) return null;
  return last % 12 === 11 ? Math.floor(last / 12) : Math.floor(last / 12) - 1;
}

export type Bar = { year: number; raw: number; harm: number };

/** One bar per year from `from` to the last full year, skipping a year that either side observed
 *  for fewer than 10 months. Each bar holds that year's mean month on the raw join and on ours. */
export function yearBars(c: Pick<Compare, "years" | "raw" | "harmonized">, from = 2001): Bar[] {
  const raw = yearlyMeans(c.years, c.raw), harm = yearlyMeans(c.years, c.harmonized);
  const to = lastFullYear(c.years, c.raw, c.harmonized) ?? -Infinity;
  const out: Bar[] = [];
  c.years.forEach((year, i) => {
    const r = raw[i], h = harm[i];
    if (year >= from && year <= to && r !== null && h !== null) out.push({ year, raw: r, harm: h });
  });
  return out;
}

/** A bar's height at t (0 = raw join, 1 = harmonized). */
export const barAt = (b: Bar, t: number): number => b.raw + (b.harm - b.raw) * t;

/** Mean bar before 2012 and from 2012 on, at t. null for a side with no bars. */
export function sideMeans(bars: Bar[], t: number): { before: number | null; after: number | null } {
  let b = 0, nb = 0, a = 0, na = 0;
  for (const bar of bars) {
    const v = barAt(bar, t);
    if (bar.year < 2012) { b += v; nb++; } else { a += v; na++; }
  }
  return { before: nb ? b / nb : null, after: na ? a / na : null };
}

/** The jump the bars show at t: mean bar from 2012 on ÷ mean bar before it. null when either side
 *  has no bars or the side before averages 0. */
export function barJump(bars: Bar[], t: number): number | null {
  const { before, after } = sideMeans(bars, t);
  if (before === null || after === null || before === 0) return null;
  return after / before;
}
