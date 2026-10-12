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
    # battles (0D:4000 main loop): Fight with A until the end, then more encounters on the map
    "battle_fight": ("pre_battle", [("a", 140)]),
    "battle_walk": ("world", [("up", 1), ("a", 3), ("down", 1), ("a", 3)] * 500),
    # a party member with 1 HP (dies), and the whole party with 1 HP (defeat → game over)
    "battle_death": ("pre_battle", [("poke", (0xC207, 1)), ("poke", (0xC208, 0)), ("a", 140)]),
    "battle_defeat": ("pre_battle", [("poke", (a, v)) for a in (0xC207, 0xC227, 0xC247, 0xC267) for v in (1,)]
                      + [("poke", (a, 0)) for a in (0xC208, 0xC228, 0xC248, 0xC268)] + [("a", 140)]),
    "battle_run": ("pre_battle", [("wait", 6), ("down", 1), ("a", 40), ("up", 2), ("a", 60), ("down", 2), ("a", 60)]),
    "battle_meat": ("meat_prompt", [("a", 30)]),
    "battle_meat_slime": ("meat_prompt_slime", [("a", 30)]),
    # the Eat prompt, then the eater: member 1-3 (down n times), A
    **{f"battle_meat_{st}{n}": (f"meat_prompt{st}", [("a", 1), ("wait", 2)] + [("down", 1)] * n + [("a", 30)])
       for st in ("", "_slime") for n in (1, 2, 3)},
    # eater n made a monster of id m in its battle copy (D[n]0A = m, D[n]0B = type 2): transformations
    **{f"battle_meat_mon{n}_{m:02x}": ("meat_prompt_slime", [("poke", (0xD00A + 0x100 * n, m)), ("poke", (0xD00B + 0x100 * n, 2)),
                                                            ("a", 1), ("wait", 2)] + [("down", 1)] * n + [("a", 30)])
       for n in (0, 1, 2, 3) for m in (0x08, 0x31, 0x52, 0x77, 0x9c, 0xc5)},
    "battle_jaguar": ("battle_jaguar", [("up", 2), ("a", 80), ("down", 2), ("a", 80)]),
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
        if k == "poke":  # ("poke", (addr, value))
            pb.memory[n[0]] = n[1]
            continue
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


class _Stop(Exception):
    pass


def run(name, stubs, stops=()):
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
        stopped = None

        def stop(c, s):
            raise _Stop(s)
        for s in stops:  # end of a code segment: stop when PC reaches it (registers as there)
            if isinstance(s, tuple):  # (routine, address): only for that routine's entries
                if s[0] != ent["routine"]:
                    continue
                s = s[1]
            traps[s] = lambda c, s=s: stop(c, s)
        cpu.ly = 0
        before = bytes(cpu.mem[0x8000:0x10000])
        try:
            cpu.call(int(a, 16), traps=traps)
        except _Stop as x:
            stopped = x.args[0]
        after = bytes(cpu.mem[0x8000:0x10000])
        changes = [[0x8000 + i, x, y] for i, (x, y) in enumerate(zip(before, after))
                   if x != y and not (0xFFC0 <= 0x8000 + i)]
        json.dump({"regs": {"a": cpu.a, "b": cpu.b, "c": cpu.c, "d": cpu.d, "e": cpu.e, "h": cpu.h, "l": cpu.l},
                   "bank": cpu.bank, "calls": calls, "changes": changes,
                   **({"stopped": stopped} if stopped is not None else {})},
                  open(f"{out}/{ent['n']:04d}.out.json", "w"))
    print(name, len(idx), "oracle results")


def synth(src, dst, routine, reg, values, poke=None):
    """Variants of captured entries: each `routine` entry of capture `src` with register `reg`
    set to each value (and optionally the byte at `poke` set to it instead), into capture `dst`
    (e.g. other formation numbers / zones on real snapshots). Then `run dst` as usual."""
    out = f"build/routines/{dst}"
    os.makedirs(out, exist_ok=True)
    idx = []
    for ent in json.load(open(f"build/routines/{src}/index.json")):
        if ent["routine"] != routine:
            continue
        mem = bytearray(open(f"build/routines/{src}/{ent['n']:04d}.bin", "rb").read())
        for v in values:
            e2 = json.loads(json.dumps(ent))
            m2 = bytearray(mem)
            if poke is not None:
                m2[poke - 0x8000] = v
            else:
                e2["regs"][reg] = v
            e2["n"] = len(idx)
            e2["from"] = f"{src}#{ent['n']}"
            open(f"{out}/{e2['n']:04d}.bin", "wb").write(bytes(m2))
            idx.append(e2)
    json.dump(idx, open(f"{out}/index.json", "w"), indent=1)
    print(dst, len(idx), "variants")


if __name__ == "__main__":
    if sys.argv[1] == "synth":
        # synth SRC DST ROUTINE REG|@ADDR v,v,... (hex values; @ADDR pokes memory instead of a register)
        tgt = sys.argv[5]
        vals = [int(x, 16) for x in sys.argv[6].split(",")]
        synth(sys.argv[2], sys.argv[3], sys.argv[4], None if tgt.startswith("@") else tgt, vals,
              int(tgt[1:], 16) if tgt.startswith("@") else None)
    elif sys.argv[1] == "capture":
        capture(sys.argv[2], sys.argv[3], sys.argv[4].split(","), int(sys.argv[5]) if len(sys.argv) > 5 else 200)
    else:
        # run NAME [stubs] [--stop a,b]: stubs return at once; reaching a stop address ends the run
        argv = list(sys.argv)
        stops = []
        if "--stop" in argv:
            i = argv.index("--stop")
            # a,b,... or ROUTINE=addr (e.g. 0D:4000=01D4) for one routine's entries only
            stops = [(x.split("=")[0].upper(), int(x.split("=")[1], 16)) if "=" in x else int(x, 16)
                     for x in argv[i + 1].split(",")]
            del argv[i:i + 2]
        run(argv[2], [int(x, 16) for x in argv[3].split(",") if x] if len(argv) > 3 else [], stops)
