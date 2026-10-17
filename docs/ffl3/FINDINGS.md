# Legend III findings (dated, including failed hypotheses)

Evidence log for docs/ffl3/ROM_MAP.md. Newest last. Commands are reproducible from the
committed tools with your own ROM at `ffl3/input/original.gb`.

## 2026-10-13 — Identity and no-op build

- `python -m ffl3kster info --project ffl3/project/project.json`: SAGA3, **MBC1+RAM+BATTERY**
  (type 03, as Legend II), 256 KiB, 8 KiB RAM, DMG only; header CC / global E1A6 valid, logo OK;
  SHA-256/SHA-1/MD5 match the No-Intro "Final Fantasy Legend III (USA)" entry.
- `python -m ffl3kster build` with no edits: 0 changed bytes, byte-identical output, empty diff
  report (`tests/ffl3/test_identity.py`).

## 2026-10-13 — Disassembly seed and calling conventions

- `tools/ffl3/disasm.py` (recursive, local output in `ffl3/build/analysis/rd`) follows the two
  interrupt handlers (00:11A2, 00:11E3, installed through the RAM vectors C0B9/C0BC) and decodes
  the inline byte of `rst $18` (far call; table form at 00:3802-3807) and the bank pushed by
  `rst $20`. A hook on 00:38E1 logging A/SP/HL confirmed the bank stack (C0A0, depth C0B0).
- Falsified first: a direct search for the monster-name table address as a 16-bit literal found
  nothing; the address is built from `ld de,$7533` plus id × 8 (00:245F), found by hooking the
  bank push and reading the loader.

## 2026-10-13 — Dynamic test points

- Boot: title at ~frame 90 (cursor on "Continue"); Up + A starts "New Game"; the intro text
  advances on A; four name screens follow (Hero "Arthur", Boy "Curtis", Girl "Gloria", Heroine
  "Sharon"; Start accepts the default). A Start pressed during the screen change is dropped, so
  `states.py` waits for each label first.
- About 50 frames after the last name, the prologue "Simulator" battle loads: groups CC59-CC5B =
  46 4B FF (Diviner, Sprite), counts CC36-CC38 = 02 02 00; the loader 0B:4526 runs twice.
- `python -m ffl3kster make-states` writes title / name_entry / pre_battle (after the last Start,
  before the loader) / battle (Fight/Run/Auto menu) and states.json. Run twice: identical frames
  (pre_battle 3875, loads 3923, battle 4050).

## 2026-10-13 — Monster tables

Code (bank 0B): the loader computes 0x4A19 + 12·id (00:1C7E) and copies, in order: b0 & 7 → +0D;
b1 + (b2 & 0F)<<8 → +10/+11 (HP) and, through 45AB, +12/+13 (× 16 for ids ≥ BB); b3 + (b4 & 0F)<<8
→ +14..+17 likewise; b5-b8 → +18..+1B and again → +70..+73 (`push hl` / `pop hl` around the first
copy); b9-b11 → +3D..+3F; 0B:469D[(b2>>4)·4] → +59..+5C; 0B:46DD[(b4>>4)·3] → +5D..+5F. The name
(0E:7533 + 8·id) goes to +05 first. 0B:45CB then reads 0B:533D + 9·id (mask, 8 ids) and 0B:470D +
4·id (level and three bytes).

Layout: 470D + 4·195 = 4A19, 4A19 + 12·195 = 533D, 533D + 9·195 = 5A18: three contiguous tables
of 195 records; the name table has 195 names (Fungus … Xagor) followed by the staff credits.
Eight zero bytes precede 470D (after the 46DD entries).

