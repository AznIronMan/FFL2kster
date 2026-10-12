# GOAL — Milestone 1: One Verified Enemy-Data Slice

Prove one complete path before building anything else:

> Original ROM → identify one data domain → edit it in a project file →
> build a patched ROM → verify the change automatically in an emulator.

The canonical output is a real, self-contained `.gb` file.

## Steps

1. **Inventory and preserve the input** — hash, parse/validate header, create
   `project/project.json`, no-op build that is byte-identical with an empty diff.
2. **Set up analysis** — mgbdis exploratory disassembly, seed `docs/ROM_MAP.md`,
   offset/bank, dump/compare, record-search, and diff utilities.
3. **Establish dynamic test points** — PyBoy boot, screenshots, save states
   (title, party creation, first town, first battle), verified state indicators.
4. **Reverse-engineer the enemy record format** — table start, count, length,
   fields, linkages; verify boundaries on ≥2 records; pick one proof field.
5. **Implement the patch compiler** —
   `python -m ffl2kster build --rom input/original.gb --project project/project.json --out build/FFL2kster.gb --diff build/diff-report.json`;
   hash gate, checksum validation, semantic diff report; migrate to SQLite once
   the format is verified.
6. **Acceptance test** — automated PyBoy original-vs-patched comparison from a
   shared battle state, with screenshots under `build/test-artifacts/`.

## Out of scope for milestone 1

GUI, full decompilation, map/text editors, other tables, new spells or ASM
effects, ROM expansion, imported graphics, music editing, enhanced wrapper,
modern runtime, DS analysis.

Full detail: `.private/FFL2kster-Starter-Brief.md`.
