"""Capture real calc-VM invocations: hook the dispatcher 0D:4361 (A = script index) during
battles played from the standard states and save the full C000-FFFF memory at each call.
Output: build/vm_snapshots/<n>.bin (0x4000 bytes = C000..FFFF) + index.json.
Usage: python tools/vm_snapshots.py [max_per_battle]"""
import json, os, sys
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator

OUT = "build/vm_snapshots"
BATTLES = [("pre_battle", "up"), ("pre_battle_id180", "down"), ("pre_battle_id45", "down"), ("pre_battle_id185", "down")]


def main():
    lim = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    os.makedirs(OUT, exist_ok=True)
    states = json.load(open("build/states/states.json"))
    idx, n = [], 0
    for name, d in BATTLES:
        if name in states:
            d = states[name]["direction"]
        path = f"build/states/{name}.state"
        if not os.path.exists(path):
            continue
        with Emulator("input/original.gb") as e:
            pb = e.pb
            got = []
            def cb(_):
                if len(got) < lim:
                    got.append((pb.register_file.A, bytes(pb.memory[0xC000:0x10000]), pb.frame_count))
            pb.hook_register(0x0D, 0x4361, cb, None)
            e.load_state(path)
            e.press(d)
            for _ in range(300):
                pb.button("a", 6); pb.tick(20, False)
            for script, mem, fr in got:
                open(f"{OUT}/{n:04d}.bin", "wb").write(mem)
                idx.append({"snap": n, "battle": name, "script": script, "frame": fr})
                n += 1
    json.dump(idx, open(f"{OUT}/index.json", "w"), indent=1)
    from collections import Counter
    print(n, "snapshots", Counter(x["script"] for x in idx))


if __name__ == "__main__":
    main()
