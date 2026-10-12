"""Item / weapon / armor / spell / ability table (one id space, 0-255).

Ids 0x00-0x7F are player items (weapons, armor, consumables, spell books, MAGI);
0x80-0xFF are monster abilities. Names: 0F:6640 + 8*id. Evidence: docs/FINDINGS.md
(2026-10-12 items).
"""

from __future__ import annotations

from dataclasses import dataclass

from .. import rom as romlib
from ..build import Patch
from ..text import decode
from .enemies import FieldDef

DOMAIN = "item"
TABLE_OFFSET = 0x32F80        # 0C:6F80, 8 bytes per id
RECORD_SIZE = 8
RECORD_COUNT = 256
USES_OFFSET = 0x33E80         # 0C:7E80, 1 byte per id
PRICE_OFFSET = 0x3F860        # 0F:7860, 3 bytes per id
PRICE_COUNT = 120             # ids 0x00-0x77 (table followed by unrelated data)
NAME_OFFSET = 0x3E640         # 0F:6640

ICONS = {0x9E: "magi", 0x9F: "whip", 0xA0: "heavy-gun", 0xA1: "gun", 0xA3: "shield",
         0xA4: "claw", 0xA5: "spell-book", 0xA6: "spear", 0xA7: "sword", 0xA8: "axe",
         0xA9: "bow", 0xAA: "helmet", 0xAB: "gloves", 0xAC: "armor", 0xAD: "boots",
         0xAE: "spell-book", 0xAF: "item", 0x3C: "resist", 0x3D: "weakness"}

FIELDS = [
    FieldDef("usage", 0, 1, "u8 flags", "use/target class (high nibble flags, low nibble target type)",
             "probable",
             "Controlled change Long A1->B1 makes the action untargeted ('defended'); A1->A2 removes the "
             "attack option. Groups: A1 single-target attacks, 21 group, 31 all, 0x/1x self/ally, 00 armor."),
    FieldDef("flags1", 1, 1, "u8 flags", "unknown flags (08 shields/Defend/Tank, 10 Rune, 01 Revenge/Counter)",
             "hypothesis", "Statistics only."),
    FieldDef("equip", 2, 1, "u8 flags",
             "equipment: low nibble slot (1 helm, 2 body, 4 gloves, 8 boots), 0x40 stat bonus in param, "
             "0x10 resistances in param, 0x80 unknown",
             "probable",
             "0x40 verified: unequipping 11 equipment items subtracted exactly the param-encoded stats. Slot "
             "nibble probable (names). 0x80 contradicted as 'unlimited uses' (martial arts have finite uses)."),
    FieldDef("effect", 3, 1, "u8", "battle action routine id (0x31 STR weapon, 0x14 bow, 0x15 gun, ...)",
             "verified",
             "Controlled change Long 0x31->0x14 (bow routine) turns every hit into 'Missed' (bow accuracy "
             "comes from param=0). Meaning of individual ids: probable, from grouping."),
    FieldDef("power", 4, 1, "u8",
             "weapon/spell power; armor DEF bonus; heal amount for cure items",
             "verified",
             "Long power sweep 7..50 gives damage = 6*power - 25 (STR 6, target DEF 5). Armor: unequip "
             "subtracts exactly this from slot DEF (Bronze 3; patched 30 -> -27).", True, 0, 0xFF),
    FieldDef("param", 5, 1, "u8",
             "effect parameter: element/status bits for attacks (0x80 fire, 0x40 ice, 0x20 thunder, ...), "
             "accuracy for bows/guns, evade for shields, stat bonus (hi nibble 8 STR/4 AGL/2 MANA, lo nibble "
             "amount) when equip&0x40, resistances when equip&0x10",
             "probable",
             "Stat-bonus encoding verified (Giant gloves 8A -> STR+10, Hermes 4A -> AGL+10, Hecate 2F -> "
             "MANA+15, Parasuit CF -> STR+15 AGL+15). Element/accuracy meanings probable from names."),
    FieldDef("anim", 6, 2, "u16le", "presentation (animation / sound / message); unknown split",
             "hypothesis", "Statistics only: swords 0x2088, axes 0x2B90, armor 0x0080, cure items 0x33A3."),
]
FIELD_BY_NAME = {f.name: f for f in FIELDS}
EXTRA = {
    "uses": FieldDef("uses", 0, 1, "u8 @0C:7E80+id", "initial uses (254 = unlimited, shown as '-')",
                     "verified",
                     "Code 0D:4335 loads it for every ability slot; status screen shows Long 50; party slot "
                     "stores (id, uses) pairs.", True, 1, 0xFE),
    "price": FieldDef("price", 0, 3, "u24le @0F:7860+3*id", "shop price in GP (ids 0x00-0x77)",
                      "probable",
                      "Code 01:6678 computes 3*id + 0x7860 in bank 0F; values plausible (Long 400, Cure 50); "
                      "not yet confirmed on a shop screen."),
}
EDITABLE = {"power", "uses"}


