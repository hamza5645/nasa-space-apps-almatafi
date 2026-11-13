# Review of PR #27 (X9 Nov 13 runbook, one-script data build, NRT labels, bootstrap cache fix)

Nov 3, 2026. One review pass. I ran `scripts/build-data.sh mock` end to end in a scratch folder and installed the bundle it made through `app/bootstrap.py` as an unprivileged user, the way the image runs it. I also compared with the top of the stack (`hamza/i1-deploy`), where X13 updates the runbook and script for the real FIRMS layout.

No code changes in this PR. With `main` merged in, 206 pipeline and 199 backend tests pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The runbook says to set the bundle on Render (we're on the VPS since Nov 3); the script asks for the current year's country files (there are none yet) and fetches the NRT tail per demo bbox only, with no NOAA-21 or this year's standard data | Fixed later by X13: VPS instructions, `YEARS` ends last year, and `fetch api` per country covers this year, NOAA-21 and the NRT tail |
| 2 | The runbook says the mock rehearsal takes about 35 s; here it took 146 s (one CPU) | Fine: just a slower machine |
| 3 | This PR fixes PR #16's bootstrap bug (a bundle's own cache was deleted right after being installed) | Confirmed with a real bundle: installed as an unprivileged user, the cache was kept, and nothing was left in `data/` but the products and the marker |

Checked:
- **Rehearsal:** 59 files and 875,820 rows ingested with nothing dropped, 237,772 grid rows, M0 chosen (LOYO R² 0.977), the demo cache, and a 48 MB bundle with its SHA-256.
- **`source_of`:** labels each row from its `version`: `2.0NRT` → `nrt`, `2` → `archive`, and an empty version → `archive` (CSVs are read with `keep_default_na=False`).
- **Safety:** with `FRONTEND_CACHE=0` and another `DATA_DIR`, a rehearsal leaves the repo's files alone.
