"""Legend III graphics equal to VRAM: map tilesets at every map load of the intro, the font,
and monster pictures in battle (the prologue, and battles forced in the Talon)."""

import os
import tempfile

import pytest

from ffl3kster import gfx as G
from ffl3kster import rom as romlib
from ffl3kster.emu import Emulator

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATES = ROOT / "ffl3" / "build" / "states"


@pytest.fixture(scope="module")
def states(ffl3_rom_path):
    pytest.importorskip("pyboy")
    if not (STATES / "talon.state").exists():
        pytest.skip("run python -m ffl3kster make-states")
    return STATES


def test_tilesets_at_map_loads(ffl3_rom_path, ffl3_rom, states):
    snaps = []
    with Emulator(ffl3_rom_path) as e:
        e.load_state(states / "battle.state")
        m = e.pb.memory
        e.pb.hook_register(0, 0x053B, lambda _: snaps.append((m[0xC6E8], bytes(m[0x9000:0x9800]),
                                                               bytes(m[0x8800:0x9000]))), None)
        for _ in range(1000):
            e.press("a", wait=30)
    assert len(snaps) == 8
    for mid, bg, font in snaps:
        assert G.map_tileset(ffl3_rom, mid) == bg, hex(mid)
        assert G.font(ffl3_rom) == font


def _vram_tiles(rom_bytes, state, force_ids=None):
    fd, path = tempfile.mkstemp(suffix=".gb")
    rom = bytearray(rom_bytes)
    if force_ids:                                    # zone 0 -> formation 85 (fixed counts) with these ids
        for k in range(7):
            rom[romlib.bank_to_file(3, 0x76C2) + k] = 0x85
        f5 = romlib.bank_to_file(0x0B, 0x758B) + 5 * 5
        rom[f5:f5 + 3] = bytes(force_ids + [0xFF] * (3 - len(force_ids)))
        rom[f5 + 4] = 0
    os.write(fd, bytes(rom)); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(state)
            m = e.pb.memory
            if force_ids:
                m[0xCA2B], m[0xCA2D] = 0xFF, 0
                for b in ["right", "left"] * 4:
                    e.press(b, hold=8, wait=12)
                    if m[0xCA2C]:
                        break
                e.pb.tick(500, False)
            return [bytes(m[0x9000 + 16 * k:0x9010 + 16 * k]) for k in range(128)]
    finally:
        os.remove(path)


def _contains(vram, pic):
    return any(vram[i:i + len(pic)] == pic for i in range(len(vram) - len(pic) + 1))


def test_prologue_pictures(ffl3_rom, states):
    v = _vram_tiles(ffl3_rom, states / "battle.state")
    assert v[:32] == G.picture(ffl3_rom, 0x46) and v[32:48] == G.picture(ffl3_rom, 0x4B)


@pytest.mark.parametrize("mid", [0x0D, 0x04, 0xBB, 0xBC])   # sizes 1, 0, 3, 4
def test_forced_battle_pictures(ffl3_rom, states, mid):
    assert _contains(_vram_tiles(ffl3_rom, states / "talon.state", [mid]), G.picture(ffl3_rom, mid))