def record_offset(iid: int) -> int:
    if not 0 <= iid < RECORD_COUNT:
        raise ValueError(f"item id {iid} out of range 0..255")
    return TABLE_OFFSET + RECORD_SIZE * iid


def name(rom: bytes, iid: int) -> str:
    raw = rom[NAME_OFFSET + 8 * iid:NAME_OFFSET + 8 * iid + 8]
    if raw[0] in ICONS:
        raw = raw[1:]
    return decode(raw)


def icon(rom: bytes, iid: int) -> str | None:
    b = rom[NAME_OFFSET + 8 * iid]
    return ICONS.get(b)


def extract(rom: bytes) -> list[dict]:
    rows = []
    for iid in range(RECORD_COUNT):
        off = record_offset(iid)
        bank, addr = romlib.file_to_bank(off)
        r = rom[off:off + RECORD_SIZE]
        vals = {f.name: int.from_bytes(r[f.offset:f.offset + f.size], "little") for f in FIELDS}
        vals["uses"] = rom[USES_OFFSET + iid]
        price = None
        if iid < PRICE_COUNT:
            p = PRICE_OFFSET + 3 * iid
            price = int.from_bytes(rom[p:p + 3], "little")
        vals["price"] = price
        eq = vals["equip"]
        slot = {1: "helm", 2: "body", 4: "gloves", 8: "boots"}.get(eq & 0x0F) if eq else None
        bonus = None
        if eq & 0x40:
            pv = vals["param"]
            amt = pv & 0x0F
            bonus = {k: amt for k, bit in (("str", 8), ("agl", 4), ("mana", 2)) if (pv >> 4) & bit}
        rows.append({"id": iid, "name": name(rom, iid), "icon": icon(rom, iid),
                     "kind": "monster-ability" if iid >= 0x80 else "item",
                     "record_offset": off, "bank": bank, "address": addr,
                     "fields": vals, "slot": slot, "stat_bonus": bonus})
    return rows


def field_location(iid: int, fname: str) -> tuple[int, int]:
    if fname == "uses":
        return USES_OFFSET + iid, 1
    if fname == "price":
        if iid >= PRICE_COUNT:
            raise ValueError("no price entry for ids >= 0x78")
        return PRICE_OFFSET + 3 * iid, 3
    f = FIELD_BY_NAME[fname]
    return record_offset(iid) + f.offset, f.size


def resolve(rom: bytes, edit) -> list[Patch]:
    f = FIELD_BY_NAME.get(edit.field) or EXTRA.get(edit.field)
    if f is None:
        raise ValueError(f"unknown item field '{edit.field}'")
    if edit.field not in EDITABLE:
        raise ValueError(f"field '{edit.field}' is not editable in the current schema")
    if not f.min <= edit.value <= f.max:
        raise ValueError(f"{f.name}={edit.value} outside allowed range {f.min}..{f.max}")
    off, size = field_location(edit.id, edit.field)
    old = int.from_bytes(rom[off:off + size], "little")
    reason = f"item {edit.id} ({name(rom, edit.id)}) {edit.field} {old} -> {edit.value}"
    if edit.reason:
        reason += f" [{edit.reason}]"
    return [Patch(off, edit.value.to_bytes(size, "little"), reason)]


def add_commands(sub) -> None:
    def cmd_list(a):
        rom = romlib.load_rom(a.rom)
        for r in extract(rom):
            v = r["fields"]
            extra = f" slot={r['slot']}" if r["slot"] else ""
            if r["stat_bonus"]:
                extra += f" bonus={r['stat_bonus']}"
            print(f"{r['id']:3d} {r['name']:12s} {(r['icon'] or ''):10s} usage={v['usage']:02X} "
                  f"eff={v['effect']:02X} pow={v['power']:3d} param={v['param']:02X} "
                  f"uses={v['uses']:3d} price={v['price']}{extra}")
        return 0
    s = sub.add_parser("items", help="list the item/weapon/armor/ability table")
    s.add_argument("--rom", default="input/original.gb")
    s.set_defaults(fn=cmd_list)


from . import register  # noqa: E402

register(DOMAIN, resolve)
