"use client";

// The landing story (X15): one sticky stage behind a column of chapters. The stage is the
// WebGL orbit scene, then a scroll-scrubbed Higgsfield film that dives from orbit into the
// Nile Delta's straw fires and flies out through the smoke into the light sections.
// All text is ordinary HTML (server-rendered, readable without JS); the script only reads the
// scroll position and moves the camera, the film and the chapter fades.

import { useEffect, useRef } from "react";
import { drawSequence, frameUrls, loadSequence, type Sequence } from "@/lib/orbit/sequence";
import { useOrbitStage } from "./useOrbitStage";
import WarpLink from "./WarpLink";

export type StoryNumbers = {
  week: [string, string];
  modis: number; viirs: number; ratio: number;
  delta: { modis: number; viirs: number };
  rawJump: number | null; harmJump: number | null; mock: boolean;
  series: { years: number[]; raw: number[]; harmonized: number[] } | null;
};

const nf = new Intl.NumberFormat("en-US");
const DIVE_FRAMES = 61, SMOKE_FRAMES = 61;
// Story positions (chapter index when that chapter's middle crosses the screen's middle).
const SEQ_IN = [5.3, 5.62], DIVE = [5.55, 6.45], SMOKE = [6.5, 7.35], TO_LIGHT = [7.18, 7.45];

const clamp = (x: number) => Math.min(1, Math.max(0, x));
const span = (x: number, [a, b]: number[]) => clamp((x - a) / (b - a));

