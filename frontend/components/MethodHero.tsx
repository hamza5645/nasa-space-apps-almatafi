"use client";

// Method page header (X15): a camera tracking shot along Aqua (MODIS), then Suomi NPP (VIIRS),
// then the two orbits from afar, with the page title and the two sensors as chapters.

import { useRef } from "react";
import { useOrbitStage } from "./useOrbitStage";

export default function MethodHero({ mock }: { mock: boolean }) {
  const root = useRef<HTMLElement>(null);
  const gl = useRef<HTMLCanvasElement>(null);
  useOrbitStage(root, gl, "method", 3);
  return (
    <section ref={root} className="story method-story" data-mode="loading" aria-label="The two sensors">
      <div className="stage" aria-hidden="true">
        <div className="stage-static" />
        <canvas ref={gl} className="stage-gl" />
        <div className="stage-shade" />
        <div className="stage-grain" />
      </div>
      <div className="chapters">
        <header className="ch ch-left ch-hero" data-ch="0">
          <div className="ch-in">
            <div className="eyebrow">Method</div>
            <h1 className="display hero-h1 method-h1">How we make 25 years of fire records <em>comparable.</em></h1>
            <p className="lede">
              MODIS and VIIRS see the same planet differently. Before we can say a month is unusual, we remove three
              differences between the sensors, then check that the join at 2012 has disappeared, with tests taken from the
              published work on these two sensors.
            </p>
            {mock && (
              <p className="warn">
                The numbers on this page come from our mock data set, which simulates known fires so we can test the method.
                They are replaced by results on the real NASA FIRMS archive from November 13.
              </p>
            )}
          </div>
          <div className="scroll-cue" aria-hidden="true"><span />Scroll</div>
        </header>
        <article className="ch ch-left ch-scrub" data-ch="1">
          <div className="ch-in glass">
            <div className="eyebrow">MODIS · Terra 10:30, Aqua 13:30</div>
            <h2 className="display ch-h">1 km pixels, since 2000.</h2>
            <p>Two satellites, morning and afternoon. A fire must heat enough of a square kilometre to be flagged,
              so small fires and short burns are often missed.</p>
          </div>
        </article>
        <article className="ch ch-left ch-scrub" data-ch="2">
          <div className="ch-in glass">
            <div className="eyebrow">VIIRS · Suomi NPP, NOAA-20, NOAA-21 · 13:30</div>
            <h2 className="display ch-h">375 m pixels, since 2012.</h2>
            <p>Seven times smaller pixels see far more of the same fires. The record has to bridge the two without
              inventing a jump in 2012.</p>
          </div>
        </article>
      </div>
    </section>
  );
}
