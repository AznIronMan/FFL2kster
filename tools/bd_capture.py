"""Battle display/animation ground truth (0F:6080 and 0D:5000 tables) from PyBoy.

trace: run STATE (pressing the PRE plan) until the CPU reaches HOOK (the Nth time), optionally
  write memory there (--set ADDR=VAL,...: controlled changes, e.g. the animation id D910), save
  the machine as the start snapshot, then record frame by frame like tools/trace_record.py
  (screens, wram/vram/oam/hram per frame, waits.bin = machine at every rst $10 wake) until the
  routine returns (return address taken from the stack at the hook, SP checked) plus AFTER
  frames. A PyBoy tick runs from line 0 through vblank; waits are labelled with the index of the
  recorded tick they complete in, -1 for the hook's own tick (whose lines are not recorded).
  trace.json gets "ret": {waits, frame, regs} and ret.bin the machine at the return;
  screens.bin.gz / waits.bin.gz hold the frames and waits (no per-frame RAM dumps). --pre-set-at
  BB:AAAA --pre-set A=V,... writes memory at the first hit of another hook before (e.g. extra
  enemy groups at the battle opening). Output build/traces/<name>/ (never committed).
traces [NAME...]: record the named (default: all) scenarios of TRACES below.
snaps [NAME]: capture the oracle snapshots of snap_runs() below (default build/routines/bd_nowait)
  and run them in the SM83 oracle.
snap: capture routine-oracle snapshots (format of tools/routine_oracle.py, build/routines/<name>)
  at every entry of the given routines while playing STATE with a button PLAN, optionally
  rewriting memory at another hook first (--set-at BB:AAAA --set ADDR=VAL,... applied on every hit,
  values may be lists 'a|b|c' cycled per hit). Then: python tools/routine_oracle.py run NAME.

Usage:
  python tools/bd_capture.py trace NAME STATE --hook BB:AAAA [--pre PLAN] [--nth N] [--set A=V,..]
         [--plan PLAN] [--after N] [--max N] [--pre-set-at BB:AAAA --pre-set A=V,...]
  python tools/bd_capture.py traces [NAME ...]
  python tools/bd_capture.py snaps [NAME]
  python tools/bd_capture.py snap NAME STATE BB:AAAA[,BB:AAAA...] --plan PLAN [--max N]
         [--set-at BB:AAAA --set A=V,...]
PLAN: "btn:frames,..." with btn in up/down/left/right/a/b/start/select/none (joined by '+')."""
import gzip, json, os, sys
import numpy as np
sys.path.insert(0, "src")
from ffl2kster.emu import Emulator

SH = {255: 0, 153: 1, 85: 2, 0: 3}


def opt(args, name, default=None):
    if name in args:
        i = args.index(name)
        v = args[i + 1]
        del args[i:i + 2]
        return v
    return default


def plan_steps(plan):
    steps = []
    for item in (plan or "").split(","):
        if not item:
            continue
        b, n = item.split(":")
        steps += [b] * int(n)
    return steps


def parse_sets(s):
    """'ADDR=V' (V may be 'a|b|c', cycled per hit) or 'SRC>DST:LEN' (copy LEN hex bytes)."""
    out = []
    for item in (s or "").split(","):
        if not item:
            continue
        if ">" in item:
            src, rest = item.split(">")
            dst, n = rest.split(":")
            out.append(("copy", (int(src, 16), int(dst, 16), int(n, 16))))
            continue
        a, v = item.split("=")
        out.append((int(a, 16), [int(x, 0) for x in v.split("|")]))
    return out


def apply_sets(pb, sets, i=0):
    for a, vs in sets:
        if a == "copy":
            src, dst, n = vs
            data = [pb.memory[src + k] for k in range(n)]
            for k in range(n):
                pb.memory[dst + k] = data[k]
        else:
            pb.memory[a] = vs[i % len(vs)]


