# Port readiness summary (2026-10-12)

This page records the data-gathering phase (milestones 1–7) as input for port planning.

**Status labels**

- **verified**: confirmed by a controlled change in PyBoy, or by exhaustive measurement.
- **probable**: read from code but not exercised.
- **open**: not yet known.

All data is regenerated from a user-supplied ROM (`python -m ffl2kster export-all`); see
data/README.md.

## Coverage by game system

| System | Status | What the port gets |
|---|---|---|
| Monsters / party classes | verified (stats, abilities) | `monsters.json`; classes = ids 240–247 |
| Items / abilities | verified (power, uses, equip DEF/stat bonus, effect routing) | `items.json`, effect index → 50 handlers |
| Battle flow | probable (decoded calc VM), weapons verified | Turn order, AI, run, surprise, confusion, poison, regeneration; `rules.py` + VM listing |
| Weapon hit/damage | verified (milestone-2 measurements agree with the VM) | `rules.weapon_damage`, `rules.hit_chance` |
| Other effects (spells, status, guns, …) | probable | 50 handlers decompiled, unnamed |
| Rewards: GP, drops, meat drops | verified | `rules.gp_total`, `drop_threshold`, reward byte decode |
| Meat transformation | verified (32,940/32,940) | `rules.meat_result` + 576-entry result table |
| Growth (HP / stats / mutant abilities) | HP chance verified; rest probable | `rules.hp_up_*`, `stat_up_chance`, mutant table |
| RNG | verified | Stream counters + table semantics, for exact parity |
| Encounters | verified | Zones, slot odds, formations, count patterns |
| Text | verified (decode, reinsertion) | 906 entries, DTE dictionary, control codes, phrases/memo |
| Events / scripting | verified for kinds 0/1/4/5/6/7/9; other ops probable | Unified event model, script pseudo-code, op table |
| Maps | verified (layouts render, warps match) | 212 maps, 64×64 metatile grids, warps, triggers, NPCs with spawn conditions |
| Collision | verified | Per-tileset metatile attributes; blocked if attr & mode |
| Shops / inns | verified | 24 inventories + placements |
| Chests / MAGI | verified (item chest), probable (MAGI) | 230 placements with flags |
| Graphics | verified (renders match captures) | Monster art, tilesets, overworld sprites, font |
| Music | verified (frame-exact timing) | 19 MIDI files; envelopes/vibrato open |
| Sound effects | open | Driver request byte known (FFB2), table not decoded |

## Known gaps (none blocks planning)

**Presentation**

1. Music timbre: envelope (E0) and vibrato (E4) tables.
2. Sound-effect table.
3. Song names beyond title, town, world and battle.

**Rules**

4. 50 battle effect handlers are decompiled but unnamed. Effect 49 (weapons) is fully specified.
5. Mutant stat-growth parameter addressing looks shifted (STR pair = 0,0). Verify with a mutant
   party.
6. The special event kinds F0–FF (auto-walk, object control) and a few script ops (`op_XX`).

**Editor-only**

7. Map layout command format (00:2253) is only needed for a ROM-level map editor. Decoded grids
   are already exported.

**Text**

8. 20 menu-table entries have layout-specific alignment.

**Unexplained**

9. Kind-4 objects with args > 23.
10. Header 0x4800.

## Port architecture options

| Option | Idea | Pros | Cons |
|---|---|---|---|
| A. Data-driven re-implementation | Load `data/` at build time; reimplement rules from `rules.py` and the VM listing | Clean modern code; remaster-friendly | Effect handlers must be transliterated; parity needs care |
| B. Embedded calc VM + event VM | Ship interpreters for the bank-0C VM and the script ops, and run the original bytecode from the user's ROM | Exact parity for battle math and events; less hand porting | Needs the user ROM at runtime; harder to remaster rules |
| C. Hybrid (recommended to evaluate) | Data tables and scripts as content (A); VM interpreter as a parity oracle in tests (B) | Re-implemented rules are checked against the original bytecode | Two code paths |

**Inputs still to decide in planning**

- Target platform and engine.
- Resolution and asset strategy: original 160×144 vs remastered.
- Parity level: bit-exact RNG vs "feel".
- Save-format compatibility.
- Scope of new features.
- How the editor and patch compiler (`ffl2kster build`) fit alongside the port.

## Tooling to reuse

- **CLI** (`python -m ffl2kster …`): `export-all`, `build`, `db-*`, `make-states`.
- **PyBoy harness**: deterministic states, battle/shop/event probes.
- **Tests**: 68 tests (56 fast, 12 emulator) covering every verified claim. Run with
  `python -m pytest`.
