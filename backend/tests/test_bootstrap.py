import hashlib
import io
import tarfile
from pathlib import Path

import httpx
import pytest

from app.bootstrap import BundleError, install, main

URL = "https://data.example.org/almatafi-data.tar.gz"


def _bundle(files: dict[str, bytes], extra=None) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
        for info in extra or []:
            tar.addfile(info)
    return buf.getvalue()


GOOD = {"harmonized/harmonized_monthly.parquet": b"real", "grid/grid_monthly.parquet": b"grid",
        "validation/validation.json": b"{}"}


def _transport(body: bytes, seen: list | None = None):
    def handler(request):
        if seen is not None:
            seen.append(str(request.url))
        return httpx.Response(200, content=body)
    return httpx.MockTransport(handler)


@pytest.fixture
def data(tmp_path) -> Path:
    d = tmp_path / "data"
    for name in ("harmonized", "grid", "clean"):
        (d / name).mkdir(parents=True)
        (d / name / "mock.parquet").write_bytes(b"mock")
    return d


def test_installs_and_replaces_only_the_products_in_the_bundle(data):
    body = _bundle(GOOD)
    assert install(URL, hashlib.sha256(body).hexdigest(), data, _transport(body)) is True
    assert (data / "harmonized" / "harmonized_monthly.parquet").read_bytes() == b"real"
    assert not (data / "harmonized" / "mock.parquet").exists()          # replaced, not merged
    assert (data / "clean" / "mock.parquet").exists()                    # not in the bundle: kept
    assert (data / "validation" / "validation.json").exists()


def test_a_bundle_with_its_own_cache_keeps_it(data):
    """Regression: the install used to move cache/ in and then delete it as "missing"."""
    (data / "cache").mkdir()
    (data / "cache" / "index.json").write_bytes(b"mock cache")
    body = _bundle(GOOD | {"cache/index.json": b"real cache", "cache/nile-delta.json": b"{}"})
    install(URL, hashlib.sha256(body).hexdigest(), data, _transport(body))
    assert (data / "cache" / "index.json").read_bytes() == b"real cache"
    assert (data / "cache" / "nile-delta.json").exists()


def test_a_bundle_without_a_cache_drops_the_mock_one(data):
    (data / "cache").mkdir()
    (data / "cache" / "index.json").write_bytes(b"mock cache")
    body = _bundle(GOOD)
    install(URL, hashlib.sha256(body).hexdigest(), data, _transport(body))
    assert not (data / "cache").exists()


def test_same_bundle_is_not_downloaded_twice(data):
    body, seen = _bundle(GOOD), []
    sha = hashlib.sha256(body).hexdigest()
    install(URL, sha, data, _transport(body, seen))
    assert install(URL, sha.upper(), data, _transport(body, seen)) is False
    assert len(seen) == 1


def test_wrong_checksum_changes_nothing(data):
    body = _bundle(GOOD)
    with pytest.raises(BundleError, match="checksum"):
        install(URL, "0" * 64, data, _transport(body))
    assert (data / "harmonized" / "mock.parquet").exists()


@pytest.mark.parametrize("url,sha", [("http://data.example.org/x.tar.gz", "0" * 64), (URL, ""), (URL, "abc"),
                                     (URL, "g" * 64)])
def test_refuses_plain_http_and_bad_checksums_before_downloading(data, url, sha):
    seen = []
    with pytest.raises(BundleError):
        install(url, sha, data, _transport(b"", seen))
    assert seen == []


def test_paths_outside_the_bundle_are_refused(data):
    body = _bundle(GOOD | {"../escape.txt": b"x"})
    with pytest.raises(tarfile.TarError):
        install(URL, hashlib.sha256(body).hexdigest(), data, _transport(body))
    assert not (data.parent / "escape.txt").exists()
    assert (data / "harmonized" / "mock.parquet").exists()


def test_absolute_paths_stay_inside_the_staging_folder(data):
    # The "data" filter strips the leading "/"; only known product folders are moved in.
    body = _bundle(GOOD | {"/etc/evil.txt": b"x"})
    install(URL, hashlib.sha256(body).hexdigest(), data, _transport(body))
    assert not (data / "etc").exists() and sorted(p.name for p in data.iterdir()) == [
        ".bundle_sha256", "clean", "grid", "harmonized", "validation"]


def test_links_outside_the_bundle_are_refused(data):
    link = tarfile.TarInfo("harmonized/link")
    link.type, link.linkname = tarfile.SYMTYPE, "/etc/passwd"
    body = _bundle(GOOD, extra=[link])
    with pytest.raises(tarfile.TarError):
        install(URL, hashlib.sha256(body).hexdigest(), data, _transport(body))


def test_bundle_must_have_the_harmonized_product(data):
    body = _bundle({"grid/grid_monthly.parquet": b"grid"})
    with pytest.raises(BundleError, match="harmonized"):
        install(URL, hashlib.sha256(body).hexdigest(), data, _transport(body))


def test_main_without_url_keeps_built_in_data(monkeypatch, data, capsys):
    monkeypatch.delenv("ALMATAFI_DATA_URL", raising=False)
    monkeypatch.setenv("ALMATAFI_DATA_DIR", str(data))
    main()
    assert "built-in" in capsys.readouterr().out


def test_main_exits_on_a_refused_bundle(monkeypatch, data):
    monkeypatch.setenv("ALMATAFI_DATA_URL", "http://insecure.example/x.tar.gz")
    monkeypatch.setenv("ALMATAFI_DATA_SHA256", "0" * 64)
    monkeypatch.setenv("ALMATAFI_DATA_DIR", str(data))
    with pytest.raises(SystemExit) as e:
        main()
    assert e.value.code == 1


def test_failures_never_log_the_url_token(monkeypatch, data, capsys):
    import app.bootstrap as bootstrap
    secret = "https://bucket.example.org/almatafi.tar.gz?X-Amz-Signature=SECRET123"

    def fail(*a, **k):
        raise httpx.HTTPStatusError("boom " + secret, request=httpx.Request("GET", secret),
                                    response=httpx.Response(403, request=httpx.Request("GET", secret)))

    monkeypatch.setattr(bootstrap, "install", fail)
    monkeypatch.setenv("ALMATAFI_DATA_URL", secret)
    monkeypatch.setenv("ALMATAFI_DATA_SHA256", "0" * 64)
    monkeypatch.setenv("ALMATAFI_DATA_DIR", str(data))
    with pytest.raises(SystemExit):
        main()
    err = capsys.readouterr().err
    assert "SECRET123" not in err and "HTTP 403 from bucket.example.org" in err


def test_stages_inside_the_data_folder(data, monkeypatch):
    """In the image only /app/data is writable (/app belongs to root), so the download and
    unpacking must happen inside data_dir, not next to it. Root ignores file permissions, so
    the test watches where the temporary folder goes."""
    import tempfile

    import app.bootstrap as bootstrap

    made = []
    real = tempfile.TemporaryDirectory

    def spy(*args, **kwargs):
        made.append(Path(kwargs["dir"]))
        return real(*args, **kwargs)

    monkeypatch.setattr(bootstrap.tempfile, "TemporaryDirectory", spy)
    body = _bundle(GOOD)
    assert install(URL, hashlib.sha256(body).hexdigest(), data, _transport(body)) is True
    assert made == [data]
    assert sorted(p.name for p in data.iterdir()) == [".bundle_sha256", "clean", "grid", "harmonized", "validation"]
