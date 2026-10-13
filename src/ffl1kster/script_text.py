"""Legend I text: the fixed-width name encoding plus a two-character dictionary, in two
interpreters with different control codes (docs/ffl1/FINDINGS.md, M3).

Characters (both interpreters): 0x50-0x7F -> dictionary pairs 0-47, 0xC0-0xE7 -> pairs 48-87
(88 pairs at 05:4E40, copied to RAM C800 at run time); 0x80-0xBD letters/digits; 0xE8-0xFF glyphs
(0xF0 '.', 0xBF ',', 0xBE apostrophe, 0xF2 '-', 0xFF space).

- Engine text (00:0911; battle messages 02:7860, UI templates 03:7080): 0x00-0x3F are control
  codes through the jump table 00:0CE2 (codes 00-09, 0B, 0C, 0E-12, 14-1B end the string);
  0x40-0x4F print tile code + 0x30 (icons). Argument counts from the handlers: ENGINE_ARGS.
- Dialogue text (00:0EBA; table 05:7B30): 00 end, 0D line break, 01/02 xx yy insert, 04 return,
  11 xy zz (condition; x = 0-3 selects the test), 12 hi lo (string 05:7B10 + 2 * index), 13 wait for a button, 14/15/1A, 16 xx wait,
  19 xx speaker; other codes below 0x50 print as glyphs. Argument counts: DIALOGUE_ARGS.
Legend II has one interpreter with its dictionary at 0x4E-0x9D (0F:6560).
"""

from __future__ import annotations

import re

from . import rom as romlib
from .text import decode as decode_name

DICT = romlib.bank_to_file(0x05, 0x4E40)
DICT_SIZE = 88
PUNCT = {0xF0: ".", 0xBF: ",", 0xBE: "'", 0xF2: "-"}

ENGINE_END = {*range(0x00, 0x0A), 0x0B, 0x0C, *range(0x0E, 0x13), *range(0x14, 0x1C)}
ENGINE_ARGS = {0x0A: 0, 0x0D: 0, 0x13: 0, 0x1C: 0, 0x1D: 0, 0x1E: 0, 0x1F: 0, 0x20: 1, 0x21: 2, 0x22: 1,
               0x23: 1, 0x24: 0, 0x25: 1, 0x26: 1, 0x27: 1, 0x28: 1, 0x29: 1, 0x2A: 1, 0x2B: 1, 0x2C: 1,
               0x2D: 0, 0x2E: 0, 0x2F: 0, 0x30: 0, 0x31: 0, 0x32: 1, 0x33: 0, 0x34: 0, 0x35: 2, 0x36: 1,
               0x37: 0, 0x38: 1, 0x39: 0, 0x3A: 1, 0x3B: 0, 0x3C: 1,
               0x3D: 1}  # 0x3D: only in UI entry 11 (outside the jump table; probable)
DIALOGUE_ARGS = {0x01: 2, 0x02: 2, 0x11: 2, 0x12: 2, 0x16: 1, 0x19: 1}

TABLES = {  # name: (bank, pointer table address, entries, interpreter)
    "battle": (0x02, 0x7860, 80, "engine"),
    "ui": (0x03, 0x7080, 51, "engine"),
    "dialogue": (0x05, 0x7B30, 255, "dialogue"),
}


def _literal(c: int) -> str:
    if c in PUNCT:
        return PUNCT[c]
    return decode_name(bytes([c]))


def pairs(rom: bytes) -> list[str]:
    return [_literal(rom[DICT + 2 * i]) + _literal(rom[DICT + 2 * i + 1]) for i in range(DICT_SIZE)]


def pair_index(c: int) -> int | None:
    if 0x50 <= c <= 0x7F:
        return c - 0x50
    if 0xC0 <= c <= 0xE7:
        return c - 0xC0 + 48
    return None


def _char(p: list[str], c: int) -> str | None:
    k = pair_index(c)
    if k is not None:
        return p[k]
    if 0x80 <= c <= 0xBD or c == 0xFF:
        return decode_name(bytes([c]))
    if c in PUNCT:
        return PUNCT[c]
    return None


