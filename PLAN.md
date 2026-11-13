# PLAN.md — Harmonized Burning Activity Calendar

NASA Space Apps Cairo 2026 · Challenge: **Harmonization of MODIS and VIIRS Hot Spots** (authored with CONAE, Argentina).

This is the full build plan. `TEAM.md` is the live status (who is doing what right now). If the two disagree, update whichever is out of date and say so in the TEAM.md log.

---

## 1. What we are building

A web app that merges 25 years of satellite fire detections from two different sensors into **one consistent record**, then lets anyone pick **any area on Earth** and see:

- a **burning calendar** (years × months heatmap, 2001 → now)
- for any month: **mean, median, percentile rank, z-score anomaly** against history
- the individual **hotspots** on a map, with their details
- **exports**: CSV, GeoJSON, GeoTIFF

The core of the challenge is **harmonization**: MODIS (2000 → now, 1 km pixels, less sensitive) and VIIRS (2012 → now, 375 m pixels, more sensitive) cannot be glued together. VIIRS sees 3–5× more hotspots for the same fires, so a naive join shows a fake surge in 2012. After our harmonization, "the sensor of origin no longer matters".

### What the challenge explicitly asks for (from the brief and video)
| Requirement | Where we cover it |
|---|---|
| Harmonize MODIS + VIIRS into a sensor-agnostic series | §5 Harmonization |
| Fix resolution (1 km vs 375 m), sensitivity, overpass timing | §5.2–5.4 |
| Cloud-native storage (Parquet / GeoParquet / COG) | §4 Data layout |
| Burning activity calendar in a web app | §8 Frontend |
| Area by polygon, bounding box, admin boundary, lat/lon | §7 API, §8 |
| Date range selection | §7, §8 |
| Mean monthly counts, percentile ranks, z-score anomalies | §6 Analytics |
| Exports: CSV, GeoJSON, GeoTIFF | §7 `/export` |
| Accessible color ramps | §8 |
| Modular API endpoints | §7 |

### What we are NOT building
- Fire prediction / forecasting (not asked; hurts scientific validity if unvalidated).
- Gamification, badges, roles (maybe later, not now).
- Our own fire detection. Satellites detect; FIRMS publishes; we harmonize and analyse.

---

## 2. Ground rules for this phase

1. **Function first, UI later.** Until the core works on real data, the UI is clean and usable, nothing fancy. Use the mockup in `~/projects/nasa-ui-mockup` (not in the repo) as the layout reference.
2. **No Higgsfield yet.** Video, 3D scroll animations and tracking shots come in the **UI polish phase** (§10, Phase 5).
3. **The 3D globe is allowed now** (globe.gl). It is cheap and it shows real data.
4. **Mock data must match the real FIRMS format exactly.** On Nov 13 we swap the source, not the code.
5. Everything else about how we work together: `TEAM.md`.

---

## 3. Architecture

```
 NASA FIRMS (MODIS + VIIRS CSV)          FIRMS API (last 1–10 days, NRT)
            │                                         │
            ▼                                         │
 ┌───────────────────────── pipeline/ ─────────────┐  │
 │ ingest → clean → grid → harmonize → validate    │  │
 └───────────────┬─────────────────────────────────┘  │
                 ▼                                    │
   data/  (GeoParquet points, Parquet grid, COGs)     │
                 │                                    │
                 ▼                                    ▼
 ┌──────────────────────── backend/ (FastAPI + DuckDB) ────────────┐
 │ /calendar  /stats  /hotspots  /export  /nrt  /search  /admin   │
 └───────────────────────────────┬─────────────────────────────────┘
                                 ▼
 ┌──────────────────────── frontend/ (Next.js) ────────────────────┐
 │ Landing (3D globe) · Explorer (map + calendar + stats) · Method │
 └─────────────────────────────────────────────────────────────────┘
```

### Two levels of data, so it works anywhere on Earth
1. **Global harmonized monthly grid** (0.1° cells ≈ 10 km, 2001 → now). Small and fast. Any polygon anywhere = sum of the cells inside it. Powers the calendar, stats and GeoTIFF export **globally**.
2. **Individual hotspot points.** Too large to store globally. Stored in full for the **demo regions**; for anywhere else, fetched on demand from the FIRMS API for the selected area and dates (dots on the map + CSV/GeoJSON export).
3. **Live layer:** last 7 days of hotspots anywhere, from FIRMS near-real-time, so "this month" is current.

