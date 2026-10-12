# Milestone 1 Progress

Checklist derived from `GOAL.md` and the milestone-1 Definition of Done. Each
item is checked only when its evidence (test output, diff, screenshot) has been
inspected. Log entries are newest-last.

## Definition of Done

- [x] D1. ROM identity verified from the actual file: hashes, header, cartridge type
- [x] D2. No-op build produces a byte-identical `.gb` with a zero-change diff report
- [ ] D3. Enemy record format evidenced across at least two different enemy records
- [ ] D4. Patch CLI builds a patched ROM whose diff report shows only intended bytes changed
- [ ] D5. Proven enemy table migrated into `project/ffl2kster.sqlite` with source bank/offset and verification status per field
- [ ] D6. Automated PyBoy test: original vs patched, same save state, intended value differs, both ROMs boot to the test point
- [ ] D7. `docs/ROM_MAP.md`, `FINDINGS.md`, `DECISIONS.md`, `PROGRESS.md` current

## GOAL.md step checklist

1. Inventory and preserve the input
   - [x] SHA-256 + size; header parse (title, type, ROM/RAM size, destination, version, checksums)
   - [x] Checksums validated
   - [x] `project.json` with ROM hash and no edits
   - [x] Build command: byte-identical copy + zero-change diff report
2. Set up analysis
   - [ ] mgbdis exploratory disassembly in `build/analysis/`
   - [ ] `docs/ROM_MAP.md` seeded (external claims marked)
   - [ ] Utilities: offset<->bank, dump/compare, record/pointer search, diff reports
3. Dynamic test points
   - [ ] Boot unmodified ROM in PyBoy; dated screenshots (title, new game)
   - [ ] Save states: title, party creation, first town, first battle
   - [ ] Verified RAM/state indicators for field / menu / battle
4. Enemy record format
   - [ ] Table start, record count, record length, field order/encoding
   - [ ] Linkages (name, graphics, abilities, drop/meat) as evidence permits
   - [ ] Boundaries tested on ≥2 records
   - [ ] Proof field chosen
5. Patch compiler
   - [ ] Hash gate, never writes input, schema-only edits
   - [ ] Size + checksum validation; diff report with offset/bank/old/new/reason
   - [ ] JSON fixture proof build
   - [ ] SQLite import + build from DB, with provenance + verification per field
6. Acceptance test
   - [ ] Same battle save state, original vs patched
   - [ ] Intended value differs (memory and/or screen); before/after screenshots
   - [ ] Patched ROM boots and reaches test point
   - [ ] Artifacts in `build/test-artifacts/`; automated vs manual documented

## Log

### 2026-10-11 — Toolchain
- Linux VM (Ubuntu 22.04 aarch64, no sudo): Python 3.10 venv, PyBoy 2.8.1,
  pytest, numpy, pillow; mgbdis cloned (commit 95d951a).
- macOS host: RGBDS 1.0.4 via Homebrew (VM lacks bison/sudo to build it).

### 2026-10-11 — Step 1: identity + no-op build
- `python -m ffl2kster info --project project/project.json` → SAGA2,
  MBC1+RAM+BATTERY, 256 KiB/8 KiB, logo OK, header 0xCD OK, global 0xD970 OK,
  matches project hash.
- `python -m ffl2kster build` → "0 changed bytes (byte-identical)";
  `sha256sum` of input and `build/FFL2kster.gb` identical; diff report
  `changes: []`.
- `pytest`: 9 passed (identity, header, checksums, bank math, no-op identical,
  input untouched, refuses overwrite, refuses wrong ROM, rejects unknown domain).
