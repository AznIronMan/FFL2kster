"""Legend III item tables in the emulator: record loads (09:5D87 -> CEDB) and weapon / skill power."""

import os
import tempfile

import pytest

from ffl3kster.emu import Emulator
from ffl3kster.schema import items as I

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATE = ROOT / "ffl3" / "build" / "states" / "battle.state"


def _play(rom_bytes, presses):
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, rom_bytes); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(STATE)
            m, loads = e.pb.memory, {}
            e.pb.hook_register(9, 0x5D82, lambda _: loads.setdefault((m[0xCE25], m[0xCE26]), bytes(m[0xCEDB:0xCEE2])), None)
            hp = []
            for _ in range(presses):
                e.press("a", wait=40)
                hp.append([m[0xD290 + 0x80 * k] | m[0xD291 + 0x80 * k] << 8 for k in range(4)] +
                          [m[0xD010 + 0x80 * k] | m[0xD011 + 0x80 * k] << 8 for k in range(4)])
            return loads, hp
    finally:
        os.remove(path)


@pytest.fixture(scope="module")
def base(ffl3_rom):
    pytest.importorskip("pyboy")
    if not STATE.exists():
        pytest.skip("run python -m ffl3kster make-states")
    return _play(ffl3_rom, 72)


def test_loads_are_the_records(ffl3_rom, base):
    loads, _ = base
    assert set(loads) == {(0, 0x30), (0, 0x46), (0, 0x4B), (0, 0x51), (1, 0x13), (1, 0x1A)}
    for (mode, iid), got in loads.items():
        t = I.SKILL if mode else I.WEAPON
        o = t.record_offset(iid)
        assert got == ffl3_rom[o:o + 7]           # 7 bytes copied; a skill's 7th is the next record's b0


def test_power_changes_damage(ffl3_rom, base):
    _, hp = base
    rom = bytearray(ffl3_rom)
    rom[I.WEAPON.record_offset(0x4B) + 1] = 0x60  # Curtis's Battle 7 -> 96
    _, hp_w = _play(bytes(rom), 50)
    rom = bytearray(ffl3_rom)
    rom[I.SKILL.record_offset(0x1A) + 1] = 0x20   # the Sprites' Dive 8 -> 32
    _, hp_s = _play(bytes(rom), 30)
    assert hp[45][1] == 31 and hp_w[45][1] == 0   # Curtis on Diviner 2: 14 vs fatal
    assert hp_w[:45] == hp[:45]
    assert hp[28][6] == 31 and hp_s[28][6] == 0   # Dive on Gloria: 5 vs fatal
    assert hp_s[:28] == hp[:28]
