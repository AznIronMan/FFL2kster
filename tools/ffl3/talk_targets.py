"""Find the talk sweep's targets (tools/ffl3/traces.py talk_sweep): from each map's end state
(ffl3/build/states/mXX.state, saved by the map sweep) run to the field loop and list the objects
there (slots 2-F with C200 set: id C200, type C350) and the cell the leader faces (C6EE: 00 up, 40
right, 80 down, C0 left) as the pixel position to poke them to. Writes ffl3/build/talk_targets.json
(ROM-derived, local):  [{"state", "map", "slot", "id", "type", "y", "x"}, ...]
    python tools/ffl3/talk_targets.py
"""
import json
import os
import sys
sys.path.insert(0, "src")
from ffl3kster.emu import Emulator  # noqa: E402

FIELD = (0, 0x0265)


def main():
    out = []
    with Emulator("ffl3/input/original.gb") as emu:
        pb = emu.pb
        for f in sorted(os.listdir("ffl3/build/states")):
            if not (f.startswith("m") and len(f) == 9 and f.endswith(".state")):
                continue
            emu.load_state(f"ffl3/build/states/{f}")
            hit = []
            pb.hook_register(*FIELD, lambda _: hit.append(1), None)
            for _ in range(600):
                pb.tick(1, False)
                if hit:
                    break
            pb.hook_deregister(*FIELD)
            if not hit:
                continue
            m = pb.memory
            mp = m[0xC6E8]
            y = m[0xC210] | m[0xC211] << 8
            x = m[0xC230] | m[0xC231] << 8
            dy, dx = {0x00: (-16, 0), 0x40: (0, 16), 0x80: (16, 0), 0xC0: (0, -16)}.get(m[0xC6EE], (16, 0))
            for s in range(2, 16):
                if m[0xC200 + s]:
                    out.append({"state": f[:-6], "map": mp, "slot": s, "id": m[0xC200 + s], "type": m[0xC350 + s],
                                "y": (y + dy) & 0xFFFF, "x": (x + dx) & 0xFFFF})
    json.dump(out, open("ffl3/build/talk_targets.json", "w"))
    from collections import Counter
    print("objects", len(out), "maps", len({o["map"] for o in out}), "types", sorted(Counter(o["type"] for o in out).items()))


if __name__ == "__main__":
    main()
