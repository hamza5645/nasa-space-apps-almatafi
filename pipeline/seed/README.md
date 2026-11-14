# pipeline/seed

Small built files that a deploy needs and can't rebuild itself.

- `clouds/cloud_monthly.parquet`: real cloud cover for the mock data set's cells (220 cells of
  0.5°, Terra from 2000-11, Aqua from 2002-07, to 2026-10), from NASA GIBS's daily MODIS cloud
  fraction, every second day. The API image copies it in (`backend/Dockerfile`), because the
  build takes about two hours of GIBS requests. Rebuild after the mock's regions change:

  ```
  python -m almatafi.clouds real --grid data/grid --out pipeline/seed/clouds --workers 3
  ```

  The day images are cached in `data/raw/gibs-clouds/`, so a rerun only reads them.
  A real-data build makes its own file (`scripts/build-data.sh real`) and doesn't use this one.
