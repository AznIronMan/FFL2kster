# FFTOL — Tower of Legends

Private preservation and modding project for the Game Boy *Final Fantasy Legend* trilogy
(*SaGa*). It currently holds **FFL2kster**, the toolkit for *Final Fantasy Legend II* (USA) /
*SaGa 2*: a local editor and patch compiler whose output is a real, self-contained `.gb`, the
decoded data package, and a faithful TypeScript port of the game that runs in a web browser
on data imported from the player's own ROM.

Version: `1.41.0`
Status: **Legend II port complete for private use (1.0.0); Legend I (FFL1kster) in progress —
data milestones 1–7 done (docs/FFL1_PROGRESS.md); Legend III (FFL3kster) started —
data milestones 1-7 done (docs/FFL3_PROGRESS.md).** The port plays from the title through
party creation, towns, shops, inns, menus, the world map, encounters and battles, with music,
and saves and loads, verified frame by frame against the original in an emulator: the whole
field (P2, 1,637 sweep traces) and the battle system (P3, 2,152 battle traces). It installs on
the web (PWA), Windows, macOS, Linux, Android and iOS (P4, docs/PLATFORMS.md), with opt-in
extras and mods that leave the original untouched when off (P5, docs/EXTRAS.md), and is hardened
for private release on web, Windows, macOS and Linux (P6: 10-hour soak, browser matrix, save
backup, error reports, packaging check, docs/INSTALL.md and docs/RELEASE.md). Data
gathering (milestones 1–7) is complete. See `docs/PORT_PLAN.md` (the active course),
`docs/PROGRESS.md` and `docs/END_GOAL.md` (the long-term destination, not current scope).

## Names

| Name | What it is |
|---|---|
| **FFTOL** | The project (this folder and the GitHub repository `fftol`). |
| **Tower of Legends** (short **TOL**) | Full title. Private working title: an unrelated Steam game already uses it, so a public or store release needs a distinguisher (see `docs/END_GOAL.md`). |
| **F²** | Logo mark (visual glyph only). |
| **FFL1kster**, **FFL2kster**, **FFL3kster** | Per-game toolkits for Legend I, II and III. **FFL2kster** is complete (the Python package `ffl2kster`, its CLI and the Legend II port); **FFL1kster** (`ffl1kster`, `@ffl1k/*`) and **FFL3kster** (`ffl3kster`) are in progress. |
| **TOLkster** | The future master engine of `docs/END_GOAL.md`. Name reserved; nothing is built. |

## Bring your own ROM

**No ROM is included in this repository, and none will be.** You must supply
your own legally obtained copy of *Final Fantasy Legend II* (USA, Game Boy) and
place it at `input/original.gb`. The build refuses any ROM whose SHA-256 does
not match `project/project.json`:

```text
ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e
```

Patched ROMs are generated locally in `build/` and are never distributed.

## Setup

```bash
git config core.hooksPath .githooks        # blocks accidental ROM commits
python3 -m venv .venv && . .venv/bin/activate
pip install -e '.[dev]'                     # pytest + PyBoy (emulator tests)
brew install rgbds                          # optional: disassembly round-trip
```

## Usage

```bash
python -m ffl2kster info --project project/project.json   # verify ROM identity/header
python -m ffl2kster enemies                                # list the decoded enemy table
python -m ffl2kster build                                  # project.json edits -> build/FFL2kster.gb
python -m ffl2kster db-import                              # (re)import table + edits into SQLite
python -m ffl2kster db-edit enemy 120 hp 200 --reason "..."
python -m ffl2kster build --db project/ffl2kster.sqlite    # build from the database
python -m ffl2kster build --ips build/my-mod.ips           # also write an IPS patch to share (the FFTOL port's Mods panel applies it)
python -m ffl2kster make-states                            # regenerate PyBoy save states
python -m ffl2kster export-all                             # regenerate the processed data package
python -m ffl2kster items | text-export | events-export | music-export | rules-export
python -m pytest                                           # all tests (emulator tests ~10 s)
python -m pytest -m "not emu"                              # fast tests only
```

Every build writes `build/diff-report.json` listing each changed offset, bank, old/new
byte and reason. An empty edit list produces a byte-identical ROM.

Editable enemy fields (verified): `hp`, `str`, `agl`, `mana`, `def`.

