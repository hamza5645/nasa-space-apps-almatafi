"""The API's OpenAPI schema as a checked-in file, for the frontend (types, mock server).

    python -m app.openapi            # rewrites ../contracts/openapi.json

tests/test_openapi.py fails when the file is out of date, so a backend change that
alters a request or response shape shows up in the PR diff.
"""

from __future__ import annotations

import json
import sys

from app.config import REPO, Settings
from app.main import create_app

PATH = REPO / "contracts" / "openapi.json"


def snapshot() -> str:
    return json.dumps(create_app(Settings(firms_map_key=None)).openapi(), indent=2, sort_keys=True,
                      ensure_ascii=False) + "\n"


def main() -> int:
    PATH.write_text(snapshot())
    print(f"wrote {PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
