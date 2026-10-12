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

## 2026-10-12 — Item / weapon / armor / ability table (M2)

Locations (code-verified):
- Item record: `01:5DB0` computes `id*8 + 0x6F80` in bank 0C, copies 8 bytes → **0C:6F80**, 256 ids.
- Initial uses: `0D:4335` reads bank 0C at `0x7E80 + id` for every ability slot → **0C:7E80**.
- Price: `01:6678` computes `3*id + 0x7860` in bank 0F, copies 3 bytes (id 0xFF → 0) → **0F:7860**,
  120 entries (ids 0x00–0x77); unrelated data follows.
- Names `0F:6640 + 8*id`; the first byte may be an icon glyph (0xA7 sword, 0xAC armor, ...).

Screen-text reader: tile ids on BG/window equal the text codes (0xF0 '.', 0xF7–0xFE frame),
so battle messages, status screens and dialogue can be read programmatically
(`Emulator.screen_text()`, `battle_events()`).

Controlled experiments (same battle state, A presses only):
| Change | Observation | Conclusion |
|---|---|---|
| Long power (b4) 7→0/1/4/10/14/20/30/50 | AAAA's first hit: none/none/none/35/59/95/155/275 (orig 17) | damage = 6·power − 25 exactly (STR 6, Jaguar DEF 5) |
| party STR 3/6/9/12 (set before battle), power 20 | 35/95/161/219 vs predicted 35/95/155/215 | ≈ power·STR, plus a small STR-dependent random term |
| Jaguar DEF 0/2/5/8/12, power 20 | 120/110/95/80/60 | − 5·DEF exactly |
| AA slot DEF 30 | Jaguar Tusk damage disappears | target DEF applies to enemy attacks too |
| Long b3 0x31→0x14 | every hit "Missed" | b3 selects the action routine (bow routine, accuracy from b5 = 0) |
| Long b0 0xA1→0xB1 / 0xA2 | untargeted "defended" / attack option missing | b0 controls target class |
| Long b5 0x00→0x80 | no change vs Jaguar | consistent with element bit (no weakness) |
| Jaguar STR 6→12 / Tusk power 8→16 | Tusk 39 → 86 / 87 | monster attacks follow the same power·STR rule |

Equipment (unequip via Equip menu, slot DEF byte C20E and stats observed):
- Unequipping Bronze armor: DEF 3 → 0; with armor power patched to 30: 3 → 229 (3−30 wrapped).
  → armor b4 is added/subtracted on equip/unequip; record DEF for Human M already includes it.
- 11 items injected into the armor slot and unequipped: every DEF drop = b4; when `b2 & 0x40`,
  b5 hi nibble selects stats (8 STR, 4 AGL, 2 MANA) and lo nibble is the amount (Giant gloves
  8A → STR+10, Hermes 4A → AGL+10, Hecate 2F → MANA+15, Geta 85 → STR+5, Kimono 45 → AGL+5,
  Battle armor 85 → STR+5, Parasuit CF → STR+15 & AGL+15). `b2 & 0x10` items (Dragon helm/armor,
  Ninja gloves, Arthur) change no stats → b5 there is probably resistances.
- The status screen always shows the slot's stored stats; armor DEF is folded in at equip time.

