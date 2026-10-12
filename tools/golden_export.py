"""Write build/golden/golden.json: Python reference outputs that are not already in data/
(layout renders with chosen progress variables, graphics digests) for the TypeScript importer's
golden tests (port/packages/importer/test). ROM-derived; stays in build/ (gitignored)."""
import hashlib, json, os, random, sys
sys.path.insert(0, "src")
from ffl2kster import gfx, layout
from ffl2kster.schema import maps as M

rom = open(sys.argv[1] if len(sys.argv) > 1 else "input/original.gb", "rb").read()
rnd = random.Random(7)
out = {"layouts": [], "tilesets": {}, "monsters": {}}
for h in M.all_headers(rom):
    hd = M.header(rom, h)
    off = layout.stream_offset(hd["layout_ptr"])
    cond = any(o["op"] == "if_var" for o in layout.parse(rom, off))
    for k in range(3 if cond else 1):
        v = [0] * 32 if k == 0 else [rnd.randrange(16) for _ in range(32)]
        saved = bytearray(256)
        m = layout.render(rom, off, v, hd["flags"] & 0x0F, saved)
        out["layouts"].append({"map": f"{h:04x}", "vars": v, "trigger_count": hd["flags"] & 0x0F,
                               "sha256": hashlib.sha256(bytes(m)).hexdigest(),
                               "saved": bytes(saved).hex()})
    out["tilesets"][str(hd["b2"])] = hashlib.sha256(gfx.vram_bg(rom, hd["b2"])).hexdigest()
for mid in range(256):
    w, h, d = gfx.monster_graphic(rom, mid)
    out["monsters"][str(mid)] = [w, h, hashlib.sha256(d).hexdigest()]
os.makedirs("build/golden", exist_ok=True)
json.dump(out, open("build/golden/golden.json", "w"))
print("layouts", len(out["layouts"]), "tilesets", len(out["tilesets"]))
