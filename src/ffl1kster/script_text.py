"""Legend I dialogue/message text: the fixed-width name encoding plus a two-character dictionary.

Verified 2026-10-12 (docs/ffl1/FINDINGS.md): the intro text at 05:7758 decodes completely with
- 0x50-0x7F -> dictionary pairs 0-47 and 0xC0-0xE7 -> pairs 48-87; the 88 pairs (2 bytes each,
  name encoding) follow the name table at 05:4E40 (name index 456);
- 0x80-0xBD letters/digits, 0xFF space (as in names), 0xF0 '.', 0xBF ',', 0xBE apostrophe;
- 0x00-0x4F control codes (0x00 end, 0x0A/0x0D line breaks; others take arguments, see FINDINGS).
Legend II uses one block 0x4E-0x9D for its dictionary (0F:6560).
"""

from __future__ import annotations

from . import rom as romlib
from .text import decode as decode_name

DICT = romlib.bank_to_file(0x05, 0x4E40)
DICT_SIZE = 88
PUNCT = {0xF0: ".", 0xBF: ",", 0xBE: "'", 0xF2: "-"}


def pairs(rom: bytes) -> list[str]:
    return [decode_name(rom[DICT + 2 * i:DICT + 2 * i + 2]) for i in range(DICT_SIZE)]


def pair_index(c: int) -> int | None:
    if 0x50 <= c <= 0x7F:
        return c - 0x50
    if 0xC0 <= c <= 0xE7:
        return c - 0xC0 + 48
    return None


def decode(rom: bytes, data: bytes, controls: bool = True) -> str:
    p = pairs(rom)
    out = []
    for c in data:
        k = pair_index(c)
        if k is not None:
            out.append(p[k])
        elif 0x80 <= c <= 0xBD or c == 0xFF:
            out.append(decode_name(bytes([c])))
        elif c in PUNCT:
            out.append(PUNCT[c])
        elif controls:
            out.append("{%02X}" % c)
    return "".join(out)