### Tech stack
| Layer | Choice | Why |
|---|---|---|
| Pipeline | Python 3.12, `uv`, pandas, numpy, scipy, GeoPandas, Shapely, DuckDB (+ spatial), rasterio | Standard, fast on a laptop |
| Storage | GeoParquet (points), Parquet (grid), COG GeoTIFF (exports) | Required by the brief |
| Backend | FastAPI + DuckDB | One process, SQL over Parquet, no DB server |
| Frontend | Next.js (App Router) + TypeScript + Tailwind | Fast to build, easy deploy |
| Map | MapLibre GL + Terra Draw | Free, polygon/box drawing |
| Charts / calendar | ECharts | Heatmaps and line charts out of the box |
| Globe | globe.gl (Three.js) + NASA Blue Marble texture | Real 3D with real hotspots |
| State / fetching | Zustand + TanStack Query | Simple shared selection state |
| Geocoding | Nominatim (OpenStreetMap) | Free "search any place" |
| Admin boundaries | geoBoundaries (ADM0–ADM2 GeoJSON) | Free, global |
| Deploy | Frontend: Cloudflare Workers (static export) · Backend: Hamza's VPS (rootless Podman + Cloudflare Tunnel); auto-deploy on merge to `main` | Free, no cold start (Nov 3 decision; `deploy/README.md`) |

---

## 4. Data contract (shared, lives in `contracts/`)

> **Authoritative version: [`contracts/`](contracts/README.md)** (FIRMS input, grid and `cell_id`, data products, API). The summary below is for orientation; if it disagrees with `contracts/`, `contracts/` wins.

> Column names below follow the FIRMS archive CSVs. **Verify against a real file** (one month of real data is enough) and fix this section if anything differs.

### 4.1 FIRMS MODIS (C6.1) — input
| column | type | notes |
|---|---|---|
| latitude, longitude | float | pixel centre |
| brightness | float | K, channel 21/22 |
| scan, track | float | pixel size (km) along scan/track |
| acq_date | date | YYYY-MM-DD (UTC) |
| acq_time | string | HHMM (UTC) |
| satellite | string | Terra / Aqua (NRT uses T / A) |
| instrument | string | MODIS |
| confidence | int | 0–100 |
| version | string | e.g. 6.1 |
| bright_t31 | float | K |
| frp | float | MW, fire radiative power |
| daynight | string | D / N |
| type | int | archive only: 0 vegetation, 1 volcano, 2 static land source, 3 offshore |

### 4.2 FIRMS VIIRS (375 m) — input
Same as MODIS except: `bright_ti4` / `bright_ti5` instead of `brightness` / `bright_t31`; `satellite` = N (Suomi-NPP), N20 / 1 (NOAA-20), N21 (NOAA-21); `confidence` = low / nominal / high (NRT: l / n / h).

### 4.3 Clean points — internal (GeoParquet, `data/clean/`)
`id, sensor (MODIS|VIIRS), platform (Terra|Aqua|SNPP|NOAA20|NOAA21), lat, lon, geometry, acq_datetime_utc, daynight, frp, confidence_norm (low|nominal|high), cell_id, year, month`
Partitioned by `sensor/year`.

### 4.4 Grid — internal (Parquet, `data/grid/`)
`cell_id, cell_lat, cell_lon, year, month, platform, detections, fire_days`
- `detections` = number of hotspots in the cell that month
- `fire_days` = number of distinct days with ≥1 hotspot

### 4.5 Harmonized grid — output (Parquet, `data/harmonized/`)
`cell_id, cell_lat, cell_lon, year, month, value, source (observed|converted), stratum`
`value` is in **VIIRS-equivalent detections** (S-NPP afternoon + night passes).

### 4.6 Cell ID
0.1° grid: `cell_id = floor((lat + 90) * 10) * 3600 + floor((lon + 180) * 10)`. Same function in Python and TypeScript.

---

## 5. Harmonization method (the core)

### 5.1 Target
One monthly series per grid cell, 2001-01 → now, in **VIIRS S-NPP-equivalent** units. After 2012 the values are real VIIRS observations; before 2012 they are MODIS converted to VIIRS-equivalent.

