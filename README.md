# FFL2kster

Private, local editor and patch compiler for *Final Fantasy Legend II* (USA) /
*SaGa 2* on the original Game Boy. The output is a real, self-contained `.gb`.

Version: `0.0.2`
Status: **Scaffolded.** No code yet; milestone 1 (enemy-data vertical slice) is
planned. See `GOAL.md`.

## Layout

```text
input/        original.gb (read-only, gitignored), optional .sav, reference/
project/      project.json manifest, ffl2kster.sqlite (later), scratch/
src/          ffl2kster/ (Python), asm/ (RGBDS patches, later)
tools/        helper scripts and exploratory tooling
tests/        automated tests (PyBoy harness)
docs/         ROM_MAP.md, FINDINGS.md, DECISIONS.md
build/        generated output only (FFL2kster.gb, diff-report.json, test-artifacts/)
third_party/  vendored deps only if unavoidable
```

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

After cloning, enable the repository hooks (they block accidental ROM commits):

```bash
git config core.hooksPath .githooks
```

Build and test instructions will be added once the CLI exists.

## Privacy

ROMs, saves, save states, extracted game data, and generated ROMs are never
committed or distributed.

## Changelog

- `0.0.2` — Public GitHub sync; ROM-commit guard hook; bring-your-own-ROM docs.
- `0.0.1` — Project scaffold, governance rules, docs stubs, ROM identity recorded.
