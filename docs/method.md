# Method

How Almatafi turns MODIS and VIIRS hotspots into one record. The code is in `pipeline/almatafi/`, and the contracts are in `contracts/`.

> **Numbers below are from the mock data** (`mock-20261103`), which simulates known fires. R6 replaces them with the real FIRMS results on Nov 13 to 17.

## 1. Data

NASA FIRMS active fire detections:

| Platform | Sensor | From | Overpass (local solar time) |
|---|---|---|---|
| Terra | MODIS C6.1, 1 km | 2000-11-01 | 10:30 and 22:30 |
| Aqua | MODIS C6.1, 1 km | 2002-07-04 | 13:30 and 01:30 |
| Suomi NPP | VIIRS 375 m | 2012-01-20 | 13:30 and 01:30 |
| NOAA 20 | VIIRS 375 m | 2018-04-01 | about 50 minutes after S NPP |
| NOAA 21 | VIIRS 375 m | 2023-03-01 | between the two |

**Sources:** the standard archive for most of the record. Near real time data covers the newest months, which standard processing hasn't reached yet (about 4 months).

**Format differences:** NRT rows have no `type` column. `docs/firms-research.md` lists every format difference we found.

## 2. Cleaning (`ingest.py`, `grid.py`)

1. **Normalize:** every row is parsed strictly, and satellite and confidence spellings are normalized. Rows with bad coordinates, dates, FRP or day/night flags, or a platform before its start date, are dropped and counted in a report.
2. **Confidence:** MODIS confidence must be ≥ 30; VIIRS `low` is dropped.
3. **Static sources:** only vegetation fires are kept (`type = 0`). Cells that the archive flags as static sources (`type = 2`) in 6 or more months are masked, which also covers the NRT months, where `type` is missing.
4. **Duplicates:** exact duplicates are removed.

## 3. Common grid (`cells.py`, `grid.py`)

Every point falls in a 0.1° cell: `cell_id = row × 3600 + col`, where row = ⌊(lat + 90) × 10⌋ and col = ⌊(lon + 180) × 10⌋. A TypeScript twin of this function (`frontend/lib/grid.ts`) passes the same test vectors.

**Per cell and month,** for each platform and pass:
- `detections`: number of hotspots;
- `fire_days`: days with at least one hotspot. This is less sensitive to pixel size, because a cell either burned that day or it didn't.

## 4. Harmonization (`harmonize/`)

The target is **VIIRS S NPP equivalent** values. Version 2 (X14) follows the published work on these two sensors; the sources are in §8.

### 4.1 Who stands for each month

- Months from Feb 2012 are observed by S NPP.
- **S NPP gaps are filled by NOAA 20, else NOAA 21,** each after its own calibration to S NPP. S NPP stopped on Nov 2, 2026 (FIRMS FAQ), so every month after October 2026 is a gap and the record carries on through NOAA 20.
- Months from Jul 2002 to Jan 2012 are Aqua, converted.
- Months before Jul 2002 are Terra, converted to Aqua first.
- Months no satellite observed are "not observed", never 0.

### 4.2 Conversion steps and their windows

| Step | Fitted on | Why |
|---|---|---|
| Aqua → S NPP | Feb 2012 to Dec 2022 | Same overpass time. After 2022 Aqua's orbit drifts (last manoeuvre 2021), and the effect on fire products is still being studied (Giglio 2025) |
| Terra → Aqua | 2003 to 2011 | Aqua's first full years before VIIRS, as GFED5 does for the Terra only months |
| NOAA 20 → S NPP | Apr 2018 to Oct 2026 | Same instrument: a plain ratio |
| NOAA 21 → S NPP | Mar 2023 to Oct 2026 | Same instrument: a plain ratio |

Day and night passes are fitted separately and then added.

### 4.3 Strata

Each fit is made per 10° tile × calendar month. Where a stratum has fewer than 30 overlap cell-months, it falls back to the tile across all months, then a latitude band × month, then global × month, then global.

### 4.4 The MODIS detection floor (`grid.py`)

MODIS needs more fire power than VIIRS to see a fire, and more off nadir, where its pixels grow to about 10 km². Its detection limit is linear in pixel area A (Sofiev and Kouznetsov 2026):

- day: 4.44 × A + 0.52 MW
- night: 4.43 × A + 1.01 MW

