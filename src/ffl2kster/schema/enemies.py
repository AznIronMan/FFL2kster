"""Monster/enemy stats table (shared by enemies, party monsters, guests and bosses).

Evidence summary (details in docs/FINDINGS.md / docs/ROM_MAP.md):
- Code: 0D:42xx (party load) and 0D:44F4 (enemy load) compute 0x6F80 + 10*id in bank 0D;
  0D:44F4 also copies the name from 0F:6EC0 + 8*id.
- Controlled single-byte changes to records 120 (Jaguar) and 45 (Spider) change exactly
  the predicted bytes of the enemy group block at WRAM 0xD500; neighbour-record controls
  change nothing.
- In-battle RAM matches the table for ids 45, 120, 180, 185; party slots match ids 240, 225.
"""

from __future__ import annotations

from dataclasses import dataclass

from .. import rom as romlib
from ..build import Patch
from ..text import decode

DOMAIN = "enemy"
TABLE_OFFSET = 0x36F80          # bank 0D : 6F80
RECORD_SIZE = 10
RECORD_COUNT = 256
NAME_OFFSET = 0x3EEC0           # bank 0F : 6EC0
NAME_SIZE = 8
ITEM_NAME_BASE = 0x3E640        # bank 0F : 6640, 8 bytes per name id (ability names)
ABILITY_BANK = 0x0D

TYPES = {0: "human", 1: "mutant", 2: "monster", 3: "robot"}


@dataclass(frozen=True)
class FieldDef:
    name: str
    offset: int
    size: int
    encoding: str
    meaning: str
    status: str            # verified | probable | hypothesis
    evidence: str
    editable: bool = False
    min: int = 0
    max: int = 0xFF


FIELDS = [
    FieldDef("type", 0, 1, "high nibble", "creature class: 0 human, 1 mutant, 2 monster, 3 robot",
             "probable",
             "Location verified: party-load code stores (byte0>>4) into the party slot. Meaning "
             "probable: Human/Mutant/Monster/Robot entries 240-247 read 0/1/2/3."),
    FieldDef("ability_count_minus1", 0, 1, "low nibble", "number of ability entries minus 1",
             "verified",
             "Code: 'and $0f; inc a' loop count. Controlled change Jaguar 0x20->0x21 adds the next "
             "list byte to the enemy ability slots (D515). Matches pointer deltas for 247/256 ids."),
    FieldDef("unknown_1", 1, 1, "u8", "unknown; 0 in all 256 records",
             "hypothesis",
             "Controlled change 0x00->0x05 on Jaguar alters only the scratch copy at DE01; no "
             "battle-block effect observed."),
    FieldDef("hp", 2, 2, "u16le", "maximum HP",
             "verified",
             "Code copies to party HP cur/max. Controlled changes (Jaguar 45->99, 45->301; Spider "
             "45->99) change only group max HP D50C/D and derived per-enemy HP. RAM matches ids "
             "45,120,180,185,225,240.", True, 1, 0xFFFF),
    FieldDef("str", 4, 1, "u8", "Strength", "verified",
             "Controlled change Jaguar 6->32 changes only D50E (+scratch). Party status screen shows "
             "this byte as STR (RAM experiment 11/22/33/44).", True),
    FieldDef("agl", 5, 1, "u8", "Agility", "verified",
             "Controlled change Jaguar 5->33 changes only D50F. Status screen shows it as AGL.", True),
    FieldDef("mana", 6, 1, "u8", "Mana", "verified",
             "Controlled change Jaguar 3->34 changes only D510. Status screen shows it as MANA; "
             "robots have 0 here.", True),
    FieldDef("def", 7, 1, "u8", "Defense", "verified",
             "Controlled changes Jaguar 5->35 / Spider 5->49 change only D511. Status screen shows "
             "it as DEF.", True),
    FieldDef("ability_ptr", 8, 2, "u16le", "pointer (bank 0D) to the ability id list",
             "verified",
             "Code reads it after the stats; controlled change of the low byte changes only the "
             "first ability slot D512. Lists are contiguous for 247/256 ids."),
]
FIELD_BY_NAME = {f.name: f for f in FIELDS}
EDITABLE = {f.name for f in FIELDS if f.editable}


