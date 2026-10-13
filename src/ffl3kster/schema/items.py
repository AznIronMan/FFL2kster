"""Legend III items, spells and monster skills.

One id space (0x00-0xFE, FF = none) names everything a character can hold or cast; the name is
0E:6D9B + 6*id (icon + 5 letters) for ids 00-2F and 0E:6EBB + 8*(id-0x30) (icon + 7) above
(code 00:1E8F). The record loader 09:5D87 (id in CE26) picks the table by id range and copies 7
bytes into CEDB:
  spell    00-2F  09:5A50  6 bytes
  weapon   30-77  09:55C4  7 bytes
  armor    78-BF  09:5BFC  5 bytes (byte 3, when not FF, is loaded too: 09:5E1F)
  item     C0-DB  09:5B70  5 bytes (loaded only below D8 outside battle mode CD37, 09:5DAB)
With CE25 = 1 the same loader reads monster skills instead (0B:73A2 / 73B1):
  skill    00-6D  09:57BC  6 bytes, names 09:67F7 + 8*id
The five tables are contiguous, 09:55C4-5D63, with code on both sides (55C3 `ret`, 5D64 `xor a`).
Ids DC-FE have names but no record (robot parts, key items).

Evidence: docs/ffl3/FINDINGS.md (2026-10-13, items); tools/ffl3/item_change.py (17/17),
tools/ffl3/equip_change.py (11/11).
Byte 0 of spells, weapons, armor and items packs a status in the low nibble with the order of the
status names at 0E:6D73 (Good, Fell, Ston, Mute, Dark, Pois, Curs, Para, Slep, Conf: Venom 05,
Stone 02, Antedot 05, Soft 02 ...) and an element group in the high nibble (Fire1/Fire2/FireX
3x, Ice 4x, Lit 5x); this is a pattern over the tables, not tested in the game.
"""

from __future__ import annotations

from .. import rom as romlib
from ..text import decode
from ._table import FieldDef, Table

SPELL_NAMES = romlib.bank_to_file(0x0E, 0x6D9B)
ITEM_NAMES = romlib.bank_to_file(0x0E, 0x6EBB)
SKILL_NAMES = romlib.bank_to_file(0x09, 0x67F7)
STATUS_NAMES = romlib.bank_to_file(0x0E, 0x6D73)     # 10 x 4 letters, status order
RACE_NAMES = romlib.bank_to_file(0x0E, 0x6D4F)       # 6 x 6 letters
TC = "tools/ffl3/item_change.py"


def item_name(rom: bytes, iid: int) -> str:
    """Name of a hold/cast id (no icon)."""
    if iid == 0xFF:
        return ""
    if iid < 0x30:
        o = SPELL_NAMES + 6 * iid
        return decode(rom[o + 1:o + 6]).rstrip()
    o = ITEM_NAMES + 8 * (iid - 0x30)
    return decode(rom[o + 1:o + 8]).rstrip()


def item_icon(rom: bytes, iid: int) -> int:
    return rom[SPELL_NAMES + 6 * iid] if iid < 0x30 else rom[ITEM_NAMES + 8 * (iid - 0x30)]


def skill_name(rom: bytes, sid: int) -> str:
    return decode(rom[SKILL_NAMES + 8 * sid:SKILL_NAMES + 8 * sid + 8]).rstrip()


def status_names(rom: bytes) -> list[str]:
    return [decode(rom[STATUS_NAMES + 4 * i:STATUS_NAMES + 4 * i + 4]).rstrip() for i in range(10)]


def race_names(rom: bytes) -> list[str]:
    return [decode(rom[RACE_NAMES + 6 * i:RACE_NAMES + 6 * i + 6]).rstrip() for i in range(6)]


def _attr(desc: str) -> FieldDef:
    return FieldDef("attribute", 0, 1, "u8", "element group << 4 | status (" + desc + ")", "probable",
                    "Pattern over the table (see the module notes); loaded to CEDB.", True)


SPELL = Table("spell", 0x09, 0x5A50, 6, 0x30, item_name, [
    _attr("Fire 3x, Ice 4x, Lit 5x; Venom 05, Stone 02, Sleep 08"),
    FieldDef("power", 1, 1, "u8", "power (Cure1/2/3 3/6/10, Fire1/2/X 26/82/100, Flare 200)", "probable",
             "Ordering across spell tiers; same position as the verified weapon and skill power.", True),
] + [FieldDef(f"b{i}", i, 1, "u8", "not known", "hypothesis", "Code 09:5E94 (6-byte record).") for i in range(2, 6)],
    "spells (ids 00-2F)")

