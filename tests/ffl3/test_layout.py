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
