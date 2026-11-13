# ALMATAFI

Harmonized burning activity calendar for NASA Space Apps Cairo 2026.

Challenge: Harmonization of MODIS and VIIRS Hot Spots. Merge two decades of MODIS and VIIRS active fire hotspots (NASA FIRMS) into one sensor independent time series, and explore it through a web app: pick an area, see the year by month burning calendar, monthly baselines, percentile ranks, z score anomalies, and export CSV, GeoJSON and GeoTIFF.

## Plan
- Until Nov 13: data contract, mock FIRMS data, API, UI, harmonization method tested on mock data
- Nov 13: real FIRMS data ingestion and cleaning, switch the app to real data

## Development

| Folder | What | Tests |
|---|---|---|
| `pipeline/` | mock data, ingest, grid, harmonization, validation | `cd pipeline && uv run pytest` |
| `backend/` | FastAPI app (`contracts/api.md`) | `cd backend && uv run pytest` |
| `frontend/` | Next.js web app (landing, explorer, method) | `cd frontend && npm test && npm run build` |

GitHub Actions (`.github/workflows/tests.yml`) runs all three (plus frontend lint, typecheck and build) on every pull request and every push to `main` (or by hand from the Actions tab), with the locked dependencies (`uv.lock`) on Python 3.12. A PR is ready to merge when its checks are green.

## Deploy

Live at https://almatafi.monitorthesituations.com (API: https://almatafi-api.monitorthesituations.com/api/health). Every merge to `main` that passes the tests deploys itself (`.github/workflows/deploy.yml`). How it works, the secrets, everyday commands and rollback: [`deploy/README.md`](deploy/README.md).
