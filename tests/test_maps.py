from ffl2kster.schema import maps as M


def test_destination_table(rom_bytes):
    assert len(M.all_headers(rom_bytes)) == 212
    d = M.dest_record(rom_bytes, 21)          # used by the first-town door (hooked 00:1C61)
    assert d["header"] == 0x486B and d["offset"] == 0x1C054


def test_first_town_triggers_match_observed_transitions(rom_bytes):
    h = M.header(rom_bytes, 0x4833)
    assert not h["encounters"] and len(h["triggers"]) == 7
    got = {}
    for t in h["triggers"]:
        d = M.dest_record(rom_bytes, t["index"])
        got[t["tile"]] = (d["header"], d["x"], d["y"])
    # explorer jumps (tools/explore.py): building entrances landed at these positions
    assert got[0x40] == (0x489D, 25, 21)
    assert {got[k] for k in (0x43, 0x44, 0x45, 0x46)} == {(0x486B, 8, 11), (0x486B, 40, 11),
                                                          (0x486B, 8, 43), (0x486B, 40, 43)}


def test_world_header(rom_bytes):
    h = M.header(rom_bytes, 0x4807)
    assert h["encounters"] and h["zone"] == 0 and h["rate"] == 0x0A and len(h["triggers"]) == 14


def test_tile_attributes_first_town(rom_bytes):
    """Town tileset 0: path metatile 0x12 walkable, surrounding 0x16 blocked (the RAM copy at
    C520 equals this row; RAM controlled change 01→03 on 0x12 stops the player)."""
    t = M.tile_attributes(rom_bytes, M.header(rom_bytes, 0x4833)["b2"])
    assert not t[0x12]["blocks_walking"] and t[0x16]["blocks_walking"]
