"""Legend I fixed-width name encoding (docs/ffl1/ROM_MAP.md).

0x8A-0xA3 'A'-'Z', 0xA4-0xBD 'a'-'z', 0x80-0x89 '0'-'9', 0xFF space/padding (verified: the
name table 05:4000 decodes to the names shown in battle and on the status screen). Other bytes
are kept as {XX} so decoding round-trips. Legend II uses 'A' = 0xBA (a 0x30 shift).
"""

from __future__ import annotations

import re

_PUNCT = {0xF2: "-"}  # probable: 'P-FLOWER', 'TEN-GU', 'SUSANO-O' (name table)


def decode(b: bytes) -> str:
    out = []
    for c in b:
        if 0x8A <= c <= 0xA3:
            out.append(chr(65 + c - 0x8A))
        elif 0xA4 <= c <= 0xBD:
            out.append(chr(97 + c - 0xA4))
        elif 0x80 <= c <= 0x89:
            out.append(chr(48 + c - 0x80))
        elif c == 0xFF:
            out.append(" ")
        elif c in _PUNCT:
            out.append(_PUNCT[c])
        else:
            out.append("{%02X}" % c)
    return "".join(out)


def encode(s: str, size: int) -> bytes:
    rev = {v: k for k, v in _PUNCT.items()}
    out = bytearray()
    for tok in re.findall(r"\{[0-9A-Fa-f]{2}\}|.", s):
        if tok.startswith("{"):
            out.append(int(tok[1:3], 16))
        elif "A" <= tok <= "Z":
            out.append(0x8A + ord(tok) - 65)
        elif "a" <= tok <= "z":
            out.append(0xA4 + ord(tok) - 97)
        elif "0" <= tok <= "9":
            out.append(0x80 + ord(tok) - 48)
        elif tok == " ":
            out.append(0xFF)
        elif tok in rev:
            out.append(rev[tok])
        else:
            raise ValueError(f"character {tok!r} has no Legend I code")
    if len(out) > size:
        raise ValueError(f"{s!r} needs {len(out)} bytes, field holds {size}")
    return bytes(out) + b"\xff" * (size - len(out))
