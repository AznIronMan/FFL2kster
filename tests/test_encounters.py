from ffl2kster.schema import encounters as EN
from ffl2kster.build import build
from ffl2kster.project import Edit, load_project


def test_zone0_matches_observed_battles(rom_bytes):
    z0 = EN.export(rom_bytes)["zones"][0]["slots"]
    first = {(g["enemy_id"], g["min"], g["max"]) for s in z0 for g in s["groups"] if not s["alt"]}
    # observed near the first town: Jaguar x3, Gang x3, Spider x1, Asigaru x1
    assert {(120, 1, 4), (185, 1, 4), (45, 1, 1), (180, 1, 1)} <= first


def test_probabilities_sum_to_one(rom_bytes):
    p = EN.slot_probabilities(rom_bytes)
    assert len(p) == 8 and abs(sum(p) - 1) < 1e-9
    assert [round(x * 256) for x in p] == [10, 17, 34, 68, 68, 34, 17, 8]


def test_sizes(rom_bytes):
    d = EN.export(rom_bytes)
    assert len(d["zones"]) == 135 and len(d["formations"]) == 128 and len(d["count_patterns"]) == 32


def test_formation_edit(rom_path, project_file, tmp_path):
    rep = build(rom_path, load_project(project_file), tmp_path / "e.gb",
                edits=[Edit("formation", 20, "id1", 45), Edit("zone", 0, "slot3", 0x18)])
    assert {c["offset"] for c in rep["changes"]} - {0x14E, 0x14F} == {0x36C70 + 100, 0x36573}
