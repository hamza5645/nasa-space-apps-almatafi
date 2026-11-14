# Frontend

Next.js (App Router) + TypeScript. Layout and colours follow the UI mockup (`~/projects/nasa-ui-mockup`, not in the repo).

```
npm install
npm run dev          # http://localhost:3000, talks to the API at NEXT_PUBLIC_API_URL (default http://localhost:8000)
npm test             # node --test: lib/grid.ts against contracts/grid-test-vectors.json, lib/api.ts
npm run lint && npm run typecheck && npm run build
```

Run the backend next to it: `cd ../backend && uv run uvicorn app.main:app --reload`. Its default CORS origin is `http://localhost:3000`.

| Path | What |
|---|---|
| `app/` | pages: `/` landing, `/explore` explorer, `/method` method |
| `components/` | UI pieces |
| `lib/api.ts` | typed API client; request types from `lib/api-types.ts`, response types written from `contracts/api.md` |
| `lib/api-types.ts` | generated from `contracts/openapi.json` with `npm run gen:api`; CI fails if it's stale |
| `lib/grid.ts` | the 0.1° grid (twin of `pipeline/almatafi/cells.py`) |
| `lib/share.ts` | the explorer's state in the URL (`?region=rio-negro&month=2026-07&view=viirs`) |
| `components/wel3a/`, `lib/wel3a.ts` | Wel3a, the flame guide on every page: written tips per page and, in the explorer, the selected month's important points |
| `worker/index.ts`, `lib/wel3a-chat.ts` | `POST /api/wel3a`: Wel3a's typed questions, answered by Cloudflare Workers AI. `next dev` doesn't run it (the chat then says it can't answer); `npm run build && npx wrangler@4.156.2 dev` does |
| `public/cache/` | copy of the backend's demo cache, read at build time by the landing, Method and game pages (the explorer always asks the API): `npm run cache` after `cd ../backend && python -m app.cache`. **Committed**, because a deploy can't see `data/`. Regenerate it after the real data arrives. |

| `lib/orbit/` | the 3D scene behind the landing story and the Method header (three.js): Earth shaders, the fire layer, NASA satellite models, camera keyframes |
| `components/OrbitStory.tsx` | the landing story: sticky stage, chapters, and the scroll-scrubbed film (dive + smoke) |
| `components/WarpLink.tsx`, `WarpOverlay.tsx` | links that leave through the smoke (the page transition) |
| `public/globe/` | Earth textures (NASA GIBS: Blue Marble NG, VIIRS Black Marble; clouds; water mask) and `fires.bin`/`fires.json` |
| `public/models/` | NASA 3D Resources: Aqua and Suomi NPP, compressed (meshopt + WebP) |
| `public/media/` | Higgsfield shots, made by `../design/higgsfield/` (`gen.py` → `process.sh`) |

### The globe's fire layer

`node scripts/globe-fires.mjs` downloads one week of NASA FIRMS near-real-time fires (the public global 7-day files, no key) and writes `public/globe/fires.bin` + `fires.json`; `--from <dir>` builds from saved copies. The landing prints the numbers from `fires.json`, and `lib/fires.test.ts` checks the binary matches it. Rerun it before the demo for a fresh week.

### Generated media (Higgsfield)

`design/higgsfield/shots.json` lists every shot (prompt, model, cost). `gen.py` generates the missing ones into `design/higgsfield/out/` (gitignored), with a $5 cap logged in `out/spend.json`; it needs `HF_KEY=id:secret` in the environment. `process.sh` turns them into `public/media/` (WebP frame sequences for the scroll film, short loops, stills). The site marks every generated scene and portrait as generated.

Styling is plain CSS with the mockup's tokens (`app/globals.css`) rather than Tailwind: the mockup is already written that way, and it keeps one less build tool.

## Deploy (I1)

Cloudflare Workers: static files (`output: "export"` in `next.config.ts`, `wrangler.jsonc`) plus one function, `worker/index.ts`, which only `/api/*` reaches. GitHub Actions builds and deploys it on every merge to `main`, with `NEXT_PUBLIC_API_URL=https://almatafi-api.monitorthesituations.com`. A new site origin must be added to the backend's `ALMATAFI_CORS_ORIGINS`. Without the backend, the two demo regions still work from `public/cache/`. Details, and deploying by hand: [`deploy/README.md`](../deploy/README.md).
