# Review of PR #4 (D2 ingest → clean points)

Nov 3, 2026. One automated review pass (10 findings), checked by running ingest on the mock and against the top of the stack (`khalid/x14-harmonization-v2`). Later PRs only add per-row archive/NRT labels (X9), so every finding below was still there.

The mock output, the messy files' expected report and every existing test are unchanged.

| Finding | Outcome |
|---|---|
| Ingesting a second file for a year deleted the first file's points for that year (reproduced: Nile Delta 2024 lost after a Río Negro-only 2024 file) | Fixed: new points are merged into the partition. A point already stored is kept once (archive copy over NRT, otherwise the newer run's), and the report counts them as `already_stored`. Re-running the same files changes nothing. Delete `data/clean/` to rebuild (the build script does). |
| The whole run is held in memory as text (~0.5–0.7 KB per row; a global VIIRS year needs ~10–30 GB) | Not fixed here: Board task **X18** (before R3). Needs per-file or chunked writing. |
| TEAM.md conflict with `main`; D2 listed as Done | Fixed: `main` merged in, D2 under In review. |
| Re-run test compared a value with itself | Fixed: compares with a fresh clean of the same files. |
| `point_id` text relied on pandas yielding Python floats | Fixed: `repr(float(x))`, plus a test with a known hash. |
| Platform end dates not checked | Fixed: rows after a platform's `end` (S-NPP 2026-11-02, from X13) are `platform_out_of_range`. |
| `inf` / `nan` text accepted for frp, scan, track, brightness | Fixed: non-finite values are unreadable (`bad_frp` / `bad_value`). |
| Which copy of a cross-file duplicate survived depended on file order | Fixed: the archive (standard) copy wins over NRT in either order, within a run and across runs. |
| Bad `acq_time` counted under `bad_date`, contract silent (PR #1 finding #11) | Kept as is; add it to the 1.1 proposals when PR #20 is reviewed. |
| `instrument` never checked | Fixed: a value that doesn't match the file's sensor is `bad_value`. Add to the `bad_value` definition in the 1.1 proposals. |

Contract changes the PR asks for (`timestamp[ms]`, `bad_value`, `point_id` text) are already in `contracts/CHANGES-1.1.md` (PR #20), so the contract files are left alone here.
