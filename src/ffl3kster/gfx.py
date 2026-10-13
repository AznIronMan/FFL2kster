"""Legend III graphics (docs/ffl3/FINDINGS.md, M6). 2bpp Game Boy tiles.

- Map tilesets (07:7F5B): the map's header byte 1 indexes 03:731C (2-byte pointers to 6-byte
  records); bytes 1-4 name four 512-byte blocks of bank 05 (05:hh00, 32 tiles each), copied to
  VRAM 9000-97FF = BG tiles 00-7F. Exceptions after that load: map 01 (07:7F76), map 5D
  (07:7FBC) and tile animation / extra tiles for some maps (01:5501, 01:6092, 01:6082).
- Font and window tiles: 03:4000-47FF -> 8800-8FFF (07:7F4F), tiles 80-FF.
- Monster pictures (0B:417D): 0B:4301 + id = c (195 bytes, ends at 0B:43C4); sheet s = c >> 3,
  slot = c & 7; 0B:43CC + s = bank << 4 | size; tile count n = 0B:43C4 + size (10 20 20 30 3E
  7C); 0B:43E4 + 4s holds three pointers (two spans) in that bank, each compressed like the map
  layouts (00:3D76): the first span is bitplane 0 and the second bitplane 1 of the sheet's
  tiles; the picture is the n tiles starting at slot * n. Sheet 19 (Xagor) starts with a
  block-size byte FF, for which 00:3D76 would copy stale RAM: not decoded here.
"""

from __future__ import annotations

from . import rom as romlib
from .layout import decompress

FONT = romlib.bank_to_file(0x03, 0x4000)
PIC_CODES = romlib.bank_to_file(0x0B, 0x4301)
PIC_SIZES = romlib.bank_to_file(0x0B, 0x43C4)
PIC_SHEETS = romlib.bank_to_file(0x0B, 0x43CC)
PIC_POINTERS = romlib.bank_to_file(0x0B, 0x43E4)
SHEETS = 24
XAGOR_SHEET = 19   # block-size byte FF: 00:3D76 would copy stale C800 RAM; Xagor is drawn elsewhere
BGP = (0xFF, 0xAA, 0x55, 0x00)   # shades for colours 0-3 (DMG, BGP E4)
PIC_COLUMNS = {0: 4, 1: 8, 2: 4, 3: 6, 4: 8, 5: 16}   # tiles across by size code (probable: the
                                                       # decoded pictures are coherent this way)


def _w(rom: bytes, off: int) -> int:
    return rom[off] | rom[off + 1] << 8


def map_tileset(rom: bytes, map_id: int) -> bytes:
    from .schema.maps import map_pointer
    lay = rom[romlib.bank_to_file(0x06, map_pointer(rom, map_id)) + 1]
    rec = romlib.bank_to_file(0x03, _w(rom, romlib.bank_to_file(0x03, 0x731C + 2 * lay)))
    return b"".join(rom[romlib.bank_to_file(0x05, b << 8):romlib.bank_to_file(0x05, b << 8) + 0x200]
                    for b in rom[rec + 1:rec + 5])


def font(rom: bytes) -> bytes:
    return bytes(rom[FONT:FONT + 0x800])


def picture_sheet(rom: bytes, sheet: int) -> list[bytes]:
    bank = rom[PIC_SHEETS + sheet] >> 4
    p = PIC_POINTERS + 4 * sheet
    a0, a1, a2 = _w(rom, p), _w(rom, p + 2), _w(rom, p + 4)
    lo, hi = decompress(rom, bank, a0, a1), decompress(rom, bank, a1, a2)
    return [bytes(x for r in range(8) for x in (lo[8 * t + r], hi[8 * t + r])) for t in range(len(lo) // 8)]


def picture(rom: bytes, monster_id: int) -> list[bytes]:
    c = rom[PIC_CODES + monster_id]
    sheet, slot = c >> 3, c & 7
    n = rom[PIC_SIZES + (rom[PIC_SHEETS + sheet] & 0x0F)]
    tiles = picture_sheet(rom, sheet)
    return tiles[slot * n:slot * n + n]


def tile_pixels(tile: bytes) -> list[list[int]]:
    return [[((tile[2 * y] >> (7 - x)) & 1) | (((tile[2 * y + 1] >> (7 - x)) & 1) << 1) for x in range(8)]
            for y in range(8)]


def render_tiles(tiles: list[bytes], cols: int):
    from PIL import Image
    rows = (len(tiles) + cols - 1) // cols
    img = Image.new("L", (8 * cols, 8 * rows), 255)
    for k, t in enumerate(tiles):
        px = tile_pixels(t)
        for y in range(8):
            for x in range(8):
                img.putpixel((8 * (k % cols) + x, 8 * (k // cols) + y), BGP[px[y][x]])
    return img


def render_map(rom: bytes, map_id: int, flags=bytes(32)):
    """The map's whole tile buffer (layout + patches) drawn with its tileset."""
    from PIL import Image
    from .layout import map_tiles
    tiles, width = map_tiles(rom, map_id, flags)
    ts = map_tileset(rom, map_id)
    cache = {}
    img = Image.new("L", (8 * width, 8 * (len(tiles) // width)), 255)
    for k, t in enumerate(tiles):
        if t < 0x80:
            if t not in cache:
                cache[t] = tile_pixels(ts[16 * t:16 * t + 16])
            px = cache[t]
        else:
            px = tile_pixels(font(rom)[16 * (t - 0x80):16 * (t - 0x80) + 16])
        for y in range(8):
            for x in range(8):
                img.putpixel((8 * (k % width) + x, 8 * (k // width) + y), BGP[px[y][x]])
    return img


def export(rom: bytes, out) -> dict:
    from pathlib import Path
    from .schema.maps import MAP_COUNT, map_pointer
    out = Path(out)
    (out / "maps").mkdir(parents=True, exist_ok=True)
    (out / "monsters").mkdir(parents=True, exist_ok=True)
    render_tiles([font(rom)[16 * k:16 * k + 16] for k in range(128)], 16).save(out / "font.png")
    seen = set()
    for m in range(MAP_COUNT):
        p = map_pointer(rom, m)
        if p in seen:
            continue
        seen.add(p)
        render_map(rom, m).save(out / "maps" / f"map_{m:02X}.png")
    for mid in range(195):
        if rom[PIC_CODES + mid] >> 3 == XAGOR_SHEET:
            continue
        size = rom[PIC_SHEETS + (rom[PIC_CODES + mid] >> 3)] & 0x0F
        render_tiles(picture(rom, mid), PIC_COLUMNS[size]).save(out / "monsters" / f"monster_{mid:02X}.png")
    return {"maps": len(seen), "monsters": 194, "font": 1}
