# Review of PR #31 (X13 backend and pipeline fixes from an independent review)

Nov 3, 2026. One review pass, compared with the top of the stack (`hamza/i1-deploy`). I simulated the months after S-NPP's end with the top of the stack's own `align.month_status`.

No code changes in this PR; the fix for finding 1 goes in PR #32, which changes `align.py`. With `main` merged in, 210 pipeline and 212 backend tests pass, and lint, typecheck and the 43 frontend tests pass; the generated API types match the snapshot.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | **The harmonized record after S-NPP's end (Nov 2, 2026).** This PR records the end date, and the raw VIIRS view switches to NOAA-20 after October 2026. But in the harmonized product, NOAA-20 stands for a month only when it observed ≥ 90% of it (and 15% more than S-NPP). Coverage counts a day as observed only when the build has a hotspot on it (X21), so in a quiet regional build NOAA-20 can fall short. Simulated: with NOAA-20 seeing 10 of 30 days, November 2026 comes out `observed_snpp` on S-NPP's 2 days, and with 24 of 31, December comes out `converted_aqua` | **Fixed in the PR #32 review** (`align.py`): after S-NPP's end, NOAA-20 (else NOAA-21) stands for a month whenever it has data |
| 2 | Hotspot exports don't take the new `platforms` filter, so an export lists every satellite while the map can show only the one the calendar counts | Not fixed: an export of "every hotspot" is a fair default |

Checked and fine:
- **Raw views:** one platform per month (Aqua, with Terra before 2002-07; S-NPP, with NOAA-20 after its last full month), matching the PR #10 validation fix.
- **Unobserved months:** harmonized months nobody observed come back `null` from `month_origins`, not 0.
- **Short baselines:** with fewer than 3 baseline years there's no status (PR #30's verdict now handles that).
- **Static mask:** it now catches volcanoes and offshore flares (types 1 and 3 in ≥ 2 months) as well as type 2 in ≥ 6.
- **Holes:** holes in shapes across 180° are shifted onto their shell.
- **`/hotspots`:** it gains `platforms` and `by_platform`.
- **Fetch tool:** it uses NOAA-20's real country-file name (`viirs-jpss1`), skips the current year, and gets NOAA-21 and this year from the API (PR #18 review).
