# Progress

Checklist derived from `GOAL.md` and the milestone-1 Definition of Done. Each
item is checked only when its evidence (test output, diff, screenshot) has been
inspected. Log entries are newest-last.

## Definition of Done

- [x] D1. ROM identity verified from the actual file: hashes, header, cartridge type
- [x] D2. No-op build produces a byte-identical `.gb` with a zero-change diff report
- [x] D3. Enemy record format evidenced across at least two different enemy records
- [x] D4. Patch CLI builds a patched ROM whose diff report shows only intended bytes changed
- [x] D5. Proven enemy table migrated into `project/ffl2kster.sqlite` with source bank/offset and verification status per field
- [x] D6. Automated PyBoy test: original vs patched, same save state, intended value differs, both ROMs boot to the test point
- [x] D7. `docs/ROM_MAP.md`, `FINDINGS.md`, `DECISIONS.md`, `PROGRESS.md` current

## GOAL.md step checklist

1. Inventory and preserve the input
   - [x] SHA-256 + size; header parse (title, type, ROM/RAM size, destination, version, checksums)
   - [x] Checksums validated
   - [x] `project.json` with ROM hash and no edits
   - [x] Build command: byte-identical copy + zero-change diff report
2. Set up analysis
   - [x] mgbdis exploratory disassembly in `build/analysis/`
   - [x] `docs/ROM_MAP.md` seeded (external claims marked)
   - [x] Utilities: offset<->bank, dump/compare, record/pointer search, diff reports
3. Dynamic test points
   - [x] Boot unmodified ROM in PyBoy; dated screenshots (title, new game)
   - [x] Save states: title, party creation, first town, first battle
   - [~] Verified RAM/state indicators: battle (code hook 0D:44F4 + D500 block) and field
     (C42C/C42D respond to D-pad) verified; **menu: no RAM indicator found** (3 approaches
     falsified, see FINDINGS) — not required by the Definition of Done
4. Enemy record format
   - [x] Table start, record count, record length, field order/encoding
   - [x] Linkages (name, graphics, abilities, drop/meat) as evidence permits
   - [x] Boundaries tested on ≥2 records
   - [x] Proof field chosen
5. Patch compiler
   - [x] Hash gate, never writes input, schema-only edits
   - [x] Size + checksum validation; diff report with offset/bank/old/new/reason
   - [x] JSON fixture proof build
   - [x] SQLite import + build from DB, with provenance + verification per field
6. Acceptance test
   - [x] Same battle save state, original vs patched
   - [x] Intended value differs (memory and/or screen); before/after screenshots
   - [x] Patched ROM boots and reaches test point
   - [x] Artifacts in `build/test-artifacts/`; automated vs manual documented

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

### 2026-10-11 — Step 2: analysis
- mgbdis disassembly rebuilt byte-identical with RGBDS 1.0.4 (`make` → same SHA-256).
- CLI helpers `offset`, `dump`, `find`, `relsearch`, `ptrscan`, `diff`; tools for text
  decoding, family-stride scanning, map exploration and controlled changes.

### 2026-10-11 — Step 3: dynamic test points
- Screenshots inspected for title, intro, party creation, story, town, world map, battle.
- `make-states` regenerates title / party_creation / first_town / world / pre_battle /
  battle (+ pre_battle_id180, pre_battle_id45) from cold boot in ~2 s; every state checked
  by screenshot.

### 2026-10-11 — Step 4: enemy record format
- Two framings falsified before code at 0D:427E fixed the layout (FINDINGS).
- Table 0D:6F80, 256 × 10 bytes; names 0F:6EC0; RAM cross-checks for 6 ids.
- Controlled changes on Jaguar (120) and Spider (45): each field changes exactly the
  predicted WRAM bytes; neighbour-record controls on both sides change nothing.
- Proof field: Jaguar `hp`.

