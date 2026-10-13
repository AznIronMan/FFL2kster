"""Legend I monster table: 06:6AE8, 200 records x 9 bytes (ids 0-199), names 05:4000 + 8*id.

Evidence (docs/ffl1/FINDINGS.md, 2026-10-12):
- Code: the enemy loader 06:5713 computes 0x6AE8 + 9*id (id*8 + id via 06:5C22) in bank 06 and
  copies the record into a 32-byte combatant slot (enemies from D080); party creation copies the
  same record into the party record (CC00) for the monster types (CLIPPER/REDBULL/WERERAT/ZOMBIE).
- Controlled changes on ASIGARU (155) and SKELETON (96, reached by an area-table swap) change only
  the predicted slot bytes; all-0x77 neighbour records (154, 156, 95, 97) change nothing.
- The status screen of a CLIPPER (18) hero shows b2..b5 as Str/Def/Agl/Mana (4/9/7/6 ->
  17/34/51/68 after a controlled change).
- Layout: 200*9 bytes end exactly at the next table (06:71F0, 2 nibbles per id); the ability lists
  (b7/b8, count from b0) are contiguous for all 199 consecutive pairs (06:7321-76E1).
Legend II differs: 0D:6F80, 256 x 10 bytes, HP stored directly (u16), stat order Str/Agl/Mana/Def.
"""

from __future__ import annotations

from dataclasses import dataclass

from ffl2kster.build import Patch

from .. import rom as romlib
from ..text import decode

DOMAIN = "monster"
BANK = 0x06
TABLE = romlib.bank_to_file(BANK, 0x6AE8)
RECORD_SIZE, RECORD_COUNT = 9, 200
NAMES = romlib.bank_to_file(0x05, 0x4000)
NAME_SIZE = 8
HP_CLASSES = romlib.bank_to_file(BANK, 0x7254)   # u16le base HP per class
HP_CLASS_COUNT = 56                               # 06:7254-72C3 (formation table follows)
NIBBLES = romlib.bank_to_file(BANK, 0x71F0)       # one nibble per id, high nibble = even id


@dataclass(frozen=True)
class FieldDef:
    name: str
    offset: int
    size: int
    encoding: str      # u8 | u16le | bits:lo-hi | nibble:hi | nibble:lo
    meaning: str
    status: str        # verified | probable | hypothesis
    evidence: str
    editable: bool = False
    min: int = 0
    max: int = 0xFF


FIELDS = [
    FieldDef("class_bits", 0, 1, "bits:6-7", "creature class flags (10 for 162 ids, 00 for 25, 01 for 13)",
             "hypothesis", "Copied to slot +0 with the rest of b0; meaning not tested."),
    FieldDef("ability_count_minus1", 0, 1, "bits:3-5", "number of ability list entries minus 1", "verified",
             "Code 06:5713: (b0>>3)&7 + 1 loop count. ASIGARU b0 0x00->0x08 adds the 2nd list entry to "
             "slot +0F/+17; lists contiguous for 199/199 pairs.", True, 0, 7),
    FieldDef("low_bits", 0, 1, "bits:0-2", "unknown (3 for 149 ids, 0 for 44, 7 for 7)", "hypothesis",
             "Copied to slot +0 with the rest of b0; meaning not tested."),
    FieldDef("hp_class", 1, 1, "u8", "index into the base-HP table 06:7254; HP = base - rand(0..base>>4)",
             "verified",
             "Code 06:57FA. ASIGARU 0->3 gives HP 79 (82-3), 0->0x15 gives 769 (795-26); SKELETON 0->5 gives "
             "122 (126-4); only slot +3..+6 change.", True, 0, HP_CLASS_COUNT - 1),
    FieldDef("str", 2, 1, "u8", "Strength", "verified",
             "ASIGARU 5->0x11 changes only slot +7; SKELETON 5->0x55 likewise; CLIPPER status screen "
             "Str 4->17.", True),
    FieldDef("def", 3, 1, "u8", "Defense", "verified",
             "ASIGARU 6->0x22 changes only slot +8; CLIPPER status screen Def 9->34.", True),
    FieldDef("agl", 4, 1, "u8", "Agility", "verified",
             "ASIGARU 8->0x33 changes only slot +9; CLIPPER status screen Agl 7->51.", True),
    FieldDef("mana", 5, 1, "u8", "Mana", "verified",
             "ASIGARU 3->0x44 changes only slot +0A; CLIPPER status screen Mana 6->68.", True),
    FieldDef("ability_index", 6, 1, "nibble:hi", "selects slot +0D = byte at slot +0D+n (n=1: first ability)",
             "probable",
             "ASIGARU 0xA1->0x11 sets slot +0D to the first ability id (36). What +0D is used for is not "
             "known yet.", False, 0, 15),
    FieldDef("unknown_6lo", 6, 1, "nibble:lo", "unknown", "hypothesis", "Not referenced by 06:5713."),
    FieldDef("ability_ptr", 7, 2, "u16le", "pointer (bank 06) to the ability id list", "verified",
             "Code 06:5713; ASIGARU ptr 7625->7321 loads FLY's first ability (149); contiguous lists."),
]
FIELD_BY_NAME = {f.name: f for f in FIELDS}
EDITABLE = {f.name for f in FIELDS if f.editable}