Controlled changes (`python tools/ffl3/controlled_change.py`, 28/28 pass). Each case patches a
ROM copy, replays pre_battle.state to the battle menu and compares all of WRAM C000-DFFF with the
unpatched run; a pass means the enemy entities differ exactly at the predicted offsets/values
and nowhere else:
- Sprite (0x4B, entities 2-3): b1 2D→7F (HP 127), b2 C0→C3 (HP 0x32D; CC73 also changes, the
  loader's copy of b2), b2 C0→10 (469D entry 1 at +59), b3 31→55 and b4 F0→F2 (+14..+17), b4
  F0→30 (46DD entry 3 at +5D), b5-b8 (+18..+1B and +70..+73; b7 also +57), b0 03→05 (+0D only).
- Boundaries: Sprite and Diviner (0x46, entities 0-1) first byte (b0) and last byte (b11).
- **Falsified on the way:** "b9-b11 always reach +3D..+3F." With kind 3 (Diviner, Sprite) the
  change is invisible: 0B:728B → 7422 clears +3D..+3F and rebuilds them from the entity's item
  list at +41 (empty for monsters) unless +0D & 7 == 4. Sprite b0 03→04 keeps 02 09 05; with kind
  4, b9-b11 → 5A 6B 7C and Diviner b11 → 66 arrive. Kind 4 = ids 00-3B and B4-C2 (74 records).
- Class record: Sprite 470D b0 C1→C5 sets +03 = 5, +57, and three battle values C996/C9D4/C9ED
  (1→3, 4→12, 1→3); C1→41 sets +0F/+68 = 1; b1-b3 → +65..+67.
- Ability list: Sprite slot 1 1A→1B (mask bit set) → +48 only.
- Name: Sprite → "Spritz" changes +0A only (the differing letter).
- Neighbour controls: records 0x45, 0x47, 0x4A, 0x4C with all 12 + 4 + 9 bytes = 0x77: no WRAM
  difference.
- RAM poke of the loader id at 0B:4526 (group 1): 0xBB (Maitreya, record HP 375) loads 6000 = 375
  × 16; 0xBA (Chaos, 4000) loads 4000. Both kind 4, b9-b11 kept. Both lose 20 of value 2 (+14)
  before the menu, one entity only; +16 keeps the record value.

Not yet known (hypotheses in the schema): what value 2 is (MP fits the 20-point drop), the order
of the four stats, what kind and the class bits mean, the 469D/46DD profiles, the mask-clear
ability path (D6C0 / 0B:6E74).

## 2026-10-13 — Milestone-1 acceptance

Proof edit (project.json): monster 0x4B `hp` 45 → 900 (bytes 0B:4D9E-4D9F 2D C0 → 84 C3, b2's
high nibble kept). `tests/ffl3/test_acceptance_emu.py`: from the same pre_battle.state the
original loads four enemies at 45 HP; the patched ROM loads the Sprites at 900 and WRAM differs
in exactly the Sprite HP bytes (entities 2-3 +10..+13, staging D690-D693) and CC73. Pressing A
115 times: in the original the first Sprite falls (press 91); in the patched game the Sprites
keep 900 HP, Curtis falls at press 92 and the Simulator battle ends early into Myron's dialogue.
Screenshots in `ffl3/build/test-artifacts/`.

## 2026-10-13 — Items, spells and monster skills (M2a)

Names first. A search for the weapon names seen in the prologue battle ("Long", "Bronze",
"Battle", "Dive") found two lists. 0E:6D4F-6EBA holds 6 race names (Robot … Mutant), 10 status
names of 4 letters (Good, Fell, Ston, Mute, Dark, Pois, Curs, Para, Slep, Conf) and 48 spell names
of icon + 5 letters; 0E:6EBB-7532 holds 207 names of icon + 7 letters, ending where the monster
names start. Code 00:1E8F confirms the split: id ≥ 30 → 0E:6EBB + 8·(id − 30), id < 30 → 0E:6D9B
+ 6·id, FF → a blank. 09:67BF holds 8 stat words of 7 letters (Attack … M.Evade), then 110+ monster
skill names of 8 letters from 09:67F7 (Nail … Counter, then resist/weak entries with an icon).

Records: the loader 09:5D87 (id in CE26) dispatches on the id: < 30 → 09:5A50 + 6·id; < 78 →
09:55C4 + 7·(id − 30); < C0 → 09:5BFC + 5·(id − 78), then reloads the id in byte 3 (09:5E1F); ≥ C0
→ 09:5B70 + 5·(id − C0) (below D8, or below CB / D1 with CD37 set). With CE25 ≠ 0 it reads
09:57BC + 6·id instead (monster skills, ids < 6E; 0B:73A2/73B1 set CE25 = 1). It always copies 7
bytes to CEDB (00:1F81). The multipliers are 00:2448 (× 6), 2453 (× 7), 243D (× 5). The five tables
are contiguous in the order weapon, skill, spell, item, armor (55C4, 57BC, 5A50, 5B70, 5BFC, end
5D64), bounded by code (`ret` at 55C3, `xor a` at 5D64).

Falsified first: "the Sprite's ability 1A is a spell id." Spell 1A is Lit 2; the battle text says
the Sprite used Dive, which is monster skill 1A (09:67F7 + 8·1A), a different id space selected by
CE25.

Emulator (`python tools/ffl3/item_change.py`, 17/17; hook on 09:5D82 after the loader):
- From battle.state, 60 presses of A load exactly six records: weapons 30 Long (Arthur), 46 Battle
  (Myron), 4B Battle (Curtis), 51 Bronze (Gloria) and skills 13 Kick (Diviner) and 1A Dive
  (Sprite). Each load equals the ROM record.
- Boundaries: Long and Battle(4B) b0 and b6 (first and last bytes) appear at CEDB+0 / +6 only;
  Bronze b3 at +3; Dive and Kick b0 and b5 (first and last) at +0 / +5. The next skill's b0
  appears at CEDB+6 of a skill load (7 bytes copied from a 6-byte table): skill 1B b0 shows in
  Dive's load, 14 b0 in Kick's, while their b1-b5 do not.
- Controls: weapons 31, 4A, 4C, 50, 52 and skills 12, 19 (all bytes 0x77) change no load.
- Power (byte 1): Long 0A → 01 lowers Arthur's hit on the second Diviner from 20 to 18 (press 70);
  Battle(4B) 07 → 60 makes Curtis's hit fatal (press 45; the original leaves 31 HP); Bronze(51)
  06 → 60 makes Gloria's hit fatal (press 54; original 20 left); skill Dive 08 → 20 kills Gloria
  (press 28; the original takes 5). Myron's Battle (46) 14 → 01 changes nothing: his hit kills
  a Diviner either way (overkill), so it is not a test of that record.

Patterns (probable, not tested in the game): byte 0 of spells/weapons/armor/items = element
group << 4 | status in the status-name order (status cures Soft 02 … Calm 09 match Ston … Conf
one for one); byte 1 of spells and items rises with the tier (Cure1/2/3, Fire1/2/X). Armor bytes
1 and 2 are nibbles summed into a character's +3D..+3F by 0B:7422 (code); party totals live in the
party records, so a test needs an equip change in the menu (M2b).

RAM seen on the way: party records at C500 + 0x60·k (Arthur, Curtis, Gloria, Myron, Sharon: name
at +07, HP +10/+12, value 2 +14/+16, stats +18, equipment ids from +40); the battle copies them
to D000 + 0x80·k. The battle status shows value 2 under the HP (Arthur 5, Curtis 45): MP remains
the likely reading.

## 2026-10-13 — Equipment, status words, MP and EXP (M2b)

States: `make-states` now also writes field.state (after the battle and 1,000 presses of A
through the intro scenes: the Talon hangar, free to move) and menu.state (Start: Item, Magic,
Talent, Status, Equip, Auto, Save).

Status screen (Arthur, L1): "Attack 6 / Defence 7 / Agility 4 / Magic 5" = party record +18..+1B
(06 07 04 05), and "H… 50/50 M… 5/5" = +10/+12 and +14/+16. The battle entities use the same
layout, so the monster record's b5-b8 are Attack, Defence, Agility, Magic and its second 12-bit
value is **MP**. The party list in the Magic menu shows the MP of all five (5, 45, 50, 5, 120).

Equip (`python tools/ffl3/equip_change.py`, 11/11). The Equip screen has eight slots in the
order of the record's +40..+47: weapon, shield, helm, armor, gloves, shoes, others, others; the
armor name icons A1-A6 are the slots. With one Bronze body armor (91) poked into the inventory
(C705/C706, after the Radar at C703; the list keeps a blank row between entries), picking it
swaps out Leather (90): Defence 7 → 8 and +3C..+3F 02 02 02 02 → 03 03 02 03. Then:
- Bronze b1 32 → 41: Defence 9 and M.Def. 1 on the status screen (+19, +3C, +3E); b2 33 → 23:
  Evade 2 (+3D); b2 33 → 35: M.Evade 5 (+3F). So b1 = Defence | M.Def., b2 = Evade | M.Evade
  (high | low nibble). The code read (0B:7422, "+3D += b2>>4, +3E += b1&0F, +3F += b2&0F") agrees.
- b0 00 → 40 sets +36/+39 = 0x10; 00 → 05 sets +37/+3A = 0x08 (element and status resistances).
- b4 03 → 07: +2D 3 → 7 and the u16 at +28 30 → 70 (sum and 10 × sum over the equipment).
- b3 FF → 12: no change on equip.
- The removed Leather's *current* record is subtracted: Leather b1 22 → 32 leaves Defence 7
  (3 subtracted where 2 was added), b4 01 → 05 leaves +2D = −1 and +28/+29 = −10.
- Controls: helm 8F and armor 92 (all 0x77) change nothing.
- Falsified on the way: patching an armor record and opening the Status screen changes nothing;
  the totals are stored in the party record and only recomputed by an equip change.

EXP (`python tools/ffl3/exp_change.py`, 9/9): the prologue battle gives 14 EXP. The class
record's byte 1 (Diviner 15, Sprite 14) decides it: 48/14 → 31, 15/48 → 31, 5/14 → 9, 15/5 → 10,
48/48 → 48, i.e. the floor of the mean. With two enemies per group, a mean per enemy and per group
agree; which one the game takes is open. **Falsified:** "EXP follows the level" (levels 1 → 9 for
both: still 14); bytes 2 and 3 have no effect either. Arthur's status after the battle: L1, EXP
14, NEXT 6.

Not done: using an item or casting a spell in the field. The Item list (A picks an item up to move
it; a trash can sits at the right) did not offer a use with A, Start or Select, and the Magic
lists are empty in this state (poking a spell id into the party record at +48 shows nothing);
these wait for a shop state (M5).

## 2026-10-13 — Text (M3)

Finding the interpreter. The dialogue is compressed (a search for "Simulator" finds nothing).
Hooks on every `ld a,[hl+]`/`[de]`/`[bc]` of banks 00/01/03/09 while a line printed showed one
read walking 09:6101-6121: 00:3214, the loop of 00:3211. The disassembler learnt two things on
the way: `ld a,N` + `call $38E1` sets the bank like rst $20, and `call $373A` is followed by a
jump table (coverage 5,600 → 46,000 code bytes).

The interpreter (00:3211): 00 ends; 10 waits for a button and ends; ≥ 88 literal tiles printed as
a run (00:32EA); 4E-87 dictionary entries 0-57; codes 01-04, 0E, 0F, 16-1B, 40-42, 44-4A
dictionary entries 58-79 (lookup list 00:30D1); others through the table 00:3175 (0x4E words).
The dictionary (03:71C5-731B, 80 length-prefixed entries) is copied to CD4D and interpreted
recursively, so entries may hold codes ("{1C}{1F 00}" prints the leader's name). Operand counts
come from the handlers (`ld a,[hl+]`, 00:20DE takes one) and were cross-checked by hooking
00:3214/3224 over 1,000 presses (hl advance per code: 09/0A/0C/0D/12/13/1E/1F/2A/30/32/36/37/38/3B/
3D take 1, 3E takes 2, 06/07/08/0B/14/1C none).

Script references: 3E lo hi (and the two of 3C, the two of 39, the three of 3A) go through
00:2EF6: hi < 40 is a scene change (map hi, entry lo, 0F:7DD4); otherwise a text in bank 09
(hi 40-7F), 0A (80-BF) or 03 (C0-FF). The prologue (Simulator battle, the farewell, the Talon) is
one script, 09:6015, started at power-on when flag 31 is clear (00:023F-0257).

Falsified on the way:
- "A script is ended by 00 only": 168 of 308 bank-0A entry points sat inside the 00-separated
  stream until 10 was also taken as an end (00:321A → 322D → 32B0).
- "Bank 03 text runs up to the dictionary": a 16-byte tile (03:71B5) sits between.
- "09:4F79, 09:507D, 0A:4379 are texts": they were "references" read out of pointer tables that
  had been parsed as text (09:78FE battle messages, 99 pointers; 0A:791E, 8 pointers).

Result (`ffl3kster text-export`, `src/ffl3kster/script_text.py`): seven spans parse exactly to
their ends — 03:6287-71B4, 09:5EAC-67BE, 09:6C5F-78FD, 09:79C4-7FFF, 0A:4000-4003,
0A:41E2-791D, 0A:792E-7FFF — 1,639 scripts (30 + 588 + 1,021). All 243 script references and all
346 pointers (0A:4004 239, 09:78FE 99, 0A:791E 8) land on script starts. Round trips: byte level
1,639/1,639; semantic (render → encode → render) 1,639/1,639; 1,308 re-encode to the same bytes
(the encoder's greedy dictionary choice differs for the rest). Tiles beyond the name set: AC ',',
AD "'", EE/EF quotes, FE period + closing quote in one tile, F5 ○, F6 ×, FD © (font in VRAM).

Reinsertion (`tests/ffl3/test_text_emu.py`): 09:7BFC "{1C}{1F FF} used / {1C}{1E 80} against"
rewritten in place as "swung / at" (padded with spaces to 18 bytes): from battle.state the
screen shows "Myron swung / Battle at" where the original shows "Myron used / Battle against".

Code meanings (probable, from handlers and context): 06 line break, 08 wait for a button, 0C n
wait n frames, 14 clear the box, 1C reset the name position, 1F n a name (00-03 the four heroes,
FF the actor, 10+ other characters), 1E n an item or skill name, 30 n a number, 2A n an item
name, 3E jump/scene, 39 f a b / 3A … branches on story flags (00:3CB2), 3C a yes/no choice,
32/3B/3D n object movement in scenes.

## 2026-10-13 — Encounters and EXP (M4)

Code. Each finished step (01:4609, step counter C6EF) encounters when rand (00:39D5) < CA2B; CA2B
comes from the map record (00:02EA: bits 5-7 → 00:119A = 0, 3, 4, 5, 6, 7, 8, 9) and CA2D, the
zone, from the next byte (maps are M5). The battle (00:10C2) picks the zone (+1/+2 by the vehicle
state C6E3, 00:1186), rolls again and counts the thresholds at 03:76BC (E5 BF 8C 4C 26 0C) that
exceed it: slot 0 for r ≥ E5 … slot 6 for r < 0C. The zone table 03:76C2 has 7 slots × 76 zones
(code follows at 03:78D6). The slot's low 7 bits index the formations at 0B:758B (5 bytes: three
monster ids, CC5C, CC5D; 00:1126); scripted battles use the same table (0B:4094, the prologue is
formation 01). Slot bit 7 takes the counts from CC5D.

Emulator (`python tools/ffl3/encounter_change.py`, 14/14; talon.state, a new state inside the
Talon, with CA2B = FF and CA2D poked since the Talon's own rate is 0): the baseline step picks
formation 00 (Hooligan + F-Drake). Thresholds all 00 → slot 0 (formation 02); thresholds all FF and
slot 6 → 05; zone 0 all slots → 05 (Turtle + Orc-Orc); formation 00's three ids and byte 3 reach
CC59-CC5C; rate 00 gives no battle in 8 steps; zone 1 uses its own slots; zone 1 and formations
01/7E as all-0x77 controls change nothing. Fixed counts (slot bit 7): byte 4 = 00/20/14/04 gives
counts 2-2 / 6-2 / 4-4 / 2-4 for the two-group formation 05 and 15 gives 2-2-2 for the three-group
formation 03, i.e. the 2-bit fields +1, doubled with two groups (why: not read yet). Byte 4 = 34
or 24 (too many enemies) overwrites the group ids.

EXP, corrected. "The floor of the mean" (M2b) fitted only because the prologue has 2 + 2 enemies.
A Talon battle (1 Hooligan, 2 F-Drakes, both byte 1 = 15) gives 11 EXP; Hooligan 48 → 19, F-Drakes
48 → 27, both 48 → 36: EXP = floor(sum of byte 1 over all enemies / 4). All 14 cases of
`tools/ffl3/exp_change.py` fit; the divisor equals the party size in both battles (not separated).
No GP was awarded in either battle (byte 2 and 3 changes have no effect on EXP; GP source open).

## 2026-10-13 — Maps, objects, doors, warps, shops (M5, first part)

Maps. 00:027D loads map C6E8 from 06:6C58 (192 pointers, 171 distinct records, 06:6DD8-7F68
exactly, code at 7F69): a 6-byte header (b0 → CA15/CA6C; b1 → CA1D, the layout index into
03:731C; b2 → CA1E; b3 → CA18, the map mode for the jump table 01:54B1; b4 bits 0-4 → FFBA music,
bits 5-7 → the encounter rate class; b5 → CA2D zone) and 6-byte objects up to FF (b0 story flag,
b1 script index or shop number + 1, b2 x, b3 y, b4 bits 6-7 type: 0 talk, 2 shop; b5 sprite;
00:05CF-066C, 00:098A). 656 objects, 324 of type 0; two type-0 objects carry an index beyond the
239 entries of 0A:4004 (unexplained).

Map changes are script "events" (00:1236, type = CA29 & 3F): types 0D/0E are doors through
06:6BA4 + 3·(n − 1) (map, x, y; 60 doors ending exactly at the map pointer table), types 00/01
position warps through 06:6308 (192 pointers, 4-byte entries: block nibbles, map, x, y), type 16
a shop (CA2F = n − 1, 01:6FD4), type 1B a battle with formation CA28.

Falsified on the way: "the Talon's way out is its first position warp" — patching that entry
changed nothing; a hook on 00:146B showed the door table (06:6BD7 in, 06:6C28 out).

Emulator (`python tools/ffl3/map_change.py`, 8/8; field.state, walking down into the Talon
and out again): Talon header b4/b5 → CA2B = 9 and CA2D = 5; b2 → CA1E only; b3 → CA18 only;
object 0 b1 → C372 only; object 4 y +2 → its position bytes (+32 px); door 12 → 11 takes the
first step into map 11; door 2D → 0A leads out to map 0A; doors 11/13/2C/2E and map 11's header
(all 0x77) change nothing.

Shops (code, probable): shop n < 40 is 6 item ids at 01:7804[n >> 4] + 6·(n & F): weapon shops
00-0E (01:780C), armor 10-1E, items 20-28, magic 30-3E, contiguous to 01:794F; every id in each
group is of that kind (Cure1 … Elixir in shop 20). Prices and the layouts (03:731C) are not
decoded yet; using a shop in the emulator needs a town state.

## 2026-10-13 — Map layouts (M5, second part)

The header byte 0 (low 7 bits, CA15) is the layout data index 1-31 (not the 03:731C index,
which is byte 1). 00:0F42: row width W = 07:7EA0[n], tile count L = word 07:7EC0 + 2n; the data
lives in bank 07 (n < 10, entry n − 1) or 08 (entry n − 10) between consecutive pointers at
B:4000 + 2k; 00:3D76 decompresses it (a block-size byte s, blocks of 4 << (s + 1) bytes, each a
fill byte, an MSB-first bit mask, then the literals for the set bits) and each resulting byte is a
metatile: 4 tiles at B:4022[k] + 4m, written top-left, bottom-left, top-right, bottom-right into
the W-wide buffer at D000. 0B:78F5 then applies flag patches: 47 entries (0B:7982 map id,
0B:79B1 story flag or FF, 0B:79E0 pointer → x, y, one rectangle w << 4 | h and its rows).

Falsified on the way: "a patch is a list of rectangles until 00" — that drew 157 wrong tiles in
the hangar; the code ends after one rectangle (0B:797E falls through to 7980).

Result (`src/ffl3kster/layout.py`): all 31 layouts decompress to exactly L/4 metatiles, the data
spans are contiguous per bank; the decoder equals the game's D000 buffer at all 10 map loads of
the intro (maps 17, 1A, 55, 1A, 16, 02, 0A, 0B, 10, 0B), 1,024-4,096 tiles each, 0 differences
(`tests/ffl3/test_layout_emu.py`).

Patches past the map (found by the TypeScript importer's golden test, 1.30.0): map 11 (layout 5,
32 × 16 tiles) has two flag-30 patches (0B:7AE9, 0B:7C66: x 8 and 22, y 10, 2 × 7) whose last row
is row 16, outside the map. Emulator (door 12 pointed at map 11, flag 30 forced clear / set in
C766): the game writes that row to D208-D209 and D216-D217 (2C 2D) after the 512-byte map only
with the flag set, and D000-D1FF equals the decoder either way. The decoder drops rows past the
buffer; the Python reference had grown its buffer by 4 bytes there (bytearray slice assignment),
which the importer's fixed-size buffer exposed.

## 2026-10-13 — Graphics (M6)

Map tilesets (07:7F5B): the header's layout byte indexes 03:731C (pointers to 6-byte records);
bytes 1-4 name four 512-byte blocks of bank 05 (05:hh00) copied to 9000-97FF (BG tiles 00-7F).
The font and window tiles are 03:4000-47FF → 8800 (07:7F4F). A hook right after the tileset copy
(00:053B) at all 8 map loads of the intro: VRAM equals the four blocks and the font exactly. After
that copy some maps change tiles (01:5501 animates maps 0A/0B; 01:6092/6082 draw the Talon into
the hangar; 07:7FBC map 5D; map 01): the exported hangar shows the base tileset.

Monster pictures (0B:417D): code c = 0B:4301 + id (195 bytes, ending at the size table 0B:43C4);
sheet c >> 3, slot c & 7; 0B:43CC + sheet = bank << 4 | size code; tiles n = 0B:43C4[size]
(16, 32, 32, 48, 62, 124); three pointers at 0B:43E4 + 4·sheet bound two spans in that bank,
each compressed like the layouts; span 1 is bitplane 0 and span 2 bitplane 1 of the sheet's tiles,
and the picture is n tiles from slot·n. First reading "the last n tiles of 96" fitted Diviner and
Sprite but not F-Drake (tiles 32-47); the slot rule fits all six monsters checked in VRAM
(Diviner, Sprite in the prologue; Turtle, F-Drake, Maitreya, Fenrir in forced battles: sizes 0-4).
Xagor's sheet (19) starts with a block-size byte FF: 00:3D76 would loop to a size of 0 and copy
stale C800 RAM, so it is left out (its picture must come from elsewhere). On-screen arrangement by
size: 4, 8, 4, 6, 8, 16 tiles across (probable: the pictures are coherent).

`ffl3kster gfx-export` draws the 171 distinct maps (layout + patches + base tileset), 194 monster
pictures and the font (ffl3/build/gfx, local).

## 2026-10-13 — Music (M7) and the data package

Driver (bank 0F, 0F:4006 from the vblank handler): FFBA ≠ FFBB starts song n (1-20) from 0F:482F
+ 8(n − 1): pointers for pulse 1, pulse 2, wave, noise; tempo CB01 = 3C, accumulator CB00 = FF,
each channel's counter 1 (0F:402D). Every frame CB00 += CB01 and a carry ticks all channels twice
(0F:41CE). At a channel's count 0 it reads: a note (< E0): low nibble → duration from 0F:41BE
(90 60 48 30 24 20 18 12 10 0C 09 08 06 04 03 02 ticks), high nibble the pitch (0-B with the
octave, C rest, D silence); E0-E7 octave, E8-EF octave shift; F0-FE commands through per-channel
tables (0F:4428/4448/4468/4488; operands from the handlers: jump F1, loops F2/F9 on two counters
set by F3/FA, FB compare-and-jump, F7 tempo, FE channel set-up, ...; F8/FD/FF-slot handlers hang,
none is used); FF ends the channel and leaves its stored pointer on the FF.

Falsified on the way: "high nibble = duration" (as in many drivers) — the model drifted from the
game within 4 frames; 0F:4408 takes the low nibble for the duration table and swaps the byte for
the pitch. A second model fix: on FF the game does not store the advanced pointer.

Result (`src/ffl3kster/music.py`): a frame-level model of the driver (tempo accumulator, double
tick, counters, loops) gives the same four channel pointers as the game after every frame for all
20 songs over 600 frames, and for song 3 over 3,000 frames (more than two of its 1,392-frame
periods) — `tests/ffl3/test_music_emu.py`. Channel loops in ticks: the four channels of each song
share a period (e.g. song 1: 1,536 ticks, noise 48); song 7 is a jingle that ends. Timbre
(envelope/wave tables F0/F4/F8) is not modelled.

`ffl3kster export-all` writes the processed package ffl3/data/ (local, gitignored like data/):
monsters, items, encounters, maps, layouts (metatile rows), text, music (JSON) and font,
tilesets and 194 monster pictures (PNG), 253 files, reproduced byte for byte.

## 2026-10-13 — Port P1, first checkpoint: the runtime and the title (1.31.0)

Method (as for Legend I): PyBoy traces (`tools/ffl3/trace_lib.py`, scenarios
`tools/ffl3/traces.py`) record the machine state 8000-FFFF at every frame wait (00:3A77, after
00:3A6D set FF95) and every screen; `@ffl3k/parity` replays them through `@ffl3k/core`. The call
order of a stretch is listed by `tools/ffl3/calltrace.py` (every routine entry with frame and LY).

Runtime model (verified by the replays, see ROM_MAP "Start-up and interrupts"):
- Frame waits: 00:3A6D sets FF95 = n and halts; the vblank handler counts FF95 down; the wait
  ends after the vblank interrupt that reaches 0.
- The VRAM bracket 00:1D9E / 00:1DFD (nested by CDCE) swaps in the vblank handler 00:1EFA and a
  STAT handler 00:1F27 at LYC 3 (the sound driver, then 00:3549 while CD3D is set: the party
  figures every 16 frames), polls STAT for mode 1 with interrupts off and ends with reti, so the
  vblank interrupt is taken at once with the new handler.
- 00:20FF copies 5 bytes per hblank (or in vblank) while LYC - LY >= 3: measured in PyBoy, one
  chunk per visible line from line 6-8 (after the sound handler, 3-21 lines long depending on the
  music) and 9-10 chunks in vblank; a 2 KiB copy spans about 3 frames. This is CPU time: the port
  copies at once and the replay takes the busy frames from the trace.
- The interrupt handlers push and pop ROM banks (00:1F3A every frame): the bank stack slots
  above its depth (C0A0 + C0B0 ..) hold whatever bank was current where the CPU was; they are
  dead (a pop reads only what its push wrote).

Results: `title1` (the title from 01:7C79, 400 frames: pictures, texts, sprites, fade in, idle)
373/373 waits identical; frames: 384 identical, 15 drawn while the original was still copying
(busy frames: every pixel new or old), 1 with the original's previous objects (the cursor
written after that frame's DMA). `title2` (menu: cursor down/up, B, Start, Select, a direction
held for key repeat, Left) 313/313 waits identical, same frame counts. Excluded from the wait
compare: sound driver RAM (not ported), the stack, timing registers, rst $18's scratch FFA1-FFA4,
the dead bank stack slots; CDCF (STAT as read by 00:1D9E) compared without its mode bits.
Falsification: the cursor y 78 -> 79 fails every wait (C080/FE80) and every frame after the fade;
a text line step of 0x20 instead of 0x40 fails at the first wait (9D66.. text tiles). Found on the
way: the PyBoy frame (one `tick`) runs from LY 0 to 153; the fill chain 00:1F50/1F53/1F55 fills
9/6/4 bytes (ROM_MAP had 6/3/2).

## 2026-10-13 — Port P1, second checkpoint: New Game to the prologue's map (1.32.0)

Ported and replayed (`newgame1`: from the title, Down, A on New Game, 1,266 frames): the party
set-up 01:7D40 (copies, window clear 01:7DFD), the prologue text 09:5EAD through the text engine
(dictionary words, control codes 05/06/07/14/3E, scene codes 0B:6C35 -> script reference
00:2EF8), the event dispatcher 00:1236 (door 0D/0E 00:1389 with the return point 00:1B64,
special 12 00:16B9 cases 0-2), the map load 00:027D (layout 00:0F42, patches 01:78F5, tiles
00:0535/0427, objects 00:05BF, leader 00:054D, the view 00:0E34), the text window's slide
00:35AF / 00:35D2 (STAT raster 00:3631 at LYC moving 2 lines a frame) and the field frame work
00:3575 (map animations 01:54A0: mode 22 = water 01:5993, mode 23 = falls 01:5814 with the strip
01:5730; objects 00:01A0). Result: 1,117/1,117 waits identical.

Timing found on the way (PyBoy hooks at 00:1D9E/1DFD/1E35, 00:3557/3552, 00:3A6D; each now
recorded in the traces):
- The bracket's di comes at its entry, before the handler switch and the mode-1 poll; a STAT at
  LYC 3 that arrives during the poll is taken after the vblank, by the handlers installed at the
  entry. Leaving the outer level restores 00:11E3 (reti), so that frame has no frame work: no
  waterfall roll at frame 371 (entry 370/153, poll ended 371/144). Leaving a nested level keeps
  00:1F27, so the frame work runs in vblank (174/147).
- An entry at line 153 polls through the whole next frame (the switch code outlasts the line).
- The frame work 00:3557 (guarded by CDC5) runs up to ~90 lines in the field: its VRAM copies
  (00:20FF) wait for hblank. 01:5730 ends with reti, so a STAT arriving during the rest of the
  work nests and, with CDC5 set, only ticks the sound. A work started in vblank (174/150) ended
  at 175/81: the STAT at 175/3 did not roll the waterfall again (the port without the end time
  rolled twice).
- A long sound tick (a new song or effect) can push the work into the next frame (STAT taken at
  288/147, work 289/3).
- During the slide the main code writes VRAM through lines 0 to ~45-80 of each frame; a 5-byte
  chunk of 00:20FF can leave a tile row half written for one line.

Parity method additions: the replay takes from the trace the frame and line of every bracket
entry (`polls`; the port runs the CPU time before it with the interrupts on, then di, switch,
poll), the end of every frame work (`works`; CDC5 stays set until then, and the interrupts stay
off unless the work enabled them) and the start of every frame wait (`starts`). Screens drawn
while the original was still writing VRAM line by line are counted as line tears: every
differing pixel lies on a line the original's main code ran before its wait / bracket entry in
that frame, or on a line its frame work spanned, and shows an old picture; at most two lines
(16 pixels) may show a half-written tile row (5 of 147 frames in newgame1). Falsification: the
waterfall rolled 1 pixel instead of 2, the strip rotated through the wrong plane, and the work's
end dropped (CDC5 released at once) each fail newgame1.

## 2026-10-13 — Port P1, third checkpoint: the name entry (1.33.0)

Ported and replayed: text codes 08 (wait for A, then the window toggle), 0B (wait for A) and 0C n
(00:2766: n frames, then n more, cut short by A; the prologue ends with 0C 2C); A held makes the
tile-by-tile text one frame a tile (00:3593 checks FF8A bit 0), B held pauses it. After the
prologue (01:7D75): fade out, the window at the top, the letter grid (00:240E: 09:78A0, each of
54 letters after a blank), then the name entry 0F:7A44 for members 0-3 (B on an empty name goes
back a member), then (01:7DAE) member slot 3 from the starting records (0B:6DE4, record 0B:7573[2]),
slot 4 emptied (C683 = FF), a 3-byte value per member at CD9D (0F:79D4: (L + 4)(L + 1)^2 from
the byte C503 + record, 99 -> 0; meaning not checked), the background map 9800 blanked (2 KiB),
WY 50, and the start code's opening script 09:6015 (not yet ported past its first event, type 1B).

The menu boxes (09:4FEF via 00:1E49): descriptors of 7 bytes (x, y, width, height, text pointer,
flags) at C8B0 are drawn row by row into the line buffer C880 (top F7 FC.. F9, sides FB, bottom F8
FC.. FA; below the first box a background of tiles 04 05 / 06 07), each row to 9E40 + 20 r, then
the 18 rows to 9C00 after a frame. Box text alternates a row of control codes only and a row of
letters (code 05 keeps the next row a letter row); codes take no column. Menu codes seen: 00
(end), 06 (rest of the row blank), 1F p (a member's name / an entity's name / the class name
of the record being named: C68D bits 3-6 -> 00:29D7 -> 09:78D7), 43 x y p (member p's 2 x 2
figure at C000 + 16 p). The OAM DMA is held (CD39) while the rows are drawn.

Timing found and now taken from the traces as sync points (the time the CPU reached an
address): 00:1E49 (a menu starts after its set-up copies; the walking-figure work every 16
frames saw the old boxes in between), 09:5014 (the rows drawn: the DMA held until then), 01:7DCA
(after the 2 KiB background fill: WY 50 turns the frame work to the field branch, so writing it
early made an extra strip scroll). The frame work a bracket entry runs itself (00:1E38) now keeps
the code until its end. New counted screen evidence: in a frame the original's code was still
busy in, a pixel may also show the port's objects over the VRAM of the last wait (new tiles not
yet written; newgame3 frame 1552: the old figure one pixel right, the walking frame), and the
line-tear olds include the port's picture with the previous frame's palettes (a palette written
after a long interrupt-time work: newgame2 frame 1055). Falsification: the cursor's right / left
wrap, the grid row stride (9 -> 8), a box corner (F7 -> F8), the level byte (C503 -> C504), the
DMA hold point and the back-a-member flag (CDEA) each fail the traces.

## 2026-10-13 — Port P1, fourth checkpoint: the opening battle (1.34.0)

The opening script 09:6015 starts with event 1B (scene code 3F 01): a battle (00:19D0) with
formation 01 (0B:758B + 5 l -> CC59). 00:1126 runs 00:1D62: the screen (0B:6CEE: windows mode 0
0B:5BDF, the background blank, SCY 40), then the battle 0B:4000: music CC5C bits 4-5 + 1, the
backdrop 0B:405A (formation layout 0B:5A18, monster pictures decompressed 0B:40BF, group maps
0B:4205), the entities 0B:4444 (party records -> D000.., enemy groups through D680), the map state
C6E0 -> DD00, the members' figures 0C:6001, effect 15, the opening slide 0B:780A (32 steps; each
shown by 0B:783B, a raster loop that, with the interrupts off, writes SCY/SCX for lines 0-40 as LY
reaches them), then the battle script at 0C:4A2D run by the interpreter 0C:4000, then effect 16.

