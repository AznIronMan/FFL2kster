"""Legend III graphics: picture tables, decoding, export."""

import pytest

from ffl3kster import gfx as G
from ffl3kster import rom as romlib


def test_picture_tables(ffl3_rom):
    assert G.PIC_CODES + 195 == G.PIC_SIZES                          # one code per monster
    assert ffl3_rom[G.PIC_SIZES:G.PIC_SIZES + 6] == bytes([0x10, 0x20, 0x20, 0x30, 0x3E, 0x7C])
    used = {ffl3_rom[G.PIC_CODES + i] >> 3 for i in range(195)}
    assert used == set(range(23)) - {11, 20}
    for s in used - {G.XAGOR_SHEET}:
        tiles = G.picture_sheet(ffl3_rom, s)
        n = ffl3_rom[G.PIC_SIZES + (ffl3_rom[G.PIC_SHEETS + s] & 0x0F)]
        slots = [ffl3_rom[G.PIC_CODES + i] & 7 for i in range(195) if ffl3_rom[G.PIC_CODES + i] >> 3 == s]
        assert all((k + 1) * n <= len(tiles) for k in slots)           # every slot inside its sheet
    with pytest.raises(ValueError):
        G.picture(ffl3_rom, 0xC2)                                      # Xagor: stale-RAM block size


def test_tileset_and_font(ffl3_rom):
    ts = G.map_tileset(ffl3_rom, 0x10)
    assert len(ts) == 0x800 and ts[:0x200] == ffl3_rom[romlib.bank_to_file(5, 0x6000):romlib.bank_to_file(5, 0x6200)]
    assert len(G.font(ffl3_rom)) == 0x800
