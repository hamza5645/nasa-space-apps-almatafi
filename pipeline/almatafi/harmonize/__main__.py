"""python -m almatafi.harmonize [--grid data/grid] [--out data/harmonized] [--model auto|M0|M1|M2]

Fits the models, picks one by leave-one-year-out validation (unless --model says otherwise),
writes data/harmonized/ and the validation results in data/validation/.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from almatafi.harmonize.build import build
from almatafi.harmonize.models import MODELS

REPO = Path(__file__).resolve().parents[3]


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Harmonize the monthly grid into VIIRS S-NPP-equivalent values.")
    ap.add_argument("--grid", type=Path, default=REPO / "data" / "grid")
    ap.add_argument("--out", type=Path, default=REPO / "data" / "harmonized")
    ap.add_argument("--validation", type=Path, default=REPO / "data" / "validation")
    ap.add_argument("--truth", type=Path, default=REPO / "data" / "raw" / "mock" / "truth",
                    help="mock truth tables; used only when the data is mock")
    ap.add_argument("--reports", type=Path, default=REPO / "data" / "reports")
    ap.add_argument("--model", choices=(*MODELS, "auto"), default="auto")
    args = ap.parse_args(argv)
    r = build(args.grid, args.out, args.reports, args.model, args.validation, args.truth)
    print(f"{r['rows']:,} cell-months, {r['covered_start']} … {r['covered_end']}, model {r['model']} "
          f"(LOYO R²: {r['r2_by_model']})")
    b = r.get("break_test") or {}
    if b:
        print(f"2012 jump, mean after ÷ before: raw {b['raw_ratio_after_vs_before_2012']}, "
              f"harmonized {b['harmonized_ratio_after_vs_before_2012']}")
    for reg in (r.get("mock_truth") or {}).get("regions", []):
        print(f"  {reg['region']:20s} vs truth: raw {reg['raw_jump_vs_truth']}  harmonized {reg['harmonized_jump_vs_truth']}")
    print(f"report: {r['report_path']}")


if __name__ == "__main__":
    main()