### 5.2 Cleaning
- MODIS: keep `confidence ≥ 30` (configurable; test 30 vs 50).
- VIIRS: drop `low`.
- Keep `type == 0` (vegetation fires). For NRT data, which has no `type`, mask cells that the archive flags as static sources (`type == 2`) in ≥ N months.
- Remove exact duplicates.

### 5.3 Overpass timing (diurnal alignment)
Terra crosses at ~10:30 / 22:30; Aqua, S-NPP and NOAA-20 at ~13:30 / 01:30. Fires peak in the afternoon, so Terra sees a different part of the day.
- **Primary bridge: Aqua ↔ S-NPP** (same overpass time), fitted on 2012 → now.
- **2001 → mid-2002 (Terra only):** convert Terra → Aqua-equivalent using the Terra/Aqua overlap (2002 → 2012), then Aqua → VIIRS.
- **VIIRS continuity:** S-NPP is the reference. NOAA-20/21 only fill S-NPP gaps, after their own calibration to S-NPP.
- Day and night passes are fitted separately, then summed.

### 5.4 Resolution and sensitivity
1. **Common grid:** aggregate both sensors to 0.1° cell-months. Compute both `detections` and `fire_days`. `fire_days` is less affected by pixel size; pick the metric with the better validation score (§5.6) and keep the other as a secondary option.
2. **Strata:** the conversion is not the same everywhere (farm burning ≠ forest fire). Fit per **stratum = macro-region (10° tile) × season (month)**, falling back to bigger groups where data is thin. **Stretch:** add land-cover class (MODIS MCD12Q1 or ESA WorldCover) to the stratum.
3. **Conversion models, from simple to better, keep the best:**
   - **M0 Ratio:** `VIIRS = k_s × MODIS`, with `k_s = ΣVIIRS / ΣMODIS` over the overlap.
   - **M1 Log-linear:** `log(1+VIIRS) = a_s + b_s × log(1+MODIS)`.
   - **M2 Quantile mapping:** map the MODIS cell-month distribution onto the VIIRS distribution per stratum.
4. Apply the chosen model to all pre-2012 MODIS cell-months.

### 5.5 Mock data must let us test this
The mock generator (§9) simulates **true fires** first, then lets each sensor "see" them with its own pixel size, sensitivity and overpass time. Because we know the truth, we can check that harmonization recovers it.

### 5.6 Validation (this becomes a page in the app and a slide)
- **Leave-one-year-out** on the overlap (2012 → now): fit without year Y, predict VIIRS from MODIS for Y, measure **R², bias, MAE/RMSE** per stratum and globally.
- **Break test at 2012:** the harmonized series must not show a jump. Compare the mean ratio before and after 2012 against the raw join (optionally a Pettitt change-point test).
- **Plots:** MODIS vs VIIRS scatter (overlap), raw vs harmonized annual series, residual map.
- Output `docs/validation.md` with the numbers and plots.

---

## 6. Analytics (per area of interest)

