"""Export map captures as fixtures for the TypeScript renderer tests:
build/golden/field/<map>.json = {regs, player, oam, screen(shade indices, 160x144 hex)} and
<map>.vram / <map>.map / <map>.wram binaries. Screen shades: PyBoy palette 255/153/85/0 -> 0..3."""
import glob, json, os
import numpy as np
from PIL import Image

OUT = "build/golden/field"
os.makedirs(OUT, exist_ok=True)
SH = {255: 0, 153: 1, 85: 2, 0: 3}
n = 0
for f in sorted(glob.glob("build/maps/*.npz")):
    k = os.path.basename(f)[:4]
    z = np.load(f)
    shot = np.array(Image.open(f.replace(".npz", ".png")).convert("RGB"))[:, :, 0]
    scr = bytes(SH[int(x)] for x in shot.reshape(-1))
    w = bytes(z["wram"])
    json.dump({"regs": [int(x) for x in z["regs"]], "player": [w[0x42C], w[0x42D]],
               "oam": [int(x) for x in z["oam"]], "screen": scr.hex()}, open(f"{OUT}/{k}.json", "w"))
    open(f"{OUT}/{k}.vram", "wb").write(bytes(z["vram"]))
    open(f"{OUT}/{k}.map", "wb").write(bytes(z["map"]))
    open(f"{OUT}/{k}.wram", "wb").write(w)
    n += 1
print("fixtures", n)
