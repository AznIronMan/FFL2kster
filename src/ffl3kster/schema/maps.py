"""Legend III maps (bank 06): 192 map records, position warps and the door table.

Code (docs/ffl3/FINDINGS.md, M5): 00:027D loads map C6E8 from 06:6C58 (192 pointers into
06:6DD8-7F68, 171 distinct records, code follows): a 6-byte header, then 6-byte objects up to FF.
  b0 bits 0-6 -> CA15, bit 7 -> CA6C; b1 -> CA1D, the layout (03:731C + 2*b1); b2 -> CA1E;
  b3 -> CA18 (the map's mode, jump table 01:54B1); b4 bits 0-4 -> FFBA (music), bits 5-7 -> the
  encounter rate class (00:119A); b5 -> CA2D, the encounter zone.
Objects (00:05CF): b0 a story flag (0 always, else shown when the flag is set, 00:3CB2), b1 the
script (0A:4004 index) or shop number + 1, b2 x, b3 y, b4 bits 6-7 the type, b5 the sprite.
Doors (event types 0D/0E, 00:1389): 06:6BA4 + 3*(n-1): destination map, x, y (low nibble x16,
bits 4-6 the high byte, bit 7 a facing flag, 00:1468). Position warps (event types 00/01,
00:13F1): 06:6308 + 2*map -> 4-byte entries (block nibbles, map, x, y), ending at the next list.
Evidence: tools/ffl3/map_change.py.
"""

from __future__ import annotations

from ffl2kster.build import Patch

from .. import rom as romlib
from ._table import FieldDef, Table

BANK = 0x06
MAPS, MAP_COUNT = 0x6C58, 192
WARPS = 0x6308
DOORS, DOOR_COUNT = 0x6BA4, 60
MC = "tools/ffl3/map_change.py"


def _p(addr: int) -> int:
    return romlib.bank_to_file(BANK, addr)


def map_pointer(rom: bytes, m: int) -> int:
    if not 0 <= m < MAP_COUNT:
        raise ValueError(f"map {m} out of range 0..{MAP_COUNT - 1}")
    o = _p(MAPS) + 2 * m
    return rom[o] | rom[o + 1] << 8


def objects(rom: bytes, m: int) -> list[bytes]:
    o = _p(map_pointer(rom, m)) + 6
    out = []
    while rom[o] != 0xFF:
        out.append(bytes(rom[o:o + 6]))
        o += 6
    return out


