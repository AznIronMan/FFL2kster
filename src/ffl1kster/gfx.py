"""Legend I graphics (docs/ffl1/FINDINGS.md, M6). All 2bpp Game Boy tiles unless noted.

- Font: 03:7100, 1bpp (8 bytes per character, both bitplanes the same row), codes 0x80-0xF6
  (0xF7-0xFF are window frame tiles loaded from elsewhere).
- BG tilesets: set record 02:4000 + 0x82*set (00:3F97): two bytes = four nibbles naming 1 KiB
  blocks of bank 01 (01:4000 + 0x400*n, staged as 256 tiles), then 128 tile indexes into that
  staging area -> VRAM 8800-8FFF. Metatile m (map buffer) draws tiles 0x80+4m .. 0x80+4m+3
  (top-left, top-right, bottom-left, bottom-right; 8800 addressing).
- Sprite sets: 02:5240 + 6*set (00:24F8): six blocks of 16 tiles, 01:6000 + 0x100*n (bit 7 = skip),
  to 8100-86FF; the block 01:7F00 always goes to 8700.
- Monster pictures (07:72C2): class g and index i from the monster's family byte 02:7900+id
  (g = bits 4-6, i = low nibble), base pointer 02:79D2 + 2g (bank 04), tiles per picture
  02:79EA + g; picture = 04:base + i * tiles * 16, drawn as BG tiles 0x80.. (8800).
"""

from __future__ import annotations

from . import rom as romlib

FONT = romlib.bank_to_file(0x03, 0x7100)
TILESETS = romlib.bank_to_file(0x02, 0x4000)
TILESET_SIZE, TILESET_COUNT = 0x82, 16
SPRITE_SETS = romlib.bank_to_file(0x02, 0x5240)
SPRITE_SET_COUNT = 23     # 02:5240-52C9; sets 10, 11 and 19 are not used by any map
SPRITE_SHARED = romlib.bank_to_file(0x01, 0x7F00)
PIC_BASES = romlib.bank_to_file(0x02, 0x79D2)
PIC_TILES = romlib.bank_to_file(0x02, 0x79EA)   # 10 18 24 30 30
FAMILY = romlib.bank_to_file(0x02, 0x7900)
PIC_WIDTH = {0: 4, 1: 4, 2: 6, 3: 6, 4: 8}  # tiles across per class (class 1 verified on screen,
                                           # the others probable: the decoded pictures are coherent)
PIC_CLASSES = 5            # bases 04:4000/4700/5D80/7400/7D00; class 4 ends exactly at 04:7FFF


def font_tile(rom: bytes, code: int) -> bytes:
    """2bpp tile (16 bytes) for a character code 0x80-0xFF."""
    o = FONT + 8 * (code - 0x80)
    return bytes(b for row in rom[o:o + 8] for b in (row, row))


def tileset(rom: bytes, s: int) -> bytes:
    """128 tiles (2 KiB) as loaded to VRAM 8800-8FFF."""
    o = TILESETS + TILESET_SIZE * s
    blocks = [rom[o] >> 4, rom[o] & 15, rom[o + 1] >> 4, rom[o + 1] & 15]
    stage = b"".join(rom[romlib.bank_to_file(1, 0x4000 + 0x400 * n):][:0x400] for n in blocks)
    return b"".join(stage[16 * t:16 * t + 16] for t in rom[o + 2:o + TILESET_SIZE])


def sprite_set(rom: bytes, s: int) -> bytes:
    """VRAM 8100-87FF (6 blocks + the shared block)."""
    o = SPRITE_SETS + 6 * s
    out = b""
    for n in rom[o:o + 6]:
        ok = not n & 0x80 and 0x6000 + 0x100 * n < 0x8000
        out += rom[romlib.bank_to_file(1, 0x6000 + 0x100 * n):][:0x100] if ok else bytes(256)
    return out + rom[SPRITE_SHARED:SPRITE_SHARED + 0x100]


def picture(rom: bytes, mid: int) -> dict:
    v = rom[FAMILY + mid]
    g, i = (v >> 4) & 7, v & 15
    base = rom[PIC_BASES + 2 * g] | rom[PIC_BASES + 2 * g + 1] << 8
    n = rom[PIC_TILES + g]
    o = romlib.bank_to_file(0x04, base + i * n * 16)
    return {"class": g, "index": i, "tiles": n, "width": PIC_WIDTH.get(g, 4), "offset": o,
            "data": rom[o:o + n * 16]}


def tiles_to_image(data: bytes, width_tiles: int, palette=(255, 170, 85, 0)):
    """PIL image of consecutive tiles laid out row by row."""
    from PIL import Image
    n = len(data) // 16
    h = (n + width_tiles - 1) // width_tiles
    img = Image.new("L", (8 * width_tiles, 8 * h), palette[0])
    px = img.load()
    for t in range(n):
        tx, ty = (t % width_tiles) * 8, (t // width_tiles) * 8
        for y in range(8):
            lo, hi = data[16 * t + 2 * y], data[16 * t + 2 * y + 1]
            for x in range(8):
                c = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1)
                px[tx + x, ty + y] = palette[c]
    return img


def render_map(rom: bytes, buffer: bytes, tiles: bytes, width=64, rows=62):
    """Whole map as an image: metatile m -> tiles 0x80+4m.. from the 128-tile set."""
    from PIL import Image
    img = Image.new("L", (16 * width, 16 * rows))
    cache = {}
    for y in range(rows):
        for x in range(width):
            m = buffer[y * width + x] & 0x3F
            if m not in cache:
                q = b"".join(tiles[16 * (4 * m + k):16 * (4 * m + k + 1)] for k in (0, 1, 2, 3))
                cache[m] = tiles_to_image(q, 2)
            img.paste(cache[m], (16 * x, 16 * y))
    return img


def export(rom: bytes, out_dir) -> dict:
    """Processed graphics as PNG files: font, tilesets, sprite sets, monster pictures, map renders."""
    from pathlib import Path
    from .layout import decode
    from .schema import maps as MP
    out = Path(out_dir)
    for sub in ("tilesets", "sprites", "monsters", "maps"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    tiles_to_image(b"".join(font_tile(rom, c) for c in range(0x80, 0xF7)), 16).save(out / "font.png")
    for s in range(TILESET_COUNT):
        tiles_to_image(tileset(rom, s), 16).save(out / "tilesets" / f"{s:02d}.png")
    for s in range(SPRITE_SET_COUNT):
        tiles_to_image(sprite_set(rom, s), 16).save(out / "sprites" / f"{s:02d}.png")
    from .schema.monsters import name
    for mid in range(200):
        p = picture(rom, mid)
        tiles_to_image(p["data"], p["width"]).save(out / "monsters" / f"{mid:03d}.png")
    n = 0
    for mid in range(MP.MAP_COUNT):
        r = MP.parse_record(rom, mid)
        if r["graphics"] < TILESET_COUNT:
            render_map(rom, decode(rom, r["layout"]), tileset(rom, r["graphics"])).save(out / "maps" / f"{mid:03d}.png")
            n += 1
    return {"font": 119, "tilesets": TILESET_COUNT, "sprite_sets": SPRITE_SET_COUNT, "monsters": 200, "maps": n}
