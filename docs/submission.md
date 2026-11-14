# Final submission drafts

Cairo rules: no live pitch. Each team submits **a 30 second video or exactly 7 slides**, first on the local form, then the same project on spaceappschallenge.org. Late submissions are not accepted. The slides and video outline below still carry [real] placeholders; the fields don't.

## Submission fields (Cairo form and NASA project page)

Final texts, written Nov 14 (X44). The same text serves both forms. The pack with the PDF and screenshots is in `~/Downloads/almatafi-submission/` on Khalid's Mac (`fields.md`, `Almatafi-project-documentation.pdf`, `screenshots/`, `00-READ-ME-FIRST.md` with the open points). Anything in [square brackets] is still to fill in. The record on the live site is simulated (`mock-20261114`) and the texts say so; when the real build lands, rewrite the last sentence of the summary, the Evidence section and limitation 1.

### Project name

Almatafi: one fire record from MODIS and VIIRS

Team: Almatafi (NASA Space Apps Cairo 2026)
Members: Yassin Ali Salah Ali Ali El Deeb (team owner), Ahmed Hany, Fatema, Hamza Abdelrahman Mohamed Osama Ibrahim Mohamed, Rowaina Mohamed Ahmed, Khalid Osam
Challenge: Harmonization of MODIS and VIIRS Hot Spots
NASA project page: https://www.spaceappschallenge.org/2026/find-a-team/almatafi/?tab=project

---

### Link to your final project

https://almatafi.monitorthesituations.com

Supporting link (source code, once the repository is public): https://github.com/hamza5645/nasa-space-apps-almatafi

If the form has room for a note beside the link, paste this:

No login is needed. Three clicks show what it does: (1) on the home page, press "Open Río Negro, July 2026" and read the answer at the top of the page; (2) switch the Nile Delta between "MODIS only", "VIIRS only" and "Harmonized", then use the slider under the map; (3) press "Play" and try one chapter of the game. The Method page lists what works, the validation results and the limits.

---

### High-level project summary

We developed Almatafi, a web platform that merges 25 years of NASA FIRMS fire detections from MODIS and VIIRS into one consistent record, so any month anywhere on Earth can be judged against its own history. The two sensors cannot simply be joined: in one week of real FIRMS data, VIIRS reported 300,095 hotspots where MODIS reported 58,127, so a plain join shows a false surge in 2012. Almatafi converts MODIS to VIIRS-equivalent counts per region, season and overpass time, fitted on the years both sensors flew and tested on years the fit never saw. Users draw any area and get its burning calendar since 2001: the normal range for each month, how unusual this month is, the long-term trend, each hotspot on the map, and downloads for GIS tools. A learning game, a guide character and a voice-controlled accessibility mode open it to non-experts. This matters because fire managers need to tell a routine season from an unprecedented one, as in Río Negro in July 2026 or the Nile Delta's rice-straw season, and that answer should not depend on which satellite was watching. At submission, the method and the app are complete and tested; the 25-year record on the live site still runs on a simulated FIRMS-format data set, which the site labels, while the globe, the map imagery, the cloud cover and the live hotspots are real NASA data.

---

### Project details

WHAT IT DOES

Almatafi answers one question for any place on Earth: is this fire season normal? You choose an area (draw a polygon or a box, search a place, pick a province, or type a latitude and longitude) and the site shows:

1. The answer in one sentence, for example "October 2026: 589 hotspots. Unusually high: 2.4 times a typical October, and the most for October in 26 years."
2. A burning calendar: every month since 2001 as a grid of years and months, on one consistent record.
3. Statistics for the chosen month: typical value, usual range, rank, percentile, z-score, and the long-term trend.
4. A map of the individual hotspots with their details (time, satellite, fire power, confidence), each detection's pixel footprint, the satellite image of that day and a smoke layer.
5. Downloads: hotspots as CSV, GeoJSON or KML, the calendar as CSV, and the 0.1° grid as a Cloud-Optimized GeoTIFF. A share link reopens the same view.

HOW TO TRY IT

Two minutes, no login.

1. Home page, "Open Río Negro, July 2026": read the answer, then click any other month in the calendar.
2. Open the Nile Delta and switch between "MODIS only", "VIIRS only" and "Harmonized". The same fires give different counts. The slider under the map moves from the raw join to our record and the step at 2012 disappears.
3. Press "Play" and try one chapter of "Normal or not?".

THE PROBLEM

