"""Parity sweeps: lean PyBoy traces (tools/trace_lib.py) over the whole game, replayed by
port/packages/parity/test/sweep.test.ts.
  scripts [FROM TO]  every event script: story scripts (event kind 0, arg 0-255), field messages
                     of kind 1 (0-255) and the kind-2/3 messages placed on maps, queued at the
                     field loop of first_town.state; A held 10 of every 12 frames for 1200
                     frames. Traces sw_sK_NNN (K = kind).
  events [FROM TO]   every other event kind placed on maps (shops/inn, sound, chests, return
                     warps, alternate warps, F0-FF specials). Traces sw_eKK_NNN.
  branches [FROM TO] every script again once per condition it tests, with the state changed so
                     the other side of the condition is taken (progress variable set into the
                     tested range, item in the bag, MAGI total above the limit, C2A1, song) or,
                     for yes/no prompts, answered No (Down, A). Traces sw_bK_NNN_J.
  Options: --redo (overwrite), --long (4800 frames for scripts), --only FILE (names listed).
  ctxstates          states ctx_HHHH: the first town warped to each map holding placed scripts.
  context [FROM TO]  every placed script run on its own map with its object's progress condition
                     met. Traces sw_c_HHHH_NNN.
  maps [FROM TO]     every warp destination (07:4000 + 4i, 511 records): event 5/6 queued at the
                     field loop; then a walk in four directions. Traces sw_m_NNN.
States and traces stay in build/ (ROM-derived, gitignored). Usage: python tools/sweep.py MODE [FROM TO]"""
import json, os, signal, sys, time
sys.path.insert(0, "tools")
from trace_lib import Recorder, plan_steps

# A held most of the time (text runs at full speed while A is down) with a release every 12
# frames (a new press for button waits and prompts)
SCRIPT_PLAN = ",".join(["a:10,none:2"] * 100)
# --long: four times as many frames, for scripts still running at the end of the default length
if "--long" in sys.argv:
    SCRIPT_PLAN = ",".join(["a:10,none:2"] * 400)
MAP_PLAN = "none:90,up:16,none:6,down:16,none:6,left:16,none:6,right:16,none:30"


def used_events():
    """(kind, arg) pairs placed on maps: NPC objects (00:3397) and trigger tiles (map headers)."""
    sys.path.insert(0, "src")
    from ffl2kster.schema import maps
    rom = open("input/original.gb", "rb").read()
    used = set()
    for h in maps.all_headers(rom):
        hd = maps.header(rom, h)
        for t in hd["triggers"]:
            used.add((t["b1"], t["b0"]))
        for n in maps.objects(rom, hd)["npcs"]:
            used.add((n["event"]["code"], n["event"]["arg"]))
    return sorted(used)


def cases(mode):
    if mode == "scripts":
        # every story script (kind 0) and field message of kind 1; kinds 2/3 as placed on maps
        used = set(used_events())
        for k in (0, 1):
            # the story table has 192 entries; higher kind-0 args only as placed on maps
            for i in range(256 if k else 192):
                yield f"sw_s{k}_{i:03d}", ((0xC443, k), (0xC442, i)), SCRIPT_PLAN
        for k, i in sorted(used):
            if k in (2, 3) or (k == 0 and i >= 192):
                yield f"sw_s{k}_{i:03d}", ((0xC443, k), (0xC442, i)), SCRIPT_PLAN
    elif mode == "events":
        # the other placed events: shops/inn (4), sound (7), chests (9-0B), warps with a return
        # point (0C/0D), alternate warps (0E), special kinds (F0-FF)
        for k, i in used_events():
            if k >= 4 and k not in (5, 6, 8):
                yield f"sw_e{k:02x}_{i:03d}", ((0xC443, k), (0xC442, i)), SCRIPT_PLAN
    elif mode == "branches":
        sys.path.insert(0, "src")
        from ffl2kster import events
        rom = open("input/original.gb", "rb").read()
        uses = lambda i: rom[0x0C * 0x4000 + 0x7E80 - 0x4000 + i]
        targets = [(0, "story", i) for i in range(192)] + [(1, "field", i) for i in range(256)]
        for k, table, i in targets:
            j = 0
            for op in events.decode_script(rom, table, i):
                name, a = op["op"], op.get("args", [])
                pokes, plan = None, SCRIPT_PLAN
                if name == "if_var_in":
                    v, lo = a[0] & 0x1F, a[1] >> 4
                    addr = 0xC2F6 + (v >> 1)
                    # (address, value, mask): only the variable's nibble changes
                    pokes = [(addr, lo, 0x0F) if v & 1 else (addr, lo << 4, 0xF0)]
                elif name == "if_has_item":
                    pokes = [(0xC2B9, a[0]), (0xC2BA, uses(a[0]))]
                elif name == "if_magi_total_lt":
                    pokes = [(0xC2D9, (a[0] + 1) & 0xFF)]
                elif name == "if_c2a1_ge":
                    pokes = [(0xC2A1, a[0])]
                elif name == "if_song":
                    pokes = [(0xFFB0, a[0])]
                elif name == "if_yes":
                    pokes, plan = [], ",".join(["none:4,down:2,none:4,a:2"] * 400)
                if pokes is None:
                    continue
                yield f"sw_b{k}_{i:03d}_{j}", ((0xC443, k), (0xC442, i), *pokes), plan
                j += 1
    elif mode == "context":
        # every placed script on its own map (state ctx_HHHH from `ctxstates`), the object's
        # progress condition satisfied (variable set to the low end of its range)
        import json
        d = json.load(open("data/events/events.json"))
        seen = set()
        for e in d["scripts"]:
            key = (e["map"], e["story"])
            if key in seen:
                continue
            seen.add(key)
            pokes = [(0xC443, 0), (0xC442, e["story"])]
            c = e.get("condition")
            if c and c["type"] == "progress":
                v, lo = c["var"] & 0x1F, c["min"]
                addr = 0xC2F6 + (v >> 1)
                pokes.append((addr, lo, 0x0F) if v & 1 else (addr, lo << 4, 0xF0))
            yield f"sw_c_{e['map']}_{e['story']:03d}", tuple(pokes), SCRIPT_PLAN, f"ctx_{e['map']}"
    elif mode == "maps":
        for d in range(511):
            yield f"sw_m_{d:03d}", ((0xC443, 6 if d >= 256 else 5), (0xC442, d & 0xFF)), MAP_PLAN


