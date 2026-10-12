# FFL2kster

Private, local editor and patch compiler for *Final Fantasy Legend II* (USA) /
*SaGa 2* on the original Game Boy. The output is a real, self-contained `.gb`.

Version: `0.1.0`
Status: **Milestone 1 complete**: one verified data domain (the 256-entry monster/enemy
stats table), a hash-gated patch compiler, a SQLite project store, and an automated
PyBoy original-vs-patched acceptance test. See `docs/PROGRESS.md`.

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
python -m ffl2kster make-states                            # regenerate PyBoy save states
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
src/ffl2kster rom/header, build engine, schema/enemies, db, emu harness, states, CLI
tools/        reverse-engineering helpers (text decoder, scans, explorer, controlled changes)
tests/        pytest suite incl. PyBoy acceptance test (marker: emu)
docs/         ROM_MAP.md, FINDINGS.md, DECISIONS.md, PROGRESS.md
build/        generated output only (ROMs, states, analysis, test-artifacts/)
```

## Privacy

ROMs, saves, save states, raw ROM extracts, and generated ROMs are never
committed or distributed. Raw extracts are regenerated from your own ROM using
the extraction tools in this repo. Processed data (decoded tables, converted or
remastered graphics/music, schemas) may be included.

## Changelog

- `0.1.0` — Milestone 1: enemy table schema (verified), patch compiler with semantic diff
  report, SQLite project store, deterministic PyBoy save-state generator, acceptance test.
- `0.0.3` — Clarified raw vs processed game-data policy.
- `0.0.2` — Public GitHub sync; ROM-commit guard hook; bring-your-own-ROM docs.
- `0.0.1` — Project scaffold, governance rules, docs stubs, ROM identity recorded.
