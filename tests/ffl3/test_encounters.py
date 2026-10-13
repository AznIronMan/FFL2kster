"""Legend III encounter zones and formations."""

from ffl3kster import rom as romlib
from ffl3kster.schema import encounters as E


def test_layout(ffl3_rom):
    assert ffl3_rom[E.THRESHOLDS:E.THRESHOLDS + 6] == bytes([0xE5, 0xBF, 0x8C, 0x4C, 0x26, 0x0C])
    assert E.THRESHOLDS + 6 == E.ZONE.TABLE
    assert ffl3_rom[E.RATES:E.RATES + 8] == bytes([0, 3, 4, 5, 6, 7, 8, 9])
    assert E.ZONE.END == romlib.bank_to_file(3, 0x78D6)
    assert ffl3_rom[E.ZONE.END:E.ZONE.END + 3] == bytes([0x11, 0xF8, 0x78])      # code: ld de,$78F8
    assert E.FORMATION.TABLE + 5 * 0x7F + 4 == romlib.bank_to_file(0x0B, 0x780A)  # jp $780A target


def test_zone_slots_point_at_real_formations(ffl3_rom):
    used = {v & 0x7F for r in E.ZONE.extract(ffl3_rom) for v in r["fields"].values()}
    assert max(used) == 0x72 and all(u < E.FORMATION.RECORD_COUNT for u in used)
    for f in range(E.FORMATION.RECORD_COUNT):
        ids = ffl3_rom[E.FORMATION.record_offset(f):E.FORMATION.record_offset(f) + 3]
        assert ids[0] < 0xC3 and all(i < 0xC3 or i == 0xFF for i in ids)
    assert E.FORMATION.name(ffl3_rom, 1) == "Diviner + Sprite"          # the prologue battle
    assert E.FORMATION.name(ffl3_rom, 0) == "Hooligan + F-Drake"
