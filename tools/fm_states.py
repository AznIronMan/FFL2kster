"""Field-menu test states (build/states/fm_*.state, never committed): from first_town.state, at
the field main loop (00:1A43) queue a warp event (C443 = 5, C442 = destination index into 07:4000)
so the game itself loads the target map, and apply controlled RAM changes (GP, bag items, lowered
HP) that the shop/inn/item-menu traces exercise. Usage: python tools/fm_states.py"""
import sys
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator

ROM = open("input/original.gb", "rb").read()
USES = lambda i: ROM[0x0C * 0x4000 + 0x7E80 - 0x4000 + i]

# name: (destination index, GP, bag item ids or (id, uses), {member slot: HP}[, {address: byte}])
STATES = {
    "fm_shop0": (30, 1200, [29, 29, 32], {0: 10, 1: 20}),      # weapon shop 0, door at (11,13)
    "fm_shop12": (31, 1200, [29, 29, 32], {0: 10, 1: 20}),     # item shop 12, door at (26,31)
    "fm_inn": (33, 1200, [29], {0: 10, 1: 20, 2: 50}),         # inn, door at (43,14)
    "fm_inn_poor": (33, 40, [29], {0: 10, 1: 20, 2: 50}),      # inn without enough GP
    "fm_used": (31, 1200, [(29, 3), (32, 1), (66, 2)], {0: 10}),  # partly used items (bag uses given)
    "fm_items": (31, 1200, [0x43, 0x46, 0x47, 0x41, 0x77, 0x1D], {0: 10, 1: 20}),  # Power Body Tent Elixier Door Cure
    # member 1 mutant (ability 0x90 at 5 uses), member 2 monster 0x2D (ability 0x81 at 3), member 3
    # robot (Long at 10 uses): the inn's recovery 01:636C by type
    "fm_inn_types": (33, 1200, [29], {0: 10, 1: 20, 2: 30, 3: 40},
                     {0xC225: 1, 0xC233: 0x90, 0xC234: 5, 0xC244: 0x2D, 0xC245: 2, 0xC24F: 0x81, 0xC250: 3,
                      0xC265: 3, 0xC270: 10}),
    # member 0 robot, member 2 monster 0x2D (Equip by type: robot growth 0C:7B40, monster can't)
    "fm_types": (31, 1200, [23, 29], {0: 10}, {0xC205: 3, 0xC244: 0x2D, 0xC245: 2}),
    "fm_full": (31, 1200, [29, 32, 66, 31, 29, 32, 66, 31, 29, 32, 66, 31, 29, 32, 66, 31], {0: 10}),
}


def make(name, dest, gp, bag, hp, pokes=None):
    with Emulator("input/original.gb") as e:
        pb = e.pb
        e.load_state("build/states/first_town.state")
        done = []

        def at_loop(_):
            if done:
                return
            m = pb.memory
            m[0xC442] = dest & 0xFF
            m[0xC443] = 5 if dest < 256 else 6
            m[0xC2A2], m[0xC2A3], m[0xC2A4] = gp & 0xFF, (gp >> 8) & 0xFF, gp >> 16
            for k in range(16):
                i, u = bag[k] if k < len(bag) and isinstance(bag[k], tuple) else (bag[k] if k < len(bag) else 0xFF, None)
                m[0xC2B9 + 2 * k] = i
                m[0xC2BA + 2 * k] = u if u is not None else USES(i) if i != 0xFF else 0xFF
            for s, v in hp.items():
                m[0xC207 + 32 * s] = v & 0xFF
                m[0xC208 + 32 * s] = v >> 8
            for a, v in (pokes or {}).items():
                m[a] = v
            done.append(1)
        pb.hook_register(0, 0x1A43, at_loop, None)
        for _ in range(600):
            pb.tick(1, False)
        pb.hook_deregister(0, 0x1A43)
        pb.tick(1, True)
        e.save_state(f"build/states/{name}.state")
        print(name, "map", hex(pb.memory[0xC44B] | pb.memory[0xC44C] << 8), "cell",
              (pb.memory[0xC42C] + 5, pb.memory[0xC42D] + 4), "GP", bytes(pb.memory[0xC2A2:0xC2A5]).hex())


if __name__ == "__main__":
    for k, v in STATES.items():
        if len(sys.argv) < 2 or k in sys.argv[1:]:
            make(k, *v)
