"""Montage of frames from a Legend I trace: python tools/ffl1/trace_png.py NAME F1,F2,... OUT.png
(frame indexes; 'every:N' for every Nth frame). Output stays in ffl1/build (ROM-derived)."""
import gzip, json, sys
import numpy as np
from PIL import Image

name, sel, out = sys.argv[1], sys.argv[2], sys.argv[3]
d = f"ffl1/build/traces/{name}"
raw = np.frombuffer(gzip.decompress(open(f"{d}/screens.dx.gz", "rb").read()), dtype=np.uint8).reshape(-1, 144 * 160).copy()
for i in range(1, len(raw)):
    raw[i] ^= raw[i - 1]
frames = list(range(0, len(raw), int(sel.split(":")[1]))) if sel.startswith("every:") else [int(x) for x in sel.split(",")]
pal = np.array([255, 170, 85, 0], dtype=np.uint8)
cols = min(8, len(frames))
rows = (len(frames) + cols - 1) // cols
img = Image.new("L", (cols * 164, rows * 158), 128)
from PIL import ImageDraw
dr = ImageDraw.Draw(img)
for k, f in enumerate(frames):
    a = pal[raw[f].reshape(144, 160)]
    x, y = (k % cols) * 164, (k // cols) * 158
    img.paste(Image.fromarray(a), (x + 2, y + 12))
    dr.text((x + 2, y), str(f), fill=0)
img.save(out)
print(out, len(raw))
