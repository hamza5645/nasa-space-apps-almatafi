# TEAM.md — read this before you touch anything

This file is how we stay in sync. Every work session starts and ends here.

## Rules

1. **Before you start:** `git pull`, then read this whole file (Status, Board, Log).
2. **Claim before you work:** move the task to *In progress* with your name, commit and push that change *before* writing code. If a task is already claimed, don't touch it; message the owner.
3. **Branches:** work on `yourname/short-task-name`, never directly on `main`. Open a PR; the other person gives it a quick look before merge.
4. **Stay in your area.** If you need to change something in the other person's area, ask first.
5. **Shared files** (`contracts/`, this file's Roles and Decisions) change only when both agree.
6. **Before you stop:** update the Board, add a Log entry (what you did, what's next, anything broken), push.
7. **AI assistants** (Claude, Codex, etc.) follow the same rules: read this file first, update the Board and Log at the end.

## Roles

| Person | Area | Owns |
|---|---|---|
| Khalid | Data, harmonization, backend API | `pipeline/`, `backend/`, `data/` |
| Hamza | Web app UI | `frontend/` |
| Both | Data contract, pitch | `contracts/`, `docs/` |

_Proposed split; edit it together on day one._

## Status

**Phase:** Building on mock data (Oct 31 to Nov 12). Real FIRMS data arrives **Nov 13**.
**Key rule for now:** mock data must use the exact FIRMS column names and formats, so on Nov 13 we only swap the data source.

## Board

Task IDs and details are in `PLAN.md` §10. Move IDs between the lists below.

### To do
- Phase 1 (Oct 31 → Nov 2): F2 mostly done Nov 3: real FIRMS files (MODIS 2010 for Egypt, Argentina, Chile; VIIRS S-NPP and NOAA-20 2019 for Egypt) ingest with nothing dropped (`docs/reviews/pr-08-h1-align.md`). Khalid to confirm and close it
- Phase 3 (Nov 9 → Nov 12): (I1 done)  (X = extra: X1 CI, X2 backend deploy setup, X3 demo-region cache)
- Phase 4 (Nov 13 →): R1 R2 R3 R4 R5 R6
- **Before Nov 13** (bugs from the PR #1 review, pipeline, Khalid's area): X16 archive (SP) and NRT copies of a hotspot both survive ingest, so overlap weeks double-count (the mock's standard and NRT files never overlap since X4, so give it an overlap week to test the fix; PR #17 review). Same problem across runs: rerunning `fetch api` after FIRMS extends its standard data keeps the first run's NRT files next to the new standard files for the same days (`docs/reviews/pr-18-x5-fetch.md`) · X17 `data_version` is date-only, so two builds on one day share a version. Details: `docs/reviews/pr-01-f1-contracts.md` · X21 coverage for regional builds: a day counts as observed only if the platform had a hotspot in the build's own area, so in small areas quiet days look like outages and H1 drops those months from the fits (two-region mock: Terra→Aqua keeps 6 of 108 months). The Nov 13 three-country build is fine (real Aqua 2010 has a hotspot on almost every day), but Egypt alone has hotspots on 121 of 365 days. Build coverage from global data or the platforms' operating days, or at least warn when a fit loses many months. Details: `docs/reviews/pr-08-h1-align.md`
- **Before Nov 13** (from the PR #9 review): X22 the Terra-only months (2001-01 → 2002-06) are unreliable where Terra sees little. Nile Delta, against the mock's true fires and relative to the S-NPP years: 0.52 with PR #9's M1 and 0.71 with the top of the stack's M3 (Aqua years: 0.93–0.94), so the series steps up in July 2002; single months swing from 0.2× to 3×. Terra sees 0–4 hotspots a month there (Delta fires burn in the afternoon; Aqua sees 3.8× more than Terra in that tile, 1.5× worldwide), so no model can fix single months: with M0, which PR #10 picks on the full mock, the Terra-era total is right (0.95) but 9 of the 18 months are 0. From X14 (PR #32) the automatic choice picks M3, and the Delta's Terra months come out at 0.71 (rechecked in the PR #32 review); X14's placebo years don't include 2002. The automatic model choice (PR #10) only scores Aqua → S-NPP, so it can't see any of this. Khalid: add a July 2002 break check next to the 2012 one in validation (X14 code), and score Terra → Aqua (or the Terra-era level) when choosing the model · Hamza: mark `converted_terra` months as less certain in the calendar (the API already returns `origin`) · both: a Method page limitation, and maybe a 1.1 proposal to start the default baseline in 2002-07. Details: `docs/reviews/pr-09-h2-models.md`, `pr-10-h3-validation.md`
- **Before R3** (pipeline, Khalid's area): X18 memory at global scale: ingest holds a whole run in memory as text (~0.5–0.7 KB per row, so a global VIIRS year needs ~10–30 GB; ingest per file or in chunks), and the grid sorts and holds its whole output (~10⁸ rows) before writing (stream with DuckDB `COPY … TO`). Harmonize builds its wide tables in pandas, ~165 B per grid row at peak (~16 GB for 10⁸ rows). Harmonize time: leave-one-year-out (3 models × 2 metrics, even with `--model` forced) is ~40 s of a 65 s full-mock run (78k cell-months); time it on the Nov 13 build. Details: `docs/reviews/pr-04-d2-ingest.md`, `pr-05-d3-grid.md`, `pr-08-h1-align.md`, `pr-10-h3-validation.md`
- **Before the demo** (from the PR #6 review, backend, Khalid's area): X19 API hardening: there's no request-size limit (a 40 MB body takes ~700 MB and the API is capped at 1 GB; refuse over 1 MB with 413). Areas with fewer than 4 cell centres test every cell in their bounding box (a thin sliver: 5 s, ~700 MB; test only cells along the edge). NaN or Infinity in a point or bbox, and any crash, give a plain-text 500 without CORS, so the site says "Can't reach the server". Exports are built in memory: the biggest allowed hotspot GeoJSON (200k points) takes ~400 MB, after a query that loads up to 1M points before checking the cap; stream it or lower the cap. The `/nrt` cache keeps up to 32 answers as DataFrames (each FIRMS call may bring 50 MB of CSV, ~100 MB in pandas), and X10's longer ranges share it: cap it by rows or bytes. Details: `docs/reviews/pr-06-b1-api.md`, `pr-11-b3a-export.md`, `pr-19-x6-nrt.md`
- **Before the demo** (from the PR #24 review, frontend, Hamza's area): X23 share links with a searched place's outline can be too long to open: the outline goes in the URL as base64 JSON (search keeps up to 2,000 vertices) and Cloudflare refuses URLs over 32 KB (414). 1,000 vertices make 32 KB, Chukotka's 1,759 make 57 KB. Encode shapes compactly (polyline algorithm, 5 decimals: ~12 KB for 2,000 vertices) or put the place search in the link. Also, `b64url` spreads every byte as an argument (`String.fromCharCode(...bytes)`), close to Safari's ~65k limit for a 2,000-vertex shape (PR #29 review). Details: `docs/reviews/pr-24-u5-share.md`
- X24 on-demand hotspots (from the PR #28 review, backend, Khalid's area): FIRMS is asked only when the stored points come back empty, so an area partly inside the stored coverage gets only that part's hotspots (silently), and a stored area's quiet month asks FIRMS for nothing. The demo regions are fine; an area across Egypt's or Chile's border isn't. Decide by what the stored points cover (the build's countries or bboxes) and fetch the rest. Details: `docs/reviews/pr-28-x10-on-demand.md`
- X20 small areas (PR #1 finding #7, contract rule): below 4 cell centres the API counts every cell the area touches, so a slightly bigger area can get a lower count (3 centres → 12 cells, 4 centres → 4 cells). Add the covered cells' area to `meta.aoi` (in `CHANGES-1.1.md`; backend, Khalid) and say it in the coarse warning (frontend, Hamza)
- **Open from the PR #1–#34 reviews** (details in `docs/reviews/`): 1.1 proposals: all in `contracts/CHANGES-1.1.md` now (PR #20 review); Khalid and Hamza go through it together · Method: the static mask drops a cell for all 25 years, and X22's Terra-only months: now in `docs/method.md` and on the Method page's Limits (PR #26 and #34 reviews); nothing left · check on Nov 13 (NOAA-21's start date: it has no country files, so through the API) · after the stack merges (overpass `GROUP` platform names, test helper imports; the backend's hotspot, partial-month and `/nrt` filters read the MODIS threshold from the grid's metadata instead of using 30; data paths pasted into the backend's SQL, so a `'` in the data folder breaks every endpoint) · on Nov 13 (R2/R3, from the PR #15 review): time the real bundle's start-up download against the VPS unit's `TimeoutStartSec=300` and health kill (90 s + 3 × 30 s); if it gets close, keep the data on a volume · rename one of the two X15s
- **From the FIRMS comparison (X27, Nov 13)**, not built yet:
  - **Nov 13, with the real key (Khalid, R1/R2):** check `/api/country` (FIRMS marks it unavailable; `build-data.sh` no longer needs it) · NOAA-21's first day: FIRMS's download page says 2023-03-01, its FAQ 2024-01-17; `data_availability` settles it (`platforms.py` uses 2023-03-01) · Río Negro July 2026: check the night share of its detections before the pitch (FIRMS notes 2–3 spurious night pixels a night over the South Atlantic Anomaly, which covers Río Negro)
  - X28 real cloud product (pipeline, Khalid): read MOD14CMH/MYD14CMH (monthly 0.5° CMG, HDF4, UMD sftp `fuoco.geog.umd.edu`) into `clouds/cloud_monthly.parquet` (`python -m almatafi.clouds real`, now a stub); then score the correction (does it shrink cloudy-month residuals?). With the real file, time the cloud join in `/calendar` (5 ms on the mock; every calendar runs it) and check the months it doesn't cover yet: in the corrected view they are not observed (PR #37 review). Until then the app says the cloud cover is simulated
  - X29 FIRMS `/api/missing_data` (pipeline, Khalid): FIRMS's own list of days with no data per satellite. Use it for coverage instead of guessing outages from day counts; that fixes X21. Check the CSV route and columns with the key
  - X30 real alert emails (both, after the event): X27 only previews them (`/api/alerts/preview`) and writes `.eml` files locally (`python -m app.alerts run`). Sending needs a provider, double opt-in, unsubscribe links and a decision on storing addresses
  - X31 cross-check (pipeline, Khalid, R2): our raw counts per country and year against FIRMS's yearly country summary CSV (`firms.modaps.eosdis.nasa.gov/country/`)
  - X32 burned area as an independent check (pipeline, after the event): MODIS/VIIRS burned area (UMD sftp) should show no 2012 step, like the harmonized record
  - Higgsfield `clouds_fire` still ($0.01, defined in `design/higgsfield/shots.json`): Khalid runs `python gen.py clouds_fire && ./process.sh` with the HF key; the Method page shows it once `public/media/clouds-fire.webp` exists
  - Not for us: Landsat 30 m (US/Canada only), geostationary GOES/Meteosat/Himawari/MTG (provisional or experimental), US/Canada fire-danger layers
- Phase 5 UI polish (Higgsfield etc.) and Phase 6 submission: after the MVP checklist in PLAN.md §12

### In progress
- X40 the accessibility voice is silent in Khalid's Chrome (Alt + R, nothing heard): `speak()` hardened against Chrome's known silent failures — Khalid (with Claude), Nov 14, PR open. `frontend/components/a11y/runtime.ts` only
- R1 real FIRMS download — Hamza (with Claude), Nov 13, at Hamza's call (R1 is Khalid's task; Khalid, don't start a second download, the files will be in Hamza's `data/raw/firms/`). Now: the yearly country files for Egypt, Argentina and Chile, 2000–2025, and the three full-resolution outlines. The API part (2026, NOAA-21, the NRT tail) waits for a `FIRMS_MAP_KEY` on Hamza's machine

### In review (PR open, merge in this order)
- X35 Wel3a, the flame guide on every page (written tips + an AI chat on Cloudflare Workers AI through `/api/wel3a` in the site's Worker) — Hamza (with Claude): [hamza5645/nasa-space-apps-almatafi#2](https://github.com/hamza5645/nasa-space-apps-almatafi/pull/2). Khalid to look; it sits next to his X34 tour
- X39 the Accessibility button beside Wel3a's flame (it sat on the bubble and the chat), round like the flame; Wel3a's pop-up tips off by default on small screens — Hamza (with Claude): [hamza5645/nasa-space-apps-almatafi#7](https://github.com/hamza5645/nasa-space-apps-almatafi/pull/7). Khalid to look: the button's place and its hover label were his choices in X37

Each PR is built on the one before it; after merging one, the next retargets to `main` by itself. Each one's TEAM.md Board edits will conflict with `main`; resolve by keeping `main`'s Board.

### Done
- [x] X37 accessibility mode (voice reading and commands, text size, high contrast, reduced motion, keyboard) with a guide — Khalid (with Claude); reviewed and fixed by Hamza (with Claude) (PR #5, merged Nov 13 at Hamza's call). Open: Khalid to look at the review fixes; a real microphone and VoiceOver; the Accessibility button overlaps Wel3a's bubble (Log, Hamza (5))
- [x] X38 the game's stage: no flame on the card, a plain card, the explanation on the card, sprites drawn on a canvas, flames that flicker in place, a third question in chapter 1 — Khalid (with Claude) (PR #6, merged Nov 13 at Khalid's call, **not reviewed by Hamza**). Open: check the characters in Khalid's own browser, Safari and a phone
- [x] X36 narration on the landing (Khalid's eight recorded lines, "Hear the story" button, captions) + the game's stage rebuilt after Khalid's mockup, drawn over a Higgsfield street plate once generated — Khalid (with Claude) (PR #4, merged Nov 13 at Khalid's call, **not reviewed by Hamza**). Open: `python gen.py game_street game_street_tall && ./process.sh` with the HF key ($0.02), then commit `frontend/public/media/game-street*.webp`
- [x] X34 explorer tour + the three FIRMS sources told apart + "try it in two minutes" + the game's night-city theme with Khalid's fire and truck sheets + X28 real cloud product from GIBS — Khalid (with Claude) (PR #1 on the new repo, merged Nov 13 at Khalid's call, **not reviewed by Hamza**). Open: the 2000 → now cloud build is still running; the demo cache still carries simulated clouds until it lands
- [x] X33 "Normal or not?" game (five chapters, Khalid's pixel-art characters, pixel theme) + the raw-vs-harmonized bar slider + phone overlap fixes + page connections — Khalid (with Claude) (PR #38, merged Nov 13 at Khalid's call, **not yet reviewed by Hamza**: Hamza, please look at `frontend/components/game/`, `CompareSlider.tsx` and the page links, and say whether the Oct 31 "no gamification" decision can change)
- [x] X27 FIRMS gaps: country fetch through the area API, cloud correction on a mock cloud product, alert previews, day image, smoke and footprints on the map, KML export, FIRMS credits — Khalid (with Claude); reviewed and fixed by Hamza (with Claude) (PR #37, merged Nov 13). Open: Khalid to look at the review fixes in `pipeline/` and `backend/` (`docs/reviews/pr-37-x27-firms-gaps.md`); Safari and phone check
- [x] X26 4K day map everywhere + "Open the calendar" transition fades — Hamza (with Claude) (PR #36, merged Nov 5). Open: Safari and phone check
- [x] X25 animation jank and load freezes — Hamza (with Claude) (PR #35, merged Nov 3). Open: phone and Safari check; the ~290 ms 8K map upload at load (4K everywhere would remove it)
- [x] I1 staging deploy + auto-deploy on merge to `main` — Hamza (PR #34, merged Nov 3). Live: https://almatafi.monitorthesituations.com, API https://almatafi-api.monitorthesituations.com. `deploy/README.md`
- [x] X15 cinematic UI — Khalid, Hamza (PR #33, merged Nov 3)
- [x] X14 harmonization v2 from the literature — Khalid, Hamza (PR #32, merged Nov 3)
- [x] X13 backend and pipeline bug fixes — Khalid, Hamza (PR #31, merged Nov 3)
- [x] X12 explorer redesign — Khalid, Hamza (PR #30, merged Nov 3)
- [x] X11 frontend fixes from an independent review — Khalid, Hamza (PR #29, merged Nov 3)
- [x] X10 on-demand hotspots outside stored areas — Khalid, Hamza (PR #28, merged Nov 3)
- [x] X9 Nov 13 runbook + build script — Khalid, Hamza (PR #27, merged Nov 3)
- [x] X8 submission drafts + docs/method.md — Khalid, Hamza (PR #26, merged Nov 3)
- [x] U6 landing page + Method page — Khalid, Hamza (PR #25, merged Nov 3)
- [x] U5 exports, share link, offline fallback — Khalid, Hamza (PR #24, merged Nov 3)
- [x] U2 map, drawing, place search — Khalid, Hamza (PR #23, merged Nov 3)
- [x] U1 + U3 + U4 explorer core — Khalid, Hamza (PR #22, merged Nov 3)
- [x] F3 frontend skeleton (Next.js) — Khalid, Hamza (PR #21, merged Nov 3)
- [x] X7 OpenAPI snapshot + contract 1.1 proposals — Khalid, Hamza (PR #20, merged Nov 3)
- [x] X6 `/nrt` live hotspots — Khalid, Hamza (PR #19, merged Nov 3)
- [x] X5 FIRMS download tool — Khalid, Hamza (PR #18, merged Nov 3)
- [x] X4 mock fidelity (real FIRMS layout) — Khalid, Hamza (PR #17, merged Nov 3)
- [x] X3 demo-region cache — Khalid, Hamza (PR #16, merged Nov 3)
- [x] X2 backend deploy setup (Docker + Render) — Khalid, Hamza (PR #15, merged Nov 3)
- [x] X1 CI (GitHub Actions + lockfiles) — Khalid, Hamza (PR #14, merged Nov 3)
- [x] B3c `/admin` — Khalid, Hamza (PR #13, merged Nov 3)
- [x] B3b `/search` — Khalid, Hamza (PR #12, merged Nov 3)
- [x] B3a `/export` + `/validation` — Khalid, Hamza (PR #11, merged Nov 3)
- [x] H3 validation + automatic model choice — Khalid, Hamza (PR #10, merged Nov 3)
- [x] H2 conversion models + harmonized product — Khalid, Hamza (PR #9, merged Nov 3)
- [x] H1 overpass alignment + strata — Khalid, Hamza (PR #8, merged Nov 3)
- [x] B2 `/calendar`, `/stats`, `/hotspots` on mock — Khalid, Hamza (PR #7, merged Nov 3)
- [x] B1 FastAPI skeleton + /health + /regions + AOI parsing — Khalid, Hamza (PR #6, merged Nov 3). Khalid to look at the review fixes
- [x] D3 grid: detections + fire_days, coverage, static mask — Khalid, Hamza (PR #5, merged Nov 3). Khalid to look at the review fixes
- [x] D2 ingest → clean points — Khalid, Hamza (PR #4, merged Nov 3). Khalid to look at the review fixes
- [x] D1 mock FIRMS generator — Khalid, Hamza (PR #3, merged Nov 3). firms-input 1.0.1 still needs Khalid's OK; Khalid to look at the review fixes
- [x] F4 shared `cell_id` + grid contract 1.0.2 — Khalid, Hamza (PR #2, merged Nov 3). Contract 1.0.2 still needs Khalid's OK
- [x] F1 data contract + X15 contract 1.0.1 text fixes — Khalid, Hamza (PR #1, merged Nov 3)
- [x] Private GitHub repo + README — Khalid (Oct 31)

## Decisions

- **Oct 31:** Harmonization is the core of the project; the MODIS vs VIIRS view is secondary.
- **Oct 31:** Demo regions are Río Negro / Chile (CONAE's July 2026 case) and the Nile Delta.
- **Oct 31:** No prediction chart, no gamification. Anomaly detection instead.
- **Oct 31:** Global coverage: harmonized 0.1° monthly grid for anywhere; full hotspot points for demo regions, on-demand elsewhere.
- **Oct 31:** Function first. UI polish (Higgsfield 3D scroll, tracking shots) waits until the core works on real data. globe.gl is allowed now.
- **Nov 3:** Hosting (I1, agreed by Khalid and Hamza): the frontend is a static export on Cloudflare Workers (almatafi.monitorthesituations.com); the backend runs on Hamza's VPS in rootless Podman behind a Cloudflare Tunnel (almatafi-api.monitorthesituations.com), so there's no cold start. Not Render (it sleeps) or Vercel. Every merge to `main` that passes the tests deploys itself. Details: `deploy/README.md`.

## Log

_Newest first. One entry per work session._

### Nov 14 — Khalid (with Claude) (43)
- Did: X40. Khalid tried the merged accessibility mode in Chrome on his Mac: Option + M and the voice commands work, but Option + R (read the page) is silent. I can't hear audio from the headless runs (they show the right utterances queued), so `speak()` now guards against the four ways Chrome goes silent without an error: an utterance queued in the same tick as `cancel()` is dropped (speaking now starts 60 ms later, with a generation counter so a newer call or Stop wins), utterances the garbage collector takes mid-queue stop the queue (they're held until they end), the engine can sit paused after a cancel (`resume()` first), and the default voice can be missing until the voice list loads (an English voice is picked when there is one). Also, Khalid's dev server was in a reload loop (a broken `.next` after a branch switch plus a production build in the same folder: 851 requests of `/`, no globe, "lag"); a clean restart fixed it. 102 frontend tests, lint, typecheck pass; the headless run queues the same utterances as before.
- Next: Khalid runs `speechSynthesis.speak(new SpeechSynthesisUtterance("hello"))` in the Console. Silent there means Chrome or the Mac has no working voice, and this PR won't change that; audible there and still silent on the site means something else in our code, to look at with the extension connected.
- Broken / blocked: the Chrome extension can't connect from this session (OAuth account mismatch), so nothing was heard first-hand.

### Nov 13 — Hamza (with Claude) (6)
- Did: X39. With X35 and X37 both on `main`, the Accessibility button (bottom 100 px) sat on top of Wel3a's tip bubble and open chat, which grow upward from the flame in the same corner.
  - **The button moved beside the flame:** left of it, level with its middle (right 90 px, bottom 28 px; on phones right 72 px, bottom 16 px; on the game page, where the flame is smaller, right 68 px, bottom 14 px). Wel3a's bubble and chat open above the flame, so the button is clear of both. The accessibility panel opens just above the flame (bottom 90 px, was 154 px).
  - **Text size no longer grows the two corner buttons.** At Largest the flame grew to 90 px and covered the bottom of its own bubble; the Accessibility button grew and moved too. Both are icons, so they keep their size; the text in the bubble, the chat and the panel still grows.
  - **Landing:** the hero caption moved further left (152 px from the right, was 96 px; on phones the right padding is 134 px, was 88 px), or the button would cover its end as the flame once did. Its width shrinks on narrow screens so it stays off the scroll cue.
  - **Later, at Hamza's ask:** the Accessibility button is a circle like the flame (44 px; it was a pill that grew a label on hover; the label is gone, the tooltip and the spoken name stay). Wel3a's pop-up tips are off by default on small screens (up to 820 px wide, the landing's phone layout), where the bubble covers much of the page; on wider screens they stay on. The choice made in the chat's "Pop-up tips" box is saved either way (`wel3a-quiet` is now "1" for off and "0" for on; nothing saved means the default for the screen). Checked at 375 px (no bubble; switched on, it shows after a reload) and at 1280 px (bubble shows).
  - Checked in the browser on the dev build, measuring the boxes: the button against the flame, the bubble and the open chat, and the panel against the flame and the button, on the explorer (1280 px at Normal and Largest text, 375 px at both), the game (1280×720 and 375 px) and the landing (900, 1280 and 1600 px wide, 375×667). No overlap anywhere; before the change the button overlapped the bubble and the chat. 102 frontend tests and lint pass.
- Next: Khalid looks at the PR, hamza5645/nasa-space-apps-almatafi#7 (the button's place and its hover label were his choices in X37).
- Broken / blocked: nothing known. Not changed: at Largest text the landing's hero caption runs into the scroll cue at 1280 px (it did before this change too). On Firefox older than 121 (no `:has()`), the game page keeps the button's normal place, 8 px into Wel3a's open chat. Not checked in Safari or on a real phone.

### Nov 13 — Hamza (with Claude) (5)
- Did: a code review of the accessibility PR (hamza5645/nasa-space-apps-almatafi#5, X37) and fixes for its 10 findings, on Khalid's branch (`frontend/components/a11y/`, `frontend/lib/a11y.ts`).
  - **Voice reading:** the mode's own switches were read as "off, switch, not checked", with no name; they are now read by their label. Messages that appear with their text already in them (errors, the place search's "nothing found", the game's explanation) were never read; they are now.
  - **Voice commands:** "reduce motion on" turned it off and "reduce motion off" turned it on; both now do what they say. "click next" and "click back" changed the month; "click" and "press" now always mean the button with that name. "click Download" hit the skip link "Skip to the downloads"; skip links are left out.
  - **Microphone:** with Keep listening on, a missing microphone or a dropped connection repeated "Didn't catch that." without end; any such error now stops listening and says so. The microphone also stays closed while the site talks, and what it hears while the site talks is dropped, so the site doesn't obey its own voice.
  - **Keyboard:** Alt shortcuts no longer fire while typing in a text field (a Mac's Option + A is å, a Spanish keyboard's Option + 2 is @).
  - **The guide:** Alt + K opened the shortcut list under the guide; it now shows on top, and the guide's keys and focus come back when it closes. Alt + A waits while the guide is open. Leaving the page (Alt + 1 to 4, "open the explorer") closes the guide, so the explorer's own tour no longer opens underneath it.
  - **Look:** in high contrast the focus ring on white (the guide, the light sections) was yellow on white; it is blue there. Text size now also covers loose text in `span`, `strong`, `b` and `em`: the calendar's month names, years, totals and medians grow with the cells.
  - Checked: 81 frontend tests (9 new assertions for the commands), lint and typecheck pass. In the browser on the dev build with a stand-in voice and microphone: the four switch names, a status message added to the page, "click download" opening the Download menu, Alt + A and Alt + 2 in a text field, a network error and the site's own voice with Keep listening on, the guide with Alt + A, Alt + K, Escape and Alt + 3, the blue ring on the white guide, and the calendar at Largest (no sideways scroll at 1280 px).
- Then: merged `main` (X35) into the branch (only this file conflicted; both Board lines and both sides' Log entries kept) and merged the PR at Hamza's call. On the merged tree 102 frontend tests, lint, typecheck, the static build and the Worker bundle pass.
- Next: Khalid looks at the fixes. Still to try with a real microphone and VoiceOver.
- Broken / blocked: nothing known. Left as it is, from the review:
  - Text that sits directly in a `div` still doesn't grow with Text size.
  - A guide opened on the explorer before the explorer's first-visit tour appears (about a second after the data) still gets that tour underneath it.
  - Focus doesn't return anywhere when the guide closes (the control that opened it is gone by then).
  - Turning the mode off or on with Reduce motion saved doesn't reload, so the globe keeps the state it loaded with.
  - `REGIONS` in `Accessibility.tsx` is a third copy of the demo regions, and draws the box, not the outline from `/api/regions`.
  - "next month" by voice reads the months from the calendar cells' labels, so a wording change there breaks it.
  - After X35 merges: the Accessibility button sits on top of Wel3a's bubble and open chat, and the voice re-reads the start of Wel3a's chat log on every new message.

### Nov 13 — Khalid (with Claude) (42)
- Did: X37, from the teammate's brief that Khalid forwarded (people with disabilities and older users: screen reading by voice, text size, contrast, keyboard-only control).
  - **One switch, every page:** a floating Accessibility button (bottom right, above Wel3a's spot; Alt + A anywhere) opens a panel with the master switch. Off, the site is exactly as before (no attributes on `<html>`, no listeners). On: text size (Normal / Large / Larger / Largest, CSS `zoom` on text elements only, so the map and canvases keep their size), high contrast (black and white tokens, 2 px outlines, underlined links, yellow focus, the faint scenery behind the explorer hidden), reduce motion (the eight `prefers-reduced-motion` checks now ask `lib/motion.ts`, which also reads the switch; the page reloads and comes back to the same guide step), keyboard mode (skip links first in the tab order: content, the answer, calendar, map, downloads; always-visible focus ring; Alt shortcuts), voice reading (the browser's own voice says what gets focus with name, role and state; reads live regions, so the answer is read when the month changes; Alt + R reads the page from the top; Escape stops). Voice commands through the browser's speech recognition (Chrome, Edge, Safari): "open the explorer", "method", "play the game", "home", "read the page", "stop", "bigger/smaller text", "high contrast" / "contrast off", "reduce motion", "Nile Delta", "Río Negro", "next/previous month" (only months the calendar shows), "show MODIS/VIIRS/harmonized", "click <button name>", "help"; one command per press of the mic button or Alt + M, or "Keep listening". Settings are saved on this device and applied by a tiny inline script before the first paint (no flash for someone on high contrast).
  - **The guide:** the first time the mode is turned on, a six-step stepper (welcome, text size, contrast and motion, keyboard, voice, done) with the real controls inside each step, spoken aloud when voice is on, arrow keys / Enter / Escape, focus kept inside; reopens from the panel. On the explorer it skips the explorer's own tour (which would sit under it) and offers it again on the last step. "Shortcuts and commands" lists everything.
  - Pure parts tested (`lib/a11y.test.ts`, 9 tests): settings parsing, html attributes, what a focused element is called, the command parser, Alt shortcuts by physical key (a Mac's Alt + A types å), the calendar's month labels.
  - Checked in headless Chrome on the dev build with a fake voice and microphone: skip links, Alt + A, the whole guide by keyboard, text 150 % and high contrast on the explorer, landing, Method and game, settings present at load on every page, focus speech ("Area: Nile Delta, Egypt. Change the area, button, collapsed"), page reading, and the commands (next/previous month, VIIRS, bigger text, help, unknown, Method page, Nile Delta). 1440 px and 500 px. No page errors. 81 frontend tests, lint, typecheck and the static build pass.
- Next: Hamza reviews PR; try it with a real microphone and VoiceOver (our voice and a system screen reader would both speak; the panel's Voice reading switch turns ours off). High contrast is a broad override: look for panels it misses.
- Broken / blocked: nothing. The headless run showed two 404s on the story pages that aren't from this change (the Higgsfield plates not generated yet).
### Nov 13 — Hamza (with Claude) (4)
- Did: a code review of the Wel3a PR (hamza5645/nasa-space-apps-almatafi#2) and its fixes, on the same branch.
  - **Long chats broke:** the browser sent the whole chat and the Worker refused requests over 8 KB, so after about 10 to 18 questions every answer failed until a reload. The browser now sends only the last 6 turns, and the limit (20 KB) has room for a full request in Arabic.
  - **Wrong month:** while a month's numbers were loading or had failed, Wel3a still showed and sent the AI the previous month's verdict. It now falls back to the page's general tips.
  - **The AI's inputs:** page notes travel with the question, not in the system message; a request must carry this site's Origin header. Gemma returns the OpenAI `choices` shape, so the other shape's code is gone.
  - **Facts:** "3 to 5 times" contradicted the pages (5.2× worldwide, 12× in the Delta). Tips and the fact sheet now say several times, typically 3 to 5, over 10 where fires are small. The fact sheet says what the harmonized view is for.
  - **Pop-ups:** in the explorer the bubble pops only for an unusual month or one with a warning (unfinished, Terra-only, raw view), not on every click, and not when the chat closes.
  - **Smaller:** a 30 s timeout on a question; refusals show their own message; a failed question no longer overwrites what was typed meanwhile; a long place name no longer cuts the verdict out of the AI's notes; answers may be a little longer (320 tokens); keys typed in the chat no longer depend on where React listens.
  - **Load:** Wel3a's code and styles load after the page (26 KB, no longer in any page's first load).
  - **Landing:** the hero caption moved clear of the flame (it was covered at 375 px and at 1280 to 1400 px wide).
  - **Tests and CI:** 7 tests for the Worker's request handling with stand-in bindings, 86 frontend tests in all; the `tests` workflow's frontend job now bundles the Worker (`wrangler deploy --dry-run`, no credentials needed). Khalid: that is one new step in `.github/workflows/tests.yml`.
  - Checked with `wrangler dev` against the real Workers AI (English and Arabic, a 7.6 KB Arabic chat, a note that tries to change the rules is ignored, no Origin gives 403), in the browser (explorer tips, the game's keys, Escape) and in iOS Safari in the simulator (the keyboard doesn't cover the chat box).
  - **Daily cap (later, at Hamza's call):** the whole site gives at most 800 AI answers in a UTC day (`DAILY_ANSWERS` in `lib/wel3a-chat.ts`), about what the free Workers AI allowance covers, so a Paid plan pays next to nothing. One Durable Object (`AnswerBudget` in `worker/index.ts`, SQLite-backed, on the Free plan too) keeps the day and the count; past the cap the chat says it is done for today and the tips keep working. Tried in `wrangler dev` with the cap set to 2 for a moment.
- Next: Khalid looks at the PR. The cap bounds the spend, not who uses it: one visitor at 50 questions a minute can still use the whole day's 800 in about 16 minutes. A per-visitor daily limit would stop that, but the venue's Wi-Fi shares one address, so it would also stop the room.
- Merged `main` (X38) into the branch; the only conflict was this Log, and both sides' entries are kept.
- Broken / blocked: nothing known. Not tried: the first deploy with the Durable Object (its migration runs on deploy). Not changed: Cloudflare's request logs are on for the chat function. Still not checked on the deployed site or a real phone.

### Nov 13 — Hamza (with Claude) (3)
- Did: X35, Wel3a (ولعة, "a little flame"), at Hamza's ask: a 2D character that shares fun facts and points out what matters. PR hamza5645/nasa-space-apps-almatafi#2.
  - **The character:** a flame with a face, drawn in SVG, in the bottom corner of every page (four moods: idle, talking, thinking, happy).
  - **Tips, no AI:** it pops up with the page's most important point or a fun fact (`lib/wel3a.ts`). In the explorer it leads with the selected month's verdict for the area, then warns about raw views, unfinished months and the Terra-only months. The bubble hides after 12 s; "Pop-up tips" can be switched off. No pop-ups on the game page.
  - **AI chat:** typed questions go to `POST /api/wel3a`, a new function in the site's Worker (`frontend/worker/index.ts`), answered by Gemma on Cloudflare Workers AI from a fixed fact sheet and what's on screen. No API key. Same-origin only, 50 questions a minute per visitor, nothing stored. Pages and files are still served without running the Worker (`run_worker_first: ["/api/*"]`).
  - **When the AI can't answer** (offline, `next dev`, allowance used up) the chat says so and the tips keep working.
  - Checked with `wrangler dev` on the built site against the real Workers AI (English answer 1.6 s, Arabic 8 s, an off-topic question refused, bad requests refused) and in the browser at desktop width and 375 px on the landing, the explorer and the game. 78 frontend tests (11 new), lint, typecheck and build pass.
  - Docs: the AI-use disclosure in `docs/submission.md`, `deploy/README.md`, `frontend/README.md`.
- Next: Khalid looks at the PR (it sits next to his X34 tour; the only shared file is `Providers.tsx`). After the merge, check the deployed chat. The Oct 31 "no gamification" decision still needs a word between us, now for the game and for Wel3a.
- Broken / blocked: not checked on the deployed site: the deploy token may need a Workers AI permission for the Worker's `ai` binding, and the frontend deploy still waits for the `CLOUDFLARE_API_TOKEN` secret in this repo. Workers AI is free up to 10,000 neurons a day (about 800 answers); past that a Free plan refuses and a Paid plan bills. On a 375 px phone the flame covers the end of the landing hero's caption. Safari and a real phone not checked.

### Nov 13 — Khalid (with Claude) (41)
- Did: X38, from Khalid's three screenshots of the game (`frontend/components/game/` only, branch `khalid/x38-game-stage`).
  - **No flame on the question card**; the host stands in the middle of its top edge.
  - **The card is plain:** cream with a dark border, the place and question count as two centred pills, the question centred and bigger; the notepad rings (they were cut in half), the lined paper, the hand underline and the ✦ are gone.
  - **The message after an answer no longer covers the stage.** It was a panel over the pavement that hid Khalid, the truck and the firefighter. It is now written on the card, in place of the question's context line, with "Next question" beside it; the pills and chart captions step aside for it, and on screens under 760 px tall (or 620 px wide) the question's own line does too.
  - **Characters that weren't there:** every sprite was a CSS background on an element made anew for each question, so the browser fetched (the dev server sends `max-age=0`) and decoded each strip again, and until then the character was missing. Sprites are now drawn on a canvas from one Image per sheet, loaded once when the game opens (`Sprite.tsx`).
  - **Also:** the satellite in the chapter pictures drifted to the picture's corner and back (a CSS `transform` animation replaced its SVG transform; now `translate`/`scale`); the two-satellite cards and the 2012 pair are more compact; a wide chart could push the card off a narrow screen.
  - Checked in headless Chrome, all five chapters, at 1000×610, 1280×720, 1470×823, 1440×900 and 520×900: every sprite canvas has pixels on every question, no page scroll, the card cuts nothing but the explorer's feet (4 px, as before). 72 frontend tests, lint and typecheck pass.
- Later, from Khalid: the flames in the chapter pictures travelled away and back as they flickered (their scale's origin was read against the flame's own box, not the picture); they now stretch from the middle of their own base and stay put. Chapter 1 has a third question ("ten hotspots in one field: ten fires?", `fact-count` in `lib/game.ts`), so the game has 14.
- Merged at Khalid's call once the four checks passed; Hamza has not reviewed it.
- Next: Hamza's look after the fact. Khalid: say whether the plain card is what you wanted.
- Broken / blocked: the missing characters did not reproduce in headless Chrome before the change, so the cause above is the likely one, not a proven one; check it in the browser the screenshots came from. Not checked in Safari or on a real phone.

### Nov 13 — Hamza (with Claude)
- Did: moved the auto-deploy to this repo (hamza5645/nasa-space-apps-almatafi). The API image is now `ghcr.io/hamza5645/almatafi-api` (`deploy.yml`, the VPS unit, `deploy/README.md`); the VPS runs it, healthy, and podman auto-update watches it. khalidstark/nasa-space-apps-modis's `deploy` workflow is disabled (its `tests` still run). The old unit is backed up on the VPS at `~almatafi/almatafi-api.container.bak-khalidstark`.
- Then: added the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets here; `deploy` passed for both jobs (run 43477195311), and the live frontend is this repo's build (/, /explore, /method, /play and the API answer 200).
- Broken / blocked: nothing. Merges to the old repo no longer deploy anywhere; work here.

### Nov 13 — Khalid (with Claude) (37)
- Did: merged PR #38 (388f10e) at Khalid's call, after merging `main` (PR #37 and its review fixes) into the branch and resolving TEAM.md; all four checks passed on the merge. Hamza has not reviewed it; the Board says so. The deploy runs on this merge.
- Next: Hamza's review of the game and the slider after the fact; the "no gamification" decision; after the real-data build, rerun `design/game/capture-maps.mjs` and the cache so the game's numbers are real.
- Broken / blocked: nothing known.

### Nov 13 — Khalid (with Claude) (36)
- Did: X33 v2, from Khalid's brief and his five pixel-art sprite sheets.
  - **Five chapters on a level map** (What's a hotspot?, Two eyes in orbit, Normal or not?, The 2012 trap, Read the map), each with an illustrated intro, two or three questions, stars (kept on this device) and a "what you learned". Two answers per question.
  - **The stage:** the question card with the host (the boy with glasses) standing on it; two answer blocks over the ground with Khalid between them. Pick one: Khalid runs under it (runner sheet, mirrored to run left) and jumps; on the jump's peak frame the block bumps and turns green ✓ or red ✗ (and the right one gets a green outline). The host then celebrates, or his shoes catch fire and he runs off in smoke; on a wrong answer the firefighter sprays at once (otherwise every 3 s). The ALMATAFI fire truck glows on the left (Khalid wrote "maradi"; read as Matafi: t/r and f/d are neighbouring keys).
  - **Map questions** use snapshots of our own explorer (same Delta month seen by MODIS, 45 hotspots, and VIIRS, 589; Río Negro July 2026). The explorer character folds and opens his map at the start, on hover and every 3 s.
  - **Pictures instead of the dot strip:** past years as flames with this year hidden until you answer, two satellites side by side, the raw vs harmonized step, the season month by month; SVG illustrations for the chapter intros.
  - **Sprites:** `design/sprites/process.py` cleans, slices and registers the sheets (sources kept in `design/sprites/source/`, 6.4 MB) into strips + `sprites.json`; `components/game/Sprite.tsx` plays them frame by frame so effects land on a given frame. `design/game/capture-maps.mjs` retakes the map snapshots after a data change (do it after the real-data build).
  - **The slider** is now one bar chart that morphs from the raw join to our record (Nile Delta mock: 11.6× → 0.80×), with Raw/Harmonized buttons and one auto sweep. "No jump" only between 0.8× and 1.25×.
  - **Pages connected:** a menu in the explorer's top bar (the story, Method, the game), the game's header links to the explorer and Method, Method ends with "Test yourself", the landing band shows the host.
  - Checked: all five chapters played (dev), 1440/900/390 px, keyboard, no page errors; 67 frontend tests, lint, typecheck and the static build pass.
- Later the same day, after Khalid played it on his laptop (about 1000×610 px): the question now fits the screen, no page scroll (header / host / card / blocks / ground in one grid; everything sized from the viewport height, down to 58% at 600 px tall; the explanation comes in over the card's lower part), the host's celebration no longer loses its head (he draws above the header), the past-years flames are real flames (fixed shape, lighter tongue, eased heights) with this year as a dashed outline until you answer, the firefighter sprays toward the stage, and the game's theme matches the pixel-art characters (Pixelify Sans for titles and labels, bevelled hard-edged blocks and buttons, a pixel-bordered card, dithered sky and a tiled ground). Measured at 1000×640, 1280×720, 1440×780, 1440×900 and 390×844: no scroll before or after answering, "Next question" always on screen. Note for Khalid: the blocks-over-the-map and hint-at-the-top in his screenshots were his tab's old stylesheet (hot reload didn't replace the rewritten CSS); a hard refresh fixes it.
- Next: Hamza reviews PR #37, then #38. After the real-data build: rerun `design/game/capture-maps.mjs` and rebuild `public/cache/` so the game's numbers are real. Voice lines (`docs/narration.md`) when recorded.
- Broken / blocked: nothing. Higgsfield still not used (no key here); the truck and illustrations are drawn in SVG.

### Nov 13 — Khalid (with Claude) (35)
- Did: X33, after looking at Connected Earth (the museum project with the game that Khalid pointed to): borrow the playful parts, built on our own data.
  - **"Normal or not?" (`/play`):** 7 rounds built at build time from the demo regions' offline copy and the globe's real FIRMS week, so it ships with its numbers and works offline. Round kinds: is this month normal (past years as dots, the month hidden until you answer), which year really burned more (a real case where raw MODIS vs raw VIIRS points the wrong way), the season's peak month, the 2012 trap (raw join vs ours), and FIRMS facts (a hotspot isn't always a fire, clouds hide fires, Terra vs Aqua overpass, MODIS vs VIIRS in the same week). 3 embers, points with a streak bonus, a drawn ember host whose mood follows the game, sparks and drifting embers, synthesized sound off by default, keys 1–4 and Enter, reduced motion respected. `lib/game.ts` is pure and tested on the committed cache (7 tests).
  - **Sprite sheets:** `lib/mascot.ts` takes a sheet (one row per mood: idle, happy, sad, win, out); set `MASCOT` and the drawn ember steps aside. Nothing else changes.
  - **Raw-vs-harmonized slider:** the same calendar twice on one colour scale, raw join left of a draggable line, ours right, with each side's jump at 2012 (Nile Delta mock: raw 12.4×, ours 0.85×). In the explorer for the selected area and on the landing's proof section. No Higgsfield assets needed.
  - **Narration:** `docs/narration.md` has the 8 landing lines (they double as the 30 s video voice-over) and 8 game reactions, with file names. The game already plays them once recorded (list the ids in `lib/sound.ts`); landing captions and voice get wired when the recordings arrive.
  - **Khalid's asks:** the "Generated" tags are gone (they also caused the phone overlaps over headings and the nav); the disclosure stays in the FAQ, the Method sources and `submission.md`'s AI-use section. Phone hero: the caption ran into the chips on 375×667 and 360×640 and the scroll cue sat on it at every phone size; the caption now follows the chips and the cue is gone on phones.
  - Links: "Play" in the nav (hidden under 560 px, where it would wrap the nav), a band on the landing, a link in the explorer's slider section.
  - Checked: dev and the static build at 1440 px and 390 px, a full playthrough (right, wrong, out of embers), keyboard and sound toggle. 63 frontend tests, lint, typecheck and build pass.
- Next: Hamza reviews PR #37, then PR #38. Khalid: sprite sheets for the host; recordings for `docs/narration.md`; `python gen.py clouds_fire game_win game_lose && ./process.sh` with the HF key ($0.03; ledger would be $3.24 of $5).
- Broken / blocked: Higgsfield needs the HF key, so nothing new was generated (spend still $3.21). The "no gamification" decision needs Hamza.
### Nov 13 — Khalid (with Claude) (40)
- Did: X36, two things, PR #4 (merged at Khalid's call; Hamza has not reviewed it).
  - **Narration:** Khalid's eight recordings (`design/audio/source/`, trimmed and normalised to `frontend/public/audio/n0–n7.mp3`, 436 KB) play on the landing page chapter by chapter behind a "Hear the story" button (bottom left, off by default, remembered on this device), with the line as a caption; leaving the page stops the voice. The chapter-in-view rule is in `lib/narration.ts` (tested). Checked headless: 8 captions and 8 audio requests in order at 1440 px, no page errors.
  - **The game's stage after Khalid's mockup** (he said the night-city theme was "nothing like what I wanted"): a notepad card with four rings and the question underlined by hand, a flame burning on the card's top edge with the host beside it, a centred pair of yellow/red riveted blocks without key tiles, a bigger truck and firefighter standing on a tiled pavement, the explanation over the pavement so the revealed chart stays in view, the years chart as the last 12 years in big flames that scale with the screen. The SVG scene is redrawn closer to the mockup (a low old-city skyline far away, leafy trees, ornate lamps). **Higgsfield:** two Soul stills, `game_street` (16:9) and `game_street_tall` (9:16), $0.01 each, prompted from the mockup; `process.sh` writes `public/media/game-street*.webp`, and the play page draws itself over them once they exist (the sidewalk is the bottom 7.5 % of the plate, `PLATE_GROUND` in `Stage.tsx`). Not generated: no HF key in this environment, so Khalid runs `python gen.py game_street game_street_tall && ./process.sh` and commits the two WebPs.
  - Measured at 1440×900, 1440×780 and 1000×640: no page scroll before or after answering; 72 frontend tests, lint, typecheck and the static build pass.
- Next: Khalid generates the plates (then check `PLATE_GROUND` against the image's sidewalk); the real cloud build is still running (~half of its 9,500 images at 22:00), then the swap into `data/clouds`, the demo cache and `public/cache/`.
- Broken / blocked: the Higgsfield key; headless Chrome can't go under 500 px wide, so the phone layout of the new stage is unmeasured.

### Nov 13 — Khalid (with Claude) (39)
- Did: merged PR #1 on the new repo (f2f5d09) at Khalid's call, all checks green. Hamza has not reviewed it; the Board says so.
- Next: the real cloud product (building, ~2 h) → `data/clouds`, demo cache and `public/cache/` rebuilt, one more small PR. Hamza's review after the fact.
- Broken / blocked: nothing known.

### Nov 13 — Khalid (with Claude) (38)
- Did: X34 + X28, on the new repo (hamza5645/nasa-space-apps-almatafi; the old one is left as it is, as Khalid asked).
  - **From the Cairo judging guide** (judges test the site themselves with the 30 s video or 7 slides and a description; no pitch; five criteria: Impact, Creativity, Validity, Relevance, Presentation): the site must explain itself cold. So: a **ten-step tour** in the explorer (spotlight + card, Back/Next/Skip, arrow keys, Escape; opens by itself on a first visit, replays from a Tour button); a **Data** button and a landing section ("NASA FIRMS, three ways") that separate the three sources: the yearly archive (2000 → last year, science quality, with the fire type), this year through the API (standard, then NRT), and the public 24h/48h/7-day CSVs (no key; the globe's week, too short for the record); the globe caption names its source; the Method page lists the same three. The landing's light part opens with **"Try it in two minutes"**: Río Negro July 2026, the Delta on MODIS then VIIRS, one game chapter.
  - **Real cloud product (X28):** NASA NEO's archive is gone (redirects), and MOD14CMH needs UMD's sftp plus HDF4. GIBS serves the same MODIS cloud mask as daily `MODIS_Terra/Aqua_Cloud_Fraction_Day` layers with a published colour map, so `python -m almatafi.clouds real` asks GIBS's WMS for one image per region and day at one pixel per 0.5° cell, decodes the colours (0–100 %, transparent = not seen), and averages per cell and month; images cached for reruns; `--bbox` / `--since` to limit a run; 6 tests against a fake GIBS. Checked on the Nile Delta, October 2026: 30 days per cell, Aqua 0.54, Terra 0.46 (the simulated product said 0.11, so the real correction is bigger). GIBS takes ~8 images/s at 12 workers; the two demo regions over 26 years (~38k images) take about 80 min and are running now. `build-data.sh real` uses it (`CLOUDS=mock` skips). Method texts updated: the daytime cloud fraction counts haze, so the corrected view is an upper bound.
  - Note for the Mac: this python.org Python has no root certificates; the code uses certifi when present, and `SSL_CERT_FILE=<backend venv>/certifi/cacert.pem` works meanwhile.
- Later: **the game's theme**, from Khalid's mockup and two more sheets: a night-city scene in SVG (starry sky, crescent moon, clouds, a skyline with lit windows, a minaret and a dome, trees, glowing lamp posts, a bench, a hydrant, a brick pavement) behind every screen; the question card as a spiral notepad on lined paper with a taped chart; riveted yellow (helmet) and red (flame) answer blocks with hazard stripes; a cream explanation panel. The charts' flames are Khalid's fire sheet (a tall-frames loop so height still means hotspots, sized by column count) and the truck is his ALMATAFI truck sheet with blinking lights. Checked at 1440/780 and 390/844; 70 frontend tests, lint, typecheck and build pass.
- **GIBS rate:** under sustained load GIBS allows about 1.5 requests a second from one address, so the builder now asks for one world image per day (720 × 360 at 0.5°, the same cost as a regional one, serves every region) and samples every second day: ~9,500 requests for 2000 → now, about 2 h, running now for the whole grid (`data/clouds-real`, cache `data/raw/gibs-clouds`, 20 KB per image). The cache serves the three-country build too, so Nov 13's real build won't repeat it.
- Next: when the cloud build finishes, swap it into `data/clouds`, rebuild the demo cache and `public/cache/`, check the corrected view, commit. Hamza to review.
- Broken / blocked: the automated security review of one commit didn't run (reviewer unreachable; `~/.claude/security/log.txt`); a later push re-checks.

### Nov 13 — Hamza (with Claude) (2)
- Did: merged PR #37 (b122d82) at Hamza's call, before Khalid looked at the review fixes, and checked it live. `tests` and `deploy` passed on the merge commit; the VPS had the new image about 2 minutes after the deploy finished. Live API: the Nile Delta's October 2026 calendar export gives 589 as seen and 665 with `clouds: correct` (column `value_cloud_corrected`); the alert preview and the KML export answer. Live explorer in headless Chrome: no page errors; the alert preview clears when the area or the level changes; calendar and grid downloads send the cloud setting; the KML file is named `.kml`. X27 moved to Done.
- Next: Khalid looks at the review fixes in his area, most of all the rule that a month without cloud data is not observed in the corrected view. Today's real fetch must run from `main` (it has the Chile outline fix). Safari and phone check of the explorer's new controls.
- Broken / blocked: nothing. Not checked live: the Day image's layer order when the base map style fails to load (checked locally before the merge).

### Nov 13 — Hamza (with Claude)
- Did: reviewed PR #37 (X27) and fixed what the review found, on Khalid's branch (`docs/reviews/pr-37-x27-firms-gaps.md`, 11 findings).
  - **For today's real run:** `fetch api --country` clipped FIRMS rows to the map's 2,000-vertex outline, which is up to 9.5 km off for Chile (6.6% of its area on the wrong side; Egypt 0.004°, Argentina unchanged). It now clips to geoBoundaries' full ADM0 file in `data/outlines/` (`python -m app.admin --outlines DIR EGY ARG CHL`; `build-data.sh` does it). The `fetch api` flag is `--outline-dir` now, not `--admin-dir`.
  - **Cloud correction:** a month the cloud product doesn't cover is not observed in the corrected view (it was left uncorrected next to months scaled up to 5×). Calendar and grid exports follow the "Cloud-corrected" toggle.
  - **Explorer:** "Day image" no longer covers the area and the dots when the base map style fails to load; the alert preview no longer outlives its area; KML files were saved as `.undefined`.
  - **Backend:** KML exports capped at 50,000 points (200,000 took 940 MB); alert emails write big counts out; a refused area is checked once.
  - 225 pipeline, 229 backend, 53 frontend tests; lint, typecheck and build clean. Checked on a full mock build and in headless Chrome against a local API. The offline cache is unchanged.
- Next: Khalid looks at the fixes in `pipeline/` and `backend/`, then PR #37 can merge. If the real fetch already ran with the old code, rerun Chile's API part: delete its `sp_chl_*` and `nrt_chl_*` files and their `manifest.json` entries first, or the rerun skips them.
- Broken / blocked: nothing. Not changed: Chile's fetch box reaches Easter Island, so its requests also bring neighbouring countries' rows, which the clip drops.

### Nov 13 — Khalid (with Claude) (34)
- Did: X27, after comparing the project with NASA FIRMS's own pages (Earthdata FIRMS page and FAQ, API index, download and alerts pages; notes in `docs/firms-research.md`).
  - **Fixed for today's real run:** FIRMS's API index marks `/api/country` "currently not available", and it answers `Invalid API call.` before checking the key, so `build-data.sh real --fetch` would have failed at its API step. `fetch api --country EGY` now asks the area API for the country's box and keeps the rows inside its geoBoundaries ADM0 outline (~1 km slack for coastal pixels); `build-data.sh` downloads the outlines first; `manifest.json` records the fetched and the written file. Checked on the real Egypt and Chile outlines (Cairo, Alexandria's coast and Easter Island in; Gaza, Tel Aviv, Khartoum, Mendoza and Neuquén out; 100k points in 0.04 s). The yearly country files still download.
  - **Cloud correction (scratch):** `almatafi.clouds` writes a cloud fraction per 0.5° cell and month, the grid of MOD14CMH/MYD14CMH, **simulated** for now (`source: mock`, labelled in the app and API). `/calendar` and `/stats` take `clouds: "correct"`: each cell's harmonized count ÷ max(1 − cloud, 0.2), Aqua's pass (Terra's before July 2002), baseline corrected the same way. Every calendar returns the area's cloud per month; months over 50% get a corner mark. Mock Nile Delta Oct 2026: 589 → 665 at 11% cloud; Río Negro's winters are the cloudy ones. Carried through the Dockerfile, `build-data.sh`, the bundle, bootstrap and the offline copy.
  - **Alerts (scratch, no email):** `POST /api/alerts/preview` renders the "unusual month" email for an area (this month so far, else last month); "Alert me" in the explorer shows it in a sandboxed frame. It asks for no address and stores nothing. `python -m app.alerts add|list|run` keeps local subscriptions and writes triggered alerts as `.eml` files to `data/alerts/outbox/`; there is no mail server.
  - **Map, like FIRMS's own:** each detection's pixel footprint from zoom 8 (1 km MODIS vs 375 m VIIRS, our core problem made visible), "Day image" (GIBS true colour of the picked hotspot's day, else the month's busiest, from the satellite flying then) and "Smoke" (OMPS NOAA-20 / OMPS S-NPP / OMI aerosol index). Layer ids checked in GIBS's capabilities today.
  - **Exports:** hotspots as KML (footprints, FRP colours, a folder per satellite).
  - **Credits:** FIRMS's acknowledgement in the footer, Method page, `method.md` and `submission.md`; Giglio et al. 2016 and Davies et al. 2009 added. Method limits: simulated cloud, FIRMS's two day/night definitions, the South Atlantic Anomaly.
  - **Khalid's question "why no videos on the host":** every media file is served by the live site (the case films, both 61-frame films, the globe maps and the satellite models all answer 200). The empty black stage in his screenshots is the globe never reporting ready: the stage showed neither the globe nor its still. On a slow connection the still now shows after 6 s (also when the scene's code fails to load), and a globe that arrives later takes over. Checked headless with the day map blocked (still at 6.2 s) and normally (globe live).
  - Checked live on localhost (backend on the rebuilt mock, frontend dev) at 1440 px and 390 px. 225 pipeline, 223 backend, 53 frontend tests; lint, typecheck and build pass. OpenAPI and API types regenerated; contract proposals in `contracts/CHANGES-1.1.md`. `public/cache/` rebuilt (mock-20261113); validation numbers unchanged.
  - Also committed Khalid's Nov 6 log entry and its 4 Higgsfield shots, which were uncommitted in his checkout (a copy is in `git stash`).
- Next: review and merge PR #37 (Hamza for `frontend/`). Today with the real key: the three checks on the Board, then `FIRMS_MAP_KEY=… scripts/build-data.sh real --fetch`. Generate `clouds_fire` (needs the HF key). X28–X32 on the Board.
- Broken / blocked: Higgsfield needs the HF key, which I couldn't use here, so `clouds_fire` is defined but not generated (spend still $3.21 of $5). The Chrome extension wasn't connected, so the live-site check was headless; the cloud correction can't be validated until real cloud data is read.

### Nov 6 — Khalid (33)
- Did: edited the Cairo registration video from a teammate's 73 s take (the script in the registration PDF). The edit lives outside the repo, in `~/Documents/video-editor-bassam/projects/almatafi-registration` (Remotion). Four new Higgsfield shots were added to `design/higgsfield/shots.json`: `planet` (Soul still), `me_open` (Kling 3.0 dive from orbit into her room, last frame = her first frame), `me_close` (Kling 3.0 pull-out from her room to the planet) and `v_responder` (Kling 2.5 loop). Spend is now **$3.21** of the $5 cap. The video's numbers are the same real FIRMS week as the site (MODIS 58,127 vs VIIRS 300,095; Nile Delta box 7 vs 88). The schematic charts are labelled ILLUSTRATION and every AI shot is labelled.
- Next: team checks the video, uploads it to YouTube as Public, and pastes the link into the form before Sat Nov 7 23:59.
- Broken / blocked: nothing. (Committed on Nov 13 from Khalid's local checkout, where it was left uncommitted.)

### Nov 5 — Hamza (with Claude) (2)
- Did: merged PR #36 and checked it live. `tests` and `deploy` passed on the merge commit (8d00aa9). On the live site the transition's class timeline is the new one (`warp-in` at 2 ms, covered at 823 ms, clear at 1,772 ms), the 8K map returns 404 and the 4K map is served. X26 moved to Done.
- Next: Safari and phone check of the landing, Method and the transition.
- Broken / blocked: nothing. Seen once on the live run: a 348 ms task about half a second after the smoke cleared, while MapLibre builds the map (no script attributed; the earlier live trace had 120 ms there). Not part of the transition.

### Nov 5 — Hamza (with Claude)
- Did: X26, two things.
  - **4K day map everywhere** (`lib/orbit/scene.ts`): the globe no longer picks the 8K map on screens 1100 px and wider, and the 8K file is gone (2.3 MB less to deploy). That was the last load freeze from X25 (~290 ms uploading it to the GPU); the globe is a touch less sharp up close on big screens.
  - **"Open the calendar" felt slow and laggy.** Traced the click in headless Chrome (M2 GPU, 60 fps, screenshots every 100–300 ms). The smoke cut in fully opaque on the first frame after the click, sat almost still for ~400 ms (its frame index eases in cubically), then cut out at the end; the explorer was drawn at 1.06 scale under the smoke and snapped to 1 when it went. Hard cuts and a still image read as lag. Cause: `drawSequence`'s `cover()` in `lib/orbit/sequence.ts` set `globalAlpha` itself, throwing away the overlay's fade (the helper was written for the scroll film, where alpha is 1). It now multiplies the caller's alpha (test added), so the smoke fades in over the first 0.8 s with the landing still visible under it and fades out over 0.9 s as the explorer appears. The push-in scale now applies only to the page being left (`html.warp-in`, set by `WarpOverlay`), so the arriving page is never scaled and nothing snaps. Measured after: smoke alpha 0 → 30 → 80 → 204 → 255 at 50, 300, 500, 650 and 780 ms, then 255 → 239 → 172 → 53 → 5 at 900, 1050, 1200, 1400 and 1600 ms; no frame over 40 ms and no long task in the whole transition (landing → explorer, Method → explorer; with the API answering and with the offline copy, where the data renders land inside the fade). Durations are unchanged (`IN_MS` 820, `OUT_MS` 900 in `WarpOverlay.tsx`): the pace is a design choice; try it, and shorten those two numbers if it still feels slow.
  - 47 frontend tests, lint, typecheck and build pass.
- Next: review PR #36; check in Safari and on a phone. Seen, not changed: the explorer's JS (322 KB compressed) only downloads once the smoke is opaque (Next's prefetch doesn't fetch it), so a slow connection lengthens the opaque hold; the live API answers the explorer's six requests in 0.6–1.4 s warm and 3.3–3.8 s on a cold first hit (they queue on its 1 CPU), so the calendar fills a second or more after the smoke clears (Khalid's area); the explorer's brand link goes home without smoke, and the landing's three.js chunk costs ~200 ms of long tasks as it appears.
- Broken / blocked: nothing. The one 433 ms freeze seen in the very first trace never came back in eight more runs.

### Nov 4 — Hamza (with Claude)
- Did: checked X25 after PR #35 merged. `tests` and `deploy` passed on the merge commit (c3e857c). The live bundle has the new code (ImageBitmap decode, `compileAsync`, `warp-covered`, the explorer's delayed map). Headless check of the live site: the globe renders, and the explorer shows Nile Delta Oct 2026 = 589 from the live API with its map. X25 moved to Done.
- Next: check the landing, Method and explorer on a phone and in Safari. Decide on the 8K day map (keep it, or 4K everywhere to drop the ~290 ms upload at load).
- Broken / blocked: nothing.

### Nov 3 — Hamza (with Claude) (3)
- Did: X25, a performance pass on the animations. Profiled a production build (in-app browser for frame timing, headless Chrome on the M2's GPU for causes). Scrolling was already a steady 60 fps; the jank was one-off freezes. Fixed, by area:
  - **Globe** (`lib/orbit/scene.ts`): Earth maps decode off the main thread (ImageBitmap) and upload before the reveal; every shader program, including the swath fans, fires and satellite models that start hidden, is compiled before the globe shows. The first frame went from ~450 ms to nothing long, and the first-scroll freeze (up to 589 ms, when the swath first appeared) is gone. No per-frame layout reads or allocations.
  - **Scroll stage** (`useOrbitStage.ts`, `story.css`): no animated blur on the glass chapters (they also blur the canvas behind them); the loop does nothing when the scroll hasn't changed; reads before writes; the scene sleeps while the transition's smoke fully covers the page; the grain pauses when unseen.
  - **Film and transition** (`sequence.ts`, `OrbitStory.tsx`, `WarpOverlay.tsx`, `globals.css`): film frames are decoded before use (the 200–300 ms freezes at the film's start and end on a first visit); the film redraws as frames arrive; canvases sized to the 1600×900 frames, not 2× the screen; no full-page blur during page changes.
  - **Explorer** (`MapView.tsx`, `explorer-x15.css`): MapLibre is created after the smoke clears and the entrance animation ends (its ~0.5 s shader compile and ~0.75 s first frames used to land in that animation; the 274 ms "JSON" task was the map's construction); the entrance has no blur. Load now shows no long frames.
  - **Reveals, videos, nav** (`SmoothScroll.tsx`, `Nav.tsx`): reveals are opacity + lift only; the case films play only near the screen; the nav finds its tone with an IntersectionObserver instead of a hit test on every scroll frame.
  - An independent review of the diff found 4 issues, all fixed: the globe froze under thin smoke and the arriving page stayed blank until the smoke cleared (now asleep only while the smoke is opaque), a failed wait could keep the map away (now capped at 4 s), the nav strip didn't follow nav height changes, and maps arriving after dispose weren't released.
  - Visuals checked against the live site at the same story points (hero, Aqua, Delta, dive, explorer): identical. 45 frontend tests, lint, typecheck and build pass.
- Next: review PR #35. Check on a phone and in Safari (they take the same new paths, untested there).
- Broken / blocked: one ~290 ms task remains at load on screens ≥1100 px: uploading the 8K day map to the GPU, while the globe is still hidden. Using the 4K map everywhere would remove it, at some sharpness on big screens.

### Nov 3 — Hamza (with Claude) (2)
- Did: checked the first deploy from `main` after PR #34 merged. `tests` then `deploy` passed on the merge commit (5bf6068): frontend on Cloudflare, API image on GHCR. The VPS swapped it in at 16:15 UTC (11 min after the merge) and runs exactly `:sha-5bf6068`, healthy. Live browser check 18/18 (landing, Method, explorer on Río Negro Jul 2026 = 231 via the live API, the four exports, share links, offline copy, 404). The temporary branch trigger was already removed in the PR #34 review. I1 moved to Done.
- Next: R2/R3 on Nov 13: put the real bundle in the VPS's `api.env` and time its start-up download against the unit's limits (see the Board's open items).
- Broken / blocked: nothing.

### Nov 3 — Hamza (35)
- Did: reviewed PR #34, the last PR (`docs/reviews/pr-34-i1-deploy.md`). Removed the temporary `push: hamza/i1-deploy` deploy trigger, in the same push that brought `main` in, so that push didn't deploy. Added the static-mask and Terra-only cards to the Method page's Limits. Fixed the README's CI sentence. Removed the unused `render.yaml`. Merged `main` into PR #34. All 34 PRs are now reviewed and merged.
- Next: after this merge, `main` deploys itself once its tests pass (API image to GHCR, picked up by the VPS within 5 min; frontend through wrangler). Before Nov 13: X16, X17, X21, X22 (Khalid's July 2002 check; Hamza's Terra-month marks in the calendar). Before the demo: X19, X23, X24. On Nov 13: time the real bundle download on the VPS.
- Broken / blocked: nothing.

### Nov 3 — Hamza (34)
- Did: reviewed PR #33 (`docs/reviews/pr-33-x15-cinematic-ui.md`). No code fixes. In headless Chromium the landing page renders the WebGL globe with no errors and respects reduced motion. It's heavy on first load (11.5 MB on desktop, 2.8 MB with reduced motion; phones get the 4K texture), so check it on the venue Wi-Fi. Added PR #33 to the In review list (it wasn't there). Merged `main` into PR #33.
- Next: review PR #34 (I1 deploy, Hamza's) and add the static-mask and Terra-only limits to the Method page there.
- Broken / blocked: nothing.

### Nov 3 — Hamza (33)
- Did: reviewed PR #32 (`docs/reviews/pr-32-x14-harmonization-v2.md`). Fixed: after S-NPP's end, NOAA-20 (else NOAA-21) now stands for a month whenever it has data, so a quiet regional build can't fall back to S-NPP's last 2 days or to Aqua. NOAA-filled rows record `M0`, the model that converts them. Rebuilt the committed demo cache with the fixed pipeline (raw 2012 jump 4.6×, not 2.87×). X22 rechecked with M3: Terra-era Delta 0.71. Merged `main` into PR #32.
- Next: review PR #33 (X15 cinematic UI), then PR #34 (I1 deploy), where the Method page gets the static-mask and Terra-only limits.
- Broken / blocked: nothing.

### Nov 3 — Hamza (32)
- Did: reviewed PR #31 (`docs/reviews/pr-31-x13-bug-fixes.md`). No code fixes here. Found: after S-NPP's end (Nov 2), the harmonized record uses NOAA-20 only when it observed ≥ 90% of a month. In a quiet regional build (X21), November 2026 would stand on S-NPP's 2 days, and later months on converted Aqua (simulated with the tip's `align`). The fix goes in PR #32, where `align.py` changes. Merged `main` into PR #31.
- Next: review PR #32 (X14 harmonization v2) with that fix, the July 2002 check (X22) and the NOAA-filled rows' model.
- Broken / blocked: nothing.

### Nov 3 — Hamza (31)
- Did: reviewed PR #30 (`docs/reviews/pr-30-x12-explorer-redesign.md`). Fixed: the verdict called a month "normal" when `/stats` had no status, which from X13 on means too few past years to judge; it now says so. In headless Chromium the redesigned explorer matches `/stats` and fits a 390 px phone. Merged `main` into PR #30.
- Next: review PR #31 (X13 backend and pipeline bug fixes), including what fills S-NPP's place after it stopped on Nov 2.
- Broken / blocked: nothing.

### Nov 3 — Hamza (30)
- Did: reviewed PR #29 (`docs/reviews/pr-29-x11-review-fixes.md`). No code fixes. The nine fixes hold (link month limits, admin links with country and level, radius 1–500 km, 180° fit boxes, calendar keys, tile loader, offline outlines). Added to X23: the share link's base64 helper spreads every byte as an argument, close to Safari's limit for big shapes. Merged `main` into PR #29.
- Next: review PR #30 (X12 explorer redesign).
- Broken / blocked: nothing.

### Nov 3 — Hamza (29)
- Did: reviewed PR #28 (`docs/reviews/pr-28-x10-on-demand.md`). No code fixes. Added X24: on-demand hotspots only kick in when the stored points come back empty, so an area partly inside the stored coverage silently gets part of its hotspots. The demo regions are fine. Merged `main` into PR #28.
- Next: Khalid picks up X24; review PR #29 (X11 frontend fixes from an independent review).
- Broken / blocked: nothing.

### Nov 3 — Hamza (28)
- Did: reviewed PR #27 (`docs/reviews/pr-27-x9-runbook.md`). No code fixes. `scripts/build-data.sh mock` runs end to end (146 s, 48 MB bundle), and that bundle installs through the bootstrap as an unprivileged user with its own cache kept (this PR's fix for PR #16). The runbook's Render step and the current-year fetch are fixed at the top of the stack by X13. Merged `main` into PR #27.
- Next: review PR #28 (X10 on-demand hotspots outside stored areas).
- Broken / blocked: nothing.

### Nov 3 — Hamza (27)
- Did: reviewed PR #26 (`docs/reviews/pr-26-x8-submission.md`). Added two limitations to `docs/method.md` §7: static-source cells are masked for the whole record, and the Terra-only months (2001-01 → 2002-06) are unreliable where Terra sees little (X22). The submission drafts keep every result as `[real]`; their stale demo link and model list are fixed at the top of the stack. Merged `main` into PR #26.
- Next: review PR #27 (X9 Nov 13 runbook + build script).
- Broken / blocked: nothing.

### Nov 3 — Hamza (26)
- Did: reviewed PR #25 (`docs/reviews/pr-25-u6-landing.md`). No code fixes. The built landing and Method pages carry their numbers in the HTML and label the mock data. The Method page's Limits lack the static-mask and Terra-only limitations; they go in at PR #26 (docs) and PR #34 (page), since X15 rewrites the page in between. Merged `main` into PR #25.
- Next: review PR #26 (X8 submission drafts + docs/method.md).
- Broken / blocked: nothing.

### Nov 3 — Hamza (25)
- Did: reviewed PR #24 (`docs/reviews/pr-24-u5-share.md`). Fixed: since the PR #21 retry change, a 404 for an admin area the server is still downloading wouldn't heal; it's now retried up to 3 times. Added X23 (before the demo, frontend): share links with a big searched outline pass Cloudflare's 32 KB URL limit (Chukotka: 57 KB). Offline mode rethrows the error for anything the copy lacks, so that Board item is closed. Merged `main` into PR #24.
- Next: Hamza picks up X23; review PR #25 (U6 landing + Method page).
- Broken / blocked: nothing.

### Nov 3 — Hamza (24)
- Did: reviewed PR #23 (`docs/reviews/pr-23-u2-map.md`). No code fixes. In headless Chromium on the full mock, the map loads with the imagery, the area outline and the hotspot dots, linked to the stats and hotspot lists. The 500s in the console are GIBS's empty label tiles, not our API. The map fits to the area's own geometry, which handles shapes across 180°, so the PR #12 bbox check is done. Merged `main` into PR #23.
- Next: review PR #24 (U5 exports, share link, offline fallback).
- Broken / blocked: nothing.

### Nov 3 — Hamza (23)
- Did: reviewed PR #22 (`docs/reviews/pr-22-u1-explorer.md`). No code fixes. I ran the explorer in headless Chromium against the full mock: the stats panel matches `/api/stats` exactly, there's no overflow at 390 px and no console errors, and the calendar's keyboard tab stop works because the explorer keeps the selection inside the calendar. Merged `main` into PR #22.
- Next: review PR #23 (U2 map, drawing, place search), including the map fit for bboxes across 180°.
- Broken / blocked: nothing.

### Nov 3 — Hamza (22)
- Did: reviewed PR #21 (`docs/reviews/pr-21-f3-frontend.md`). Fixed: queries retried 4xx answers (a refused big area did the slow backend work twice); now only network errors and 5xx get one more try (`lib/retry.ts`, tested). The README's CI sentence can only change at PR #34 without conflicts, so it's on the Board for then. Lint, typecheck, tests and build pass. Merged `main` into PR #21.
- Next: review PR #22 (U1 + U3 + U4 explorer core).
- Broken / blocked: nothing.

### Nov 3 — Hamza (21)
- Did: reviewed PR #20 (`docs/reviews/pr-20-x7-openapi.md`). Fixed `CHANGES-1.1.md`: MODIS version 6.2, and GeoTIFF ≤ 10M pixels. Added the seven 1.1 items from the PR #1–#19 reviews (instrument in `bad_value`, bad `acq_time`, the grid's MODIS threshold, calendar rounding, 413/500, small-area coverage, `/search` names and bbox). The OpenAPI snapshot still matches the backend with today's fixes. Merged `main` into PR #20.
- Next: Khalid and Hamza go through `CHANGES-1.1.md` together; review PR #21 (F3 frontend skeleton).
- Broken / blocked: nothing.

### Nov 3 — Hamza (20)
- Did: reviewed PR #19 (`docs/reviews/pr-19-x6-nrt.md`). No code fixes. A bad MAP_KEY (FIRMS: HTTP 400 "Invalid MAP_KEY.") becomes a 502 without leaking the key. Added to X19: the `/nrt` cache counts entries, not memory (up to 32 answers of maybe ~100 MB each on a 1 GB API). FIRMS stopped S-NPP on Nov 2; X13 stops asking for it. Merged `main` into PR #19.
- Next: review PR #20 (X7 OpenAPI + contract 1.1 proposals), adding the 1.1 items from the PR #1–#19 reviews.
- Broken / blocked: nothing.

### Nov 3 — Hamza (19)
- Did: reviewed PR #18 (`docs/reviews/pr-18-x5-fetch.md`). No code fixes: the real problems (NOAA-20's country files are `viirs-jpss1`, which I confirmed against FIRMS; NOAA-21 has none; the current year has none yet) are already fixed by X13. Added to X16: a rerun of `fetch api` after FIRMS extends its standard data leaves old NRT and new standard files for the same days. Merged `main` into PR #18.
- Next: review PR #19 (X6 `/nrt`).
- Broken / blocked: nothing.

### Nov 3 — Hamza (18)
- Did: reviewed PR #17 (`docs/reviews/pr-17-x4-mock-fidelity.md`). The new layout works end to end on the full mock: all 875,820 rows ingest, NRT rows have no type, and the static mask keeps static sources out of the NRT months. Fixed `firms-research.md`: standard MODIS files say version 6.2 (real files, PR #8 review), not 6.1. X16 now notes that the mock has no standard/NRT overlap to test it with. Merged `main` into PR #17.
- Next: review PR #18 (X5 FIRMS download tool).
- Broken / blocked: nothing.

### Nov 3 — Hamza (17)
- Did: reviewed PR #16 (`docs/reviews/pr-16-x3-demo-cache.md`). No code fixes: the cache builds on the full mock (310 months of stats per region, complete default-month hotspots, 1.7 MB). Its bootstrap check for a bundle's own cache runs after the move, so it always deletes it; X9 (PR #27) already fixes that. Added a PR #24 check for what offline mode lacks. Merged `main` into PR #16.
- Next: review PR #17 (X4 mock fidelity).
- Broken / blocked: nothing.

### Nov 3 — Hamza (16)
- Did: reviewed PR #15 (`docs/reviews/pr-15-x2-deploy.md`). Fixed: the real data bundle could never install in the image. Bootstrap staged it next to the data folder, in `/app`, which belongs to root while the container runs as `app`, so setting `ALMATAFI_DATA_URL` on Nov 13 would have stopped the container at start-up (reproduced as an unprivileged user). It now stages inside the data folder. Added a PR #34 check: the start-up download vs the VPS unit's time limits. Merged `main` into PR #15.
- Next: Khalid looks at the bootstrap fix; review PR #16 (X3 demo-region cache).
- Broken / blocked: nothing.

### Nov 3 — Hamza (15)
- Did: reviewed PR #14 (`docs/reviews/pr-14-x1-ci.md`). Fixed: every job ran twice for a branch with an open PR (push + pull_request; ~16 billed minutes per push at the top of the stack, on a private repo's limited Actions minutes). Tests now run on PRs, pushes to `main` (the deploy still waits for them) and by hand; the test token is read-only. Merged `main` into PR #14.
- Next: Khalid looks at the workflow change; review PR #15 (X2 backend deploy setup). From now on `pipeline/uv.lock` and `backend/uv.lock` are tracked.
- Broken / blocked: nothing.

### Nov 3 — Hamza (14)
- Did: reviewed PR #13 (`docs/reviews/pr-13-b3c-admin.md`) with real geoBoundaries downloads (Egypt ADM1: 27 areas; Argentina ADM2: 525 areas, 5.1 MB; unknown countries give 404). Fixed: a polygon with a spike lost its whole outline in `/search` and `/admin` after `make_valid`. Added a PR #24 check: a share link with an admin area on a server without that country cached. Merged `main` into PR #13.
- Next: Khalid looks at the `geometry.py` fix; review PR #14 (X1 CI).
- Broken / blocked: nothing.

### Nov 3 — Hamza (13)
- Did: reviewed PR #12 (`docs/reviews/pr-12-b3b-search.md`), with a few real Nominatim answers. Fixed: places across 180° (Fiji, Chukotka) got a world-wide bbox, now the small crossing one; names came back in the local script ("كفر الشيخ"), now English. A polygon with a spike loses its whole geometry after `make_valid`; that gets fixed in the PR #13 review, where the code moves. Merged `main` into PR #12.
- Next: Khalid looks at the `search.py` fixes; review PR #13 (B3c `/admin`). Hamza: at PR #23, check the map fits a bbox with west > east.
- Broken / blocked: nothing. Nominatim answers 429 after about ten quick requests from one IP, so the 1 request/s limit matters.

### Nov 3 — Hamza (12)
- Did: reviewed PR #11 (`docs/reviews/pr-11-b3a-export.md`). Exports check out on the full mock: grid CSV totals match `/calendar`, every GeoTIFF pixel matches the CSV, hotspot exports match `/hotspots`. Fixed: a GeoTIFF at the old 30M-pixel cap took +640 MB on an API capped at 1 GB; the cap is now 10M (+250 MB). Big hotspot exports (~400 MB at 200k points) added to X19. Merged `main` into PR #11.
- Next: Khalid looks at the cap change; review PR #12 (B3b `/search`).
- Broken / blocked: nothing.

### Nov 3 — Hamza (11)
- Did: reviewed PR #10 (`docs/reviews/pr-10-h3-validation.md`). Fixed: the break test's raw join added Terra and Aqua together, unlike the app's raw MODIS view, so it showed a 2.9× jump at 2012 instead of 4.6× (against the true fires: 3.2–14.8× per region, not 1.7–11.6×); an R² of exactly 0 counted as missing in the model choice. X22 updated: the model choice only scores Aqua → S-NPP; PR #10's M0 gets the Delta's Terra-era total right (0.95) but half its Terra months are 0, and the top of the stack's M3 gives 0.71. Leave-one-year-out run time added to X18. Merged `main` into PR #10.
- Next: Khalid looks at the `validate.py` fix; review PR #11 (B3a `/export` + `/validation`).
- Broken / blocked: nothing.

### Nov 3 — Hamza (10)
- Did: reviewed PR #9 (`docs/reviews/pr-09-h2-models.md`). No code fixes needed; the models, mass factor, leave-one-year-out and product match the contract. Compared the harmonized output with the mock's true fires per era: the 2012 break is fine, but the Nile Delta's Terra-only months come out at about half to 0.7 of their true level, so the series steps up in July 2002 (X22, before Nov 13). Merged `main` into PR #9.
- Next: Khalid adds the July 2002 check to validation; Hamza marks Terra-only months in the calendar; review PR #10 (H3 validation + automatic model choice).
- Broken / blocked: nothing.

### Nov 3 — Hamza (9)
- Did: reviewed PR #8 (`docs/reviews/pr-08-h1-align.md`). No code fixes needed. Found that small builds lose most quiet months from the fits because coverage comes from the build's own detections (X21, before Nov 13). Harmonize memory added to X18. PR #1 finding #17 answered: January 2012 is converted Aqua. Checked real FIRMS files (most of F2): MODIS 2010 for Egypt, Argentina and Chile (71,180 rows) and VIIRS 2019 for Egypt (67,424 rows) ingest with nothing dropped; NOAA-20 starts 2018-04-01 as `platforms.py` says; MODIS coordinates have up to 4 decimals like the mock. Merged `main` into PR #8.
- Next: Khalid confirms F2 and picks up X21; review PR #9 (H2 conversion models + harmonized product).
- Broken / blocked: nothing. Note: 70% of Egypt's 2019 VIIRS detections are static sources (type 2), so the static mask matters a lot for the Nile Delta live layer, which has no type.

### Nov 3 — Hamza (8)
- Did: reviewed PR #7 (9 findings, `docs/reviews/pr-07-b2-endpoints.md`). No code fixes needed here: three contract gaps (status with fewer than 3 baseline years, raw MODIS adding Terra and Aqua, calendar vs hotspots counting different satellites) are already fixed by X13 (PR #31). Added the hotspot filter's fixed MODIS threshold and the SQL data paths to the open-items line. PR #1 finding #20 answered. The calendar query takes ~0.6 s on one CPU over a 100M-row grid. Merged `main` into PR #7.
- Next: review PR #8 (H1 overpass alignment + strata) and check PR #1 finding #17 (January 2012) there.
- Broken / blocked: nothing.

### Nov 3 — Hamza (7)
- Did: reviewed PR #6 (13 findings, `docs/reviews/pr-06-b1-api.md`). Fixed: a circle around a pole keeps its true size (500 km at 86°N measured 3.6× too big as a polar cap); a shape in parts on both sides of 180° (Fiji, the Aleutians) gets a small crossing bbox, not a world-wide one; a JSON syntax error no longer names field "1"; 405 keeps the `Allow` header. PR #1 finding #7 confirmed and kept as the contract rule. Added X19 (API hardening: request-size limit, slow small-area fallback, plain-text 500s without CORS) and X20 (show the area small-area counts cover) to the Board, plus one line with the open items from the PR #1–#6 reviews. Merged `main` into PR #6.
- Next: Khalid looks at the fixes in his area and picks up X19; review PR #7 (B2 `/calendar`, `/stats`, `/hotspots`) and check the `series.py` SQL paths there.
- Broken / blocked: nothing.

### Nov 3 — Hamza (with Claude) (2)
- Did: fixed the globe flickering while scrolling (landing and Method pages). Single frames went fully black: the Earth shader's rim took `pow()` of `1 - dot(N, V)`, which rounds a hair below 0 where the globe faces the camera; on Apple GPUs that is NaN, and the bloom pass spreads one NaN pixel over the whole frame. Clamped it (`frontend/lib/orbit/shaders.ts`, one line, commit 91c156a on PR #34 since `main` doesn't have the globe yet). Measured on the live site while scrolling: 19 black frames in 1,249 before, 0 in 1,812 after. Not a deploy or VPS problem.
- Next: Khalid, this touches X15's shader; it reaches `main` with PR #34.
- Broken / blocked: nothing.

### Nov 3 — Hamza (6)
- Did: reviewed PR #5 (10 findings, `docs/reviews/pr-05-d3-grid.md`). Fixed: `data_version` picks the newest build by date (it picked `nrt-…` over a newer `archive-…`); folder names can't break the SQL; the grid records its MODIS confidence threshold; report and grid share one filter; the report and CLI warn about partly observed platform-months (96 on the full mock). Grid output is identical to before. X18 now also covers the grid's memory. Merged `main` into PR #5.
- Next: Khalid looks at the fixes in his area; add the static-mask limitation to the Method page (PR #26); review PR #6 (B1 API skeleton + AOI parsing).
- Broken / blocked: nothing.

### Nov 3 — Hamza (5)
- Did: I1, PR #34. Live: frontend https://almatafi.monitorthesituations.com (Cloudflare Workers, static export; backup almatafi.hamzaosama5645.workers.dev), API https://almatafi-api.monitorthesituations.com (Hamza's VPS, rootless Podman under its own user `almatafi`, Cloudflare Tunnel, no open ports, 1 GB/1 CPU caps). `.github/workflows/deploy.yml`: after `tests` passes on `main`, the API image goes to GHCR and the VPS picks it up within 5 min (rolls back if `/api/health` fails, tested); the frontend deploys with wrangler. Headless Chrome check on the live site 18/18 (calendar, stats, map, exports, share links, offline copy). `deploy/README.md` has the commands. Hamza added to Roles.
- Next: remove the temporary `push: hamza/i1-deploy` trigger in `deploy.yml` before merging. On Nov 13 (R2/R3): real data bundle via `ALMATAFI_DATA_URL` in the VPS's `api.env`; it re-downloads on every container recreate, so decide on a data volume then. `render.yaml` is unused now.
- Broken / blocked: nothing now. The Cloudflare secrets are in and both deploy jobs pass (the token's expiry window started in Feb 2027 at first; fixed). About 3 min of API downtime during setup while fixing rollback (pod → network) and the health check; the offline copy covered the demo regions.

### Nov 3 — Hamza (4)
- Did: reviewed PR #4 (10 findings, `docs/reviews/pr-04-d2-ingest.md`). Fixed: a second file for the same year no longer deletes the first one's points (merged, archive copy wins over NRT); platform end dates, non-finite values and `instrument` are checked; `point_id` text no longer depends on pandas iteration; the re-run test now tests something. Added X18 (ingest memory) to the Board. Merged `main` into PR #4.
- Next: Khalid looks at the fixes in his area; review PR #5 (D3 grid).
- Broken / blocked: nothing.

### Nov 3 — Hamza (3)
- Did: reviewed PR #3 (14 findings, `docs/reviews/pr-03-d1-mock.md`). Fixed three crashes (`--end` before 2016, before 2012, before Nov 2000), stale CSVs surviving a rerun, messy fault counts and spelling variants; added a planted-event check (`almatafi/mock/checks.py`) that warns when a seed loses the demo story. The default output stays byte-identical except the two messy files. firms-input 1.0.1 fixes the generator path. Merged `main` into PR #3.
- Next: Khalid OKs firms-input 1.0.1; Khalid looks at the fixes in his area (`pipeline/`); review PR #4 (D2 ingest).
- Broken / blocked: nothing.

### Nov 3 — Hamza (2)
- Did: reviewed PR #2 (13 findings, `docs/reviews/pr-02-f4-cell-id.md`). Finding #16 was real: the Python scalar `cell_id` rounded differently from `cell_ids` and `grid.ts` within ~5e-11° below a cell edge. Fixed, and grid contract 1.0.2 spells out the exact rounding steps. Also: whole-number checks for cell ids, rows and months, `Bounds` named tuple, near-edge test vectors. Merged `main` into PR #2.
- Next: Khalid OKs grid 1.0.2; review PR #3 (D1 mock generator).
- Broken / blocked: nothing. Note: the ID X15 is used twice: for the contract 1.0.1 fixes (Board, Done) and by the branch `khalid/x15-cinematic-ui`. Rename one.

### Nov 3 — Hamza
- Did: reviewed PR #1 (two passes, ~28 findings, each checked against the code at the top of the stack). Merged `main` into PR #1 to fix the TEAM.md conflict. X15: contract 1.0.1 fixes the wrong worked examples and brings the text in line with what the code already does. Added X16 and X17 to the Board. Wrote `docs/reviews/pr-01-f1-contracts.md` with the findings still to check, by PR.
- Next: Khalid OKs the contract change; review PR #2 (F4 `cell_id`) and check finding #16 (Python vs TS rounding) there.
- Broken / blocked: nothing. Note: the stack's later PRs don't include `contracts/*.md` (PR #2 was branched from `main`, not PR #1), but nothing conflicts.

### Nov 3 — Khalid (32)
- Did: X15, Phase 5 UI polish started early because Khalid asked for it ("change all that UI with the help of Higgsfield": the fire planet, scroll interactivity, 3D models). The Oct 31 decision said polish waits for real data; that call is now Khalid's, so it is noted here, not changed in Decisions.
  - **Globe:** a new three.js scene replaces globe.gl. A shader Earth (GIBS Blue Marble NG day, VIIRS Black Marble night, clouds, water glint, terminator, atmosphere) with bloom. The fires are **one real FIRMS week** (27 Oct to 3 Nov 2026, the public NRT 7-day files, cleaned like the pipeline): MODIS 58,127 vs VIIRS NOAA-20 300,095 detections (5.16×), Nile Delta 7 vs 88. City lights stay faint and cool so warm glows always mean fire. `scripts/globe-fires.mjs` rebuilds it; `lib/fires.test.ts` checks it against the printed numbers.
  - **3D models:** Aqua and Suomi NPP from NASA 3D Resources (meshopt + WebP, 0.65 MB), on sun-synchronous orbits with scanning swaths that light up the fires under them. Terra's NASA model points to texture files that aren't published, so it is left out.
  - **Landing story:** a sticky stage under 8 chapters. Hero, the week, a tracking shot on Aqua (MODIS), then Suomi NPP (VIIRS), the 2012 jump, the Delta. Then a scroll-scrubbed Higgsfield film dives from orbit into the Delta's straw fires and flies through the smoke into the light sections: steps with the Delta's mini calendar, the proof chart drawn on scroll, case films, portraits, FAQ, closing band.
  - **Method:** the camera tracks Aqua, then Suomi NPP; drawings for pixel size, the MODIS detection floor and overpass times; scroll reveals.
  - **Explorer:** restyled only (glass toolbar, the answer over a faint scene of the place, softer panels, glow on the heaviest months); behaviour unchanged.
  - **Transitions:** every site button leaves through the smoke and the next page clears out of it (no wipes). Lenis smooth scroll + GSAP reveals on the story pages.
  - **Higgsfield:** 8 Soul Cinema stills, a Kling 3.0 first/last-frame dive, 3 Kling 2.5 loops, **$1.42** of a $5 cap (`design/higgsfield/`). Every generated scene and portrait is labelled on the page, and the FAQ says what is real.
  - Reduced motion and no-WebGL get still images; numbers are in the HTML. 60 fps headless; the scene drops resolution by itself when frames are slow. Checked at 1440 px and 390 px. 41 frontend tests, build clean.
- Next: partner, this rewrites your area again; change anything you don't like. On Nov 13 rerun `node scripts/globe-fires.mjs` for a fresh week before the demo.
- Broken / blocked: the backend wasn't running here (port 8000 is taken by another app), so the explorer was checked on the offline demo copy only.

### Nov 3 — Khalid (31)
- Did: X14, harmonization v2, after a literature review (sources in `docs/method.md` §8).
  - **No paper builds the record we need.** None of them makes a harmonized MODIS + VIIRS *count* record from 2000 to now. The closest work is GFED5/GFED5NRT and Zheng 2026, so v2 combines their pieces. Our validation (leave one year out, Pettitt) is already stricter than what those papers report.
  - **MODIS detection floor:** the grid now splits VIIRS at the fire power MODIS needs, 4.44A + 0.52 MW by day and 4.43A + 1.01 MW by night (Sofiev and Kouznetsov 2026), tested on fire clusters because VIIRS shares a fire's FRP over its pixels.
  - **New model M3:** fires above the floor convert from MODIS by a ratio; fires below it come from each cell's own VIIRS record, scaled by the year's activity in its tile. On mock it wins leave one year out on 10° tiles (R² 0.976 vs 0.974) and clearly at 1° (0.968 vs 0.955). It also removes the Nile Delta's false zero months before 2012 (17 to 0), so small areas no longer look patchy.
  - **S-NPP has stopped (Nov 2):** NOAA-20, then NOAA-21, fill S-NPP gaps, so the record continues. New `noaa21_to_snpp` step; VIIRS to VIIRS steps are plain ratios.
  - **Calibration windows:** Aqua to S-NPP on 2012 to 2022 (Aqua's orbit drifts after), Terra to Aqua on 2003 to 2011.
  - **More validation:** 1° scores, placebo break years inside each era (0.85× to 1.08×, so 2012's 1.03× is ordinary), and the season's shape before and after 2012.
  - Method page, `docs/method.md`, `docs/submission.md` and the offline cache updated. 174 pipeline, 200 backend, 39 frontend tests.
  - An independent review of the v2 code found 5 issues, all fixed: placebo windows crossed 2012 (so they couldn't detect a step), months with no MODIS rows lost their small fires, M3 crashed with no overlap, climatology rows were counted as fallbacks, and a baseline caveat (now in method.md §7).
- Next: everything left needs Khalid's accounts (I1) or the real data (R1 to R6). On Nov 13, check that M3 still wins on real data, and check the floor coefficients against the final GMD paper.
- Broken / blocked: not done, and noted in method.md: cloud correction (needs MOD14CMQ), land cover strata (needs MCD12Q1), exact duplicate removal (FIRMS times are to the minute).

### Nov 3 — Khalid (30)
- Did: X13. An independent read-only review of `pipeline/` and `backend/` found 8 real bugs (each reproduced); all fixed with tests.
  - **Real download (high):** NOAA-20's country files are `viirs-jpss1` on FIRMS, so we would have downloaded no NOAA-20 at all. NOAA-21 and the current year have no country files, so most of 2026 was never fetched. `fetch api --country EGY` now gets this year's standard data, all of NOAA-21 and the NRT tail per country; a country with no file at all fails the run.
  - **Fake "below normal" (high):** harmonized months that no satellite observed came back as 0. The harmonize build writes `month_origins`; those months are now null, and `/stats` refuses them.
  - **NRT leaks:** volcano (type 1) and offshore (type 3) cells weren't masked, so they counted as fires in NRT months.
  - **Hotspot count vs calendar:** the panel said 1,756 hotspots while the calendar said 589, because 5 satellites see the same fires. `/hotspots` has a `platforms` filter and `by_platform` counts; the map now shows the calendar's satellite by default (589 = 589), with the others one click away.
  - **Raw MODIS doubling:** Terra + Aqua were added, so raw MODIS doubled in July 2002. Raw views now use one satellite per month.
  - **Smaller ones:** no status with fewer than 3 baseline years; holes across 180° line up with their shell (and drawn shapes wider than 180° keep their shape); live hotspots switch to NRT at each source's own standard end.
- **S-NPP has stopped:** the FIRMS FAQ says new S-NPP data ceased on Nov 2, 2026. Raw VIIRS uses NOAA-20 after October 2026, live requests skip S-NPP, and X14 handles it in the harmonization.
- 200 backend, 169 pipeline, 39 frontend tests. Contract notes in `contracts/CHANGES-1.1.md`.
- Next: X14 harmonization v2.
- Broken / blocked: the real fetch now needs about 600 API requests per country (roughly 30 minutes for three).

### Nov 3 — Khalid (29)
- Did: X12, because Khalid found the explorer hard to use.
  - **Answer first:** the top of the page is one sentence ("October 2026: 589 hotspots. Unusually high: 2.5 times a typical October, and the most for October in 26 years."), a strip with the same month in every past year, then typical value, usual range, rank, percentile, z and trend. The wording lives in `lib/verdict.ts` with 8 tests.
  - **Toolbar:** the three form panels became one row: an area menu (demo areas, search, box, point, admin), years, Harmonized/MODIS/VIIRS and Hotspots/Fire days as segmented buttons, and a Download menu.
  - **Calendar beside the map**, and a new chart of yearly raw MODIS, raw VIIRS and harmonized totals for the chosen area, so the 2012 jump shows for that place.
  - **Map fix:** CARTO's raster tiles now return an "API key required" image (the black map Khalid saw). The base is now OpenFreeMap's dark vector style (OpenStreetMap, no key) with a plain fallback; NASA Blue Marble is a toggle under the labels.
  - **Look:** warm ash surfaces, an ember ramp for fire, one cool colour for the sensor and the selection; Archivo for all text. Landing and Method pick up the same tokens.
  - Checked at 1440 px and 390 px. 36 frontend tests.
- Next: X13 bug fixes, X14 harmonization v2.
- Broken / blocked: partner, this rewrites your area again; change anything you don't like.

### Nov 3 — Khalid (28)
- Did: X11. An independent read-only review of the frontend found 10 real bugs; all are fixed.
  - **Months the backend refuses:** "To = this year" sent YYYY-12, and "From = 2000" sent 2000-01; both got a 422.
  - **Link restore:** it merged onto stale state after client-side navigation.
  - **Missing outlines:** demo regions had no outline offline, and shared admin links never showed their area (links now carry country + level).
  - **Malformed links:** a bad `shape=` crashed the page; it's now validated.
  - **Tile loader:** it slept after the last try and held slots after an abort.
  - **Keyboard:** calendar arrow keys stopped at "not observed" months.
  - **Radius limit:** the form allowed up to 2,000 km; the backend allows 1 to 500.
  - **The 180° line:** shapes crossing it zoomed out to the whole world.
  - **Two minor ones:** a failed offline-copy fetch was never retried, and the admin label used the wrong country.
  - Checked live: the bad link renders the defaults, and offline Río Negro gets its outline and map. 28 frontend tests.
- Next: everything left needs Khalid's accounts (I1) or the real data (R1–R6).

### Nov 3 — Khalid (27)
- Did: X10, the PLAN §12 MVP item "hotspot dots for demo regions and on-demand elsewhere".
  - `/api/hotspots` and hotspot exports fall back to the FIRMS area API when an area has no stored points (span ≤ 31 days, key set). FIRMS's `data_availability` decides standard vs NRT per day; no request goes out for satellites not yet flying, and each row is labelled `archive`/`nrt`. The response says `on_demand: true`, and the explorer shows "Fetched live from NASA FIRMS".
  - Reuses X6's protections (budget, box cap, byte cap, key never logged). Tested on a fake FIRMS only. 192 backend tests pass.
- Next: nothing more before Nov 13 without Khalid's accounts or real data.
- Broken / blocked: a month elsewhere costs about 28 FIRMS transactions; fine for the demo (our budget is 1,000 per 10 min).

### Nov 3 — Khalid (26)
- Did: X9.
  - **One script:** `scripts/build-data.sh mock|real [--fetch]` does the whole build: fetch, ingest, grid, harmonize, validate, admin, demo cache, `frontend/public/cache/`, and a bundle with its SHA-256. The mock run takes 35 s. The real path was rehearsed on copies of the mock files, and its bundle installs through the backend's bootstrap.
  - **Runbook:** `docs/runbook.md` covers Nov 13 step by step.
- Found and fixed two real problems on the way:
  - **Mixed sources:** a real download mixes standard and NRT files for the same year, and ingest labelled a whole run with one `source`. Running them separately would have overwritten year partitions. Ingest now has `--source auto` (the default for non-mock files), which labels each row `nrt` or `archive` from its FIRMS version string.
  - **Bootstrap cache:** it moved a real bundle's `cache/` into place and then deleted it as "missing" (from X3). It now checks before moving; there's a regression test, which fails without the fix.
  - 187 backend + 165 pipeline tests pass.
- Next: nothing left before Nov 13 that doesn't need Khalid's accounts (I1 deploy) or real data (R1–R6).
- Broken / blocked: the Mac had only 1.4 GB free at one point. I deleted my own temp files (now ~4 GB free); the disk needs space before the real download.

### Nov 3 — Khalid (25)
- Did: X8.
  - `docs/submission.md` drafts the Space Apps project page (title, summary, details, NASA data used, AI disclosure, links), the 7 slides and the 30 second video, matching the Cairo rules (30 s video or exactly 7 slides, local form first).
  - `docs/method.md` is the full method, mock numbers marked, ready for R6 to swap in the real ones.
  - `docs/registration.md` on main is now short and plain.
- Next: X9, a Nov 13 runbook with one script that runs fetch → ingest → grid → harmonize → cache → bundle, tested end to end on mock.
- Broken / blocked: every `[real]` in submission.md waits for R2.

### Nov 3 — Khalid (24)
- Did: U6.
  - **Landing page** (mockup + PLAN §14.1):
    - Hero with a globe.gl 3D globe over NASA Blue Marble (texture from GIBS in `public/img/`), showing the demo regions' real hotspots; it turns slowly unless reduced motion is on, and has a fallback without WebGL.
    - "The problem" with the raw vs harmonized chart from `validation.json`.
    - Three steps, the Río Negro case study and the Nile Delta story (each opens the explorer on its month), who it's for, and an FAQ.
  - **Method page:** the three fixes, the pipeline, the validation numbers (R², break test, Pettitt), the series chart, the MODIS-vs-VIIRS scatter, the models table, the mock-truth table, the formulas, limits and sources.
  - **Numbers in the HTML:** both pages read `public/cache/validation.json` at build time (PLAN §14.2), and say "mock data" until the data version is real.
  - Checked at 1440 px and 390 px.
- Next: I1 (deploy) needs Khalid's accounts (Render for the backend, Vercel for the frontend). Every pre-Nov 13 frontend task is in review.
- Broken / blocked: the landing and method numbers come from mock data until `public/cache/` is rebuilt from real data.

### Nov 3 — Khalid (23)
- Did: U5.
  - **Exports:** buttons in the top bar for the selected month's hotspots (CSV, GeoJSON), its 0.1° grid as a COG GeoTIFF, and the whole calendar as CSV, through `/api/export`.
  - **Share:** copies a link; the URL always holds the area, month, view, metric and years (`?region=rio-negro&month=2026-07&view=viirs`), and junk in a link is ignored.
  - **Offline fallback:** when the backend is down or asleep, the demo regions answer from `public/cache/` (a committed copy of the backend's demo cache) with a clear banner.
  - **Checked live:** shared-link restore, offline mode with the backend stopped, and all four exports (200, right content types). 24 frontend tests.
- Next: U6 landing page (globe) + Method page.
- Broken / blocked: `frontend/public/cache/` holds mock numbers; rerun `python -m app.cache` + `npm run cache` on real data before the demo.

### Nov 3 — Khalid (22)
- Did: U2.
  - **Map:** MapLibre with NASA GIBS Blue Marble imagery and GIBS place labels (no key), over a CARTO dark basemap that shows wherever a GIBS tile is slow.
  - **Hotspots and area:** the selected month's hotspots are sized and coloured by FRP; click one for its details. The area's outline is drawn and the map opens on it.
  - **Drawing:** Terra Draw polygon and box tools; a finished drawing becomes the AOI.
  - **Place search:** through `/api/search`. A place with an outline becomes a polygon AOI, a point becomes a 25 km circle.
  - **Checked live:** Río Negro Jul 2026 shows 231 detections, unusual_high, z +14.1.
- Fixes found while testing:
  - MapLibre's web worker didn't load under Turbopack; it's now served from `public/` and copied before dev/build.
  - GIBS answers 500 for empty label tiles and sometimes for imagery under load. Tiles now go through a small loader: at most 4 fetches at a time, with retries and a transparent fallback.
  - The map opens straight on the area, so no tiles are thrown away by a zoom animation.
- Next: U5 (exports, share URL, offline fallback), then U6 (landing + method).
- Broken / blocked: headless Chrome's software WebGL doesn't draw raster tiles reliably; screenshots need `--use-angle=metal`. In a normal browser it's fine.

### Nov 3 — Khalid (21)
- Did: U1 + U3 + U4 (explorer core), on the real API with mock data.
  - `/explore` has the mockup's layout: demo-region pills; area panel (box, lat/lon + radius, admin areas through `/api/admin`); year range; harmonized/raw view with the raw-data warning; detections/fire days.
  - The burning calendar is a grid of real buttons (arrow keys move, every cell has a spoken label with value and origin). It has the mockup's lightness-ordered ramp, "not observed" cells, a partial-month marker, year totals and month medians.
  - The stats panel shows count, status, median, mean ± sd, z, rank, percentile, baseline, trend and the coarse-area warning. The hotspot panel shows the month's total and the strongest fires to pick from.
  - One shared zustand selection links everything; TanStack Query caches each request.
  - Checked at 1440 px and a true 390 px phone width. 16 frontend tests.
- Next: U2 map (MapLibre + NASA GIBS imagery, hotspot dots, Terra Draw polygon/box, place search).
- Broken / blocked: headless Chrome on macOS can't go below 500 px, so phone screenshots must load the page in a 390 px iframe.

### Nov 3 — Khalid (20)
- Did: F3 frontend skeleton, since Khalid asked me to start the frontend. Next.js 16 (App Router) + TypeScript in `frontend/`, with the mockup's fonts and colour tokens in plain CSS, a shared nav and footer, and stub pages for `/`, `/explore`, `/method`. `lib/api.ts` is a typed client: request types are generated from `contracts/openapi.json` (`npm run gen:api`), response types are written from api.md, and errors use the api.md error shape. CI's `grid-ts` job became a `frontend` job: npm ci, API types up to date, lint, typecheck, tests (12), build.
- Next: U1/U3/U4 explorer core (shared state, burning calendar, stats, hotspot details), then U2 map, U5, U6.
- Broken / blocked: partner, the frontend is your area; I'm building it because Khalid asked. Take over or rewrite anything.

### Nov 3 — Khalid (19)
- Did: X7. `contracts/openapi.json` is generated from the backend (`python -m app.openapi`), and a test fails when it's stale. `contracts/CHANGES-1.1.md` lists every point where the code goes beyond or differs from the 1.0 contracts (21 items, with checkboxes) for us to agree on together. 182 backend tests pass.
- Next: frontend (Khalid's go-ahead): F3 Next.js skeleton, then U1–U6.
- Broken / blocked: CHANGES-1.1 needs both of us before it goes into the contract files.

### Nov 3 — Khalid (18)
- Did: X6 (R4 early). `POST /api/nrt` returns the last 1–10 days of hotspots for any AOI ≤ 500k km², live from the FIRMS area API (5-day requests, all NRT sources), as the same GeoJSON as `/hotspots`. Rows go through the pipeline's `clean()` and the grid filter, so live points match archive points. 15-minute cache, our own transaction budget (1,000 per 10 min), clear 502/503 errors, and the MAP_KEY never reaches a response or a log. Also made `/hotspots` features always print UTC times (a local-timezone DuckDB connection would have shifted them by 2 hours in Cairo). Tested against a fake FIRMS only. 180 backend tests pass.
- Next: X7 OpenAPI snapshot + contract 1.1 notes, then frontend (Khalid asked me to start it: U1–U6).
- Broken / blocked: needs a real MAP_KEY on the server to work (Render env var `FIRMS_MAP_KEY`).

### Nov 3 — Khalid (17)
- Did: X5. `python -m almatafi.fetch countries …` downloads the yearly country files (standard processing, no key). `… nrt --bbox …` fills the months after standard processing from the area API in 5-day requests, starting the day after `data_availability` says standard data ends, so nothing overlaps. Every file is checked (FIRMS header, 400 MB cap, FIRMS host over https only), written atomically, and logged with its SHA-256 in `manifest.json`. Reruns skip finished files; 429/5xx are retried; one bad file doesn't stop the run; the MAP_KEY never reaches logs, manifest or file names. Fetched files ingest as is (test). Tested on a fake FIRMS only, nothing downloaded. 164 pipeline tests pass.
- Next: X6 `/nrt`, X7 OpenAPI + contract 1.1 notes. On Nov 13: R1 is `fetch countries` for Egypt, Argentina, Chile, then `fetch nrt` for the demo bboxes.
- Broken / blocked: country names must be FIRMS's spelling (`United_States`); check the list on the first real run.

### Nov 3 — Khalid (16)
- Did: X4. Checked the real FIRMS formats online (API docs, the FIRMS API tutorial's real output, the yearly country file URLs); notes in `docs/firms-research.md`. The mock now looks like a real Nov 13 download: one folder per product (`modis`, `viirs-snpp`, `viirs-noaa20`, `viirs-noaa21`), and the last 4 months as NRT files (`{year}_nrt.csv`, versions `6.1NRT`/`2.0NRT`, no `type` column). NOAA-21 starts 2023-03-01 (FIRMS's date). New tests: NRT rows ingest with no fire type, and static sources stay out of the NRT months through the mask. Río Negro Jul 2026 is in the NRT part and is still flagged. 153 pipeline + 169 backend tests pass.
- Also: `docs/registration.md` on main has the Cairo registration answers. **Registration closes Sat Nov 7, 11:59 PM.** Read its "Risk" section: the guide forbids pre-completed projects.
- Next: X5 FIRMS download tool, X6 `/nrt`, X7 OpenAPI + contract 1.1 notes.
- Broken / blocked: `/nrt` days must be 1–5 (FIRMS changed it), not 1–10.

### Nov 2 — Khalid (15)
- Did: X3. `python -m app.cache` saves the real endpoint responses per demo region (6 calendars, `/stats` for all 310 months, the showcase month's hotspots) plus `validation.json` and an index in `data/cache/`: 1.7 MB, 8 s on mock. The Docker image builds it; a real data bundle without its own cache drops the mock one. Also fixed a security finding in X2 (bundle URL tokens kept out of logs) and made the image's data stage reuse the API environment, adding only matplotlib. 169 backend tests pass.
- Next: I1 with the partner: deploy the backend on Render (Khalid's account), frontend copies `data/cache/` to its public folder as the offline fallback. From Nov 13: R1–R6.
- Broken / blocked: nothing.

### Nov 2 — Khalid (14)
- Did: X2. `backend/Dockerfile` builds the API with the mock data set built in (healthy, non-root, ~120 MB of memory, 1.2 GB image). `render.yaml` is a Render blueprint (free, Frankfurt). `app/bootstrap.py` swaps in a real data bundle at start-up from `ALMATAFI_DATA_URL`, checksum first. CI now also builds and smoke-tests the image. matplotlib became an optional `plots` extra of the pipeline. 161 backend tests pass.
- Next: X3 demo-region cache. Not deployed: needs Khalid's Render account (New → Blueprint → this repo, then set the env vars).
- Broken / blocked: nothing.

### Nov 2 — Khalid (13)
- Did: X1. GitHub Actions runs the pipeline tests (150), backend tests (148) and the TypeScript grid test on every push and PR, on Python 3.12 with `uv.lock` lockfiles for both projects. All green on GitHub (about 1.5 min).
- Next: X2 backend deploy setup, X3 demo-region cache.
- Broken / blocked: nothing. Partner: when `frontend/` gets its Next.js app (F3), add a frontend job to `.github/workflows/tests.yml`.

### Nov 2 — Khalid (12)
- Did: B3c. `GET /api/admin` fetches geoBoundaries once per country and level, saves it under `data/admin/`, and makes every boundary usable as an admin AOI immediately. Downloads go only over https to geoBoundaries/GitHub hosts (redirects checked too), capped at 60 MB. Also fixed 4 security-review findings on B3a (GeoTIFF pixel cap, export point cap) and B3b (bounded simplification, rate-limit lock not held during I/O). Tested with fake servers only; nothing was downloaded. 148 backend + 150 pipeline tests pass.
- Next: every backend task before real data is done. Next up: I1 (connect the frontend, staging deploy) with the partner, then R1–R6 from Nov 13.
- Broken / blocked: before the demo, run `python -m app.admin EGY:1 ARG:1 CHL:1` once to prefetch the demo countries.

### Nov 2 — Khalid (11)
- Did: B3b. `GET /api/search` proxies Nominatim per its usage policy (identifying User-Agent, ≤ 1 request/s, 24 h cache), maps results to the api.md shape, simplifies polygons to ≤ 2,000 vertices, and turns failures into 502. Tested against a fake Nominatim only; no real requests were made. 124 backend tests pass.
- Next: B3c `/admin`.
- Broken / blocked: set `ALMATAFI_CONTACT` to a real email before the public demo (Nominatim asks for one).

### Nov 2 — Khalid (10)
- Did: B3a. `POST /api/export` (hotspots CSV/GeoJSON, calendar CSV/JSON, grid COG GeoTIFF/CSV with sum or monthly bands) and `GET /api/validation`. GeoTIFF pixels are exactly the 0.1° cells, and a test checks every pixel against the harmonized file. Calendar and grid exports add up to the `/calendar` numbers. 106 backend tests pass.
- Next: B3b `/search`, B3c `/admin`.
- Broken / blocked: GeoTIFF refuses AOIs crossing 180° (export each side).

### Nov 2 — Khalid (9)
- Did: H3. `validate.py` scores M0/M1/M2 by leave-one-year-out on tile × month totals and the build picks the best (M0 on mock, R² 0.976). It writes `validation.json` (contract §4), 4 charts and `validation.md`. Break test on mock: raw join 2.9× after 2012, harmonized 1.03×. Against the true fires per region: raw 1.7–11.6×, harmonized 0.97–1.02×. 150 pipeline + 90 backend tests pass.
- Next: B3 (`/export`, `/search`, `/admin`, `/validation`). Partner: U1–U6 can use the harmonized view now.
- Broken / blocked: nothing. Contract 1.1 additions: `validation.json` gets `unit_of_scoring`, `by_metric`, `mock_truth`.

### Nov 2 — Khalid (8)
- Did: H2. `python -m almatafi.harmonize` fits M0/M1/M2 per stratum, pass, step and metric, and writes `harmonized_monthly.parquet` and `models.parquet`, with a mass factor so converted totals keep the fires MODIS can't see. On mock, against the true fires: the raw stitched series jumps 1.9–12.6× at 2012, the harmonized one stays at 0.95–1.11× in all 6 regions. The backend's harmonized view works now: Río Negro Jul 2026 is z 6.7 against 25 baseline years. 141 pipeline tests pass.
- Next: H3 validation (leave-one-year-out by model, break test, plots), then pick the model automatically.
- Broken / blocked: default model is M1 until H3 picks by validation. `models.parquet` adds a `metric` column (contract 1.1).

### Nov 2 — Khalid (7)
- Did: H1. `almatafi/harmonize/align.py` decides which platform stands for each month (Terra → Aqua → S-NPP, NOAA-20 for S-NPP outages), lines the platforms up per cell-month, attaches the grid.md §6 strata with their fallback chain, and builds the overlap pairs for the three conversion steps. On mock: 18 Terra months, 115 Aqua, 175 S-NPP, and NOAA-20 fills exactly the planted Jul–Aug 2022 outage. 127 pipeline tests pass.
- Next: H2 conversion models, H3 validation.
- Broken / blocked: an outage is detected from coverage day counts. NOAA-20 must have observed ≥ 15% more of the month than S-NPP, because quiet days look like gaps on small areas.

### Nov 2 — Khalid (6)
- Did: B2. `/api/calendar`, `/api/stats`, `/api/hotspots` per api.md, on the mock grid and clean points. On mock: Río Negro Jul 2026 VIIRS = z 30.2, rank 1, unusual_high; Nile Delta Oct 2026 also unusual_high; Nile Delta October hotspots return in 0.06 s. 85 backend + 110 pipeline tests pass. Also fixed 2 security findings in B1's AOI parser (Infinity/NaN hang, unbounded cell scan) on PR #6.
- Next: H1/H2 must write `data/harmonized/harmonized_monthly.parquet` (with `covered_start`/`covered_end` metadata); until then the harmonized view answers 503. Frontend (U1–U4) can start calling the raw views now.
- Broken / blocked: choices the contract leaves open are listed in backend/README.md (raw fire_days across platforms, origin per month, partial-month day range). Agree on them when contracts go to 1.1.

### Nov 2 — Khalid (5)
- Did: B1. `backend/` FastAPI app with `/api/health`, `/api/regions`, the api.md error format, `meta`, CORS and settings. `app/aoi.py` turns all 5 AOI forms into one polygon with validation, geodesic area (whole Earth = 510.066M km², matches WGS84), cells by centre with the coarse fallback, antimeridian splitting and polar caps. 37 backend tests pass, and a real uvicorn run answers.
- Next: B2 `/calendar`, `/stats`, `/hotspots` on mock.
- Broken / blocked: admin AOIs read `data/admin/*.geojson`, which stays empty until B3 downloads geoBoundaries. AOI area uses the WGS84 ellipsoid, so one equator cell is 123.09 km² vs 123.64 km² in grid.md (sphere): expected, 0.4%.

### Nov 2 — Khalid (4)
- Did: D3. `python -m almatafi.grid` builds `grid_monthly`, `coverage` and `static_mask` with DuckDB (full mock: 775k points → 237k rows in 0.7 s). Finds the Delta's 2 static sources and shows the planted S-NPP outage (25/31 days in Jul 2022, 21/31 in Aug). MODIS threshold is a flag (30 vs 50). 110 tests pass.
- Next: B1 FastAPI skeleton + AOI parsing, B2 endpoints.
- Broken / blocked: coverage counts a day as observed when the platform has any hotspot anywhere. Correct for the global archive; on small areas (and the mock) quiet days look unobserved. Build coverage from global data in R3.

### Nov 2 — Khalid (3)
- Did: D2. `python -m almatafi.ingest FILES…` cleans FIRMS CSVs into GeoParquet points (`data/clean/sensor=…/year=…/`) and writes an ingest report. It reproduces the mock's `messy/expected_report.json` exactly, keeps all 875k clean mock rows (5 s), and geopandas reads the output as WGS84 points. 97 tests pass.
- Contract fixes to agree on (firms-input / data-products 1.1): `acq_datetime_utc` must be `timestamp[ms]` because Parquet has no seconds unit; a new drop key `bad_value` for unreadable confidence, brightness, scan, track or type; `point_id` text format pinned (shortest float text, ISO time with Z).
- Next: D3 grid (detections + fire_days, coverage, static mask).
- Broken / blocked: nothing. One run holds its input in memory, so the real global archive should be ingested one year at a time.

### Nov 2 — Khalid (2)
- Did: D1. `python -m almatafi.mock` writes 26 years of FIRMS-format CSVs for 6 regions (875k rows, 75 MB, 6 s), plus truth tables, messy test files with their expected ingest report, and a manifest. Planted: Río Negro Jul 2026 outbreak, Nile Delta Oct 2026 above normal, S-NPP outage Jul–Aug 2022. Same seed gives byte-identical files. Also `almatafi/platforms.py` (timelines + satellite spellings) for D2 to reuse. 47 tests pass.
- Next: D2 ingest → clean (target: reproduce `messy/expected_report.json` exactly), D3 grid.
- Broken / blocked: the mock lives in `pipeline/almatafi/mock/`, not `pipeline/mock/` as PLAN §11 sketches, so it can be imported and tested.

### Nov 2 — Khalid
- Did: F4. `pipeline/almatafi/cells.py` (cell id, centre, bounds, area, strata, plus a fast array version for pandas) and `frontend/lib/grid.ts` (same functions for the map). Both read the shared test vectors in `contracts/grid-test-vectors.json` and check every 5-decimal coordinate against exact integer maths. Python and TS agree on 2M random points.
- Run: `cd pipeline && uv run pytest` · `node --test frontend/lib/grid.test.ts` (Node 22.18+).
- Next: partner reviews the PR (especially where `grid.ts` sits in `frontend/`); then F3 skeleton, D1 mock generator.
- Broken / blocked: `uv` isn't installed on Khalid's Mac yet (`brew install uv`); tests were run in a plain venv.

### Nov 1 — Khalid
- Did: F1 data contract: `contracts/README.md`, `firms-input.md`, `grid.md` (cell_id + test vectors + strata), `data-products.md`, `api.md` (10 endpoints, AOI forms, errors, shareable URL).
- Next: partner reviews the PR; then F3 repo skeleton / F4 cell_id implementation.
- Broken / blocked: FIRMS column names and enum spellings are from the docs and still need checking on the first real file.

### Oct 31 — Khalid (3)
- Did: researched the 2025 Global Winners; added PLAN.md §14 (site structure, case study, deliverables, keep-alive rules) and the Cairo event dates (Nov 13–14).
- Next: F1 data contract, F3 repo skeleton.
- Broken / blocked: nothing.

### Oct 31 — Khalid (2)
- Did: wrote PLAN.md (full build plan, task IDs, timeline).
- Next: F1 data contract together, F3 repo skeleton.
- Broken / blocked: hackathon dates still unknown.

### Oct 31 — Khalid
- Did: created repo, README, this file.
- Next: agree on roles, then the data contract.
- Broken / blocked: nothing.
