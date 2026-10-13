"""Legend III monster tables, bank 0B, indexed by monster id 0-194 (0xC2), names 0E:7533 + 8*id.

  monster          0B:4A19 + 12*id   the battle record (HP, value 2, stats, ...)
  monster_class    0B:470D +  4*id   level and three more bytes
  monster_ability  0B:533D +  9*id   a bit mask and 8 ability ids
The three tables are contiguous (470D + 4*195 = 4A19, 4A19 + 12*195 = 533D, 533D + 9*195 = 5A18)
and the name table holds exactly 195 names before the staff credits text.

Evidence (docs/ffl3/FINDINGS.md, 2026-10-13):
- Code: the enemy loader 0B:4526/453A (id from CC70) copies the name (rst $18 x=E2: two 4-byte
  copies from 0E:7533 + 8*id) and the record into the staging entity D680 (0x80 bytes); 0B:45CB
  loads the ability list and the class record; 0B:468B copies the entity once per enemy of the
  group into D280, D300, ...
- Controlled changes (tools/ffl3/controlled_change.py, prologue battle Diviner 0x46 x2 and Sprite
  0x4B x2, 28/28 pass): every listed field changes exactly the predicted entity bytes of its
  group and nothing else; all-0x77 records 0x45, 0x47, 0x4A, 0x4C change nothing; a RAM poke of
  the loader id shows the x16 HP for ids >= 0xBB (Maitreya 375 -> 6000) and not for 0xBA.
Field meanings that only rest on the copy target are marked hypothesis.
"""

from __future__ import annotations

from dataclasses import dataclass

from ffl2kster.build import Patch

from .. import rom as romlib
from ..text import decode

COUNT = 195
BOSS_FROM = 0xBB          # 0B:45AB: ids >= BB have HP and value 2 multiplied by 16
NAMES = romlib.bank_to_file(0x0E, 0x7533)
NAME_SIZE = 8
PROFILE_469D = romlib.bank_to_file(0x0B, 0x469D)   # 16 x 4 bytes, index = b2 >> 4
PROFILE_46DD = romlib.bank_to_file(0x0B, 0x46DD)   # 3-byte entries, index = b4 >> 4 (10-15 read zeros)


@dataclass(frozen=True)
class FieldDef:
    name: str
    offset: int
    size: int
    encoding: str      # u8 | bits:lo-hi | nibble:hi | u12 (byte, then the low nibble of the next)
    meaning: str
    status: str        # verified | probable | hypothesis
    evidence: str
    editable: bool = False
    min: int = 0
    max: int = 0xFF


def _bits(spec: str) -> tuple[int, int]:
    lo, hi = spec.split(":")[1].split("-")
    return int(lo), int(hi)


