"""Legend I item/ability table: 06:7700, 256 records x 8 bytes; names 05:4000 + 8*(200+id).

Items, weapons, armour, spells and monster abilities share one id space (0-255).
Evidence (docs/ffl1/FINDINGS.md, 2026-10-12):
- Code: 06:5BF2 reads field E of item D at 0x7700 + 8*D + E (bank 06); the battle dispatcher
  06:448F jumps through the handler table 06:403A (49 entries) by field 2.
- Controlled changes: KATANA f3 50->9 sets the enemy's ability uses (slot +16) to 9; LONG f4 3->30
  makes the hero's first hit 30+ (ASIGARU dies in one hit); KATANA f4 6->30 raises the damage the
  hero takes from 12 to 43; KATANA f2 6->3 makes its hit do nothing; STRONG f4 2->9 raises the
  Str gain from +3 to +10; AXE f4 control changes nothing.
- The name entry's 8th byte is the default uses of an item given to a new hero (LONG 50->7
  changes the hero's starting LONG uses); it is not the monster ability uses (control).
Legend II differs: item names and stats live in separate tables (docs/ROM_MAP.md).
"""

from __future__ import annotations

from dataclasses import dataclass

from ffl2kster.build import Patch

from .. import rom as romlib
from ..text import decode

DOMAIN = "item"
TABLE = romlib.bank_to_file(0x06, 0x7700)
RECORD_SIZE, RECORD_COUNT = 8, 256
NAMES = romlib.bank_to_file(0x05, 0x4000) + 8 * 200
NAME_CHARS = 7
HANDLERS = romlib.bank_to_file(0x06, 0x403A)
HANDLER_COUNT = 49


@dataclass(frozen=True)
class FieldDef:
    name: str
    offset: int       # offset in the 8-byte record; -1 = the name entry's 8th byte
    size: int
    encoding: str
    meaning: str
    status: str
    evidence: str
    editable: bool = False
    min: int = 0
    max: int = 0xFF


FIELDS = [
    FieldDef("kind", 0, 1, "u8", "usage class; bit 6 / bit 7 mark passive abilities whose field 5 is OR'd into "
             "combatant +0B / +0C ({43}x 'resist' items have 0x40, {44}x items 0x80)", "probable",
             "Code 06:57B6 tests field 0 bits 6 and 7 and ORs field 5 into FFB7/FFB8 -> slot +0B/+0C; "
             "the other values (01 battle, 02/03 field use, 20/3C equipment) are not tested."),
    FieldDef("flags", 1, 1, "u8", "unknown flags (A0 weapons, 41 armour, 80 spells/guns, C0 group attacks, 00 tools)",
             "hypothesis", "Value groups follow the categories; not tested."),
    FieldDef("handler", 2, 1, "u8", "battle effect handler index (table 06:403A, 49 entries)", "probable",
             "Code 06:448F; KATANA 6->3 turns its hit into no damage.", True, 0, HANDLER_COUNT - 1),
    FieldDef("uses", 3, 1, "u8", "uses of the item as a monster ability (FE = unlimited)", "verified",
             "Code 06:57EF reads field 3 into slot +16..; KATANA 50->9 gives D096 = 9.", True),
    FieldDef("power", 4, 1, "u8", "effect strength (weapon power, stat-item gain base, heal amount, armour: element?)",
             "verified", "LONG 3->30 one-hit kill; KATANA 6->30 hero damage 12->43; STRONG 2->9 Str +3->+10.", True),
    FieldDef("param", 5, 1, "u8", "secondary value (element/status bits for attacks, defence for armour, random spread for stat items)",
             "probable", "STRONG 0x14->0x50 Str gain +3->+6; bits combine into slot +0B/+0C for passive items (code).", True),
    FieldDef("unknown_6", 6, 1, "u8", "unknown (01 swords, 30 consumables, 0B martial arts)", "hypothesis", "Not tested."),
    FieldDef("unknown_7", 7, 1, "u8", "unknown (18 swords, 11 consumables, 01 armour; animation/sound?)", "hypothesis", "Not tested."),
    FieldDef("default_uses", -1, 1, "u8", "uses of the item when it is given to a hero (name entry byte 8)", "verified",
             "LONG name byte 50->7: the new hero's LONG has 7 uses; KATANA name byte change leaves monster uses alone.", True),
]
FIELD_BY_NAME = {f.name: f for f in FIELDS}
EDITABLE = {f.name for f in FIELDS if f.editable}


def record_offset(iid: int) -> int:
    if not 0 <= iid < RECORD_COUNT:
        raise ValueError(f"item id {iid} out of range 0..255")
    return TABLE + RECORD_SIZE * iid


def field_offset(iid: int, f: FieldDef) -> int:
    return NAMES + 8 * iid + 7 if f.offset < 0 else record_offset(iid) + f.offset


def name(rom: bytes, iid: int) -> str:
    return decode(rom[NAMES + 8 * iid:NAMES + 8 * iid + NAME_CHARS]).rstrip()


def extract(rom: bytes) -> list[dict]:
    rows = []
    for iid in range(RECORD_COUNT):
        off = record_offset(iid)
        bank, addr = romlib.file_to_bank(off)
        rows.append({"id": iid, "name": name(rom, iid), "record_offset": off, "bank": bank, "address": addr,
                     "name_offset": NAMES + 8 * iid,
                     "fields": {f.name: rom[field_offset(iid, f)] for f in FIELDS}})
    return rows


def resolve(rom: bytes, edit) -> list[Patch]:
    f = FIELD_BY_NAME.get(edit.field)
    if f is None or not f.editable:
        raise ValueError(f"item field '{edit.field}' is not editable (editable: {sorted(EDITABLE)})")
    v = int(edit.value)
    if not f.min <= v <= f.max:
        raise ValueError(f"{f.name}={v} outside allowed range {f.min}..{f.max}")
    off = field_offset(edit.id, f)
    reason = f"item {edit.id} ({name(rom, edit.id)}) {f.name} {rom[off]} -> {v}"
    if edit.reason:
        reason += f" [{edit.reason}]"
    return [Patch(off, bytes([v]), reason)]


from . import register  # noqa: E402

register(DOMAIN)(resolve)
