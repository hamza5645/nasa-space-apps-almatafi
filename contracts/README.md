# contracts/

The agreements between the pipeline, the backend and the frontend. If code and a contract disagree, the code is wrong.

| File | What it fixes | Used by |
|---|---|---|
| [firms-input.md](firms-input.md) | The FIRMS MODIS and VIIRS CSV columns we read, and how we normalise them | pipeline, mock generator |
| [grid.md](grid.md) | The 0.1° grid, `cell_id`, calibration strata | pipeline, backend, frontend |
| [data-products.md](data-products.md) | The files the pipeline writes: clean points, monthly grid, harmonized grid, validation | pipeline, backend |
| [api.md](api.md) | Every HTTP endpoint: request, response, errors | backend, frontend |

## Rules

1. **Change only when both agree** (TEAM.md rule 5). Open a PR that touches only `contracts/` and get the other person's OK.
2. **Bump the version** at the top of the file you change and add a line to its changelog.
3. **Mock and real data obey the same contract.** The mock generator writes exactly the FIRMS columns in `firms-input.md`; the API returns the same shapes on mock and real data.
4. **Names:** files `snake_case`, columns `snake_case`, JSON keys `snake_case`, platform and enum values exactly as written here.
5. **Times are UTC.** Dates are ISO 8601 (`2026-07-14`), months are `YYYY-MM` (`2026-07`).
6. **Coordinates are WGS84** (EPSG:4326), `[lon, lat]` order inside GeoJSON, `lat`/`lon` named fields everywhere else.