## Layout

```text
input/        original.gb (read-only, gitignored), optional .sav, reference/
project/      project.json manifest + edit fixture, ffl2kster.sqlite, scratch/
src/ffl2kster rom/header, build engine, schemas (enemies, items, text, encounters, maps), db,
              calcvm (bank-0C VM decompiler), rules, events, music, emu harness, states, CLI
tools/        reverse-engineering helpers (text decoder, scans, explorer, controlled changes)
tests/        pytest suite incl. PyBoy acceptance test (marker: emu)
docs/         ROM_MAP.md, FINDINGS.md, DECISIONS.md, PROGRESS.md, BATTLE_RULES.md,
              EVENTS.md, MUSIC.md, PORT_READINESS.md, CAPS.md, PLATFORMS.md, EXTRAS.md,
              VARIANTS.md
data/         processed data package (see data/README.md)
port/         web port (TypeScript): importer, engine, renderer, sound, web app — see port/README.md
build/        generated output only (ROMs, states, analysis, test-artifacts/)
```

## Privacy

ROMs, saves, save states, raw ROM extracts, and generated ROMs are never
committed or distributed. Raw extracts are regenerated from your own ROM using
the extraction tools in this repo. Processed data (decoded tables, converted or
remastered graphics/music, schemas) may be included.

## Changelog

- `1.41.0` — Legend III port: the field menu (Start) opens, moves its cursor and closes back to
  the field wait-exact (`menu1`); its items are not ported yet.
- `1.40.0` — Legend III parity: field traces start from a saved state at the field loop (made
  locally by `tools/ffl3/traces.py field0`), so they replay in seconds.
- `1.39.0` — Legend III port: the field loop after the opening — standing, walking in each
  direction, a door into the ship and A — replays wait-exact (`field1`, `field2`).
- `1.38.0` — Legend III port: the whole opening replays wait-exact up to the field loop
  (`opening3`, 29,558 frames, 25,712 waits), including maps whose tiles are turned at load and a
  slide raster entered a line late.
- `1.37.0` — Legend III port: a map change with the wave fades (a raster effect at every line)
  and a screen shake are wait-exact (`opening2`, 19,818 frames, 16,914 waits). The replay now
  counts a raster write that lands on either side of a line's drawing.
