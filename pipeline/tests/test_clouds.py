"""X27: the cloud product (mock until MOD14CMH/MYD14CMH are read)."""

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from almatafi import clouds
from almatafi.cells import cell_id


def test_cmg_nests_the_grid():
    # Every 0.1° cell lands in the 0.5° cell that contains its centre.
    rng = np.random.default_rng(1)
    lat, lon = rng.uniform(-89.99, 89.99, 5000), rng.uniform(-179.99, 179.99, 5000)
    ids = np.array([cell_id(a, o) for a, o in zip(lat, lon)])
    clat, clon = clouds.cmg_centre(clouds.cmg_of_cell(ids))
    assert np.all(np.abs(clat - lat) <= 0.25 + 1e-9) and np.all(np.abs(clon - lon) <= 0.25 + 1e-9)
    assert clouds.cmg_of_cell(cell_id(-89.95, -179.95)) == 0
    assert clouds.cmg_of_cell(cell_id(89.95, 179.95)) == 360 * 720 - 1


def test_mock_pattern():
    zero = np.zeros(1)
    f = lambda lat, lon, m, p="Aqua": float(clouds.mock_fraction([lat], [lon], [m], p, zero)[0])  # noqa: E731
    # Nile Delta: a desert sky, a little cloudier in winter.
    assert f(30.9, 31.0, 7) < 0.15 and f(30.9, 31.0, 1) < 0.3 and f(30.9, 31.0, 1) > f(30.9, 31.0, 7)
    # Río Negro: southern winter is cloudy, summer less so.
    assert f(-40, -67, 7) > 0.55 > f(-40, -67, 1)
    # Amazon: wet season (Feb) cloudier than dry season (Aug); Aqua's pass a little cloudier.
    assert f(-5, -60, 2) > 0.7 > f(-5, -60, 8)
    assert f(-5, -60, 2, "Aqua") > f(-5, -60, 2, "Terra")
    big = clouds.mock_fraction([0, 0], [0, 0], [1, 1], "Aqua", np.array([5.0, -5.0]))
    assert np.allclose(big, [0.95, 0.02])  # clipped


def test_build_mock_and_write(tmp_path):
    ids = clouds.cmg_of_cell([cell_id(30.95, 31.05), cell_id(30.85, 31.15), cell_id(-40.2, -67.3)])
    table = clouds.build_mock(ids, (2026, 11))
    assert table.schema.equals(clouds.SCHEMA)
    assert set(table["platform"].to_pylist()) == {"Terra", "Aqua"}
    terra = table.filter(pa.compute.equal(table["platform"], "Terra"))
    aqua = table.filter(pa.compute.equal(table["platform"], "Aqua"))
    cells = np.unique(ids).size
    # Terra from Nov 2000, Aqua from Jul 2002, both to Nov 2026.
    # Terra: 2 months of 2000 + 25 years + 11 months of 2026; Aqua: 6 of 2002 + 23 years + 11.
    assert terra.num_rows == cells * (2 + 25 * 12 + 11) and aqua.num_rows == cells * (6 + 23 * 12 + 11)
    frac = table["cloud_fraction"].to_numpy()
    assert frac.min() >= 0.02 and frac.max() <= 0.95
    # Seeded: the same input gives the same table.
    assert clouds.build_mock(ids, (2026, 11)).equals(table)
    path = clouds.write(table, tmp_path / "clouds", "mock")
    meta = pq.read_schema(path).metadata
    assert meta[b"source"] == b"mock" and meta[b"clear_min"] == b"0.2"
    assert pq.read_table(path).num_rows == table.num_rows


# ---- The real builder, against a fake GIBS -------------------------------------------------

import io
from datetime import date

from PIL import Image