WEAPON = Table("weapon", 0x09, 0x55C4, 7, 0x48, item_name, [
    FieldDef("attribute", 0, 1, "u8", "element group << 4 | status (90 for plain weapons; CatClaw/Poison 05, "
             "Para 07, Petrify 02)", "probable",
             f"Loaded to CEDB+0: {TC} Long and Battle(4B) b0 90->91.", True),
    FieldDef("power", 1, 1, "u8", "attack power", "verified",
             f"{TC}: Long 0A->01 lowers Arthur's hit 20->18; Battle(4B) 07->60 and Bronze(51) 06->60 kill a "
             "Diviner the original leaves at 31/20 HP.", True),
    FieldDef("b2", 2, 1, "u8", "not known (85 for most; 86 Psi/Fast, C5 Defence/Wall, 89/C9/09 the swords "
             "38-3C)", "hypothesis", "Loaded to CEDB+2.", True),
    FieldDef("b3", 3, 1, "u8", "not known (rises with the weapon family: 81 swords .. A8 Nuke)", "hypothesis",
             f"Loaded to CEDB+3 ({TC}: Bronze 8D->8E).", True),
    FieldDef("family", 4, 1, "u8", "weapon family (01 swords, 03 bows, 04 axes, 0C guns ...; follows the "
             "name icon)", "hypothesis", "Loaded to CEDB+4.", True),
    FieldDef("spell", 5, 1, "u8", "spell id or FF, probably an added effect: the names agree for Thunder (Lit 1), "
             "Fire (Fire1), Para (Para), CatClaw and Poison (Venom), not for Fast (Ice 2) or X-Fire (Erase)",
             "hypothesis", "10 non-FF entries, all spell ids (00-2F); loaded to CEDB+5.", True),
    FieldDef("grade", 6, 1, "u8", "not known; rises with quality (Long 1, Battle 2, Silver 4, Gold 5)",
             "hypothesis", f"Loaded to CEDB+6 ({TC}: Long and Battle(4B) b6 01->7F).", True),
], "weapons (ids 30-77)", id_base=0x30)

EC = "tools/ffl3/equip_change.py"
ARMOR = Table("armor", 0x09, 0x5BFC, 5, 0x48, item_name, [
    FieldDef("resist_element", 0, 1, "nibble:hi", "element group resisted: sets a bit in the party record's +36 and "
             "+39 (4 -> 0x10, via 0B:7104)", "verified", f"{EC}: Bronze b0 00->40 sets +36/+39 = 0x10 only.", True, 0, 15),
    FieldDef("resist_status", 0, 1, "nibble:lo", "status resisted: sets a bit in +37 and +3A (5 = Pois -> 0x08)",
             "verified", f"{EC}: Bronze b0 00->05 sets +37/+3A = 0x08 only.", True, 0, 15),
    FieldDef("defence", 1, 1, "nibble:hi", "Defence bonus (+3C, added into +19)", "verified",
             f"{EC}: Bronze b1 32->41 gives Defence 8->9 on the status screen (+19, +3C); Leather 22->32, "
             "unequipped, subtracts 3 instead of 2.", True, 0, 15),
    FieldDef("m_def", 1, 1, "nibble:lo", "M.Def. bonus (+3E)", "verified",
             f"{EC}: Bronze b1 32->41 gives M.Def. 2->1.", True, 0, 15),
    FieldDef("evade", 2, 1, "nibble:hi", "Evade bonus (+3D)", "verified",
             f"{EC}: Bronze b2 33->23 gives Evade 3->2.", True, 0, 15),
    FieldDef("m_evade", 2, 1, "nibble:lo", "M.Evade bonus (+3F)", "verified",
             f"{EC}: Bronze b2 33->35 gives M.Evade 3->5.", True, 0, 15),
    FieldDef("linked", 3, 1, "u8", "id loaded after this record when not FF (SandMan 11 = Sleep, Cool 16 = "
             "Ice 2, Warm 18 = Fire2); no effect on the equip totals", "probable",
             f"Code 09:5E1F-5E3A (CEDE -> CE26, reload). {EC}: Bronze FF->12 changes nothing on equip.", True),
    FieldDef("weight", 4, 1, "u8", "summed over the equipment into +2D, and x10 into the u16 at +28 (meaning not "
             "known; 'weight' is a guess)", "verified",
             f"{EC}: Bronze 03->07 gives +2D 3->7, +28 30->70; Leather 01->05 unequipped gives -1 / -10.", True),
], "armor and accessories (ids 78-BF); the name icon is the slot: A1 shield, A2 helm, A3 armor, A4 gloves, "
   "A5 shoes, A6 others (the Equip screen order)", id_base=0x78)

ITEM = Table("item", 0x09, 0x5B70, 5, 0x1C, item_name, [
    _attr("Soft 02, Throat 03, EyeDrop 04, Antedot 05, Relax 07, Awake 08, Calm 09: the status cured"),
    FieldDef("power", 1, 1, "u8", "power (Cure1/2/3 4/10/25, HP 40)", "probable", "Ordering across tiers."),
] + [FieldDef(f"b{i}", i, 1, "u8", "not known", "hypothesis", "Code 09:5E9F (5-byte record).") for i in range(2, 5)],
    "items (ids C0-DB)", id_base=0xC0)

SKILL = Table("skill", 0x09, 0x57BC, 6, 0x6E, skill_name, [
    FieldDef("attribute", 0, 1, "u8", "as for spells (probable)", "hypothesis",
             f"Loaded to CEDB+0 in skill mode (CE25 = 1): {TC} Dive and Kick b0 00->01.", True),
    FieldDef("power", 1, 1, "u8", "attack power", "verified",
             f"{TC}: Dive 08->20 raises the Sprite's hit on Gloria from 5 to 36 (fatal).", True),
] + [FieldDef(f"b{i}", i, 1, "u8", "not known", "hypothesis",
              f"Loaded to CEDB+{i}" + (f" ({TC}: Dive and Kick b5 81->82)" if i == 5 else "") + ".", True)
     for i in range(2, 6)],
    "monster skills (ids 00-6D, names 09:67F7)")

TABLES = [SPELL, WEAPON, ARMOR, ITEM, SKILL]

from . import register  # noqa: E402

for _t in TABLES:
    register(_t.DOMAIN)(_t.resolve)
