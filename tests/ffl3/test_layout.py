"""Legend III map layouts: decompression and metatile expansion (00:0F42), flag patches (0B:78F5)."""

import pytest

from ffl3kster import layout as L


def test_every_layout_decompresses_to_its_size(ffl3_rom):
    ends = {}
    for n in range(1, 32):
        i = L.info(ffl3_rom, n)
        assert i["width"] in (16, 32, 64) and i["tiles"] % i["width"] == 0
        assert len(L.metatile_map(ffl3_rom, n)) == i["tiles"] // 4          # one metatile per 2x2 tiles
        assert len(L.tilemap(ffl3_rom, n)) == i["tiles"]
        ends.setdefault(i["bank"], []).append(i["data"])
    for bank, spans in ends.items():
        assert all(a[1] == b[0] for a, b in zip(spans, spans[1:]))         # contiguous per bank
    with pytest.raises(ValueError):
        L.location(32)


def test_patches(ffl3_rom):
    assert len(L.patches(ffl3_rom, 0x10)) == 6 and all(f != 0xFF for f, _ in L.patches(ffl3_rom, 0x10))
    assert [f for f, _ in L.patches(ffl3_rom, 0x0B)] == [0xFF, 0xFF]


def test_patched_maps_keep_their_size(ffl3_rom):
    from ffl3kster.schema.maps import MAP_COUNT
    for flags in (bytes(32), b"\xff" * 32):
        for m in range(MAP_COUNT):
            try:
                tiles, w = L.map_tiles(ffl3_rom, m, flags)
            except ValueError:
                continue
            assert len(tiles) % w == 0 and len(tiles) == len(L.tilemap(ffl3_rom, ffl3_rom[_map_off(ffl3_rom, m)] & 0x7F))
    # map 11's flag-30 patches reach row 16 of a 16-row layout: that row is dropped
    full, w = L.map_tiles(ffl3_rom, 0x11, b"\xff" * 32)
    assert len(full) == 512 and w == 32


def _map_off(rom, m):
    from ffl3kster import rom as R
    from ffl3kster.schema.maps import map_pointer
    return R.bank_to_file(0x06, map_pointer(rom, m))
