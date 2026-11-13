# Review of PR #26 (X8 submission drafts and docs/method.md)

Nov 3, 2026. One review pass, compared with the top of the stack (`hamza/i1-deploy`), where X13/X14 bring `docs/method.md` and `docs/submission.md` up to the final method.

One change in this PR (`docs/method.md`).

## Findings

| # | Finding | Outcome |
|---|---|---|
| 1 | The method's Limits lacked two limitations the reviews found: a static source's cell is masked for the whole record (PR #5 review), and the Terra-only months 2001-01 → 2002-06 are unreliable where Terra sees little (X22) | **Added** to §7 Limits, placed so the top of the stack's edits to that section merge cleanly. The same two go on the Method page at PR #34 |
| 2 | `submission.md` links the demo as "[Vercel URL]" and lists three models | Fixed later: the top of the stack links almatafi.monitorthesituations.com and describes the four models and the S-NPP end |

Checked and fine:
- **Placeholders:** every result in the submission drafts is still a `[real]` placeholder, waiting for R2/R6, so no mock number can slip into the submission.
- **Data sources:** the NASA data list names FIRMS MODIS C6.1, VIIRS 375 m and GIBS with links, and the other sources are listed.
- **AI use:** the AI-use disclosure is there.
- **Format:** the 7 slides and the 30 s video follow the Cairo rules quoted in the file.