def parse(rom: bytes, data: bytes, kind: str) -> tuple[list[tuple], int]:
    """Tokens (('text', s) / ('code', byte, args)) up to and including the end code; returns
    (tokens, length in bytes)."""
    p = pairs(rom)
    toks, i = [], 0
    while i < len(data):
        c = data[i]
        if kind == "engine" and c < 0x40:
            if c in ENGINE_END:
                toks.append(("code", c, b""))
                return toks, i + 1
            n = ENGINE_ARGS.get(c, 0)
            toks.append(("code", c, data[i + 1:i + 1 + n]))
            i += 1 + n
            continue
        if kind == "dialogue" and c < 0x50 and c not in (0x0D,) and (c in DIALOGUE_ARGS or c in (0x00, 0x04, 0x13, 0x14, 0x15, 0x1A)):
            n = DIALOGUE_ARGS.get(c, 0)
            toks.append(("code", c, data[i + 1:i + 1 + n]))
            i += 1 + n
            if c == 0x00:
                return toks, i
            continue
        ch = _char(p, c)
        toks.append(("text", ch) if ch is not None else ("code", c, b""))
        i += 1
    return toks, i


def render(toks: list[tuple]) -> str:
    out = []
    for t in toks:
        if t[0] == "text":
            out.append(t[1])
        else:
            out.append("{%02X%s}" % (t[1], "".join(" %02X" % b for b in t[2])))
    return "".join(out)


def decode(rom: bytes, data: bytes, controls: bool = True) -> str:
    """Plain decode of a byte run (no control-code structure)."""
    p = pairs(rom)
    out = []
    for c in data:
        ch = _char(p, c)
        if ch is not None:
            out.append(ch)
        elif controls:
            out.append("{%02X}" % c)
    return "".join(out)


def encode(rom: bytes, s: str) -> bytes:
    """Inverse of render(): {XX [YY ..]} tokens are bytes; text runs are encoded greedily left to
    right with dictionary pairs where possible (pairs 0-47 -> 0x50+k, 48-87 -> 0xC0+k-48). The game's
    own encoding is not always greedy, so re-encoded text can differ in bytes but decodes the same."""
    p = pairs(rom)
    rev = {}
    for k, v in enumerate(p):
        rev.setdefault(v, k)
    out = bytearray()
    for tok in re.findall(r"\{[0-9A-F]{2}(?: [0-9A-F]{2})*\}|[^{]+", s):
        if tok.startswith("{"):
            out += bytes(int(x, 16) for x in tok[1:-1].split())
            continue
        i = 0
        while i < len(tok):
            k = rev.get(tok[i:i + 2]) if i + 1 < len(tok) else None
            if k is not None:
                out.append(0x50 + k if k < 48 else 0xC0 + k - 48)
                i += 2
            else:
                out += _encode_char(tok[i])
                i += 1
    return bytes(out)


def _encode_char(ch: str) -> bytes:
    for k, v in PUNCT.items():
        if v == ch:
            return bytes([k])
    from .text import encode as enc_name
    return enc_name(ch, 1)


def table_entries(rom: bytes, name: str) -> list[dict]:
    bank, addr, n, kind = TABLES[name]
    t = romlib.bank_to_file(bank, addr)
    rows = []
    for i in range(n):
        ptr = rom[t + 2 * i] | rom[t + 2 * i + 1] << 8
        off = romlib.bank_to_file(bank, ptr)
        toks, length = parse(rom, rom[off:off + 4096], kind)
        rows.append({"id": i, "pointer": ptr, "offset": off, "length": length, "text": render(toks)})
    return rows


def export(rom: bytes) -> dict:
    """Processed text package: every table entry decoded with its pointer and byte length."""
    return {"dictionary": pairs(rom),
            "tables": {name: {"bank": b, "pointer_table": f"{a:04X}", "interpreter": k,
                              "entries": [{"id": r["id"], "pointer": f"{r['pointer']:04X}", "length": r["length"],
                                           "text": r["text"]} for r in table_entries(rom, name)]}
                       for name, (b, a, n, k) in TABLES.items()}}
