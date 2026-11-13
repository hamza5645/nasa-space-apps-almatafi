# Review of PR #19 (X6 `/nrt` live hotspots)

Nov 3, 2026. One review pass, compared with the top of the stack (`hamza/i1-deploy`), where X10 (PR #28) reuses the same `Firms` class for on-demand hotspots over any date range, and X13 (PR #31) stops asking for S-NPP. There's no MAP_KEY here, so I checked FIRMS's answer to a bad key with one request and measured memory per point on the mock.

No code changes in this PR. 195 backend tests pass with `main` merged in (no pipeline changes).

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Memory: answers are cached as DataFrames, up to 32 of them (`CACHE_MAX`), and each FIRMS call may bring up to 50 MB of CSV. A clean point costs ~200–400 bytes in pandas, so one big answer is ~100 MB and a full cache can reach several GB on an API capped at 1 GB. X10 stores its longer ranges in the same cache | Added to **X19**: cap the cache by total rows or bytes, not entries |
| 2 | FIRMS stopped delivering S-NPP data on Nov 2, 2026 (FIRMS FAQ), but this PR still asks for `VIIRS_SNPP_NRT` | Fixed later by X13 (`SOURCE_END`) |
| 3 | `/nrt` keeps MODIS rows at confidence ≥ 30 whatever the grid was built with | Already open (Board: read the MODIS threshold from the grid's metadata) |

Checked and fine:
- **Bad key:** FIRMS answers HTTP 400 "Invalid MAP_KEY.", which becomes `502 upstream_error`; the key isn't in the message or the logs.
- **Request splitting:** `days` 1–10 is split into windows of at most 5 days.
- **180° meridian:** an AOI crossing it is queried as at most 2 boxes.
- **Same rows as the archive:** rows go through the pipeline's own `clean()` and the grid's filter, including the static mask, then the exact shape.
- **Transaction budget:** at most 1,000 per 10 minutes (FIRMS allows 5,000), with `503 upstream_busy` past that.
- **Missing key:** without a key, `/nrt` answers 503 and `/health` shows it.
- **Timestamps:** `acq_datetime_utc` is printed in UTC whatever the server's time zone.
