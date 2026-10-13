"""Legend III monster tables (bank 0B: 470D 4 x 195, 4A19 12 x 195, 533D 9 x 195; names 0E:7533)."""

import json
import sqlite3

import pytest

from ffl3kster import rom as romlib
from ffl3kster.build import build, compile_edits
from ffl3kster.cli import main
from ffl3kster.db import import_rom, load_edits
from ffl3kster.project import Edit, load_project
from ffl3kster.schema import monsters as M
from ffl3kster.text import decode, encode

from .conftest import FFL3_PROJECT

T, C, A = M.MONSTER, M.MONSTER_CLASS, M.MONSTER_ABILITY


def test_layout_contiguous():
    assert C.TABLE == romlib.bank_to_file(0x0B, 0x470D)
    assert C.TABLE + 4 * M.COUNT == T.TABLE                # 470D + 4*195 = 4A19
    assert T.TABLE + 12 * M.COUNT == A.TABLE               # 4A19 + 12*195 = 533D
    assert A.TABLE + 9 * M.COUNT == romlib.bank_to_file(0x0B, 0x5A18)


def test_table_edges(ffl3_rom):
    assert ffl3_rom[C.TABLE - 8:C.TABLE] == bytes(8)       # zero padding after the 46DD entries
    assert M.name(ffl3_rom, 0) == "Fungus" and M.name(ffl3_rom, 0xC2) == "Xagor"
    after = ffl3_rom[M.NAMES + 8 * M.COUNT:M.NAMES + 8 * M.COUNT + 16]
    assert "Staff" in decode(after)                        # the credits text follows the 195 names
    for mid in range(M.COUNT):
        assert all(b == 0xFF or decode(bytes([b])) != "·" for b in ffl3_rom[M.NAMES + 8 * mid:M.NAMES + 8 * mid + 8])


def test_known_records(ffl3_rom):
    div, spr = T.extract(ffl3_rom)[0x46], T.extract(ffl3_rom)[0x4B]
    assert (div["name"], spr["name"]) == ("Diviner", "Sprite")
    assert div["fields"] == {"kind": 3, "b0_high": 0, "hp": 45, "profile_a": 11, "value2": 54, "profile_b": 15,
                             "stat1": 8, "stat2": 4, "stat3": 3, "stat4": 8, "bonus1": 2, "bonus2": 6, "bonus3": 6}
    assert spr["fields"]["value2"] == 49 and [spr["fields"][f"stat{i}"] for i in range(1, 5)] == [3, 3, 7, 9]
    assert C.extract(ffl3_rom)[0x4B]["fields"] == {"level": 1, "class_bits": 3, "c1": 14, "c2": 14, "c3": 0xC0}
    ab = A.extract(ffl3_rom)[0x46]["fields"]
    assert ab["mask"] == 0xC0 and (ab["slot1"], ab["slot2"], ab["slot3"]) == (0x13, 0x7E, 0xFF)


def test_kinds_and_bosses(ffl3_rom):
    kinds = [T.read_field(ffl3_rom, i, "kind") for i in range(M.COUNT)]
    assert {k: kinds.count(k) for k in set(kinds)} == {4: 74, 3: 60, 1: 30, 0: 30, 2: 1}
    assert [i for i in range(M.COUNT) if kinds[i] == 4] == list(range(0x3C)) + [0xB4, 0xB5] + list(range(0xB7, 0xC3))
    assert all(T.read_field(ffl3_rom, i, "b0_high") == 0 for i in range(M.COUNT))
    assert [M.name(ffl3_rom, i) for i in range(M.BOSS_FROM, M.COUNT)] == [
        "Maitreya", "Fenrir", "Guha", "Dahak", "Agron", "Ballor", "Sol", "Xagor"]
    assert T.read_field(ffl3_rom, 0xBB, "hp") == 375 and T.read_field(ffl3_rom, 0xBA, "hp") == 4000


def test_u12_encoding_keeps_high_nibble(ffl3_rom):
    f = T.FIELD_BY_NAME["hp"]
    assert T.encode_field(ffl3_rom, 0x4B, f, 900) == bytes([0x84, 0xC3])   # profile_a (C) kept
    assert T.encode_field(ffl3_rom, 0x4B, T.FIELD_BY_NAME["profile_a"], 1) == bytes([0x10])
    with pytest.raises(ValueError):
        T.encode_field(ffl3_rom, 0x4B, f, 0x1000)
    with pytest.raises(ValueError):
        T.encode_field(ffl3_rom, 0x4B, f, 0)
    with pytest.raises(ValueError):
        T.encode_field(ffl3_rom, 0x4B, T.FIELD_BY_NAME["b0_high"], 1)    # not editable
    with pytest.raises(ValueError):
        T.record_offset(M.COUNT)


def test_every_field_has_evidence_and_status():
    for t in M.TABLES:
        for f in t.FIELDS:
            assert f.status in ("verified", "probable", "hypothesis") and f.evidence
            assert f.offset + f.size <= t.RECORD_SIZE


def test_proof_build(ffl3_rom_path, tmp_path):
    p = load_project(FFL3_PROJECT)
    assert [(e.domain, e.id, e.field, e.value) for e in p.edits] == [("monster", 0x4B, "hp", 900)]
    rep = build(ffl3_rom_path, p, tmp_path / "out.gb", tmp_path / "diff.json")
    out = (tmp_path / "out.gb").read_bytes()
    assert T.read_field(out, 0x4B, "hp") == 900 and T.read_field(out, 0x4B, "profile_a") == 12
    assert {r["offset"] for r in rep["changes"]} == {T.record_offset(0x4B) + 1, T.record_offset(0x4B) + 2,
                                                       0x14E, 0x14F}


def test_other_domains_compile(ffl3_rom):
    ps = compile_edits(ffl3_rom, [Edit("monster_class", 0x4B, "level", 5), Edit("monster_ability", 0x4B, "slot1", 0x1B)])
    assert [(p.offset, p.data) for p in ps] == [(C.record_offset(0x4B), bytes([0xC5])), (A.record_offset(0x4B) + 1, b"\x1b")]


def test_db_roundtrip(ffl3_rom_path, tmp_path):
    db = tmp_path / "s.sqlite"
    res = import_rom(ffl3_rom_path, db, load_project(FFL3_PROJECT))
    assert res["game"] == "FFL3" and res["edits"] == 1
    assert res["domains"]["monster"] == {"records": 195, "fields": 195 * 13}
    con = sqlite3.connect(db)
    row = con.execute("SELECT original_value, effective_value, status FROM effective "
                      "WHERE domain='monster' AND id=75 AND field='hp'").fetchone()
    assert row == (45, 900, "verified")
    assert all("raw" not in json.loads(x) for (x,) in con.execute("SELECT extra_json FROM records"))
    con.close()
    assert [(e.domain, e.id, e.field, e.value) for e in load_edits(db)] == [("monster", 75, "hp", 900)]


def test_text_roundtrip():
    assert encode("F-Drake", 8) == bytes([0xBF, 0xF2, 0xBD, 0xE5, 0xD4, 0xDE, 0xD8, 0xFF])
    assert decode(encode("Lv 42.:/!?")) == "Lv 42.:/!?"


def test_cli_monsters(ffl3_rom_path, capsys):
    assert main(["monsters", "--rom", str(ffl3_rom_path)]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 195 and lines[0x4B].startswith("4B 0B:4D9D Sprite ") and "x16" in lines[0xBB]
