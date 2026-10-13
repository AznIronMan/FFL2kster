"""Legend III map layouts: the compressed metatile maps of banks 07/08 and the flag patches.

Code (docs/ffl3/FINDINGS.md, M5): a map's header byte 0 (low 7 bits) is its layout data index
n (CA15). 00:0F42 reads the row width W = 07:7EA0[n] and tile count L = 07:7EC0 + 2n, decompresses
the data of bank B = 07 (n < 10, entry n - 1) or 08 (entry n - 10) between the pointers at
B:4000 + 2k and B:4002 + 2k (00:3D76) and expands each metatile byte m through B:4022 + 2k
(4 tiles at + 4m: top-left, bottom-left, top-right, bottom-right) into the W-wide tile buffer at
D000. The compression: a block-size byte s (blocks of 4 << (s + 1) bytes), then per block a fill
byte, a bit mask (MSB first: 1 = the next literal byte, 0 = the fill) and the literals.
0B:78F5 then applies flag patches for the current map: 0B:7982 (47 map ids), 0B:79B1 (story
flag or FF = always), 0B:79E0 (pointer): x, y, one rectangle (byte: width << 4 | height, then
the rows; 00 = none). With y = 0 the game advances rows from a stale C801/C802 (none in the data).
"""

from __future__ import annotations

from . import rom as romlib

PATCH_COUNT = 0x2F


def _w(rom: bytes, bank: int, addr: int) -> int:
    o = romlib.bank_to_file(bank, addr)
    return rom[o] | rom[o + 1] << 8


def location(n: int) -> tuple[int, int]:
    if not 1 <= n <= 31:
        raise ValueError(f"layout data index {n} out of range 1..31")
    return (0x08, n - 0x10) if n >= 0x10 else (0x07, n - 1)


def decompress(rom: bytes, bank: int, start: int, end: int) -> bytes:
    """00:3D76: the loop tests the end after each block, so at least one block is decoded."""
    o, out = romlib.bank_to_file(bank, start), bytearray()
    stop = romlib.bank_to_file(bank, end - 1) + 1 if end > 0x4000 else 0
    size = (4 << ((rom[o] + 1) & 0xFF)) & 0xFF if rom[o] < 0xFF else 0
    if size not in (8, 16, 32, 64):
        raise ValueError(f"block size byte {rom[o]:02X} at {romlib.fmt_loc(o)}: the game copies stale RAM")
    o += 1
    while True:
        fill, mask, lit = rom[o], rom[o + 1:o + 1 + size // 8], o + 1 + size // 8
        for mb in mask:
            for bit in range(8):
                if mb & (0x80 >> bit):
                    out.append(rom[lit])
                    lit += 1
                else:
                    out.append(fill)
        o = lit
        if o >= stop:
            return bytes(out)


def info(rom: bytes, n: int) -> dict:
    bank, k = location(n)
    return {"index": n, "bank": bank, "width": rom[romlib.bank_to_file(0x07, 0x7EA0) + n],
            "tiles": _w(rom, 0x07, 0x7EC0 + 2 * n), "data": (_w(rom, bank, 0x4000 + 2 * k), _w(rom, bank, 0x4002 + 2 * k)),
            "metatiles": _w(rom, bank, 0x4022 + 2 * k)}


def metatile_map(rom: bytes, n: int) -> bytes:
    i = info(rom, n)
    return decompress(rom, i["bank"], *i["data"])


def tilemap(rom: bytes, n: int) -> bytes:
    """The W-wide tile buffer the game builds at D000 (before flag patches)."""
    i = info(rom, n)
    w, meta = i["width"], romlib.bank_to_file(i["bank"], i["metatiles"])
    data, buf, de = metatile_map(rom, n), bytearray(i["tiles"]), 0
    for k in range(i["tiles"] >> 2):
        t0, t1, t2, t3 = rom[meta + 4 * data[k]:meta + 4 * data[k] + 4]
        buf[de], buf[de + 1], buf[de + w], buf[de + w + 1] = t0, t2, t1, t3
        de += 2
        if de & (w - 1) == 0:
            de += w
    return bytes(buf)


def patches(rom: bytes, map_id: int) -> list[tuple[int, int]]:
    """(flag or FF, pointer) of every patch for a map (0B:78F5)."""
    ids = romlib.bank_to_file(0x0B, 0x7982)
    flags = romlib.bank_to_file(0x0B, 0x79B1)
    return [(rom[flags + e], _w(rom, 0x0B, 0x79E0 + 2 * e)) for e in range(PATCH_COUNT) if rom[ids + e] == map_id]


def flag_set(flags_c760: bytes, f: int) -> bool:
    return bool(flags_c760[f >> 3] & (0x80 >> (f & 7)))


def apply_patches(rom: bytes, buf: bytearray, width: int, map_id: int, flags_c760: bytes) -> None:
    for flag, ptr in patches(rom, map_id):
        if flag != 0xFF and not flag_set(flags_c760, flag):
            continue
        o = romlib.bank_to_file(0x0B, ptr)
        x, y, wh = rom[o], rom[o + 1], rom[o + 2]
        if not wh:
            continue
        w, h, o, row = wh >> 4, wh & 0x0F, o + 3, x + y * width
        for _ in range(h):
            buf[row:row + w] = rom[o:o + w]
            o += w
            row += width


def map_tiles(rom: bytes, map_id: int, flags_c760: bytes) -> tuple[bytes, int]:
    from .schema.maps import map_pointer
    n = rom[romlib.bank_to_file(0x06, map_pointer(rom, map_id))] & 0x7F
    buf = bytearray(tilemap(rom, n))
    w = info(rom, n)["width"]
    apply_patches(rom, buf, w, map_id, flags_c760)
    return bytes(buf), w
