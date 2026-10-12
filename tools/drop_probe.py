"""Drop probe: fight the pre_battle encounter repeatedly (varying idle frames before the step to
vary RNG), hook the message printer rst $20 (00:0020 → 00:0800, DE = message index) and record
battle messages + their caller return address. Output: build/drop_probe.json.
Usage: python tools/drop_probe.py [rom] [state] [direction] [runs]"""
import json, sys
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator

def run(rom, state, direction, idle):
    calls = []; snap = {}
    with Emulator(rom) as emu:
        pb = emu.pb
        def cb(_):
            r = pb.register_file
            sp = r.SP
            ret = pb.memory[sp] | pb.memory[sp + 1] << 8
            calls.append({"de": r.D << 8 | r.E, "ret": ret, "battle": pb.memory[0xFF8B],
                          "frame": pb.frame_count})
        pb.hook_register(0, 0x0020, cb, None)
        emu.load_state(state)
        pb.tick(idle, False)
        emu.step_into_battle(direction)
        texts = []
        for _ in range(160):
            pb.button("a", 6); pb.tick(20, False)
            t = " ".join(l.strip("| ·").strip() for l in emu.screen_text()[:10])
            if not texts or texts[-1] != t:
                texts.append(t)
            if "Received" in t and "d900" not in snap:
                snap["d900"] = bytes(pb.memory[0xD900:0xD910]).hex(" ")
                snap["wram"] = bytes(pb.memory[0xC000:0xE000]).hex()
            if pb.memory[0xFF8B] == 0 and len(calls) > 3:
                break
        party = [pb.memory[0xC20F + 0x20 * k] for k in range(4)]
    return {"idle": idle, "calls": calls, "texts": [t for t in texts if "Received" in t or "meat" in t or "fell" in t][-6:], **snap}

if __name__ == "__main__":
    rom = sys.argv[1] if len(sys.argv) > 1 else "input/original.gb"
    state = sys.argv[2] if len(sys.argv) > 2 else "build/states/pre_battle.state"
    d = sys.argv[3] if len(sys.argv) > 3 else "up"
    n = int(sys.argv[4]) if len(sys.argv) > 4 else 6
    out = [run(rom, state, d, i * 7) for i in range(n)]
    json.dump(out, open("build/drop_probe.json", "w"), indent=1)
    for o in out:
        msgs = sorted({(c["de"], hex(c["ret"])) for c in o["calls"] if c["battle"]})
        print(o["idle"], o.get("d900"), [t[-40:] for t in o["texts"]][-3:])
