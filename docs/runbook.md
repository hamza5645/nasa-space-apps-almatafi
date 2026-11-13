# Nov 13 runbook: real data

One script does the whole build: `scripts/build-data.sh`. Rehearse it on mock first, which takes about 35 s and needs no network.

```
scripts/build-data.sh mock
```

## On the day

1. **Get a FIRMS MAP_KEY** (free, by email): https://firms.modaps.eosdis.nasa.gov/api/map_key/
2. **Download and build:**
   ```
   FIRMS_MAP_KEY=... scripts/build-data.sh real --fetch
   ```
   - The yearly country files for Egypt, Argentina and Chile, 2000 to last year (standard processing, no key needed). NOAA-20's files are called `viirs-jpss1` on FIRMS.
   - Through the area API, per country (needs the key): this year's standard data, all of NOAA-21 (it has no country files), then the NRT tail. About 600 requests per country, so roughly 30 minutes for three.
   - FIRMS's country API is off (Nov 13), so each country is fetched as its bounding box and clipped to its outline. The script first downloads the outlines at full resolution (`python -m app.admin --outlines data/outlines EGY ARG CHL`, geoBoundaries; not the map's copies in `data/admin/`, which are cut to 2,000 vertices and move Chile's border by up to 9 km); the log says how many rows fell outside each country. Chile's box reaches Easter Island, so it is mostly ocean.
   - S-NPP stopped on Nov 2, 2026; NOAA-20 and NOAA-21 carry the record after that.
   - Then ingest, grid, harmonize, validate, admin boundaries, the demo cache, `frontend/public/cache/`, and a bundle in `dist/` with its SHA-256.
   - Other countries: `COUNTRIES=Egypt,Sudan API_COUNTRIES=EGY,SDN scripts/build-data.sh real --fetch`. Country files use FIRMS spellings, with underscores for spaces (`United_States`); the API uses ISO3 codes.
3. **Check the result:**
   - `data/reports/ingest_*.json`: dropped rows should be few.
   - `data/validation/validation.md`: R² and the 2012 break test.
   - Fix any contract surprises (R2) and note them in `contracts/CHANGES-1.1.md`.
4. **Ship:**
   - Upload `dist/almatafi-data-real.tar.gz` anywhere that serves it over https.
   - On the VPS, set `ALMATAFI_DATA_URL` and `ALMATAFI_DATA_SHA256` in `~almatafi/.config/almatafi/api.env`, then restart the API (`deploy/README.md`, "Real data"). The backend checks the bundle before using it.
   - Commit `frontend/public/cache/`, so the site's offline copy and its landing/method numbers are real.
5. **Story check (R5):** in the explorer, open Río Negro, July 2026 and the Nile Delta, October 2026.
6. **Docs (R6):** put the real numbers in `docs/method.md` and `docs/submission.md`.

## If something breaks

| Problem | What to do |
|---|---|
| A country file is `missing` | FIRMS has no file for that year (few fires). If every year is missing, the run fails: the name is spelled differently |
| A file is `failed` | Rerun; finished files are skipped (`data/raw/firms/manifest.json`) |
| NRT says FIRMS_MAP_KEY is not set | Export the key, then rerun with `--fetch` |
| Harmonize finds too little overlap | It falls back to larger strata by itself; check `strata.fallback_used` in validation.json |
| No time for the global grid | The demo countries are enough for the demo; build global after the event |