The battle is a bytecode script in bank 0C (tools/ffl3/bscript.py lists it: 2,376 statements
from 0C:4A2D, 43 native routines): statements of an opcode (low 5 bits) and an operand type (top 3
bits) over variables in page C9 and a 24-bit accumulator CC05-CC07 (CC01-CC04 the target, its
type and a condition; CC0C-CC0E the left side of a comparison; a call stack of script addresses
from CC11 through CC0F). Opcode 03 calls a native routine (bank 0C or 0); `rst $30` (00:38D4)
calls a routine of another bank through the trampoline C0B2 (jp C0B4:C0B3, written by the
caller). The disassembler now follows `rst $30`, `ld hl,TABLE` + `jp/call $373B` jump tables and
the script's natives; one native (0C:6B7F -> 02:4000, the action display) is reached only through
script data and is listed in tools/ffl3/disasm_entries.txt.

Timing: the script's own CPU time decides at which frame each random number is drawn (00:39D5
mixes FF93 into FF90); the traces now record FF93 at every draw and the replay feeds it to the
port's generator (battle2: 29 draws). A frame work run by the code itself at a bracket entry
(00:1E38) keeps the code until it ends, with the interrupts on when the work turned them on
(01:5730's reti): a STAT meanwhile nests (only the sound) — without this a pending STAT ran the
frame work once more at the next bracket (an extra party-figure step). The divide 00:1C9C keeps
its stack pointer in C0C1/C0C2 (self-modifying code at C0C0): the script's divides leave CFC7.

Results: `battle1` (to the command menu, 2,018 frames) 1539/1539 waits and `battle2` (Fight and a
full round: four members' commands and targets, the actions, 3,174 frames) 2530/2530 waits
identical; screens equal or counted (battle2: 19 busy-frame tears, 112 line tears, 1 late-object
frame; 4 transient OAM waits where the arrow objects were hidden a frame early). Falsification:
the script's add as a subtract, the random rotation (rrca -> rlca), the slide's step (1 -> 2), the
random re-timing removed, and a 3-byte store shifted each fail the battle traces.

Method note: the battle routines were ported in parallel by sub-agents from the disassembly (each
file reviewed against its listing and type-checked), then integrated and checked only by the
replays; routines no trace reaches yet are unverified (bank 0E effect code is not disassembled:
effect 14 and one branch of effect 12 are NotPorted).

## 2026-10-13 — Port: the opening battle to its end (1.35.0)

`battle3` (A every 40 frames: default commands and targets, every message; 8,118 frames) is
wait-exact: 6754/6754 waits, 61 random draws, 6078 frame works matched. Found: when the code's
own reti lets in a pending STAT whose handler runs long (a sound tick from 3185/151 to 3186/3,
then the frame work, then a second STAT taken at 3186/4), the code cannot run until it is done —
its CD3D decrement came after both works. The port now holds the code while a handler's work is
still running (`Game.work`), at a reti and before resuming any line wait. Four more native entry
points were found by the replay (0C:6B3E, 6B67, 6B68 effect 11; 0C:6B4F and 6B55 farcall 0B:44A8
/ 0B:7E96 still unported). 44 OAM-only wait differences (arrow objects shown or hidden a frame
apart, a walking figure's x low bit) are counted as transient: each equal again at a later wait.

## 2026-10-13 — Port: the opening scene after the battle (1.36.0)

`opening1` (battle3's plan, then A every 40 frames through the scene after the battle, then 1,200
idle frames; 11,118 frames) is wait-exact: 9425/9425 waits, 8424 frame works, 60 random draws,
678 bracket polls matched; screens equal or counted (43 busy-frame tears, 233 line tears).
Found:

- After the battle, WY 50 (which turns the STAT frame work to the field branch) is written after
  the 2 KiB background fill and 00:20CF; the sync point is 0B:5D2B (0B:5CFF was too early: the
  frame work at 8179/3 still took the old branch in the port).
- rst $20 (00:0020: di, bank push 00:38E1, reti) turns the interrupts on. The field frame work's
  objects (00:01A0) switch banks with it, so a frame work that runs past the next LYC (one started
  in vblank after a bracket leave, 8355/152 to 8356/61) is interrupted by the nested STAT, which
  only ticks the sound (CDC5 set). The port held that STAT to the work's end and then ran a whole
  second frame work.
- The map animation 01:54A0 has 36 modes (table 01:54B4): strip scrolls 01:5730 (ending with
  reti), tile rolls down / up 01:57A9 / 01:57CE, byte rotations 01:5847, tile swaps through C800
  (16 or 32 bytes) every 16, 32 or 64 frames, and frame tables (01:5601, 01:565F). All are ported;
  `opening1` reaches mode 1B (01:5964: 9220/9250 and 9320/9350 every 16 frames).
- Under the normal handlers (00:1B2D, during scripted walks) the vblank handler 00:11A2 can run
  into the next frame (9253/144 to 9254/7), so the code resumes from a
  wait there. The recorder now gives each wait the frame of the vblank interrupt that ended it
  (00:0040), not the frame in which the code reached 00:3A77; it also lists where each wait ended
  ("ends", diagnostic). With the old rule two waits shared a frame and the port was a frame late.
- Scene events take CPU time, and the STAT frame work runs only while CD3D is set; 00:1236 clears
  it and 00:12CA restores it. Between two scripted walks (00:1B50 ... 00:1B2D) the original runs a
  frame work at 9269/6 that the port skipped, having run the next event at once. Sync points
  00:2F0B (a script reference's event about to start) and 00:12CA (an event's end) fix it; a
  third at 00:1B2D was redundant (its mutation passed) and was dropped.
- A tile swap made by the code after the top lines were drawn (9424: rows 0-22 show the old
  tiles) is counted as a line tear: in the lines the original's code ran, a row may show the VRAM
  of the last wait that ended before the frame.

Falsification (ffl3/scratch/mut4.sh): the rst $20 interrupt enable removed, mode 1B off, a wrong
swap tile, the 00:2F0B or 00:12CA point removed, and the last-wait VRAM taken out of line tears
each fail `opening1`; before the recorder change the replay stopped a frame late at wait 7656.
A port of the late resume (the code resuming at the original's line) was tried and dropped: its
mutation passed.

## 2026-10-13 — Port: the wave fades of a map change (1.37.0)

`opening2` (as `opening1` with 450 A presses, then 300 idle frames; 19,818 frames) is
wait-exact: 16914/16914 waits, 15432 frame works, 1201 bracket polls matched. It reaches a map
change whose load fades with a wave (CA6B = 1: 00:03CD out, 00:03E9 in; bank 0F 7E18-7F07), an
event 11 screen shake and the scene after it. Found:

- The wave: a STAT handler at every line (0F:7EC2; LYC + 1 up to CDB3 = 8F, then CDB2 = 0) sets
  SCX = CDB0 + t, t = 0F:7E54[(LY + FF93) & 1F] (a signed sine, twice at C880) moved toward 0 by
  CDB1 (|t| < CDB1: 0). Fade out: CDB1 from 0F down to 1, six frames each at palette level 0,
  then levels 1-3 six frames each; fade in the reverse. Frames are counted by polling LY for line
  0, not by the frame wait.
- With a handler at every line the code is slow: the 3-byte palette copy takes 3-5 lines and a
  long sound tick runs past the next line 0, so the poll waits a frame more (amplitude steps 8
  frames apart instead of 6). Sync points 0F:7EB9 (the poll ended), 0F:7E89 / 0F:7E8F (the
  amplitude steps) and 0F:7E74 (the end) give the port the original's times; 0F:7EBF (the copy's
  end) is recorded as a landmark only.
- The handler's SCX write lands near the end of the line's drawing (the reference emulator draws
  a line when mode 3 ends; objects and the fine scroll lengthen mode 3): mostly after it (the
  value shows from the next line), before it on lines with 6 objects — but not always (it depends
  on the handler's path and the instruction it interrupted). The port writes after the line and
  records the other outcome per line (`Game.scxAlt`); the replay accepts rows showing either
  ("raster tears", 401 frames).
- FFC5 is the sound driver's loop count (0F:4802): ignored with the rest of its state.
- A frame work or the code's own field work writes the scroll later in the frame than the port:
  in those lines a row may show the registers as the previous frame ended, and the row being
  drawn while they were written may be mixed (line tears).

Falsification (ffl3/scratch/mut5.sh): the wave offset, its phase, the fade-out levels, each of
the sync points 0F:7EB9 / 7E89 / 7E8F / 7E74, the raster alternative, the previous-frame
registers, the mixed boundary row, comparing FFC5, and points as the code's landmarks each fail
`opening2` (a first offset mutation was equivalent: |t| = CDB1 gives 0 either way).
Tried and dropped: writing SCX on the same line when objects were on it (any number, or a
mode-3 length threshold of 24 or 30) — each left differing frames; deferring the frame work's
scroll writes to its end — the original writes them about 11 lines earlier.

## 2026-10-13 — Port: the opening to its end (1.38.0)

`opening3` (700 A presses; 29,558 frames, stopping before the field loop 00:0265, which the
original reaches at 29,606) is wait-exact: 25712/25712 waits, 23422 frame works, 1775 bracket
polls matched. The whole opening — title, New Game, prologue, names, the simulator battle and the
scenes after it — now replays wait-exact. Found:

- Maps 0A / 0B load 01:5501: the 2 x 2 tiles at 9060 turned a quarter clockwise three times into
  9460, 94A0, 94C0, 94E0 (01:5552 per block through C810-C850, 01:5A18 per tile, 01:5A44 per bit
  plane: byte b - 1 of the turned plane takes bit 8 - b of the 8 rows, bottom first), the frames
  of the map animation 01:5601.
- The slide's STAT handler (00:3631) waits for the next hblank start (00:366E); entered late
  (at 20560/83 the interrupt was taken in mode 3, the hblank begun by the first poll) all its
  writes come a line later. The port records the lines that may show the line before's
  registers (`Game.lateLines`); the replay accepts that frame as a raster tear.

Falsification (ffl3/scratch/mut6.sh): the turn's direction, the block placement, one turn less,
and the late-slide alternative removed each fail `opening3`.

## 2026-10-13 — Port: the field loop (1.39.0)

After the opening the game runs the field loop 00:0265 (CA0E = 0; the field step 00:07BB; the
companion 01:4F24; the objects 01:4F66 and 00:01A0; a frame; the map animation 01:54A0). Ported:
the step going on (01:43F9: the leader's step frame by C6EE >> 6), the layer switch 01:5CD3, the
pending events 00:08F3 (CA52 -> event 2B; after a step, a C0-type cell C2F0 -> its event), the
map-01 vehicle check 01:6374 and moving cells 01:4BF6 (not ported past their tests), the leader's
tile base, kind and sprite reset on foot (00:07DC), the D-pad steps (01:441D / 44A8 / 4520 /
4599, as the scripted walks), and A (00:0945: the object faced, 01:431E / 01:4395, turns to the
leader; its words 0A:4004[C200 - 1] in mode 08 then the window closed, or a sign 0A:791E). B in
a vehicle, Start (the menu 09:4000), Select, encounters (00:10C2) and event 23's menu (01:7972,
the ship's console) stop with NotPorted.

`field1` (the field idle, A facing nothing; 30,318 frames) 26486/26486 waits and `field2` (down
through the door into the ship — a map text event and the load — then steps each way; 30,630
frames) 26742/26742 waits are wait-exact. A wait ended by the last recorded frame's vblank is not
counted (the recording stops before the code resumes).

Falsification (ffl3/scratch/mut7.sh): the step frames' order, the pending events removed, right
taken as left, and the last-frame wait counted each fail a field trace. The leader's sprite reset
on foot survives its mutation (the traces never change it): unverified. Talking to a person (A
facing an object) is not in a trace yet: unverified.

## 2026-10-13 — Field traces from a saved state (1.40.0)

`field0` plays the opening to the field and saves `field_start.state` (local, ROM-derived, never
committed: `python tools/ffl3/traces.py field0` makes it); `field1` / `field2` start from it at
the field loop 00:0265 (580 and 812 frames instead of ~30,000) and replay wait-exact
(580/580, 754/754). The replay starts the port at 00:0265 with `fieldLoop`. A trace whose hook is
past the frame's vblank (line 153) starts with that vblank counted as taken (else its first wait
waited for a vblank already past). The recorder now also removes its vblank hook after a trace
(chained, non-boot scenarios reuse the emulator). The field mutations (mut7.sh) give the same
results on the short traces.

## 2026-10-13 — Port: the field menu screen (1.41.0)

Start in the field opens the menu 09:4000 (`fieldmenu.ts`, ported by a sub-agent from the
listing, integrated and checked by the replay): the screen (09:40D3: fade out, the bracket, the
window at the top, sprites reset, the frame tiles 03:48A0 -> 9080 composed by 0B:7D60), the
temporary items back (0B:6683), CD15 = 0, CD42 = 1, CD16 = 0C, the members' status words
(09:457D), the boxes (09:427E), fade in; the menu input 00:1E51 (A: the item CD15, not ported;
B: back; the cursor up / down wrapping 0-6, left / right between the columns); B leaves through
01:7023 (fade out, objects hidden, window off, the bracket left, WY 50, the map's tiles reloaded
00:0150 / 00:0427, the objects drawn, fade in) and then 01:402D (the action an item left in
CA16; none here). While CD42 is set the STAT frame work's other branch runs 0B:7CDD (00:1ED7):
by FF93 & 7 the frame tiles composed again (0), rotated a bit (1, 0B:7D49), or masked (2, every
16th, 0B:7D16).

`menu1` (from field_start: open, the cursor both ways, B; 271 frames) is wait-exact: 190/190.
Found: the original sets CD42 after the screen's tile work, during the frame after the fade —
the frame work of that frame does not rotate yet; sync point 09:40B1.

Falsification (ffl3/scratch/mut8.sh): the 09:40B1 point removed, the 0B:7CDD frame work removed,
and the rotation step removed each fail `menu1`; the rotation's carry into 90C0 taken from the
wrong byte survives (equal bits in these tiles): unverified. The 7 menu items stop with NotPorted.

## 2026-10-14 — Port: the field menu items (1.42.0)

The seven items of the field menu (09:4034: 4350, 435E, 4A4A, 4377, 439F, 43B1, 43F0) are
ported (`menuitems.ts` items 0-1, `menuitems2.ts` items 2 and 4, `menuitems3.ts` items 3, 5, 6;
written by sub-agents from the listing, integrated and checked by the replay). 0B:7124 (an
item's stats on or off) is complete, so 0B:6683 (the worn-out weapons) no longer stops; its three
copies (battle menu, event 13, field menu) are now one (`equip.ts`).

Traces from field_start: `menu2` (item 0), `menu3` (item 1), `menu4` (item 2: the rows and
columns, the buzzer at both ends), `menu5` (two status boxes), `menu6` (the weapon 30 of member 0
taken off into the bag — 0B:7124 with CE25 = 1 —, the helm slot refused, the weapon put on again —
CE25 = 0 —, refused swaps), `menu7` (auto-battle marks toggled), `menu8` (the save: B, an empty
slot saved, the used slot asked: B, then A, saved; the menu closed), `menu9` (a slot saved, the
save screen left by B). All are wait-exact.

The save: slot k at A000 + 2D8 k with a second copy at + B60 (slot 3 is a stash of the game kept
while the slots' leaders are loaded into members 0-2 to be shown); a copy holds the magic C6 62 83,
a checksum (the 8-bit sum of the 2D2 bytes and the 16-bit count of its carries) and C500-C7D1.
Each copy is written until it reads back equal; on load a bad copy is repaired from the other and
counted in BFFA-BFFC. The recorder now keeps the cartridge RAM at the start and the end of every
trace (`sram.bin`); the replay starts from the first and compares the second (equal in all 22).

Found: the menu rows are shown by 09:5020 through 00:20FF, whose copies wait for hblank windows —
frames of CPU time. When a 16th frame's walking figures (00:2192) fall in them, the original still
has CD3C = 1 from the save screen (the three slot figures) while the port had already cleared it
(`menu9`); sync point 09:5044 (the end of 09:5020). With 09:504F (each row drawn, needed by
`menu3` / `menu5`) and 09:5044 in place, the 09:427E point of 1.41.0 and a 09:442F point (after
the slot loads) are no longer needed: removing either passes every trace, so both were dropped.

Falsification (ffl3/scratch/mut9.py): each of these fails a trace — C888 = 15 x the bonus
(`menu6`), the 0B:726E constant 4A (`menu6`), the checksum counting carries twice (`menu8`,
`menu9`), the second copy at + B50 (`menu8`, `menu9`), the auto-battle mark on bit 6 (`menu7`),
09:5044 removed (`menu9`), 09:504F removed (`menu3`, `menu5`), item 2's lower end at row 2
(`menu4`), the status box copied short (`menu5`). Unverified: item 2's A (every C548 byte is FF
here; a target confirmed reaches 09:521A, not ported), an item used from item 0 (09:521A), the
repair of a bad save copy, the clearing of BFFA-BFFF (zero already), the hang guards (a copy that
never verifies).

## 2026-10-14 — Port: the ship, the warp and a random encounter (1.43.0)

The cockpit console (event 23, 01:7972; `ship.ts`, ported by a sub-agent from the listing after
adding its jump-table targets to tools/ffl3/disasm_entries.txt) opens when the leader steps onto
the console cell: Depart is refused here (flags 05 / 0E / 0F / E1), Engine and Warp answer "no
units", Weapon sets the Cannon (C6FB), B closes it through 01:7023 (now exported). `ship1` (Depart,
the cursor wrapping, B) and `ship2` (the four items) are wait-exact.

Up from the ship a strip of moving cells (01:4BF6, `field.ts`) carries the leader to a platform;
holding the carried way speeds it up, the back button slows it and faces back, across it tries a
step of its own. On the way, event 25 (00:1A95) on an odd count makes two steps: its `call $1ADE`
falls into 00:1ADE again (the port made one; `warp1` showed it). The spiral warps to map 0A; its
stairs lead out to the world map (map 02). `warp1`, `warp2` (each button on the strip) and
`world1` are wait-exact.

A step on the world map rolls an encounter (00:10C2): the zone's formation (00:10F5), the battle
(00:1126) and the map back (00:1151). Since story flag 31 every battle opens with a wipe (01:5EB8):
the view is drawn into the window map and blanked tile by tile, one tile per hblank, then each
line's hblank slides the window and the background sideways from a growing table. It turns the
interrupt vectors into `ret`, so the first interrupt switches them off until its `ei`; the port's
interrupt dispatch now models such vectors, and the wipe runs line by line with its writes on the
next line (`Game.later`). `enc1` (two waves, Hooligans and an F-Drake, A every 40 frames; a member
falls; level ups; the Cyborg parts declined; 10,225 frames) is wait-exact, and with it battle effect
14 (0E:7DBF, a monster entering by scroll steps), the bank-0 natives 00:2499 / 00:24C7 / 00:1E46,
and a fallen member's figure: its tiles are copied raw, read back, their low plane cleared and
copied back over many lines, so one frame shows the raw half (sync point 0B:7E7A).

Found: the battle's divisions store the stack pointer (C0C1 = SP - 8): an encounter runs 1E bytes
shallower than a battle from an event (E5 against C7).

Falsification (ffl3/scratch/mut10.py, mut11.py): each fails a trace — the Weapon item stored ^ 1,
the cursor wrap, CA57 + 2 (ship1, ship2); the wipe's row growth 2, its mirror at 46 (enc1,
world1); the encounter stack 1C, effect 14's SCX step 2, the 0B:7E7A point removed, the 00:24C7
and 00:1E46 natives emptied (enc1); the carried way not faster (all four); the back button facing
up, the cross step not faced (warp2); event 25 with one step (all four). Survivors (unverified):
the wipe's row-start and fill-end sync points (dropped), its 22 tiles a row and the line its
writes show on, the zone thresholds' equality, the flag patches after a battle (none on map 02),
the console's Option mask, the key items, the template length. Not ported: Depart (01:63E6) and an
item chosen at the console (01:642E), map 01's AD case (00:101F), the other moving cell kinds.

## 2026-10-14 — Port: Select, vehicles, the console, Continue, the menu's uses (1.44.0)

The field sweep (tools/ffl3/traces.py map_sweep / talk_sweep; `fieldsweep.test.ts`) enters every
map from field_start through a poked return point (event 04) and talks to every object put in
front of the leader: 412 of its 425 traces are wait-exact. The 13 left differ by a few sprite
pixels where objects overlap during a jump (t11_*, tb3_6/7, tb8_2), on map 51 (one frame) and in
ta7_3-5; their RAM is equal at every wait.

The VRAM bracket's poll (00:1E2E: STAT mode 1, interrupts off) entered on line 153 ends in the
next frame either way, but at two different times: a nested call reaches the poll still in line
153 and goes on at the next frame's top (t21_2: its frame work at 38,7 and the next bracket at
38,63), while a call reaching it after the line has turned polls through the whole next frame
(newgame1: the leave at 287,153 ends at 288,144; the STAT of 288 is held until then, and that
frame has no frame work). Which one happened depends on cycles within line 153; the trace tells
it by whether the original ran anything (its code or a frame work) in that frame's visible lines
(`Game.onCrossing`). A deferral of the STAT frame work tried first passed t21_2 but broke the
menus and was dropped.

Select (00:0851) turns C6F3 left by two (the next member leads) and redraws the leader through
00:01E7: in bank 0B the sprite type of 0B (00:04F7 with its 00:08AD frame), the leader's tiles
(00:04B1), the sprite list (01:5272), a frame. B in a vehicle is 00:0861 (the event 12 special 0E
already ported). Ported by sub-agents from the listing and checked by new traces with poked
state (POKES in traces.py): the console's Depart (01:63E6: the vehicle state from flags 3A / 39
and C6FA, the kept place loaded; `ship3`, flag 05 poked, then B off the vehicle, state 3) and an
item confirmed (01:642E: flags 0E / 0F and the wave flash 0F:7DF2; `ship4`, key item E1 poked);
Continue on the title (09:4964, `cont1` from a power-on with the cartridge RAM `menu8` left: the
slots, a game loaded, 01:7DC5, then the saved map 00:025C and 00:3D38) — its walking figures are
drawn after the slots' checks and tiles take ~3 frames of CPU time (sync point 09:44D2; without it
the figures' frame phase differs); the items used from the menu (09:521A with its effect kinds,
`menu10` with a poked bag: Cure1, HP, Elixir, Tent, Soft, and E6 0F:7BC8) and the field spells
(09:4D87; `menu11`-`menu15` with poked spell bits: Exit refused where CA6C is set, 20 not castable
there, 21 calls the vehicle through 01:4049, 25 short of points).

