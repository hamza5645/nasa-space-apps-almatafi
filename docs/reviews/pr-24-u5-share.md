# Review of PR #24 (U5 exports, share link, offline fallback)

Nov 3, 2026. One review pass, compared with the top of the stack (`hamza/i1-deploy`), where the share link also carries an admin area's country and level, and the offline fallback covers stats and hotspots too. I measured share-link sizes with the top of the stack's own `encode` and checked Cloudflare's URL limit in its docs.

One fix in this PR (`lib/retry.ts`, from the PR #21 review), with a test. With `main` merged in, lint, typecheck and the 27 frontend tests pass.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | **Share links with a searched place's outline can be too long to open.** The outline goes into the URL as base64 JSON, and search results keep up to 2,000 vertices. Cloudflare, which serves the site, refuses URLs over 32 KB with 414. Measured with the tip's `encode`: 102 vertices (Kafr El Sheikh) 3 KB; 1,000 vertices 32 KB; 1,759 (Chukotka) 57 KB; 2,000 65 KB | Board **X23** (frontend, before the demo): encode the shape compactly (e.g. the polyline algorithm at 5 decimals, ~12 KB for 2,000 vertices), or put the place search in the link instead of its outline |
| 2 | Since the PR #21 review, 4xx answers aren't retried. But a share link with an admin area, opened on a server that hasn't cached that country, can send `/calendar` before `/api/admin` has fetched it, and that 404 would no longer heal by itself | **Fixed:** a 404 for an unknown `admin_id` is retried up to 3 times (1, 2, 4 s apart), enough for the country's download; test added. At this PR the link doesn't fetch the outline yet; from the top of the stack it does (`ac`/`al` in the link) |
| 3 | Carried over from the PR #16 review: offline mode only has the harmonized stats (default baseline) and the default month's hotspots | Fine: anything the copy lacks rethrows the original error, so the page says the server can't be reached instead of showing blanks. Board item removed |

Checked and fine:
- **Downloads:** they `POST` JSON and show the backend's own error message (e.g. the GeoTIFF size cap), and the blob URL is freed afterwards.
- **Share link:**
  - only non-default settings go in the link;
  - the decoder ignores anything malformed (ids by pattern, numbers must be finite, shapes through `validShape`);
  - the label is cut to 120 characters and shown as text.
- **Offline fallback:** used only for demo regions, and only on an outage (network error or 5xx); a failed copy is fetched again next time.
