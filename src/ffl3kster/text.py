"""Legend III fixed-text character map (names, menus).

Verified 2026-10-13: the title and name-entry screens (digits B0-B9, A-Z BA-D3, a-z D4-ED, space
FF) and the font tiles in VRAM in the prologue battle (AF '.', F0 ':', F1 '/', F2 '-', F3 '!',
F4 '?'; AE is a dotted rule, kept as '…'). Other codes decode as '·'.
"""

from __future__ import annotations

CHARS: dict[int, str] = {0xFF: " ", 0xAF: ".", 0xAE: "…", 0xF0: ":", 0xF1: "/", 0xF2: "-", 0xF3: "!",
                         0xF4: "?"}
CHARS.update({0xB0 + i: str(i) for i in range(10)})
CHARS.update({0xBA + i: chr(65 + i) for i in range(26)})
CHARS.update({0xD4 + i: chr(97 + i) for i in range(26)})
CODES = {v: k for k, v in CHARS.items()}


def decode_char(c: int) -> str:
    return CHARS.get(c, "·")


def decode(b: bytes) -> str:
    return "".join(decode_char(c) for c in b)


def encode(s: str, length: int | None = None) -> bytes:
    out = bytes(CODES[ch] for ch in s)
    if length is not None:
        if len(out) > length:
            raise ValueError(f"{s!r} longer than {length}")
        out += b"\xff" * (length - len(out))
    return out
