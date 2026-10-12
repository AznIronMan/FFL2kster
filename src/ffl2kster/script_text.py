"""Dialogue/script text decoder for FFL2 (USA).

Stream format (text engine 00:070C): byte >= 0x9E printable glyph (text.decode), 0x4E-0x9D
dictionary pair at 0F:6560 + 2*(b-0x4E), 0x00-0x4D control codes via jump table 00:13BE.
ARGS gives the number of argument bytes per control code (see docs/FINDINGS.md for status).
"""

from __future__ import annotations

from . import text

DICT_OFFSET = 0x3E560      # 0F:6560
CTRL_TABLE = 0x13BE        # 00:13BE, 78 handler pointers

# Argument byte counts. Initial values from counting `rst $30` (read script byte) on each
# handler's main path; refined by parse validation (see tools/text_validate.py).
ARGS = {i: 0 for i in range(0x4E)}
ARGS.update({0x07: 1, 0x08: 1, 0x09: 1, 0x11: 1, 0x14: 2, 0x15: 2, 0x17: 1, 0x19: 2, 0x1A: 1,
             0x1B: 1, 0x1C: 1, 0x1D: 1, 0x1F: 1, 0x20: 1, 0x21: 2, 0x22: 1, 0x23: 1, 0x26: 1,
             0x2B: 1, 0x2D: 1, 0x30: 1, 0x32: 1, 0x33: 2, 0x35: 1, 0x36: 1, 0x39: 1, 0x3A: 1,
             0x3E: 1, 0x3F: 3, 0x41: 1, 0x44: 1, 0x45: 1, 0x48: 2, 0x49: 1})
NAMES = {0x00: "end", 0x06: "nl", 0x05: "line", 0x01: "right", 0x02: "left", 0x03: "up",
         0x04: "down"}
PUNCT = {0xEE: "'", 0xEF: ",", 0xF0: ".", 0xF1: "…", 0xF2: "-", 0xF3: "!", 0xF4: "?",
         0xF5: ":", 0xF6: "/", 0xFF: " "}


def arg_len(rom: bytes, i: int, code: int) -> int:
    """Argument length of control `code` whose args start at rom[i]. Code 0x20 re-dispatches
    its first argument as a sub-code (handler 00:0FCC jumps to the dispatcher), so its length
    is 1 + ARGS[sub-code] when the sub-code is itself a control code."""
    if code == 0x20:
        sub = rom[i]
        return 1 + (ARGS.get(sub, 0) if sub < 0x4E else 0)
    return ARGS.get(code, 0)


def dictionary(rom: bytes) -> list[bytes]:
    return [rom[DICT_OFFSET + 2 * i:DICT_OFFSET + 2 * i + 2] for i in range(0x50)]


def glyph(b: int) -> str:
    if b in PUNCT:
        return PUNCT[b]
    s = text.decode(bytes([b]))
    return s if s and not s.startswith("{") else "{%02X}" % b


def decode_stream(rom: bytes, offset: int, limit: int = 4096, stop_at_end: bool = True):
    """Decode from file offset; returns (tokens, end_offset). Tokens are str (text) or
    tuple(ctrl, args)."""
    d = dictionary(rom)
    out: list = []
    buf = []
    i = offset
    end = min(len(rom), offset + limit)
    while i < end:
        b = rom[i]
        i += 1
        if b >= 0x9E:
            buf.append(glyph(b))
        elif b >= 0x4E:
            buf.append("".join(glyph(x) for x in d[b - 0x4E]))
        else:
            if buf:
                out.append("".join(buf)); buf = []
            n = arg_len(rom, i, b)
            out.append((b, tuple(rom[i:i + n])))
            i += n
            if b == 0x00 and stop_at_end:
                break
    if buf:
        out.append("".join(buf))
    return out, i


def render(tokens) -> str:
    s = []
    for t in tokens:
        if isinstance(t, str):
            s.append(t)
        else:
            c, a = t
            if c == 0x06:
                s.append("\n")
            elif c == 0x00:
                s.append("⟨end⟩")
            else:
                s.append("⟨%02X%s⟩" % (c, "".join(" %02X" % x for x in a)))
    return "".join(s)


