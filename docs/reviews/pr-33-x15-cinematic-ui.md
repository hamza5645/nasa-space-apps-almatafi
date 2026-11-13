# Review of PR #33 (X15 cinematic UI: 3D orbit scene, landing story, Method header, explorer restyle)

Nov 3, 2026. One review pass. I loaded the built landing page in headless Chromium (software WebGL) against the backend on the rebuilt mock, with and without reduced motion, and compared with the top of the stack (`hamza/i1-deploy`). PR #34 adds Hamza's shader fix for black flicker frames on Apple GPUs (`lib/orbit/shaders.ts`).

No code changes in this PR. With `main` merged in, lint, typecheck, the 45 frontend tests and `next build` pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The landing page is heavy: 11.5 MB over 162 requests on a desktop first load. The largest are the 8K Earth texture (2.2 MB), the 4K clouds (1.3 MB), the Nile Delta video (0.9 MB), the real FIRMS week (0.75 MB), the main JS chunk (0.7 MB) and the Aqua model (0.5 MB). With reduced motion it's 2.8 MB. Phones get the 4K Earth texture (0.7 MB) instead of the 8K | Not changed: the 8K texture is only used on desktops ≥ 1100 px with a GPU that supports it. Worth a check on the venue's Wi-Fi before the demo |
| 2 | PLAN §2 keeps UI polish until the core works on real data | The team's call (the Board lists X15 as Phase 5, started early); nothing to fix |

Checked:
- **Browser:** no console errors in either mode, and the globe's WebGL canvases render. The globe is labelled "Every glow is a real detection: NASA FIRMS, 27 Oct to 3 Nov 2026".
- **Reduced motion:** `prefers-reduced-motion` is respected everywhere: smooth scrolling, the orbit scene, the warp links, the smoke transitions and the CSS animations.
- **Credentials:** the Higgsfield media script reads its credentials from the environment (`HF_KEY`); none are in the repo.
- **Explorer restyle:** the explorer keeps its behaviour, and its tests are unchanged.
- **Numbers:** the landing and Method numbers still come from the committed cache, rebuilt in the PR #32 review.
