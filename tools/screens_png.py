"""build/sweep/dump/*.exp.bin / *.got.bin (160x144 shades) -> side-by-side PNGs (expected | engine |
differences in red). Usage: python tools/screens_png.py [PREFIX]"""
import glob, os, sys
import numpy as np
from PIL import Image
PAL = np.array([255, 170, 85, 0], dtype=np.uint8)
for e in sorted(glob.glob(f"build/sweep/dump/{sys.argv[1] if len(sys.argv) > 1 else ''}*.exp.bin")):
    g = e.replace(".exp.bin", ".got.bin")
    a = np.fromfile(e, dtype=np.uint8).reshape(144, 160)
    b = np.fromfile(g, dtype=np.uint8).reshape(144, 160) if os.path.exists(g) else a
    ea, eb = PAL[a], PAL[b]
    d = np.stack([ea, ea, ea], -1).copy()
    d[a != b] = [255, 0, 0]
    im = np.concatenate([np.stack([ea] * 3, -1), np.stack([eb] * 3, -1), d], axis=1)
    Image.fromarray(im).resize((480 * 2, 144 * 2), Image.NEAREST).save(e.replace(".exp.bin", ".png"))
    print(e.replace(".exp.bin", ".png"), int((a != b).sum()))
