"""Parity sweeps: lean PyBoy traces (tools/trace_lib.py) over the whole game, replayed by
port/packages/parity/test/sweep.test.ts.
  scripts [FROM TO]  every event script: story scripts (event kind 0, arg 0-255), field messages
                     of kind 1 (0-255) and the kind-2/3 messages placed on maps, queued at the
                     field loop of first_town.state; A is tapped every 12 frames for 1200
                     frames. Traces sw_sK_NNN (K = kind).
  events [FROM TO]   every other event kind placed on maps (shops/inn, sound, chests, return
                     warps, alternate warps, F0-FF specials). Traces sw_eKK_NNN.
  maps [FROM TO]     every warp destination (07:4000 + 4i, 511 records): event 5/6 queued at the
                     field loop; then a walk in four directions. Traces sw_m_NNN.
States and traces stay in build/ (ROM-derived, gitignored). Usage: python tools/sweep.py MODE [FROM TO]"""
import os, signal, sys, time
sys.path.insert(0, "tools")
from trace_lib import Recorder, plan_steps

SCRIPT_PLAN = ",".join(["none:10,a:2"] * 100)
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
    elif mode == "maps":
        for d in range(511):
            yield f"sw_m_{d:03d}", ((0xC443, 6 if d >= 256 else 5), (0xC442, d & 0xFF)), MAP_PLAN


def _timeout(*_):
    raise TimeoutError("emulator did not finish the case in 30 s")


def main():
    signal.signal(signal.SIGALRM, _timeout)
    mode = sys.argv[1]
    if mode == "list":
        for n, c in enumerate(cases(sys.argv[2])):
            print(n, c[0])
        return
    lo = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    hi = int(sys.argv[3]) if len(sys.argv) > 3 else 10 ** 6
    rec = Recorder()
    t0 = time.time()
    try:
        for n, (name, pokes, plan) in enumerate(cases(mode)):
            if not lo <= n < hi:
                continue
            if "--redo" not in sys.argv and os.path.exists(f"build/traces/{name}/prev.bin"):
                continue
            signal.alarm(30)  # a case that wedges the emulator (e.g. halt with no interrupt) is dropped
            try:
                f, w = rec.record(name, "first_town", plan_steps(plan), pokes=pokes, plan=plan)
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
