"""What data the backend can see: paths, data_version and which sources are loaded."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pyarrow.parquet as pq


@dataclass
class DataStore:
    root: Path

    @property
    def harmonized(self) -> Path:
        return self.root / "harmonized" / "harmonized_monthly.parquet"

    @property
    def grid(self) -> Path:
        return self.root / "grid" / "grid_monthly.parquet"

    @property
    def coverage(self) -> Path:
        return self.root / "grid" / "coverage.parquet"

    @property
    def clean(self) -> Path:
        return self.root / "clean"

    def has_points(self) -> bool:
        return any(self.clean.glob("sensor=*/year=*/*.parquet")) if self.clean.exists() else False

    def data_version(self) -> str:
        """From the most processed product available: harmonized, then grid, then clean points."""
        candidates = [self.harmonized, self.grid]
        if self.clean.exists():
            candidates += sorted(self.clean.glob("sensor=*/year=*/*.parquet"))[-1:]
        for path in candidates:
            if path.exists():
                meta = pq.read_schema(path).metadata or {}
                if b"data_version" in meta:
                    return meta[b"data_version"].decode()
        return "none"