Open: b1 flags, b6–7 presentation word, price semantics on a shop screen (no shop reached in
the first town's explored area), uses write-back timing (not updated mid-battle).

## 2026-10-12 — Meat transformation (M2b)

- Natural run: party Slime (id 245, a RAM-built monster slot) + Jaguar meat after the first battle
  → "Slime changed to Toad." (id 75). Meat drops are random; the prompt is "Received X's meat /
  Eat! / Cancel".
- RAM: meat source id at **CF10** (setting it to Spider 45 changes the result to Skelton 165);
  the eater id is read from the battle copy of the party at **D00A** (party battle copies at
  D000 + 0x100·n use the enemy-block layout; C204 alone is not used).
- **0D:6B70 + id** (256 bytes): per-monster sprite/family code (five-member families share a code
  0x05–0x28; humans/robots 0; party types 245–247 → 0x0B/0x19/0x24; guests 0x29–0x30). Bank-0
  code uses it to load overworld sprite tiles (bank 03, 0x4000 + code·0x100). **Verified.**
- The eat is executed through the bank-0C script dispatcher (`0D:4361`: index → pointer at
  `0C:4680 + 2·i`, executed by the engine at `0C:4000`); the transformation table is read
  directly in-bank, so the far-read hook did not reveal it.
- Instruction-level read tracing via PyBoy hooks failed: hooks make `tick()` return early, so
  hot loops spin without emulating (documented failed attempt).
- **Exhaustive measurement** (`tools/meat_full.py`): 183 eaters (ids 0–179, 245–247) × 180 meats
  = 32,940 trials at the real "Eat" prompt → `data/meat_transformations.json` (processed data).
  Facts from the table: the result family depends on (eater family, meat family) with a regular
  shifting pattern; the result rank depends on both ranks (≈ the higher level wins); every
  monster 0–179 is reachable; some combinations yield Slime/Baby-D/Imp (245–247).
- Compact models falsified: "level = HP / stat sum / max stat / single stat" with the
  highest-level-not-above rule predicts at most 74%; inferring hidden integer levels with a
  difference-constraint solver hits a contradiction immediately (the meat rank can change the
  result family, e.g. Fungus + MapleMan → Rhino but Fungus + LiveOrk → Thunder).
  Open: locate the in-ROM table/levels (likely bank 0C script data or engine tables).
- Also seen: human growth messages after battles ("AAAA's Max HP gained by 15") — random
  growth is a behavioural system for the later behavioural-spec milestone.

## 2026-10-12 — Text engine, dialogue extraction and reinsertion (M3)

- Text engine `00:070C`: byte ≥ 0x9E prints a glyph; 0x4E–0x9D expands a **dictionary pair at
  `0F:6560 + 2·(b−0x4E)`** (80 pairs, first "e ", then " t", "th", "he", ...); 0x00–0x4D are
  control codes dispatched through the **78-entry jump table `00:13BE`**. `rst $30` (→ 00:0701)
  fetches the next script byte, so argument counts come from counting `rst $30` on each
  handler's path (`tools/sm83dis.py`, `build/evidence/textcode_handlers.txt`).
- Dialogue and event commands share one stream (e.g. ⟨19 d e⟩ script ops, ⟨15 ..⟩, ⟨14 ..⟩).
  Code 0x20 re-dispatches its first argument as a sub-code (handler 00:0FCC jumps into the
  dispatcher) — used for variables: ⟨20 1F 00⟩ = member name, ⟨20 30 00⟩ = number,
  ⟨20 1C 20⟩ = item name.
- Pointer tables: **0A:4000 ×256** (field/town messages), **0B:4000 ×192** (story scripts),
  **0B:6B80 ×109** (battle messages), **0B:7400 ×77** (menu/UI templates, incl. a leftover
  debug menu "Battle No." / "Anim No.").
- Validation: with the refined argument table, 621/630 entries parse exactly to the next
  entry's start (the misses are menu entries that share string tails and one ⟨19⟩ at a
  boundary). Argument counts fixed by evidence: 0x3E = 1 (was 3), 0x3F = 3 (was 4).
- Re-encoding (greedy dictionary pairing): 603/634 entries byte-identical, **634/634 decode
  identically**, never longer than the original (the original compressor was not always greedy).
- Reinsertion verified in the emulator: battle[90] "Right on!" → "Victory!" built as a `text`
  edit (in place, padded with 0x00); after the deterministic Jaguar battle the original shows
  "Right on" and the patched ROM "Victory" (`test_text_reinsertion_visible`).
- Export: `python -m ffl2kster text-export` → `data/text/messages.json` / `.txt` (634 entries,
  214 pure messages that are editable in place).
- Open: names/semantics of most control codes (only arg lengths are evidenced), relocation
  for longer text, story-script decompilation (M5).

## 2026-10-12 — Random encounters (M4)

- Battle init (0D:4000) copies three (count, id) pairs from **CFE0–CFE5** into the enemy groups
  and CFEA → D844. Writers: generator **00:2AE6 / 00:2B14**:
  - zone = map-header byte (00:1CC4: when header byte 1 bit 6 is set, byte 2 → C454, byte 3 → C455);
  - 8 formation bytes per zone at **0D:6570 + 8·zone** (135 zones);
  - slot = first s with rand ≥ threshold[s], thresholds at **0D:6560** = 246, 229, 195, 127, 59,
    25, 8 → slot probabilities 10/17/34/68/68/34/17/8 of 256;
  - formation **0D:6C70 + 5·(b & 0x7F)** = [id1, id2, id3, countA, countB] (128 formations);
    countB is used when the slot byte has bit 7 set;
  - count byte bits 0–4 → pattern **0D:6EF0 + 3·p** (32 patterns; per group a min/max nibble pair),
    bits 6–7 → CFE9.
