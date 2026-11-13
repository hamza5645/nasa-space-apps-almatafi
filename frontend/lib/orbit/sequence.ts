// Scroll-scrubbed film: numbered WebP frames drawn to a canvas with "cover" framing and a
// crossfade between neighbours, so a 61-frame clip still glides at any scroll speed.

export type Sequence = { frames: HTMLImageElement[]; loaded: boolean[] };

export function frameUrls(dir: string, n: number) {
  return Array.from({ length: n }, (_, i) => `${dir}/${String(i + 1).padStart(3, "0")}.webp`);
}

/** Loads the first frame now and the rest in order, a few at a time; onLoad runs as each frame is ready. */
export function loadSequence(urls: string[], onLoad?: (i: number) => void): Sequence {
  const seq: Sequence = { frames: [], loaded: urls.map(() => false) };
  let next = 0;
  const pump = () => {
    if (next >= urls.length) return;
    const i = next++;
    const img = new Image();
    img.src = urls[i];
    seq.frames[i] = img;
    // A frame counts only once decoded: an image outside the DOM otherwise decodes on its
    // first drawImage, which froze the film for 200–300 ms on the first pass.
    img.decode().then(() => { seq.loaded[i] = true; onLoad?.(i); }, () => {}).then(pump);
  };
  pump();
  // After the first frame, three loaders run side by side.
  setTimeout(() => { pump(); pump(); }, 50);
  return seq;
}

function nearestLoaded(seq: Sequence, i: number) {
  for (let d = 0; d < seq.frames.length; d++) {
    if (seq.loaded[i - d]) return i - d;
    if (seq.loaded[i + d]) return i + d;
  }
  return -1;
}

/** Draws position t (0..1) of the sequence into ctx, covering w×h. */
export function drawSequence(ctx: CanvasRenderingContext2D, seq: Sequence, t: number, w: number, h: number, zoom = 1) {
  const n = seq.frames.length;
  const x = Math.min(n - 1, Math.max(0, t * (n - 1)));
  const a = nearestLoaded(seq, Math.floor(x));
  if (a < 0) return false;
  const b = nearestLoaded(seq, Math.ceil(x));
  const mix = b > a ? (x - a) / (b - a) : 0;
  cover(ctx, seq.frames[a], w, h, zoom, 1);
  if (b !== a && mix > 0.02) cover(ctx, seq.frames[b], w, h, zoom, mix);
  return true;
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, zoom: number, alpha: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  // Multiplies the caller's alpha instead of replacing it: the page transition fades the
  // smoke in and out through globalAlpha (overwriting it made the smoke cut in and out).
  const base = ctx.globalAlpha;
  ctx.globalAlpha = base * alpha;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.globalAlpha = base;
}