MODIS (since 2000, 1 km pixels) and VIIRS (since 2012, 375 m pixels) detect the same fires differently. VIIRS sees smaller and cooler fires, so it reports several times more hotspots. In the real FIRMS week of 27 October to 3 November 2026, VIIRS on NOAA-20 reported 300,095 detections and MODIS on Terra and Aqua 58,127 (5.2 times more); over the Nile Delta it was 88 against 7. Joined as they are, the two records show fire seeming to explode in 2012, and no month before 2012 can be compared with one after it.

HOW IT WORKS

1. Clean. Each FIRMS row is parsed strictly. Low-confidence detections are dropped (MODIS confidence under 30, VIIRS "low"). Only vegetation fires are kept; cells that the archive flags again and again as static sources (gas flares, industry, volcanoes) are masked.
2. Common grid. Both sensors are counted on the same global 0.1° grid (about 10 km), per month, satellite and day or night pass, as detections and as fire days. This removes the pixel-size difference.
3. Sensitivity. VIIRS detections are split at the fire power MODIS needs to see a fire (its detection floor, which grows with pixel area; Sofiev and Kouznetsov 2026). Fires above the floor are converted from MODIS by a ratio learned per 10° tile and calendar month. Fires below the floor, which MODIS cannot see, come from each cell's own VIIRS record, scaled by how active that year was.
4. Overpass time. Aqua and VIIRS pass at about 13:30, Terra at 10:30. Aqua is calibrated against VIIRS on 2012 to 2022, Terra against Aqua on 2003 to 2011, day and night separately. NOAA-20 and NOAA-21 fill gaps in Suomi NPP after their own calibration, and carry the record since Suomi NPP stopped delivering data on 2 November 2026.
5. Model choice. Four conversion models (ratio, log-linear, quantile mapping, and the split model above) are scored by leave-one-year-out: fit without a year, predict it, compare. The best one is used.
6. Analysis. For an area, the monthly count is the sum of the cells whose centre is inside it. The baseline is the same month in the other years. Percentile, z-score, Sen's slope for the trend. The current month is compared with the same days of past years.
7. Clouds (optional view). A fire under cloud is not detected. Each cell's count can be divided by its clear-sky share, using NASA's daily MODIS cloud fraction averaged per month, capped at five times. Months that were more than half under cloud are marked.

EVIDENCE

The pipeline was developed on a simulated data set in the exact FIRMS file format: six regions, 26 years, with known true fires that each simulated sensor sees with its own pixel size, sensitivity and overpass time. Because the truth is known, the method can be checked against it. Results on that data set:

1. Leave-one-year-out, predicting VIIRS from MODIS for years left out of the fit: R² 0.976 on 1,341 tile-month totals (0.968 on small 1° areas).
2. Break at 2012 (hotspots after 2012 divided by before): raw join 4.61 times, our record 1.03 times.
3. Pettitt change-point test: raw join p = 0.0003 (a break), our record p = 0.85 (none).
4. Placebo break years inside one sensor's era (2005, 2007, 2017, 2020): 0.85 to 1.08 times, so 1.03 at 2012 is ordinary.
5. Against the known true fires, per region: raw join 3.2 to 15.0 times, our record 0.95 to 1.08 times.

On real NASA data so far: real FIRMS country files (MODIS 2010 for Egypt, Argentina and Chile, 71,180 rows; VIIRS 2019 for Egypt, 67,424 rows) pass through the cleaning step with no row rejected, and the format matches. The code has 559 automated tests (228 pipeline, 229 backend, 102 frontend) that run on every change.

WORKING NOW

1. The whole web app at the link above: explorer, calendar, statistics, map, downloads, share links, the Method page with the validation.
2. The full pipeline: clean, grid, harmonize, validate, and a tool that downloads the FIRMS archive and near-real-time data.
3. Real NASA data on the live site: the globe's week of fires (FIRMS public 7-day files), all map and globe imagery (GIBS), the cloud cover behind the cloud-corrected view (MODIS cloud fraction, 2000 to 2026), and live hotspots from the FIRMS API for the last days in any area.
4. "Normal or not?", a five-chapter game with 14 questions that teaches what a hotspot is, why the two satellites disagree, and how to read a fire season.
5. Wel3a, a flame guide on every page: written tips, and a chat that answers questions from a fixed fact sheet and the numbers on screen.
6. An accessibility mode with eight tools, listed under "Accessibility tools" below.
7. A guided tour of the explorer, a narrated story on the home page with captions, and an offline copy of the two demo regions if the server cannot be reached.

ACCESSIBILITY TOOLS

One round button on every page (bottom right, or Alt + A on the keyboard) opens the accessibility panel. With the mode off, the site is unchanged. With it on, these tools are available, and the choices are remembered on the device:

