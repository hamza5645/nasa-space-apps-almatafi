# Review of PR #14 (X1 CI: GitHub Actions and lockfiles)

Nov 3, 2026. One review pass. I looked at the PR's runs on GitHub and the runs at the top of the stack (PR #34, where the workflow gains a frontend and a Docker job), and ran the three suites locally the way CI does (`uv run --locked`).

One fix in this PR (`.github/workflows/tests.yml`). Locally, with `main` merged in: 191 pipeline and 159 backend tests pass, and the TypeScript grid test passes; `uv lock --check` is clean for both projects.

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | Every job runs twice for a branch with an open PR: once for `push`, once for `pull_request` (6 check runs on PR #14, 10 on PR #34). At the top of the stack one run bills about 8 minutes (4 jobs, each rounded up to the minute), so each push costs ~16. Actions minutes on a private repo are limited (2,000 a month on the free plan), and the deploy waits for these tests on `main` | **Fixed:** `push` runs only on `main` (the deploy's `workflow_run` still sees them); every PR still runs through `pull_request`; `workflow_dispatch` added for runs by hand |
| 2 | The workflow didn't set `permissions`, so test jobs got the repo's default token (read/write on older repos) | **Fixed:** `contents: read` |
| 3 | The README says CI runs "on every push and pull request" | Not changed here: the README line changes in later PRs, so editing it would conflict. Board (after the stack merges): fix the sentence |
| 4 | Actions are pinned by tag (`checkout@v7`, `setup-uv@v10.3.0`), not by commit SHA | Not fixed: fine for this project |

Checked and fine:
- the lockfiles match `pyproject.toml` with `main` merged in;
- CI uses Python 3.12 and `--locked`, so a stale lockfile fails the run;
- the uv cache is keyed by each lockfile;
- `cancel-in-progress` per ref;
- job timeouts;
- the PR's runs are green (pipeline 1.5 min, backend 1 min, TS grid 10 s).

From this PR on, `pipeline/uv.lock` and `backend/uv.lock` are tracked. Local runs must not delete them, and dependency changes must update them (`uv lock`).
