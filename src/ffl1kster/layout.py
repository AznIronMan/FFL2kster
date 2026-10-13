"""Legend I map layout decoder: a Python port of 00:153C (bank 03 command stream -> 64-wide
metatile buffer at D000, 62 rows, default metatile 0x1E).

Command byte, top two bits (tile = low six bits):
  00  tile, 2-byte position                      -> one cell                         (3 bytes)
  80  tile, 3-byte position+size                 -> rectangle of tile, tile+1, ... (4 bytes)
  40  tile A, 3-byte position+size, then a byte whose top bits pick the shape and whose low six
      bits are tile B (FFC1); A/B alternate per cell (FFC0/FFC1 toggled by xor 1):
        00 frame (15DB), 40 frame + corners (163B), 80 filled (167F), C0 filled + corners
  C0  end
Position+size: 12-bit buffer offset (first two bytes >> 4), then height = low nibble of byte 2
and top two bits of byte 3, width = low six bits of byte 3 (0 means 1 for both).
Verified: equal to the SM83 oracle (the ROM's own routine run on ffl2kster.sm83) for every map
record, and to PyBoy captures of the first town and the world map.
"""

from __future__ import annotations

from . import rom as romlib

LAYOUT_BANK = 0x03
WIDTH, ROWS, DEFAULT = 64, 62, 0x1E


def decode(rom: bytes, pointer: int) -> bytes:
    buf = bytearray([DEFAULT] * 0x1000)   # D000-DFFF (the routine fills D000-DF7F; offsets are 12-bit)
    p = romlib.bank_to_file(LAYOUT_BANK, pointer)
    hram = {}

    def pos(i):
        return ((rom[i] << 8) | rom[i + 1]) >> 4

    def size(i):  # rom[i] = byte 2 of the position, rom[i+1] = byte 3
        e = ((rom[i] & 0x0F) << 2) | (rom[i + 1] >> 6)
        d = rom[i + 1] & 0x3F
        return (d or 1), (e or 1)   # width, height

    def put(a, v):
        buf[a & 0xFFF] = v & 0xFF

    def add_lo(a, n):            # 'add l / ld l,a' without carry into h, as the routine does
        return (a & ~0xFF) | ((a + n) & 0xFF)

    def row_alt(a, n, c):       # 1631: n cells, alternating tile c/c^1 (keys 0xC0/0xC1)
        for _ in range(n):
            put(a, hram[c]); a += 1; c ^= 1
        return a

    def col_alt(a, n, c):       # 1623: n cells down a column, alternating
        for _ in range(n):
            put(a, hram[c]); a += WIDTH; c ^= 1

    def frame(a, w, h):         # 15DB
        row_alt(a, w, 0xC1)
        row_alt(a + (h - 1) * WIDTH, w, 0xC0 | (h & 1))
        col_alt(a, h, 0xC1)
        col_alt(add_lo(a, w - 1), h, 0xC0 | (w & 1))

    def fill_alt(a, w, h):      # 167F
        c = 0xC0
        for _ in range(h):
            row_alt(a, w, c)
            a += WIDTH; c ^= 1

    def corners(base, w, h):    # 163B
        d = (hram[0xC0] + 1) & 0xFF
        a = base
        put(a, d)
        if w - 1 == 0:          # dec a / jr z, 1668
            a += (h - 1) * WIDTH
            put(a, d + 1)
            return
        a = add_lo(a, w - 1)
        d += 1
        put(a, d)
        if h - 1 == 0:
            return
        a += (h - 1) * WIDTH
        d += 2
        put(a, d)
        a = add_lo(a, -(w - 1))
        d -= 1
        put(a, d)

    i = p
    while True:
        cmd = rom[i]
        top = cmd & 0xC0
        if top == 0xC0:
            return bytes(buf[:WIDTH * ROWS])
        if top == 0x00:
            put(pos(i + 1), cmd & 0x3F)
            i += 3
        elif top == 0x80:
            hram[0xC0] = cmd & 0x3F
            a = pos(i + 1)
            w, h = size(i + 2)
            t = hram[0xC0]            # 169A: the tile keeps counting across rows
            for r in range(h):
                for k in range(w):
                    put(a + r * WIDTH + k, t); t += 1
            i += 4
        else:  # 0x40
            hram[0xC0] = cmd & 0x3F
            a = pos(i + 1)
            w, h = size(i + 2)
            sub = rom[i + 4]
            hram[0xC1] = sub & 0x3F
            shape = sub & 0xC0
            if shape in (0x00, 0x40):
                frame(a, w, h)
            else:
                fill_alt(a, w, h)
            if shape in (0x40, 0xC0):
                corners(a, w, h)
            i += 5