### 2026-10-11 — Steps 5–6: patch compiler, SQLite, acceptance
- Proof build diff: 0x37432 (2D→C8) + global checksum bytes, all reasoned; DB build is
  byte-identical to the JSON build.
- First run: `test_stat_edit` failed because it assumed both checksum bytes always change.
  Corrected the expectation to "non-checksum changes == target byte; checksum changes
  reasoned". This is the real invariant; the build code was unchanged.
- Acceptance: both ROMs cold-boot to the same battle; same pre-battle state gives HP
  45 vs 200, WRAM differences ⊆ HP bytes; after 30 identical presses the original shows
  "Jaguar fell." and the patched ROM's Jaguar survives with 84 HP.

### 2026-10-11 — Final clean run (Definition of Done)
Fresh copy of the tracked tree + `input/original.gb` only, new venv, `pip install -e '.[dev]'`:
- `info`: SHA-256 ef66c90a…486e, 262144 bytes, SAGA2, MBC1+RAM+BATTERY, 256 KiB/8 KiB,
  header/global/logo OK, matches project.
- No-op build: identical, 0 changed bytes.
- Proof build: 3 changed bytes (0x37432 data + 0x14E/0x14F checksum), all reasoned.
- `db-import` into a fresh DB: 256 enemies, 2304 field rows, 1 edit; DB build == JSON build.
- `make-states`: battle after 14 steps; ids 180 and 45 found.
- `tools/controlled_change.py`: identical results to the exploration run (15 cases, 4 controls clean).
- `pytest -v`: **30 passed** (incl. 4 emulator acceptance tests) in 7.9 s.
- Without the ROM: 28 skipped, 2 passed, 0 failed.


## Milestones 2–7 (2026-10-12)

| Milestone | Result | Key evidence |
|---|---|---|
| M2a items/abilities | done | item table, uses, prices; damage and equip effects by controlled change |
| M2b meat/growth | done | measured matrix → formula 32,940/32,940; HP growth chance controlled change |
| M3 text | done | 906 entries; 880/900 exact alignment; reinsertion visible in PyBoy |
| M4 encounters/drops | done | formation edits visible; reward byte changes (no drop / 66 GP / meat) |
| M5 maps/events | done | 212 maps; shop/chest/song events and collision by controlled change |
| M6 graphics | done | monster art, tilesets, sprites, font |
| M7 music | done (timbre open) | sequence decode, loop periods frame-exact in PyBoy |
| Data package | done | `export-all` reproduces `data/` byte-for-byte; docs/PORT_READINESS.md |

Test suite: 68 passed (56 fast + 12 emulator, ~11 s).

## Port P0 — Foundations (2026-10-12)

| Item | Result | Evidence |
|---|---|---|
| Map layout format (00:2253) | decoded, Python + TS renderers | bit-exact vs ROM routine in SM83 interpreter: 211 captures, 28 conditional maps × 20 random progress states, 300 fuzzed streams |
| Tileset sources (07:7800 → bank 02, UI 04:4800) | decoded | VRAM equality on 211 maps (animated metatiles 30/31 excluded) |
| Monster graphics (0D:6400/6500/6510) | decoded | all 256 equal battle VRAM |
| Music instruments, waveforms, 57 SFX | decoded | SFX register timelines frame-exact in PyBoy |
| UI / sprite tiles | located | 0x8800 block = 04:4800 on all maps; battle sprites = bank-03 pages |
| `port/` workspace | done | npm workspaces, TS strict, Vitest, Vite web shell |
| TS importer | done | golden tests equal Python output for every domain, MIDI bytes, layouts, graphics |
| CI | green | GitHub Actions: typecheck, tests (ROM tests skip), build, no-content check; Python fast tests |
| Browser check | done | built web app imported the ROM in the desktop browser pane, persisted across reload, removal works |

Tests: Python 74 passed (61 fast + 13 emulator); TypeScript 12 passed with the ROM present.
