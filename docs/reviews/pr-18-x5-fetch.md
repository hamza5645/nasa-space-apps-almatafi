# Review of PR #18 (X5 FIRMS download tool)

Nov 3, 2026. One review pass. I checked the tool's URLs against real FIRMS (HEAD requests only; there's no MAP_KEY here, so the API wasn't called) and compared with the top of the stack, where X13 (PR #31) reworks `fetch.py`.

No code changes in this PR. 205 pipeline tests pass with `main` merged in (no backend changes).

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | NOAA-20's country files are named `viirs-jpss1`: `…/viirs-noaa20/2023/viirs-noaa20_2023_Egypt.csv` answers 404, `viirs-jpss1` answers 200. So this PR fetches no NOAA-20 at all, and every NOAA-20 year counts as "missing", not failed. NOAA-21 has no country files, and the current year has none yet | Fixed later by X13 (`COUNTRY_FILES`, the `api` command with `*_SP` then NRT, skipping the current year) |
| 2 | At the top of the stack, rerunning `fetch api` after FIRMS moves its standard/NRT boundary keeps the first run's NRT files next to the rerun's standard files for the same days. Simulated with the tip's `api_plan`: a Nov 13 run, then a rerun after standard data grows by a month, leaves August 2026 in 7 NRT files and 6 standard ones. NRT and standard positions differ, so ingest can't drop the duplicates | Board: added to **X16** (delete or skip NRT files that standard data now covers, or ingest only the newest plan) |

Checked and fine:
- **Download safety:**
  - https only, to the FIRMS host, rechecked after redirects;
  - a 400 MB cap per file;
  - each file must have a FIRMS header before it's written;
  - writes are atomic.
- **Manifest:** every file is listed with its SHA-256, so reruns skip done files.
- **Errors:**
  - 404 counts as "missing" (a country with no fires);
  - 429 and 5xx are retried with backoff;
  - one failed file doesn't stop the run.
- **Key safety:** the MAP_KEY is redacted from errors and the manifest.
- **NRT dates:** NRT starts the day after standard data ends.
