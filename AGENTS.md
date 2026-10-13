# AGENTS.md

This file defines repository rules for human operators and AI coding agents
working on FFTOL (Tower of Legends) and its toolkits.

## Project Identity

- Project name: FFTOL (full title: Tower of Legends, short TOL; logo mark F²)
- Toolkits: FFL2kster (Legend II, exists: editor, patch compiler, data package,
  web port); FFL1kster (Legend I, in progress: `src/ffl1kster`, `ffl1/`, docs/FFL1_PROGRESS.md);
  FFL3kster (Legend III, in progress: `src/ffl3kster`, `ffl3/`, docs/FFL3_PROGRESS.md); TOLkster (future master engine,
  reserved — see docs/END_GOAL.md)
- Description: Private preservation and modding project for the Game Boy
  *Final Fantasy Legend* trilogy; currently the Legend II toolkit and port
  (*Final Fantasy Legend II* (USA) / *SaGa 2*)
- Maintainer: Street Kings Productions
- Company: Clark & Burke LLC
- Website: https://www.cnb.llc
- Developer email: streetkings@cnb.llc
- Current version: `1.33.0`

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

- Public upstream: `https://github.com/AznIronMan/fftol.git` (renamed from
  `FFL2kster` on 2026-10-12; GitHub redirects the old URL)
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
- `.private/` holds the original archive and brief; do not copy its contents
  into tracked files.

## Raw vs Processed Game Data

- **Raw data is never committed.** Raw means bytes copied verbatim from the ROM:
  byte-range dumps, undecoded table/tile/text/music blobs, bank splits, or any
  file that reproduces ROM contents byte-for-byte. Raw extracts are generated
  locally into ignored `project/scratch/` or `build/`.
- **The method to produce raw data is committed.** If any part of the project
  needs a raw extract, commit the extraction code (under `src/ffl2kster/` or
  `tools/`) plus the documented command, offsets, and expected hashes so anyone
  can regenerate it from their own ROM. Never commit the output itself.
- **Processed data may be committed.** Data that has been decoded, structured,
  converted, or remastered — e.g. parsed tables (JSON/CSV/SQLite with named
  fields), decoded text, converted or redrawn graphics, re-arranged music, and
  schemas/specs — is allowed in the repository.
- When unsure whether something is raw or processed, treat it as raw and ask.

## ROM Handling Rules

- `input/original.gb` is read-only input. **Never modify it.** Always copy and
  patch the copy.
- Supported ROM: SHA-256
  `ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e`.
  Refuse to build against anything else.
- Legend I (FFL1kster): `ffl1/input/original.gb` is read-only input with SHA-256
  `e5b1d116a8fb01b7a7213f906b3ef1bcc91a18f6826b01ee1bccd89429a0d906`; never modify it, never
  assume a Legend II layout for it (docs/ffl1/), and do not change `src/ffl2kster` for Legend I
  work except to factor genuinely shared harness code (CI guard against v1.0.0).
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

## Working Notes

- Run `python -m pytest` before every commit; emulator tests regenerate save states.
- Use `python -m ffl2kster make-states` to recreate save states; never commit them.
- New table fields start as `hypothesis`; promote only with controlled-change evidence
  recorded in `docs/FINDINGS.md`, and keep `schema/*.py` status fields in sync.
- After changing `project.json` edits, run `db-import` so the committed SQLite stays current.

## Scope Control

- Work one milestone at a time (see `GOAL.md`). Stop after the milestone
  acceptance test and report what is proven, what remains unknown, and the
  recommended next data domain.
