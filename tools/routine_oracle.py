"""Routine-level parity oracle.

capture: play a scenario in PyBoy and snapshot the machine at every entry of the given routines
  (bank:addr): registers + memory 0x8000-0xFFFF -> build/routines/<name>/<n>.bin + index.json
run:     execute each captured routine in the SM83 oracle until it returns (stubs for
  presentation/wait routines) -> build/routines/<name>/<n>.out.json {regs, changes}
Usage: python tools/routine_oracle.py capture NAME SCENARIO bank:addr[,bank:addr...] [max]
       python tools/routine_oracle.py run NAME [stub_addr,...]"""
import json, os, sys
sys.path.insert(0, "src")

SCENARIOS = {
    # state, list of (button, presses)
    "town_walk": ("first_town", [("down", 2), ("left", 3), ("up", 6), ("right", 8), ("up", 4), ("left", 2), ("down", 3)]),
    "town_route": ("first_town", "TOWN_ROUTE"),
    "world_walk": ("world", [("up", 7), ("down", 7), ("left", 3), ("right", 3)]),
    "door": ("../maps/door", [("up", 1), ("wait", 6), ("down", 3), ("up", 1)]),
}


def play(e, scen):
    from ffl2kster.states import TOWN_ROUTE, _goto
    state, moves = SCENARIOS[scen]
    e.load_state(f"build/states/{state}.state")
    pb = e.pb
    if moves == "TOWN_ROUTE":
        _goto(e, TOWN_ROUTE, (40, 19))
        for k, n in (("right", 1), ("right", 2), ("up", 2), ("down", 3)):
            for _ in range(n):
                pb.button(k, 12); pb.tick(30, False)
            pb.tick(90, True)
        return
    if moves == "DOOR":
        _goto(e, TOWN_ROUTE, (28, 24))
        for k in ("left", "up", "up", "up", "down", "down", "down"):
            pb.button(k, 12); pb.tick(40, False)
        return
    for k, n in moves:
        for _ in range(n):
            if k == "wait":
                pb.tick(30, False); continue
            pb.button(k, 12); pb.tick(30, False)
    pb.tick(60, False)


def capture(name, scen, targets, mx):
    from ffl2kster.emu import Emulator
    out = f"build/routines/{name}"
    os.makedirs(out, exist_ok=True)
    idx = []
    with Emulator("input/original.gb") as e:
        pb = e.pb
        def mk(bank, addr):
            def cb(_):
                if len(idx) >= mx:
                    return
                r = pb.register_file
                regs = {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL, "sp": r.SP}
                n = len(idx)
                open(f"{out}/{n:04d}.bin", "wb").write(bytes(pb.memory[0x8000:0x10000]))
                idx.append({"n": n, "routine": f"{bank:02X}:{addr:04X}", "regs": regs, "bank": pb.memory[0xFF88],
                            "frame": pb.frame_count})
            return cb
        for t in targets:
            b, a = t.split(":")
            pb.hook_register(int(b, 16), int(a, 16), mk(int(b, 16), int(a, 16)), None)
        play(e, scen)
    json.dump(idx, open(f"{out}/index.json", "w"), indent=1)
    print(name, len(idx), "snapshots")


def run(name, stubs):
    from ffl2kster.sm83 import CPU
    rom = open("input/original.gb", "rb").read()
    out = f"build/routines/{name}"
    idx = json.load(open(f"{out}/index.json"))
    for ent in idx:
        mem = open(f"{out}/{ent['n']:04d}.bin", "rb").read()
        cpu = CPU(rom)
        cpu.mem[0x8000:0x10000] = mem
        r = ent["regs"]
        cpu.a, cpu.f, cpu.b, cpu.c, cpu.d, cpu.e = r["a"], r["f"], r["b"], r["c"], r["d"], r["e"]
        cpu.h, cpu.l = r["hl"] >> 8, r["hl"] & 0xFF
        cpu.bank = ent["bank"] or 1
        b, a = ent["routine"].split(":")
        calls = []
        traps = {s: (lambda c, s=s: calls.append(s)) for s in stubs}
        cpu.ly = 0
        before = bytes(cpu.mem[0x8000:0x10000])
        cpu.call(int(a, 16), traps=traps)
        after = bytes(cpu.mem[0x8000:0x10000])
        changes = [[0x8000 + i, x, y] for i, (x, y) in enumerate(zip(before, after))
                   if x != y and not (0xFFC0 <= 0x8000 + i)]
        json.dump({"regs": {"a": cpu.a, "b": cpu.b, "c": cpu.c, "d": cpu.d, "e": cpu.e, "h": cpu.h, "l": cpu.l},
                   "bank": cpu.bank, "calls": calls, "changes": changes},
                  open(f"{out}/{ent['n']:04d}.out.json", "w"))
    print(name, len(idx), "oracle results")


if __name__ == "__main__":
    if sys.argv[1] == "capture":
        capture(sys.argv[2], sys.argv[3], sys.argv[4].split(","), int(sys.argv[5]) if len(sys.argv) > 5 else 200)
    else:
        run(sys.argv[2], [int(x, 16) for x in sys.argv[3].split(",")] if len(sys.argv) > 3 else [])
