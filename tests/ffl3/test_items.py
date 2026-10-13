"""Legend III item, spell and monster-skill tables (bank 09) and their names (0E, 09)."""

import pytest

from ffl3kster import rom as romlib
from ffl3kster.build import compile_edits
from ffl3kster.project import Edit
from ffl3kster.schema import items as I


def test_tables_contiguous_and_code_bounded(ffl3_rom):
    order = [I.WEAPON, I.SKILL, I.SPELL, I.ITEM, I.ARMOR]
    for a, b in zip(order, order[1:]):
        assert a.END == b.TABLE
    assert I.WEAPON.TABLE == romlib.bank_to_file(9, 0x55C4) and I.ARMOR.END == romlib.bank_to_file(9, 0x5D64)
    assert ffl3_rom[I.WEAPON.TABLE - 1] == 0xC9                       # ret
    assert ffl3_rom[I.ARMOR.END:I.ARMOR.END + 4] == bytes([0xAF, 0xEA, 0x25, 0xCE])  # xor a; ld [CE25],a
    assert [t.ids for t in (I.SPELL, I.WEAPON, I.ARMOR, I.ITEM)] == [
        range(0, 0x30), range(0x30, 0x78), range(0x78, 0xC0), range(0xC0, 0xDC)]


def test_names(ffl3_rom):
    n = lambda i: I.item_name(ffl3_rom, i)
    assert (n(0x00), n(0x2F), n(0x30), n(0x4B), n(0x51), n(0x77)) == ("Cure1", "Flare", "Long", "Battle", "Bronze", "Laser")
    assert (n(0x78), n(0xBF), n(0xC0), n(0xDB), n(0xFF)) == ("Bronze", "Warm", "Cure1", "E-Ray", "")
    assert n(0x10) == "Ice 1" and n(0x1A) == "Lit 2"
    assert (I.skill_name(ffl3_rom, 0), I.skill_name(ffl3_rom, 0x13), I.skill_name(ffl3_rom, 0x1A),
            I.skill_name(ffl3_rom, 0x6D)) == ("Nail", "Kick", "Dive", "Counter")
    assert I.status_names(ffl3_rom) == ["Good", "Fell", "Ston", "Mute", "Dark", "Pois", "Curs", "Para", "Slep", "Conf"]
    assert I.race_names(ffl3_rom) == ["Robot", "Cyborg", "Beast", "Monst.", "Human", "Mutant"]
    # icons: spells A7/A8/A9 in three groups of 16
    assert [I.item_icon(ffl3_rom, i) for i in (0x00, 0x0F, 0x10, 0x1F, 0x20, 0x2F)] == [0xA7, 0xA7, 0xA8, 0xA8, 0xA9, 0xA9]


def test_known_records(ffl3_rom):
    W, S = I.WEAPON, I.SKILL
    assert [W.read_field(ffl3_rom, 0x30, f) for f in ("attribute", "power", "family", "spell", "grade")] == [0x90, 10, 1, 0xFF, 1]
    assert W.read_field(ffl3_rom, 0x4B, "power") == 7 and W.read_field(ffl3_rom, 0x51, "power") == 6
    assert S.read_field(ffl3_rom, 0x1A, "power") == 8 and S.read_field(ffl3_rom, 0x13, "power") == 6
    # status-cure items line up with the status order (02 stone .. 09 confusion)
    assert [I.ITEM.read_field(ffl3_rom, i, "attribute") for i in range(0xC3, 0xCA)] == [2, 3, 4, 5, 7, 8, 9]
    assert [I.status_names(ffl3_rom)[i] for i in (2, 3, 4, 5, 7, 8, 9)] == ["Ston", "Mute", "Dark", "Pois", "Para", "Slep", "Conf"]
    # every weapon spell byte is FF or a spell id; every armor link is FF or a spell id
    assert all(W.read_field(ffl3_rom, i, "spell") in list(range(0x30)) + [0xFF] for i in W.ids)
    assert all(I.ARMOR.read_field(ffl3_rom, i, "linked") in list(range(0x30)) + [0xFF] for i in I.ARMOR.ids)
    # armor nibbles: Leather 22 22, Bronze body armor 32 33
    assert [I.ARMOR.read_field(ffl3_rom, 0x91, f) for f in ("defence", "m_def", "evade", "m_evade", "weight")] == [3, 2, 3, 3, 3]
    assert {I.item_icon(ffl3_rom, i) for i in range(0x90, 0xA0)} == {0xA3}   # body armor slot icon
    # power tiers
    p = lambda i: I.SPELL.read_field(ffl3_rom, i, "power")
    assert p(0x00) < p(0x04) < p(0x08) and p(0x12) < p(0x18) < p(0x28)


def test_edits_compile(ffl3_rom):
    ps = compile_edits(ffl3_rom, [Edit("weapon", 0x30, "power", 1), Edit("skill", 0x1A, "power", 0x20)])
    assert [(p.offset, p.data) for p in ps] == [(I.WEAPON.TABLE + 1, b"\x01"), (I.SKILL.TABLE + 6 * 0x1A + 1, b"\x20")]
    with pytest.raises(ValueError):
        I.WEAPON.record_offset(0x2F)
    with pytest.raises(ValueError):
        compile_edits(ffl3_rom, [Edit("spell", 0x00, "b2", 1)])   # not editable
