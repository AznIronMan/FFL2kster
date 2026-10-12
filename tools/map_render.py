"""Render captured 64x64 maps (build/maps/*.npz) to PNG using the capture's VRAM tiles.
Metatile hypothesis: map byte m -> tiles 4*(m & 0x3F) .. +3 (TL, TR, BL, BR), tile data at
VRAM 0x8800-signed or 0x8000 per LCDC bit 4. Validates by locating the screenshot in the render."""
import glob, sys, os
import numpy as np
from PIL import Image

def tiles_from_vram(v, lcdc):
    def tile(i):
        if lcdc & 0x10: base = 0x0000 + 16 * i
        else: base = 0x1000 + 16 * (i - 256 if i >= 128 else i)
        t = v[base:base + 16]
        lo, hi = t[0::2], t[1::2]
        px = np.zeros((8, 8), np.uint8)
        for r in range(8):
            for c in range(8):
                px[r, c] = ((lo[r] >> (7 - c)) & 1) | (((hi[r] >> (7 - c)) & 1) << 1)
        return px
    return [tile(i) for i in range(256)]

def render(npz, mask=0x3F):
    z = np.load(npz); v, regs, mp = z['vram'], z['regs'], z['map'].reshape(64, 64)
    lcdc, bgp = regs[0], regs[5]
    T = tiles_from_vram(v, lcdc)
    shade = np.array([255 - 85 * ((bgp >> (2 * k)) & 3) for k in range(4)], np.uint8)
    img = np.zeros((64 * 16, 64 * 16), np.uint8)
    for y in range(64):
        for x in range(64):
            b = 4 * (int(mp[y, x]) & mask)
            img[16*y:16*y+8, 16*x:16*x+8] = T[(b) & 0xFF]
            img[16*y:16*y+8, 16*x+8:16*x+16] = T[(b+1) & 0xFF]
            img[16*y+8:16*y+16, 16*x:16*x+8] = T[(b+2) & 0xFF]
            img[16*y+8:16*y+16, 16*x+8:16*x+16] = T[(b+3) & 0xFF]
    return shade[img]

def match(npz, full):
    shot = np.array(Image.open(npz.replace('.npz', '.png')).convert('L')).astype(int)
    # compare a 128x96 central patch of the screenshot (sprites excluded imperfectly)
    best = (1e9, None)
    patch = shot[8:136, 16:144]
    for y in range(0, full.shape[0] - 128, 8):
        for x in range(0, full.shape[1] - 128, 8):
            d = np.abs(full[y:y+128, x:x+128].astype(int) - patch).mean()
            if d < best[0]: best = (d, (x, y))
    return best

if __name__ == '__main__':
    os.makedirs('build/maps/render', exist_ok=True)
    files = sys.argv[1:] or sorted(glob.glob('build/maps/*.npz'))
    for f in files:
        full = render(f)
        Image.fromarray(full).save(f.replace('build/maps/', 'build/maps/render/').replace('.npz', '_full.png'))
        d, pos = match(f, full)
        print(os.path.basename(f), 'best mean abs diff %.1f at %s' % (d, pos))