class Buttons:
    def __init__(self, pb):
        self.pb, self.held = pb, set()

    def set(self, b):
        want = set() if b == "none" else set(b.split("+"))
        for k in self.held - want:
            self.pb.button_release(k)
        for k in want - self.held:
            self.pb.button_press(k)
        self.held = want


def trace(args):
    name, state = args[0], args[1]
    hook = opt(args, "--hook")
    pre = plan_steps(opt(args, "--pre", ""))
    nth = int(opt(args, "--nth", "1"))
    sets = parse_sets(opt(args, "--set", ""))
    plan = plan_steps(opt(args, "--plan", ""))
    after = int(opt(args, "--after", "2"))
    mx = int(opt(args, "--max", "3000"))
    pre_at = opt(args, "--pre-set-at")
    pre_sets = parse_sets(opt(args, "--pre-set", ""))
    out = f"build/traces/{name}"
    os.makedirs(out, exist_ok=True)
    frames, screens = [], bytearray()
    waits, wait_frames = bytearray(), []
    start, ret = {}, {}
    cur = [-1]  # trace frame index of the tick being run (-1: the hook's own tick, not recorded)
    hits = [0]
    armed = [False]
    with Emulator("input/original.gb") as e:
        pb = e.pb
        e.load_state(state if "/" in state else f"build/states/{state}.state")
        hb, ha = (int(x, 16) for x in hook.split(":"))

        def at_ret(_):
            if ret or not start:
                return
            r = pb.register_file
            if r.SP != (start["regs"]["sp"] + 2) & 0xFFFF:
                return
            ret.update({"waits": len(wait_frames), "frame": cur[0], "ly": pb.memory[0xFF44],
                        "regs": {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL, "sp": r.SP},
                        "mem": bytes(pb.memory[0x8000:0x10000])})

        def at_hook(_):
            if start:
                return
            hits[0] += 1
            if hits[0] < nth:
                return
            apply_sets(pb, sets)
            r = pb.register_file
            start["regs"] = {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL, "sp": r.SP, "pc": r.PC}
            start["mem"] = bytes(pb.memory[0x8000:0x10000])
            start["frame"] = pb.frame_count
            start["ly"] = pb.memory[0xFF44]
            sp = r.SP
            ra = pb.memory[sp] | pb.memory[sp + 1] << 8
            start["ret"] = ra
            pb.hook_register(0 if ra < 0x4000 else pb.memory[0xFF88], ra, at_ret, None)

        def arm(_):
            if start:
                armed[0] = True

        def at_halt(_):
            if armed[0]:
                armed[0] = False
                waits.extend(bytes(pb.memory[0x8000:0x10000]))
                wait_frames.append(cur[0])
        pb.hook_register(hb, ha, at_hook, None)
        if pre_at:
            pre_done = [False]

            def at_pre(_):
                if not pre_done[0]:
                    pre_done[0] = True
                    apply_sets(pb, pre_sets)
            pb.hook_register(*(int(x, 16) for x in pre_at.split(":")), at_pre, None)
        pb.hook_register(0, 0x00D9, arm, None)
        pb.hook_register(0, 0x00E4, at_halt, None)
        btn = Buttons(pb)
        i = 0
        while not start:
            btn.set(pre[i] if i < len(pre) else "none")
            pb.tick(1, True)  # rendered: PyBoy's renderer caches go stale over unrendered ticks
            i += 1
            if i > 40000:
                raise SystemExit(f"hook {hook} not reached")
        open(f"{out}/start.bin", "wb").write(start["mem"])
        k, left = 0, None
        while len(frames) < mx:
            b = plan[k] if k < len(plan) else "none"
            k += 1
            btn.set(b)
            cur[0] = len(frames)
            pb.tick(1, True)
            m = pb.memory
            shot = np.array(pb.screen.image.convert("RGB"))[:, :, 0].reshape(-1)
            screens += bytes(SH.get(int(x), 0) for x in shot)
            frames.append({"btn": b, "ff89": m[0xFF89], "ff8a": m[0xFF8A],
                           "lcd": [m[0xFF40], m[0xFF42], m[0xFF43], m[0xFF4A], m[0xFF4B], m[0xFF47], m[0xFF48], m[0xFF49]],
                           "keys": {}})
            if ret and left is None:
                left = after
            if left is not None:
                left -= 1
                if left < 0:
                    break
        btn.set("none")
    if ret:
        open(f"{out}/ret.bin", "wb").write(ret.pop("mem"))
    with gzip.open(f"{out}/waits.bin.gz", "wb", 6) as f:
        f.write(bytes(waits))
    with gzip.open(f"{out}/screens.bin.gz", "wb", 6) as f:
        f.write(bytes(screens))
    json.dump({"frames": wait_frames}, open(f"{out}/waits.json", "w"))
    json.dump({"state": state, "hook": hook, "nth": nth, "sets": [[a, v] for a, v in sets],
               "start": {k: v for k, v in start.items() if k != "mem"}, "ret": ret or None, "frames": frames},
              open(f"{out}/trace.json", "w"))
    print(name, len(frames), "frames,", len(wait_frames), "waits; ret", {k: v for k, v in (ret or {}).items() if k != "regs"})