# ---------------------------------------------------------------- encoding / tables

TABLES = [  # (name, pointer table file offset, entries, bank)
    ("field", 0x28000, 256, 0x0A),
    ("story", 0x2C000, 192, 0x0B),
    ("battle", 0x2EB80, 109, 0x0B),
    ("menu", 0x2F400, 77, 0x0B),
]


def _glyph_map() -> dict[str, int]:
    m = {}
    for b in range(0x9E, 0x100):
        g = glyph(b)
        if not g.startswith("{") and g not in m:
            m[g] = b
    return m


def encode_text(rom: bytes, s: str, use_dict: bool = True) -> bytes:
    """Encode a plain text segment (no control codes) with greedy dictionary pairing."""
    gm = _glyph_map()
    pairs = {}
    if use_dict:
        for i, p in enumerate(dictionary(rom)):
            k = "".join(glyph(x) for x in p)
            pairs.setdefault(k, 0x4E + i)
    out = bytearray()
    i = 0
    while i < len(s):
        two = s[i:i + 2]
        if len(two) == 2 and two in pairs:
            out.append(pairs[two]); i += 2
            continue
        ch = s[i]
        if ch == "{" and i + 3 < len(s) and s[i + 3] == "}":
            out.append(int(s[i + 1:i + 3], 16)); i += 4
            continue
        if ch not in gm:
            raise ValueError(f"unencodable character {ch!r}")
        out.append(gm[ch]); i += 1
    return bytes(out)


def encode_tokens(rom: bytes, tokens) -> bytes:
    out = bytearray()
    for t in tokens:
        if isinstance(t, str):
            out += encode_text(rom, t)
        else:
            c, a = t
            out.append(c); out += bytes(a)
    return bytes(out)


def table_entries(rom: bytes):
    """Yield (table, index, file_offset, end_offset) with end = next distinct pointer target."""
    for name, base, n, bank in TABLES:
        offs = [bank * 0x4000 + (rom[base + 2 * i] | rom[base + 2 * i + 1] << 8) - 0x4000
                for i in range(n)]
        srt = sorted(set(offs))
        for i, o in enumerate(offs):
            k = srt.index(o)
            end = srt[k + 1] if k + 1 < len(srt) else None
            yield name, i, o, end


def parse_rendered(s: str):
    """Inverse of render(): '\\n' -> 0x06, '⟨end⟩' -> 0x00, '⟨XX YY ..⟩' -> control + args."""
    toks, buf, i = [], [], 0
    while i < len(s):
        ch = s[i]
        if ch == "\n":
            if buf: toks.append("".join(buf)); buf = []
            toks.append((0x06, ())); i += 1
        elif ch == "⟨":
            j = s.index("⟩", i)
            if buf: toks.append("".join(buf)); buf = []
            body = s[i + 1:j]
            if body == "end":
                toks.append((0x00, ()))
            else:
                parts = [int(x, 16) for x in body.split()]
                toks.append((parts[0], tuple(parts[1:])))
            i = j + 1
        else:
            buf.append(ch); i += 1
    if buf:
        toks.append("".join(buf))
    return toks


SAFE_CODES = {0x00, 0x05, 0x06, 0x20, 0x36}   # end, line, newline, insert-variable, position


def entry(rom: bytes, table: str, index: int):
    for name, i, o, end in table_entries(rom):
        if name == table and i == index:
            toks, e = decode_stream(rom, o, limit=(end - o) if end else 2000, stop_at_end=end is None)
            return o, e, toks
    raise KeyError(f"no text entry {table}[{index}]")


def export(rom: bytes) -> list[dict]:
    rows = []
    for name, i, o, end in table_entries(rom):
        toks, e = decode_stream(rom, o, limit=(end - o) if end else 2000, stop_at_end=end is None)
        bank = o // 0x4000
        codes = sorted({t[0] for t in toks if not isinstance(t, str)})
        rows.append({"table": name, "index": i, "offset": o, "bank": bank,
                     "address": 0x4000 + o % 0x4000, "length": e - o, "text": render(toks),
                     "control_codes": codes, "pure_message": set(codes) <= SAFE_CODES})
    return rows
