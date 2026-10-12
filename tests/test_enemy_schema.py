from ffl2kster.schema import enemies as E
from ffl2kster.project import Edit


def test_table_geometry(rom_bytes):
    rows = E.extract(rom_bytes)
    assert len(rows) == 256
    assert E.TABLE_OFFSET + 256 * E.RECORD_SIZE == 0x37980
    # the first ability list starts immediately after the table
    assert rows[0]["fields"]["ability_ptr"] == 0x7980


def test_ability_lists_contiguous(rom_bytes):
    rows = E.extract(rom_bytes)
    ok = sum(1 for a, b in zip(rows, rows[1:])
             if b["fields"]["ability_ptr"] - a["fields"]["ability_ptr"]
             == a["fields"]["ability_count_minus1"] + 1)
    assert ok >= 246  # 247/256 incl. last; exceptions documented in FINDINGS


KNOWN = {  # id: (name, hp, str, agl, mana, def) -- cross-checked against emulator RAM
    45: ("Spider", 45, 5, 5, 5, 5),
    120: ("Jaguar", 45, 6, 5, 3, 5),
    180: ("Asigaru", 120, 5, 5, 2, 6),
    185: ("Gang", 45, 5, 7, 3, 4),
    225: ("Teacher", 185, 18, 15, 19, 18),
    240: ("Human  M", 59, 6, 5, 3, 3),
}


def test_known_records(rom_bytes):
    rows = E.extract(rom_bytes)
    for eid, (name, hp, s, a, m, d) in KNOWN.items():
        r = rows[eid]
        assert r["name"] == name
        f = r["fields"]
        assert (f["hp"], f["str"], f["agl"], f["mana"], f["def"]) == (hp, s, a, m, d)


def test_names_and_abilities(rom_bytes):
    rows = E.extract(rom_bytes)
    assert rows[0]["name"] == "Fungus" and rows[255]["name"] == "Arsenal"
    assert [x["name"] for x in rows[30]["abilities"]][0] == "Dissolve"   # Slime
    assert [x["name"] for x in rows[120]["abilities"]] == ["Tusk"]        # Jaguar


def test_field_definitions_complete():
    covered = set()
    for f in E.FIELDS:
        covered.update(range(f.offset, f.offset + f.size))
        assert f.status in ("verified", "probable", "hypothesis")
        assert f.evidence
    assert covered == set(range(E.RECORD_SIZE))
    assert E.EDITABLE == {"hp", "str", "agl", "mana", "def"}
    assert all(E.FIELD_BY_NAME[n].status == "verified" for n in E.EDITABLE)


def test_resolve_offsets(rom_bytes):
    (p,) = E.resolve(rom_bytes, Edit("enemy", 120, "hp", 200))
    assert p.offset == 0x37432 and p.data == bytes([200, 0])
    (p,) = E.resolve(rom_bytes, Edit("enemy", 45, "def", 9))
    assert p.offset == 0x36F80 + 450 + 7 and p.data == bytes([9])
