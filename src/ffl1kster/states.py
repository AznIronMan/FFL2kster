"""Regenerate Legend I test save states deterministically from a cold boot (never committed).

Output (ffl1/build/states/ by default):
  title.state           title screen, cursor on START
  party_creation.state  hero type list (HUMAN M .. ZOMBIE) after the intro text
  first_town.state      first town after naming the hero "A" (HUMAN M), free to walk
  world.state           world map just outside the first town
  pre_battle.state      one step before the first random battle (1 ASIGARU, area 19)
  battle.state          that battle loaded, FIGHT/RUN menu
  states.json           what each state contains (enemy ids, the step direction)
Legend I differs from Legend II here: one hero is created and named, the rest of the party is
recruited at the guild later; the intro text cannot be skipped.
"""

from __future__ import annotations

import json
from pathlib import Path

from .emu import Emulator

WALK = ["right", "right", "right", "left", "left", "left"]


def make_states(rom_path, outdir="ffl1/build/states", log=print) -> dict:
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    with Emulator(rom_path) as emu:
        pb = emu.pb
        pb.tick(240, False)
        if not emu.wait_for_text("START"):
            raise RuntimeError("title screen not reached")
        emu.save_state(out / "title.state")
        emu.press("a", wait=60)
        if not emu.wait_for_text("HUMAN  M", max_frames=6000):
            raise RuntimeError("party creation list not reached")
        pb.tick(30, False)
        emu.save_state(out / "party_creation.state")
        emu.press("a", wait=120)   # HUMAN M
        emu.press("a", wait=120)   # name letter 'A'
        emu.press("start", wait=120)
        emu.save_state(out / "first_town.state")
        log(f"first town at {emu.position()}")
        for _ in range(3):
            emu.press("down", wait=56)
        emu.save_state(out / "world.state")
        log(f"world map at {emu.position()}")
        for i in range(300):
            before = emu.state_bytes()
            d = WALK[i % len(WALK)]
            emu.loader_hits.clear()
            emu.press(d)
            if emu.loader_hits:
                (out / "pre_battle.state").write_bytes(before)
                break
        else:
            raise RuntimeError("no encounter within 300 steps")
        pb.tick(200, False)
        emu.save_state(out / "battle.state")
        ids = [pb.memory[0xD000 + 32 * k + 0x1F] for k in range(4, 8)]
        manifest = {"pre_battle": {"direction": d, "steps": i + 1, "enemy_ids": [x for x in ids if x != 0xFF]}}
        (out / "states.json").write_text(json.dumps(manifest, indent=2) + "\n")
        log(f"battle after {i + 1} steps (press {d}): enemies {manifest['pre_battle']['enemy_ids']}")
        return manifest