- The formation is generated one step before the battle triggers (CFE0 fills at step 13 of 14).
- Zone 0 (around the first town) decodes to Asigaru ×1, Spider ×1, Jaguar ×1–4, Gang ×1–4 plus
  rare mixed groups — exactly the battles observed.
- Controlled changes (from the world-map state, same 14 steps): formation 20 id1 → Spider gives
  3 Spiders; its count byte 4 → 2 gives Gang ×1 (group 3 only); count pattern 4 group 1 = 0x55
  gives 5 Jaguars; zone 0 slot 3 → formation 24 gives Zombie ×3 / Pebble ×1 / Snake ×3; patching
  formation 19 or zone 1 changes nothing. **Verified.**
- Drops: after the Asigaru battle the party "Received Long." — Asigaru's ability list holds the
  Long sword, so human enemies appear to drop items from their own lists (probable, one
  observation); meat drops come from monsters (M2b). Drop probabilities not measured.
- Export: `python -m ffl2kster encounters-export` → `data/encounters.json`.

## 2026-10-12 — Maps, warps and triggers (M5, part 1)

- **Decoded map buffer**: D000–DFFF = 64×64 metatile bytes (verified: renders built from the
  buffer + captured VRAM match the on-screen viewport, mean pixel diff 4.7–9.9/255 with sprites).
  Metatile m (0x00–0x3F) = tiles 4m..4m+3 (TL, TR, BL, BR). Map coords = player (C42C+5, C42D+4).
- **Destination records** 07:4000 + 4·i, 511 records → 212 unique map headers (bank 07, from 07:4800).
  Loader 00:1C61 (player X = (b2&0x3F)−5, facing = b2>>6, Y = (b3&0x3F)−4). Warp index from
  C442/C443: i = C442 + 256·((C443&1)^1); 0x1FF = return to saved position (C316–C319);
  C443 = 0x0E → alternate table 07:6F80. Hook on 00:1C61 confirmed record 21 (07:4054) for a door.
- **Map header** (00:1CAF + 00:1CC4): [layout ptr][b2][flags][zone, rate if flags&0x40][L]
  [L × (dest lo, dest hi/flags)]… Buffer value 0x40+k is trigger k. Town: 7 triggers resolve to
  the Mr. S hall (25,21) and four interiors (8,11)/(40,11)/(8,43)/(40,43) — exactly the explorer's
  observed transitions. World header: encounters on, zone 0, rate 0x0A, 14 triggers.
- **Layout source**: layout ptr < 0x4000 → bank 08 at 0x4000+ptr, else bank 09; drawn by a
  command interpreter at 00:2253 (dispatch 00:2263: fill, checkerboard fill, single tile, …).
  Command semantics not yet decoded (needed for a map editor, not for export).
- **Capture method** (`tools/map_capture.py`): the town door's record 07:4054 is replaced in a
  disposable ROM by each map's representative record; walking through loads that map; all 212
  maps captured (header fields, buffer, VRAM, OAM, screenshot). `maps-export` → data/maps/maps.json
  (headers, resolved warps, layouts). Renders: `tools/map_render.py` → build/maps/render/.
- Open: 6-byte records after the trigger list (not the live NPC objects — X values not found in
  WRAM), meaning of bit 7 tiles (5 in the town, at doorsteps), 29 maps with values ≥0x40 beyond
  their trigger count, NPC/chest/event placement, collision table.

## 2026-10-12 — Map objects / NPCs (M5, part 2)

- After the trigger list (end pointer C459): **sprite-graphics list** (parser 00:363F) of up to 6
  ids, FF-terminated unless 6 are listed; id → bank 03 (bit 7 clear, +0x40 page) or bank 04, loaded
  to VRAM 0x8100 + 0x100·k. Then **6-byte object records** (parser 00:3397), FF-terminated:
  `[cond0, cond1, X, Y|flags, message, attr]`
  - cond0 = 0x80 → appears if event flag cond1 passes (00:018C);
  - otherwise progress variable cond0 & 0x1F (00:0192) must lie in [cond1>>4, cond1&0x0F];
  - X → object +0 (attr bit 7 → bit 6), Y&0x3F → +2, message → +9, attr&0x0F → +0x0A (movement),
    (attr>>4)&7 → sprite slot. Live object table: **C600 + 16·k**.
