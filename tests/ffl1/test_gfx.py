"""Legend I M6 graphics: structure (no emulator) and equality with PyBoy's VRAM."""

import pytest

from ffl1kster import gfx
from ffl1kster.schema import maps as MP

from .conftest import ROOT


def test_graphics_tables_are_contiguous():
    assert gfx.TILESETS + gfx.TILESET_SIZE * 16 == 0x8000 + 0x0820         # then the set pointers
    assert MP.ATTRIBUTES + 64 * 40 == gfx.SPRITE_SETS                       # attributes x 40
    assert gfx.SPRITE_SETS + 6 * gfx.SPRITE_SET_COUNT <= MP.WARPS


def test_pictures(ffl1_rom):
    p = gfx.picture(ffl1_rom, 155)
    assert (p["class"], p["index"], p["tiles"], p["width"]) == (1, 13, 24, 4) and p["offset"] == 0x11A80
    last = gfx.picture(ffl1_rom, 198)            # class 4 ends exactly at the end of bank 04
    assert last["offset"] + 48 * 16 == 0x14000
    assert all(len(gfx.picture(ffl1_rom, m)["data"]) == 16 * gfx.picture(ffl1_rom, m)["tiles"] for m in range(200))


def test_font_letters(ffl1_rom):
    a = gfx.font_tile(ffl1_rom, 0x8A)
    assert a == bytes.fromhex("00001c1c1c1c141436363e3e63636363")


@pytest.mark.emu
@pytest.mark.parametrize("state,mapid", [("first_town", 1), ("world", 88)])
def test_tiles_equal_vram(ffl1_rom_path, ffl1_rom, state, mapid):
    pytest.importorskip("pyboy")
    from ffl1kster.emu import Emulator
    with Emulator(ffl1_rom_path) as e:
        e.load_state(ROOT / "ffl1/build/states" / f"{state}.state")
        m = e.pb.memory
        bg, spr = bytes(m[0x8800:0x9000]), bytes(m[0x8100:0x8800])
        tiles = gfx.tileset(ffl1_rom, MP.parse_record(ffl1_rom, mapid)["graphics"])
        diff = [t for t in range(128) if tiles[16 * t:16 * t + 16] != bg[16 * t:16 * t + 16]]
        assert diff == ([] if state == "first_town" else [0, 1, 2, 3])   # world: animated water tiles
        assert gfx.sprite_set(ffl1_rom, m[0xFFFA]) == spr


@pytest.mark.emu
def test_battle_picture_and_font(ffl1_rom_path, ffl1_rom):
    pytest.importorskip("pyboy")
    from ffl1kster.emu import Emulator
    with Emulator(ffl1_rom_path) as e:
        e.load_state(ROOT / "ffl1/build/states/battle.state")
        v = bytes(e.pb.memory[0x8000:0x9800])
    p = gfx.picture(ffl1_rom, 155)["data"]
    assert v[0x800:0x800 + len(p)] == p                                   # BG tiles 0x80.. (8800)
    ok = [c for c in range(0x80, 0xF7) if v[0x1000 + 16 * (c - 0x80):][:16] == gfx.font_tile(ffl1_rom, c)]
    assert len(ok) == 0xF7 - 0x80
