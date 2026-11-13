# Review of PR #3 (D1 mock FIRMS generator)

Nov 3, 2026. One automated review pass (14 findings). Each one was checked by running the generator, and against the top of the stack (`khalid/x14-harmonization-v2`), where X4 (PR #17) later changes the file layout and platform dates but none of the bugs below.

**The default output is unchanged.** Later PRs commit files built from the mock (`frontend/public/cache/*.json`) and tests use seed 2026, so the fixes keep every main CSV and truth file byte-identical for the default run (44 of 46 files; only the two messy files differ, on purpose).

| Finding | Outcome |
|---|---|
| `--end` before the messy year (2016) crashed writing `messy/expected_report.json` | Fixed: the report is only written when there is a messy file. |
| `--end` before 2012 crashed (no VIIRS rows to concatenate) | Fixed: VIIRS is an empty table with the contract columns. |
| A rerun left the previous run's CSVs for ingest to pick up | Fixed: the CLI deletes the files the previous `manifest.json` lists (only inside `--out`) before writing. |
| Nile Delta Oct 2026 reaches z > 2 only for some seeds (4 of 10 fail) | Changed differently: making the event stronger would change the default output and the committed caches. Instead `almatafi/mock/checks.py` measures each planted event and the CLI prints its z and warns when it's below 2 (it is 5.7 for the default seed, −0.3 for seed 2). |
| TEAM.md conflict with `main`; D1 listed as Done | Fixed: `main` merged in, D1 under In review. |
| Messy fault counts hard-coded apart from `MESSY_FAULTS` (test was a tautology) | Fixed: counts come from `MESSY_FAULTS`; a test changes the table and counts the faults in the file. |
| `--end` before 2000-11-01 crashed with `IndexError` | Fixed: CLI error and `ValueError` in `generate()`. |
| Messy year with fewer than 35 rows crashed | Fixed: that sensor-year is skipped. |
| Spelling variants changed the platform (Aqua → Terra, NOAA-20 → S-NPP) | Fixed: each row gets another spelling of its own platform. The NOAA-20 out-of-range rows now also get a 2016 date, so they stay out of range in any messy year. |
| `firms-input.md` gave the generator path as `pipeline/mock/` | Fixed: 1.0.1, text only. Contract change: needs both to agree. |
| MODIS values written with 2 decimals (real files: 1) | Skipped: would change the default output. Checked Nov 3 on real 2010 files: brightness, FRP and scan have 1 decimal and coordinates up to 4. The mock's 2 decimals are harmless (ingest reads floats); kept. |
| Rows sorted twice | Fixed: the per-region sort is gone (output identical). The repeated filter in `write()` is left, because X4 rewrites those lines. |
| `GROUP` hard-codes platform names | Skipped: X4 edits the lines next to it, so changing it here would make PR #17 conflict. Do it after the stack is merged. |
| truth `fire_days` means burning days, not the grid's `fire_days` | Documented in `truth_monthly`; not renamed, because H3 (`harmonize/validate.py`, PR #10) reads the column by this name. |