Falsification (ffl3/scratch/mut12.py, mut13.py; earlier ones by hand): each fails a trace — the
crossing rule removed (newgame1 / t21_2 late), C6F3 turned by one or ^ 40 (select1), the 09:44D2
point removed (cont1), Depart's C6E3 ^ 1 and the disembark's C6E6 (ship3), 01:642E setting flag 0F
or without the wave flash (ship4), 0F:7BC8's count + 2 and CDC0 ^ 1 (menu10), Continue's CD26
(cont1), 00:3D38 removed (cont1). Survivors (unverified): Exit's warp back (01:41D6, 01:5F39) and
the fade in 01:5F9D, spells 20 and 25 past their checks, the follower 00:06D2, events 10 7 / 10 8,
the text codes 00:3086 / 00:308C / newlines 00:26D3 / 26E3 and the menu code 00:29A5 (no trace yet
known to reach them), the vehicle pushed out on map 01 (01:63AD) and A on the return point
(01:632A). Not ported: map 01's AD case (00:101F), the other moving cell kinds, map animation
modes outside the 36, the raster quake (event 2C, 01:5B4D), event 10 F (06:7F69).

## 2026-10-14 — Port: the sound driver, the start code, the battle sweep (1.45.0)

The sound driver (bank 0F 4000-482E; `sound.ts`, ported by a sub-agent from the listing, its
command handlers 0F:44A8-4618 decoded from the bytes the listing shows as data) runs at each tick
(00:1F3A from the STAT and vblank handlers, 00:3A60 and 00:3624 from the code, 0F:7EBF in the wave
raster). Four channels of 0x18 bytes (A CB02 pulse 2, B CB1A pulse 1, C CB32 wave, D CB4A noise),
the tempo accumulator CB00 + CB01 (a carry runs the sequencer twice), pulse and noise effects
borrowing B and D. Its RAM (CB00-CBFE, FFBB-FFC5) is now compared at every frame wait in traces
recorded from 1.45.0: the slice (37 of 39; opening2 / opening3 differ from one frame of the
scene at 18429 on), the field sweep (all 412 that pass) and the battle sweep (98 of the 100;
b0a, b77) — the residuals are listed in `SOUND_KNOWN` (parity) and checked to still differ.