For an area A (cells whose centre lies inside the polygon) and a month (y, m):
- `C(y,m)` = Σ harmonized `value` over A.
- **Baseline** for month m = the same month in other years (default 2001 → last full year, excluding y; user can change the window).
- **Mean, median, sd** of the baseline.
- **Percentile rank** = % of baseline years with a lower count.
- **z-score** = (C − mean) / sd.
- **Status:** z ≥ 2 → "Unusual, well above normal"; 1 ≤ z < 2 → "Above normal"; z ≤ −1 → "Below normal"; else "Within normal range".
- **Current month is partial:** compare month-to-date against the same day-range in past years.
- **Year totals, peak months, long-term trend** (Sen's slope on annual totals).
- **Small areas:** if A covers fewer than ~4 cells, warn that the grid is coarse and also show raw point counts.

---

## 7. API (`backend/`, contract in `contracts/api.md`)

> **Authoritative version: [`contracts/api.md`](contracts/api.md)**, which also adds `GET /api/regions` and the shareable URL format.

Polygons travel as GeoJSON in a POST body. All responses JSON unless a file.

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/api/health` | — | `{status}` |
| POST | `/api/calendar` | `aoi, start, end, view (harmonized\|modis\|viirs)` | `{years[], months[], matrix[year][month], year_totals[], month_medians[], max}` |
| POST | `/api/stats` | `aoi, year, month, baseline:[from,to]` | `{count, mean, median, sd, percentile, z, status, trend}` |
| POST | `/api/hotspots` | `aoi, start, end, limit` | GeoJSON FeatureCollection (points + FIRMS fields) |
| POST | `/api/export` | `aoi, start, end, format (csv\|geojson\|geotiff), what (hotspots\|calendar\|grid)` | file download |
| POST | `/api/nrt` | `aoi, days (1–10)` | GeoJSON of recent hotspots (FIRMS API) |
| GET | `/api/search?q=` | place name | `[ {name, bbox, geojson} ]` (Nominatim) |
| GET | `/api/admin?country=&level=` | ISO3, 0–2 | admin boundaries GeoJSON |
| GET | `/api/validation` | — | numbers + series for the Method page |

`aoi` can be: a GeoJSON Polygon/MultiPolygon, a bbox `[w,s,e,n]`, a point + radius `{lat, lon, km}`, or an admin id. The backend turns all of them into one polygon.

**Rule:** the API returns the same shapes on mock data and real data.

---

## 8. Frontend (`frontend/`)

Layout reference: the mockup (landing, explorer, method). Functional first.

### Pages
1. **`/` Landing:** headline, short explanation, **3D globe (globe.gl)** with recent hotspots, raw vs harmonized chart, three steps, "Open the calendar".
2. **`/explore` Explorer (main):**
   - Search any place (Nominatim) + demo-area shortcuts (Nile Delta, Río Negro).
   - Area tools: draw polygon, box, admin picker, lat/lon + radius.
   - Date range. Data view: Harmonized (default) / Raw MODIS / Raw VIIRS, with a warning on raw.
   - Map with hotspots; click a dot → details (time, lat/lon, FRP, confidence, sensor).
   - **Burning calendar** (years × months), accessible ramp (inferno / viridis family, lightness-ordered), numbers in cells, year totals, month medians. Click a cell → map + stats update.
   - Stats panel: count, status, median, mean ± sd, z, percentile.
   - Export buttons: CSV, GeoJSON, GeoTIFF. Shareable URL (state in the query string).
3. **`/method`:** the three differences + fixes, pipeline, validation plots and numbers, data limitations, sources.

### Must-haves
- One shared selection state (area, dates, view, selected month), so everything is linked.
- Works at laptop and phone width (calendar scrolls sideways on phones).
- Loading and empty states ("no detections" ≠ "no fire" message).
- Keyboard-usable controls, real buttons, labels on inputs.

---

## 9. Mock data (until Nov 13)

`pipeline/mock/generate.py` writes **FIRMS-format CSVs** (exact columns from §4.1/4.2) to `data/raw/mock/`.

- **Regions:** Nile Delta, Río Negro/Chile, plus 3–4 global ones (Amazon, Central Africa, Australia, California) so "anywhere" can be tested.
- **Truth first:** simulate fire events per cell-day with a seasonal pattern per region (Delta peaks Oct–Nov, Patagonia Dec–Mar) and a slow trend.
- **Sensors see the truth differently:**
  - MODIS: 1 km pixels, misses small fires, one pixel per fire, Terra 10:30 / Aqua 13:30.
  - VIIRS: 375 m pixels, sees small fires, several pixels per fire, 13:30.
  - Realistic `scan/track`, `frp`, confidence, day/night.
- **Planted events:** Río Negro July 2026 spike (the brief's example), Nile Delta Oct 2026 above normal.
- **Sensor timelines:** Terra 2000 →, Aqua Jul 2002 →, S-NPP Jan 2012 →, NOAA-20 2018 →.
- Seeded, so everyone gets the same files.

---

## 10. Timeline

Hackathon dates: **Cairo local event Nov 13–14, 2026** (kickoff Fri Nov 13; judging, People's Choice pitching and closing ceremony Sat Nov 14) at Elsewedy University of Technology, 10th of Ramadan. Global hackathon Nov 14–15. Submission deadline: **[confirm with the Cairo organizers]**.

### Phase 1 · Foundations (Oct 31 → Nov 2)
| ID | Task | Owner |
|---|---|---|
| F1 | Write `contracts/` (FIRMS columns, clean/grid/harmonized schemas, API) | Both |
| F2 | (Optional, recommended) Download one real FIRMS month to confirm the contract | Khalid |
| F3 | Repo skeleton: `pipeline/`, `backend/`, `frontend/`, `docs/`, `uv` env, Next.js app, lint/format | Both |
| F4 | Shared `cell_id` function (Python + TS) with tests | Khalid |

### Phase 2 · Build on mock data (Nov 3 → Nov 8)
| ID | Task | Owner |
|---|---|---|
| D1 | Mock generator (§9) | Khalid |
| D2 | Pipeline: ingest → clean → GeoParquet | Khalid |
| D3 | Pipeline: grid (detections + fire_days) | Khalid |
| B1 | FastAPI skeleton + `/health` + AOI parsing (polygon, bbox, point+radius, admin) | Khalid |
| B2 | `/calendar`, `/stats`, `/hotspots` on mock | Khalid |
| U1 | Explorer layout: map, side panels, calendar area | Partner |
| U2 | Map: MapLibre + Terra Draw (polygon, box), lat/lon form, search box | Partner |
| U3 | Calendar heatmap (ECharts), linked to shared state | Partner |
| U4 | Stats panel + hotspot details panel | Partner |

### Phase 3 · Harmonization + integration (Nov 9 → Nov 12)
| ID | Task | Owner |
|---|---|---|
| H1 | Overpass alignment + strata | Khalid |
| H2 | Conversion models M0, M1, M2 | Khalid |
| H3 | Validation (leave-one-year-out, break test, plots) on mock | Khalid |
| B3 | `/export` (CSV, GeoJSON, GeoTIFF/COG), `/search`, `/admin`, `/validation` | Khalid |
| U5 | Export buttons, raw/harmonized switch + warning, shareable URL | Partner |
| U6 | Landing page with globe.gl + Method page (wired to `/validation`) | Partner |
| I1 | Connect frontend to backend end to end; deploy a staging version | Both |

### Phase 4 · Real data (Nov 13 → ~Nov 17)
| ID | Task | Owner |
|---|---|---|
| R1 | Download FIRMS archives: demo regions first, then global (yearly per-country CSVs or the archive download tool) | Khalid |
| R2 | Run clean → grid → harmonize → validate on real data; fix contract surprises | Khalid |
| R3 | Build the global harmonized grid; points stored for demo regions | Khalid |
| R4 | `/nrt` live layer (FIRMS API, MAP_KEY) | Khalid |
| R5 | Real-data QA in the UI: Delta and Río Negro stories make sense | Both |
| R6 | `docs/method.md` + `docs/validation.md` with the real numbers | Both |

### Phase 5 · UI polish (after the core works on real data)
- Visual identity: final name, logo, palette, typography.
- **Higgsfield:** 3D scroll animation sequences and camera tracking shots for the landing page; trailer and demo video shots.
- GSAP ScrollTrigger for scroll storytelling; globe intro animation.
- Optional: mascot tip (sprite sheet / Lottie), guided investigation mode, time slider, side-by-side period comparison, land-cover fire-type split.

### Phase 6 · Submission
- Space Apps project page: title, summary, demo link, repo, NASA data used, partner data, references, AI-use disclosure.
- Demo video and/or slides (check this year's length and slide limits).
- Pitch: replay **Río Negro, July 2026** (CONAE's own case: routine or unprecedented?), then the **Nile Delta** for the Cairo judges.
- Rehearse; test the demo on another machine and network; offline fallback (cached demo regions).

---

## 11. Repo layout

```
.
├── PLAN.md            ← this file
├── TEAM.md            ← live status, roles, board, log
├── contracts/         ← data + API contracts (change only when both agree)
├── pipeline/
│   ├── mock/          ← mock FIRMS generator
│   ├── ingest.py  clean.py  grid.py  harmonize.py  validate.py
│   └── tests/
├── backend/
│   ├── app/           ← FastAPI routes, AOI parsing, queries
│   └── tests/
├── frontend/          ← Next.js app
├── docs/              ← method.md, validation.md, pitch notes
└── data/              ← gitignored: raw/, clean/, grid/, harmonized/, cog/
```

---

## 12. Definition of done (MVP)

- [ ] Any polygon anywhere on Earth returns a calendar 2001 → now in under 3 s.
- [ ] Harmonized series has no visible 2012 jump; validation numbers published in the app.
- [ ] Mean, median, percentile, z-score for any month.
- [ ] Hotspot dots + details for demo regions and on-demand elsewhere.
- [ ] CSV, GeoJSON and GeoTIFF exports open correctly in QGIS.
- [ ] Data limitations visible in the app.
- [ ] Deployed at a public URL; demo regions work offline from cache.

---

## 13. Risks

| Risk | Plan B |
|---|---|
| Global raw download too large / slow | Demo regions + a few big fire regions first; global grid built in the background |
| FIRMS API rate limits during demo | Cache demo regions; NRT layer optional in the pitch |
| Harmonization models disagree / weak R² | Report honestly, use `fire_days` metric, larger strata |
| Contract surprises on Nov 13 | Grab one real month early (F2) |
| Backend free tier too small for the grid | Coarser grid (0.25°) for global, 0.1° for demo regions |
| UI polish eats core time | Phase 5 only starts after the MVP checklist is green |

---

## 14. Lessons from the 2025 Global Winners (follow these)

Source: the 10 projects on spaceappschallenge.org/2025/meet-the-2025-global-winners and their live sites (checked Oct 31, 2026). The closest to us is **Queñaris** (Local Impact): satellite fire detection + 20 years of vegetation history. The strongest science sites were **Resonant Exoplanets** (Best Use of Data) and **SpaceGenes+** (Best Use of Science).

### 14.1 Website structure (in this order)
1. **Hero:** one-sentence promise + 3–4 buttons: **Open the calendar · Watch demo · Presentation (PDF) · Method paper (PDF)**. (Resonant, Queñaris)
2. **The problem:** 3 short cards. (Queñaris "The Challenge We're Solving", SpaceGenes "Why this matters")
3. **The solution / features:** 3–6 cards, each one line.
4. **How it works:** 3 steps for users, then the **pipeline + the list of validation tests** we run. (Resonant shows "Detection Pipeline" and "Validation Tests" side by side)
5. **A real, validated case study:** "Río Negro, July 2026: the calendar flags it as unprecedented", compared against what CONAE reported. Resonant won Best Use of Data by showing their system matched the published K2-18b expert result: do the same.
6. **Who it's for:** responders, scientists, land managers.
7. **"Behind the calendar":** data sources and the **exact formulas** (percentile, z-score, conversion model) on the page. (SpaceGenes printed their score formula)
8. **FAQ:** 4–6 questions ("Is a hotspot a fire?", "Why not just add MODIS and VIIRS?", "How current is it?", "Can I download the data?").
9. **Team:** names, roles, photos, links. (Queñaris)
10. The **app lives on its own pages**, not inside the landing page. (Queñaris: Map · Historical Analysis · Zone Analysis)

### 14.2 The app itself
- The calendar + map is the star; the landing page only leads to it.
- Benchmark: Queñaris' history page is a year slider over a map plus 3 stat cards. Ours must clearly beat it: calendar + percentile + z-score + harmonization proof.
- Every number on screen must be real or clearly marked as an example. **No animated counters that start at 0**: Queñaris' impact numbers rendered as "0" when loaded without full JS. Render the final number in the HTML.
- Keep text readable over imagery: Resonant's hero text sat on a dark glow with weak contrast. Check 4.5:1.

### 14.3 Deliverables linked from the site and the Space Apps project page
- **Demo video:** YouTube (public or unlisted), not only Google Drive.
- **Presentation PDF** and **method / validation PDF**, hosted with the site.
- **GitHub repo** (make it public at submission time).
- Space Apps project page fields, all filled: summary (what + who it helps), details (how we built it + tools, like SkySense's paragraph), **data references** (every NASA dataset with a link), project link, demo link, **AI-use disclosure**.

### 14.4 Keep it alive after the event
- Global judging happens weeks later (2025 winners were announced Dec 18). **SkySense's domain is now for sale and A Solar Tale's site didn't load when checked.**
- Keep it up until at least the end of January. (Nov 3: we use `almatafi.monitorthesituations.com`, which renews on Jan 11 with auto-renew on, plus the free `almatafi.hamzaosama5645.workers.dev`, which doesn't expire.)
- If the backend sleeps or dies, the site must still work: ship a **static fallback** (precomputed JSON for the demo regions) the frontend switches to automatically.

### 14.5 Tech and story
- Winners used simple, reliable stacks (React/Vite on Vercel, Leaflet, Firebase; one landing page made in Framer). Reliability beats novelty.
- Tell it through a person and a place: a fire manager in Río Negro, a farmer-burning season in the Nile Delta. Henry's Farm Adventures (Art & Technology) won on a human story built from NASA data.
- Awards to aim for: **Best Use of Data**, **Best Use of Science**, **Best Use of Technology**; locally, **Local Impact** with the Nile Delta story.
