# Review of PR #21 (F3 frontend skeleton: Next.js 16 and the typed API client)

Nov 3, 2026. One review pass, compared with the top of the stack (`hamza/i1-deploy`), where most of these files grow into the explorer, landing and Method pages. The skeleton's lasting pieces are the API client, the query provider and the CI job, so those are what I checked.

One small fix in this PR, with tests. With `main` merged in, lint, typecheck, the 14 frontend tests and `next build` pass, and the generated API types match the snapshot.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Every failed query is retried once (`retry: 1`), including 4xx answers: an area that's too large (422), an unknown region (404) or a month out of range. Those can't change on a second try, and a refused big calendar does the slow backend work twice. The top of the stack still has `retry: 1` | **Fixed:** `lib/retry.ts` (`shouldRetry`): no retry for 4xx, one retry for network errors and 5xx; tests added |
| 2 | The README says CI runs "on every push and pull request"; since the PR #14 review it runs on PRs and pushes to `main`. PR #34 adds a section right after that sentence, so changing it anywhere before then conflicts | Board (open items): change it at PR #34 |
| 3 | An aborted request (TanStack Query cancelling a query) turns into `ApiError("network")` ("Can't reach the server") | Not fixed: TanStack Query drops a cancelled query's error, and the one manual call (`PlaceSearch` at the top of the stack) doesn't abort |

Checked and fine:
- **API types:** request types are generated from `contracts/openapi.json`, and CI checks they're current.
- **Response types:** they match `api.md` and the backend's responses.
- **Errors:** `ApiError` carries the backend's `code`, `message` and `details`, and a non-JSON error body falls back to a generic message.
- **API URL:** `NEXT_PUBLIC_API_URL` has its trailing slash removed.
- **CI:** the frontend job runs `npm ci`, the type check against the snapshot, lint, typecheck, tests and the build.
- **`.gitignore`:** it now covers the pipeline outputs under `data/`.