COLORMAP = '<ColorMaps><ColorMap title="No Data"><Entries><ColorMapEntry rgb="192,192,192" transparent="true" sourceValue="127" value="127" nodata="true" ref="0"/></Entries></ColorMap><ColorMap title="Cloud Fraction" units="%"><Entries>' + \
    "".join(f'<ColorMapEntry rgb="{v},{(v * 7) % 256},{(v * 13) % 256}" transparent="false" sourceValue="{v}" value="{v}" ref="1"/>' for v in range(101)) + \
    "</Entries></ColorMap></ColorMaps>"


def _png(width, height, fill):
    im = Image.new("RGBA", (width, height), fill)
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


def test_colormap_and_boxes():
    cmap = clouds.parse_colormap(COLORMAP)
    assert cmap[(40, 280 % 256, 520 % 256)] == 0.4 and (192, 192, 192) not in cmap
    ids = clouds.cmg_of_cell([cell_id(30.95, 31.05), cell_id(26.1, 33.4), cell_id(-40.2, -67.3), cell_id(-33.5, -70.6)])
    boxes = clouds.boxes_for(ids)
    assert len(boxes) == 2  # Egypt, and the two southern cells together
    egypt = next(b for b in boxes if b[0] > 0)
    assert egypt == (31.0, 26.0, 34.0, 31.5) or (egypt[0] <= 31.0 and egypt[2] >= 33.5)
    url = clouds.wms_url("MODIS_Aqua_Cloud_Fraction_Day", (31.0, 26.0, 34.0, 31.5), date(2025, 10, 15))
    assert "BBOX=26,31,31.5,34&WIDTH=6&HEIGHT=11" in url and "TIME=2025-10-15" in url


def test_decode_maps_pixels_to_cells():
    cmap = clouds.parse_colormap(COLORMAP)
    box = (31.0, 26.0, 34.0, 31.5)   # 6 × 11 px
    im = Image.new("RGBA", (6, 11), (0, 0, 0, 0))
    im.putpixel((0, 0), (40, 280 % 256, 520 % 256, 255))   # north-west pixel: lat 31.25, lon 31.25 → 40 %
    buf = io.BytesIO(); im.save(buf, "PNG")
    vals = clouds.decode(buf.getvalue(), box, cmap)
    cid = int(np.floor((31.25 + 90) * 2)) * 720 + int(np.floor((31.25 + 180) * 2))
    assert vals == {cid: 0.4}
    assert cid == int(clouds.cmg_of_cell(cell_id(31.25, 31.25)))


def test_build_gibs_averages_the_days(tmp_path):
    cmap_px = (40, 280 % 256, 520 % 256, 255)      # 40 %
    cmap_px2 = (80, (80 * 7) % 256, (80 * 13) % 256, 255)  # 80 %
    calls = []

    def fetch(url):
        calls.append(url)
        if url == clouds.GIBS_COLORMAP:
            return COLORMAP.encode()
        day = url.split("TIME=")[1]
        if day.endswith("-03"):
            return _png(2, 2, (0, 0, 0, 0))            # a cloud-mask gap: no data that day
        return _png(2, 2, cmap_px if day.endswith("-01") else cmap_px2)

    ids = clouds.cmg_of_cell([cell_id(30.25, 31.25), cell_id(30.75, 31.75)])
    table, stats = clouds.build_gibs(ids, (2026, 10), (2026, 10), tmp_path / "cache", fetch=fetch, workers=2, log=lambda _: None)
    df = table.to_pandas()
    assert set(df["platform"]) == {"Terra", "Aqua"} and set(df["cmg_id"]) == set(int(i) for i in ids)
    # 31 days: one at 40 %, one empty, 29 at 80 % → mean 0.786
    assert all(abs(v - (0.4 + 29 * 0.8) / 30) < 1e-3 for v in df["cloud_fraction"])
    assert stats["fetched"] == 62 and stats["empty"] == 2
    # Reruns read the cache.
    table2, stats2 = clouds.build_gibs(ids, (2026, 10), (2026, 10), tmp_path / "cache", fetch=fetch, workers=2, log=lambda _: None)
    assert stats2["cached"] == 62 and table2.equals(table)