- Controlled changes on the first town (reload by leaving a house): message byte 08→0B changes
  object +9 only; X 21→25 changes object +0 only; cond1 0F→22 removes that NPC (later objects shift
  up). **Verified** for these fields. Town NPC 5 = Mr. S at the exit (40,23), progress var 0 = 2 only —
  the event seen during state generation.
- 1,261 object records across 212 maps. Records `80 ff.. .. ff f9` style (flag condition, message
  0xFF, slot 7) are probably invisible objects such as treasure chests or step events (hypothesis).
- Messages index the field text/script table (0A:4000); e.g. town NPC messages 8–11 are
  "Good luck…", "There is a cave up north.", "Going to look for your father?…", "Somethin's going on…".

## 2026-10-12 — Text phrase tables and control-code fixes (M3 follow-up)

- **0x4B n** (handler 00:0C21 → 0B66/0679/050B, then 00:11A1): sets bit n of the 256-bit
  "memo" field at **C31D** and prints phrase n from **0F:4270** (index = arg; the handler computes
  0x4270 + 32·hi + 2·lo). **0x40 n** clears bit n (00:0B5B); **0x18 n** sets it silently (00:0B50).
  **0x41 n** lists the learned phrases of topic n (16 topic names at **0F:4250**: MAGI, Ancients,
  Central Shrine, …); the menu text "Memo" sits beside the debug strings, so this looks like an
  unused/debug feature. Verified example: Isis "I am⟨4B 10⟩." → phrase 0x10 " one of the ancient gods".
- Argument counts corrected **from handler code**: 0x12/0x13 take 1 (read via 00:0B46), 0x18/0x40/
  0x4B take 1, 0x3E takes 0 and 0x3F takes 2 (both far-call bank 01 after reading in bank 0).
  `tools/text_validate.py`: 880/900 entries decode exactly to their region end on an end code;
  all 20 misfits are menu-table layout entries. Export adds `display` (phrases inlined); 906 entries.

## 2026-10-12 — Calc VM: battle flow, rewards, growth, meat (M4/M2b completion)

- Interpreter **0C:4000**, 11 scripts at **0C:4680**, called in order from the battle flow
  (0D:40E2…434B); effect handlers via **0C:53E1** (battle, 50) / **0C:5445** (field, 10). Full
  semantics and rules: docs/BATTLE_RULES.md. Disassembler `ffl2kster.calcvm`; listing and decoded
  tables exported by `ffl2kster rules-export` → data/battle/.
- **RNG 00:043E**: stream counter C0A0+n, table 0F:4000, result min + T mod (max−min+1).
- **Verified:** meat formula (32,940/32,940 measured results reproduced), GP/drop byte 0C:7C50
  (4 controlled changes), HP growth chance pair 0C:7F92 (2 controlled changes), GP 33 = (3+30)·1.
- **Probable (decoded, not yet exercised):** surprise/first strike, run, enemy AI selection,
  turn order, confusion, poison, regeneration, stat growth, mutant abilities.
- Drop mechanism closes the M4 "drops" gap; the meat formula replaces the measured table as the
  primary rule (the table stays as test evidence).

## 2026-10-12 — Events, shops, chests (M5 completion)

- Triggers, objects and script op 0x19 share one event dispatcher (00:3924): kind/arg table in
  docs/EVENTS.md. The object nibble previously called "movement" is the **event kind**; kind 1 =
  field message (consistent with the verified message-byte change), kind 0 = story script.
  Header triggers with b1 = 0/1 are **scripts**, not warps (correction to M5 part 1; warps are
  b1 = 5/6/0C/0D/0E).
- Shops: object kind 4, inventories 0F:79E0 + 8·shop (24 shops; 0xFF = inn) — verified by controlled change (trigger → shop n, C71D stock = row n). Chest kind 9 and song kind 7 likewise verified.
- Chests: kinds 9/0B (item, default uses 0C:7E80) and 0A (MAGI): 230 placements — probable.
- `rst $20` DE mapping corrected: d = 0 → story[e] (bank 0B), d ≥ 1 → field[(d−1)·256+e] (bank 0A),
  battle → battle[D90C].

## 2026-10-12 — Music sequence format (M7)

- Sequence format, command set and timing fully decoded (docs/MUSIC.md). All 19 songs parse; the
  loop periods predicted from the decode equal the driver's observed periods frame-exactly
  (songs 2 and 7). Export: 19 MIDI files + songs.json (`music-export`).
- Map music is set by event kind 7 (`sound`) from triggers/objects/scripts (docs/EVENTS.md).