def _timeout(*_):
    raise TimeoutError("emulator did not finish the case in 30 s")


ONLY = set(open(sys.argv[sys.argv.index("--only") + 1]).read().split()) if "--only" in sys.argv else set()


def ctx_states():
    """build/states/ctx_HHHH.state: the first town warped (by the game) to a destination of map
    header HHHH, 200 frames later — the maps the placed scripts live on."""
    import json
    sys.path.insert(0, "src")
    from ffl2kster.schema import maps
    from ffl2kster.emu import Emulator
    rom = open("input/original.gb", "rb").read()
    hdr2dest = {}
    for i in range(511):
        hdr2dest.setdefault(maps.dest_record(rom, i)["header"], i)
    need = sorted({int(e["map"], 16) for e in json.load(open("data/events/events.json"))["scripts"]})
    with Emulator("input/original.gb") as em:
        pb = em.pb
        for h in need:
            out = f"build/states/ctx_{h:04x}.state"
            if os.path.exists(out) and "--redo" not in sys.argv:
                continue
            dst = hdr2dest[h]
            em.load_state("build/states/first_town.state")
            done = []

            def at_loop(_):
                if not done:
                    pb.memory[0xC442] = dst & 0xFF
                    pb.memory[0xC443] = 6 if dst >= 256 else 5
                    done.append(1)
            pb.hook_register(0, 0x1A43, at_loop, None)
            for _ in range(200):
                pb.tick(1, False)
            pb.hook_deregister(0, 0x1A43)
            pb.tick(1, True)
            em.save_state(out)
            print(out, "dest", dst, flush=True)


def main():
    signal.signal(signal.SIGALRM, _timeout)
    mode = sys.argv[1]
    if mode == "ctxstates":
        return ctx_states()
    if mode == "list":
        for n, c in enumerate(cases(sys.argv[2])):
            print(n, c[0])
        return
    nums = [a for a in sys.argv[2:4] if a.isdigit()]
    lo = int(nums[0]) if nums else 0
    hi = int(nums[1]) if len(nums) > 1 else 10 ** 6
    rec = Recorder()
    t0 = time.time()
    try:
        for n, case in enumerate(cases(mode)):
            name, pokes, plan = case[:3]
            state = case[3] if len(case) > 3 else "first_town"
            if not lo <= n < hi:
                continue
            if ONLY and name not in ONLY:
                continue
            done = f"build/traces/{name}/prev.bin"
            if "--redo" not in sys.argv and os.path.exists(done) and \
                    json.load(open(f"build/traces/{name}/trace.json")).get("plan") == plan:
                continue
            signal.alarm(30)  # a case that wedges the emulator (e.g. halt with no interrupt) is dropped
            try:
                f, w = rec.record(name, state, plan_steps(plan), pokes=pokes, plan=plan)
                print(f"{name} {f} frames {w} waits {time.time() - t0:.0f}s", flush=True)
            except Exception as ex:  # noqa: BLE001 - keep sweeping
                print(f"{name} FAILED {ex}", flush=True)
                if isinstance(ex, TimeoutError):
                    rec = Recorder()
            finally:
                signal.alarm(0)
    finally:
        rec.close()


if __name__ == "__main__":
    main()