def snap(args):
    name, state, targets = args[0], args[1], args[2].split(",")
    plan = plan_steps(opt(args, "--plan", ""))
    mx = int(opt(args, "--max", "400"))
    per = int(opt(args, "--per", "60"))
    set_at = opt(args, "--set-at")
    sets = parse_sets(opt(args, "--set", ""))
    pre_at = opt(args, "--pre-set-at")
    pre_sets = parse_sets(opt(args, "--pre-set", ""))
    out = f"build/routines/{name}"
    os.makedirs(out, exist_ok=True)
    idx, count, sethits = [], {}, [0]
    with Emulator("input/original.gb") as e:
        pb = e.pb
        e.load_state(state if "/" in state else f"build/states/{state}.state")

        def mk(bank, addr):
            key = f"{bank:02X}:{addr:04X}"

            def cb(_):
                if len(idx) >= mx or count.get(key, 0) >= per:
                    return
                if bank and pb.memory[0xFF88] != bank:
                    return
                count[key] = count.get(key, 0) + 1
                r = pb.register_file
                regs = {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E, "hl": r.HL, "sp": r.SP}
                n = len(idx)
                open(f"{out}/{n:04d}.bin", "wb").write(bytes(pb.memory[0x8000:0x10000]))
                idx.append({"n": n, "routine": key, "regs": regs, "bank": pb.memory[0xFF88], "frame": pb.frame_count})
            return cb

        def do_set(_):
            i = sethits[0]
            sethits[0] += 1
            apply_sets(pb, sets, i)
        if set_at:
            b, a = (int(x, 16) for x in set_at.split(":"))
            pb.hook_register(b, a, do_set, None)
        if pre_at:
            def at_pre(_):
                apply_sets(pb, pre_sets)
            pb.hook_register(*(int(x, 16) for x in pre_at.split(":")), at_pre, None)
        for t in targets:
            b, a = (int(x, 16) for x in t.split(":"))
            pb.hook_register(b, a, mk(b, a), None)
        btn = Buttons(pb)
        for s in plan:
            btn.set(s)
            pb.tick(1, False)
            if len(idx) >= mx:
                break
        btn.set("none")
    json.dump(idx, open(f"{out}/index.json", "w"), indent=1)
    print(name, len(idx), "snapshots", count)


# ---------------------------------------------------------------- scenarios
# Real battles from the milestone save states (python -m ffl2kster make-states): walk into the
# battle, then press A (Fight) every 30 frames. Controlled changes (--set) only rewrite the
# animation id / target / flags at the hooked entry, so the original code runs on real battle
# state with a chosen input.
FIGHT = "up:10,down:10,up:10,none:250" + ",a:4,none:26" * 300
# extra enemy groups: copies of the real group block D500 (id changed for the third)
G3 = "D500>D600:100,D500>D700:100,D70A=0x2D"
G2 = "D500>D600:100"
BANK1_FX = {0x1B, 0x1E, 0x1F, 0x20, 0x22}               # effects that call into bank 01

