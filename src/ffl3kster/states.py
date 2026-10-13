"""Regenerate Legend III test save states deterministically from a cold boot (never committed).

Output (ffl3/build/states/ by default):
  title.state        title screen ("New Game" / "Continue")
  name_entry.state   the first name screen (Hero, default "Arthur") after the intro
  pre_battle.state   the last default name accepted (Start), before the prologue battle loads
  battle.state       the prologue battle (Diviner x2, Sprite x2), Fight/Run/Auto menu
  field.state        after the battle and the intro scenes: the Talon hangar, free to move
  menu.state         the field menu open there (Item, Magic, Talent, Status, Equip, Auto, Save)
  talon.state        inside the Talon, after the walk TALON_WALK from field.state (free to step)
  states.json        frames and the enemy groups seen
"""

from __future__ import annotations

import json
from pathlib import Path

from .emu import LOADER, Emulator

NAMES = ["Hero ", "Boy ", "Girl ", "Heroine "]
INTRO_PRESSES = 1000
TALON_WALK = ["down"] * 9 + ["left"] * 3 + ["right"] * 6


def _has(emu, s):
    return any(s in r for r in emu.screen_text())


def make_states(rom_path, outdir="ffl3/build/states", log=print) -> dict:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    with Emulator(rom_path) as emu:
        pb = emu.pb
        if not emu.wait_for_text("Continue", 3000, 10):
            raise RuntimeError("title screen not reached")
        emu.save_state(out / "title.state")
        emu.press("up", wait=20)
        emu.press("a", wait=60)
        for _ in range(400):                 # the intro text advances on A
            if _has(emu, "Hero ") and _has(emu, "A B C"):
                break
            emu.press("a", wait=20)
        else:
            raise RuntimeError("name entry not reached")
        emu.save_state(out / "name_entry.state")
        manifest = {"name_entry": pb.frame_count}
        loads = emu.hook(*LOADER)
        for i, label in enumerate(NAMES):
            if not emu.wait_for_text(label, 600, 5):
                raise RuntimeError(f"name screen {label!r} not reached")
            pb.tick(20, False)
            if i < len(NAMES) - 1:
                emu.press("start", wait=30)
        emu.press("start", wait=5)           # the last name: the battle loads ~20 frames later
        if loads:
            raise RuntimeError("battle loaded before pre_battle.state")
        emu.save_state(out / "pre_battle.state")
        manifest["pre_battle"] = pb.frame_count
        if not emu.wait_for_text("Fight", 900, 5):
            raise RuntimeError("prologue battle menu not reached")
        emu.save_state(out / "battle.state")
        m = pb.memory
        manifest.update(battle=pb.frame_count, loads=list(loads),
                        group_ids=[m[0xCC59 + k] for k in range(3)], group_counts=[m[0xCC36 + k] for k in range(3)])
        for _ in range(INTRO_PRESSES):         # the battle, then the scenes up to the hangar
            emu.press("a", wait=30)
        if any(r.strip(" \u00b7") for r in emu.screen_text()[:4]):
            raise RuntimeError("still in a text scene after the intro presses")
        emu.save_state(out / "field.state")
        manifest["field"] = pb.frame_count
        field = emu.state_bytes()
        emu.press("start", wait=40)
        if not emu.wait_for_text("Equip", 120, 5):
            raise RuntimeError("field menu not reached")
        emu.save_state(out / "menu.state")
        manifest["menu"] = pb.frame_count
        emu.pb.load_state(__import__("io").BytesIO(field))
        for b in TALON_WALK:
            emu.press(b, hold=8, wait=12)
        emu.save_state(out / "talon.state")
        manifest["talon"] = pb.frame_count
        (out / "states.json").write_text(json.dumps(manifest, indent=2) + "\n")
        log(f"states in {out}: {manifest}")
        return manifest