Getting there took the times of the game's requests: the port writes in no time, so a request
written in the original after the frame's tick reached the driver a tick later. Traces now record
the writes of the effect request FFBC (41 `ldh [$BC],a` sites, 9 of them in code the listing shows
as data, found by a ROM scan for E0 BC after `ld a,n`; and the battle script's stores to FFBC,
0C:4017) and of the music request FFBA (8 sync points, and the script's stores); the port lands each
write at the original's time (`Game.sfx`, `Game.song`, `Game.atPoint`) without holding the code,
and a tick the code runs itself (00:3A60, 00:361F) first waits for the requests written before
it. Interrupts: the LCD off gives no vblank or STAT; a bracket entered on line 2 writes LYC 3 just
before or just after line 3 begins (cycles): the trace's record of the bracket's STAT handler
(00:1F27 entries) tells which; at the wave's end the old LYC's coincidence on the next line may
still request a STAT (taken by 00:1F27 at the `ei`): the original's next bracket call (lines
later when the handler ran) tells. The start code from power-on (00:0200: LCD off at line 91, the
clears, the vectors, the title; its first `call` leaves 0204 on the power-on stack at FFFC) is
`Engine.fromStart` (`boot1`, sync point 00:023B: the clears take frames with the LCD off).

The battle sweep (traces.py battle_sweep) fights every formation 00-7D but 42 (C2, the scripted
loss that resets; 7E's recording does not finish) from field_start through a poked map event 1B,
A every 40 frames: 100 of 125 wait-exact. A member's figure tiles (0B:7E17: the raw copy, read
back, the low plane cleared, copied back) are written by 00:20FF, 5 bytes in each hblank; on a
line with 8 or more objects the hblank is too short and the copy writes the same 5 again on the
next line (the battle figures' rows have 10), and its first chunk lands in the hblank after the
call's line: the port shows them line by line (`Game.vramPaced`; sync point 0B:7E17). Residuals:
13 traces with a few pixels on one or two frames (figures and effects), 5 with an object's flip a
frame early near the end, 7 where after the battle's last message the port runs a frame work the
original did not (its frame works then come ~80 frames late).

Falsification (ffl3/scratch/mut14.py, mut15.py): each fails a trace — the tempo accumulator + 1
(field1), FFBC written at once (menu11), the line-2 race always on time (enc1), points 00:023B
(boot1) and 0F:7E3B (ship4), the script's FFBA store at once (opening1), the tick not waiting for
the requests (battle2), FFFD (boot1), the stall threshold 11 objects and the first chunk on the
call's line (b0c-b15). Survivors: the LCD-off gating (boot1 passes without it since 00:023B),
0B:7E17 removed passes b0c-b15 (but fails b65 and b6b; with it b1f, b51 and b62 fail).

## 2026-10-14 — Legend III in the app (1.46.0)

The app imports a Legend III ROM (checkFfl3Rom: the verified dump, or a 256 KiB "SAGA3" image in
the unverified mode) into its own data package and battery RAM (IndexedDB keys ffl3, ffl3.sram,
ffl3.sram.prev), and runs `Player3`: the engine from the start code (`Engine.fromStart`) with the
boot ROM's LCDC 91 / BGP FC, 59.73 Hz frames, the PPU, input, the sound through the shared APU
model. The game's own reset (`jp $0200` when the party loses the scripted battle C2, or declines to
continue) is thrown as `Reset` and starts the engine again, keeping the cartridge RAM.

In play nothing re-times the code (no trace): `play.test.ts` runs the engine from power-on with
the opening's buttons and then a seeded walk for 90,000 frames, no engine error. In a browser
(vite build served locally, the ROM given by ?rom= from the same machine) the title, New Game, the
names, the opening battle, the opening scene, the field menu with an item used, the field and the
moving floor played without an error.

## 2026-10-14 — Port: the last reachable branches (1.47.0)

An audit of every `throw new NotPorted` in `@ffl3k/core` against the listing (table lengths, the
values each selector's writers store, a walk of every battle script from both interpreter entries
and the computed tables 0C:7CEA, 0C:7503, 0C:7E53, 0C:5A92) left these reachable, now ported:
- 01:5B4D, event 2C's quake: a raster effect — vblank 00:11E4 (OAM DMA, CA22 += CA24, the scroll,
  the sound tick; no joypad) and an hblank STAT handler 00:121D per visible line (SCY from CA23).
  `Game.runFrame` raises STAT only at LYC, so `rasterOn` (01:5C97) adds the hblank requests line by
  line while STAT bit 3 is set; `rasterOff` (01:5CB8) stops them.
- 06:7F69, event 10 F: the ending — the credits (0B:6C96) over the battle screen and the opening's
  slides, the last text (0E:7C94), then the endless loop 06:7FC8.
- 02:50ED, effect 12 with CC5C & 3 = 2: a monster's transformation — the old picture turned into
  24 objects (03:7E74), the new one drawn (0E:7D63), 0x7F shaking frames, a flash.
- 09:410C (battle OAM rows from 09:412F), 0B:7DCA with a member (jp 0B:7E17), 0B:6E15 (record
  C680 kept aside at C620, its level from 07:7BA4, then 0F:79D4), 09:5466 tables 6-F (the jump
  lands inside the table code: each entry's run decoded), and menu text codes that wait (09:519C
  calls the text handler 00:3175 directly: the menu rows are generators now).
