"""Shop controlled change: rewrite the first town's exit script triggers (b0,b1 = 19,0 → story[19])
into shop events (shop_id, 4), replay from first_town.state to the exit, and record whether the
shop routine 01:647A runs (E = shop id) and what the screen shows. Usage:
python tools/shop_probe.py [shop_id] [states_dir]"""
import sys
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator
from ffl2kster.schema import maps as M
from ffl2kster.states import TOWN_ROUTE, _goto


def run(shop, states="build/states", rom_path="input/original.gb", patch=True, kind=4, ram=False):
    rom = bytearray(open(rom_path, "rb").read())
    h = M.header(bytes(rom), 0x4833)
    base = h["tail_offset"] - 2 * len(h["triggers"])
    if patch:
        for k, t in enumerate(h["triggers"]):
            if (t["b0"], t["b1"]) == (19, 0):
                rom[base + 2 * k] = shop; rom[base + 2 * k + 1] = kind
    p = "build/shop_probe.gb"; open(p, "wb").write(rom)
    hits, screens = [], []
    with Emulator(p) as emu:
        pb = emu.pb
        pb.hook_register(1, 0x647A, lambda _: hits.append(pb.register_file.E), None)
        emu.load_state(f"{states}/first_town.state")
        _goto(emu, TOWN_ROUTE, (40, 19))
        for k, n in (("right", 1), ("right", 2), ("up", 2), ("down", 3)):
            for _ in range(n):
                pb.button(k, 12); pb.tick(30, False)
            pb.tick(90, True)
            if hits:
                break
        pb.tick(120, True)
        for _ in range(3):
            pb.button("a", 10); pb.tick(90, True)
            screens.append(" ".join(l.strip() for l in emu.screen_text()))
        stock = [pb.memory[0xC71D + 2 * i] for i in range(8)]
        snap = bytes(pb.memory[0xC000:0xE000])
    return (hits, screens, stock, snap) if ram else (hits, screens, stock)


if __name__ == "__main__":
    shop = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    hits, screens, stock = run(shop, sys.argv[2] if len(sys.argv) > 2 else "build/states")
    print("hook E values:", hits, "stock C71D:", [hex(x) for x in stock])
    for s in screens[-3:]:
        print(repr(s[:200]))
