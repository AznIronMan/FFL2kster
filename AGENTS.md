# AGENTS.md

This file defines repository rules for human operators and AI coding agents
working on FFL2kster.

## Project Identity

- Project name: FFL2kster
- Description: Private, local editor and patch compiler for *Final Fantasy
  Legend II* (USA) / *SaGa 2* on the original Game Boy
- Maintainer: Street Kings Productions
- Company: Clark & Burke LLC
- Website: https://www.cnb.llc
- Developer email: streetkings@cnb.llc
- Current version: `0.0.2`

## Required Workflow

- Every implementation request must be tracked with a `FFL2K-xxxx` item before
  code or documentation changes begin.
- This applies to requests from a developer, operator, Codex, Grok, Claude, or
  any other LLM/automation agent.
- Use `.tasks/active/`, `.tasks/pending/`, `.tasks/completed/`, and
  `.tasks/cancelled/` for local tracking, and keep `.tasks/INDEX.md` current.
- `.tasks/` is intentionally gitignored. Do not reference FFL2K ticket IDs in
  public docs, release notes, or README content.
- Read `GOAL.md` before starting work. The original brief is kept at
  `.private/FFL2kster-Starter-Brief.md` for reference.
- Increment the project version for every completed change according to
  semantic versioning, and keep `README.md` version/changelog aligned.
- Commit working states locally as milestones are proven. Avoid giant
  unreviewable commits.

## GitHub Sync

- Public upstream: `https://github.com/AznIronMan/FFL2kster.git`
- Work on `main` by default. Commit completed, reviewed work and push with
  `git push origin main` unless the operator says not to push.
- Review every diff for ROM data, secrets, and private notes before staging.

## ROMs Are Never Committed

- The repository is public. **No `.gb`/`.gbc` ROM, save (`.sav`), save state,
  ROM archive, or patched ROM may ever be committed or pushed** — in any
  folder, under any name. Users supply their own legally obtained ROM.
- `.gitignore` blocks these globally and `.githooks/pre-commit` rejects any
  staged ROM by extension or by Game Boy header signature. Keep the hook enabled
  (`git config core.hooksPath .githooks`) and never bypass it with `--no-verify`.
- Do not commit raw ROM byte dumps, extracted graphics/text/music, or tables
  copied from the ROM. Commit code, schemas, offsets, and documentation only;
  extracted data stays in ignored `project/scratch/`, `project/*.sqlite`, and
  `build/`.
- `.private/` holds the original archive and brief; do not copy its contents
  into tracked files.

## ROM Handling Rules

- `input/original.gb` is read-only input. **Never modify it.** Always copy and
  patch the copy.
- Supported ROM: SHA-256
  `ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e`.
  Refuse to build against anything else.
- Every generated ROM goes in `build/`.

## Evidence Rules

- **No guessed offsets.** Every table, field, routine, or RAM address must be
  labeled `verified`, `probable`, or `hypothesis`, with supporting evidence
  (cross-references, repeated-record analysis, debugger traces, RAM watches,
  controlled corruption tests, emulator assertions, before/after screenshots).
- Record findings incrementally in `docs/ROM_MAP.md` and `docs/FINDINGS.md`
  (dated, including failed hypotheses). Record tooling/architecture choices in
  `docs/DECISIONS.md`. Never keep critical discoveries only in chat.
- Changing one byte that changes one visible value does not prove a whole
  table; confirm record boundaries on at least two records.

## Architecture Direction

- Patch engine and CLI first; a GUI is a later front end over them.
- SQLite (`project/ffl2kster.sqlite`) becomes the canonical store only after a
  table format is proven. Discovery dumps go in `project/scratch/`. The DB
  keeps stable IDs, bank/offset provenance, field meanings, verification state,
  and user edits separate from extracted original values.
- Milestone 1 edits existing tables in place only: no ROM expansion, table
  relocation, new maps/effects, or full matching disassembly.
- A future modern runtime (Pixel Remaster-style, engine undecided) is a
  downstream consumer of the extracted data. The ROM remains the behavioral
  oracle.

## Tooling

- Required: Git, Python 3 + project venv, RGBDS, mgbdis, PyBoy.
- Recommended: Emulicious (RE workbench), SameBoy (accuracy cross-checks).
- If a tool is unavailable, install it if permitted or document the exact
  blocker. Do not silently substitute a weaker method and claim the same result.
- Do not vendor dependencies unless unavoidable; use `third_party/` if so.

## Scope Control

- Work one milestone at a time (see `GOAL.md`). Stop after the milestone
  acceptance test and report what is proven, what remains unknown, and the
  recommended next data domain.
