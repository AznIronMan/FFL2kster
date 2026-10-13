# FFL3 progress — FFL3kster (Final Fantasy Legend III, USA)

The Legend II / Legend I method repeated on Legend III: data milestones 1–7, then port phases
P1–P5 (docs/PORT_PLAN.md, "Legend III course"). Nothing is assumed from the other games: every
address, record format, routine and encoding is re-derived from this ROM. Items are checked only
when their evidence (test output, diff, screenshot, trace) has been inspected. Findings:
docs/ffl3/FINDINGS.md; addresses: docs/ffl3/ROM_MAP.md; cross-game notes: docs/CROSS_GAME.md.

Reference ROM: `ffl3/input/original.gb` (read-only, never committed), SHA-256
`5ed87f65225b72a74c3c04a4e5d67683fb5cc33e5f1266157350828ab973fc1d`, 262,144 bytes.

## Acceptance (whole run)

- [x] A1. FFL3kster no-op build byte-identical with a zero-change diff (M1)
- [x] A2. Tables evidenced to the milestone-1 standard — M1–M7 (open items listed per milestone)
- [ ] A3. Web player loads the FFL3 data package and plays a vertical slice
- [ ] A4. Field and battle parity sweeps recorded with counts
- [ ] A5. All suites green (FFL2kster and FFL1kster included), CI green

## Milestone 1 — one verified enemy-data slice (1.21.0)

1. Inventory and preserve the input
   - [x] SHA-256/SHA-1/MD5 (No-Intro), size; header parse; checksums (MBC1+RAM+BATTERY, 256 KiB)
   - [x] `ffl3/project/project.json` with the ROM hash (now carrying the proof edit)
   - [x] No-op build: byte-identical copy + zero-change diff report
2. Analysis
   - [x] Recursive disassembler with Legend III's far-call conventions (`tools/ffl3/disasm.py`)
   - [x] `docs/ffl3/ROM_MAP.md` seeded
   - [x] Utilities (info, offset, dump, find, relsearch, diff)
3. Dynamic test points
   - [x] PyBoy boot; screenshots (title, intro, name entry, prologue battle)
   - [x] Save states: title, name entry, pre-battle, battle (`make-states`, deterministic)
   - [x] Battle indicator: loader hook 0B:4526 + entities D280..; field position: open (M5)
4. Enemy record format
   - [x] Three tables (4A19 × 12, 470D × 4, 533D × 9; 195 ids, contiguous), names 0E:7533
   - [x] Field encodings from the loader code; 1 framing falsified (b9-b11 depend on the kind)
   - [x] Boundaries on 2 records (Diviner, Sprite: first and last bytes), 4 neighbour controls
   - [x] Boss rule (× 16 for ids ≥ BB) by RAM poke, with a below-the-line control (BA)
   - [x] Proof field: `hp` (12-bit)
5. Patch compiler
   - [x] Hash gate, never writes input, schema-only edits (3 domains), checksums, diff report
   - [x] SQLite store with provenance + verification status per field (`db-import`, game FFL3)
6. Acceptance test
   - [x] Same pre-battle state, original vs patched: Sprite HP 45 vs 900, WRAM differs only there;
         outcome differs (Sprite falls vs the battle ends on a party member's fall); screenshots

Counts (1.21.0): tests/ffl3 22 passed (3 emulator); controlled changes 28/28; whole Python suite 159
passed (130 ROM-free + 29 emulator); FFL2 guard clean.

## Milestones 2–7

| Milestone | Status | Evidence |
|---|---|---|
| M2 items/abilities, growth | M2a (1.22.0) and M2b (1.23.0) done; item use and spells in the field wait for shops (M5); level-up open | names (00:1E8F), five record tables in bank 09 (09:5D87), 17/17 controlled changes (loads, boundaries, controls, power → damage); armor via the Equip menu 11/11 (every nibble named from the status screen); stats = Attack/Defence/Agility/Magic, value 2 = MP; EXP from class byte 1 (corrected in M4) |
| M3 text | done (1.24.0) | one script interpreter, 80-entry dictionary, 1,639 scripts in 7 spans, all references/pointers on script starts, byte and semantic round trips 1,639/1,639, reinsertion visible in PyBoy; `text-export` |
| M4 encounters/drops | done (1.25.0); GP source open | rate/zone/threshold/formation chain 14/14; EXP = floor(sum of class byte 1 / 4), 14/14 |
| M5 maps/events | done (1.26.0-1.27.0); shop prices and in-game shop use open | 171 records framed exactly; 8/8 emulator changes (header, object, doors); layout decoder equal to D000 at 10/10 map loads |
| M6 graphics | done (1.28.0); per-map tile overrides and Xagor's picture open | tilesets = VRAM at 8 map loads; font; monster pictures = VRAM for 6 monsters (sizes 0-4); `gfx-export` |
| M7 music | done (1.29.0; timbre not modelled) | frame-level driver model = game pointers for 20/20 songs (600 frames) and song 3 over 3,000 frames |

| Data package (`export-all`) | done (1.29.0) | ffl3/data/ (253 files, local), reproduced byte for byte by the tests |

## Port P0–P5 (Legend III import target)

| Phase | Status | Evidence |
|---|---|---|
| P0 importer | done (1.30.0) | `@ffl3k/importer` = the Python data package for every record, script, layout, patch list and music stream, and the graphics/map-buffer hashes (`tools/ffl3/golden_export.py`); `importFfl3Rom` hash gate (verified / labelled unverified), 16 bank segments; golden test skipped without the ROM |
| P1 vertical slice | in progress (1.31.0: first checkpoint) | `@ffl3k/core` runtime (frame clock, interrupts, VRAM bracket, bank stack, copies, decompressor, fades), title 01:7C79, menu input 00:1E51 + key repeat, text 00:3211 (literal runs, line at once, newline), party sprites; `@ffl3k/parity` replay: title1 373/373 waits, title2 313/313 waits identical (2 traces, 743 frames: 15 busy-frame tears and 1 late-object frame each) |
| P2-P5 | not started | |

## Log

- 2026-10-13 (1.21.0): course started; M1 complete (see above).
- 2026-10-13 (1.22.0): M2a — item/spell/skill names and tables; tests/ffl3 28 passed (5 emulator).
- 2026-10-13 (1.31.0): P1 first checkpoint — the title frame-exact (2 traces).
- 2026-10-13 (1.30.0): P0 — `@ffl3k/importer` golden-equal to the Python reference; map 11 patch overflow found and verified; tests/ffl3 63 passed (20 emulator; the 1.28.0/1.29.0 lines overstated by one each: 1.29.0 was 61 / 19).
- 2026-10-13 (1.29.0): M7 music and the data package; tests/ffl3 62 passed (21 emulator).
- 2026-10-13 (1.28.0): M6 graphics; tests/ffl3 56 passed (19 emulator).
- 2026-10-13 (1.27.0): M5 layouts — decoder equal to the game's tile buffer; tests/ffl3 48 passed (12 emulator).
- 2026-10-13 (1.26.0): M5 first part — maps, objects, doors, warps, shops; tests/ffl3 45 passed (11 emulator).
- 2026-10-13 (1.25.0): M4 — encounters and EXP corrected; talon.state; tests/ffl3 41 passed (10 emulator).
- 2026-10-13 (1.24.0): M3 — text; tests/ffl3 37 passed (8 emulator).
- 2026-10-13 (1.23.0): M2b — field and menu states; armor through the Equip menu; stat names, MP, EXP; tests/ffl3 30 passed (7 emulator).
