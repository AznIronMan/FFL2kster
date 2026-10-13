# FFTOL — Tower of Legends

Private preservation and modding project for the Game Boy *Final Fantasy Legend* trilogy
(*SaGa*). It currently holds **FFL2kster**, the toolkit for *Final Fantasy Legend II* (USA) /
*SaGa 2*: a local editor and patch compiler whose output is a real, self-contained `.gb`, the
decoded data package, and a faithful TypeScript port of the game that runs in a web browser
on data imported from the player's own ROM.

Version: `1.17.0`
Status: **Legend II port complete for private use (1.0.0); Legend I (FFL1kster) in progress —
data milestones 1–7 done (docs/FFL1_PROGRESS.md).** The port plays from the title through
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
| **FFL1kster**, **FFL2kster**, **FFL3kster** | Per-game toolkits for Legend I, II and III. Only **FFL2kster** exists (the Python package `ffl2kster`, its CLI and the Legend II port); the other two are reserved names. |
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
