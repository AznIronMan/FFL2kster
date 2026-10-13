"""Legend III in the emulator: armor through the Equip menu, the status screen words, and EXP."""

import os
import re
import tempfile

import pytest

from ffl3kster.emu import Emulator
from ffl3kster.schema import items as I
from ffl3kster.schema import monsters as M

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATES = ROOT / "ffl3" / "build" / "states"
WORD = re.compile(r"(Attack|Defence|Agility|Magic|Hit|M\.Def\.|M\.Evade|Evade) *(\d+)")


@pytest.fixture(scope="module")
def states(ffl3_rom_path):
    pytest.importorskip("pyboy")
    if not (STATES / "menu.state").exists():
        from ffl3kster.states import make_states
        make_states(ffl3_rom_path, STATES, log=lambda *_: None)
    return STATES


def _rom(ffl3_rom, patches):
    rom = bytearray(ffl3_rom)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    return path


def _equip_bronze(ffl3_rom, states, patches=()):
    path = _rom(ffl3_rom, patches)
    try:
        with Emulator(path) as e:
            e.load_state(states / "menu.state")
            m = e.pb.memory
            m[0xC705], m[0xC706] = 0x91, 1                      # one Bronze body armor in the inventory
            for b in ["down"] * 4 + ["a", "a", "down", "right", "a", "down", "down", "down", "a"]:
                e.press(b, wait=40)
            rec = bytes(m[0xC500:0xC560])
            for b in ["b", "b", "up", "a", "a"]:
                e.press(b, wait=50)
            words = {w: int(v) for r in e.screen_text() for w, v in WORD.findall(r)}
            return rec, words
    finally:
        os.remove(path)


def test_status_screen_and_equip(ffl3_rom, states):
    rec, words = _equip_bronze(ffl3_rom, states)
    assert rec[0x43] == 0x91 and list(rec[0x18:0x1C]) == [6, 8, 4, 5]
    assert words == {"Attack": 6, "Defence": 8, "Agility": 4, "Magic": 5, "Hit": 76, "Evade": 3, "M.Def.": 2, "M.Evade": 3}
    o = I.ARMOR.record_offset(0x91)
    rec2, words2 = _equip_bronze(ffl3_rom, states, [(o + 1, 0x41), (o + 2, 0x25)])
    assert (words2["Defence"], words2["M.Def."], words2["Evade"], words2["M.Evade"]) == (9, 1, 2, 5)
    assert [i for i in range(0x60) if rec[i] != rec2[i]] == [0x19, 0x3C, 0x3D, 0x3E, 0x3F]


def _exp(ffl3_rom, states, patches=()):
    path = _rom(ffl3_rom, patches)
    try:
        with Emulator(path) as e:
            e.load_state(states / "pre_battle.state")
            e.wait_for_text("Fight", 900, 5)
            for _ in range(400):
                e.press("a", wait=30)
                g = re.search(r"(\d+) EXP", " ".join(e.screen_text()))
                if g:
                    return int(g.group(1))
    finally:
        os.remove(path)


def test_exp_is_the_sum_of_byte_1_over_4(ffl3_rom, states):
    o = M.MONSTER_CLASS.record_offset(0x46) + 1
    assert _exp(ffl3_rom, states) == (2 * 15 + 2 * 14) // 4
    assert _exp(ffl3_rom, states, [(o, 0x30)]) == (2 * 0x30 + 2 * 14) // 4
