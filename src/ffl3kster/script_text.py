"""Legend III text: one script interpreter (00:3211) for all dialogue, battle and menu text.

Evidence: docs/ffl3/FINDINGS.md (M3). The interpreter reads a byte at a time:
- 00 ends the script; 10 waits for a button, then ends it (00:3214-322D).
- 0x88-0xFF are literal tiles, printed as a run (00:32EA): letters/digits as in names
  (ffl3kster.text), AC ',', AD "'", EE closing and EF opening quote, FE period + closing quote
  in one tile, AE '…', F5 ○, F6 ×, FD ©; 0x88-0xAB are icons, written {$88}.
- 0x4E-0x87 are dictionary entries 0-57 (00:308C/30B8: 03:71C5, length-prefixed, 80 entries),
  and so are the 22 codes 01-04, 0E, 0F, 16-1B, 40-42, 44-4A (entries 58-79, in that order). An
  entry is copied to CD4D and interpreted recursively, so it may hold control codes.
- 06 is a line break; the other codes below 0x4E jump through 00:3175 with the operand counts
  in OPS (read from the handlers; 3E/39/3A/3C carry 2-byte script references, see ref()).
Text lives in seven spans, each a sequence of scripts that parses exactly to its end (REGIONS):
in bank 03 before the dictionary (a 16-byte tile sits between), in bank 09 around the name
tables, and in bank 0A, with three pointer tables between spans (POINTER_TABLES). Every script
reference and every pointer lands on a script start. Legend I and II have their own
interpreters (docs/CROSS_GAME.md).
"""

from __future__ import annotations

import re

from . import rom as romlib
from .text import CHARS

DICT = romlib.bank_to_file(0x03, 0x71C5)
DICT_SIZE = 80
DICT_CODES = [0x01, 0x02, 0x03, 0x04, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x40, 0x41, 0x42, 0x44, 0x45, 0x46,
              0x47, 0x48, 0x49, 0x4A, 0x0E, 0x0F]
END_CODES = (0x00, 0x10)
NEWLINE = 0x06
OPS = {0x05: 0, 0x07: 0, 0x08: 0, 0x09: 1, 0x0A: 1, 0x0B: 0, 0x0C: 1, 0x0D: 1, 0x11: 1, 0x12: 1, 0x13: 1,
       0x14: 0, 0x15: 1, 0x1C: 0, 0x1D: 1, 0x1E: 1, 0x1F: 1, 0x20: 1, 0x21: 1, 0x22: 1, 0x23: 1, 0x24: 1,
       0x25: 1, 0x26: 1, 0x27: 0, 0x28: 1, 0x29: 1, 0x2A: 1, 0x2B: 1, 0x2C: 1, 0x2D: 1, 0x2E: 1, 0x2F: 1,
       0x30: 1, 0x31: 1, 0x32: 1, 0x33: 1, 0x34: 0, 0x35: 1, 0x36: 1, 0x37: 1, 0x38: 1, 0x39: 5, 0x3A: 8,
       0x3B: 1, 0x3C: 4, 0x3D: 1, 0x3E: 2, 0x3F: 1, 0x43: 3, 0x4C: 0, 0x4D: 0}
# where the 2-byte script references sit inside the operands
REF_OPERANDS = {0x3E: (0,), 0x39: (1, 3), 0x3A: (2, 4, 6), 0x3C: (0, 2)}
REGIONS = [  # bank, first, end (exclusive)
    (0x03, 0x6287, 0x71B5),
    (0x09, 0x5EAC, 0x67BF),
    (0x09, 0x6C5F, 0x78FE),
    (0x09, 0x79C4, 0x8000),
    (0x0A, 0x4000, 0x4004),
    (0x0A, 0x41E2, 0x791E),
    (0x0A, 0x792E, 0x8000),
]
POINTER_TABLES = {  # name: (bank, address, entries); each ends where its first target starts
    "0A:4004": (0x0A, 0x4004, 239),   # map texts (indexed through the event data)
    "09:78FE": (0x09, 0x78FE, 99),    # battle messages ("Strike first!" ...)
    "0A:791E": (0x0A, 0x791E, 8),
}
EXTRA = {0xAC: ",", 0xAD: "'", 0xEE: "\u201d", 0xEF: "\u201c", 0xF5: "\u25cb", 0xF6: "\u00d7", 0xFD: "\u00a9",
         0xFE: ".\u201d"}  # FE is one tile: period and closing quote (AF EE never occurs in the text)
