# Findings

Dated evidence log. Include failed hypotheses.

## 2026-10-11 — Input ROM identity (verified)

Source: `Final Fantasy Legend II.gb` extracted from the original archive
(kept in `.private/`), staged as `input/original.gb`.

| Field | Value |
|---|---|
| Size | 262144 bytes |
| SHA-256 | `ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e` |
| MD5 | `4052912f83ddc2722dbc5409907ad8fa` |
| Title (0x134) | `SAGA2` |
| CGB flag (0x143) | 0x00 (DMG) |
| SGB flag (0x146) | 0x00 |
| Cartridge type (0x147) | 0x03 — MBC1 + RAM + Battery |
| ROM size (0x148) | 0x03 — 256 KiB |
| RAM size (0x149) | 0x02 — 8 KiB |
| Destination (0x14A) | 0x01 — non-Japanese |
| Old licensee (0x14B) | 0xC3 (Square) |
| Version (0x14C) | 0 |
| Header checksum (0x14D) | 0xCD — valid |
| Global checksum (0x14E–F) | 0xD970 — valid |

Matches the expected USA release (SAGA2, MBC1+RAM+Battery, 256 KiB / 8 KiB).
Method: Python parse of the header bytes; checksums recomputed per Pan Docs.

## 2026-10-11 — Exploratory disassembly round-trip (verified)

mgbdis (commit 95d951a) → `build/analysis/disasm/`; `make` with RGBDS 1.0.4 on macOS
rebuilds `game.gb` with SHA-256 identical to the input. The disassembly is exploratory
(auto-labels only), not a matching decompilation project.

## 2026-10-11 — Text encoding for names (verified)

- Relative search for "HUMAN"/"MUTANT" (uppercase) found nothing; lowercase "uman",
  "utant", "obot" hit at 0x3F641/0x3F651/0x3F661 with `a = 0xD4`.
- Dump at 0x3F640: `C1 E8 E0 D4 E1` = "Human" → uppercase `A = 0xBA`, padding 0xFF.
- Decoder: `tools/textdec.py` / `src/ffl2kster/text.py`.

## 2026-10-11 — Name tables (verified / probable)

- 8-byte fixed names. Party-creation list at 0x3F640 ("Human  M" … "Imp") matches the
  on-screen selection list (screenshot `party_creation.state`).
- Monster names 0x3EEC0 ("Fungus") … 0x3F6B8 ("Arsenal"): 256 entries in families of 5.
- Item/ability names begin at 0x3E640 ("Hammer").

## 2026-10-11 — Locating the stats table: two failed framings, then code evidence

1. **Hypothesis (failed):** `tools/family_scan.py` looked for byte columns that rise inside
   every 5-member family. Best hit: stride 10 at 0x370B0, scoring 120/120. I first aligned
   record 0 there with "Fungus". Decoding the pointer field's ability lists showed this was
   wrong by 30 records (a Fungus-family pattern sat 30 records earlier). Any 5-aligned shift
   scores the same, so the scan alone could not fix the alignment.
2. **Hypothesis (failed):** table starts 0x36F84 with layout [4 stats, ptr, b6, b7, v16].
   The ability lists then decoded perfectly by name (Slime→Dissolve, Spider→Tusk/Poison/Cobweb,
   Toad→Tongue), but the 16-bit "v" field showed a sawtooth (…858, **81**, 324…) where the
   5th family member always looked tiny.
3. **Code evidence (verified):** bank 0D routine at `0D:427E` computes `id*10 + $6F80` and reads
   bank 0D bytes in the order [type/count, (skip), HP lo, HP hi, 4 stats, ptr lo, ptr hi] into a
   party slot. So records start at **0x36F80**, six bytes earlier than framing 2. The
   "tiny 5th HP" was the *next* family's first HP. With this framing, byte 0's low nibble + 1
   equals the ability-list length for 247/256 ids, and the table is exactly 256 records,
   ending at 0x3797F where the first ability list (pointer 0x7980) begins.

## 2026-10-11 — Party / guest RAM cross-check (verified)

New game, 4× Human M + guest Mr. S. Party slots at C200 (32 bytes each):
Human M slot: HP 59/59 at C207/C209, stats `06 05 03 03` at C20B = record 240 exactly.
Guest slot C280: HP 185/185, stats 18/15/19/18 = record 225 ("Teacher") exactly.

## 2026-10-11 — Failed attempt: searching enemy RAM in a non-battle state

`battle_jaguar.state` was saved too early (screenshot later showed the world map), so
searches for Jaguar stats/HP in WRAM found nothing and the 185/185 box was misread as an
enemy. It is Mr. S's HP. Lesson: every state is now verified by screenshot, and battles are
detected by a code hook instead of screen heuristics.

## 2026-10-11 — Enemy group block and load routine (verified)