1. Text size: Normal, Large, Larger or Largest, with A− and A+ buttons. All text grows, including the calendar's numbers; the map keeps its size.
2. High contrast: pure black and white, thick outlines, underlined links, and no scenery behind the numbers.
3. Reduce motion: still images instead of the 3D globe, the films and the page transitions.
4. Keyboard mode: a focus ring that is always visible, skip links at the top of every page (to the content, the answer, the calendar, the map and the downloads), arrow keys to move between months in the calendar, and the Alt shortcuts below.
5. Voice reading: the site says aloud what you land on (its name, what kind of control it is and its state), reads the answer when the month changes and announces each new page. "Read this page" reads the whole page from the top; Escape stops the voice.
6. Voice commands ("Say a command", or Alt + M): "open the explorer", "method", "play the game", "home", "read the page", "stop", "bigger text", "smaller text", "high contrast", "contrast off", "reduce motion", "Nile Delta", "Río Negro", "next month", "previous month", "show MODIS", "show VIIRS", "show harmonized", "click" followed by a button's name, and "help". "Keep listening" leaves the microphone on for one command after another.
7. Keyboard shortcuts: Alt + A opens the panel, Alt + K lists the shortcuts, Alt + R reads the page, Alt + V turns voice reading on or off, Alt + M listens for a command, Alt + plus and Alt + minus change the text size, and Alt + 1, 2, 3 and 4 go to the story, the explorer, the Method page and the game.
8. A six-step guide opens the first time the mode is turned on, with the real controls inside each step, and can be reopened from the panel ("Open the guide"). "Shortcuts and commands" shows the full list at any time.

Voice reading and voice commands use the browser's own speech features (Chrome, Edge and Safari).

LIMITATIONS

1. The 25-year record on the live site is built from the simulated data set, not yet from the real FIRMS archive. The calendar numbers for the Nile Delta and Río Negro, and the validation numbers above, are therefore simulated. The site says so on the home page, the Method page and in the guide's answers.
2. A hotspot is not a fire, and no hotspot is not proof of no fire: clouds, smoke, small fires and timing hide fires. The calendar counts detections, not burned area.
3. The record sits on a 0.1° grid, so areas smaller than four cells are coarse and get a warning.
4. January 2001 to June 2002 has Terra only; single months there are less reliable where fires burn in the afternoon.
5. The cloud-corrected view leans high (thin cloud and haze count as cloud); read it as an upper bound.
6. "Alert me" shows a preview of the alert email; no email is sent yet.
7. Voice commands depend on the browser's speech recognition (Chrome, Edge, Safari).

FUTURE PLANS

1. Build the record from the real FIRMS archive, first for Egypt, Argentina and Chile, then globally, and publish the validation on real data.
2. Use FIRMS's own list of days without data for coverage, and add land-cover classes to the conversion.
3. Compare with burned-area products as an independent check that no 2012 step remains.
4. Send real "unusual month" alerts by email.

BENEFITS AND AIM

Fire managers can tell a routine season from a surge on one record that does not change meaning when the satellites do. Scientists get one sensor-independent monthly series from 2001 with its validation published. Land managers and farmers can see the critical months before they arrive. Students and the public can learn how fire is seen from space through the game and the guide. Our aim is a public tool that gives the same answer for the Nile Delta's rice-straw season and for a winter outbreak in Patagonia, whichever satellite was overhead.

TOOLS

