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
