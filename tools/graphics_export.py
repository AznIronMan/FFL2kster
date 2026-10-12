"""Export processed graphics (PNG) from captures and ROM:
- data/graphics/monsters/<id>.png : battle graphic, trimmed (from build/monsters, monster_capture.py)
- data/graphics/tilesets/<hash>.png : BG tile sheets from map captures (deduplicated) + index.json
- data/graphics/overworld/<code>.png : 16-tile sprite pages, bank 03 (codes 0x00-0x3F) and 04
Tiles are 2bpp GB format shown with the default DMG shades."""
import glob, hashlib, json, os, sys
import numpy as np
from PIL import Image
SHADE = np.array([255, 170, 85, 0], np.uint8)

def tile_px(t):
    lo, hi = np.frombuffer(t[0::2], np.uint8), np.frombuffer(t[1::2], np.uint8)
    bits = np.arange(7, -1, -1)
    return (((lo[:, None] >> bits) & 1) | (((hi[:, None] >> bits) & 1) << 1)).astype(np.uint8)

def sheet(data, cols=16):
    n = len(data) // 16; rows = (n + cols - 1) // cols
    img = np.zeros((rows * 8, cols * 8), np.uint8)
    for i in range(n):
        r, c = divmod(i, cols); img[r*8:r*8+8, c*8:c*8+8] = tile_px(data[16*i:16*i+16])
    return Image.fromarray(SHADE[img])

def sprite_sheet(data):
    """Overworld sprite page (0x100 bytes = 16 tiles = 4 frames of 16x16, tiles TL,TR,BL,BR)."""
    n = len(data) // 64
    img = np.zeros((16, n * 16), np.uint8)
    for k in range(n):
        f = data[64*k:64*k+64]
        img[0:8, 16*k:16*k+8] = tile_px(f[0:16]); img[0:8, 16*k+8:16*k+16] = tile_px(f[16:32])
        img[8:16, 16*k:16*k+8] = tile_px(f[32:48]); img[8:16, 16*k+8:16*k+16] = tile_px(f[48:64])
    return Image.fromarray(SHADE[img]).resize((n * 32, 32), Image.NEAREST)

def main():
    rom = open(sys.argv[1] if len(sys.argv) > 1 else 'input/original.gb', 'rb').read()
    os.makedirs('data/graphics/monsters', exist_ok=True)
    for f in sorted(glob.glob('build/monsters/*.png')):
        im = Image.open(f).convert('L').crop((0, 0, 160, 64))
        a = np.array(im); ys, xs = np.where(a < 250)
        if len(xs): im = im.crop((max(0, xs.min() - 1), max(0, ys.min() - 1), min(160, xs.max() + 2), min(64, ys.max() + 2)))
        im.save('data/graphics/monsters/' + os.path.basename(f))
    idx = export_tilesets(rom)
    os.makedirs('data/graphics/overworld', exist_ok=True)
    for code in range(0x80):
        bank, addr = (3, 0x4000 + code * 0x100) if code < 0x40 else (4, 0x4000 + (code - 0x40) * 0x100)
        o = bank * 0x4000 + addr - 0x4000
        sprite_sheet(rom[o:o + 0x100]).save(f'data/graphics/overworld/{code:02x}.png')
    print('monsters', len(glob.glob('data/graphics/monsters/*.png')), 'tilesets', len(set(idx['maps'].values())),
          'overworld pages', 0x80)


def export_tilesets(rom, out="data/graphics/tilesets"):
    """ROM-derived tileset sheets (ffl2kster.gfx; verified against 211 VRAM captures):
    ts_XX.png = 64 metatiles (8 per row, 16x16 each) of tileset XX; index.json maps
    map header -> tileset."""
    sys.path.insert(0, "src")
    from ffl2kster import gfx
    from ffl2kster.schema import maps as M
    os.makedirs(out, exist_ok=True)
    idx = {f"{h:04x}": M.header(rom, h)["b2"] for h in M.all_headers(rom)}
    for t in sorted(set(idx.values())):
        img = np.zeros((128, 128), np.uint8)
        for m in range(64):
            blk = gfx.metatile_tiles(rom, t, m)
            r, c = divmod(m, 8)
            for q in range(4):
                y0, x0 = r * 16 + (q // 2) * 8, c * 16 + (q % 2) * 8
                img[y0:y0 + 8, x0:x0 + 8] = tile_px(blk[16 * q:16 * q + 16])
        Image.fromarray(SHADE[img]).save(os.path.join(out, f"ts_{t:02d}.png"))
    json.dump({"maps": idx, "format": "ts_XX.png: 8x8 grid of 16x16 metatiles 0-63"},
              open(os.path.join(out, "index.json"), "w"), indent=1)
    return {"maps": idx}


def export_font(rom, out="data/graphics/font"):
    """Font: text codes 0x80-0xFF use 2bpp tiles at 04:4800 + 16*(code-0x80) (file 0x10800;
    located by matching battle-screen VRAM tiles 0x9E-0xFF to the ROM, run starts 0x109E0)."""
    sys.path.insert(0, "src")
    from ffl2kster import script_text as st
    os.makedirs(out, exist_ok=True)
    data = rom[0x10800:0x11000]
    sheet(data).resize((128 * 3, 64 * 3), Image.NEAREST).save(os.path.join(out, "font.png"))
    json.dump({"tile_base_file_offset": 0x10800, "first_code": 0x80, "columns": 16,
               "glyphs": {f"{c:02X}": st.glyph(c) for c in range(0x9E, 0x100)}},
              open(os.path.join(out, "font.json"), "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
    export_font(open(sys.argv[1] if len(sys.argv) > 1 else "input/original.gb", "rb").read())