Pipeline: Python 3.12, pandas, NumPy, PyArrow, DuckDB, Parquet and GeoParquet. Backend: FastAPI, DuckDB, Shapely, pyproj, rasterio (Cloud-Optimized GeoTIFF), httpx; Docker image run with Podman. Web app: Next.js, React and TypeScript; MapLibre GL with Terra Draw for the map; three.js for the globe; GSAP and Lenis for scrolling; TanStack Query and Zustand. Hosting: Cloudflare Workers (site and the guide's AI function), a small server behind Cloudflare Tunnel (API), GitHub Actions for tests and deployment. Video: Remotion and FFmpeg.

---

### NASA data

1. NASA FIRMS MODIS Collection 6.1 active fire detections (Terra and Aqua, 1 km).
   https://firms.modaps.eosdis.nasa.gov/
   Role: one half of the record. Used three ways: the public 7-day files for the globe on the home page (27 October to 3 November 2026, worldwide, 58,127 detections); real yearly country files (2010; Egypt, Argentina, Chile) to confirm the file format and the cleaning rules; and the FIRMS area API for live hotspots. Our simulated development data set copies this product's exact columns and formats.

2. NASA FIRMS VIIRS 375 m active fire detections (Suomi NPP, NOAA-20, NOAA-21).
   https://firms.modaps.eosdis.nasa.gov/
   Role: the other half, and the unit the record is expressed in (VIIRS Suomi NPP equivalent). Used the same three ways: the globe's week (300,095 NOAA-20 detections worldwide, 88 over the Nile Delta), a real country file (2019, Egypt) for format and cleaning, and the area API for live hotspots.

3. NASA FIRMS API (area and data-availability services, near-real-time data from LANCE).
   https://firms.modaps.eosdis.nasa.gov/api/
   Role: the site's server asks it for the last days of hotspots in any area a visitor chooses, cleans them with the same rules as the pipeline and shows them on the map. The data-availability service decides, per day, whether standard or near-real-time data is used.

4. NASA GIBS (Global Imagery Browse Services) imagery.
   https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api
   Role: Blue Marble Next Generation and VIIRS Black Marble for the globe and the map; the MODIS and VIIRS corrected-reflectance (true colour) image of the selected day; the OMPS and OMI aerosol index as the smoke layer.

5. MODIS cloud fraction (MOD06 / MYD06, Terra and Aqua), served by GIBS as the layers MODIS_Terra_Cloud_Fraction_Day and MODIS_Aqua_Cloud_Fraction_Day.
   Role: the cloud-corrected view. Read for every second day from November 2000 to October 2026, averaged per 0.5° cell and month for the six study regions (132,880 cell-months), and used to mark cloudy months and to scale counts by the clear-sky share.

6. NASA 3D Resources: the Aqua and Suomi NPP spacecraft models.
   https://github.com/nasa/NASA-3D-Resources
   Role: the two satellites that orbit the globe on the home page and the Method page.

7. NASA documentation that shaped the method: the FIRMS FAQ and download pages, the MODIS Collection 6 / 6.1 active fire user guide and the VIIRS VNP14IMG user guide (confidence classes, fire types, day and night definitions, platform dates, the end of Suomi NPP data).

Acknowledgement: We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://www.earthdata.nasa.gov/data/tools/firms), part of NASA's Earth Science Data and Information System (ESDIS), and from NASA's Global Imagery Browse Services (GIBS). Near-real-time data come from LANCE, operated by ESDIS.

---

### Link list for the NASA page's "NASA Data" field

The NASA page takes this field as a list of links (Link Text + full URL), not as a paragraph. Add one row per line below. The longer NASA data text above goes in the Cairo form and the PDF; on the NASA page, put the "how we used it" part in the Detailed Project Description.

| Link Text | URL |
|---|---|
| NASA FIRMS: Fire Information for Resource Management System | https://firms.modaps.eosdis.nasa.gov/ |
| FIRMS active fire data: MODIS Collection 6.1 and VIIRS 375 m (S-NPP, NOAA-20, NOAA-21) | https://firms.modaps.eosdis.nasa.gov/active_fire/ |
| FIRMS yearly country files (MODIS and VIIRS archive) | https://firms.modaps.eosdis.nasa.gov/country/ |
| FIRMS API (area and data-availability services, near-real-time data) | https://firms.modaps.eosdis.nasa.gov/api/ |
| FIRMS FAQ | https://www.earthdata.nasa.gov/data/tools/firms/faq |
| NASA GIBS: Global Imagery Browse Services (Blue Marble, Black Marble, corrected reflectance, aerosol index, MODIS cloud fraction) | https://nasa-gibs.github.io/gibs-api-docs/ |
| MODIS instrument (Terra and Aqua) | https://www.earthdata.nasa.gov/data/instruments/modis |
| VIIRS instrument (Suomi NPP, NOAA-20, NOAA-21) | https://www.earthdata.nasa.gov/data/instruments/viirs |
| NASA 3D Resources (Aqua and Suomi NPP spacecraft models) | https://github.com/nasa/NASA-3D-Resources |

---

### Space agency partner and other data

SPACE AGENCY PARTNER

1. CONAE, the National Space Activities Commission of Argentina (a 2026 Space Apps partner), co-authored this challenge. Its example in the challenge, the winter fires in Río Negro in July 2026 ("routine or unprecedented?"), is our main case study and one of the two demo regions. No CONAE data set is used.

OTHER DATA AND SERVICES

2. geoBoundaries (https://www.geoboundaries.org/), CC BY 4.0: country and province outlines for choosing an area.
3. OpenStreetMap through Nominatim (https://nominatim.org/), © OpenStreetMap contributors, ODbL: place search.
4. OpenFreeMap (https://openfreemap.org/) with OpenMapTiles and OpenStreetMap data: the base map.

SOFTWARE

5. Python (all open source): pandas, NumPy, PyArrow, DuckDB, FastAPI, Uvicorn, Shapely, pyproj, rasterio, httpx, matplotlib, pytest.
6. Web: Next.js, React, TypeScript, MapLibre GL JS, Terra Draw, three.js, GSAP, Lenis, TanStack Query, Zustand.
7. Fonts (SIL Open Font License, Google Fonts): Archivo, IBM Plex Mono, Instrument Serif, Pixelify Sans.
8. Video: Remotion, FFmpeg.
9. Hosting: Cloudflare Workers, Workers AI and Tunnel; GitHub and GitHub Actions; Podman.

REFERENCES FOR THE METHOD

10. Giglio, Schroeder and Justice 2016, Remote Sensing of Environment 178, doi:10.1016/j.rse.2016.02.054 (MODIS Collection 6 active fires).
11. Schroeder et al. 2014, Remote Sensing of Environment 143, doi:10.1016/j.rse.2013.12.008 (VIIRS 375 m active fires).
12. Davies et al. 2009, IEEE Transactions on Geoscience and Remote Sensing 47, doi:10.1109/TGRS.2008.2002076 (FIRMS).
13. Giglio et al. 2006, JGR Biogeosciences 111, doi:10.1029/2005JG000142 (cloud and overpass corrections).
14. Li et al. 2018, JGR Atmospheres 123, doi:10.1029/2017JD027823 (MODIS and VIIRS compared).
15. Chen et al. 2023, Earth System Science Data 15, doi:10.5194/essd-15-5227-2023 (GFED5), and Chen et al. 2026, ESSD 18, doi:10.5194/essd-18-7535-2026 (GFED5NRT).
16. Sofiev and Kouznetsov 2026, EGUsphere preprint, doi:10.5194/egusphere-2026-89 (detection limits by pixel area).
17. Giglio 2025, LANCE user group slides on Terra and Aqua orbit drift.

OUR OWN MATERIAL

18. The voice narration on the home page and in the video is recorded by a team member. The music and sound effects in the video and the game are synthesized by our own code; no outside music is used.

---

### Use of artificial intelligence / super intelligence (AI/SI)

Yes. The idea, the harmonization method and the choice of tests are ours; the tools below supported building it.

1. Claude Code (Anthropic, large language model). Used as a coding assistant for the data pipeline, the backend, the web app, their tests and code reviews, and to help draft documentation and these submission texts. Affected parts: the source code and the documents. This is acknowledged here, in the repository's project log and in its commit messages (each assisted commit carries a "Co-Authored-By: Claude" line).

2. Higgsfield (Soul image model and Kling image-to-video). Used for the scene-setting stills, short films and portraits on the home page and behind the explorer (the Nile Delta and Patagonia scenes, the smoke transition, the three "who it's for" portraits), and for background shots and character motion in the demo video. They carry no data; every number, map and the globe's fires come from data. They are named as AI-generated in the site's FAQ ("What is real and what is generated?") and in the Method page's sources. [Before submitting: confirm each of these images and clips shows a visible "AI-generated" mark; see the read-me.]

3. Gemma on Cloudflare Workers AI (large language model). Powers the chat of Wel3a, the guide character. It answers from a fixed fact sheet and the numbers on the page; the chat states "AI answers can be wrong. Trust the numbers on the page." The guide's pop-up tips are written by us, not generated.

4. Manus AI (image generation). Used to make the pixel-art character sprite sheets in the game and the demo video (the host, Khalid, the explorer, the firefighter and the fire truck).

5. Browser speech synthesis and speech recognition (built into Chrome, Edge and Safari). Used by the accessibility mode to read the page aloud and to take voice commands. Nothing is generated for the project's content.

Not AI: the voice narration (a team member's own recording), and the music and sound effects (synthesized by our own code). [Add "No generated content uses NASA logos, flags or mission identifiers." once you have checked the video's satellite shots; see the read-me.]

---

### Link of project documentation file (PDF)

https://drive.google.com/file/d/1kKndxddK_QKDpkAaqTZAew9q9_z-Kbiz/view

(On Google Drive, shared as "Anyone with the link: Viewer"; opens without login, checked 14 November.)

---

### Link to project demo

https://youtu.be/CgGGvNjnf54

(29 seconds, unlisted on YouTube, opens without login; checked 14 November.)

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