- Battle-script natives the scripts reach only through computed jumps: 0C:499B (action 20: a
  monster copied into its group's first slot that left), 0C:6B4F (0B:44A8, monster groups rebuilt;
  scene state 1 of monsters C1 / C2), 0C:6B55 (0B:7E96, the status scene's steps 0 / 1), 0C:7E35
  (action 21: C985-C987 = 999999).

Audited unreachable (the throw stays, naming why): 0C:4186 codes (all 32 handled), 0C:437C (opcodes
00-0D, 1F only), 01:7A6A (C080 rows 1-4), 00:0864 (C6E3 0-8), the sound commands (all 64 words),
01:54A0 (map header byte 3 is 00-23 in all 192 headers), 09:4031, 00:16BC / 00:196C, 01:706E,
09:52E4, 09:4D87, 01:63C7, 01:6431, 02:4397 (one possible way in: ability record 29 of 09:5A50
gives animation 70, one past 02:53EE — not seen used), 0B:5DBF (sub-menus 0-9 only), 01:4F79
(object kinds 00-20 only), and the endless loops.

Evidence: `routines.test.ts` checks 0C:499B, 0C:6B55, 0C:7E35 and 09:410C on a synthetic cartridge
(no game content); a mutation of each fails it. No recorded trace reaches the others yet
(unverified): the quake, the ending, the transformation, 0B:6E15, 0B:7DCA with a member, 0C:6B4F,
09:5466 tables 6-F, menu text codes that wait. Slice 39/39, field sweep 412/425 unchanged.

Replay: a frame whose STAT handler ran in the visible lines (the trace's `stat` record) counts as
one where the interrupts were on (`onCrossing`): b33, b44, b57, b71, b76 now wait-exact (battle
sweep 105/125). b23 (2 frames late at wait 2425) and b6a (4 pixels) remain.

## 2026-10-14 — Battle sweep complete: the random counter, the hblank copy's lines (1.48.0)

The battle sweep is wait-exact and screen-exact in all 125 formations (was 105).

- **The random byte's frame counter.** The trace's `rand` record was taken at 00:39D5, the
  generator's first instruction (`ld hl,$ff90`). A vblank interrupt can come between it and the
  FF93 read (00:39D8): in b23 a draw at line 143 read FF93 + 1, so the replay fed the port the
  wrong counter, a hit roll differed and the battle drifted (2 frames late at wait 2425). The record
  is now taken at 00:39D8; every trace was re-recorded (2 of b23's 61 draws changed).
- **The hblank copy 00:20FF, line by line.** New trace record `paced` ([frame, LY, de, n] at
  00:2120 for each 5-byte chunk and at 00:216E for each of the last 1-4 bytes) shows what the model
  could only guess: on a line whose objects shorten the hblank, the 5 bytes are written (VRAM is
  open in mode 2) and written again on the next line once 00:20FF sees mode 2 at its check
  (00:212E); no chunk starts on lines LYC - 1 and LYC (00:210B waits while LYC - LY < 3). PyBoy's
  mode 3 length depends on the objects' count, X alignment and SCX (`_mode3_sprite_penalty`), so
  whether a line stalls is a cycle question: with a trace the port shows each byte at the line the
  original first wrote it (`Game.onPaced`); without one (play) it uses the model with both rules.
  This fixed the few-pixel figure diffs (b1f, b22, b28, b2d, b35, b3a, b3c, b51, b62, b64, b67,
  b6a, b7c).
- **The copy loop is the main code.** 00:20FF waits for each hblank, so the code after a copy runs
  only once it has ended (`Game.pacedDone`), also when the tiles were already there (no VRAM change:
  the copy still takes its lines). Effect 17 (02:4167, the frozen-figure mask DC81) had run before
  the bracket vblank's flip (DC80 = 0) instead of after it, so a figure flipped 16 frames late
  (b12, b23, b2c, b4b, b63). An enemy's action tiles (02:41B1: 0x200 bytes to 8000, 0x4A0 to 8200)
  are paced the same way (b7a showed them 2 frames early at the trace's end).

Falsification (ffl3/scratch/mut16.py): each fails a trace — `pacedDone` a no-op (b12, b23,
b2c, b4b, b63: 8 wait diffs each), the `paced` records ignored (b1f, b22, b28, b35), the enemy
action's 0x4A0 copy unpaced (b7a). Survivors (unverified): the enemy action's 0x200 copy unpaced
(b7a passes: the second copy's wait covers it); the model's LYC rule (no trace without records
reaches it). The model alone (records ignored) fails b1f, b12, b23; without its stalled-line write
it fails b1f, b6a instead: neither variant is exact, which is why the replay takes the record.
Slice 39/39 and field sweep 412/425 unchanged with the re-recorded traces.

## 2026-10-14 — Field sweep complete (1.49.0)

The field sweep (every map entered, every object talked to) replays wait-exact and screen-exact
in all 425 traces (was 412); the battle sweep stays 125/125.

- **The objects' OAM buffer is complete before the drawing returns.** 00:01A0 holds the vblank
  DMA (CD39 = 1) while it draws and restores CD39 at 00:01CF; a vblank between 00:01CF and the
  return (00:0275) still DMAs the new buffer. The port took the buffer as complete at 00:0275: in
  map51 the drawing ended on line 143, the vblank handler ran on lines 144-149 with the new
  buffer, and the port's DMA sent the old one (the screen a frame behind on rows 31-79). New sync
  point 00:01CF (taken in `drawObjects`, without holding the code: `pointTime(addr, quiet)`); the
  field loop's OAM buffer lands at that time (`vramUntil`'s `oamAt`). All traces re-recorded.
- **The reference emulator's object priority.** On the DMG the highest-priority object's opaque
  pixel decides even when that object is behind the BG (attribute bit 7) and the BG pixel is not
  0: the BG shows and the objects under it stay hidden (Pan Docs). PyBoy, which records the
  traces, draws the objects from the lowest priority up and skips a behind-BG pixel, so a
  lower-priority object shows there (`scanline_sprites`). The port's PPU (@ffl2k/render) keeps the
  DMG rule; a frame equal once the objects are drawn PyBoy's way is counted (`objQuirks`), not
  failed: t11_4-9, tb3_6/7, tb8_2 (the leader's two 8x8 objects at one X, the lower one behind
  the BG).
- **A frame the main code ran through.** In ta7_3 (a chest opened) the main code writes the
  window's text all through frame 280, apart from a frame work on lines 15-95; the port writes it
  at once, so line 96 showed the new tiles a line early. A frame in which no wait began and the
  main code was not waiting now counts all its lines as the main code's for a line tear (only
  where every differing pixel shows the old picture).

Falsification (ffl3/scratch/mut17.py): each fails a trace — no `objQuirks` check (t11_4,
tb3_6, tb8_2), the busy-frame lines dropped (ta7_3), the OAM buffer at 00:0275 instead of
00:01CF (map51). Slice 39/39, battle sweep 125/125 with the re-recorded traces.

## 2026-10-14 — The sound residuals gone; the quake and the ending verified (1.50.0)

- **The battle script's sound requests at their write.** The trace's `sfx` / `song` records of
  the battle script's store were taken at its entry 0C:4017; the byte is written lines later
  (0C:403A / 403D / 403F, now hooked with HL = FFBC / FFBA). In b0a a request recorded on line 2
  was written on line 7, after the bracket STAT's sound tick on line 3: the port's driver took it a
  tick early (b0a and b77 were SOUND_KNOWN).
- **00:1B50, the handlers back after an event walk (sync point).** After the walk's last frame
  wait the code takes lines before 00:1B50 restores the bracket's handlers; in opening2 it came on
  line 6, after line 3, so that frame's LYC STAT went to the normal (reti) handler and the frame had
  no sound tick. The port restored them at the wait's end and ticked once more (opening2,
  opening3). With the point both compare their sound state: `SOUND_KNOWN` is empty.
- **New traces from poked map events** (POKES, like the battle sweep): `quake1` (event 2C, the
  raster quake 01:5B4D with its vblank 00:11E4 and hblank STAT 00:121D handlers, 576 waits) and
  `ending1` (event 10 F, the ending 06:7F69: the wipe, the credits over the battle screen, the last
  screen and its endless loop, 793 waits over 4,520 frames) replay wait-exact and screen-exact;
  they join the slice. The quake matched as ported (1.47.0); the ending needed one more sync point:
- **01:5F12, the battle wipe's sound tick end (sync point).** The wipe ticks the sound itself
  after line 8F of each frame and then polls for LY 0; a tick that ends past line 0 makes the poll
  wait a frame more (ending1, frame 24: no tick that frame).

Falsification (ffl3/scratch/mut18.py): each fails a trace — no point 00:1B50 (opening2: 8
sound diffs), no point 01:5F12 (ending1: a frame late from wait 0). Field 425/425, battle 125/125,
slice 41/41 (quake1, ending1 added), all with the sound state compared; all traces re-recorded.

## 2026-10-14 — The last boss, the remaining routines (1.51.0)

- **Pokes at a frame wait** (`WAIT_POKES` in tools/ffl3/traces.py, `wait_pokes` in
  `Recorder.record`, `waitPokes` in trace.json): pokes applied as wait n ends, after its snapshot
  (or the first wait ending in frame f or later); the replay applies them to the port at the same
  wait, after comparing it. State the story would build over hours is set where both sides stand
  still.
- **The last boss (formation 7D, C1).** Its script (0C:7E42, scene state C9DA by 0C:7E53) resets
  its HP to 60000 every turn; from round 2 (C980 = 2) the scene state 1 (0C:7E7F) waits for
  C920 <= D897 (D897 from CF08, + 1000 a round up to 59000); then 0C:7EB3 turns C1 into Xagor:
  effect 12 with CC5C 62 (the transformation 02:50ED: 03:7E74, 0E:7D63), CC59 = C2, CC5C = E3, the
  groups rebuilt (native 0C:6B4F, 0B:44A8) and the fight goes on. `trans1` (HP poked to 1 at wait
  190: the transformation) and `xagor1` (D897 poked at frame 8000: the scripted way, 14,401 waits
  over 16,690 frames, the Xagor fight included) replay wait-exact and screen-exact as ported in
  1.47.0. They join the slice.
- **Formation 7E** (Xagor alone) is never a battle's start: Xagor's picture sheet (19) begins with
  FF, so 00:3D76's block size is 0 and the original never comes back from 0B:40BF (hooked: 3D76
  entered, then no vblank serviced, PyBoy's frame never ends — the recording's "hang"). No zone or
  script names it; Xagor appears only through 0C:7EB3 (`xagor1`). The battle sweep keeps it out.
- **0B:6E15** (member slot 3 from entry 6: the record kept aside) is event 10 2-1 (00:1508, entry
  1523[0] = 6): `member1` replays it exactly (events.ts `memberSlot`; the copy in names.ts
  `memberFromTable` is only called with b = 2).
- **Audited unreachable** (no trace can reach them): 09:5466 tables 6-F (every writer of C99B
  stores 00, 01, 10, 11, 20, 30, 40 or FF, the command records' high nibble is 0-3, and FF returns
  at 0C:4F54 before any 0C:6B49); menu text codes that wait (every text a menu box row can show —
  the templates of all 22 callers of 09:4FEF / 00:1E49, the pointer lists, the name-entry grid
  D000 — holds only codes 00, 05, 06, 09, 11, 1D-26, 28, 29, 2B-2F, 33-35, 43, 4C, none of which
  waits). 0B:7DCA with a member is reached only as 0B:7E17 called directly (09:44CC, 0C:6015),
  which every battle and menu trace covers.

Falsification (ffl3/scratch/mut19.py): each fails a trace — the transformation's SCY 40 written as
41 (trans1), the ability flags left out of 0B:44A8 (xagor1), C623's level byte left out of 0B:6E15
(member1). Slice 44/44, field 425/425, battle 125/125.

## 2026-10-14 — The input sweep (1.53.0)

- **Coverage first.** A V8 coverage run of `@ffl3k/core` over every trace (slice 44, field 425,
  battle 125) showed 1116 of 1464 functions called: the sweeps press A on the defaults, so the
  battle item / ability / spell lists and targets, selling, the forge, the mix, the clinic, the
  services, most battle animations, the yes/no question and many field items had never run
  against the original. The 1.51.0 claim that nothing ported was left unverified was wrong; it
  held only for the NotPorted branches.
- **The input sweep** (`tools/ffl3/traces.py fuzz_sweep`, `ffl3-parity/test/fuzz{b,f,s}.test.ts`):
  seeded random single-button input (the plan is fixed text in trace.json, the same on both
  sides) from field_start with a rich party poked at the hook (every spell, MP 999, a bag of 24
  item kinds chosen by the seed). zbNN (72): a battle first (formation by the seed); zfNN (36):
  the field (walking, the menus, Select); zsNN (64): a shop, forge, mix, clinic or service
  (map event 17, CA28 = kind + 1, the materials D2-D7 in the bag, GP 120 or 999990, members
  hurt for the clinic).
- **What it found** (each fixed, each falsified below):
  - 02:4167 — the frozen-figure mask DC81 (effect 17) set after the frame's vblank in the
    original: the flip 00:3E26 turned one more pair (zb02). Sync point.
  - 0B:675E — the target choice's CDEB set after the list's CPU time; the frame work's cursor
    figures (00:2247) cycle CE1E by it (zb19, zb12, zb15, zb22). Sync point.
  - 0B:678C — a target move (0B:698D, its searches) takes CPU time before the cursor kind CDEB
    the frame work's figures read (zb00, zb20, zb21). Sync point. (Holding CE1C back until it as
    well changed nothing: dropped.)
  - 00:2FBF — text code 43 places a member's object; the frame work's walking figures (00:21A9)
    write the same entries (zf04). Sync point (both copies: menu.ts and textcodes.ts).
  - 00:037B — after the objects' loading (06:054D) the original can be a frame later than its
    wait; the drawing takes FF93 bit 4 for the walking frame (C250; zs31 and 7 more shops,
    zf19). Sync point.
  - 00:1DF6 — text end: CD3D drops after the text's CPU time; one more STAT frame work ran
    before it (zb36). Sync point.
  - The field work's di (00:356B): a work that enabled the interrupts (01:5730's reti) takes no
    interrupt after its di; recorded per work (works[4..5]); a work run by the code (00:1E38 from
    00:1D9E) returns with them off, so the vblank it outlasted goes to the bracket's handler
    (1EFA: FF93 + 1; zf13's map animation swapped once more).
  - rst $18 (00:378A) returns with reti: the menu frame tiles' compose (0B:7D60) runs with the
    interrupts on, so a STAT during the frame work nests (the sound only) instead of starting
    another work at its end (zf22, 3,500 frames of drift).
  - The field work's objects (00:01A0) hold the DMA (CD39) until the buffer is complete
    (00:01CF); the port's work runs in no time, so CD39 stays set until the recorded 01CF
    (zf13: the vblank in between showed the old objects).
- **Result:** every trace re-recorded (768): slice 44/44, field 425/425, battle 125/125, input
  sweep 172/172 (battles 72/72, shops 64/64, field 36/36 with one residual frame kept as an exact
  expectation: zf13 frame 2834, 59 pixels of a menu text row drawn during a work that crossed the
  vblank; state identical).

Falsification (ffl3/scratch/mut20.py): each fails its traces — sync points 02:4167 (zb02), 0B:675E
(zb19, zb12), 0B:678C (zb00), 00:2FBF in menu.ts (zf04), 00:037B (zs31, zs07), 00:1DF6 (zb36)
removed; the work's di ignored, a code-run work keeping the interrupts, the objects' DMA not held
(zf13); rst $18's reti not modelled (zf22).

## 2026-10-15 — Targeted sweeps (1.54.0)

- **The event sweep** (zeTTP, 176 traces): from field_start a map event of every type the story
  traces reach rarely (C2F0 = C0 | type: 08 / 09 falls, 10 the party, 11 screens, 12 specials,
  13, 16, 18 items and texts, 1E scenes, 1F patches, 20-23 hurt / revive / rest / menu, 25-2B
  rocks, objects, walks, morphs, texts, switches) with eight parameters each (event 11: its six
  entries 00:196C, event 12: its eighteen 00:16BC; parameters past a table jump into data in the
  original and are not swept). All pass.
- **The spell and item battles** (zmNN: one spell known by every member, 48; ziNN: a bag of six
  item kinds, 35): all pass, but they reached almost nothing new: the member actions do not use
  the effect lists of 02:53EE, and the effects 03-0D of the dispatcher 02:4397 come from the
  action display C9BD of enemy abilities (tables 0 and 2 of 09:5466, e.g. 2:2D -> EC -> 7 in
  formation 35). A scan of every formation (ffl3/scratch/effscan.py, A every 40 frames, 6000
  frames each) reached effect 7 only: the parties win too soon for the rarer enemy abilities.
  Open: effects 03-06, 08-0D and the uncalled event / ship / continue routines (coverage below).
- **Text end** (00:1DF3): the count CD3D drops 40 T after the sync point 00:1DF6 (00:1DFA); when
  the next line's STAT (LYC) comes in between, its frame work (after the sound tick) still runs
  with CD3D set. zm31: a work at 731 line 6 after the text end at 731 line 2 (works 6148/6149,
  all later works one frame off, no pixel). The port now looks at the next recorded work
  (`Game.onWorkPeek`): a work starting within 8 lines whose STAT is the next line's runs first
  (`Game.untilAt`). Falsified: without it zm31 fails (works mismatch 5639).
- **Coverage after:** 1272 of 1464 functions called.

## 2026-10-15 — Enemy abilities, weapons, field uses (1.55.0)

- **Where the battle effects come from:** 02:4000 shows C9BD from 09:5466's record of C99B (the
  table, high nibble) / C99D: table 0 by the item id (a member's Fight with its weapon, an enemy's
  ordinary attacks 30 / 46 / 4B / 51), table 1 the members' abilities, table 2 the enemies' battle
  abilities (monster_ability slots with their mask bit: Wolf 86, Amoeba 2D, ...). The enemies
  choose a battle ability about once in 100 actions and the parties win in about 20, so the
  sweeps never saw them. A scan of every formation (ffl3/scratch/effscan2.py: HP 9999 for every
  entity from the first frame wait after frame 600, as WAIT_POKES) and of every item as a weapon
  (wscan.py) found: zx25 (effects 6, 3), zx1E (7, 9, A), zx54 (C) and zw00 (the weapons 6E, 6F,
  70: effects D, 4, B). Effects 5 and 8 and the stray tables stay unreached by real states (ids
  outside the weapons in the weapon slot reach past the table: armor BE gives effect 18).
