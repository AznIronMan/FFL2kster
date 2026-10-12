"""FFL2 (USA) fixed-width text encoding (verified for names; see docs/FINDINGS.md)."""

from __future__ import annotations


def decode(b: bytes) -> str:
    s = []
    for x in b:
        if 0xBA <= x <= 0xD3:
            s.append(chr(65 + x - 0xBA))
        elif 0xD4 <= x <= 0xED:
            s.append(chr(97 + x - 0xD4))
        elif 0xB0 <= x <= 0xB9:
            s.append(chr(48 + x - 0xB0))
        elif x == 0xFF:
            s.append(" ")
        elif x == 0xF2:
            s.append("-")
        else:
            s.append("{%02X}" % x)
    return "".join(s).rstrip()
