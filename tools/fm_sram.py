"""Battery RAM ground truth for a field-menu trace: replays the trace's state and button plan
exactly as tools/trace_record.py does (start at the hook, one button set per frame) and writes
the cartridge RAM (bank 0, A000-BFFF) at the start and at the end to build/traces/<name>/
sram_start.bin and sram_end.bin. With --save-state OUT, also saves the emulator state at the end as build/states/OUT.state
(e.g. a game just saved to battery RAM, the start of a load trace).
Usage: python tools/fm_sram.py NAME [--save-state OUT]"""
import json, sys
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator


def sram(pb):
    return bytes(pb.memory[0, a] for a in range(0xA000, 0xC000))


def main(name, save_as=None):
    out = f"build/traces/{name}"
    meta = json.load(open(f"{out}/trace.json"))
    steps = [f["btn"] for f in meta["frames"]]
    with Emulator("input/original.gb") as e:
        pb = e.pb
        st = meta["state"]
        e.load_state(st if "/" in st else f"build/states/{st}.state")
        hb, ha = (int(x, 16) for x in meta["hook"].split(":"))
        hit = []
        pb.hook_register(hb, ha, lambda _: hit.append(1), None)
        for _ in range(3000):
            pb.tick(1, False)
            if hit:
                break
        pb.hook_deregister(hb, ha)
        open(f"{out}/sram_start.bin", "wb").write(sram(pb))
        held = set()
        for b in steps:
            want = set() if b == "none" else set(b.split("+"))
            for k in held - want:
                pb.button_release(k)
            for k in want - held:
                pb.button_press(k)
            held = want
            pb.tick(1, False)
        open(f"{out}/sram_end.bin", "wb").write(sram(pb))
        if save_as:
            for k in held:
                pb.button_release(k)
            e.save_state(f"build/states/{save_as}.state")
    print(name, "sram written")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[sys.argv.index("--save-state") + 1] if "--save-state" in sys.argv else None)
