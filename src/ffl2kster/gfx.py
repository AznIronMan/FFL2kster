"""Graphics sources (ROM → 2bpp tile data).

Tilesets (verified against VRAM of 211 map captures):
- header byte 2 = tileset t; 00:1F55 reads 32 block numbers at 07:7800 + 32·t and copies
  bank-02 block k (64 bytes = 4 tiles: TL, TR, BL, BR) to VRAM 0x9000 + 64·i for metatile i.
- metatiles 0x20–0x3F use the fixed tiles 0x80–0xFF at VRAM 0x8800, i.e. ROM 04:4800
  (file 0x10800, the font/UI block).
- metatile 31 (and 30) is animated (00:21EA, per frame): header flags bits 4–5 = n;
  n = 0 → rows of metatiles 30 and 31 are swapped progressively; n > 0 → the tiles of
  metatile 31 rotate horizontally by n pixels per step (water/flow). (Probable, from code.)
"""
from __future__ import annotations

TILESET_TABLE = 0x1F800   # 07:7800
BLOCKS = 0x8000           # bank 02
UI_TILES = 0x10800        # 04:4800 → tiles 0x80..0xFF


def tileset_blocks(rom: bytes, t: int) -> list[int]:
    return list(rom[TILESET_TABLE + 32 * t:TILESET_TABLE + 32 * t + 32])


def metatile_tiles(rom: bytes, t: int, m: int) -> bytes:
    """64 bytes (4 tiles TL, TR, BL, BR) for metatile m (0..63) of tileset t."""
    if m < 32:
        k = rom[TILESET_TABLE + 32 * t + m]
        return rom[BLOCKS + 64 * k:BLOCKS + 64 * k + 64]
    o = UI_TILES + 16 * (4 * m - 0x80)
    return rom[o:o + 64]


def vram_bg(rom: bytes, t: int) -> bytes:
    """BG tile area 0x8800–0x97FF as the game loads it for tileset t (before animation)."""
    lower = b"".join(metatile_tiles(rom, t, m) for m in range(32))
    return rom[UI_TILES:UI_TILES + 0x800] + lower


def decode_tile(t: bytes) -> list[list[int]]:
    """2bpp tile → 8 rows of 8 colour indices (0..3)."""
    rows = []
    for y in range(8):
        lo, hi = t[2 * y], t[2 * y + 1]
        rows.append([((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1) for x in range(8)])
    return rows


# ---------------------------------------------------------------- monster battle graphics
# Verified for all 256 monsters against VRAM captured at battle start (tools/monster_capture.py):
# 0D:6400 + id: hi nibble = size class c, lo nibble = index i within the class;
# 0D:6500 + c: hi nibble = width, lo nibble = height (tiles); 0D:6510 + 3c: [bank, addr lo, hi]
# = start of class c; graphic = start + i·w·h·16 bytes, tiles row-major (loader 0D:5258/5302).
MON_CLASS = 0x36400
MON_DIMS = 0x36500
MON_BASE = 0x36510


def monster_graphic(rom: bytes, mid: int) -> tuple[int, int, bytes]:
    v = rom[MON_CLASS + mid]
    c, i = v >> 4, v & 0x0F
    d = rom[MON_DIMS + c]
    w, h = d >> 4, d & 0x0F
    bank, lo, hi = rom[MON_BASE + 3 * c:MON_BASE + 3 * c + 3]
    src = bank * 0x4000 + (lo | hi << 8) - 0x4000 + i * w * h * 16
    return w, h, rom[src:src + w * h * 16]