- **The LCD blinks** (effect 04, 02:43C8): the LCD switched off and on in the vblank. PyBoy ends
  its frame at the switch (lcd.py: frame_done, LY 0) and counts one frame with no lines, no
  interrupts and no code; the code goes on at line 0 of the LCD's new frame. The port had one
  STAT sound tick and one vblank too many per blink (zw00 CB00, DC80). `Game.lcdRestart` makes
  the next frame empty and resumes the code at line 0 of the one after; a busy wait counts from
  there (`frame >= busyUntil`); the replay accepts the blank screen PyBoy shows in a frame the LCD
  was switched off (`lcdBlanks`). Sync point 02:43C8: the effect starts after the action's CPU
  time (its line poll came a frame early, zw00 frame 4052).
- **The field uses** (zuII: a bag of item C0-FF; zvNN: one spell known; 112 traces): sync point
  01:7023 (the menu screen closed): a menu left by a spell comes after its CPU time, the map
  animation's frame works meanwhile (zv45: the water tiles 90C0 one step off).
- **The menu's rows shown** (09:5020): each row's copy (00:20FF, hblank-paced) now lands at the
  recorded lines (`vramPaced`), a frame work holding a chunk up to a frame (`slack`); the list
  redrawn after a stat item's use showed a frame early (zuce, zucf, zud0).
- **A text line drawn at once** (00:3357, the shops' lines): its two copies (00:20FF) now land
  at the recorded lines too. The line was written in the vblank where the original wrote it a
  frame later, over lines 16-22 (zs00 frame 2026); it had passed only because the menu rows
  drawn at once had left the blank row in the port's frame before.
- **Falsified:** without the empty frame zw00 fails (sound, a stuck wait), without 02:43C8 zw00
  frame 4058, without 01:7023 zv45, without the paced rows or the slack zucf, without
  the paced text line the seven shop traces (zs00, zs06, zs09, zs34, zs42, zs44, zs45).
- **Tests:** 1159 FFL3 tests pass. **Coverage:** 1321 of 1468 functions called.

## 2026-10-15 — Command page 2, the ship's console (1.56.0)

- **Defend and Cover** (0B:64B4 / 0B:64BE): reached from a member's second command page, which
  Start turns (0B:6095: CDD8 = 4). The battle sweeps never pressed Start; zcNN (24) do, with the
  zb keys. All pass after one fix: **sync point 02:40A7** (the figures trading places when a
  member acts on a member, 02:403D): the original starts the swap after the action's CPU time,
  a frame after the port (zc22 frame 4686, 302 px). Falsified: without it zc22 fails.
- **The ship's console** (event 23): zkNN (64) open it with one key item bit (C6F8 / C6F9) and
  story flags 05 / 0E / 56 (masked pokes) and random input; znIRF (36) choose console item I and
  sub-menu row R with every key item and flags F. Row 2 of item 2 (CA50 2, 01:647B) runs the
  lift-off (0F:7F08 scene, 0F:7F5E blinks, 0F:7A1B key items given up, door 2F, text 0A:6D37):
  zn220-zn222 pass.
- **Pinned:** zk43 frame 2211, 15 px: a jump frame's map animation (strip scroll, 01:54A0) writes
  its tile bytes over the lines up to 01:49D5; `vramUntil` spreads the changed bytes evenly, and
  one tile's rows 39-42 show them a line or two off the original's. The traces record no time per
  byte, so the frame is pinned with its size (as zf13).
- **Effects 5 and 8, where they could come from:** 09:5466's records with C9BD bit 7 clear show
  the effect itself: 5 in table 2 at 5E / 72 (DE / F2) and in table 0 at 2F; 8 only in table 0 at
  8E / 93 (armor) and EB (no item). With bit 7 set, an enemy's action data (02:53EE) names effects
  too: action 6A (C9BD EA, table 2 at 44 / C4) shows 5 then 2, action 6D (named by no record)
  8. So effect 5 belongs to the battle abilities 72 (Hydra, Medusa, Lamia, Naga, Scylla, Echidna,
  Remora, Garuda, Dwelg), 5E (Mushroom, Thoth, Horus) and 44 (Monitor, Searcher, Alert, IronLady,
  Venus); effect 8 is unreachable in play. Scans of their formations (31, 34, 39, 6B; 5B, 5C, 5E,
  61, 4C, 4D, 27, 6F; 150,000-400,000 frames each, effscan2.py) saw no battle ability: with the
  starting party those battles end early.
- **A lost battle** (the "continue" question 0F:7F8F) is not reached from field_start: with every
  member at HP 1 and the enemies' HP 9999, two members fall but the battle script ends the
  battle without CEDA = FF (the traces were kept aside, ffl3/scratch/old_zl2).
- **Tests:** 1286 FFL3 tests pass.

## 2026-10-15 — Starting from a player's save (1.57.0)

- **`tools/ffl3/sav.py`:** `info FILE` checks the three slots of a battery save (each copy: the
  magic C6 62 83, the 3-byte checksum of 09:4EFA over the 2D2 bytes kept at C500-C7D1; both
  copies, A000 + 2D8 k and + B60) and prints each party (name, record head, HP, stats,
  equipment, abilities +48, spell count), GP, the vehicle C6E3, the place C6E4, the key items,
  the bag and the story flags (C760 + n / 8, bit 7 - n % 8). `state FILE SLOT T` boots with the
  file's RAM (the other slots' magic cleared), Continue, A until the field loop 00:0265, and
  saves `ffl3/build/states/field_svT.state`. The save stays in .private/saves, the state in
  ffl3/build (both local).
- **The save sweep** (`save_sweep`, zyTKNN): from each field_svT state, 12 battles with the
  command keys (b), 4 battles with the party at HP 1 (l) and 8 field runs (f). Tried first with
  the save the menu8 trace leaves (state svq): 22 of 24 passed.
- **Sync point 00:2FED** (code 43's figure, where 00:2FBF reads the OAM entry): zyqf03's field
  menu reached 00:2FBF at 2658 line 2, but the frame work (00:3549 from line 6: the walking
  figures 00:21A9, frame B, x bit 0 set) ran before the entry was read (00:2FED at line 68), so
  the figure kept x 18; the port placed it at once and the work set x 19 (one pixel, 96 px over
  11 frames). Falsified: without the point zyqf03 fails.
- **Pinned:** zyqf02 frame 1273, 3 px on lines 16, 18 and 28: the frame work's map animation tile
  bytes (1273 lines 14-49) written one by one while those lines were drawn (one plane new, the
  other old); the replay accepts such rows on two lines at most.
- **A lost battle** from svq: the members fall one by one, but the guest (Myron) at HP 1 is
  never attacked again within 14,000 frames; the "continue" question is still not reached.
- **Tests:** 1311 FFL3 tests pass.

## 2026-10-15 — Nine players' saves, lost battles (1.58.0)

- **The saves:** fantasyanime.com's nine Legend III battery saves (the user's pick; .sav, 8 KiB,
  slot 0 valid in each; kept in .private/saves, local): s01 Past (before the South Cave), s02
  South Tower, s03 Chaos Tower, s04 Floatland, s05 Pureland (the Talon, C6E3 3), s06 Pureland
  after Faye, s07 the Talon crew, s08 Underworld, s09 Mt. Goht. `sav.py state` made field_sva ..
  field_svi; members with abilities (+48) in s01, s06, s07, s08.
- **The save sweep** (zy, 24 per state, 240 with svq): all pass after the fixes below.
- **A save's state starting mid-frame** (svc: the field loop's first pass on line 8): the
  recording now starts at a field loop pass in vblank (`hook_vblank` for field_sv states, as
  field_start's); before, every trace from svc was a sound tick off from its first wait.
- **The frame wait's halt** (00:3A6D: `ldh [$95],a`, then `halt` until FF95 is 0): a wait entered
  at the end of line 143 has its count taken down by the vblank before its `halt`, which then
  sleeps to the next interrupt (in the bracket, the STAT handler 00:1F27 of the next frame and its
  frame work). The trace shows it as a wait that began on line 143 and ended in the next frame's
  visible lines after a STAT entry; `Game.onWaitHalt` keeps the port asleep past the countdown
  until the next interrupt's work is done (zyeb08, zyff03, zyfl00, zyif04: the save and battles).
  The replay counts such a wait in time in the frame after its vblank's.
- **The strip scroll** (01:5730): each pair is written in the hblank after its read, the last one
  before 01:5783: it shows from the line after the recorded time (+1; the Chaos Tower's strip,
  zycf00..07, two lines a pair).
- **The rolling tiles** (01:578C / 01:5798, map animation 07, 16, 18): their write back is
  00:20FF's hblank-paced copy, now at the recorded lines (`vramPaced`; zycf02: rows 21-31).
- **Lost battles** (zlNN from field_start; zyTlNN from the saves): a battle lost where the map's
  zone CA2D is 0 does not count (0C:4B6A skips CEDA = FF): the recordings put CA2D = 01 (an
  encounter zone) and the enemies' HP 9999; the "continue" question (0F:7F8F) is answered Yes.
  (The guest Myron of the early saves: dead at the start of the probes, not needed in the traces.)
- **Effect 5 (scans):** scans from svh (Underworld party) of the formations with Searcher /
  Medusa / Hydra, HP 9999 from frame 1300, 60,000 frames each, saw no table-2 ability; the save
  sweep's battles reach it all the same (1.58.1).
- **Falsified:** without `hook_vblank` the svc traces fail from their first wait; without the
  halt rule the four traces fail (wait RAM); with the strip's old offset or without the paced
  roll the Chaos Tower traces fail.
- **Tests:** 1532 FFL3 tests pass.

## 2026-10-15 — What the save recordings reach (1.58.1)

A coverage run of fuzzy (the 240 save traces) and fuzzc (zc, zl) alone: 1021 of 1472 functions.
Newly called against the earlier runs: effect 5 (convergeRoom, convergeNew, convergeMove,
convergeStep, convergeEffect), the "continue" question (continueQuestion), a member's ability and
its target (abilityTarget), the ship's return point (returnPointA, map10), followers (followerInit,
followerJoins, followerObject, placeBack), key items and special items used (keyItemUse,
specialItemUse, payPoints, textAfter). Still uncalled there: groupMove, the remaining ship2 lift
paths, cont.ts but followerObject, monsterShatter / monsterSwap / flashBand / noiseStep (battle
effects of the later bosses), menuitems learnSpell / askDiscard / listUp.

