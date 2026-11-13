# Review of PR #34 (I1 staging deploy and auto-deploy on merge to main)

Nov 3, 2026. One review pass, the last of the stack. I checked the workflows, the VPS units and the docs, and built and screenshotted the static export (the Method page) at 1440 px and 390 px.

Fixes in this PR, all small. With `main` merged in, 218 pipeline and 212 backend tests pass, and lint, typecheck, the 45 frontend tests and the static build pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | `deploy.yml` still had the temporary `push: hamza/i1-deploy` trigger (the Board said to remove it before merging) | **Removed.** Deploys now come only from a successful `tests` run on a push to `main`, or by hand. It was removed in the same push that brought `main` in, so that push didn't deploy the branch |
| 2 | The Method page's Limits lacked the static mask and the Terra-only months (PR #25 review) | **Added** two cards; `docs/method.md` has both since PR #26 |
| 3 | The README said tests run "on every push" (PR #14 review). This PR was the only place to change that line without conflicts | **Fixed** |
| 4 | `render.yaml` was unused since the Nov 3 hosting decision, and `backend/README.md` still described Render | **Removed** the file; the README now points at the VPS setup in `deploy/README.md` |
| 5 | From the PR #15 review: at every container start, bootstrap downloads the whole data bundle (up to 4 GB), and the unit allows `TimeoutStartSec=300`, with the health check killing it after the 90 s start period plus 3 × 30 s. The mock bundle is 48 MB; the real three-country bundle isn't built yet | Kept on the Board for Nov 13 (R2/R3): time the real download; if it gets near 3 minutes, keep the data on a volume (`deploy/README.md` already lists that decision) |

Checked and fine:
- **Deploy guard:** the deploy only follows tests that passed on a push to this repo, never a fork's PR.
- **Image:** it's tagged `:main` and `:sha-…`.
- **Rollback:** `podman auto-update` rolls back an image whose health check fails.
- **API unit limits:** 1 GB memory, 1 CPU, dropped capabilities, no new privileges.
- **Tunnel:** the tunnel has no open ports.
- **Frontend:** it's a static export deployed with wrangler.
- **Flicker fix:** Hamza's fix (`lib/orbit/shaders.ts`, NaN in `pow()` on Apple GPUs) is in.
