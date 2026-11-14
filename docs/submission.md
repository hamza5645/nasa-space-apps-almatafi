# Final submission drafts

Cairo rules: no live pitch. Each team submits **a 30 second video or exactly 7 slides**, first on the local form, then the same project on spaceappschallenge.org. Late submissions are not accepted. Replace every [real] number with the real data results (R2, R6) before submitting.

## Space Apps project page

**Title:** Almatafi: one fire record from MODIS and VIIRS

**High level summary**

Almatafi merges 25 years of NASA FIRMS fire detections from MODIS and VIIRS into one consistent monthly record. A plain join jumps in 2012, because VIIRS sees 3 to 5 times more hotspots for the same fires. We convert MODIS to VIIRS equivalent values per region, season and overpass time, fitted where both sensors flew and tested on years the fit never saw. Anyone can pick an area on Earth and see its burning calendar since 2001: the normal range for each month, how unusual this month is (percentile and z score), and the long term trend. Fire managers can tell a routine season from a surge, as in Río Negro in July 2026 and the Nile Delta's rice straw season.

**Project details**

1. Data: FIRMS MODIS C6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP, NOAA 20, NOAA 21), standard archive plus near real time for the newest months.
2. Cleaning: low confidence detections, volcanoes and other static sources removed.
3. Grid: a global 0.1° grid of monthly detections and fire days, per satellite and pass, stored as Parquet.
4. Harmonization: VIIRS is split at MODIS's detection floor (Sofiev and Kouznetsov 2026). Fires above it convert from MODIS by a ratio per 10° tile and month; fires below it come from each cell's own VIIRS record, scaled by the year's activity. Four models are scored by leave one year out, plus placebo break years, and the best one converts 2001 to 2012. NOAA 20 and NOAA 21 carry the record since S NPP stopped on Nov 2, 2026. Result on real data: R² [real], raw jump at 2012 [real]×, harmonized [real]×.
5. App: a FastAPI backend (DuckDB over Parquet) and a Next.js web app with a MapLibre map on NASA GIBS imagery (each detection's pixel footprint, the day's satellite image and smoke), the burning calendar with cloudy months marked and an optional cloud correction, statistics, a preview of "unusual month" alerts (not sent yet), and CSV, GeoJSON, KML and Cloud Optimized GeoTIFF exports.

**NASA data used**

1. FIRMS MODIS C6.1 active fires: https://firms.modaps.eosdis.nasa.gov/
2. FIRMS VIIRS 375 m active fires (S NPP, NOAA 20, NOAA 21): https://firms.modaps.eosdis.nasa.gov/
3. GIBS imagery: Blue Marble, and the day's MODIS/VIIRS corrected reflectance and OMPS/OMI aerosol index (smoke) on the map: https://earthdata.nasa.gov/gibs
4. Cloud correction: NASA GIBS's daily MODIS cloud fraction (MOD06/MYD06, Terra and Aqua; layers `MODIS_Terra_Cloud_Fraction_Day`, `MODIS_Aqua_Cloud_Fraction_Day`), averaged per 0.5° cell and month from every second day, November 2000 to now. The method follows MOD14CMH/MYD14CMH (Giglio 2006); those files themselves are not read.

**Acknowledgement:** We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS), with near real-time data from LANCE. MODIS: Giglio et al. 2016, doi:10.1016/j.rse.2016.02.054. VIIRS: Schroeder et al. 2014, doi:10.1016/j.rse.2013.12.008. FIRMS: Davies et al. 2009, doi:10.1109/TGRS.2008.2002076.

**Other data:** geoBoundaries (admin areas), OpenStreetMap via Nominatim (place search), OpenFreeMap basemap (OpenStreetMap data).

**AI use disclosure:** We used Claude Code (Anthropic) as a coding assistant for parts of the pipeline, backend and web app. We designed the method, reviewed the code, and checked every result against the data ourselves. The landing page's films, stills and portraits are AI-generated (Higgsfield: Soul stills, Kling image-to-video); they set the scene and carry no data. Every number, map and the globe's fires are NASA data. Wel3a, the flame guide in the corner, answers typed questions with an AI model (Gemma on Cloudflare Workers AI) from a fixed fact sheet and the numbers on the page; its answers are labelled as AI in the chat, and its pop-up tips are written by us.

**Links:** demo https://almatafi.monitorthesituations.com · repo [make public at submission] · video [YouTube] · slides [PDF]

## The 7 slides

1. **The challenge:** two NASA fire records that don't agree; the 2012 jump chart.
2. **Why it matters:** "Is this fire season normal?" can't be answered on a broken record.
3. **The solution:** one harmonized record and a burning calendar for any area.
4. **How it works:** pixel size, sensitivity and overpass time, the three fixes and the pipeline.
5. **Proof:** leave one year out R² [real], break test raw [real]× vs ours [real]×.
6. **Río Negro, July 2026:** the calendar puts it against every July since 2001 (z [real]).
7. **The Nile Delta and what's next:** the rice straw season for Cairo, then the live link and the team.

## The 30 second video

| Time | On screen | Voice |
|---|---|---|
| 0 to 5 s | Globe with fire dots | "Is this fire season normal? NASA has 25 years of fire data to answer." |
| 5 to 12 s | The 2012 jump chart | "But two satellites count fires differently, and the record breaks in 2012." |
| 12 to 20 s | Raw line becomes the harmonized line | "Almatafi converts them into one consistent record, tested year by year." |
| 20 to 27 s | Explorer: draw an area, the calendar, Río Negro July 2026 lights up | "Pick any area and see every month since 2001, and how unusual this one is." |
| 27 to 30 s | Logo, link | "Almatafi. One fire record for the whole planet." |

Arabic narration needs English subtitles.
