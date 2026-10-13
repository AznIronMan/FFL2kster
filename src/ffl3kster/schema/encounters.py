"""Legend III random encounters: zones (03:76C2, 7 slots x 76) and formations (0B:758B, 5 bytes).

Code (docs/ffl3/FINDINGS.md, M4): each finished step (01:4609) encounters when rand (00:39D5) <
CA2B, the map's rate (00:02EA: map byte bits 5-7 -> 00:119A {0, 3, 4, ... 9}); 00:10F5 then takes
zone CA2D (+1/+2 for vehicle states C6E3 1/2/4+, 00:1186), rolls again and counts the thresholds at
03:76BC (E5 BF 8C 4C 26 0C) that exceed the roll: slot 0 (r >= E5) .. slot 6 (r < 0C). The slot's
low 7 bits are the formation; 00:1126 copies its 5 bytes to CC59: three monster ids (FF none),
CC5C, CC5D. Slot bit 7: counts from CC5D (2-bit fields, bits 5-4 / 3-2 / 1-0, +1) instead of the
size-based random counts of 0B:5A9A. Scripted battles use the same formations (0B:4094).
Evidence: tools/ffl3/encounter_change.py (14/14).
"""

from __future__ import annotations

from .. import rom as romlib
from ._table import FieldDef, Table
from .monsters import name as monster_name

THRESHOLDS = romlib.bank_to_file(0x03, 0x76BC)
RATES = 0x119A            # bank 0: 8 rate classes
EC = "tools/ffl3/encounter_change.py"


def _zone_name(rom: bytes, z: int) -> str:
    return f"zone {z}"


def _formation_name(rom: bytes, f: int) -> str:
    o = romlib.bank_to_file(0x0B, 0x758B) + 5 * f
    return " + ".join(monster_name(rom, i) for i in rom[o:o + 3] if i != 0xFF)


ZONE = Table("zone", 0x03, 0x76C2, 7, 76, _zone_name, [
    FieldDef(f"slot{k}", k, 1, "u8", f"formation for roll band {k} (bit 7: fixed counts)",
             "verified" if k in (0, 6) else "probable",
             f"{EC}: " + ("thresholds 00 select slot 0" if k == 0 else "thresholds FF select slot 6" if k == 6 else
                          "same mechanism") + "; zone 0 all slots -> 05 gives Turtle + Orc-Orc.", True)
    for k in range(7)
], "encounter zones (76; 03:78D6 is code)")

FORMATION = Table("formation", 0x0B, 0x758B, 5, 0x7F, _formation_name, [
    FieldDef("monster1", 0, 1, "u8", "group 1 monster id", "verified", f"{EC}: formation 00 78 -> 46 (CC59).", True),
    FieldDef("monster2", 1, 1, "u8", "group 2 monster id", "verified", f"{EC}: formation 00 04 -> 4B (CC5A).", True),
    FieldDef("monster3", 2, 1, "u8", "group 3 monster id (FF none)", "verified", f"{EC}: formation 00 FF -> 0D (CC5B).", True),
    FieldDef("flags", 3, 1, "u8", "copied to CC5C (40 in the prologue; bosses 50/51/D1/E3); 0B:4000 reads bits 4-5",
             "probable", f"{EC}: formation 00 byte 3 00 -> 40 sets CC5C only.", True),
    FieldDef("counts", 4, 1, "u8", "CC5D: fixed counts when the slot has bit 7 (2-bit fields +1, see the module "
             "notes); bits 7-6 cap the random counts (0B:5A9A)", "verified",
             f"{EC}: byte 4 00/20/14/04 give counts 2-2 / 6-2 / 4-4 / 2-4 (two groups, doubled), 15 gives 2-2-2.", True),
], "battle formations (0-7E; byte 4 of 7F overlaps code at 0B:780A)")

TABLES = [ZONE, FORMATION]

from . import register  # noqa: E402

for _t in TABLES:
    register(_t.DOMAIN)(_t.resolve)