def warps(rom: bytes, m: int) -> list[bytes]:
    ptrs = sorted({rom[_p(WARPS) + 2 * i] | rom[_p(WARPS) + 2 * i + 1] << 8 for i in range(MAP_COUNT)})
    o = _p(WARPS) + 2 * m
    p = rom[o] | rom[o + 1] << 8
    end = next((q for q in ptrs if q > p), DOORS)
    return [bytes(rom[_p(p) + 4 * k:_p(p) + 4 * k + 4]) for k in range((end - p) // 4)]


HEADER_FIELDS = [
    FieldDef("b0", 0, 1, "u8", "bits 0-6 -> CA15, bit 7 -> CA6C (meaning not known)", "probable",
             f"Code 00:02B2. {MC}: 84 -> 85 changes CA15-driven RAM (C2E2.., the bank in C0B1).", True),
    FieldDef("layout", 1, 1, "u8", "layout index (03:731C + 2*n: size, CA19-CA1C, CA17)", "verified",
             f"Code 00:02BE/0306. {MC}: 04 -> 05 changes the map blocks in C2xx.", True),
    FieldDef("b2", 2, 1, "u8", "-> CA1E (meaning not known)", "verified", f"{MC}: 04 -> 05 sets CA1E only.", True),
    FieldDef("mode", 3, 1, "u8", "-> CA18, the map mode (jump table 01:54B1)", "verified",
             f"{MC}: 19 -> 1A sets CA18 only.", True),
    FieldDef("music", 4, 1, "bits:0-4", "music track (FFBA)", "verified",
             f"{MC}: 0B -> 0C changes only the sound driver RAM (CB00..).", True, 0, 31),
    FieldDef("encounter_rate", 4, 1, "bits:5-7", "encounter rate class: 00:119A = 0, 3, 4, 5, 6, 7, 8, 9 (/256 per step)",
             "verified", f"{MC}: class 0 -> 7 gives CA2B = 9 in the Talon.", True, 0, 7),
    FieldDef("encounter_zone", 5, 1, "u8", "encounter zone (CA2D; 03:76C2)", "verified",
             f"{MC}: 00 -> 05 gives CA2D = 5.", True, 0, 75),
]
OBJECT_FIELDS = [
    FieldDef("flag", 0, 1, "u8", "story flag: 0 always shown, else shown when set (00:3CB2)", "probable", "Code 00:05D7."),
    FieldDef("param", 1, 1, "u8", "type 0: script (index into 0A:4004); type 2: shop number + 1 (00:0A2F)", "verified",
             f"{MC}: Talon object 0 E0 -> E1 changes only C372, the object's script byte.", True),
    FieldDef("x", 2, 1, "bits:0-5", "x in 16-pixel steps (bits 6-7: flags)", "probable", "Code 00:0603-0627.", True, 0, 63),
    FieldDef("y", 3, 1, "bits:0-5", "y in 16-pixel steps", "verified",
             f"{MC}: Talon object 4 50 -> 52 moves it 32 px (C244/C2C4 00 -> 20).", True, 0, 63),
    FieldDef("type", 4, 1, "bits:6-7", "what A does: 0 talk (script), 1 09D4, 2 shop, 3 09B7 (00:098A)", "probable",
             "Code 00:064E, 00:098A."),
    FieldDef("sprite", 5, 1, "u8", "sprite: bits 6-7 clear -> set (b & 7) << 4, else (b & 3F) + 60 (00:065B)", "probable",
             "Code 00:065B."),
]


def _map_name(rom: bytes, m: int) -> str:
    return f"map {m:02X}"


class _MapTable:
    """Map headers: fixed fields at a per-map pointer (the records are variable length)."""
    DOMAIN, RECORD_SIZE, RECORD_COUNT = "map", 6, MAP_COUNT
    FIELDS = HEADER_FIELDS
    FIELD_BY_NAME = {f.name: f for f in HEADER_FIELDS}
    EDITABLE = {f.name for f in HEADER_FIELDS if f.editable}

    def record_offset(self, m: int) -> int:
        """Only the id is checked here (the offset needs the ROM: see extract)."""
        if not 0 <= m < MAP_COUNT:
            raise ValueError(f"map {m} out of range 0..{MAP_COUNT - 1}")
        return 0

    def _off(self, rom, m):
        return _p(map_pointer(rom, m))

    def read_field(self, rom, m, name):
        f = self.FIELD_BY_NAME[name]
        raw = rom[self._off(rom, m) + f.offset]
        if f.encoding.startswith("bits:"):
            lo, hi = (int(x) for x in f.encoding.split(":")[1].split("-"))
            return (raw >> lo) & ((1 << (hi - lo + 1)) - 1)
        return raw

    def extract(self, rom: bytes) -> list[dict]:
        rows = []
        for m in range(MAP_COUNT):
            off = self._off(rom, m)
            bank, addr = romlib.file_to_bank(off)
            rows.append({"id": m, "name": _map_name(rom, m), "record_offset": off, "bank": bank, "address": addr,
                         "fields": {f.name: self.read_field(rom, m, f.name) for f in HEADER_FIELDS},
                         "objects": [o.hex(" ") for o in objects(rom, m)],
                         "warps": [w.hex(" ") for w in warps(rom, m)]})
        return rows

    def resolve(self, rom: bytes, edit) -> list[Patch]:
        if edit.field not in self.FIELD_BY_NAME:
            raise ValueError(f"unknown map field '{edit.field}' (editable: {sorted(self.EDITABLE)})")
        f = self.FIELD_BY_NAME[edit.field]
        if not f.editable or not f.min <= int(edit.value) <= f.max:
            raise ValueError(f"map {edit.field}={edit.value} not allowed")
        off = self._off(rom, edit.id) + f.offset
        raw = rom[off]
        if f.encoding.startswith("bits:"):
            lo, hi = (int(x) for x in f.encoding.split(":")[1].split("-"))
            mask = ((1 << (hi - lo + 1)) - 1) << lo
            data = bytes([(raw & ~mask & 0xFF) | int(edit.value) << lo])
        else:
            data = bytes([int(edit.value)])
        reason = f"map {edit.id:#04x} {f.name} {self.read_field(rom, edit.id, f.name)} -> {edit.value}"
        return [Patch(off, data, reason + (f" [{edit.reason}]" if edit.reason else ""))]


MAP = _MapTable()


def _door_name(rom: bytes, n: int) -> str:
    return f"door {n:02X} -> map {rom[_p(DOORS) + 3 * (n - 1)]:02X}"


DOOR = Table("door", BANK, DOORS, 3, DOOR_COUNT, _door_name, [
    FieldDef("map", 0, 1, "u8", "destination map", "verified",
             f"{MC}: door 2D 0B -> 0A takes the Talon's exit to map 0A; door 12 10 -> 11 enters map 11.", True, 0, 191),
    FieldDef("x", 1, 1, "u8", "destination x: low nibble x16, bits 4-6 the high byte, bit 7 facing", "probable", "Code 00:1471."),
    FieldDef("y", 2, 1, "u8", "destination y, same packing", "probable", "Code 00:1491."),
], "doors (event types 0D/0E, numbered from 1)", id_base=1)

TABLES = [MAP, DOOR]

from . import register  # noqa: E402

for _t in TABLES:
    register(_t.DOMAIN)(_t.resolve)


# Shops (event type 16, 00:19AE -> 01:6FD4): shop n = CA28 - 1; n < 40: 01:7804 holds one pointer
# per group of 16 (n >> 4) and the shop is 6 item ids at pointer + 6 * (n & F) (FF none); 40-4F
# have no list; 50+ use 01:7950. The four groups are contiguous, 01:780C-794F.
def _shop_name(rom: bytes, n: int) -> str:
    return f"shop {n:02X}"


def _slots(kind: str) -> list[FieldDef]:
    return [FieldDef(f"item{k + 1}", k, 1, "u8", f"{kind} id for slot {k + 1} (FF none)", "probable",
                     "Code 01:6FF0-7007 (6 bytes to CE2B); every non-FF id is of the group's kind.", True)
            for k in range(6)]


SHOP_WEAPON = Table("shop_weapon", 0x01, 0x780C, 6, 15, _shop_name, _slots("weapon"), "weapon shops 00-0E", id_base=0x00)
SHOP_ARMOR = Table("shop_armor", 0x01, 0x7866, 6, 15, _shop_name, _slots("armor"), "armor shops 10-1E", id_base=0x10)
SHOP_ITEM = Table("shop_item", 0x01, 0x78C0, 6, 9, _shop_name, _slots("item"), "item shops 20-28", id_base=0x20)
SHOP_MAGIC = Table("shop_magic", 0x01, 0x78F6, 6, 15, _shop_name, _slots("spell"), "magic shops 30-3E", id_base=0x30)
SHOPS = [SHOP_WEAPON, SHOP_ARMOR, SHOP_ITEM, SHOP_MAGIC]
TABLES += SHOPS
for _t in SHOPS:
    register(_t.DOMAIN)(_t.resolve)
