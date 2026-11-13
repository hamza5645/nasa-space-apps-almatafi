# Review of PR #15 (X2 backend deploy setup: Docker, Render, data bundle bootstrap)

Nov 3, 2026. One review pass, compared with the top of the stack (`hamza/i1-deploy`), where the image runs on Hamza's VPS under Podman.

There's no Docker daemon in this sandbox, so I reproduced the image's file layout by hand: `/app` owned by root, `/app/data` owned by the app user, and bootstrap run as an unprivileged user against a fake bundle server. CI builds and smoke-tests the real image on GitHub.

One fix in this PR (`app/bootstrap.py`), with a test. 174 backend and 191 pipeline tests pass with `main` merged in; both lockfiles are clean.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | **The real data bundle could never be installed in the image.** Bootstrap created its temporary folder next to the data folder (`/app`). That folder belongs to root, while the container runs as `app`, which may only write in `/app/data`. With `ALMATAFI_DATA_URL` set (Nov 13), the container would stop at start-up with "data bundle refused: PermissionError" instead of serving the real data. Reproduced as an unprivileged user; the tests missed it because they run as root in a temporary folder | **Fixed:** the bundle is downloaded and unpacked in a hidden `.bundle-…` folder inside the data folder (same filesystem, so the moves stay renames). The reproduction now installs; test added (it fails on the old code) |
| 2 | Bootstrap downloads the whole bundle (up to 4 GB) before the API starts. On the VPS (PR #34) the unit gives up after `TimeoutStartSec=300`, and the health check kills it after the 90 s start period plus 3 × 30 s. The VPS has no data volume, so every container recreate downloads again | Board (open items): at PR #34, time a real bundle download against those limits, or keep the data on a volume |
| 3 | `render.yaml` is no longer used (Nov 3 decision: VPS, not Render) | Board (open items): remove it at PR #34 or after the stack merges |

Checked and fine:
- **Checksum:** checked before unpacking.
- **Unpacking:** `tarfile` uses `filter="data"` (refuses absolute paths, `..` and links leaving the folder).
- **Download:** https only, with a 4 GB cap.
- **What gets replaced:** only the product folders in the bundle; a bundle without the harmonized file is refused.
- **Marker:** skips a bundle that's already installed.
- **Logs:** error lines leave out the URL's path and query.
- **Process:** non-root user, health check, and `exec uvicorn` (uvicorn gets the signals).
- **Image:** the mock data is built into the image, and the `plots` extra is only in the build stage.
- **CI:** the Docker job builds the image and smoke-tests `/health`, `/stats` and `/validation`.