class Table:
    def __init__(self, domain, bank, addr, size, fields, doc):
        self.DOMAIN, self.BANK, self.RECORD_SIZE, self.RECORD_COUNT = domain, bank, size, COUNT
        self.TABLE = romlib.bank_to_file(bank, addr)
        self.FIELDS = fields
        self.FIELD_BY_NAME = {f.name: f for f in fields}
        self.EDITABLE = {f.name for f in fields if f.editable}
        self.__doc__ = doc

    def record_offset(self, mid: int) -> int:
        if not 0 <= mid < COUNT:
            raise ValueError(f"monster id {mid} out of range 0..{COUNT - 1}")
        return self.TABLE + self.RECORD_SIZE * mid

    def read_field(self, rom: bytes, mid: int, name: str) -> int:
        f = self.FIELD_BY_NAME[name]
        o = self.record_offset(mid) + f.offset
        if f.encoding == "u12":
            return rom[o] | (rom[o + 1] & 0x0F) << 8
        raw = rom[o]
        if f.encoding.startswith("bits:"):
            lo, hi = _bits(f.encoding)
            return (raw >> lo) & ((1 << (hi - lo + 1)) - 1)
        if f.encoding == "nibble:hi":
            return raw >> 4
        return raw

    def encode_field(self, rom: bytes, mid: int, f: FieldDef, value: int) -> bytes:
        if not f.editable:
            raise ValueError(f"field '{f.name}' is not editable in the current schema")
        if not f.min <= value <= f.max:
            raise ValueError(f"{f.name}={value} outside allowed range {f.min}..{f.max}")
        o = self.record_offset(mid) + f.offset
        if f.encoding == "u12":
            return bytes([value & 0xFF, (rom[o + 1] & 0xF0) | value >> 8])
        if f.encoding.startswith("bits:"):
            lo, hi = _bits(f.encoding)
            mask = ((1 << (hi - lo + 1)) - 1) << lo
            return bytes([(rom[o] & ~mask & 0xFF) | (value << lo)])
        if f.encoding == "nibble:hi":
            return bytes([(rom[o] & 0x0F) | value << 4])
        return bytes([value])

    def extract(self, rom: bytes) -> list[dict]:
        rows = []
        for mid in range(COUNT):
            off = self.record_offset(mid)
            bank, addr = romlib.file_to_bank(off)
            rows.append({"id": mid, "name": name(rom, mid), "record_offset": off, "bank": bank, "address": addr,
                         "raw": rom[off:off + self.RECORD_SIZE].hex(" "),
                         "fields": {f.name: self.read_field(rom, mid, f.name) for f in self.FIELDS}})
        return rows

    def resolve(self, rom: bytes, edit) -> list[Patch]:
        if edit.field not in self.FIELD_BY_NAME:
            raise ValueError(f"unknown {self.DOMAIN} field '{edit.field}' (editable: {sorted(self.EDITABLE)})")
        f = self.FIELD_BY_NAME[edit.field]
        data = self.encode_field(rom, edit.id, f, int(edit.value))
        old = self.read_field(rom, edit.id, f.name)
        reason = f"{self.DOMAIN} {edit.id:#04x} ({name(rom, edit.id)}) {f.name} {old} -> {edit.value}"
        if edit.reason:
            reason += f" [{edit.reason}]"
        return [Patch(self.record_offset(edit.id) + f.offset, data, reason)]


def name(rom: bytes, mid: int) -> str:
    return decode(rom[NAMES + NAME_SIZE * mid:NAMES + NAME_SIZE * (mid + 1)]).rstrip()


