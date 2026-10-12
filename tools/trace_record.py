"""Record a frame-by-frame ground-truth trace from PyBoy for engine parity tests.
Output build/traces/<name>/: start.bin (memory 0x8000-0xFFFF at frame 0), trace.json
(per frame: joypad FF89/FF8A, LCD regs, key WRAM bytes) and screens.bin (160x144 shade bytes
per frame). Usage: python tools/trace_record.py NAME STATE "btn:frames,btn:frames,..." [total]
  btn in up/down/left/right/a/b/start/select/none; each item holds the button for N frames."""
import json, os, sys
import numpy as np
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator

SH = {255: 0, 153: 1, 85: 2, 0: 3}
KEYS = [0xC42C, 0xC42D, 0xC42E, 0xC42F, 0xC434, 0xC435, 0xC436, 0xC437, 0xC438, 0xC43C, 0xC43E,
        0xC442, 0xC443, 0xFFC1, 0xFFC2, 0xC4FF, 0xC7DF]


def main():
    name, state, plan = sys.argv[1], sys.argv[2], sys.argv[3]
    total = int(sys.argv[4]) if len(sys.argv) > 4 else None
    steps = []
    for item in plan.split(","):
        b, n = item.split(":")
        steps += [b] * int(n)
    if total:
        steps += ["none"] * max(0, total - len(steps))
    out = f"build/traces/{name}"
    os.makedirs(out, exist_ok=True)
    frames, screens = [], bytearray()
    with Emulator("input/original.gb") as e:
        pb = e.pb
        e.load_state(f"build/states/{state}.state")
        open(f"{out}/start.bin", "wb").write(bytes(pb.memory[0x8000:0x10000]))
        held = None
        for b in steps:
            if b != held:
                if held not in (None, "none"):
                    pb.button_release(held)
                if b != "none":
                    pb.button_press(b)
                held = b
            pb.tick(1, True)
            m = pb.memory
            shot = np.array(e.screenshot().convert("RGB"))[:, :, 0].reshape(-1)
            screens += bytes(SH.get(int(x), 0) for x in shot)
            frames.append({"btn": b, "ff89": m[0xFF89], "ff8a": m[0xFF8A],
                           "lcd": [m[0xFF40], m[0xFF42], m[0xFF43], m[0xFF4A], m[0xFF4B], m[0xFF47], m[0xFF48], m[0xFF49]],
                           "oam": bytes(m[0xFE00:0xFEA0]).hex(),
                           "keys": {f"{k:04X}": m[k] for k in KEYS}})
        if held not in (None, "none"):
            pb.button_release(held)
    json.dump({"state": state, "plan": plan, "frames": frames}, open(f"{out}/trace.json", "w"))
    open(f"{out}/screens.bin", "wb").write(bytes(screens))
    print(name, len(frames), "frames")


if __name__ == "__main__":
    main()
