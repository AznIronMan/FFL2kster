"""Legend I monster table (06:6AE8, 9 x 200): structure, decoding, proof build, SQLite store."""

import json

import pytest

from ffl1kster import rom as romlib
from ffl1kster.build import build
from ffl1kster.db import connect, import_rom, load_edits
from ffl1kster.project import Edit, load_project
from ffl1kster.schema import monsters as M


def test_layout_constants():
    assert M.TABLE == 0x1AAE8 and M.NAMES == 0x14000
    assert M.TABLE + M.RECORD_SIZE * M.RECORD_COUNT == M.NIBBLES  # ends where the nibble table starts
    assert M.HP_CLASSES == M.NIBBLES + 100 and M.GP_TABLE == M.HP_CLASSES + 2 * M.HP_CLASS_COUNT


def test_known_records(ffl1_rom):
    asi = {r["id"]: r for r in M.extract(ffl1_rom)}[155]
    assert asi["name"] == "ASIGARU"
    v = asi["fields"]
    assert (v["str"], v["def"], v["agl"], v["mana"]) == (5, 6, 8, 3)
    assert v["hp_class"] == 0 and asi["base_hp"] == 20 and asi["abilities"] == [0x24]
    clip = M.extract(ffl1_rom)[18]
    assert clip["name"] == "CLIPPER"
    assert [clip["fields"][k] for k in ("str", "def", "agl", "mana")] == [4, 9, 7, 6]  # status screen
    assert M.name(ffl1_rom, 0) == "FLY" and M.name(ffl1_rom, 199) == "CREATOR"


def test_ability_lists_contiguous(ffl1_rom):
    rows = M.extract(ffl1_rom)
    for a, b in zip(rows, rows[1:]):
        assert a["fields"]["ability_ptr"] + a["fields"]["ability_count_minus1"] + 1 == b["fields"]["ability_ptr"]
    assert rows[0]["fields"]["ability_ptr"] == 0x7321  # right after the 31 formation entries (06:72C4)


def test_hp_classes(ffl1_rom):
    assert [M.base_hp(ffl1_rom, i) for i in range(4)] == [20, 40, 60, 82]
    assert M.base_hp(ffl1_rom, 21) == 795
    assert max(r["fields"]["hp_class"] for r in M.extract(ffl1_rom)) < M.HP_CLASS_COUNT


def test_proof_build(ffl1_rom_path, ffl1_rom, tmp_path):
    from .conftest import FFL1_PROJECT
    p = load_project(FFL1_PROJECT)
    assert [(e.domain, e.id, e.field, e.value) for e in p.edits] == [("monster", 155, "hp_class", 21)]
    r = build(ffl1_rom_path, p, tmp_path / "o.gb", tmp_path / "d.json")
    data = [c for c in r["changes"] if c["offset"] not in (0x14D, 0x14E, 0x14F)]
    assert [(c["offset"], c["old"], c["new"]) for c in data] == [(M.record_offset(155) + 1, 0, 21)]
    assert all(c["reason"] for c in r["changes"])
    out = (tmp_path / "o.gb").read_bytes()
    h = romlib.parse_header(out)
    assert h.header_checksum_ok and h.global_checksum_ok


def test_bit_field_edit_keeps_other_bits(ffl1_rom_path, ffl1_project, tmp_path):
    r = build(ffl1_rom_path, load_project(ffl1_project), tmp_path / "o.gb",
              edits=[Edit("monster", 0, "ability_count_minus1", 1)])  # FLY b0 0x93: bits 3-5 = 2
    c = [x for x in r["changes"] if x["offset"] == M.record_offset(0)][0]
    assert (c["old"], c["new"]) == (0x93, 0x8B)


def test_gp_table(ffl1_rom):
    assert [M.gp(ffl1_rom, i) for i in range(16)] == [0, 40, 120, 240, 400, 600, 900, 1200, 1600, 2000, 2400,
                                                       4000, 4800, 5500, 6500, 9999]
    assert {r["id"]: r for r in M.extract(ffl1_rom)}[155]["gp"] == 40


@pytest.mark.parametrize("field,value", [("hp_class", 40), ("str", 256), ("ability_ptr", 1), ("name", 1)])
def test_rejects_bad_edits(ffl1_rom_path, ffl1_project, tmp_path, field, value):
    with pytest.raises(ValueError):
        build(ffl1_rom_path, load_project(ffl1_project), tmp_path / "o.gb", edits=[Edit("monster", 1, field, value)])


def test_db_roundtrip(ffl1_rom_path, ffl1_rom, tmp_path):
    from .conftest import FFL1_PROJECT
    db = tmp_path / "s.sqlite"
    res = import_rom(ffl1_rom_path, db, load_project(FFL1_PROJECT))
    assert res["domains"]["monster"]["records"] == 200 and res["edits"] == 1
    con = connect(db)
    row = con.execute("SELECT original_value, effective_value, source_bank, source_address, status FROM effective "
                      "WHERE domain='monster' AND id=155 AND field='hp_class'").fetchone()
    assert row == (0, 21, 6, 0x705C, "verified")
    assert con.execute("SELECT value FROM meta WHERE key='game'").fetchone()[0] == "FFL1"
    con.close()
    # the database build equals the project.json build
    p = load_project(FFL1_PROJECT)
    a = build(ffl1_rom_path, p, tmp_path / "a.gb")
    b = build(ffl1_rom_path, p, tmp_path / "b.gb", edits=load_edits(db))
    assert (tmp_path / "a.gb").read_bytes() == (tmp_path / "b.gb").read_bytes()
    assert a["changed_bytes"] == b["changed_bytes"]
