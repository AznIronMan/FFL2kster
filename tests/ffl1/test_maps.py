"""Legend I M5: map records, layouts, event lists, warps, shops."""

from ffl1kster.layout import decode as layout
from ffl1kster.schema import maps as MP


def test_map_records_are_contiguous(ffl1_rom):
    recs = [MP.parse_record(ffl1_rom, i) for i in range(MP.MAP_COUNT)]
    by = sorted({(r["record_offset"], r["length"]) for r in recs})
    assert len(by) == 200
    assert all(a + la == b for (a, la), (b, _) in zip(by, by[1:]))  # format consumes every byte
    assert by[0][0] == 0x9A60 and by[-1][0] + by[-1][1] == 0xA2E3
    w = recs[88]
    assert w["layout"] == 0x4000 and w["zones"] == [0x00, 0x01, 0x04] and "events" not in w
    t = recs[1]
    assert t["events"] == 0x62F0 and t["zones"] == [None, None, None]


def test_event_lists_parse(ffl1_rom):
    recs = [MP.parse_record(ffl1_rom, i) for i in range(MP.MAP_COUNT)]
    lists = sorted({r["events"] for r in recs if "events" in r})
    total = sum(len(MP.parse_events(ffl1_rom, p)) for p in lists)
    assert len(lists) == 99 and total == 498
    town = MP.parse_events(ffl1_rom, 0x62F0)
    npc = [e for e in town if e["kind"] == "object" and (e["x"], e["y"]) == (0x15, 0x21)][0]
    assert (npc["command"], npc["param"]) == (0x01, 0x09)        # dialogue 0x109 - 16 = entry 249 (PyBoy)
    shops = [e for e in town if e["kind"] == "object" and e["command"] == 4 and e["param"] < 0xF0]
    assert {(e["x"], e["y"], e["param"]) for e in shops} >= {(0x1D, 0x11, 0x16)}


def test_layout_of_first_town(ffl1_rom):
    buf = layout(ffl1_rom, 0x5D39)
    assert len(buf) == 64 * 62 and buf[36 * 64 + 18] == 0x0B  # the hero's start tile


def test_warps_shops_prices(ffl1_rom):
    assert MP.warp(ffl1_rom, 0) == {"id": 0, "map": 1, "x": 0x12, "y": 0x24}   # the first town start
    assert MP.WARPS + 3 * MP.WARP_COUNT == 0x985E
    assert MP.shop(ffl1_rom, 0x16) == [0x21, 0x22, 0x2D, 0x5F, 0x59, 0x6B, 0x6C]
    assert MP.price(ffl1_rom, 0x21) == 132 and MP.price(ffl1_rom, 0x24) == 2060 and MP.price(ffl1_rom, 0) == 50


def test_layout_decoder_matches_rom_routine(ffl1_rom):
    """Sample of the full check in tools/ffl1/layout_verify.py (110/110)."""
    import sys
    sys.path.insert(0, "tools/ffl1")
    from layout_verify import oracle
    ptrs = sorted({MP.parse_record(ffl1_rom, m)["layout"] for m in range(MP.MAP_COUNT)})
    for p in ptrs[::14]:
        assert layout(ffl1_rom, p) == oracle(ffl1_rom, p), hex(p)