export default function OrbitStory({ n }: { n: StoryNumbers }) {
  const root = useRef<HTMLElement>(null);
  const gl = useRef<HTMLCanvasElement>(null);
  const film = useRef<HTMLCanvasElement>(null);
  const filmState = useRef<{ dive: Sequence | null; smoke: Sequence | null; p: number; onStage: boolean; lastP: number; light: string }>(
    { dive: null, smoke: null, p: 0, onStage: false, lastP: -1, light: "" });

  // Film: dive, then the smoke flight, then into the page's light colour.
  const drawFilm = () => {
    const f = filmState.current, canvas = film.current, p = f.p, seqIn = span(p, SEQ_IN);
    if (canvas && seqIn > 0 && f.onStage && Math.abs(p - f.lastP) > 0.0005 && f.dive && f.smoke) {
      const ctx = canvas.getContext("2d")!, W = canvas.width, H = canvas.height;
      f.light ||= getComputedStyle(document.documentElement).getPropertyValue("--light-warm").trim() || "#F6EEE3";
      ctx.clearRect(0, 0, W, H);
      const sm = span(p, SMOKE);
      const ok = sm > 0
        ? drawSequence(ctx, f.smoke, sm, W, H, 1 + sm * 0.04)
        : drawSequence(ctx, f.dive, span(p, DIVE), W, H, 1.02 + seqIn * 0.03);
      // The dive's last frames hand over to the smoke clip through a brief veil of smoke.
      const hand = span(p, [6.38, 6.52]) * (1 - span(p, [6.52, 6.62]));
      if (hand > 0) { ctx.fillStyle = `rgba(120,92,60,${hand * 0.55})`; ctx.fillRect(0, 0, W, H); }
      const light = span(p, TO_LIGHT);
      if (light > 0) { ctx.globalAlpha = light; ctx.fillStyle = f.light; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
      if (ok) f.lastP = p;
    }
  };

  // The film loads once the reader starts scrolling (or after a few seconds).
  const loadFilm = () => {
    const f = filmState.current;
    if (f.dive || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The stage only ticks on change, so a frame that arrives while the reader holds still redraws here.
    const redraw = () => { f.lastP = -1; drawFilm(); };
    f.dive = loadSequence(frameUrls("/media/dive", DIVE_FRAMES), redraw);
    f.smoke = loadSequence(frameUrls("/media/smoke", SMOKE_FRAMES), redraw);
  };
  useEffect(() => {
    const id = window.setTimeout(loadFilm, 4000);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Size the film canvas here, not in the frame loop: reading clientWidth there forced a layout
  // after the chapter styles were written. No more pixels than the 1600×900 frames show under
  // cover framing (a 2× backing store only upscaled them, at four times the fill cost).
  useEffect(() => {
    const canvas = film.current!, f = filmState.current;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      const d = Math.min(window.devicePixelRatio || 1, Math.max(1, Math.min(1600 / w, 900 / h)));
      canvas.width = Math.round(w * d); canvas.height = Math.round(h * d);
      f.lastP = -1; drawFilm(); // setting the size cleared it
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useOrbitStage(root, gl, "landing", 6, (p, onStage) => {
    const f = filmState.current, canvas = film.current, section = root.current;
    if (!canvas || !section) return; // unmounting: the refs are already released
    if (p > 0.4) loadFilm();
    const seqIn = span(p, SEQ_IN);
    section.dataset.phase = p < 0.5 ? "hero" : seqIn > 0.6 ? (p > 7.2 ? "light" : "film") : "orbit";
    canvas.style.opacity = String(seqIn);
    f.p = p; f.onStage = onStage;
    drawFilm();
    return { pause: seqIn > 0.999 };
  });

  const raw = n.rawJump, harm = n.harmJump;
  return (
    <section ref={root} className="story" data-mode="loading" aria-label="Fire seen from orbit">
      <div className="stage" aria-hidden="true">
        <div className="stage-static" />
        <canvas ref={gl} className="stage-gl" />
        <canvas ref={film} className="stage-film" />
        <div className="stage-shade" />
        <div className="stage-grain" />
      </div>

      <div className="chapters">
        <article className="ch ch-hero" data-ch="0">
          <div className="ch-in">
            <div className="eyebrow">NASA Space Apps Cairo 2026 · Harmonization of MODIS and VIIRS hot spots</div>
            <h1 className="display hero-h1">Is this fire season <em>normal?</em></h1>
            <p className="lede">
              Twenty-five years of satellite fire detections from MODIS and VIIRS, merged into one consistent record.
              Pick any area on Earth and see when it burns, which years were worst, and whether this month is out of the ordinary.
            </p>
            <div className="row">
              <WarpLink className="btn btn-fire big-btn" href="/explore">Explore an area</WarpLink>
              <WarpLink className="btn btn-glass big-btn" href="/method">How we merge the sensors</WarpLink>
            </div>
            <div className="chips">
              <span>MODIS · 2000 → now</span>
              <span>VIIRS · 2012 → now</span>
              <span className="chip-blue">One harmonized record</span>
            </div>
          </div>
          <p className="hero-cap">Every glow is a real detection: NASA FIRMS, {n.week[0]} to {n.week[1]}. Drag the globe.</p>
          <div className="scroll-cue" aria-hidden="true"><span />Scroll</div>
        </article>

        <article className="ch ch-left" data-ch="1">
          <div className="ch-in glass">
            <div className="eyebrow">One week, the whole planet</div>
            <h2 className="display ch-h">{nf.format(n.viirs)} fires seen from orbit in seven days.</h2>
            <p>Each glow is a 0.1° cell, the grid our record lives on, where VIIRS detected burning: savanna fires across Africa,
              farm burning in Asia and South America, forest clearing. Real data, {n.week[0]} to {n.week[1]}.</p>
          </div>
        </article>

        <article className="ch ch-left ch-scrub" data-ch="2">
          <div className="ch-in glass">
            <div className="eyebrow">Since 2000 · MODIS on Terra and Aqua</div>
            <h2 className="display ch-h">The first eye: 1 km pixels.</h2>
            <p>MODIS flags a pixel when a fire heats enough of a square kilometre. Small fires slip through.</p>
            <dl className="ch-stats">
              <div><dt>This week</dt><dd>{nf.format(n.modis)}</dd><span>detections, Terra and Aqua together</span></div>
              <div><dt>Aqua</dt><dd>705 km</dd><span>up, a 2,330 km wide swath</span></div>
            </dl>
          </div>
        </article>

        <article className="ch ch-left ch-scrub" data-ch="3">
          <div className="ch-in glass">
            <div className="eyebrow">Since 2012 · VIIRS on Suomi NPP, NOAA-20, NOAA-21</div>
            <h2 className="display ch-h">The sharper eye: 375 m pixels.</h2>
            <p>VIIRS sees fires MODIS never could. Same planet, same week, far more detections.</p>
            <dl className="ch-stats">
              <div><dt>This week</dt><dd>{nf.format(n.viirs)}</dd><span>detections from NOAA-20 alone</span></div>
              <div><dt>vs MODIS</dt><dd className="fire">{n.ratio.toFixed(2)}×</dd><span>more, for the same fires</span></div>
            </dl>
          </div>
        </article>

        <article className="ch ch-left" data-ch="4">
          <div className="ch-in glass">
            <div className="eyebrow">The problem we solve</div>
            <h2 className="display ch-h">Glue them together and fire seems to explode in 2012.</h2>
            <p>The world didn&apos;t start burning more when VIIRS launched. We calibrate MODIS against VIIRS over the years
              both flew, so 2005 and 2025 speak the same units.</p>
            {raw != null && harm != null && (
              <dl className="ch-stats">
                <div><dt>Raw join</dt><dd className="fire">{raw.toFixed(1)}×</dd><span>more hotspots after 2012</span></div>
                <div><dt>Our record</dt><dd className="blue">{harm.toFixed(2)}×</dd><span>no break{n.mock ? " (mock data until Nov 13)" : ""}</span></div>
              </dl>
            )}
            {n.series && <MiniSeries s={n.series} />}
          </div>
        </article>

        <article className="ch ch-left" data-ch="5">
          <div className="ch-in glass">
            <div className="eyebrow">Closer to home</div>
            <h2 className="display ch-h">The Nile Delta, rice-straw season.</h2>
            <p>After the harvest, farmers burn the straw. Small, short fires: this week VIIRS found <strong>{n.delta.viirs}</strong> in
              the Delta, MODIS <strong>{n.delta.modis}</strong>. A record that mixes the two can&apos;t tell you if this season is heavy.</p>
          </div>
        </article>

        <article className="ch ch-film" data-ch="6">
          <div className="ch-in film-cap">
            <span className="tag">Generated scene · Higgsfield</span>
            <p className="display">From 700 km up to the field.</p>
          </div>
        </article>

        <article className="ch ch-film ch-end" data-ch="7">
          <div className="ch-in film-end">
            <h2 className="display">Fire seasons repeat. <br />The calendar tells you when one <em>doesn&apos;t.</em></h2>
            <WarpLink className="btn btn-ink big-btn" href="/explore?region=nile-delta&month=2026-10">Open the Nile Delta calendar</WarpLink>
          </div>
        </article>
      </div>
    </section>
  );
}

function MiniSeries({ s }: { s: NonNullable<StoryNumbers["series"]> }) {
  const W = 420, H = 120, pad = 6;
  const max = Math.max(...s.raw, ...s.harmonized);
  const x = (i: number) => pad + (i / (s.years.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const i2012 = s.years.indexOf(2012);
  return (
    <figure className="mini">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Yearly hotspots: the raw join jumps in 2012, the harmonized record does not.">
        {i2012 > 0 && <line x1={x(i2012)} x2={x(i2012)} y1={0} y2={H} className="mini-2012" />}
        <path d={path(s.raw)} className="mini-raw" />
        <path d={path(s.harmonized)} className="mini-harm" />
      </svg>
      <figcaption><span className="k-raw" />Raw MODIS + VIIRS <span className="k-harm" />Harmonized <span className="mini-yr">{s.years[0]}–{s.years.at(-1)}</span></figcaption>
    </figure>
  );
}
