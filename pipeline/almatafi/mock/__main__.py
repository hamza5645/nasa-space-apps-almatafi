"""python -m almatafi.mock [--seed 2026] [--end 2026-10-31] [--regions nile-delta,rio-negro] [--out DIR]"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date
from pathlib import Path

from almatafi.mock.checks import Z_MIN, planted_events
from almatafi.mock.generate import DEFAULT_END, DEFAULT_SEED, SIM_START, generate, write
from almatafi.mock.regions import REGIONS

REPO = Path(__file__).resolve().parents[3]


def remove_previous(out: Path) -> int:
    """Delete the files a previous run listed in its manifest, so a rerun with another
    --end, --regions or --seed never leaves old CSVs for ingest to pick up."""
    manifest = out / "manifest.json"
    if not manifest.exists():
        return 0
    try:
        listed = list(json.loads(manifest.read_text()).get("files", {}))
    except ValueError:
        print(f"warning: {manifest} is not valid JSON; old files were not removed", file=sys.stderr)
        return 0
    root, removed = out.resolve(), 0
    for rel in [*listed, "messy/expected_report.json"]:
        path = (out / rel).resolve()
        if root in path.parents and path.is_file():
            path.unlink()
            removed += 1
    manifest.unlink()
    return removed


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Write mock FIRMS CSVs in the archive format.")
    ap.add_argument("--out", type=Path, default=REPO / "data" / "raw" / "mock")
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--end", type=date.fromisoformat, default=DEFAULT_END, help="last day, YYYY-MM-DD")
    ap.add_argument("--regions", default=",".join(REGIONS), help=f"comma list from: {', '.join(REGIONS)}")
    ap.add_argument("--messy-year", type=int, default=2016, help="year for the messy test files, 0 to skip")
    args = ap.parse_args(argv)

    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    unknown = set(regions) - set(REGIONS)
    if unknown:
        ap.error(f"unknown region(s): {', '.join(sorted(unknown))}")
    if args.end > date.today():
        ap.error("--end is in the future; ingest would drop those rows as bad_date")
    if args.end < SIM_START:
        ap.error(f"--end is before the first FIRMS data ({SIM_START})")

    t0 = time.time()
    result = generate(args.seed, args.end, regions)
    removed = remove_previous(args.out)
    manifest = write(result, args.out, args.seed, args.end, args.messy_year or None)
    if removed:
        print(f"removed {removed} files from the previous run")
    for ev in planted_events(result, args.end):
        print(f"planted {ev['region']} {ev['month']}: {ev['count']} S-NPP detections, "
              f"baseline mean {ev['baseline_mean']}, z = {ev['z']}")
        if not ev["ok"]:
            print(f"warning: that event is below z = {Z_MIN} with seed {args.seed}; the demo "
                  f"story needs it. The default seed {DEFAULT_SEED} has it.", file=sys.stderr)
    print(f"MODIS rows: {len(result['MODIS']):,}  VIIRS rows: {len(result['VIIRS']):,}  "
          f"fires: {int((~result['events']['static']).sum()):,}")
    print(f"{len(manifest['files'])} files in {args.out} ({time.time() - t0:.1f}s)")


if __name__ == "__main__":
    main()