CC = "tools/ffl3/controlled_change.py"
MONSTER = Table("monster", 0x0B, 0x4A19, 12, [
    FieldDef("kind", 0, 1, "bits:0-2", "kind; 4 keeps b9-b11 (0B:729B), other kinds have them recomputed from the "
             "entity's item list by 0B:7422. 4 = ids 00-3B and B4-C2 (74), 3 = 60, 1 = 30, 0 = 30, 2 = 1",
             "verified", f"Code 0B:454D -> entity +0D. {CC}: Sprite 03->05 and Diviner 03->06 change only +0D; "
             "Sprite 03->04 also keeps b9-b11 at +3D..+3F (02 09 05).", True, 0, 7),
    FieldDef("b0_high", 0, 1, "bits:3-7", "unused bits (0 in all 195 records; masked off by 0B:454D)", "probable",
             "Code: and $07."),
    FieldDef("hp", 1, 2, "u12", "HP (current +10/+11 and max +12/+13); x16 for ids >= 0xBB", "verified",
             f"Code 0B:4556/45AB. {CC}: Sprite b1 2D->7F gives HP 127, b2 C0->C3 gives 0x32D, Diviner b1 "
             "likewise; RAM poke id BB: 375 -> 6000 (x16), id BA: 4000 (x1).", True, 1, 0xFFF),
    FieldDef("profile_a", 2, 1, "nibble:hi", "index into 0B:469D (4 bytes -> entity +59..+5C); meaning not known",
             "verified", f"Code 0B:4588. {CC}: Sprite b2 C0->10 loads 469D+4.. into +59..+5C only.", True, 0, 15),
    FieldDef("value2", 3, 2, "u12", "second 12-bit value (current +14/+15, max +16/+17; x16 for ids >= 0xBB); "
             "MP is a guess: Chaos and Maitreya spend 20 of it before the first menu", "verified",
             f"Code 0B:4563/45AB. {CC}: Sprite b3 31->55 and b4 F0->F2 change +14..+17 only.", True, 0, 0xFFF),
    FieldDef("profile_b", 4, 1, "nibble:hi", "index into 0B:46DD (3 bytes -> entity +5D..+5F; 10-15 read zeros, "
             "15 is used by 139 records)", "verified",
             f"Code 0B:4597. {CC}: Sprite b4 F0->30 loads 46DD+9.. into +5D..+5F only.", True, 0, 15),
] + [
    FieldDef(f"stat{i + 1}", 5 + i, 1, "u8",
             "battle stat -> entity +%02X and +%02X%s (probably Str/Def/Agl/Mana in some order)"
             % (0x18 + i, 0x70 + i, "; also +57 = (stat3 + level)/2 + 0x4B" if i == 2 else ""),
             "verified", f"Code 0B:4573-457D (two 4-byte copies). {CC}: Sprite b{5 + i} changes only +{0x18 + i:02X} "
             f"and +{0x70 + i:02X}" + (" and +57" if i == 2 else "") + ".", True) for i in range(4)
] + [
    FieldDef(f"bonus{i + 1}", 9 + i, 1, "u8", f"entity +{0x3D + i:02X}, kept only for kind 4 (otherwise recomputed "
             "from the item list, which is empty for monsters, so 0)", "verified",
             f"Code 0B:457F, 0B:7422. {CC}: kind 3 change ignored; kind 4 Sprite b9-11 -> 5A 6B 7C and Diviner "
             "b11 -> 66 reach +3D..+3F.", True) for i in range(3)
], "battle record")

MONSTER_CLASS = Table("monster_class", 0x0B, 0x470D, 4, [
    FieldDef("level", 0, 1, "bits:0-5", "level (entity +03; also +57 and the battle values C996/C9D4/C9ED); "
             "'level' is a guess from the range 1-42", "verified",
             f"Code 0B:4643. {CC}: Sprite C1->C5 sets +03 = 5, +57, C996 1->3, C9D4 4->12, C9ED 1->3.", True, 0, 63),
    FieldDef("class_bits", 0, 1, "bits:6-7", "entity +0F and +68; meaning not known", "verified",
             f"Code 0B:464B. {CC}: Sprite C1->41 sets +0F/+68 = 1 only.", True, 0, 3),
] + [
    FieldDef(f"c{i + 1}", 1 + i, 1, "u8", f"entity +{0x65 + i:02X}; meaning not known", "verified",
             f"Code 0B:4665. {CC}: Sprite 0E 0E C0 -> 11 22 33 changes only +65..+67.", True) for i in range(3)
], "class record")

MONSTER_ABILITY = Table("monster_ability", 0x0B, 0x533D, 9, [
    FieldDef("mask", 0, 1, "u8", "bit 7-k set: slot k is a battle ability (copied to the next free byte from "
             "entity +48); clear: an id >= 0x30 goes to D6C0, a lower id to 0B:6E74", "probable",
             "Code 0B:45F4-4626 (not changed in an emulator test yet)."),
] + [
    FieldDef(f"slot{k + 1}", 1 + k, 1, "u8", "ability id (FF: none)", "verified" if k == 0 else "probable",
             (f"{CC}: Sprite slot1 1A->1B (mask bit set) changes only +48. " if k == 0 else "") +
             "Code 0B:45F8.", True) for k in range(8)
], "ability list")

TABLES = [MONSTER, MONSTER_CLASS, MONSTER_ABILITY]

from . import register  # noqa: E402

for _t in TABLES:
    register(_t.DOMAIN)(_t.resolve)
