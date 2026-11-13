import type { Metadata } from "next";
import { ScatterChart, SeriesChart } from "@/components/Charts";
import Footer from "@/components/Footer";
import { ClockArt, FloorArt, PixelArt } from "@/components/MethodArt";
import MethodHero from "@/components/MethodHero";
import Nav from "@/components/Nav";
import SmoothScroll from "@/components/SmoothScroll";
import WarpLink from "@/components/WarpLink";
import { hasMedia, isMock, validation } from "@/lib/content";
import { fmt } from "@/lib/format";
import "../site.css";
import "../story.css";

export const metadata: Metadata = {
  title: "Method",
  description: "How Almatafi makes 25 years of MODIS and VIIRS fire detections comparable, and how we check it.",
};

const MODEL_NAMES: Record<string, string> = {
  M0: "Ratio", M1: "Log-linear", M2: "Quantile mapping", M3: "Split at the MODIS floor",
};

const REGION_NAMES: Record<string, string> = {
  "nile-delta": "Nile Delta", "rio-negro": "Río Negro", amazon: "Amazon", "central-africa": "Central Africa",
  australia: "Northern Australia", "northern-australia": "Northern Australia", california: "California",
};

export default function MethodPage() {
  const v = validation();
  const mock = isMock(v?.data_version);
  const best = v?.by_model.find((m) => m.model === v.model);
  const placebo = Object.values(v?.break_test.placebo_ratios_harmonized ?? {});
  return (
    <>
      <SmoothScroll />
      <Nav current="method" />
      <main>
      <MethodHero mock={mock} />

      <section className="light after-film">
        <div className="wrap section first">
          <div className="sec-head" data-reveal>
            <div className="eyebrow">The fixes</div>
            <h2 className="display h2">Three differences, <em>three fixes.</em></h2>
          </div>
          <div className="steps fixes" data-reveal="stagger">
            <div className="card">
              <PixelArt />
              <span className="mono num">Pixel size</span>
              <p><strong>Problem:</strong> MODIS pixels are 1 km wide, VIIRS pixels 375 m. One fire can light up one MODIS pixel but several VIIRS pixels.</p>
              <p><strong>Fix:</strong> count both on the same 0.1° grid (about 10 km), as detections and as fire days (days a cell burned at all), and keep the metric that validates better.</p>
            </div>
            <div className="card">
              <FloorArt />
              <span className="mono num">Sensitivity</span>
              <p><strong>Problem:</strong> VIIRS detects smaller and cooler fires, so it reports several times more hotspots over the same ground.</p>
              <p><strong>Fix:</strong> split VIIRS at the fire power MODIS needs to see a fire (its detection floor grows with pixel size). Fires above it convert from MODIS by a ratio learned on 2012–2022, per 10° tile and month. Fires below it, which MODIS can&apos;t see, come from each cell&apos;s own record in the VIIRS years, scaled by how active that year was. So quiet places don&apos;t turn into a patchwork of zeros before 2012.</p>
            </div>
            <div className="card">
              <ClockArt />
              <span className="mono num">Overpass time</span>
              <p><strong>Problem:</strong> Terra passes at 10:30, Aqua and VIIRS around 13:30. Fires are stronger in the afternoon, so the time of day changes the count.</p>
              <p><strong>Fix:</strong> calibrate Aqua against VIIRS (same pass) on 2012–2022, before Aqua&apos;s orbit drift, and Terra against Aqua on 2003–2011, day and night separately. NOAA-20, then NOAA-21, fill S-NPP gaps after their own calibration, and carry the record since S-NPP stopped on November 2, 2026.</p>
            </div>
          </div>
        </div>

        <div className="wrap section">
          <div className="sec-head" data-reveal>
            <div className="eyebrow">From orbit to one record</div>
            <h2 className="display h2">The <em>pipeline.</em></h2>
          </div>
          <ol className="pipeline" data-reveal="stagger">
            <li><strong>NASA FIRMS</strong><span>MODIS C6.1 from 2000, VIIRS 375 m from 2012</span></li>
            <li><strong>Clean</strong><span>Low confidence, volcanoes, gas flares and other static sources removed</span></li>
            <li><strong>Grid</strong><span>0.1° cells × months: detections and fire days, per satellite and pass</span></li>
            <li><strong>Split</strong><span>VIIRS fires above and below MODIS&apos;s detection floor</span></li>
            <li><strong>Calibrate</strong><span>Four models fitted on the overlap and scored year by year; the best one is used</span></li>
            <li><strong>One record</strong><span>Calendar, statistics, CSV / GeoJSON / Cloud-Optimized GeoTIFF</span></li>
          </ol>
        </div>

        {v && (
          <div className="wrap section">
            <div className="sec-head" data-reveal>
              <div className="eyebrow">Validation</div>
              <h2 className="display h2">Does it work? <em>We check it.</em></h2>
            </div>
            <div className="numbers" data-reveal="stagger">
              <div className="card stat"><span className="statnum">{fmt(v.overall.r2, 3)}</span><span>R² predicting VIIRS from MODIS for years left out of the fit ({v.cross_validation}, {fmt(v.overall.n)} {v.unit_of_scoring ?? "tile-months"})</span></div>
              <div className="card stat"><span className="statnum">{fmt(v.break_test.raw_ratio_after_vs_before_2012, 2)}× → {fmt(v.break_test.harmonized_ratio_after_vs_before_2012, 2)}×</span><span>Hotspots after 2012 vs before: raw join vs our record (1.00× = no break)</span></div>
              <div className="card stat"><span className="statnum">p {fmt(v.break_test.pettitt_p_raw, 4)} → {fmt(v.break_test.pettitt_p_harmonized, 2)}</span><span>Pettitt change-point test: a clear break in the raw join, none in our record</span></div>
              {placebo.length > 0 && (
                <div className="card stat"><span className="statnum">{fmt(Math.min(...placebo), 2)}× to {fmt(Math.max(...placebo), 2)}×</span><span>The same after-vs-before ratio at fake break years inside one sensor era ({Object.keys(v.break_test.placebo_ratios_harmonized ?? {}).join(", ")}): our 2012 ratio is within that natural range</span></div>
              )}
            </div>
            <div data-reveal data-draw><SeriesChart years={v.series.years} raw={v.series.raw} harmonized={v.series.harmonized} mock={mock} /></div>
            <div className="two" data-reveal="stagger">
              <figure className="card">
                <h3>Overlap years: MODIS vs VIIRS</h3>
                <ScatterChart pairs={v.scatter_sample} />
                <figcaption>Each dot is a 10° tile and month where both sensors flew. The tight band is what makes a conversion possible.</figcaption>
              </figure>
              <div className="card">
                <h3>Models compared</h3>
                <table className="tbl">
                  <thead><tr><th>Model</th><th>R² tile</th><th>R² 1°</th><th>Bias</th></tr></thead>
                  <tbody>
                    {v.by_model.map((m) => (
                      <tr key={m.model} aria-current={m.model === v.model ? "true" : undefined}>
                        <td>{MODEL_NAMES[m.model] ?? m.model}{m.model === v.model ? " (used)" : ""}</td>
                        <td>{fmt(m.r2, 3)}</td><td>{m.r2_1deg == null ? "–" : fmt(m.r2_1deg, 3)}</td><td>{fmt(m.bias, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="small">
                  {best && <>We use the {v.model} model: it scored best when predicting years it hadn&apos;t seen. </>}
                  {fmt(v.strata.fallback_used)} of {fmt(v.strata.total)} strata had too little overlap and used a larger group.
                </p>
                {v.mock_truth && (
                  <>
                    <h3 style={{ marginTop: 18 }}>Against the known fires (mock only)</h3>
                    <table className="tbl">
                      <thead><tr><th>Region</th><th>Raw jump</th><th>Ours</th></tr></thead>
                      <tbody>
                        {v.mock_truth.regions.map((r) => (
                          <tr key={r.region}><td>{REGION_NAMES[r.region] ?? r.region}</td><td>{fmt(r.raw_jump_vs_truth, 2)}×</td><td>{fmt(r.harmonized_jump_vs_truth, 2)}×</td></tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="small">The mock data knows the true fires. Hotspots per true fire day, after 2012 vs before: the raw join jumps, our record stays near 1.</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="wrap section">
          <div className="sec-head" data-reveal>
            <div className="eyebrow">Behind the calendar</div>
            <h2 className="display h2">The <em>formulas.</em></h2>
          </div>
          <div className="steps" data-reveal="stagger">
            <div className="card"><span className="mono num">Conversion</span><p>VIIRS-equivalent = k × MODIS + small × r. k = Σ VIIRS above the floor ÷ Σ MODIS, per tile, month and pass. small is the cell&apos;s mean VIIRS count below the floor for that month in the overlap years; r = (tile&apos;s MODIS count + 5) ÷ (its usual count + 5). The floor is 4.44 × A + 0.52 MW by day and 4.43 × A + 1.01 MW by night, A the MODIS pixel area (Sofiev and Kouznetsov 2026). Ratio, log-linear and quantile-mapping models are scored the same way.</p></div>
            <div className="card"><span className="mono num">Percentile rank</span><p>The share of baseline years with a lower count for the same month. The baseline is 2001 to last year, without the year being judged.</p></div>
            <div className="card"><span className="mono num">z-score</span><p>(count − mean) ÷ standard deviation of the baseline. z ≥ 2 is &quot;unusual&quot;, 1 to 2 &quot;above normal&quot;, ≤ −1 &quot;below normal&quot;. The trend is Sen&apos;s slope with a Mann-Kendall test.</p></div>
            <div className="card"><span className="mono num">Cloud correction</span><p>Optional: each cell&apos;s count ÷ max(1 − cloud fraction, 0.2), so at most 5×, with the monthly cloud of the 0.5° cell around it at Aqua&apos;s 13:30 pass (Terra&apos;s before July 2002). It assumes fires under cloud burn like those in the clear (Giglio et al. 2006). The baseline is corrected the same way. Until NASA&apos;s MOD14CMH cloud product is loaded, the cloud cover is simulated.</p></div>
          </div>
        </div>

        <div className="wrap section" id="limits">
          <div className="sec-head" data-reveal>
            <div className="eyebrow">Limits</div>
            <h2 className="display h2">What the data can and <em>can&apos;t</em> tell you.</h2>
          </div>
          {hasMedia("clouds-fire.webp") && (
            <figure className="gen-figure" data-reveal>
              {/* eslint-disable-next-line @next/next/no-img-element -- static WebP, sized by CSS */}
              <img src="/media/clouds-fire.webp" alt="" loading="lazy" decoding="async" />
              <figcaption>
                <span className="tag gen">Generated scene · Higgsfield</span>
                From orbit, cloud hides part of a burning delta: fires under it make no hotspots. The calendar marks
                months that were mostly cloud, and can correct for them.
              </figcaption>
            </figure>
          )}
          <div className="steps" data-reveal="stagger">
            <div className="card"><h3>A hotspot is not a fire</h3><p>It is a pixel that looked hot from orbit. One fire can make many hotspots; a gas flare can make one too.</p></div>
            <div className="card"><h3>No hotspot ≠ no fire</h3><p>Clouds, thick smoke, small fires, or burning between satellite passes can all hide a fire.</p></div>
            <div className="card"><h3>Counts, not area burned</h3><p>The calendar shows how often an area was detected burning, not how many hectares burned.</p></div>
            <div className="card"><h3>Small areas are coarse</h3><p>The record lives on a 0.1° grid (about 10 km). Areas under four cells get a warning and the raw points.</p></div>
            <div className="card"><h3>Static sources stay out</h3><p>A cell flagged again and again as a gas flare, industry or a volcano is left out in every month since 2001, so a real fire in that cell isn&apos;t counted either.</p></div>
            <div className="card"><h3>Cloud cover is simulated, for now</h3><p>Cloudy months are marked and can be corrected, but the cloud numbers are a stand-in until NASA&apos;s MODIS cloud product (MOD14CMH) is loaded. Read the corrected view as a demonstration.</p></div>
            <div className="card"><h3>Day and night differ by product</h3><p>FIRMS&apos;s archive calls a pixel night by the sun&apos;s angle, its near real-time files by the orbit&apos;s direction, so day and night split slightly differently in the newest months. Monthly totals add both.</p></div>
            <div className="card"><h3>A few false alarms at night over South America</h3><p>In the South Atlantic Anomaly, FIRMS notes 2 to 3 spurious night detections across the region each night. Río Negro is inside it, so its night counts deserve a second look.</p></div>
            <div className="card"><h3>2001 to mid-2002 is Terra only</h3><p>Aqua started in July 2002. Where Terra, passing at 10:30, sees few of the afternoon fires (the Nile Delta), single months before then are rough even when the total is right.</p></div>
          </div>
        </div>

        <div className="wrap section last">
          <h2 className="display h3" data-reveal>Data sources</h2>
          <ul className="sources" data-reveal>
            <li><a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a>: MODIS Collection 6.1 active fires (Terra, Aqua)</li>
            <li><a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a>: VIIRS 375 m active fires (Suomi NPP, NOAA-20, NOAA-21)</li>
            <li><a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>: Blue Marble Next Generation and VIIRS Black Marble imagery for the map and globe; the day&apos;s MODIS and VIIRS true-colour images and the OMPS/OMI aerosol index (smoke) on the explorer&apos;s map</li>
            <li>Cloud cover: MOD14CMH/MYD14CMH (MODIS climate modelling grid, monthly 0.5°) is the planned source; the app uses simulated cloud cover until it is loaded</li>
            <li><a href="https://github.com/nasa/NASA-3D-Resources">NASA 3D Resources</a>: the Aqua and Suomi NPP satellite models</li>
            <li><a href="https://higgsfield.ai/">Higgsfield</a>: the generated films and portraits on the landing page (marked as generated)</li>
            <li><a href="https://www.geoboundaries.org/">geoBoundaries</a>: administrative boundaries · <a href="https://nominatim.org/">Nominatim / OpenStreetMap</a>: place search</li>
          </ul>
          <h2 className="display h3" data-reveal>What the method builds on</h2>
          <ul className="sources" data-reveal>
            <li>Giglio, Schroeder and Justice 2016, <em>Remote Sensing of Environment</em> 178: the MODIS Collection 6 active fire algorithm behind FIRMS&apos;s MODIS data. <a href="https://doi.org/10.1016/j.rse.2016.02.054">doi</a></li>
            <li>Davies et al. 2009, <em>IEEE Transactions on Geoscience and Remote Sensing</em> 47: FIRMS, archiving and distributing the fire data. <a href="https://doi.org/10.1109/TGRS.2008.2002076">doi</a></li>
            <li>Schroeder et al. 2014, <em>Remote Sensing of Environment</em> 143: the VIIRS 375 m product and how it compares with MODIS. <a href="https://doi.org/10.1016/j.rse.2013.12.008">doi</a></li>
            <li>Li et al. 2018, <em>JGR Atmospheres</em> 123: MODIS and VIIRS fire counts and FRP across the swath, and matching near-simultaneous passes. <a href="https://doi.org/10.1029/2017JD027823">doi</a></li>
            <li>Giglio et al. 2006, <em>JGR Biogeosciences</em> 111: MODIS fire counts corrected for overpasses, and Terra vs Aqua. <a href="https://doi.org/10.1029/2005JG000142">doi</a></li>
            <li>Chen et al. 2023 (GFED5) and 2026 (GFED5NRT), <em>Earth System Science Data</em>: scaling between MODIS and VIIRS by region, land cover and month. <a href="https://doi.org/10.5194/essd-15-5227-2023">doi</a> · <a href="https://doi.org/10.5194/essd-18-7535-2026">doi</a></li>
            <li>Sofiev and Kouznetsov 2026, EGUsphere preprint: MODIS and VIIRS FRP detection limits as a function of pixel area. <a href="https://doi.org/10.5194/egusphere-2026-89">doi</a></li>
            <li>Giglio, May 2025, LANCE user group: Terra and Aqua orbit drift and fire products. <a href="https://landweb.modaps.eosdis.nasa.gov/data/filePost/LANCE_UWG_Orbit_Drift_Giglio_202505.pdf">slides</a></li>
          </ul>
          <p className="small" data-reveal>
            We acknowledge the use of data and imagery from NASA&apos;s Fire Information for Resource Management System
            (FIRMS), part of NASA&apos;s Earth Science Data and Information System (ESDIS), with near real-time data from
            LANCE and imagery from GIBS.
          </p>
          <p><WarpLink className="btn btn-fire big-btn" href="/explore">Open the calendar →</WarpLink></p>
        </div>
      </section>
      </main>
      <Footer />
    </>
  );
}
