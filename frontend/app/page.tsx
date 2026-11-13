import { SeriesChart } from "@/components/Charts";
import CompareSlider from "@/components/CompareSlider";
import "@/components/compare.css";
import Footer from "@/components/Footer";
import Nav from "@/components/Nav";
import OrbitStory, { type StoryNumbers } from "@/components/OrbitStory";
import SmoothScroll from "@/components/SmoothScroll";
import WarpLink from "@/components/WarpLink";
import Mascot from "@/components/game/Mascot";
import { demoCalendar, demoCompare, fireWeek, isMock, validation, type MiniCalendar } from "@/lib/content";
import { fmt } from "@/lib/format";
import "./site.css";
import "./story.css";

const FAQ = [
  ["Is a hotspot a fire?", "Not always. A hotspot is a pixel that looked hot from orbit. One fire can make many hotspots, and a gas flare can make one too. We drop known industrial and volcanic sources."],
  ["Why not just add MODIS and VIIRS together?", "VIIRS sees smaller and cooler fires, so it reports several times more hotspots for the same fires. Glued together, the record jumps in 2012 even though the fires didn't change. We convert MODIS to VIIRS-equivalent values first."],
  ["How current is it?", "The record runs to last month from NASA's standard archive, with near-real-time data for the newest weeks. The current month is compared with the same days in past years."],
  ["Can I download the data?", "Yes. Any area as CSV or GeoJSON (individual hotspots), the monthly calendar as CSV, and the 0.1° grid as a Cloud-Optimized GeoTIFF."],
  ["Does no hotspot mean no fire?", "No. Clouds, thick smoke, small fires and burning between satellite passes can all hide a fire. Read zero as nothing detected."],
  ["What is real and what is generated?", "Every number, the globe's fires and the maps are NASA data. The films and stills of the Delta and Patagonia, the smoke and the portraits are AI-generated scenes (Higgsfield), there to set the mood; no number comes from them."],
];