## 2026-10-15 — The game's reset, spell books, targets, Continue, long battles (1.59.0)

- **The game's reset** (zl04-07: a lost battle's "continue" question answered No, 0F:7F8F `jp
  00:0200`): the start code runs again from the battle's code (LCD off at line 91, C000-CEFF,
  D000-DFFF, FF8A-FFFC cleared, the title). `Game.onReset` hands the port's `Reset` to the
  engine's `fromStart`, which now begins with **sync point 00:0200**: the start code starts at
  the original's time, so its LCD-off poll catches line 145 of the next frame and the pending
  STAT and vblank come as recorded. Before, the sound ticked a frame off from the reset on.
- **Spell books** (zu00-2F: a bag of nine of book II, no member knowing a spell; 09:4C4C, the
  member chosen learns it, or the messages for one known / 24 known): **sync point 00:3054**,
  code 43's exit (the party figures placed on the learn screen, 00:2FBF): its stores land there,
  after a STAT taken among them and its frame work (the walking figures' frame B, 00:3549); the
  port collects them and writes them at the point (zu1a, 116 px over 10 frames before).
  **Pinned:** zu20, zu22, zu2e, 9 frames of 37 px each: there the STAT comes between the first
  entry's x and the rest (member 1's first entry ends one pixel off its others); the port cannot
  split the stores within the instruction stream.
- **Battle targets** (zg00-23: input weighted to the directions, the target moved over the
  members, the enemies, past the edges to a group or all, 0B:698D): all pass.
- **Continue** (zo01-09: the title's Continue with each player's save, the slot list, the game
  loaded by 09:4E0C and cont.ts, then a short walk; booted from the .sav, local): all pass.
- **Long battles:** zj00, the last battle from s09 (formation 7D, Sol then Xagor; the members'
  HP 9999 every 1500 frames; 90,310 frames): Xagor falls and shatters (02:5167 with CC5C & 3 = 3:
  the SCY bounces, the band flashes, the noise steps). zj01, formation 1D (Fireball + Busybody)
  from field_start: once a Fireball has fallen, a Fireball's battle ability 7E (table 2 record
  ff 05 08 13 14 ff: action 08, C9BD 13) copies a monster of its group into the free slot
  (0C:499B) and **effect 13** (02:4F3E) shows it, frame 14295. Ability 7E belongs to F-Drake,
  F-Liz., Salamand, Wisper, Fireball, Squid, Amoeba, Baby-D, Young-D, Remora, Diviner, Broomer,
  Witch, Tomtom, Jerrit, Maitie, Spectrat and Ashura; the earlier scans tanked every enemy from
  the start, so no slot was ever free (ffl3/scratch/effscan3.py). Effect 13's other sources:
  table 0 at B6 / B7 (no weapon), table 3 at 1D / A8.
- **A spell back to the bag** (zd00-23: the spell known and nine of its book in the bag; the spell
  picked, then the trash column: 09:4D1D): the question 09:6FAE (0B:6DB3, 09:4921) in 9 of 24.
  (The book of the spell with bit k of byte C551 + i is id 8 (i ^ 1) + k.)
- **The forge and the mix** (zr00-31: the shops' third option, Right twice and A, then A and the
  rows): the forge's list (01:7359, 01:741C) and the mix (01:7470: two picks of D2-D7, the
  result of 01:77E4) are reached; the shop sweep's input almost never got there.
- **Field spells where the saves stand** (zyTs00-04: spells 21 20 25 1B 2C, each alone): the warp
  back (1B / 2C, 01:41D6) from s02, s03 and s07: the closing band (01:5F39) and the map load's
  fade in for CA6B = 2 (01:5F9D). **Sync point 01:5FFB**, after the fade-in loop's sound tick: the
  loop polls for LY 0 right after the tick at line 143, and a tick that ends past line 0 makes it
  wait a frame more (zygs03 / 04: the original's frame 402 has no pass; the port ticked a frame
  early from there, every sound byte a tick off). The same rule as 01:5F12 (the battle wipe).
- **Jumps on foot** (zyTj00-03: the field from the saves with B weighted): hops, one- and two-cell
  jumps and a refused jump (01:48FF, zygj02).
- **Event 10's other subs** (ze108-ze10j: CA28 61, 71, 81-83, A1, A2, B1, C1, D1, E1, 31): the
  flags by the facing, the map's objects again, a member's status scene (00:15F7, the battle
  script 0C:5FC8 over the field), a return stack (01:664B), back to C6E9, off the vehicle, the
  place kept.
- **Falsified:** without 00:0200 zl04-07 fail (sound); without 00:3054 zu1a fails (116 px) and
  zu20 shows 79 px a frame instead of 37.
  Without effect 13 (02:4F3E throwing) zj01 fails at its wait 12363; without 01:5FFB zygs03 / 04
  fail; with 09:4921 or 01:7470 throwing zd02 / zd04 and zr16 / zr17 fail.
- **Coverage** (these traces with the earlier runs): 1388 of 1473 functions called (1.58.1:
  1351). Still uncalled: the ship's remaining lift paths (ship2.ts; the console traces zn were not
  in a coverage run yet), the step-ahead spell (01:40DD, spell 20 never cast from the menu), the
  pushable objects (01:46C5), menuitems listUp, the menu side of the text engine's rare codes
  (textcodes / textmore), and single helpers (events2, banim, benemy, bnative).
- **Tests:** 1782 FFL3 tests pass.

## 2026-10-15 — Pushed blocks, scrolled lists, yes / no, scene effects (1.60.0)

- **A coverage run of the console sweeps** (zn, zk) and the jumps (zyTj): the ship's lift-off
  paths (liftOff, liftOffScene, blink, tileAt, keyItemsGone, takeOff) are called; with every run
  merged, 1395 of 1468 functions before the traces below.
- **Pushed blocks** (zp00-02): map 77 has two blocks (object kind 0B, 06:6C58 records, shown with
  story flag 96); door 34 (event 0E) leads there from field_start. A breadth-first walk over the
  leader's cells in PyBoy (ffl3/scratch/pushbfs.py) found the way to the cell beside the first
  block; Left held pushes it (eight tries a push, CA26; events2 `pushObject`, 01:46C5's walking
  twin). zp01 pushes it more ways, zp02 walks on with the zf keys. All pass.
- **Lists scrolled both ways** (zt00-05: the rich party's full bag in Items, every spell in
  Abilities; Down past the page, then Up past its top): 09:4812 and 09:47E2 (`listUp`).
- **The yes / no code** (00:2F5C, code 3C): six texts use it (the ships' "Get on!", the Battle
  Simulator, a button); two are entries CD / D0 of 0A:4004, so event 16 shows them (ze168,
  ze169, answered Yes by the event plan's A).
- **Scene effects** (event 1E, ze1e8-ze1ed: CA28 19-1D, 24): the spawn sequences, the flashes
  (01:6125) and the tiles' fade (00:1329).
- **Audited unreachable:** 01:40DD (CA16 = 20 after the menu, the step ahead): spell 20 has no
  record (09:5D7F gives CE26 = FF, CE28 & 60 = 0: the buzzer) and 09:4D79 is its only way in.
- **Falsified:** with events2 `pushObject`, `listUp`, `yesNo`, `flashFrames` or `tilesFade`
  throwing, zp00 / 01, zt00 / 04, ze168 / 169, ze1ec and ze1ed fail.
- **Still uncalled:** map 01's push out of the vehicle (01:6374: in a vehicle, flags E8 / CF clear,
  C290 60-1AF and C2B0 200-37F; from sve / svf the vehicle reaches 133 / 179 cells and none of
  that box, ffl3/scratch/regionbfs.py) and A on the return point by the field check (ship2), a jump landing on a block (jump.ts `pushObject`), the rare text codes of
  textcodes / textmore (most only in texts a menu row never shows), the battle helpers of the
  monster-record natives (banim, benemy, bnative), and a few one-line helpers.
- **Text codes no text uses** (ffl3/data/text.json, 1639 scripts): 15 (00:27BF, the party restored:
  `restore`, `healAll`, `wordDown`) and 1A appear nowhere; 06 / 08 / 0B / 0C on the menu side only
  (`newline`, `scrollBox`, `waitA`, `pause`: the text side handles them in text.ts); 31 once, in
  battle message 0A of 09:78FE ("Received").
- **Tests:** 1801 FFL3 tests pass.

## 2026-10-16 — The milestone opens settled; the pinned frames (1.62.0)

Each item the data milestones left open, with its ruling. Where the port runs the game's own
routine, the evidence is the routine traced in a recording the port replays wait-exact (all of
WRAM, HRAM and the cartridge RAM compared at every frame wait, the screen at every frame); the
traced runs below used the port's replay with a write watch (`debug.test.ts`, `FFL3K_MEMW`).

- **M2 level-up: resolved.** The level threshold is 0F:79D4 (names.ts `levelValues`):
  (L + 4)(L + 1)² EXP for level L, kept per member at CD9D + 3k; the status screen's NEXT (text
  code 23, 00:2A7B) is that value minus the EXP (C504 + 0x60k). This fits M2b's own reading: L1,
  EXP 14, NEXT 6 = 20 − 14 = (1 + 4)(1 + 1)² − 14. The battle script raises the level (enc1's run:
  0C:4941 stores C905 into the member's entity +03 at D083) and the script's native 0C:4B9F
  (bnative.ts `slotsToC500`: 0x59 bytes of each slot D000 + 0x80k to C500 + 0x60k) copies it to
  the party record (C563) after the battle. Recorded and wait-exact: enc1
  (member 1 level 1 → 2 at wait 8308) and zj00 (level 28 → 29).
- **M4 GP source: resolved.** Battles pay GP through the battle script, not the 4A19 record (which
  M4 tested): per enemy group 0C:5826 computes C978 = C975 (the group's count, D882 + group) ×
  C9A2 (entity +66: byte 2 of the 0B:470D record, copied by 0B:45CB to D6E5-D6E7 = +65..+67) ×
  C97E (10 in enc1's run, set by the script); 0C:5841 sums C978 into C985 and 0C:592C stores the
  new total at C6E0. enc1: groups of 2 × record 78 (b2 = 12) and 2 × record 04 (b2 = 0E) give 360 +
  280 = 640, GP 960 → 1600 (wait 7803), the entity bytes read from the trace (D365-D367 = 0F 12 AA,
  D465-D467 = 0F 0E FF). The prologue and Talon battles M4 used paid none. The 470D byte stays
  `hypothesis` in the schema until a controlled change is recorded (the data package is unchanged).
- **M5 shop prices: resolved.** 00:2E54: for item ids below D2 the price is the word at 01:7E4F +
  2·id (bank 01), else 0 (shop.ts `itemPrice`); the clinic's price is computed (01:7731), the GP
  arithmetic is 01:7778 / 01:7794 with the 999999 cap (01:77CA). **In-game shop use: resolved.**
  The shop sweep zs (64 traces: buying, selling, forge, mix, clinic, services) is wait-exact; 17
  of its traces change GP at a purchase, a sale or a clinic visit (e.g. zs16 120 → 70, zs07 999990
  → 974990, zs47 999990 → 999999 at the cap). The prices are not exported in ffl3/data (accepted:
  the importer and the port read them from the ROM as the game does).
- **M6 per-map tile overrides: resolved in the port, accepted in the export.** 00:0535 loads the
  tileset (07:7F5B), 07:7FBC (map 5D: four extra tiles from bank 05), then 01:5501 (maps 0A / 0B),
  01:6092 (map B4, the Talon in the hangar) and 01:6082 (maps 02-05: 05:7B90 → 9600)
  (mapload.ts); 01:54A0's map animations run every frame in all 36 modes. The field sweep (425/425,
  every map entered) is screen-exact. `gfx-export` still draws the base tileset for those maps:
  a known limitation of the exported pictures, not of the game data or the port.
- **M6 Xagor's picture: resolved.** It is not a sheet picture: Xagor appears only by the last
  boss's transformation (02:50ED, effect 12), whose 0E:7D63 draws the new picture from 0x5A0 bytes
  at 0E:6735 through the mask 0E:7D9A (banim2.ts `newMonsterPicture`). trans1 and xagor1 replay
  wait-exact and screen-exact (1.51.0). The export leaves it out (accepted, as above).
- **M7 timbre: accepted as a known limitation of the comparison.** The sound driver 0F:4006 is
  ported (sound.ts) and its whole state, CB00-CBFE and FFBB-FFC5, is compared at every frame wait
  of every trace (SOUND_KNOWN empty since 1.49.1); the envelope and wave selections live in that
  state. The values the driver writes to the APU (FF10-FF3F) are not compared, because PyBoy reads
  them back masked; the Python model (ffl3kster.music) stays a pointer and timing model.
- **Pinned frames (exact expectations, any change fails; fuzzlib.ts `RESIDUAL`):** zf13 frame
  2834, 59 px on lines 19-23 (x 64-150) of a menu text row drawn while a frame work crossed the
  vblank (waits at 2833 and 2839). Re-examined: of the 59 pixels the original's frame equals the
  next frame on 24 and the previous on 11, and on 24 neither: it shows a partial state of the
  original's stores, which the port writes at once; matching it needs a per-store line time the
  recorder does not take for that code (as zk43). Root cause known, not reproduced; kept pinned,
  state identical. Also pinned with their causes in the entries above: zk43 2211 (15 px),
  zyqf02 1273 (3 px), zu20 / zu22 / zu2e (9 frames of 37 px each).
