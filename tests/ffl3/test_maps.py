"""Legend III maps, objects, warps, doors and shops (structure)."""

from ffl3kster import rom as romlib
from ffl3kster.schema import items as I
from ffl3kster.schema import maps as M


def test_map_records_framed(ffl3_rom):
    ptrs = [M.map_pointer(ffl3_rom, m) for m in range(M.MAP_COUNT)]
    starts = sorted(set(ptrs))
    assert len(starts) == 171 and starts[0] == 0x6DD8
    for a, b in zip(starts, starts[1:]):
        m = ptrs.index(a)
        assert a + 6 + 6 * len(M.objects(ffl3_rom, m)) + 1 == b        # header, objects, FF
    last = starts[-1] + 6 + 6 * len(M.objects(ffl3_rom, ptrs.index(starts[-1]))) + 1
    assert last == 0x7F69


def test_warps_and_doors(ffl3_rom):
    wp = sorted({ffl3_rom[romlib.bank_to_file(6, M.WARPS) + 2 * i] | ffl3_rom[romlib.bank_to_file(6, M.WARPS) + 2 * i + 1] << 8
                 for i in range(M.MAP_COUNT)})
    assert wp[0] == M.WARPS + 2 * M.MAP_COUNT and all((b - a) % 4 == 0 for a, b in zip(wp, wp[1:]))
    assert M.DOORS - wp[-1] == 4                                         # one entry, then the doors
    assert M.DOOR.END == romlib.bank_to_file(6, M.MAPS)                  # doors end at the map table
    for m in range(M.MAP_COUNT):
        assert all(w[1] < M.MAP_COUNT for w in M.warps(ffl3_rom, m))
    assert all(r["fields"]["map"] < M.MAP_COUNT for r in M.DOOR.extract(ffl3_rom))
    assert [r["fields"]["map"] for r in M.DOOR.extract(ffl3_rom)][0x12 - 1:0x12] == [0x10]   # into the Talon


def test_headers(ffl3_rom):
    rows = M.MAP.extract(ffl3_rom)
    assert rows[0x10]["fields"] == {"b0": 0x84, "layout": 4, "b2": 4, "mode": 0x19, "music": 0x0B,
                                    "encounter_rate": 0, "encounter_zone": 0}
    assert all(r["fields"]["encounter_zone"] < 76 for r in rows)
    objs = [bytes.fromhex(o) for r in rows for o in r["objects"]]
    talk = [o for o in objs if o[4] >> 6 == 0]
    assert len(objs) == 656 and len(talk) == 324
    assert [o.hex() for o in talk if o[1] >= 239] == ["06f40a160002", "00eff73c0401"]   # beyond 0A:4004 (unexplained)


def test_shops(ffl3_rom):
    kinds = {"shop_weapon": range(0x30, 0x78), "shop_armor": range(0x78, 0xC0), "shop_item": range(0xC0, 0xDC),
             "shop_magic": range(0x00, 0x30)}
    for t in M.SHOPS:
        for r in t.extract(ffl3_rom):
            ids = [v for v in r["fields"].values() if v != 0xFF]
            assert ids and all(i in kinds[t.DOMAIN] for i in ids)
    assert M.SHOP_WEAPON.TABLE == romlib.bank_to_file(1, 0x780C) and M.SHOP_MAGIC.END == romlib.bank_to_file(1, 0x7950)
    assert [I.item_name(ffl3_rom, v) for v in M.SHOP_ITEM.extract(ffl3_rom)[0]["fields"].values()] == \
        ["Cure1", "Cure2", "Cure3", "Magic", "Tent", "Elixir"]
