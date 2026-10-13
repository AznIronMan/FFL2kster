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
- [ ] A2. Tables evidenced to the milestone-1 standard — M1 done; M2–M7 open
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
| M2 items/abilities, growth | M2a (1.22.0) and M2b (1.23.0) done; item use and spells in the field wait for shops (M5); level-up open | names (00:1E8F), five record tables in bank 09 (09:5D87), 17/17 controlled changes (loads, boundaries, controls, power → damage); armor via the Equip menu 11/11 (every nibble named from the status screen); stats = Attack/Defence/Agility/Magic, value 2 = MP; EXP = mean of class byte 1, 9/9 |
| M3 text | done (1.24.0) | one script interpreter, 80-entry dictionary, 1,639 scripts in 7 spans, all references/pointers on script starts, byte and semantic round trips 1,639/1,639, reinsertion visible in PyBoy; `text-export` |
| M4 encounters/drops | open | — |
| M5 maps/events | open | — |
| M6 graphics | open | — |
| M7 music | open | — |

## Port P0–P5 (Legend III import target)

Not started.

## Log

- 2026-10-13 (1.21.0): course started; M1 complete (see above).
- 2026-10-13 (1.22.0): M2a — item/spell/skill names and tables; tests/ffl3 28 passed (5 emulator).
- 2026-10-13 (1.24.0): M3 — text; tests/ffl3 37 passed (8 emulator).
- 2026-10-13 (1.23.0): M2b — field and menu states; armor through the Equip menu; stat names, MP, EXP; tests/ffl3 30 passed (7 emulator).
