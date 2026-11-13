# Deploy

| Part | Where | URL |
|---|---|---|
| Frontend (static export) | Cloudflare Workers, static assets only | https://almatafi.monitorthesituations.com · backup https://almatafi.hamzaosama5645.workers.dev |
| Backend (FastAPI) | Hamza's VPS, rootless Podman, behind a Cloudflare Tunnel | https://almatafi-api.monitorthesituations.com |

Health check: https://almatafi-api.monitorthesituations.com/api/health. If the API is down, the site still answers for the two demo regions from `frontend/public/cache/`, with a banner.

```
merge to main ─▶ tests ─▶ deploy.yml ─┬─▶ frontend: next build ─▶ wrangler deploy ─▶ Cloudflare Workers
                                      └─▶ backend: docker build ─▶ ghcr.io/hamza5645/almatafi-api:main
                                                                        ▲ pulled every 5 min
VPS, user almatafi (rootless Podman) ───────────────────────────────────┘
  almatafi-api (no published port) ◀── almatafi-tunnel (cloudflared, outbound) ◀── Cloudflare
```

Why this setup: free, and no cold starts (Render's free plan sleeps and takes 30–60 s to wake). Chosen with Khalid on Nov 3; see TEAM.md Decisions.

## Accounts, secrets and expiry dates

No secret value is in git. Everything below is Hamza's unless noted.

| What | Where it lives | Used for | Expires |
|---|---|---|---|
| Cloudflare account `3e9b425e…c314` | — | Workers, the tunnel, DNS for `monitorthesituations.com` | — |
| Domain `monitorthesituations.com` | Cloudflare Registrar, auto-renew on | both hostnames | 2027-01-11 (renews) |
| Cloudflare API token `almatafi-github-deploy` | GitHub secret `CLOUDFLARE_API_TOKEN` (Khalid's repo) | `wrangler deploy` from Actions: Workers, and Workers Routes on this zone only | 2027-02-28 |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub secret | same | — |
| GitHub classic token, `read:packages` only | VPS: `~almatafi/.config/containers/auth.json` | pulling the private GHCR image | 2027-02-28 |
| `GITHUB_TOKEN` (automatic) | Actions | pushing the image to GHCR | per run |
| Tunnel credentials `cf01f586-….json` | VPS: `~almatafi/.cloudflared/` | running this one tunnel | — |
| FIRMS `MAP_KEY` | VPS: `~almatafi/.config/almatafi/api.env` | `/api/nrt` and on-demand hotspots | — |

**Rotating a token:** create the new one, put it where the table says, then delete the old one.
- Cloudflare: update the GitHub secret, then re-run the deploy workflow.
- GHCR: on the VPS, run `$A podman login ghcr.io --authfile /home/almatafi/.config/containers/auth.json -u <github user>` and paste the new token.
- FIRMS: edit `api.env`, then `$A systemctl --user restart almatafi-api`.

`$A` is the command prefix from "Everyday commands" below.

## Auto-deploy

`.github/workflows/deploy.yml` runs after the `tests` workflow passes on `main`:

- **Frontend:** `npm run build` with `NEXT_PUBLIC_API_URL`, then `wrangler deploy`. Live in about a minute.
- **Backend:** builds `backend/Dockerfile` on GitHub and pushes `ghcr.io/hamza5645/almatafi-api:main` (plus `:sha-<commit>`). The VPS checks GHCR every 5 minutes and swaps in a new image. If the new one doesn't answer `/api/health`, Podman rolls back to the previous one.

GitHub never connects to the VPS; the VPS pulls. Repo secrets: `CLOUDFLARE_API_TOKEN` (Workers deploys on monitorthesituations.com only) and `CLOUDFLARE_ACCOUNT_ID`. Run it by hand: Actions → deploy → Run workflow.

## The VPS

Separation from everything else on the machine:

- One unprivileged user, `almatafi` (no password, no sudo, its own subuid range). It can't read other users' homes.
- Rootless Podman: no daemon, no host firewall changes, no published ports. The API is reachable only on the private `almatafi` network, by `cloudflared`, which connects out to Cloudflare. (A network, not a pod: auto-update restarts a pod as one unit and wouldn't notice the API failing, so it could never roll back.)
- Caps per service (`*.container`): API 1 GB RAM, 1 CPU, 256 tasks; tunnel 256 MB. Both have `OOMScoreAdjust=500`, so under memory pressure the kernel kills them before anything else.

Files (all under `/home/almatafi`):

| Path | What |
|---|---|
| `.config/containers/systemd/` | the Quadlet units from `deploy/vps/` |
| `.config/systemd/user/podman-auto-update.timer.d/` | the 5-minute check |
| `.config/almatafi/api.env` | backend settings and the FIRMS key (mode 600, never in git) |
| `.config/containers/auth.json` | read-only GHCR login (`read:packages` token) |
| `.cloudflared/` | `config.yml` + the tunnel's credentials JSON |

### Everyday commands (as root on the VPS)

```sh
A="sudo -u almatafi XDG_RUNTIME_DIR=/run/user/1001 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1001/bus"
cd /tmp
$A systemctl --user status almatafi-api almatafi-tunnel     # state
$A journalctl --user -u almatafi-api -n 100                  # logs
$A systemctl --user restart almatafi-api                     # restart
$A systemctl --user start podman-auto-update                 # check GHCR now
$A podman auto-update --dry-run                              # is there a newer image?
$A nano /home/almatafi/.config/almatafi/api.env               # settings, then restart
```

**Roll back by hand** to a known commit: `$A podman pull ghcr.io/hamza5645/almatafi-api:sha-<commit>`, `$A podman tag ghcr.io/hamza5645/almatafi-api:sha-<commit> ghcr.io/hamza5645/almatafi-api:main`, then restart. The next auto-update moves it forward again if `main` has a newer image.

### Install from scratch

1. `apt-get install --no-install-recommends podman uidmap passt crun catatonit aardvark-dns`
2. Copy `deploy/vps/` to the VPS and run `sh install.sh` as root once to create the user (the tunnel start fails until step 3).
3. Tunnel (once): as `almatafi`, run `cloudflared tunnel login` in the `cloudflared` image, then `tunnel create almatafi-api` and `tunnel route dns almatafi-api almatafi-api.monitorthesituations.com`. Put the new tunnel ID in `cloudflared.yml`. Then delete `cert.pem`: it can manage every tunnel and DNS record of the zone, and the running tunnel doesn't need it.
4. GHCR login: `$A podman login ghcr.io --authfile /home/almatafi/.config/containers/auth.json -u <github user>` with a classic token that has only `read:packages`.
5. Fill in `api.env`, then run `sh install.sh` again.

Without the GHCR image (before the first workflow run), build it on the VPS under a memory cap and tag it as `ghcr.io/hamza5645/almatafi-api:main`:

```sh
$A systemd-run --user --unit=almatafi-build --collect -p MemoryMax=1200M -p CPUQuota=150% \
  --working-directory=/home/almatafi/src podman build -f backend/Dockerfile -t ghcr.io/hamza5645/almatafi-api:main .
```

## Frontend by hand

```sh
cd frontend
NEXT_PUBLIC_API_URL=https://almatafi-api.monitorthesituations.com npm run build
npx wrangler@4.156.2 deploy
```

`output: "export"` means `npm start` no longer works; use `npm run dev` locally, or serve `out/`.

## Real data (Nov 13)

Set `ALMATAFI_DATA_URL` and `ALMATAFI_DATA_SHA256` in `api.env` and restart (`docs/runbook.md`). The bundle is downloaded again whenever the container is recreated, including after each auto-update; a data volume to avoid that is a decision for R2/R3.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| API returns **530** or **502** | 530: the tunnel isn't connected. 502: the tunnel is up but the API isn't. Check `$A systemctl --user status almatafi-api almatafi-tunnel` and the logs. Right after a restart, wait about 30 s: the API counts as started only after its first health check. |
| The browser blocks API calls (**CORS**) | The site's origin is missing from `ALMATAFI_CORS_ORIGINS` in `api.env`. Add it and restart the API. |
| Deploy job: `Invalid access token [code: 9109]` | The Cloudflare token isn't valid (yet). Check its validity window: `curl -s https://api.cloudflare.com/client/v4/user/tokens/verify -H "Authorization: Bearer <token>"` and look at `not_before` and `expires_on`. |
| `podman auto-update` says **manifest unknown** or **unauthorized** | No image on GHCR yet, or the read token has expired. Log in again (see "Rotating a token"). |
| A new image went out and the API kept the old one | That is the rollback working: the new image failed its health check. Find out why in `$A journalctl --user -u almatafi-api`, fix it, merge again. |

Things that look odd but are deliberate (each one cost us an outage while testing):
- **A private network, not a pod.** For a container in a pod, auto-update restarts the pod's unit. The pod starts fine even when the API inside it crashes, so nothing ever rolls back.
- **The health check is in `almatafi-api.container`, not taken from the Dockerfile.** GitHub's build makes OCI images, and those drop `HEALTHCHECK`. Then `Notify=healthy` refuses to start the container at all.
- **The `|| exit 1` at the end of `HealthCmd`.** Quadlet drops a closing quote when it's the last character of a value, which breaks the command.
- **`config.yml` must be owned by `almatafi`, not root.** Rootless Podman can't hand a root-owned file to the container's user (the `:U` mount).
- **Restart services with `install.sh` or `systemctl restart`,** not by removing containers by hand. Quadlet recreates them from the unit files.
