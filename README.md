# FFTOL — Tower of Legends

Private preservation and modding project for the Game Boy *Final Fantasy Legend* trilogy
(*SaGa*). It currently holds **FFL2kster**, the toolkit for *Final Fantasy Legend II* (USA) /
*SaGa 2*: a local editor and patch compiler whose output is a real, self-contained `.gb`, the
decoded data package, and a faithful TypeScript port of the game that runs in a web browser
on data imported from the player's own ROM.

Version: `0.7.0`
Status: **Port P5 (extras) complete.** The port plays from the title through
party creation, towns, shops, inns, menus, the world map, encounters and battles, with music,
and saves and loads, verified frame by frame against the original in an emulator: the whole
field (P2, 1,637 sweep traces) and the battle system (P3, 2,152 battle traces). It installs on
the web (PWA), Windows, macOS, Linux, Android and iOS (P4, docs/PLATFORMS.md), with opt-in
extras and mods that leave the original untouched when off (P5, docs/EXTRAS.md). Data
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
