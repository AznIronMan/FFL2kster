"""Regenerate the milestone-1 save states deterministically from a cold boot.

States are never committed (users supply their own ROM). The input chain below was
recorded during exploration on 2026-10-11 and replays identically because PyBoy is
deterministic. Output (build/states/ by default):
  title.state           title screen, cursor on Start
  party_creation.state  hero type selection list (Human M .. Imp)
  first_town.state      first town, party of 4 + guest, free to walk
  world.state           world map just outside the first town
  pre_battle.state      one step (press 'up') before a deterministic 3x Jaguar battle
  battle.state          Jaguar battle loaded, Fight/Run menu
  pre_battle_id<N>.state one step before the first battle with enemy id N (after fighting
                        through earlier battles); N in SECOND_ENEMIES
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

from .emu import Emulator


def _run(pb, steps, hold=4):
    """Mirror tools/emu_drive.py exactly (every step ends with a 1-frame render tick)."""
    for st in steps:
        key, _, wait = st.partition(":")
        wait = int(wait or 20)
        reps = 1
        if "x" in key and key != "x":
            key, r = key.split("x")
            key, reps = key.strip(), int(r)
        for _ in range(reps):
            if key != "wait":
                pb.button(key, hold)
                pb.tick(hold + 1, False)
            pb.tick(wait, False)
        pb.tick(1, True)


# Passable tiles of the first town reachable from the post-story position, recorded by
# tools/explore.py; only the route to the east exit (40,19) is needed.
TOWN_ROUTE = [(28, 27), (28, 26), (28, 25), (28, 24), (28, 23), (27, 23), (27, 22), (27, 21),
              (27, 20), (27, 19)] + [(x, 19) for x in range(28, 41)]
DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


def _goto(emu, route, target):
    seen = set(route)
    pb = emu.pb
    for _ in range(40):
        if emu.position() == target:
            return
        start = emu.position()
        q, par = deque([start]), {start: None}
        while q:
            c = q.popleft()
            for k, (dx, dy) in DIRS.items():
                n = (c[0] + dx, c[1] + dy)
                if n in seen and n not in par:
                    par[n] = (c, k)
                    q.append(n)
        if target not in par:
            raise RuntimeError(f"no route from {start} to {target}")
        path, c = [], target
        while par[c]:
            c, k = par[c]
            path.append(k)
        for k in reversed(path):
            p = emu.position()
            pb.button(k, 12)
            pb.tick(30, False)
            if emu.position() == p:
                pb.tick(60, False)
                break
    if emu.position() != target:
        raise RuntimeError(f"could not reach {target}, at {emu.position()}")


def make_states(rom_path, outdir="build/states", log=print) -> dict:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    with Emulator(rom_path) as emu:
        pb = emu.pb
        pb.tick(240, False)
        _run(pb, ["wait:10"])
        emu.save_state(out / "title.state")
        _run(pb, ["start:120"] + ["a:120"] * 6)
        _run(pb, ["start:200", "wait:400", "wait:600", "a:300"])
        emu.save_state(out / "party_creation.state")
        _run(pb, ["a:300", "start:300", "a:300", "a:300"])
        _run(pb, ["start:60"] + ["a:60"] * 7)
        _run(pb, ["a x15:40"] * 8)
        _run(pb, ["a x20:40"] * 4)
        _run(pb, ["a x40:30"] * 4)
        _run(pb, ["a x10:30"] * 8)
        _run(pb, ["down x6:4", "down x6:4", "left x6:4", "down x8:4", "down x8:4",
                  "right x8:4", "down x8:4", "up x8:4"], hold=12)
        emu.save_state(out / "first_town.state")
        log(f"first town at {emu.position()}")
        _goto(emu, TOWN_ROUTE, (40, 19))
        for k, n in (("right", 1), ("right", 2), ("up", 2), ("down", 3)):
            for _ in range(n):
                pb.button(k, 12)
                pb.tick(30, False)
            pb.tick(90, True)
        pb.tick(1, True)
        _run(pb, ["a x12:40", "a x12:40", "right x3:20", "right x3:30", "right x3:30", "wait:120"],
             hold=12)
        emu.save_state(out / "world.state")
        log(f"world map at {emu.position()}")
        for i in range(200):
            emu.save_state(out / "pre_battle.state")
            emu.hook_hits.clear()
            emu.press(["up", "down"][(i // 3) % 2])
            if emu.hook_hits:
                break
        else:
            raise RuntimeError("no encounter within 200 steps")
        log(f"battle loaded after {i + 1} steps (pre_battle press = {['up', 'down'][(i // 3) % 2]})")
        pb.tick(240, False)
        emu.save_state(out / "battle.state")
        result = {"steps_to_battle": i + 1, "direction": ["up", "down"][(i // 3) % 2],
                  "enemy_block": bytes(pb.memory[0xD500:0xD512]).hex(), "more": {}}
        _more_enemies(emu, out, result["more"], log)
        import json
        manifest = {"pre_battle": {"enemy_id": 120, "direction": result["direction"]}}
        manifest.update({f"pre_battle_id{k}": {"enemy_id": k, "direction": v}
                         for k, v in result["more"].items()})
        (out / "states.json").write_text(json.dumps(manifest, indent=2) + "\n")
        return result


SECOND_ENEMIES = (180, 45)


def _fight_out(emu):
    """Press A (Fight) until walking works again or a new battle loads."""
    pb = emu.pb
    for j in range(300):
        pb.button("a", 6)
        pb.tick(20, False)
        if j % 10 == 9:
            q = emu.position()
            emu.hook_hits.clear()
            emu.press("up")
            if emu.hook_hits or emu.position() != q:
                return


def _more_enemies(emu, out, found, log, max_steps=400):
    import io
    pb = emu.pb
    _fight_out(emu)
    for step in range(max_steps):
        b = io.BytesIO()
        pb.save_state(b)
        emu.hook_hits.clear()
        d = ["up", "down"][(step // 3) % 2]
        emu.press(d)
        if not emu.hook_hits:
            continue
        pb.tick(240, False)
        eid = pb.memory[0xD50A]
        if eid in SECOND_ENEMIES and eid not in found:
            (out / f"pre_battle_id{eid}.state").write_bytes(b.getvalue())
            found[eid] = d
            log(f"enemy id {eid} after {step + 1} more steps (press {d})")
            if len(found) == len(SECOND_ENEMIES):
                return
        _fight_out(emu)