LIT = {**{c: s for c, s in CHARS.items() if c >= 0x88}, **EXTRA}
CODE_OF = {s: c for c, s in LIT.items()}


def ref(lo: int, hi: int) -> tuple:
    """A script reference (00:2EF6): hi < 40 -> a scene change (map hi, entry lo, via 0F:7DD4);
    else text: bank 09 (hi 40-7F), 0A (80-BF, address hi & 7F | 40), 03 (C0-FF, hi & 7F)."""
    if hi < 0x40:
        return ("scene", hi, lo)
    if not hi & 0x80:
        return (0x09, hi << 8 | lo)
    if not hi & 0x40:
        return (0x0A, ((hi & 0x7F) | 0x40) << 8 | lo)
    return (0x03, (hi & 0x7F) << 8 | lo)


def dictionary(rom: bytes) -> list[bytes]:
    out, o = [], DICT
    for _ in range(DICT_SIZE):
        n = rom[o]
        out.append(rom[o + 1:o + 1 + n])
        o += 1 + n
    return out


def dict_index(c: int) -> int | None:
    if 0x4E <= c < 0x88:
        return c - 0x4E
    if c in DICT_CODES:
        return 58 + DICT_CODES.index(c)
    return None


def tokens(rom: bytes, off: int) -> tuple[list[tuple], int]:
    """Tokens of the script at file offset `off`: ('lit', byte), ('dict', i), ('nl',),
    ('code', c, operands) and a final ('end', 00|10). Returns (tokens, offset after)."""
    out = []
    while True:
        c = rom[off]
        off += 1
        if c in END_CODES:
            out.append(("end", c))
            return out, off
        if c >= 0x88:
            out.append(("lit", c))
        elif dict_index(c) is not None:
            out.append(("dict", dict_index(c)))
        elif c == NEWLINE:
            out.append(("nl",))
        elif c in OPS:
            out.append(("code", c, bytes(rom[off:off + OPS[c]])))
            off += OPS[c]
        else:
            raise ValueError(f"unknown text code {c:02X} at {romlib.fmt_loc(off - 1)}")


def serialize(toks: list[tuple]) -> bytes:
    out = bytearray()
    for t in toks:
        if t[0] == "lit":
            out.append(t[1])
        elif t[0] == "dict":
            out.append(0x4E + t[1] if t[1] < 58 else DICT_CODES[t[1] - 58])
        elif t[0] == "nl":
            out.append(NEWLINE)
        elif t[0] == "code":
            out.append(t[1])
            out += t[2]
        else:
            out.append(t[1])
    return bytes(out)


def _lit(c: int) -> str:
    return LIT.get(c, f"{{${c:02X}}}")


def render(toks, dic) -> str:
    """Readable text: dictionary entries expanded, codes as {XX op op}, line breaks as \\n;
    the terminator is dropped for 00 and shown as {10} for the wait-and-end code."""
    s = []
    for t in toks:
        if t[0] == "lit":
            s.append(_lit(t[1]))
        elif t[0] == "dict":
            s.append(render(tokens(dic[t[1]] + b"\0", 0)[0], dic))
        elif t[0] == "nl":
            s.append("\n")
        elif t[0] == "code":
            s.append("{" + " ".join(f"{x:02X}" for x in (t[1], *t[2])) + "}")
        elif t[1] == 0x10:
            s.append("{10}")
    return "".join(s)


TOKEN = re.compile(r"\{\$([0-9A-F]{2})\}|\{([0-9A-F]{2}(?: [0-9A-F]{2})*)\}|\n|\.\u201d|.", re.S)


