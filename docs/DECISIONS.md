# Decisions

## 2026-10-11 — Project governance

- Local task ledger in gitignored `.tasks/` with `FFL2K-xxxx` ids, matching
  sibling project conventions.
- Private material (original archive, starter brief) in gitignored `.private/`.
- Git syncs to the public `AznIronMan/FFL2kster` repo (operator request,
  2026-10-11). ROMs, saves, states, and extracted game data are never committed;
  enforced by `.gitignore` plus a `.githooks/pre-commit` header-signature check.

## 2026-10-11 — Raw vs processed game data

- Raw ROM bytes (verbatim dumps/blobs) are never committed; the code and
  documented command to regenerate them from a user-supplied ROM are.
- Processed data (decoded tables, converted/remastered graphics and music,
  schemas) may be committed, including the canonical SQLite project database.

## 2026-10-11 — Tooling (milestone 1)

- **Where things run.** Development ran in a Linux VM (Ubuntu 22.04 aarch64, no sudo) with
  the project folder mounted. Python 3.10 venv: PyBoy 2.8.1, pytest, numpy, pillow.
  RGBDS could not be built there (no bison/sudo), so **RGBDS 1.0.4 was installed on the
  macOS host via Homebrew** and used for the disassembly round-trip. All project code is
  pure Python (≥3.10) and runs on macOS too.
- **mgbdis** (commit 95d951a) for the exploratory disassembly in `build/analysis/` (ignored).
- **PyBoy** is the only emulator used for automated tests. Emulicious/SameBoy were not
  needed for milestone 1. Nothing was substituted for them; they stay recommended for
  manual work.
- **The emulator always runs a temporary copy of the ROM** (`emu.Emulator`), because PyBoy
  can write `.ram` files next to the ROM. `input/original.gb` is never opened for writing.
- **Battle detection uses a code hook** (`0D:44F4`) instead of screen heuristics, which
  misfired twice during exploration.

## 2026-10-11 — Save states

- States are **generated, never committed** (`python -m ffl2kster make-states`). The input
  chain in `src/ffl2kster/states.py` was recorded during exploration and replays
  deterministically: cold boot → title → party creation → story → town exit → world map →
  first battle (~2 s). The acceptance test regenerates them from scratch for both ROMs.
- Test party: 4× Human M (named "AA"/"AAAA") plus guest Mr. S. This was an incidental
  result of input mashing. It is deterministic and fit for purpose.
- Encounters are step-deterministic: the first is always 3× Jaguar (id 120) after 14 steps.

## 2026-10-11 — Patch compiler

- Edits are semantic (`domain`, `id`, `field`, `value`). Only fields marked editable *and*
  verified can be written: enemy `hp`, `str`, `agl`, `mana`, `def`. `type`, the ability count
  and the ability pointer are readable but not editable, because changing them safely needs
  list relocation, which is out of scope.
- Every changed byte must carry a reason, or the build fails. Overlapping edits with
  different values are rejected.
- After any change the **global checksum is recomputed** (hardware ignores it, but emulators
  and tools check it). The header checksum is recomputed too; it only changes if header bytes
  change.
- Proof edit: **Jaguar (id 120) HP 45 → 200**. Reasons: first and deterministic enemy, HP
  field fully verified, harmless, observable in RAM (D50C) and in battle outcome. Enemy HP is
  not displayed on screen in this game, so the visual proof is the different battle text.

## 2026-10-11 — SQLite project store

- `project/ffl2kster.sqlite` holds `field_defs` (meaning, status, evidence), `enemies`
  (stable id, name, provenance), `enemy_fields` (original value + source offset/bank/address
  + status per field), `enemy_abilities`, a separate `edits` table, and an `enemy_effective`
  view. `build --db` takes its edits from the DB; tests check it matches the JSON build.
- `project.json` keeps the edit list as the human-readable fixture. `db-import` copies its edits
  into the DB, and `test_committed_db_is_current` fails if they diverge.
- The DB is **committed** (decoded, processed data per the raw-vs-processed policy). Raw
  record bytes are not stored. `meta.imported_at` makes the file non-byte-reproducible; its
  content is reproducible.
- Import builds in a temp file and copies into place. The `FFL2K_SQLITE_JOURNAL` env var
  (e.g. `MEMORY`) supports filesystems that forbid deleting SQLite's rollback journal, as
  happened on the sandbox mount. The default is SQLite's normal journaling.

## 2026-10-11 — Assumptions

- The supplied ROM is the only supported revision (hash-gated). Other revisions/regions
  are out of scope until explicitly added.
- The `type` meaning (human/mutant/monster/robot) is **probable**, not verified: no code
  path that consumes it was traced in battle.
- The sandbox VM could not delete files, so empty `.gitkeep` files remain in `src/ffl2kster/`
  and `tests/`, plus a zero-byte `project/ffl2kster.sqlite-journal` (ignored). Both are harmless.