def record_offset(mid: int) -> int:
    if not 0 <= mid < RECORD_COUNT:
        raise ValueError(f"monster id {mid} out of range 0..{RECORD_COUNT - 1}")
    return TABLE + RECORD_SIZE * mid


def _bits(spec: str) -> tuple[int, int]:
    lo, hi = spec.split(":")[1].split("-")
    return int(lo), int(hi)


def read_field(rom: bytes, mid: int, name: str) -> int:
    f = FIELD_BY_NAME[name]
    raw = int.from_bytes(rom[record_offset(mid) + f.offset:record_offset(mid) + f.offset + f.size], "little")
    if f.encoding.startswith("bits:"):
        lo, hi = _bits(f.encoding)
        return (raw >> lo) & ((1 << (hi - lo + 1)) - 1)
    if f.encoding == "nibble:hi":
        return raw >> 4
    if f.encoding == "nibble:lo":
        return raw & 0x0F
    return raw


def encode_field(rom: bytes, mid: int, f: FieldDef, value: int) -> bytes:
    if not f.editable:
        raise ValueError(f"field '{f.name}' is not editable in the current schema")
    if not f.min <= value <= f.max:
        raise ValueError(f"{f.name}={value} outside allowed range {f.min}..{f.max}")
    off = record_offset(mid) + f.offset
    if f.encoding.startswith("bits:"):
        lo, hi = _bits(f.encoding)
        mask = ((1 << (hi - lo + 1)) - 1) << lo
        return bytes([(rom[off] & ~mask) | (value << lo)])
    return value.to_bytes(f.size, "little")


def name(rom: bytes, mid: int) -> str:
    return decode(rom[NAMES + NAME_SIZE * mid:NAMES + NAME_SIZE * (mid + 1)]).rstrip()


def base_hp(rom: bytes, cls: int) -> int:
    return rom[HP_CLASSES + 2 * cls] | rom[HP_CLASSES + 2 * cls + 1] << 8


def nibble(rom: bytes, mid: int) -> int:
    b = rom[NIBBLES + mid // 2]
    return b >> 4 if mid % 2 == 0 else b & 0x0F


def extract(rom: bytes) -> list[dict]:
    rows = []
    for mid in range(RECORD_COUNT):
        off = record_offset(mid)
        bank, addr = romlib.file_to_bank(off)
        vals = {f.name: read_field(rom, mid, f.name) for f in FIELDS}
        aoff = romlib.bank_to_file(BANK, vals["ability_ptr"])
        rows.append({
            "id": mid, "name": name(rom, mid), "name_offset": NAMES + NAME_SIZE * mid,
            "record_offset": off, "bank": bank, "address": addr,
            "fields": vals, "base_hp": base_hp(rom, vals["hp_class"]), "nibble": nibble(rom, mid),
            "ability_offset": aoff,
            "abilities": list(rom[aoff:aoff + vals["ability_count_minus1"] + 1]),
        })
    return rows


def resolve(rom: bytes, edit) -> list[Patch]:
    if edit.field not in FIELD_BY_NAME:
        raise ValueError(f"unknown monster field '{edit.field}' (editable: {sorted(EDITABLE)})")
    f = FIELD_BY_NAME[edit.field]
    data = encode_field(rom, edit.id, f, int(edit.value))
    old = read_field(rom, edit.id, f.name)
    reason = f"monster {edit.id} ({name(rom, edit.id)}) {f.name} {old} -> {edit.value}"
    if edit.reason:
        reason += f" [{edit.reason}]"
    return [Patch(record_offset(edit.id) + f.offset, data, reason)]


from . import register  # noqa: E402

register(DOMAIN)(resolve)
