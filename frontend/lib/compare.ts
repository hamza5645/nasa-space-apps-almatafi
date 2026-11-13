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
