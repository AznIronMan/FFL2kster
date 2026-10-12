"""Reverse-engineering helpers: byte search, relative text search, record-stride search."""

from __future__ import annotations

from collections import Counter

from . import rom as romlib


def find_all(data: bytes, needle: bytes) -> list[int]:
    out, i = [], data.find(needle)
    while i != -1:
        out.append(i)
        i = data.find(needle, i + 1)
    return out


def relative_search(data: bytes, word: str) -> list[tuple[int, int]]:
    """Find `word` (letters only) under any encoding where letters are contiguous
    and ascending. Returns (offset, code_of_first_letter_minus_letter_index)."""
    w = word.upper()
    deltas = [ord(c) - ord(w[0]) for c in w]
    hits = []
    n = len(w)
    for i in range(len(data) - n + 1):
        base = data[i]
        if all((data[i + k] - base) & 0xFF == (deltas[k] & 0xFF) for k in range(1, n)):
            if deltas and len(set(deltas)) > 1:
                hits.append((i, (base - (ord(w[0]) - ord("A"))) & 0xFF))
    return hits


def pointer_table_candidates(data: bytes, bank: int, min_len: int = 8):
    """Scan a bank for runs of little-endian words that all point into 4000-7FFF
    and are monotonically non-decreasing. Returns (offset, count)."""
    start, end = bank * romlib.BANK_SIZE, (bank + 1) * romlib.BANK_SIZE
    res = []
    i = start
    while i < end - 1:
        j, prev = i, -1
        while j < end - 1:
            w = data[j] | (data[j + 1] << 8)
            if not (0x4000 <= w < 0x8000) or w < prev:
                break
            prev = w
            j += 2
        cnt = (j - i) // 2
        if cnt >= min_len:
            res.append((i, cnt))
            i = j
        else:
            i += 1
    return res


def stride_profile(data: bytes, start: int, length: int, max_stride: int = 32):
    """For a region, score candidate record strides by byte-column regularity."""
    region = data[start:start + length]
    scores = []
    for s in range(2, max_stride + 1):
        rows = len(region) // s
        if rows < 4:
            continue
        col_distinct = []
        for c in range(s):
            col = [region[r * s + c] for r in range(rows)]
            col_distinct.append(len(Counter(col)) / rows)
        scores.append((sum(col_distinct) / s, s))
    return sorted(scores)[:8]


def add_commands(sub) -> None:
    import argparse

    def cmd_find(a):
        data = romlib.load_rom(a.rom)
        for off in find_all(data, bytes.fromhex(a.hex)):
            print(romlib.fmt_loc(off))
        return 0

    def cmd_rel(a):
        data = romlib.load_rom(a.rom)
        for off, base in relative_search(data, a.word)[: a.limit]:
            print(f"{romlib.fmt_loc(off)}  'A'={base:02X}")
        return 0

    def cmd_ptrs(a):
        data = romlib.load_rom(a.rom)
        for off, cnt in pointer_table_candidates(data, a.bank, a.min):
            print(f"{romlib.fmt_loc(off)}  {cnt} words")
        return 0

    s = sub.add_parser("find", help="find a hex byte string")
    s.add_argument("hex")
    s.add_argument("--rom", default="input/original.gb")
    s.set_defaults(fn=cmd_find)
    s = sub.add_parser("relsearch", help="relative search for a word in unknown text encoding")
    s.add_argument("word")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--limit", type=int, default=50)
    s.set_defaults(fn=cmd_rel)
    s = sub.add_parser("ptrscan", help="scan a bank for pointer-table candidates")
    s.add_argument("bank", type=lambda x: int(x, 0))
    s.add_argument("--min", type=int, default=8)
    s.add_argument("--rom", default="input/original.gb")
    s.set_defaults(fn=cmd_ptrs)
