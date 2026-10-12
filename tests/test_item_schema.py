from ffl2kster.schema import items as I
from ffl2kster.build import build
from ffl2kster.project import Edit, load_project


def test_geometry_and_names(rom_bytes):
    rows = I.extract(rom_bytes)
    assert len(rows) == 256
    assert (rows[0]["name"], rows[1]["name"], rows[0x81]["name"]) == ("Hammer", "Long", "Tusk")
    assert rows[1]["icon"] == "sword" and rows[0x35]["icon"] == "armor"


KNOWN = {  # id: (power, uses, price) -- uses/price cross-checked on screen/code
    0x01: (7, 50, 400),     # Long sword (status screen: 'Long 50')
    0x1D: (40, 4, 50),      # Cure
    0x13: (0, 1, 50000),    # Glass sword: single use
    0x35: (3, 254, 75),     # Bronze armor (DEF 3, verified via unequip)
}


def test_known_values(rom_bytes):
    rows = I.extract(rom_bytes)
    for iid, (pw, uses, price) in KNOWN.items():
        f = rows[iid]["fields"]
        assert (f["power"], f["uses"], f["price"]) == (pw, uses, price)


def test_stat_bonus_decoding(rom_bytes):
    rows = I.extract(rom_bytes)
    # verified by unequip experiments (FINDINGS 2026-10-12)
    assert rows[0x3D]["stat_bonus"] == {"str": 10}
    assert rows[0x3F]["stat_bonus"] == {"agl": 10}
    assert rows[0x40]["stat_bonus"] == {"mana": 15}
    assert rows[0x76]["stat_bonus"] == {"str": 15, "agl": 15}
    assert rows[0x34]["stat_bonus"] is None          # Dragon helm: resist flag, no stats
    assert {rows[i]["slot"] for i in (0x31, 0x35, 0x3A, 0x3F)} == {"helm", "body", "gloves", "boots"}


def test_price_table_bounds(rom_bytes):
    rows = I.extract(rom_bytes)
    assert all(r["fields"]["price"] is not None for r in rows[:0x78])
    assert all(r["fields"]["price"] is None for r in rows[0x78:])


def test_item_edit_build(rom_path, project_file, tmp_path):
    rep = build(rom_path, load_project(project_file), tmp_path / "o.gb",
                edits=[Edit("item", 1, "power", 20), Edit("item", 0x1D, "uses", 9)])
    changed = {c["offset"] for c in rep["changes"]} - {0x14E, 0x14F}
    assert changed == {0x32F88 + 4, 0x33E80 + 0x1D}


def test_item_non_editable(rom_path, project_file, tmp_path):
    import pytest
    with pytest.raises(ValueError, match="not editable"):
        build(rom_path, load_project(project_file), tmp_path / "o.gb",
              edits=[Edit("item", 1, "effect", 0x14)])
