"""Find field event targets for the event sweep (tools/ffl1/traces.py EVENT_SWEEP): every map is
entered as in the field sweep (its first warp poked at the field loop of the first town), then
the map buffer D000 (64 x 62 metatiles) and the attribute table DF80 are read: a cell whose
attribute e has bit 7 triggers event command e & 0F with parameter d when stepped on (00:2173).
Objects come from the map's event list (ffl1/data/maps.json, M5). Writes
ffl1/build/event_targets.json (ROM-derived, local):
    {"cells": [[map, x, y, cmd, d], ...], "objects": [[map, x, y, cmd, param], ...]}
    python tools/ffl1/event_targets.py
"""
import json
import sys
sys.path.insert(0, "tools/ffl1")
sys.path.insert(0, "src")
from ffl1kster.emu import Emulator  # noqa: E402

FIELD = (0, 0x1243)


def main():
    import traces
    out = {"cells": [], "objects": []}
    data = json.load(open("ffl1/data/maps.json"))
    for mp in data["maps"]:
        for e in mp.get("event_list", []):
            if "command" in e:
                out["objects"].append([mp["id"], e["x"], e["y"], e["command"], e["param"]])
    with Emulator("ffl1/input/original.gb") as emu:
        pb = emu.pb
        for name, w in traces.FIELD_SWEEP.items():
            emu.load_state("ffl1/build/states/town0.state")
            hit = []
            pb.hook_register(*FIELD, lambda _: hit.append(1), None)
            for _ in range(3000):
                pb.tick(1, False)
                if hit:
                    break
            pb.hook_deregister(*FIELD)
            for ad, v in ((0xC5BA, 0), (0xC3A9, 6 if w >= 0x100 else 5), (0xC3AA, w & 0xFF), (0xC3AB, 1)):
                pb.memory[ad] = v
            for _ in range(120):
                pb.tick(1, False)
            m = pb.memory
            mp = m[0xCCC7]
            for row in range(62):
                for col in range(64):
                    v = m[0xD000 + (row << 6 | col)]
                    lo = ((v * 2) | 0x80) & 0xFF
                    e, d = m[0xDF00 | lo], m[0xDF00 | ((lo + 1) & 0xFF)]
                    if e & 0x80:
                        out["cells"].append([mp, col, row, e & 0x0F, d])
    json.dump(out, open("ffl1/build/event_targets.json", "w"))
    from collections import Counter
    print("cells", len(out["cells"]), sorted(Counter(c[3] for c in out["cells"]).items()))
    print("objects", len(out["objects"]), sorted(Counter(o[3] for o in out["objects"]).items()))


if __name__ == "__main__":
    main()