- PyBoy hook on `0D:44F4` (copies name `0F:6EC0+8·id` and record `0D:6F80+10·id` → DE00)
  fires once when a battle loads, with DE = 0xD500.
- 0xD500 after load: `03 03 "Jaguar  " 78 02 2D 00 06 05 03 05 81 00 …` =
  alive/total, name, id 120, type, HP 45, STR/AGL/MANA/DEF, ability 0x81 (Tusk), uses.
- Encounters are deterministic per step count (14 different idle-frame offsets all gave the
  same Jaguar battle at the same step). Fighting through gives Asigaru (180), Spider (45),
  Gang (185); every one matches its record (HP and 4 stats).

## 2026-10-11 — Controlled single-byte changes (verified)

`tools/controlled_change.py`: one byte changed per disposable ROM; same pre-battle state;
full WRAM C000–DFFF diff against the unpatched run. Results (`build/evidence/controlled_change.json`):

| Change | File offset | WRAM differences |
|---|---|---|
| Jaguar HP lo 45→99 | 0x37432 | D50C, per-enemy HP D541/D549/D551, scratch DE02 |
| Jaguar HP hi 0→1 (301) | 0x37433 | D50D, per-enemy HP lo/hi, DE03 |
| Jaguar STR 6→32 | 0x37434 | D50E, DE04 only |
| Jaguar AGL 5→33 | 0x37435 | D50F, DE05 only |
| Jaguar MANA 3→34 | 0x37436 | D510, DE06 only |
| Jaguar DEF 5→35 | 0x37437 | D511, DE07 only |
| Jaguar byte0 0x20→0x21 | 0x37430 | 2nd ability slot filled (D515=0x80 "Nail", next list byte), D849–D84B, DE00 |
| Jaguar byte1 0→5 | 0x37431 | DE01 only (no battle effect observed) |
| Jaguar ptr lo →0x80 | 0x37438 | D512 (first ability), DE08 |
| CONTROL SabreCat (121) HP lo | 0x3743C | **none** |
| CONTROL Nike (119) byte 9 | 0x3742F | **none** |
| Spider HP lo 45→99 | 0x37144 | D50C, D541, DE02 |
| Spider STR 5→48 | 0x37146 | D50E, DE04 only |
| Spider DEF 5→49 | 0x37149 | D511, DE07 only |
| CONTROL P-Spider (46) HP lo | 0x3714E | **none** |

Per-enemy HP is max HP minus a small reduction (45→45/43/43; 99→99/92/92; 301→297/279/277):
the formula is unknown (probable random or position-based).

## 2026-10-11 — Stat names and order (verified)

Initial reading of the status screen (STR 6 / DEF 3 / AGL 5 / MANA 3 vs bytes 6,5,3,3)
was ambiguous (DEF = MANA = 3). RAM experiment: wrote 11/22/33/44 to C20B–C20E → status
screen showed STR 11, AGL 22, MANA 33, DEF 44. Record bytes 4–7 are copied 1:1 into the
party slot by `0D:427E`, so record order is **STR, AGL, MANA, DEF**.

## 2026-10-11 — Proof edit and acceptance (verified)

Edit: enemy 120 (Jaguar) HP 45 → 200 (file 0x37432: 0x2D → 0xC8). Build diff: 0x37432 plus
global checksum bytes 0x14E/0x14F, all with recorded reasons. Same pre-battle state:
original D50C = 45 (per-enemy 45/43/43), patched D50C = 200 (200/180/180); WRAM
differences limited to the HP bytes listed above. After 30 identical A presses, Mr. S's
116-damage Dissolve kills the first Jaguar in the original ("Jaguar fell.") but leaves it at 84 HP
in the patched ROM. Both ROMs cold-boot through the recorded input chain to the same battle.

## 2026-10-11 — Game-mode RAM indicator: three approaches failed (open)

1. Snapshot comparison suggested **C7A9** (field 0 / menu 64 / battle 8). The frame trace
   falsified it: it toggles 0/8 every turn inside battle and reads 8 on the status screen.
2. Frame-sampled disjoint-set search suggested **C7A5** (field 0x50 / menu 0 / battle 0x40).
   Falsified: it stays 0x40 while walking after a battle and 0 while walking after a menu.
   It tracks the last screen layout, not the mode.
3. Systematic search with post-battle and post-menu field frames labelled as field: no byte
   with ≤3 values separates battle from field. Relaxing to ≤16 field values found only a
   counter (C0A9).
Working indicators: battle = execution of `0D:44F4`; field = position responds to D-pad.
Next idea (not tried): trace the main-loop dispatcher / jump-table index in HRAM.

## 2026-10-11 — Navigation notes (for state generation)

First town: DFS explorer (`tools/explore.py`) mapped ~158 tiles. Four position "jumps" were
building interiors. The exit is the east end of the y=19 corridor at (40,19), where a
Mr. S event ("I'd better come with you!") plays before the world map.
