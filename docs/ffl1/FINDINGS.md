# Legend I findings (dated, including failed hypotheses)

Evidence log for docs/ffl1/ROM_MAP.md. Newest last. Commands are reproducible from the
committed tools with your own ROM at `ffl1/input/original.gb`.

## 2026-10-12 — Identity and no-op build

- `python -m ffl1kster info --project ffl1/project/project.json`: SAGA, **MBC2+BATTERY**, 128 KiB,
  RAM code 0, header 0xFF / global 0xBE66 valid, logo OK, matches the project.
- `python -m ffl1kster build` with no edits: 0 changed bytes; `cmp` input vs output identical;
  diff report `changes: []`.
- mgbdis disassembly (`ffl1/build/analysis/disasm`) rebuilds byte-identical with RGBDS 1.0.4.

## 2026-10-12 — Dynamic test points

- Boot: title by frame 240 (`START` / `CONTINUE`). START runs an intro text that cannot be skipped
  (~3,000 frames), then the hero type list (HUMAN M/F, MUTANT M/F, CLIPPER, REDBULL, WERERAT,
  ZOMBIE), a name entry (A adds a letter, B deletes, START confirms; 4 letters max), and the game
  starts in the first town with **one** hero (Legend II creates the party up front).
- Field position: CCC9 (x) / CCC8 (y) step by one per D-pad step (right ×2, left, up ×3 test).
  Probable: not yet checked against a warp or map change.
- Battle indicator for automation: the window is shown (WY < 144) and the enemy loader 06:5713
  runs; a PyBoy hook on 06:5713 does not change the run (same 68-step encounter with and without).
- `python -m ffl1kster make-states` regenerates title / party_creation / first_town / world /
  pre_battle / battle from a cold boot; screenshots of each were inspected.

## 2026-10-12 — Monster record format

Framings tried and falsified first:
1. *"The enemy name is copied into WRAM, as in Legend II."* A search of WRAM in battle for the
   encoded `ASIGARU` finds nothing. The battle window reads the ROM name table directly (a
   controlled change of `05:4000 + 8×155` changes the displayed name; test_name_table_drives_battle_name).
2. *"Enemy HP is a big-endian word at D082/D083"* (first reading of a −10 damage diff). Falsified by
   the HP-class controlled change: HP 769 appears as D083 = 0x01, D084 = 0x03, i.e. **little-endian
   at D083/D084** (max HP at D085/D086).
3. *"The first encounter comes from area 7"* (a guess from the table's opening records). The area
   index at the encounter frame is FFBD = 0x13; area 19's record `42 60 9B 02 06` gives formation 2
   (one of group 3 = 0x9B ASIGARU), and its alternate formation 6 (1–3 SKELETON) is exactly what a
   perturbed run produced.
4. *Legend II's stat order (Str, Agl, Mana, Def).* Falsified: Legend I stores Str, Def, Agl, Mana
   (CLIPPER status screen below).

Method notes:
- Finding the loader: binary search over frames from the world state gave the frame where D09F
  (combatant 4's id byte) becomes 0x9B; PyBoy hooks on code labels then showed the last label
  before the write. Hooking **every** mgbdis label in bank 06 changed the run (PyBoy's breakpoint
  opcodes are visible to data reads, and bank 06 holds data tables); hooking only `Call_` entries
  (real function starts) left the run unchanged and pointed at 06:5713.
- Code 06:5713 (read by hand): BC = 0x6AE8 + 9×id (id×8 via 06:5C22, plus id); HL = slot base from
  D3E7 (slot 4 = D080). Copies b0 → +0, id → +1F, nibble table (06:71F0) → +1, 0 → +2,
  HP(b1) → +3..+6, b2..b5 → +7..+0A, then (b0>>3 & 7) + 1 ability ids from the pointer b7/b8 →
  +0E.., their uses (item field 3) → +16.., OR of ability attributes → +0B/+0C, and
  [+0D] = byte at +0D + (b6>>4).
- Code 06:57FA: base = word at 06:7254 + 2×b1; HP = base − rand(0..base>>4) (00:016B random range).

Controlled changes (`python tools/ffl1/controlled_change.py`, WRAM C000–DFFF diffed against the
unpatched run from the same pre-battle state):

| Change | WRAM difference |
|---|---|
| ASIGARU b2 5→0x11 / b3 6→0x22 / b4 8→0x33 / b5 3→0x44 | D087 / D088 / D089 / D08A only |
| ASIGARU b1 0→3 (base 82) | D083, D085: 19→79 (82 − 3) |
| ASIGARU b1 0→0x15 (base 795) | D083..D086: 19→769 (795 − 26) |
| ASIGARU b0 0x00→0x08 | D080, D08F (2nd ability 0x24), D097 (its uses), D08D |
| ASIGARU b6 0xA1→0x11 | D08D = 0x24 (first ability) only |
| ASIGARU b7/b8 7625→7321 | D08E = 0x95 (FLY's first ability), D096 its uses |
| CONTROL GANG (154) / SAMURAI (156) all nine bytes 0x77 | none |
| Area 19 byte 2 0x9B→0x60 | battle loads SKELETON (96) through the same path |
| …then SKELETON b2→0x55 / b1→5 (base 126) | D087 only / D083, D085 → 122 (126 − 4) |
| …then CONTROL BEHOLDER (95) / RED BONE (97) all 0x77 | none |

Stat meaning on the record itself: a hero created as CLIPPER (party creation copies record 18 into
the party record) shows Str 4, Def 9, Agl 7, Mana 6 on the status screen; with b2..b5 of record 18
changed to 0x11/0x22/0x33/0x44 it shows 17/34/51/68.

Table extent: 200 × 9 bytes end exactly at 06:71F0 (the nibble table, 100 bytes), followed by the
HP classes at 06:7254 and the formations at 06:72C4; the ability lists start at 06:7321 and are
contiguous for all 199 consecutive pairs (pointer + count = next pointer). Ids 200+ in the name
table are items, which the monster table does not cover.

Still open (hypothesis): b0 bits 6–7 and 0–2, b6 low nibble (often 11 − high nibble), the
meaning of combatant +0D, the nibble table.

## 2026-10-12 — Milestone-1 acceptance

Proof edit: monster 155 (ASIGARU) `hp_class` 0 → 21 (base 20 → 795). Build diff: 2 bytes — 0x1B05C 00→15 and
the global checksum low byte 0x14F 66→7B — both reasoned; the database build is identical. PyBoy, same pre-battle state: both ROMs load the battle
with one ASIGARU; WRAM differs only at D083..D086 (19 vs 769). After 50 identical A presses the
original's ASIGARU fell and the game is back on the field; the patched ASIGARU has 749 HP and the
battle continues. Screenshots in `ffl1/build/test-artifacts/`.
