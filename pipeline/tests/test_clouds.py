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


def test_real_is_not_built(capsys):
    assert clouds.main(["real"]) == 2
    assert "MOD14CMH" in capsys.readouterr().err
