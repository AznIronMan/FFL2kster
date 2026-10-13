"""Legend III layouts equal the game's D000 tile buffer after every map load of the intro."""

import pytest

from ffl3kster import layout as L
from ffl3kster.emu import Emulator

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATES = ROOT / "ffl3" / "build" / "states"


def test_map_loads_match(ffl3_rom_path, ffl3_rom):
    pytest.importorskip("pyboy")
    if not (STATES / "battle.state").exists():
        pytest.skip("run python -m ffl3kster make-states")
    snaps = []
    with Emulator(ffl3_rom_path) as e:
        e.load_state(STATES / "battle.state")
        m = e.pb.memory
        e.pb.hook_register(0, 0x0371, lambda _: snaps.append((m[0xC6E8], bytes(m[0xD000:0xE000]),
                                                               bytes(m[0xC760:0xC780]))), None)
        for _ in range(1000):
            e.press("a", wait=30)
        for _ in range(9):
            e.press("down", hold=8, wait=12)
    assert [s[0] for s in snaps] == [0x17, 0x1A, 0x55, 0x1A, 0x16, 0x02, 0x0A, 0x0B, 0x10, 0x0B]
    for mid, ram, flags in snaps:
        tiles, _ = L.map_tiles(ffl3_rom, mid, flags)
        assert tiles == ram[:len(tiles)], hex(mid)


def test_patch_rows_past_the_map_land_after_the_buffer(ffl3_rom_path, ffl3_rom, tmp_path):
    """Map 11 (32 x 16 tiles): the two flag-30 patches (y 10, 7 rows) reach row 16. The game
    writes that row to D200+ (after the 512-byte map) and only when flag 30 is set; the map itself
    equals map_tiles, which drops the row. Reached by pointing door 12 at map 11 (map_change.py)."""
    pytest.importorskip("pyboy")
    if not (STATES / "field.state").exists():
        pytest.skip("run python -m ffl3kster make-states")
    from ffl3kster.rom import bank_to_file
    rom = bytearray(ffl3_rom)
    rom[bank_to_file(0x06, 0x6BA4) + 3 * (0x12 - 1)] = 0x11
    path = tmp_path / "door12.gb"
    path.write_bytes(bytes(rom))
    out = {}
    for flag in (False, True):
        snaps = []
        with Emulator(path) as e:
            e.load_state(STATES / "field.state")
            m = e.pb.memory
            m[0xC766] = (m[0xC766] | 0x80) if flag else (m[0xC766] & 0x7F)
            e.pb.hook_register(0, 0x0371, lambda _: snaps.append(
                (m[0xC6E8], bytes(m[0xD000:0xD220]), bytes(m[0xC760:0xC780]))), None)
            for _ in range(2):
                e.press("down", hold=8, wait=12)
        (mid, ram, flags), = [s for s in snaps if s[0] == 0x11]
        tiles, w = L.map_tiles(bytes(rom), 0x11, flags)
        assert (len(tiles), w) == (512, 32) and tiles == ram[:512]
        out[flag] = ram[512:]
    assert out[True][8:10] == out[True][22:24] == bytes([0x2C, 0x2D])      # the patches' last row
    assert out[False][8:10] != bytes([0x2C, 0x2D]) and out[False][22:24] != bytes([0x2C, 0x2D])
