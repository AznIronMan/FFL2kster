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

## Port P1 — Vertical slice (2026-10-12)

| Item | Result | Evidence (PyBoy ground truth unless noted) |
|---|---|---|
| Engine runtime (frame model, interrupts, joypad, banks) | done | all traces below, wait-for-wait |
| Field: walking, NPCs, collision, doors, map loads | done | walk1 204 waits, door1 310 |
| Text/script interpreter (78 control codes, windows) | done | talk1 452 waits; field-menu traces |
| Title, new game intro, class choice, name entry, save slots | done | title1 481 waits (boot → field) |
| Save and load (battery RAM) | done | fm_menu_save (battery RAM equal), ld_continue (soft reset → Continue → slot 0 → field) |
| Start/Select menus, shops, inns, field item use | done | 17 fm_* traces, 8,071 waits; party block and battery RAM equal at the end |
| Encounters and formation setup | done | bt_field (world map → encounter → battle), 00:2AE6/2B14 oracle 46 cases |
| Battle loop, calc-VM actions, rewards, meat, growth, defeat | done | 6 bt_* battle traces, 8,590 waits, machine equal at the return; routine oracle 3,879 cases |
| Battle display and animations (0F:6080, 0D:5000) | done | 164 routine traces (~7.3k waits), 1,352 oracle snapshots |
| Battle menus (bank 1) | done | 8 bm_* traces, 1,623 waits, oracle for the tile animations |
| Sound driver (bank 0E) | done | 80,581 driver calls: RAM and APU write sequence identical (all songs, all 57 SFX) |
| APU synth | done | vs PyBoy audio: loudness correlation ≥ 0.977, spectral cosine ≥ 0.916 on all songs/SFX |
| Web build | done | builds; plays title, intro and story in the desktop browser pane; no ROM data in dist |

Tests: TypeScript 4,277 passed (7 skipped: diagnostics); Python 75 passed. Not covered by a trace:
the Memo screen (the original corrupts RAM when it is opened from the test states), field item
outcomes CFF4 = 6/7/>8, healing by text code 0x3F, the ending animation, confusion (VM script 4).
Safari and Firefox were not tested from here (Chromium-based pane only).

## Port P2 — Full field (2026-10-12)

| Item | Result | Evidence (PyBoy ground truth) |
|---|---|---|
| All 511 warp destinations (all 212 maps) | parity | sw_m_* traces: warp in, walk four directions |
| All event scripts (story 0-191, field messages) | parity | 482 sw_s_* traces |
| Both sides of every script condition | parity | 148 sw_b_* traces (vars, items, MAGI, C2A1, song, yes/no) |
| Every placed script on its own map, condition met | parity | 266 sw_c_* traces (6 maps' states not reachable from the first town by warp) |
| Shops, inns, chests, MAGI, sound, return/alternate warps, specials | parity | 211 sw_e_* traces |
| Story battles with a strong party | parity | 16 sw_k_* traces |
| Ending → reset → new game → opening | parity | sw_x_ending, 26,400 frames |
| Vehicles (board/dismount), forced moves, object moves, layer swirl | parity | within the sweeps (F0 05/08-0B, F1-F7) |
| Op coverage | 71/78 text codes, 42/55 field events ran | tools/sweep_coverage.py; the rest unused by game data or behind original breakage (FINDINGS) |

Fixes found by the sweeps: hidden-layer metatiles, member names 5-9, dec-loop zero counts (delay,
window frame/blit), 8-bit address arithmetic (MAGI pickup, GP slot), ROM table reads past a bank,
layout streams through the CPU view, STAT reads, far-call bookkeeping of 01:5006, swirl pacing,
curtain raster timing. Not reached: boss transformations (battle messages 98-100, code 0x48) and
the end of story 142 (F0 18) — the final bosses need story items; message 75 (code 0x49).

Tests: TypeScript 4,278 passed (dedicated traces); sweeps 1,643 traces passed (run with
SWEEP=sw_); Python 75 passed.
