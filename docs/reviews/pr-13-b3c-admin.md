# Review of PR #13 (B3c `/admin`)

Nov 3, 2026. One review pass. I fetched real boundaries through the PR's own client: Egypt ADM1 and Argentina ADM2, plus API calls for an unknown country and a missing level. I also compared with the top of the stack, where no later PR changes `admin.py`, `geometry.py` or their tests.

This sandbox blocks `github.com` raw downloads, so the probe answered those with the redirect GitHub gives for these LFS files (to `media.githubusercontent.com`, also on the allowlist). A real server follows the redirect itself.

One fix in this PR (`geometry.py`, carried over from the PR #12 review), with a test. 159 backend tests pass with `main` merged in (no pipeline changes).

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | A polygon with a spike becomes a GeometryCollection (polygons plus a stray line) after `make_valid`, and `simplify_polygon` then drops it entirely (`null`). This hits `/search` and `/admin` alike | **Fixed:** keep the polygonal parts; test added |
| 2 | A share link with an admin area, opened on a server that hasn't cached that country, sends `/calendar` while `/api/admin` is still downloading the country, so the calendar can answer 404 `not_found`. The demo countries are fine: `build-data.sh` prefetches EGY, ARG and CHL ADM1 into the data bundle | Board (open items): check at PR #24 (share links) |
| 3 | `/api/admin` reads and parses the country's file from disk on every request (Argentina ADM2: 5.1 MB) | Not fixed: fast enough (tens of ms) |

Real data:

| Request | Result |
|---|---|
| EGY ADM1 | 27 governorates, 0.2 MB, 5,776 vertices, all valid, 0.9 s; `admin_id` like `46179711B72666466596415` |
| ARG ADM2 | 525 departments, 5.1 MB, 117,596 vertices (largest 1,919), all valid, 1.1 s |
| XXX ADM1, EGY ADM3 | geoBoundaries answers 404, so `/api/admin` answers 404 `not_found` as intended |

Checked and fine:
- **Download safety:** downloads are https-only to the allowlisted hosts, checked on every redirect by a request hook, and the 60 MB cap is checked while streaming.
- **Concurrency:** one download per country and level, even with parallel requests.
- **Atomic cache write:** the file is written to a temporary name and then renamed.
- **AOI use:** fetched boundaries become AOIs immediately and after a restart.
- **Path safety:** `country` must be 3 letters and `level` 0–2, so the cache path can't be steered.
- **Errors:** upstream errors become 502 and aren't cached.