def encode(text: str, dic: list[bytes]) -> bytes:
    """Bytes for a rendered text (00 appended unless it ends with {10}). Runs of literals are
    compressed greedily with the dictionary entries that are plain literals."""
    units = []                      # ('c', byte) literal, ('raw', bytes) code
    for m in TOKEN.finditer(text):
        if m.group(1):
            units.append(("c", int(m.group(1), 16)))
        elif m.group(2):
            b = bytes(int(x, 16) for x in m.group(2).split())
            units.append(("raw", b))
        elif m.group(0) == "\n":
            units.append(("raw", bytes([NEWLINE])))
        else:
            ch = m.group(0)
            if ch not in CODE_OF:
                raise ValueError(f"no tile for {ch!r}")
            units.append(("c", CODE_OF[ch]))
    plain = sorted(((e, i) for i, e in enumerate(dic) if e and all(b >= 0x88 for b in e)),
                   key=lambda x: -len(x[0]))
    out, i = bytearray(), 0
    while i < len(units):
        if units[i][0] == "raw":
            out += units[i][1]
            i += 1
            continue
        j = i
        while j < len(units) and units[j][0] == "c":
            j += 1
        run = bytes(u[1] for u in units[i:j])
        k = 0
        while k < len(run):
            for e, idx in plain:
                if run.startswith(e, k):
                    out.append(0x4E + idx if idx < 58 else DICT_CODES[idx - 58])
                    k += len(e)
                    break
            else:
                out.append(run[k])
                k += 1
        i = j
    if not (out and out[-1] == 0x10 and text.endswith("{10}")):
        out.append(0x00)
    return bytes(out)


def scripts(rom: bytes) -> list[dict]:
    """Every script of the four regions, in order."""
    dic, rows = dictionary(rom), []
    for bank, first, end in REGIONS:
        o, stop = romlib.bank_to_file(bank, first), romlib.bank_to_file(bank, end - 1) + 1
        while o < stop:
            toks, nxt = tokens(rom, o)
            refs = [ref(t[2][k], t[2][k + 1]) for t in toks if t[0] == "code" and t[1] in REF_OPERANDS
                    for k in REF_OPERANDS[t[1]]]
            b, a = romlib.file_to_bank(o)
            rows.append({"id": f"{b:02X}:{a:04X}", "bank": b, "address": a, "offset": o, "length": nxt - o,
                         "end": toks[-1][1], "text": render(toks, dic), "refs": refs})
            o = nxt
        if o != stop:
            raise ValueError(f"region {bank:02X}:{first:04X} does not end at {end:04X}")
    return rows


def pointer_table(rom: bytes, name: str = "0A:4004") -> list[int]:
    bank, addr, n = POINTER_TABLES[name]
    o = romlib.bank_to_file(bank, addr)
    return [rom[o + 2 * i] | rom[o + 2 * i + 1] << 8 for i in range(n)]


def export(rom: bytes) -> dict:
    rows = scripts(rom)
    return {"dictionary": [render(tokens(e + b"\0", 0)[0], dictionary(rom)) for e in dictionary(rom)],
            "regions": [f"{b:02X}:{a:04X}-{e - 1:04X}" for b, a, e in REGIONS],
            "pointer_tables": {k: [f"{p:04X}" for p in pointer_table(rom, k)] for k in POINTER_TABLES},
            "scripts": [{k: v for k, v in r.items() if k not in ("offset",)} for r in rows]}


def patch_in_place(rom: bytes, script_id: str, new_text: str) -> tuple[int, bytes]:
    """(file offset, bytes) replacing one script in place. A shorter encoding is padded with
    spaces (FF) before its trailing line breaks and terminator; a longer one is refused (the
    scripts are packed and referenced by address)."""
    bank, addr = (int(x, 16) for x in script_id.split(":"))
    off = romlib.bank_to_file(bank, addr)
    old_len = tokens(rom, off)[1] - off
    new = encode(new_text, dictionary(rom))
    if len(new) > old_len:
        raise ValueError(f"{script_id}: {len(new)} bytes, the original has {old_len}")
    tail = len(new)
    while tail > 0 and new[tail - 1] in (0x00, 0x10, NEWLINE):
        tail -= 1
    padded = new[:tail] + b"\xff" * (old_len - len(new)) + new[tail:]
    return off, padded
