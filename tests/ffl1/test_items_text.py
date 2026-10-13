"""Legend I item table (06:7700, 8 x 256) and the dialogue text decoder."""

import pytest

from ffl1kster.build import build
from ffl1kster.project import Edit, load_project
from ffl1kster.schema import items as I
from ffl1kster import script_text as T


def test_item_layout(ffl1_rom):
    assert I.TABLE == 0x1B700 and I.TABLE + 8 * 256 <= 0x1BF62  # ends before the jump stubs 06:7F62
    rows = I.extract(ffl1_rom)
    by = {r["id"]: r for r in rows}
    assert by[0x21]["name"].endswith("LONG") and by[0x21]["fields"]["power"] == 3
    assert by[0x24]["fields"]["uses"] == 50 and by[0x24]["fields"]["handler"] == 6
    assert by[0x89]["name"] == "PINCER" and by[0x89]["fields"]["default_uses"] == 20
    assert by[0x00]["name"] == "POTION"
    assert max(r["fields"]["handler"] for r in rows) < I.HANDLER_COUNT


def test_handler_table_points_into_bank6_code(ffl1_rom):
    ptrs = [ffl1_rom[I.HANDLERS + 2 * i] | ffl1_rom[I.HANDLERS + 2 * i + 1] << 8 for i in range(I.HANDLER_COUNT)]
    assert ptrs == sorted(ptrs) and all(0x4400 <= p < 0x5100 for p in ptrs)
    nxt = ffl1_rom[I.HANDLERS + 2 * I.HANDLER_COUNT] | ffl1_rom[I.HANDLERS + 2 * I.HANDLER_COUNT + 1] << 8
    assert not 0x4400 <= nxt < 0x5100  # entry 49 is not a handler


def test_default_uses_edit_targets_name_entry(ffl1_rom_path, ffl1_project, tmp_path):
    r = build(ffl1_rom_path, load_project(ffl1_project), tmp_path / "o.gb",
              edits=[Edit("item", 0x21, "default_uses", 7), Edit("item", 0x24, "power", 30)])
    offs = sorted(c["offset"] for c in r["changes"] if c["offset"] > 0x150)
    assert offs == [0x14000 + 8 * (200 + 0x21) + 7, 0x1B700 + 8 * 0x24 + 4]


def test_item_edit_rejected_for_untested_field(ffl1_rom_path, ffl1_project, tmp_path):
    with pytest.raises(ValueError):
        build(ffl1_rom_path, load_project(ffl1_project), tmp_path / "o.gb", edits=[Edit("item", 1, "unknown_7", 1)])


def test_intro_text_decodes(ffl1_rom):
    s = T.decode(ffl1_rom, ffl1_rom[0x17758:0x17758 + 200])
    assert s.startswith("It has been said{0A} that the tower in{0A} the center of the{0A} World is connected")
    assert len(T.pairs(ffl1_rom)) == 88 and T.pairs(ffl1_rom)[:4] == ["  ", "e ", "he", " t"]


def test_battle_messages_decode(ffl1_rom):
    assert "you found{0D} meat of {38}" in T.decode(ffl1_rom, ffl1_rom[0xB6C1:0xB6CE])
    assert T.decode(ffl1_rom, ffl1_rom[0xB5D8:0xB5EA]).startswith("{0D} CRITICAL HIT")


def test_meat_tables_predict_observed(ffl1_rom):
    from ffl1kster.schema import meat as MT
    assert MT.predict(ffl1_rom, 18, 155) == 66             # CLIPPER + ASIGARU meat -> LIZARD (PyBoy)
    assert MT.RESULTS + 25 * 29 == MT.FAMILY_LEVELS        # 25 x 29 results end at the family-level table
    assert MT.FAMILY_LEVELS + 25 * 16 == MT.LEVELS         # 25 x 16 family levels end at the level table
    fam0 = [MT.family_monster(ffl1_rom, 0, l) for l in range(16)]
    assert fam0[0] == 0 and fam0[-1] == 5                  # FLY .. MANTIS
    # the meat-family index (02:7900) and the result rows (02:72A8) are different numberings:
    # FLY's meat family is 15 while FLY sits in result row 0 (falsified "same index" assumption)
    assert MT.family(ffl1_rom, 0) == 15
