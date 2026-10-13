"""Legend I meat (monster transformation) tables, bank 02, read by 00:0D9C.

Verified 2026-10-12 (docs/ffl1/FINDINGS.md): a CLIPPER hero eating ASIGARU meat becomes a LIZARD,
as predicted from these tables; changing the result entry, the family-level entry, the meat's
level and the meat's family each changes the outcome exactly as predicted; a neighbouring result
entry changes nothing.
- family(id): byte 02:7900+id -> [0, 7, 18, 27][(b >> 4) & 7] + (b & 15)  (group starts at 00:0E16)
- result family: 02:6FD3 + 29*eater_family + meat_family (25 monster families x 29; FF = nothing)
- level(id): low nibble of 02:7438+id
- new monster: 02:72A8 + 16*result_family + max(level(eater), level(meat))  (25 x 16)
Only a hero whose party byte 0x0A has bit 6 set can eat (monsters). The drop chance is the monster
record's b0 bits 0-2 out of 8 (one meat per battle), see schema/monsters.py.
Legend II's meat system: docs/ROM_MAP.md (different tables and formula).
"""

from __future__ import annotations

from .. import rom as romlib

FAMILY_BYTES = romlib.bank_to_file(0x02, 0x7900)
GROUP_STARTS = 0x0E16            # 00:0E16, 4 bytes
RESULTS = romlib.bank_to_file(0x02, 0x6FD3)
RESULT_ROWS, RESULT_COLS = 25, 29
FAMILY_LEVELS = romlib.bank_to_file(0x02, 0x72A8)
LEVELS = romlib.bank_to_file(0x02, 0x7438)
NO_RESULT = 0xFF


def family(rom: bytes, mid: int) -> int:
    b = rom[FAMILY_BYTES + mid]
    return rom[GROUP_STARTS + ((b >> 4) & 7)] + (b & 15)


def level(rom: bytes, mid: int) -> int:
    return rom[LEVELS + mid] & 15


def result_family(rom: bytes, eater_family: int, meat_family: int) -> int:
    if not (0 <= eater_family < RESULT_ROWS and 0 <= meat_family < RESULT_COLS):
        raise ValueError("family out of range")
    return rom[RESULTS + RESULT_COLS * eater_family + meat_family]


def family_monster(rom: bytes, fam: int, lvl: int) -> int:
    return rom[FAMILY_LEVELS + 16 * fam + lvl]


def predict(rom: bytes, eater: int, meat: int) -> int | None:
    """Monster id the eater becomes, or None ("Nothing happened")."""
    r = result_family(rom, family(rom, eater), family(rom, meat))
    if r == NO_RESULT:
        return None
    return family_monster(rom, r, max(level(rom, eater), level(rom, meat)))


def extract(rom: bytes) -> dict:
    return {
        "families": [family(rom, i) for i in range(200)],
        "levels": [level(rom, i) for i in range(200)],
        "results": [[result_family(rom, e, m) for m in range(RESULT_COLS)] for e in range(RESULT_ROWS)],
        "family_levels": [[family_monster(rom, f, l) for l in range(16)] for f in range(RESULT_ROWS)],
    }
