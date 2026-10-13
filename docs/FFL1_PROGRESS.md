# FFL1 progress — FFL1kster (The Final Fantasy Legend, USA)

The Legend II method repeated on Legend I: data milestones 1–7, then port phases P1–P5
(docs/PORT_PLAN.md, "Legend I course"). Nothing is assumed from Legend II: every address, record
format, routine, encoding and checksum behaviour is re-derived from this ROM. Items are checked
only when their evidence (test output, diff, screenshot, trace) has been inspected. Findings:
docs/ffl1/FINDINGS.md; addresses: docs/ffl1/ROM_MAP.md; cross-game notes: docs/CROSS_GAME.md.

Reference ROM: `ffl1/input/original.gb` (read-only, never committed), SHA-256
`e5b1d116a8fb01b7a7213f906b3ef1bcc91a18f6826b01ee1bccd89429a0d906`, 131,072 bytes.

## Acceptance (whole run)

- [x] A1. FFL1kster no-op build byte-identical with a zero-change diff (M1)
- [ ] A2. Tables evidenced to the milestone-1 standard (boundaries on ≥2 records, controlled
      changes with neighbour controls, emulator acceptance tests)
- [ ] A3. Web player loads the FFL1 data package and plays the vertical slice
- [ ] A4. Field and battle parity sweeps recorded with counts against the original ROM
- [ ] A5. All suites green (FFL2kster suite and its byte-identical no-op build included), CI green

## Milestone 1 — one verified enemy-data slice

1. Inventory and preserve the input
   - [x] SHA-256/size; header parse; checksums validated (MBC2+BATTERY, 128 KiB)
   - [x] `ffl1/project/project.json` with the ROM hash (now carrying the proof edit)
   - [x] No-op build: byte-identical copy + zero-change diff report
2. Analysis
   - [x] Exploratory disassembly in `ffl1/build/analysis/` (rebuilds byte-identical)
   - [x] `docs/ffl1/ROM_MAP.md` seeded
   - [x] Utilities (offset, dump, find, relsearch, diff)
3. Dynamic test points
   - [x] PyBoy boot; screenshots (title, intro, hero creation, town, world, battle)
   - [x] Save states: title, party creation, first town, world, pre-battle, battle (`make-states`)
   - [~] State indicators: battle verified (loader hook 06:5713 + slots D080..); field position CCC9/CCC8 probable
4. Enemy record format
   - [x] Table start, count, length, field order/encoding (4 falsified framings documented)
   - [x] Linkages: names (verified), abilities (verified), HP classes (verified); graphics and drops later (M4/M6)
   - [x] Boundaries on 2 records (ASIGARU, SKELETON), 4 neighbour controls clean
   - [x] Proof field: ASIGARU `hp_class`
5. Patch compiler
   - [x] Hash gate, never writes input, schema-only edits
   - [x] Checksums, semantic diff report; SQLite store with provenance + verification per field
6. Acceptance test
   - [x] Same battle state, original vs patched; HP 19 vs 769, outcome differs; screenshots

## Milestones 2–7

| Milestone | Status | Evidence |
|---|---|---|
| M2 items/abilities, growth | done (prices with the shops in M5) | item table 06:7700 (uses, power, handler); stat items; meat drop + GP rewards in the monster record; meat transformation tables (6/6 predictions); mutant growth tables; RNG model |
| M3 text | done | 386 strings in 3 tables; control codes from both interpreters; contiguous parse 383/383 boundaries; semantic round trip 386/386; reinsertion visible for dialogue, battle and UI |
| M4 encounters/drops | not started | |
| M5 maps/events | not started | |
| M6 graphics | not started | |
| M7 music | not started | |
| Data package (`export-all`) | not started | |

## Port P1–P5 (Legend I import target)

| Phase | Status | Evidence |
|---|---|---|
| P0 importer + scaffold | not started | |
| P1 vertical slice | not started | |
| P2 full field | not started | |
| P3 full battle | not started | |
| P4 platforms | not started | |
| P5 extras | not started | |

## Log

### 2026-10-12 — Milestone 1
- Identity, no-op build (byte-identical, `changes: []`), mgbdis round trip.
- States from cold boot; enemy loader 06:5713 found (frame search + function-entry hooks).
- Monster table 06:6AE8 (200 × 9): 15 controlled changes + 4 neighbour controls; CLIPPER status
  screen confirms Str/Def/Agl/Mana; area table swap reaches a second record (SKELETON).
- Proof build: ASIGARU `hp_class` 0→21 (0x1B05C + checksum); DB build == JSON build.
- Acceptance: same pre-battle state → HP 19 vs 769; original wins after 50 A presses, patched
  battle continues (749 HP).
- Tests: `tests/ffl1` 22 passed (3 emulator); full suite 103 passed (FFL2kster 81 unchanged);
  FFL2kster no-op build byte-identical.

### 2026-10-12 — Milestone 2
- Item table 06:7700 (256 × 8): uses (monster ability), power (weapon damage, stat-item gain),
  handler (06:403A, 49 entries) by controlled change; default uses in the name entry.
- Monster record: b0 bits 0–2 = meat chance, b6 low = GP class (06:72A4), both verified.
- Meat: drop at 06:517A; transformation 00:0D9C with tables 02:7900 / 6FD3 / 72A8 / 7438; six
  controlled changes match the predictions.
- Mutant growth 06:539E with tables 06:7F00 / 53DE / 7F0F; ability learning verified.
- RNG 00:07D3: per-call-site counters into a 256-byte table (differs from Legend II).
- Tests: `tests/ffl1` 30 passed.

### 2026-10-12 — Milestone 3
- Engine text (00:0911, jump table 00:0CE2) and dialogue text (00:0EBA) control codes; tables
  02:7860 (80), 03:7080 (51), 05:7B30 (255).
- Contiguous parse of every entry; semantic round trip 386/386 (365 byte-identical).
- PyBoy reinsertion: dialogue, battle message, title screen.
- Tests: `tests/ffl1` 41 (6 emulator).