TRACES = {
    "bd_open_jaguar": ("pre_battle", "0F:6080", 1, ""),
    "bd_open_45": ("pre_battle_id45", "0F:6080", 1, ""),
    "bd_open_180": ("pre_battle_id180", "0F:6080", 1, ""),
    "bd_open_185": ("pre_battle_id185", "0F:6080", 1, ""),
    "bd_open_2grp": ("pre_battle", "0F:6080", 1, G2),
    "bd_open_3grp": ("pre_battle", "0F:6080", 1, G3),
    "bd_open_kind1": ("pre_battle", "0F:6080", 1, "C7F3=0x80"),
    "bd_hit_bc": ("pre_battle", "0D:5000", 1, ""),          # natural: weapon animation BC
    "bd_hit_88": ("pre_battle", "0D:5000", 2, ""),          # natural: weapon animation 88
    "bd_fx00_nat": ("pre_battle", "0D:5000", 4, ""),        # natural: enemy attack (window shake)
    "bd_update_jaguar": ("pre_battle", "0F:6083", 1, ""),   # natural: nobody died
    "bd_death_45": ("pre_battle_id45", "0F:6083", 1, ""),   # natural: the enemy group dies
    "bd_death_185": ("pre_battle_id185", "0F:6083", 9, ""), # natural: last of 3 dies
    "bd_slide": ("pre_battle", "0F:6083", 1, "D986=1"),     # group 0 slides back in
    "bd_restore": ("pre_battle", "0F:6083", 1, "D97A=1"),   # dark enemy area: 0D:5003
    "bd_death_kind2": ("pre_battle_id45", "0F:6083", 1, "D98B=2"),
    "bd_restore_kind2": ("pre_battle", "0F:6083", 1, "D97A=1,D98B=2"),  # + backdrop (0F:608F)
}
for i in range(0x80, 0xEB):
    TRACES[f"bd_anim_{i:02x}"] = ("pre_battle", "0D:5000", 1, f"D910=0x{i:02X}")
for i in range(0x23):
    if i not in BANK1_FX:
        TRACES[f"bd_fx_{i:02x}"] = ("pre_battle", "0D:5000", 1, f"D910=0x{i:02X}")
for i in (0x06, 0x07, 0x08, 0x0C):
    TRACES[f"bd_fx_{i:02x}_all3"] = ("pre_battle", "0D:5000", 1, f"D910=0x{i:02X},CFF5=9", G3)
for i in (0xA0, 0x8A, 0x82, 0xB5):
    TRACES[f"bd_anim_{i:02x}_all3"] = ("pre_battle", "0D:5000", 1, f"D910=0x{i:02X},CFF5=9", G3)
TRACES["bd_anim_88_grp2"] = ("pre_battle", "0D:5000", 1, "D910=0x88,CFF5=6", G3)
TRACES["bd_fx_06_grp3"] = ("pre_battle", "0D:5000", 1, "D910=0x06,CFF5=7", G3)


def traces(names):
    for name in names or list(TRACES):
        st, hook, nth, sets, *g = TRACES[name]
        a = [name, st, "--hook", hook, "--pre", FIGHT, "--nth", str(nth), "--max", "1500"]
        if sets:
            a += ["--set", sets]
        if g:
            a += ["--pre-set-at", "0F:6080", "--pre-set", g[0]]
        trace(a)