const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function fmtDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default function Home() {
  const v = validation();
  const mock = isMock(v?.data_version);
  const week = fireWeek();
  const cal = demoCalendar("nile-delta");
  const cmp = demoCompare("nile-delta");
  const n: StoryNumbers = {
    week: week ? [fmtDay(week.dates[0]), `${fmtDay(week.dates[1])} 2026`] : ["27 Oct", "3 Nov 2026"],
    modis: week?.sensors.modis.detections ?? 0,
    viirs: week?.sensors.viirs.detections ?? 0,
    ratio: week?.ratio_viirs_vs_modis ?? 0,
    delta: week?.regions["nile-delta"] ?? { modis: 0, viirs: 0 },
    rawJump: v?.break_test.raw_ratio_after_vs_before_2012 ?? null,
    harmJump: v?.break_test.harmonized_ratio_after_vs_before_2012 ?? null,
    mock,
    series: v ? { years: v.series.years, raw: v.series.raw, harmonized: v.series.harmonized } : null,
  };

  return (
    <>
      <SmoothScroll />
      <Nav />
      <main>
        <OrbitStory n={n} />

        <section className="light after-film">
          <div className="wrap section first">
            <div className="sec-head" data-reveal>
              <div className="eyebrow">How it works</div>
              <h2 className="display h2">Three steps from map to <em>answer.</em></h2>
            </div>
            <div className="steps" data-reveal="stagger">
              <article className="card step">
                <StepArt kind="area" />
                <span className="mono num">01</span>
                <h3>Draw your area</h3>
                <p>Sketch a polygon, drag a box, pick a province, search a place, or type a latitude and longitude.</p>
              </article>
              <article className="card step">
                {cal ? <MiniCal c={cal} /> : <StepArt kind="calendar" />}
                <span className="mono num">02</span>
                <h3>Read the calendar</h3>
                <p>Every month since 2001 in one grid. Bright cells are heavy burning; the pattern is your fire season at a glance.{cal ? " Above: the Nile Delta." : ""}</p>
              </article>
              <article className="card step">
                <StepArt kind="compare" />
                <span className="mono num">03</span>
                <h3>Compare and export</h3>
                <p>See how a month ranks against history (percentile, z-score), then download CSV, GeoJSON or GeoTIFF for your GIS.</p>
              </article>
            </div>
          </div>

          <div className="wrap section">
            <div className="problem-head" data-reveal>
              <div className="stack-lg">
                <div className="eyebrow">The proof</div>
                <h2 className="display h2">Two satellites. One record. <em>No fake spikes.</em></h2>
              </div>
              <p>
                We calibrate MODIS against VIIRS over the years both flew, then check the seam at 2012 is gone.
                {n.rawJump && n.harmJump && <> Raw join: <strong>{fmt(n.rawJump, 1)}×</strong> more hotspots after 2012. Our record: <strong>{fmt(n.harmJump, 2)}×</strong>.</>}
              </p>
            </div>
            {v && <div data-reveal data-draw><SeriesChart years={v.series.years} raw={v.series.raw} harmonized={v.series.harmonized} mock={mock} /></div>}
            {cmp && (
              <div className="proof-slider" data-reveal>
                <div className="stack-sm">
                  <h3 className="display">See it for yourself.</h3>
                  <p>The Nile Delta&apos;s calendar, twice: raw on the left of the line, ours on the right. Drag it.{mock ? " (Mock data until Nov 13.)" : ""}</p>
                </div>
                <CompareSlider {...cmp} place="Nile Delta" tone="light" />
              </div>
            )}
          </div>

          <div className="wrap section">
            <div className="sec-head" data-reveal>
              <div className="eyebrow">Two places, one question</div>
              <h2 className="display h2">Routine, or <em>unprecedented?</em></h2>
            </div>
            <div className="cases">
              <article className="case-film" data-reveal>
                <div className="case-media">
                  <video data-parallax="6" autoPlay muted loop playsInline preload="metadata" poster="/media/rio-negro-poster.webp" aria-hidden="true">
                    <source src="/media/rio-negro-loop.mp4" type="video/mp4" />
                  </video>
                </div>
                <div className="case-body">
                  <div className="eyebrow">Case study · CONAE&apos;s example</div>
                  <h3 className="display">Río Negro, July 2026</h3>
                  <p>Winter fires in northern Patagonia made the news. The calendar puts that month against every July since 2001,
                    on one record that doesn&apos;t change meaning when the satellites do.</p>
                  <WarpLink className="btn btn-fire" href="/explore?region=rio-negro&month=2026-07">Open Río Negro, July 2026</WarpLink>
                </div>
              </article>
              <article className="case-film" data-reveal>
                <div className="case-media">
                  <video data-parallax="6" autoPlay muted loop playsInline preload="metadata" poster="/media/nile-delta-poster.webp" aria-hidden="true">
                    <source src="/media/nile-delta-loop.mp4" type="video/mp4" />
                  </video>
                </div>
                <div className="case-body">
                  <div className="eyebrow">Closer to home</div>
                  <h3 className="display">The Nile Delta&apos;s rice-straw season</h3>
                  <p>Every October and November, farmers burn rice straw across the Delta. This week VIIRS found {n.delta.viirs} hotspots
                    there and MODIS {n.delta.modis}. Is this year&apos;s season heavier than usual?</p>
                  <WarpLink className="btn btn-fire" href="/explore?region=nile-delta&month=2026-10">Open the Nile Delta, October 2026</WarpLink>
                </div>
              </article>
            </div>
          </div>

          <div className="wrap section">
            <div className="sec-head" data-reveal>
              <div className="eyebrow">Who it&apos;s for</div>
              <h2 className="display h2">Built for the people who <em>watch the fires.</em></h2>
            </div>
            <div className="who" data-reveal="stagger">
              {[
                ["who-responder", "Emergency responders", "Is today’s activity routine for this season, or a surge?"],
                ["who-scientist", "Scientists", "One sensor-agnostic series from 2001 to now, ready for trend work, with its validation published."],
                ["who-farmer", "Land managers and farmers", "Know the critical months before they arrive, and how this season compares."],
              ].map(([img, title, text]) => (
                <article key={img} className="card who-card">
                  <div className="who-img">
                    {/* eslint-disable-next-line @next/next/no-img-element -- static WebP, sized by CSS */}
                    <img src={`/media/${img}.webp`} alt="" loading="lazy" decoding="async" /></div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="wrap section">
            <div className="play-band" data-reveal>
              <Mascot mood="idle" size={110} />
              <div className="stack-lg">
                <div className="eyebrow">A game, on real data</div>
                <h2 className="display h2">Normal <em>or not?</em></h2>
                <p>Seven questions from our own record: is this month strange for the Nile Delta? Which year really burned more?
                  Can you spot the 2012 trap? Three embers, two minutes.</p>
              </div>
              <WarpLink className="btn btn-fire big-btn" href="/play">Play</WarpLink>
            </div>
          </div>

          <div className="wrap section last">
            <div className="faq-grid">
              <div className="sec-head" data-reveal>
                <div className="eyebrow">Questions</div>
                <h2 className="display h2">Before you <em>trust a number.</em></h2>
              </div>
              <div className="faq" data-reveal="stagger">
                {FAQ.map(([q, a]) => (
                  <details key={q}><summary>{q}</summary><p>{a}</p></details>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="cta-band" aria-label="Open the calendar">
          {/* eslint-disable-next-line @next/next/no-img-element -- decorative parallax backdrop */}
          <img className="cta-bg" data-parallax="8" src="/media/night-orbit.webp" alt="" loading="lazy" decoding="async" />
          <div className="wrap cta-in" data-reveal>
            <h2 className="display">Pick a place. <em>See its fire history.</em></h2>
            <p>Any polygon on Earth, every month since 2001, on one consistent record.</p>
            <div className="row">
              <WarpLink className="btn btn-fire big-btn" href="/explore">Open the calendar</WarpLink>
              <WarpLink className="btn btn-glass big-btn" href="/method">Read the method</WarpLink>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

/** The Delta's harmonized calendar, small: years down, months across. */
function MiniCal({ c }: { c: MiniCalendar }) {
  const rows = c.years.slice(-14);
  const m = c.matrix.slice(-14);
  return (
    <div className="step-art mini-cal" aria-hidden="true">
      <div className="mc-grid" style={{ gridTemplateColumns: `repeat(12, 1fr)` }}>
        {m.map((row, i) => row.map((v, j) => (
          <i key={`${i}-${j}`} style={{ background: v == null ? "transparent" : ramp(v / c.max), outline: v == null ? "1px dashed #D9D4CC" : undefined }}
             title={`${rows[i]} ${MONTHS[j]}`} />
        )))}
      </div>
      <div className="mc-months">{MONTHS.map((x, i) => <span key={i}>{x}</span>)}</div>
    </div>
  );
}

function ramp(t: number) {
  // Light to ember, lightness-ordered like the explorer's ramp.
  const stops = [[246, 238, 226], [249, 205, 140], [240, 138, 36], [196, 70, 18], [110, 24, 10]];
  const x = Math.min(0.9999, Math.max(0, Math.pow(t, 0.6))) * (stops.length - 1);
  const i = Math.floor(x), f = x - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `rgb(${c.join(",")})`;
}

function StepArt({ kind }: { kind: "area" | "calendar" | "compare" }) {
  if (kind === "area") {
    return (
      <svg className="step-art" viewBox="0 0 240 120" aria-hidden="true">
        <defs><pattern id="g" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0V12" fill="none" stroke="#E4DED5" /></pattern></defs>
        <rect width="240" height="120" rx="12" fill="url(#g)" />
        <path d="M40 92 C 60 40, 110 22, 150 34 S 214 70, 196 96 Z" fill="rgba(107,208,228,.16)" stroke="#2E9AB0" strokeWidth="2" strokeDasharray="5 4" />
        {[[92, 60], [118, 52], [140, 70], [104, 78], [160, 62], [128, 84]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3.2} fill="#E8701E" />)}
        <circle cx="196" cy="96" r="5" fill="#fff" stroke="#2E9AB0" strokeWidth="2" />
      </svg>
    );
  }
  if (kind === "compare") {
    const pts = [22, 35, 28, 40, 31, 26, 45, 38, 33, 29, 36, 42, 30, 34, 27, 39, 44, 32, 37, 41, 35, 30, 43, 36, 88];
    return (
      <svg className="step-art" viewBox="0 0 240 120" aria-hidden="true">
        <rect x="10" y="54" width="220" height="22" rx="11" fill="#F1ECE4" />
        <rect x="70" y="54" width="70" height="22" fill="#E6DED2" />
        {pts.slice(0, -1).map((p, i) => <circle key={i} cx={10 + p * 2.2} cy={65} r="4" fill="#B7A893" stroke="#fff" strokeWidth="1.5" />)}
        <circle cx={10 + 88 * 2.2} cy={65} r="7" fill="#E8701E" stroke="#fff" strokeWidth="2.5" />
        <text x={10 + 88 * 2.2} y="40" textAnchor="middle" fontSize="12" fontWeight="700" fill="#1A1714">this year</text>
        <text x="105" y="98" textAnchor="middle" fontSize="11" fill="#6B6157">usual range</text>
      </svg>
    );
  }
  return <svg className="step-art" viewBox="0 0 240 120" aria-hidden="true" />;
}