A is the run's median MODIS pixel area (`scan` × `track`). VIIRS 375 m FRP is shared out over a fire's pixels (it comes from the 750 m band), so the floor is tested on clusters: same satellite, same overpass minute, same 0.02° box. Each grid row then has `detections_big` and `fire_days_big`, the part MODIS could have seen. For MODIS rows that is all of it.

### 4.5 Models

| Model | Formula |
|---|---|
| M0 ratio | VIIRS = k × MODIS, with k = ΣVIIRS ÷ ΣMODIS over the stratum's overlap |
| M1 log linear | log(1 + VIIRS) = a + b × log(1 + MODIS) |
| M2 quantile mapping | each MODIS value is mapped to the VIIRS value at the same quantile of the stratum |
| **M3 split** | VIIRS = k × MODIS + small(c, m) × r |

M3 is new in v2:
- **k** = Σ VIIRS above the floor ÷ Σ MODIS, per stratum: like for like fires.
- **small(c, m)** is the cell's mean VIIRS count below the floor for that calendar month over the overlap years (years with nothing count as 0). These are the fires MODIS can't see.
- **r** = (tile's MODIS count that month + 5) ÷ (its mean over the overlap + 5), clipped to 0.2 to 5. Small fires follow the year's activity; the 5 keeps quiet tiles from swinging on one or two hotspots.

M0 to M2 can only put the small fires where MODIS happened to see something, so a quiet place before 2012 becomes a patchwork of zeros and spikes. M1 and M2 keep their totals with a mass factor; M0 has it built in.

## 5. Validation (`harmonize/validate.py`)

| Test | Mock result |
|---|---|
| Leave one year out on the overlap, scored on 10° tile × month totals | R² 0.976 (M3), 0.974 (M0), 0.968 (M2), 0.963 (M1); M3 is used |
| Same, on 1° × month totals (a small area) | R² 0.968 (M3), 0.955 (M0), 0.944 (M2), 0.930 (M1) |
| Break at 2012: mean yearly total after ÷ before | raw join 2.87×, harmonized 1.03× |
| Placebo break years 2005 and 2007 (inside the MODIS era), 2017 and 2020 (inside the VIIRS era) | harmonized 0.85× to 1.08×. The 2012 ratio (1.03×) is inside that natural range; the raw join (2.87×) is far outside it |
| Pettitt change point test | raw p = 0.0003 (break), harmonized p = 0.85 (none) |
| Against the known fires, per region (mock only) | raw join 1.7× to 11.7×, harmonized 0.95× to 1.08× |
| Nile Delta before 2012 (mock), M3 vs M0 | false zero months 17 → 0; October's year to year spread 0.47 → 0.40 (VIIRS era: 0.37) |

The build writes `validation.json` (served at `/api/validation`), 4 charts and `validation.md`. It also writes a season check: the share of each calendar month in the year, MODIS era against VIIRS era (mock: correlation 0.994, same peak month).

**Considered, not done yet:**
- Cloud correction from real data (Giglio 2006): FIRMS files carry no cloud information. The correction is built (§6) on a simulated cloud product; reading MOD14CMH/MYD14CMH (monthly 0.5° CMG, HDF4, UMD sftp) is not.
- Land cover strata (GFED5): this needs MCD12Q1.
- Duplicate removal across overlapping swaths (Li 2018): FIRMS times are to the minute, so it can't be done exactly. Fire days are not affected.

## 6. Analytics (`backend/app/analytics.py`)

For an area and a month, the count is the sum of harmonized values over the cells whose centre is inside the area.

**Baseline:** the same month from 2001 to last year, without the year being judged.

**Statistics:**
- **Percentile rank:** the share of baseline years with a lower count.
- **z score:** (count − mean) ÷ sd.
- **Status bands:** z ≥ 2 unusual, 1 to 2 above normal, ≤ −1 below normal.

**Current month:** month to date, compared with the same days of past years.

**Trend:** Sen's slope on yearly totals, with a Mann-Kendall p value.

**Small areas:** areas under 4 cells get a coarse grid warning.

**Cloud correction (optional, X27, `pipeline/almatafi/clouds.py`, `backend/app/series.py`).** A fire under cloud is not detected, so a cloudy month looks quieter than it was. Each harmonized cell count is divided by its clear share:

    corrected = Σ over the area's cells  value ÷ max(1 − cloud fraction, 0.2)

The cloud fraction is the monthly mean of the 0.5° cell holding the 0.1° cell (the 0.5° grid nests the 0.1° one), from Aqua's 13:30 pass, VIIRS's overpass time, and Terra's 10:30 pass before July 2002. The 0.2 floor caps the factor at 5. It assumes fires under cloud burn at the same rate as in clear parts of the cell (Giglio et al. 2006); where cloud and fire seasons are tied (monsoon burning), that over- or under-corrects. It applies to harmonized hotspots only (fire days can't exceed the days of a month), and the baseline is corrected the same way, so z and percentile compare like with like. Every calendar also reports the area's mean cloud fraction per month and marks months above 50%.