- `1.36.0` — Legend III port: the opening scene after the battle is wait-exact (`opening1`, 11,118
  frames, 9,425 waits: the texts, scripted walks, the map's tile animation). The map animation is
  ported in all 36 modes. Trace waits now take the frame of the vblank that ended them, and two
  sync points cover the CPU time of scene events.
- `1.35.0` — Legend III port: the opening battle runs to its end wait-exact (`battle3`, 8,118
  frames, 6,754 waits: every round, enemy actions, the end). The port's code now waits while an
  interrupt handler it let in is still working (the original's code cannot run meanwhile).
- `1.34.0` — Legend III port P1, fourth checkpoint: the opening simulator battle. The battle runs
  as a bytecode script (2,376 statements, 0C:4000) whose interpreter is ported, with its native
  routines, the battle set-up (entities, formation, monster pictures, the opening slide raster),
  the command and target menus, the text codes the menus print with, and the bank-02 action
  effects. Two battle traces (`battle1` to the command menu, `battle2` a full round of actions)
  are wait-exact; the random generator reads the frame counter the original had at each draw.
  New analysis tool: `tools/ffl3/bscript.py` lists the battle script.
- `1.33.0` — Legend III port P1, third checkpoint: the rest of the prologue and the name entry —
  text codes 08/0B/0C (wait for A, timed pause), the menu box renderer every menu uses (09:4FEF:
  boxes from 7-byte descriptors drawn row by row, member names, class names, member figures),
  the name entry for the four members (letter grid, cursor, B back a member, Start) and the
  set-up after it, up to the opening script. Two more traces (`newgame2`, `newgame3`) are
  wait-exact; the replay gained sync points (named addresses whose time is taken from the trace).
- `1.32.0` — Legend III port P1, second checkpoint: New Game through the prologue's first map —
  the party set-up, the text engine (dictionary, control and scene codes), script references and
  the event dispatcher (doors, specials), the map load (layout, tiles, objects, leader, view), the
  text window's slide (a STAT raster) and the field frame work (map animations, objects). The
  `newgame1` trace (1,266 frames) is wait-exact (1,117 waits). The parity replay now also takes
  from the trace where the original entered the VRAM bracket and how long each interrupt-time
  frame work ran (its VRAM copies are paced by hblank), and counts screens drawn while the
  original was still writing line by line.
- `1.31.0` — Legend III port P1, first checkpoint: `@ffl3k/core` (the Legend III runtime: frame
  waits, interrupts and the VRAM bracket, ROM bank stack, copies, decompressor, fades, text lines,
  party sprites, the title and its menu) and `@ffl3k/parity` (PyBoy trace replay). The title is
  frame-exact against PyBoy in two traces (686 waits; screens equal or counted busy-frame tears).
- `1.30.0` — Legend III port P0: `@ffl3k/importer` (TypeScript) reproduces the Python Legend III data
  package from the player's ROM — every table record, maps/objects/warps, decoded layouts and
  patches, all 1,639 scripts, the music streams and driver loops, and the graphics/map buffers
  (hash-compared via `tools/ffl3/golden_export.py`). Its golden test found that map 11's flag-30
  patches run one row past the map; the game writes that row after the buffer (emulator-verified)
  and the Python decoder no longer grows its buffer there.
- `1.29.0` — Legend III milestone 7: music. A frame-level model of the bank-0F driver matches the
  game's channel pointers for all 20 songs; `ffl3kster music-export` and `export-all` (the
  processed data package ffl3/data/, 253 files, reproducible). Data milestones 1–7 complete.
- `1.28.0` — Legend III milestone 6: graphics. Map tilesets and the font equal VRAM at every map
  load of the intro; compressed, bitplane-separated monster picture sheets decoded and equal to
  VRAM in battle for six monsters of five sizes; `ffl3kster gfx-export`.
- `1.27.0` — Legend III milestone 5 completed: the map layout decoder (31 compressed metatile maps
  in banks 07/08 plus flag patches) equals the game's tile buffer at all 10 map loads of the intro.
- `1.26.0` — Legend III milestone 5, first part: 192 map records (171 framed exactly), objects,
  doors and position warps, shop inventories; header, object and door changes verified in PyBoy
  (8/8).
- `1.25.0` — Legend III milestone 4: random encounters (rate per map, 76 zones of seven
  threshold-chosen slots, 127 formations, fixed counts) verified with forced encounters (14/14);
  EXP corrected to floor(sum of the enemies' class byte / 4) (14/14); `ffl3kster encounters`.
- `1.24.0` — Legend III milestone 3: text. The script interpreter (00:3211) with its 80-entry
  recursive dictionary, every control code's operands, and 1,639 scripts in seven spans of banks
  03/09/0A that parse exactly; all script references and pointers land on script starts; byte and
  semantic round trips 1,639/1,639; a rewritten battle message shows in PyBoy; `ffl3kster
  text-export`.
- `1.23.0` — Legend III milestone 2b: field and menu save states after the intro; armor verified
  through the Equip menu (Defence/M.Def., Evade/M.Evade, resistances, weight; 11/11); the stat
  order (Attack, Defence, Agility, Magic) and MP from the status screen; battle EXP from the
  monster class record (9/9).
- `1.22.0` — Legend III milestone 2a: the shared item id space (spells 00-2F, weapons, armor,
  items) with its names and five record tables in bank 09, and the separate monster-skill table;
  17/17 controlled changes (record loads, boundaries, neighbour controls, weapon and skill power
  changing damage); `ffl3kster items`.
- `1.21.0` — Legend III course started (FFL3kster: `src/ffl3kster`, `ffl3/`, docs/ffl3/): ROM
  identity and a byte-identical no-op build; a disassembler for its bank-stack far calls; cold-boot
  save states through the name screens to the prologue battle; the monster data (three tables in
  bank 0B, 195 ids, names 0E:7533) with 28/28 controlled changes, boundaries and neighbour
  controls; patch compiler and SQLite store; proof edit Sprite HP 45 → 900 with an emulator
  acceptance test.
- `1.20.0` — Legend I: every battle effect handler (49 of 49) reached and frame-exact — a
  monster that runs out of abilities flees (06:5098), the {EC} slayer swords, and the asleep /
  paralysed / "nothing" turns that were reached all along but not counted; battles started from
  talk texts keep their deeper stack (verified); events number dialogue texts 16 above the M3
  table's entries.
- `1.19.1` — Legend I field sweep extended with talk events whose texts start battles (34 more
  traces: 327, 333,695 waits, all frame-exact or counted).
- `1.19.0` — Legend I event sweep: trigger cells, map objects and the events texts start
  (field 293 traces, 299,221 waits; every event command but 2, which shares 0/1's code); battles
  started from inside a text keep their deeper stack; battle sweep 29 traces (handler 451B
  reached); the replay draws a frame with the LCD register values a step went through and
  accepts PyBoy's object order (counted).
- `1.18.0` — Legend I sound effects and jingles verified: each of the 36 effects and 6 jingles
  played from the idle field loop against PyBoy with the driver's RAM compared (sound.test.ts:
  53 traces, 19,569 waits, 0 differences, mutations caught).
- `1.17.0` — Legend I field sweep (P2): every map (200) entered and walked against PyBoy:
  159,508 waits with identical machine state, 198/200 traces frame-exact (2 residual frames of
  half-written tile data, kept as exact expectations); the replay accepts late LCD register writes
  (lateRegs, counted).
- `1.16.0` — Legend I sound: the bank-07 sound driver ported (music: 3 channels with envelope,
  pitch, duty and panning tables; jingles; pulse and noise effects), run by the frame tick and
  played in the web player through the shared APU model; its RAM equals the original's at every
  frame wait of 11 field and title traces (8,769 waits).
- `1.15.0` — Legend I in the web player: a Legend I ROM is recognised on import, its data
  package and battery RAM (512 cells, `legend1.sav` export/import) are kept beside Legend II's,
  and the Legend I engine plays from power-on (title, new game, town, menus and save, continue,
  battle); a power-on trace (power1) is frame-exact. No music yet (driver not ported).
- `1.14.0` — Legend I port P1/P3: the start code 00:0224 (RAM and IO reset, random table CB00,
  font and shared tiles) ported; a defeat now restarts the game (game over, a button, the title)
  and escaping works, both frame-exact (flee1, defeat1; slice 16/16); busy loops that poll the
  frame tick resume after line 0 of that frame (TICK).
- `1.13.0` — Legend I port P3: battle sweep rounds 2-3 (24 PyBoy traces): 63,885 waits, 0
  differences; 07:75C6 (the CREATOR's death: window copy, per-line SCX/WX/BGP fall) ported and the
  boss-fall path no longer stops after 07:7510; EXPLODE and the stripes and wave effects reached;
  the replay accepts frames drawn while the original wrote VRAM line by line (mixTear, counted).
- `1.12.0` — Legend I port P1/P3: battle sweep (12 PyBoy traces, a party of four with the
  item under test): 32,303 waits, 0 differences; screen effects (flash, wobble, ripple, LCD-off
  flashes, wave, stripes), moving sprite scripts, a boss's fall, meat eating ported; the replay
  counts polled-raster line edges and PyBoy's blank frames around an LCD switch-off.
- `1.11.0` — Legend I port P1: the battle (bank 06 logic over a shared register set, battle
  screens, menus, attack animations, the intro slide raster) frame-exact for a first battle trace;
  text code 3B is four new lines; 00:0736 multiplies with the ROM's 8-bit accumulator.
- `1.10.0` — Legend I port P1: the field menus (main menu, abilities/items/equipment, bag,
  party order, save), the dialogue interpreter and the field events, item effects, facilities
  (inn, house of life, guild, shops) frame-exact against 12 PyBoy traces; the replay accepts
  frames the original finished during the display (splitTear, counted).
- `1.9.0` — Legend I port P1 (in progress): `@ffl1k/core` (MBC2 memory, Legend I frame clock and
  interrupts, bank-0 system routines, engine text, title, prologue, hero creation, map loading and
  the field loop) and `@ffl1k/parity` (PyBoy trace replay); frame-exact from power-on to the first
  town (`tools/ffl1/traces.py`).
- `1.8.0` — Legend I port P0: `@ffl1k/importer` (TypeScript) reproduces the Python Legend I data
  package (tables, text, maps/layouts, music, graphics) and builds the device-local FFL1 data package;
  CI guard extended to the Legend II port packages.
- `1.7.0` — FFL1kster milestone 7: Legend I music (18 songs, loop timing frame-exact in PyBoy) and the
  processed data package `ffl1/data/` (`ffl1kster export-all`, golden-tested).
- `1.6.0` — FFL1kster milestone 6: Legend I graphics (tilesets, metatiles, sprites, font, monster
  pictures) equal to PyBoy's VRAM; `ffl1kster gfx-export`.
- `1.5.0` — FFL1kster milestone 5: Legend I map records, layout decoder (equal to the ROM's routine
  for all 110 layouts), event lists, warps, shops and prices, collision; controlled changes in PyBoy.
- `1.4.0` — FFL1kster milestone 4: Legend I random encounters (zones, areas, formations, rate) by
  controlled change.
- `1.3.0` — FFL1kster milestone 3: Legend I text — both interpreters' control codes, 386 strings
  decoded and round-tripped, reinsertion visible in PyBoy; `ffl1kster text-export`.
- `1.2.0` — FFL1kster milestone 2: Legend I item/ability table, stat items, meat drop and GP rewards,
  meat transformation and mutant growth tables, each evidenced by controlled changes; RNG model;
  dialogue text encoding found.
- `1.1.0` — FFL1kster begins (Legend I, *The Final Fantasy Legend* USA): `src/ffl1kster` with its own
  CLI, project and SQLite store; milestone 1 complete — identity and byte-identical no-op build,
  monster table 06:6AE8 (200 × 9 bytes) evidenced by controlled changes, proof build and PyBoy
  acceptance; cross-game comparison note (docs/CROSS_GAME.md).
- `1.0.0` — Port P6 hardening for private use (web, Windows 10/11+, macOS, Linux; Android and iOS
  deferred; no store submissions): performance bench and 10-hour soak test, Firefox and WebKit
  checks, Game Boy A/B layout by default (Xbox layout in Options), Sound (mute) button, audio
  latency presets and wake-up, previous-save backup and restore, error screen with copyable
  details, About page, NOTICE and third-party notices, packaging check (no game content in any
  installer), tag-driven draft releases, install and release docs.
- `0.7.0` — Port P5 extras, all opt-in: fast text, battle speed, fast-forward, auto-battle, control
  rebinding, palettes, reduced flashing, integer scaling, larger touch buttons, widescreen field
  (experimental), cap break (experimental); run-time mods (IPS/BPS applied on device;
  `ffl2kster build --ips`).
- `0.6.1` — WASD + K/J keyboard layout alongside arrows + Z/X; Space also Start.
- `0.6.0` — Port P4 platforms: installable builds for web (PWA), Windows, macOS, Linux (Tauri 2),
  Android and iOS (Capacitor 8) from CI; touch controls, all gamepads, portable `.sav` saves,
  unverified ROM import; original app icon.
- `0.5.0` — Port P3 full battle: 2,152 battle parity traces pass (every item and ability,
  every enemy, all party types, random seeds, bosses); all 50 effect handlers entered; mutant
  growth settled by controlled change; growth penalties modelled with one-byte stores.
- `0.4.0` — Port P2 full field: whole-game parity sweeps (1,643 traces pass against the
  original), all reachable event kinds and text control codes covered, original-behaviour
  findings recorded.
- `0.3.0` — Port P1 vertical slice (field, text, menus, shops, inns, save/load, encounters,
  battle, sound driver and synth, web player); project renamed FFTOL — Tower of Legends, with
  FFL2kster as its Legend II toolkit.
- `0.2.0` — Milestones 2–7: items, text (6 tables), encounters, rewards/drops, meat formula,
  growth, calc-VM decompiler and rules, event system (scripts, shops, chests, music events),
  maps/NPCs/collision, graphics, font, music→MIDI; `export-all`; port-readiness summary.
- `0.1.0` — Milestone 1: enemy table schema (verified), patch compiler with semantic diff
  report, SQLite project store, deterministic PyBoy save-state generator, acceptance test.
- `0.0.3` — Clarified raw vs processed game-data policy.
- `0.0.2` — Public GitHub sync; ROM-commit guard hook; bring-your-own-ROM docs.
- `0.0.1` — Project scaffold, governance rules, docs stubs, ROM identity recorded.
