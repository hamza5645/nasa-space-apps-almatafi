"""Swap the built-in mock data for a real data bundle at start-up.

Set ALMATAFI_DATA_URL to an https URL of a .tar.gz holding the data products
(clean/ grid/ harmonized/ validation/, optionally admin/ and cache/) and ALMATAFI_DATA_SHA256
to its checksum. The bundle is downloaded (size-capped), checked against the checksum,
unpacked safely and swapped in. Without ALMATAFI_DATA_URL the built-in data is used.

Make a bundle:  python -m app.cache            # demo-region cache for the new data
                tar -czf almatafi-data.tar.gz -C data clean grid harmonized validation cache
                shasum -a 256 almatafi-data.tar.gz
"""

from __future__ import annotations

import hashlib
import os
import shutil
import sys
import tarfile
import tempfile
from pathlib import Path

import httpx

MAX_BYTES = 4 * 1024**3
PRODUCTS = ("clean", "grid", "harmonized", "validation", "admin", "cache")
REQUIRED = "harmonized/harmonized_monthly.parquet"
MARKER = ".bundle_sha256"


class BundleError(Exception):
    pass


def install(url: str, sha256: str, data_dir: Path, transport: httpx.BaseTransport | None = None) -> bool:
    """Install the bundle into data_dir. Returns False when that exact bundle is already there."""
    sha256 = sha256.strip().lower()
    if not url.startswith("https://"):
        raise BundleError("ALMATAFI_DATA_URL must be an https URL")
    if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
        raise BundleError("ALMATAFI_DATA_SHA256 must be the bundle's 64-character SHA-256")
    marker = data_dir / MARKER
    if marker.exists() and marker.read_text().strip() == sha256:
        return False

    # Stage inside data_dir: the image only lets its user write there (/app belongs to root),
    # and the final moves stay on one filesystem.
    data_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=data_dir, prefix=".bundle-") as tmp:
        archive, digest, size = Path(tmp) / "bundle.tar.gz", hashlib.sha256(), 0
        with httpx.Client(transport=transport, timeout=60.0, follow_redirects=True) as client, \
                client.stream("GET", url) as r, archive.open("wb") as out:
            r.raise_for_status()
            for chunk in r.iter_bytes():
                size += len(chunk)
                if size > MAX_BYTES:
                    raise BundleError("bundle is larger than 4 GB")
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != sha256:
            raise BundleError("bundle checksum does not match ALMATAFI_DATA_SHA256")

        staged = Path(tmp) / "staged"
        with tarfile.open(archive) as tar:
            tar.extractall(staged, filter="data")  # refuses absolute paths, "..", links outside
        if not (staged / REQUIRED).exists():
            raise BundleError(f"bundle has no {REQUIRED}")

        has_cache = (staged / "cache").exists()  # checked before the move below empties staged/
        for name in PRODUCTS:
            if (staged / name).exists():
                shutil.rmtree(data_dir / name, ignore_errors=True)
                shutil.move(str(staged / name), data_dir / name)
        if not has_cache:
            # The built-in demo cache belongs to the mock data; never serve it next to real data.
            shutil.rmtree(data_dir / "cache", ignore_errors=True)
    marker.write_text(sha256 + "\n")
    return True


def _describe(e: Exception, url: str) -> str:
    """A log line without the bundle URL's path or query, which may hold an access token."""
    host = httpx.URL(url).host if url.startswith(("http://", "https://")) else "?"
    if isinstance(e, httpx.HTTPStatusError):
        return f"HTTP {e.response.status_code} from {host}"
    if isinstance(e, httpx.HTTPError):
        return f"{type(e).__name__} while downloading from {host}"
    if isinstance(e, BundleError):
        return str(e)  # our own messages never include the URL
    return type(e).__name__


def main() -> None:
    url = os.environ.get("ALMATAFI_DATA_URL", "").strip()
    data_dir = Path(os.environ.get("ALMATAFI_DATA_DIR", "data"))
    if not url:
        print("bootstrap: using the built-in data", flush=True)
        return
    try:
        changed = install(url, os.environ.get("ALMATAFI_DATA_SHA256", ""), data_dir)
    except (BundleError, httpx.HTTPError, tarfile.TarError, OSError) as e:
        print(f"bootstrap: data bundle refused: {_describe(e, url)}", file=sys.stderr, flush=True)
        sys.exit(1)
    print("bootstrap: data bundle installed" if changed else "bootstrap: data bundle already installed", flush=True)


if __name__ == "__main__":
    main()