**The cloud product is simulated for now** (`source: mock`, shown in the app): a latitude and season pattern with dry deserts and year-to-year noise. The real input is MOD14CMH/MYD14CMH (monthly, 0.5°), the products FIRMS's FAQ points to for cloud-aware analysis. The mock sensors aren't thinned by cloud, so the correction can't be validated on the mock.

## 7. Limits

- **M3's small fires come from the 2012 to 2022 average.** A month in those years is partly inside the small-fire part of every converted year before 2012, so a spike made of small fires is compared with a slightly raised pre-2012 baseline. The demo months (2026) are outside that window.
- A hotspot is not a fire, and no hotspot is not proof of no fire: clouds, smoke and timing hide fires.
- The calendar counts detections, not area burned.
- **A static source's cell is left out for the whole record.** A cell flagged as a static source (gas flares, industry, volcanoes) is masked in every month from 2001 on, so a real fire in that cell is never counted.
- **The first 18 months are Terra only (2001-01 → 2002-06).** Aqua starts in July 2002. Where Terra sees few fires, single Terra months are unreliable even when the period's total is right: in the Nile Delta, where fires burn in the afternoon after Terra's 10:30 pass, Terra sees 0–4 hotspots a month, and on the mock half of those months came out as 0 against the true fires. Read 2001 and early 2002 with care there.
- The record sits on a 0.1° grid (about 10 km), so small areas are coarse.
- **Day and night are defined differently by FIRMS's products.** Standard files call a pixel night when the solar zenith angle is above 85°; NRT files use the orbit (ascending day, descending night). The day and night floors (§4.4) take the field as given, so standard months and NRT months split slightly differently near the terminator and at high latitudes. Monthly totals add both passes, so the effect there is small.
- **South Atlantic Anomaly.** FIRMS removes low-confidence night pixels over 11°E–110°W, 7°N–55°S from NRT data (we drop low confidence everywhere, so standard and NRT agree), but a few spurious nominal pixels still come through, about 2–3 a night across the whole region. Río Negro is inside it; a night-heavy spike there deserves a look at the day/night split.
- **Cloud cover is simulated** until MOD14CMH/MYD14CMH are read (§6). The cloud marks and the corrected view show how the correction works, not real cloud.
- The conversion is learned from the overlap years, so it assumes the relation between the sensors in a region and season was the same before 2012.

## 8. Sources for the method

- Schroeder et al. 2014, Remote Sensing of Environment 143, doi:10.1016/j.rse.2013.12.008
- Li, Zhang, Kondragunta, Csiszar 2018, JGR Atmospheres 123, doi:10.1029/2017JD027823
- Giglio et al. 2006, JGR Biogeosciences 111, doi:10.1029/2005JG000142
- Chen et al. 2023 (GFED5), ESSD 15, doi:10.5194/essd-15-5227-2023
- Chen et al. 2026 (GFED5NRT), ESSD 18, doi:10.5194/essd-18-7535-2026
- Sofiev and Kouznetsov 2026, EGUsphere preprint, doi:10.5194/egusphere-2026-89 (we used the preprint's coefficients; check the final GMD version)
- Giglio 2025, LANCE user group slides on Terra and Aqua orbit drift
- MODIS C6/C6.1 and VNP14IMG user guides; FIRMS FAQ (S NPP end date)
- Giglio, Schroeder and Justice 2016, Remote Sensing of Environment 178, doi:10.1016/j.rse.2016.02.054 (MODIS Collection 6 active fires)
- Davies, Ilavajhala, Wong and Justice 2009, IEEE Transactions on Geoscience and Remote Sensing 47, doi:10.1109/TGRS.2008.2002076 (FIRMS)

## 9. Acknowledgement

We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://www.earthdata.nasa.gov/data/tools/firms), part of NASA's Earth Science Data and Information System (ESDIS), and from NASA's Global Imagery Browse Services (GIBS), part of ESDIS. Near real-time data come from LANCE (Land, Atmosphere Near real-time Capability for Earth observation), operated by ESDIS.
