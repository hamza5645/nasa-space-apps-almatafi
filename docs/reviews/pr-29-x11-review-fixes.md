# Review of PR #29 (X11 frontend fixes from an independent review)

Nov 3, 2026. One review pass over the nine fixes, compared with the top of the stack (`hamza/i1-deploy`), where these files keep the fixed versions.

No code changes in this PR. With `main` merged in, lint, typecheck, the 31 frontend tests and `next build` pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | `b64url` (share links) spreads every byte of the shape's JSON as a function argument (`String.fromCharCode(...bytes)`). A 2,000-vertex outline is ~48 KB, close to Safari's limit of about 65,000 arguments | Added to **X23**, which changes the same shape encoding anyway |

Checked and fine:
- **Share-link months:** they must be real months between 2001-01 and now, and `to` can't be before `from`.
- **Admin areas in links:** a link with an admin area carries its country and level (`ac`/`al`), so the outline can be fetched again. With the PR #24 retry change, the calendar also heals if it arrives before the country's download.
- **Radius limit:** the radius form now allows 1–500 km.
- **180° meridian:** shapes crossing 180° get a fit box with east > 180, not the whole world.
- **Calendar keys:** arrow keys step over not-observed months.
- **Map tiles:** the GIBS tile loader limits how many tiles load at once and retries.
- **Offline outlines:** offline mode still draws the region outlines.