# Oracle snapshot sets: entries of the routines without frame waits during real battles. Each
# run plays a battle until its first 0D:5000 call, rewrites the animation id there (and the
# target), and runs 400 more frames; the battle-opening routines are caught in the openings
# (1-3 groups, several monsters).
NOWAIT = ["0F:6180", "0F:61CA", "0F:6257", "0D:525B", "0D:52E0", "0D:5302", "0D:60B9", "0D:6082",
          "0D:50E7", "0D:5F61", "0D:6057", "0D:5240"]
PARTICLE_FX = [0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, 0x11, 0x13, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1C, 0x21]


def snap_runs():
    runs = []
    for st in ("pre_battle", "pre_battle_id45", "pre_battle_id180", "pre_battle_id185"):
        runs += [(st, "", None, None), (st, G2, None, None), (st, G3, None, None)]
    for i in range(0x80, 0xEB, 3):
        runs.append(("pre_battle", "", i, None))
    for i in (0x81, 0x8A, 0xA0, 0xB5, 0xC2, 0xD7):
        runs.append(("pre_battle", G3, i, 9))
        runs.append(("pre_battle", G3, i, 7))
    for i in PARTICLE_FX:
        runs.append(("pre_battle", "", i, None))
    runs += [("pre_battle", G3, 0x0C, 9), ("pre_battle", G2, 0x0C, 9)]
    return runs


def snaps(names):
    import subprocess
    name = (names or ["bd_nowait"])[0]
    out = f"build/routines/{name}"
    os.makedirs(out, exist_ok=True)
    idx, total = [], {}
    steps = plan_steps(FIGHT)
    for st, g, d910, cff5 in snap_runs():
        with Emulator("input/original.gb") as e:
            pb = e.pb
            e.load_state(f"build/states/{st}.state")
            run_count, hit, after = {}, [0], [None]

            def mk(bank, addr):
                key = f"{bank:02X}:{addr:04X}"

                def cb(_):
                    if pb.memory[0xFF88] != bank or run_count.get(key, 0) >= 8 or total.get(key, 0) >= 150:
                        return
                    run_count[key] = run_count.get(key, 0) + 1
                    total[key] = total.get(key, 0) + 1
                    r = pb.register_file
                    n = len(idx)
                    open(f"{out}/{n:04d}.bin", "wb").write(bytes(pb.memory[0x8000:0x10000]))
                    idx.append({"n": n, "routine": key, "regs": {"a": r.A, "f": r.F, "b": r.B, "c": r.C, "d": r.D, "e": r.E,
                                "hl": r.HL, "sp": r.SP}, "bank": pb.memory[0xFF88], "frame": pb.frame_count, "run": [st, g, d910, cff5]})
                return cb

            def at5000(_):
                hit[0] += 1
                if hit[0] == 1 and d910 is not None:
                    pb.memory[0xD910] = d910
                    if cff5 is not None:
                        pb.memory[0xCFF5] = cff5
            pre_done = [False]

            def at_open(_):
                if not pre_done[0]:
                    pre_done[0] = True
                    apply_sets(pb, parse_sets(g))
            pb.hook_register(0x0D, 0x5000, at5000, None)
            pb.hook_register(0x0F, 0x6080, at_open, None)
            for t in NOWAIT:
                b, a = (int(x, 16) for x in t.split(":"))
                pb.hook_register(b, a, mk(b, a), None)
            btn = Buttons(pb)
            for i, sb in enumerate(steps):
                btn.set(sb)
                pb.tick(1, False)
                if d910 is None and i > 400:
                    break
                if hit[0] and after[0] is None:
                    after[0] = 400
                if after[0] is not None:
                    after[0] -= 1
                    if after[0] < 0:
                        break
    json.dump(idx, open(f"{out}/index.json", "w"), indent=1)
    print(name, len(idx), "snapshots", total)
    subprocess.run([sys.executable, "tools/routine_oracle.py", "run", name], check=True)


if __name__ == "__main__":
    cmd, rest = sys.argv[1], sys.argv[2:]
    {"trace": trace, "snap": snap, "traces": traces, "snaps": snaps}[cmd](rest)