def record_offset(eid: int) -> int:
    if not 0 <= eid < RECORD_COUNT:
        raise ValueError(f"enemy id {eid} out of range 0..{RECORD_COUNT - 1}")
    return TABLE_OFFSET + RECORD_SIZE * eid


def read_field(rom: bytes, eid: int, name: str) -> int:
    f = FIELD_BY_NAME[name]
    off = record_offset(eid) + f.offset
    raw = int.from_bytes(rom[off:off + f.size], "little")
    if f.encoding == "high nibble":
        return raw >> 4
    if f.encoding == "low nibble":
        return raw & 0x0F
    return raw


def ability_name(rom: bytes, aid: int) -> str:
    o = ITEM_NAME_BASE + 8 * aid
    return decode(rom[o:o + 8])


def extract(rom: bytes) -> list[dict]:
    rows = []
    for eid in range(RECORD_COUNT):
        off = record_offset(eid)
        bank, addr = romlib.file_to_bank(off)
        vals = {f.name: read_field(rom, eid, f.name) for f in FIELDS}
        ptr = vals["ability_ptr"]
        cnt = vals["ability_count_minus1"] + 1
        aoff = romlib.bank_to_file(ABILITY_BANK, ptr)
        abil = list(rom[aoff:aoff + cnt])
        rows.append({
            "id": eid,
            "name": decode(rom[NAME_OFFSET + NAME_SIZE * eid:NAME_OFFSET + NAME_SIZE * (eid + 1)]),
            "name_offset": NAME_OFFSET + NAME_SIZE * eid,
            "record_offset": off, "bank": bank, "address": addr,
            "raw_record": rom[off:off + RECORD_SIZE].hex(),
            "fields": vals,
            "type_name": TYPES.get(vals["type"], "?"),
            "ability_offset": aoff,
            "abilities": [{"id": a, "name": ability_name(rom, a)} for a in abil],
        })
    return rows


def encode_value(f: FieldDef, value: int) -> bytes:
    if not f.editable:
        raise ValueError(f"field '{f.name}' is not editable in the current schema")
    if not f.min <= value <= f.max:
        raise ValueError(f"{f.name}={value} outside allowed range {f.min}..{f.max}")
    return value.to_bytes(f.size, "little")


def resolve(rom: bytes, edit) -> list[Patch]:
    if edit.field not in FIELD_BY_NAME:
        raise ValueError(f"unknown enemy field '{edit.field}' (editable: {sorted(EDITABLE)})")
    f = FIELD_BY_NAME[edit.field]
    data = encode_value(f, edit.value)
    off = record_offset(edit.id) + f.offset
    name = decode(rom[NAME_OFFSET + NAME_SIZE * edit.id:NAME_OFFSET + NAME_SIZE * (edit.id + 1)])
    old = int.from_bytes(rom[off:off + f.size], "little")
    reason = f"enemy {edit.id} ({name}) {f.name} {old} -> {edit.value}"
    if edit.reason:
        reason += f" [{edit.reason}]"
    return [Patch(off, data, reason)]


def add_commands(sub) -> None:
    import json

    def cmd_list(a):
        rom = romlib.load_rom(a.rom)
        for r in extract(rom):
            v = r["fields"]
            print(f"{r['id']:3d} {r['bank']:02X}:{r['address']:04X} {r['name']:9s} {r['type_name']:7s} "
                  f"HP {v['hp']:5d} STR {v['str']:3d} AGL {v['agl']:3d} MANA {v['mana']:3d} "
                  f"DEF {v['def']:3d}  " + ",".join(x["name"] for x in r["abilities"]))
        return 0

    def cmd_export(a):
        rom = romlib.load_rom(a.rom)
        data = {"source_sha256": romlib.sha256(rom),
                "fields": [f.__dict__ for f in FIELDS], "records": extract(rom)}
        with open(a.out, "w") as fh:
            json.dump(data, fh, indent=1)
        print(f"wrote {a.out}")
        return 0

    s = sub.add_parser("enemies", help="list the enemy/monster stats table")
    s.add_argument("--rom", default="input/original.gb")
    s.set_defaults(fn=cmd_list)
    s = sub.add_parser("enemies-export", help="export decoded enemy table to JSON (scratch)")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--out", default="project/scratch/enemies.json")
    s.set_defaults(fn=cmd_export)


from . import register  # noqa: E402

register(DOMAIN, resolve)
