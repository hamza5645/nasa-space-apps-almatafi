# Review of PR #11 (B3a `/export` and `/validation`)

Nov 3, 2026. One review pass. Checked with FastAPI's test client on the full 6-region mock (PR #10's harmonized product and validation files), and compared with the top of the stack (`hamza/i1-deploy`). Later PRs barely change `export.py`; X13 makes the raw views pick one platform per era.

One fix in this PR (the GeoTIFF size cap), with a test. 117 backend and 191 pipeline tests pass with `main` merged in.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Memory: one GeoTIFF at the allowed maximum (30M pixels) took the process from 182 MB to 824 MB (the code comment said ~120 MB). The API container is capped at 1 GB, so two such requests at once would kill it. Measured: ~20 bytes per pixel plus ~60 MB (the float32 array, an uncompressed staging copy, the COG copy with overviews) | **Fixed:** `MAX_TIFF_PIXELS` is 10M (+250 MB measured); test added; README says it. A compact 5M km² area near the equator still fits with 120 monthly bands |
| 2 | Memory: the biggest allowed hotspot GeoJSON export (200k points) takes ~400 MB to build in Python (91 MB file), and the query first loads up to 1M points before it checks the 200k cap | Added to **X19** (stream the file, or lower the cap) |
| 3 | `contracts/CHANGES-1.1.md` (PR #20) says GeoTIFF ≤ 30M pixels | Board (open items): change it to 10M at PR #20 |
| 4 | The raw MODIS grid export adds Terra and Aqua (`SUM` over both platforms) | Fixed later by X13 (one platform per era, same as `/calendar`) |
| 5 | Grid exports and `/calendar` differ by a hair for the harmonized view (Nile Delta 2001 → 2026: 20,133.1 vs 20,135.0), because the calendar rounds each month | Already open (1.1 proposals: calendar totals come from rounded values) |
| 6 | A grid CSV with no observed months returns rows with empty values, while the GeoTIFF answers 422 `out_of_range` | Not fixed: harmless, and the CSV is still correct |

Checked and fine:
- **Totals:** grid CSV totals equal `/calendar` exactly in the raw views (Nile Delta, 2001 → 2026, both metrics).
- **GeoTIFF vs CSV:** in a 12-band GeoTIFF, every pixel equals the grid CSV value for its cell (4,608 of 4,608).
- **GeoTIFF format:** EPSG:4326, DEFLATE COG, 512 px tiles, nodata −1, band names `YYYY-MM`, and the tags `data_version`, `view`, `metric`, `unit`, `start`, `end`.
- **Hotspot exports:** both formats return the same 885 points as `/hotspots`.
- **Calendar CSV:** has `origin`.
- **180° meridian:** an AOI crossing it is refused for GeoTIFF and works for CSV.
- **Errors:** wrong format, a date instead of a month (and the reverse), month 13, start after end, and months outside the data each return the right 400 or 422.
- **Filename:** built only from validated fields.
- **`/validation`:** serves the file, or 503 until it exists.
