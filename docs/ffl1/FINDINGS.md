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

## 2026-10-12 — Item/ability table (M2)

- Code 06:5BF2 returns byte E of item D from **06:7700 + 8×D** (bank 06); 256 records end at 06:7EFF,
  just before the bank's jump stubs at 06:7F62.
- The battle dispatcher 06:448F reads byte 2 and jumps through **06:403A** (49 pointers, sorted,
  06:44B0–50B7; entry 49 is not code). Legend II has 50 handlers.
- Names: item id N uses name entry 200+N of the shared table 05:4000 — 7 characters plus a byte
  that is the item's **default uses** when it is given to a hero.
- Controlled changes (`python tools/ffl1/item_change.py`):

| Change | Result |
|---|---|
| KATANA (0x24) byte 3 50→9 | ASIGARU's ability uses (slot D096) 50→9 |
| CONTROL KATANA name byte 8 50→9 | D096 stays 50 |
| LONG (0x21) byte 4 3→30 | the hero's first hit kills ASIGARU (19→0; was 19→9) |
| CONTROL AXE (0x22) byte 4 4→40 | no change |
| KATANA byte 4 6→30 | ASIGARU's hit on the hero 12→43 |
| KATANA byte 2 6→3 | ASIGARU's KATANA hit does no damage |
| LONG name byte 8 50→7 | a new HUMAN M starts with LONG ×7 (party record CC10) |
| CONTROL LONG byte 3 50→9 | starting LONG uses stay 50 |
| STRONG (0x0C) used from Abil | Str 8→11; byte 4 2→9 gives 8→18; byte 5 0x14→0x50 gives 8→14 |
| STRONG byte 2 0→5 | no change (field use ignores the handler) |
| AGILITY (0x0D) / HP200 (0x0E) | Agl 4→8 / max HP 60→76 |

- Not yet derived: the exact stat-item formula (the gain is byte 4 plus a random part that grows
  with byte 5); bytes 0 (beyond bits 6/7, which code 06:57B6 uses for passive attribute masks),
  1, 6, 7.
- Prices are not in this table; they are expected with the shop data (M5).
- Two "uses" bytes differ for 7 items (e.g. XCLBR and MASMUNE: monster table FE, hero default 50).

## 2026-10-12 — Dialogue text encoding (M3 groundwork)

- The intro text was located by a pattern search for its literal letters with unknown dictionary
  codes (`I`, `b`, `e`, `a` at fixed distances): 05:7758. It decodes completely with:
  0x50–0x7F → dictionary pairs 0–47 and **0xC0–0xE7 → pairs 48–87** (two blocks around the
  letters), the 88 pairs stored after the name table at 05:4E40 (name index 456); 0xF0 `.`,
  0xBF `,`, 0xBE `'`; 0x00 end, 0x0A / 0x0D line breaks; other 0x01–0x4F codes take arguments.
- Battle messages: strings at 02:7503–7858, pointer table **02:7860** indexed by the message
  number passed to 06:5A71 (0x0C "No damage", 0x11 "… defeated", 0x2E "you found meat of", 0x2F
  "… changed to"); probable (index alignment checked on three messages).

## 2026-10-12 — Meat drop, rewards and meat transformation (M2)

- Battle end (06:5240 → loop 06:5272 over the 27 enemy indexes) calls **06:517A** per enemy:
  skip empty slots (slot +2 = FF); if `rand(0..7) < b0 & 7` show the meat once per battle (D4B2,
  06:5155 → 06:5F31); then add the GP of the record's b6 low nibble from **06:72A4** (16 × BCD
  hi/lo). This revises two monster-record fields from hypothesis to verified:
  - b0 bits 0–2 = **meat chance in eighths**. With the same random value (4) from the same state:
    b0 = 7 → "you found meat of ASIGARU" (the HUMAN hero cannot eat: "Nothing happened"), 4 and 1 →
    no meat, 0 → no roll. 149 monsters have 3, 44 (humans, robots …) 0, 7 ids 7.
  - b6 low nibble = **GP class**: ASIGARU 1/3/0/7 → "you got 40/240/0/1200GP".
  - The "HP class" table therefore has 40 entries (06:7254–72A3); the GP table follows.
- RNG (00:07D3, via the 00:016B entry): the caller's return address (low + high byte, & 0x7F) picks
  one of 128 counters at C300–C37F; the counter is incremented and indexes a 256-byte random table
  at CB00; 00:07EC scales it to the requested range. Each call site therefore has its own stream —
  different from Legend II's RNG model (docs/ROM_MAP.md).
- Meat transformation **00:0D9C** (called through 00:01C8 from the meat screen; result message
  0x2F "… changed to", or 0x22 "Nothing happened"): the eater must have party byte 0x0A bit 6 (set
  for the monster types). meat family(id) = [0, 7, 18, 27][(b>>4)&7] + (b&15) with b = 02:7900+id
  (group starts at 00:0E16); result row = 02:6FD3[29 × eater family + meat family] (25 × 29, FF =
  nothing); level = max of the low nibbles of 02:7438+eater and 02:7438+meat; new monster =
  02:72A8[16 × row + level] (25 × 16); the new monster's record is copied in (00:061F).
  The three tables are contiguous: 6FD3 + 25×29 = 72A8, 72A8 + 25×16 = 7438.
- Controlled changes (`python tools/ffl1/meat_change.py`; CLIPPER hero, ASIGARU b0 = 7):

| Change | Became | Predicted |
|---|---|---|
| none | LIZARD (66) | 66 |
| result [0][20] 11→5 | WOLF (30) | 30 |
| family-level [11][0] LIZARD→WOLF | WOLF | 30 |
| CONTROL result [0][21] →5 | LIZARD | 66 |
| ASIGARU level 0→9 | DINOSAUR (69) | 69 |
| ASIGARU family byte 0x1D→0x13 (family 20→10) | WERERAT (72) | 72 |

- Falsified on the way: *"the meat family index is the result-row index"* — FLY's meat family is 15
  but FLY is in result row 0; the two numberings differ.
- Human growth: stat items (STRONG, AGILITY, HP200/400/600) raise the stat when used (M2 item
  section). Mutant growth: not yet located (a hunt of MUTANT battles is running; see progress).

## 2026-10-12 — Mutant growth (M2)

- A MUTANT M hero learned BARRIER (0xF2, 5 uses) after the 5th battle of the make-states route
  (party record +0x11/+0x12). Frame search plus function-entry hooks: the write follows 06:539E.
- **06:539E** (per party member, after a won battle): skipped unless the member is alive (slot +2
  bits 0–1 clear) and slot +0 bits 6–7 are `01` (the hero slot's class bits; how they are filled
  for each hero type is not checked yet — the party record's +0x0A is 0x23 for MUTANT M, 0x43 for
  CLIPPER, 0x83 for HUMAN M). rand(0..255) is compared with the cumulative thresholds **06:7F00**
  (23 45 63 75 87 8F 93 FF): the first threshold above it selects one of eight handlers
  (**06:53DE**: 53EE, 542F, 546F, 5468, 545A, 5461, 549A, 5504). Handler 0 picks an ability from the
  32 (id, uses) pairs at **06:7F0F** (index = number of consecutive rand(0..100) < 90 draws, wraps
  at 32) into one of the four ability slots (rand(0..3)). Handler 1 adds to max HP (range from the
  nibbles at 06:7F0A, capped at 999); the others are stat changes (probable, from code).
- Controlled changes (`python tools/ffl1/mutant_change.py`):

| Change | After battle 5 |
|---|---|
| none | slot 2 = BARRIER (F2) ×5 |
| 06:7F0F entry 1 F2→86 | slot 2 = TELEPOR (86) ×5 |
| CONTROL entry 5 B9→86 | slot 2 = BARRIER ×5 |
| threshold[0] 0x23→0x00 | no ability learned within 8 battles |

## 2026-10-12 — Text (M3)

- Two interpreters share the character set and the dictionary (copied to RAM C800 at run time;
  0x50–0x7F → C800 + 2k, 0xC0–0xE7 → C860 + 2k):
  - **Engine text 00:0911** (battle messages via 00:088A from 02:7860, UI templates via `rst $08` /
    00:08BE from 03:7080): bytes ≥ 0xE8 and 0x80–0xBF print; 0x40–0x4F print tile + 0x30 (icons);
    0x00–0x3F jump through **00:0CE2** (64 entries; 00–09, 0B, 0C, 0E–12, 14–1B end the string).
    Argument counts were read from each handler (calls to the byte fetch 00:0901, directly or via
    00:0C4A / 0C69 / 0BCC / 0A4E): 20 22 23 25–2C 32 36 38 3A 3C take one byte, 21 and 35 two, the
    rest none. 0x3D appears once (UI entry 11, outside the jump table) and is taken as one byte.
  - **Dialogue text 00:0EBA** (a small stack machine at C900): 00 end, 01/02 xx yy insert, 04 return,
    0D line break, 11 xy zz condition (x = 0–3 picks the test at 00:0FBD; each reads one more
    byte), 12 hi lo (string 05:7B10 + 2 × index, so index 16 = table entry 0), 13 wait for a
    button, 14/15/1A, 16 xx wait xx frames, 19 xx speaker.
- Structural check: parsing each entry with these counts ends exactly where the next entry starts
  for 79/79 battle messages, 50/50 UI templates and 254/254 dialogue strings (entry 76, the ending,
  is 1,091 bytes long). Two falsified readings on the way: "0x11 takes one byte" (entries 175 and
  203 misaligned; the sub-handlers each read another byte) and "0x0D is a glyph" (on screen it is a
  line break).
- Round trip: all 386 strings re-encode to the same text; 365 to the same bytes (the game does not
  always choose dictionary pairs greedily).
- Reinsertion in PyBoy (tests/ffl1/test_text_emu.py): dialogue 249 "Guild." → "Tower" shows in the
  NPC's window; battle message 13 " {31} damage" with 'a' → 'A' shows "10 dAmage"; UI template 7
  "START" → "BEGIN" shows on the title screen after a cold boot.
- `python -m ffl1kster text-export` writes the decoded tables (processed data).

## 2026-10-12 — Encounters (M4)

- The random battle reaches the battle command (00:1BBE: FFBD = C3AA) through the event executor
  00:16E0 with C3A9 = 8 (battle) and C3AA = area; a hook on 00:1BBE gave C3A9 = 0x08, C3AA = 0x13
  for the make-states battle. The writer is **00:2266** (each step):
  zone = C5C2[index] (four zone slots per map; the index is the top two bits of a byte passed in,
  probably the metatile attribute — open, M5), zone record **06:6400 + 8 × zone** = rate + 7 area
  ids; encounter when rand(0..e) = 0 with e = (C5B3 − 1) × 8 + rate (capped at 255); the area slot
  comes from rand(0..255) against 80 40 20 10 08 04 00 (00:22B5) — weights 1/2, 1/4 … 1/128.
  Area id bit 7 selects the area's alternate formation (it is copied to FFBD).
- Falsified on the way: *"encounters come from metatile attributes"* — the tile under the hero
  (metatile 0x1B, attribute 00 4E) carries no command; tile commands are touch events (M5).
- The zone table (141 records) is followed directly by the area table (128 × 5) and then the monster
  table; the formation table (31 × 3) ends where the ability lists begin.
- Controlled changes (`python tools/ffl1/encounter_change.py`, same world state and route):

| Change | Result |
|---|---|
| none | step 68, FFBD 0x13, ASIGARU |
| zone 0 slot 4 0x13→0x12 | step 68, FFBD 0x12, ZOMBIE (area 18 formation 2) |
| zone 0 slot 4 0x13→0x93 | FFBD 0x93, SKELETON ×2 (area 19 alternate formation 6: 1–3) |
| CONTROL zone 1 slot 4 →0x12 | unchanged |
| zone 0 rate 0x18→0x02 | battle at step 11 |
| area 19 formation 2→3 | LIZARD, SKELETON, ASIGARU (formation 3 = one of each) |
| formation 2 `00 00 11`→`00 00 33` | ASIGARU ×3 |
| CONTROL formation 1 → `33 33 33` | unchanged |

- Drops: Legend I enemies leave meat (record b0 bits 0–2) and GP (record b6 low nibble); both were
  verified in M2. No item drops were found in the battle-end code (06:5240).

## 2026-10-12 — Maps, events, warps, shops (M5)

- **Map table 02:58D0**, 200 pointers; the warp routine 00:22CC → 00:231B reads a variable-length
  record: b0 → FFF8, b1 → FFF9, b2 graphics set (00:3F97 via 02:4820), b3 attribute set
  (00:2403: 02:4840 + 64 × b3 → DF80, 32 metatiles × (e, d)), b4–b5 layout pointer (bank 03),
  b6 flags B, b7 → FFE0, then — if B bit 7 is clear — the sprite set (FFFA, 00:24F8 via 02:5240)
  and the event list pointer (FFFB/FFFC), then the three zone slots C5C3–C5C5 (each absent when
  B bit 6/5/4 is set). Parsing all 200 records this way consumes 02:5A60–62E3 exactly (every
  record ends where the next stored one starts). Map ids below 0x18 update the floor counters
  (CCC6 position, CCC5 maximum: "Position 1F / Maximum 1F").
- **Layouts** (00:153C, bank 03 command stream into the 64-wide buffer at D000): the routine was
  run on the SM83 oracle (ffl2kster.sm83, used unchanged) and matched PyBoy's buffer for the first
  town and the world map; the Python port `ffl1kster.layout` matches the oracle for all 110 distinct
  layouts (`tools/ffl1/layout_verify.py`). One reading was falsified on the way: the 0x80
  rectangle does not restart its tile at each row — the tile keeps counting (87 layouts differed
  by 1–4 cells until that was fixed). Two more details come from the code: some additions are
  low-byte only (`add l / ld l,a`), and the buffer starts filled with metatile 0x1E.
- **Event lists** (00:2586): count byte, then 7-byte object entries (flag, presence range, x, y,
  command, parameter, sprite), 3-byte copies of the previous object (0x80–0xFE), 7-byte bit-flag
  entries (0xFF), ending with 0x81. All 99 lists parse (498 entries); they are stored back to back
  (two before the map table at 02:585E/58B8, the rest from 02:62F0). RAM keeps 16 objects at C55C
  (5 bytes: y, x, command, parameter, sprite).
- **Event commands** (00:16E0, C3A9/C3AA): 0–2 dialogue with message number N = command × 256 +
  parameter (05:7B10 + 2N, so N = 0x109 is dialogue entry 249); 3 chest; 4 facility (F0 inn,
  F1 house of life, F2+ guild and others, other values = shop index); 5/6 warp to index parameter
  or 256 + parameter (FF = back to the previous map, CCC2–CCC4); 8 battle (M4).
- **Warps 02:52D0**: (map, x, y) × 474 — the table ends exactly where the first event list begins;
  warp 0 = (map 1, 18, 36), the first town's start.
- **Collision** (00:13FA): metatile attribute e bit 6 = blocked event tile, e & 0xB0 = free,
  otherwise blocked when d has the movement-mode bit (00:1538: 01 02 04 08; on foot = bit 0).
  A breadth-first navigator using this rule (`ffl1kster.navigate`) reaches the weapon shop at
  (29,18) from the town start; probable (all planned routes walked, no failed step).
- **Shops**: 05:7D10 + 10 × shop (item ids, FF empty); **prices** 05:7E10 + 3 × item, BCD
  (items 0x00–0x7F; the monster abilities 0x80+ have none).
- Controlled changes:

| Change | Result |
|---|---|
| map 88 record byte 8 (zone slot 1) 00→08, re-entered from the town | zones 9C 08 01 04; step 68 battle in area 0x1E: GARGOYLE ×2 |
| CONTROL map 87 record byte 8 | unchanged (ASIGARU) |
| town object (x 0x15, y 0x21) parameter 9→8 / 9→0 (town loaded fresh) | the NPC says dialogue 248 / 240 |
| LONG price 000132→000177 | paid 177 (was 132) |
| CONTROL AXE price | paid 132 |
| shop 0x16 slot 0 LONG→KATANA | "You get KATANA", paid 2060 |

- Open (hypothesis): map b0, b1, b7 and flag bits 0–3; event commands 7 and 9–D; the zone slot
  index from the metatile attribute (probable from code 00:2266's caller).

## 2026-10-12 — Graphics (M6)

- **BG tilesets** (00:3F97, graphics set = map record b2): set record 02:4000 + 0x82 × set — two
  bytes naming four 1 KiB blocks of bank 01 (staged as 256 tiles), then 128 tile indexes →
  VRAM 8800–8FFF. Decoded sets equal VRAM for the first town (128/128) and the world map (124/128;
  tiles 0–3 are the animated water). The 16 sets end at 02:4820, followed by their pointer table
  (16 × 2) and the 40 attribute sets (02:4840–523F) — contiguous.
- **Metatiles**: metatile m in the map buffer is drawn as BG tiles 0x80 + 4m … +3 (TL, TR, BL, BR).
  All 90 visible metatiles match in the town and in the world map (the 32 × 32 BG ring is
  addressed with a camera-dependent offset).
- **Sprite sets** (00:24F8, map record sprite byte): 02:5240 + 6 × set, six 256-byte blocks of
  01:6000 + 0x100 × n → 8100–86FF, plus 01:7F00 → 8700; equal to VRAM in both states. 23 sets
  (02:5240–52C9) precede the warp table.
- **Font**: 03:7100, 1bpp, 119 characters (codes 0x80–0xF6); equal to the battle screen's font
  tiles at 9000+ (0xF7–0xFF there are window frame tiles).
- **Monster pictures** (07:72C2; found by watching the picture pointer appear in the battle
  struct D81F and the multiply helpers' callers): the monster's family byte 02:7900 + id (the same
  byte the meat code uses) gives class g = bits 4–6 and index i = low nibble; picture = 04:base[g]
  + i × tiles[g] × 16 with bases 02:79D2 (4000, 4700, 5D80, 7400, 7D00) and tiles 02:79EA
  (16, 24, 36, 48, 48); class 4 ends exactly at the end of bank 04. Widths 4, 4, 6, 6, 8 tiles
  (class 1 seen on screen as 4 × 6; the others give coherent pictures). VRAM 8800 equals the
  prediction for ASIGARU, for SKELETON (area swap) and after a controlled change of ASIGARU's
  family byte (index 13 → 2) (`tools/ffl1/picture_change.py`). One slip on the way: the tile counts
  were first read three bytes too late (02:79ED), which only showed up as out-of-bank pictures.
- `python -m ffl1kster gfx-export` writes font, tilesets, sprite sets, the 200 monster pictures
  and renders of all 200 maps (processed data).

## 2026-10-12 — Music (M7) and the data package

- Sound driver, bank 07: 07:4000 init, 07:4003 per-frame update (called from the interrupt).
  Each frame CEC2 += tempo (FFEA); every time it passes 60 the driver ticks (07:40CD channel
  output + 07:44BC sequence reading). A new song starts when FFE0 ≠ FFE1 (07:4059): song table
  **07:462F**, 6 bytes = pointers for pulse 1, pulse 2 and wave (structs CE00/CE20/CE40, 32 bytes).
  18 songs; the first channel data starts right after the table (07:469B).
- Sequence commands (07:44DC): 00–DF note (high nibble pitch, low nibble duration index into
  07:4403: 60 48 30 24 20 18 12 10 0C 09 08 06 04 03 02 ticks); E0 tempo; E1–EF channel byte +0B;
  F0–F4 octave; F5 xx; F7 xx envelope (slot from the top two bits, 07:4629); F8 xx wave pattern
  from 07:69BD (16 bytes → FF30); F9–FB loop counter 1–3; FC repeat while the counter runs;
  FD jump when it is zero; FE jump; FF end. Envelope tables 07:6870 / 68D3 / 692F and the
  frequency table 07:4412 are read by the output side (probable; timbre not modelled yet).
- Decoder check: the three channels of every song loop together (equal loop lengths, or whole
  multiples where a part repeats) — 17/17 songs with music.
- Timing in PyBoy (`tools/ffl1/music_timing.py`): title song 14 (tempo 30, loop 384 ticks):
  predicted 768.00 frames, measured 768 on 14 consecutive loops; town song 1 (tempo 55, 2400 ticks):
  predicted 2618.18, measured 2619, 2618, 2618; battle song 8 (tempo 65, 2304 ticks): predicted
  2126.77, measured 45 + 44 + 44 + 1994 = 2127 per loop (the watched note occurs four times).
- **Data package** `ffl1/data/` (`python -m ffl1kster export-all`, 248 files): monsters, items,
  encounters, meat, text, maps (records, event lists, warps, shops, prices, decoded layouts,
  attribute sets), music, and graphics (font, tilesets, sprite sets, 200 monster pictures). Like
  Legend II's `data/` it is generated locally and not committed (`data/` is gitignored); the test
  suite regenerates it and compares every file byte for byte.

## 2026-10-12 — Battle (port P1/P3, from the PyBoy battle sweep)

- 06:4D21 (handler 1E, several hits): draws a random number and then adds e (the product / 2),
  not the number it drew (4D71 `ld d,0; add hl,de`): verified, a port adding the random value
  differs in the sweep.
- 06:4966 (handler 0E): 497A loads l from the target's +07 value before testing bit 2 at
  [hl - 5], so the bit tested lies at (h << 8 | value) - 5, not in the target's record (probable
  bug; ported as is, frame-exact in the sweep).
- 07:75C6 (death of a picture-type-2 monster, the CREATOR): the closing fill at 9806 is meant to
  blank (a = 7F) but `ld a,$c3; ldh [$40],a` inside the loop leaves a = C3, so 8 rows of 4 tiles
  become tile C3: verified by bsw21 (the trace shows C3).
- 07:7A0E (screen script 8) is used by no item: the effect byte (+6) high nibble of every item is
  0-7, 9 or A (ACID 40 gives script 4 = 07:7895 and TORNADO 50 script 5 = 07:78F9, as traced), so the routine is unreachable in play.
- Picture types (bank 02 7900[id], 07:71AC): 27-31 and 40 give type 1 (the boss fall 07:7510), 32
  (only CREATOR, id C7) type 2 (07:75C6), else 0.
- 00:0224 meant to clear NR50-NR52 (FF24-FF26) with `ld l,$24; ld [hl+],a` x3 but never sets h:
  at power-on h = 01 (boot ROM), so the writes go to 0124-0126, the MBC2 ROM bank register (bank
  1); after a defeat h is what the battle left. Harmless in both cases (the RAM it might hit is
  cleared next). The ROM-bank and sound effects are undone by the following code.
- A defeat restarts through 00:0101 -> 00:0224 with C425/C426 = 1B E4 still set, so C427 = 0
  (warm; verified by defeat1: the mutated value differs at the first wait); a power-on gives C427 = 1
  (code; who reads C427 is not yet traced).
- Nested events: an event started by a text (dialogue codes 00-02, 00:0ED2 -> 00:16E0) runs 0x10
  bytes deeper on the stack; a battle started that way saves SP = CFEC at 06:4009 (verified,
  evt9_069_2112), CFFC from the field loop's own event.
- 06:5A37: a monster none of whose abilities is usable gets the action FC (06:5A68), whose
  handler 06:5098 makes it flee (status FF, message 4F) unless the formation is a boss's (D3E6;
  message 11) (traced: flee2; the boss branch from code).
- Emulator note (not the game): PyBoy draws overlapping objects from the lowest priority up, so
  an object with the behind-background bit over a non-zero background pixel lets a lower object
  show through; on the DMG it masks it. Traces show PyBoy's version (evr1_080_1517).
- Text numbering: 00:3475 reads text n at 05:7B10 + 2n; the dialogue table exported in M3
  (05:7B30) is texts 16 and up (entry k = text k + 16). Numbers 0-15 point outside the text bank
  and are never used. Object and event parameters use the text numbers (verified: talk event 0x56
  shows entry 0x46's text and starts its battle).
- Monsters flee: verified by flee2 (REDBULL, HORN spent after 10 uses -> action FC -> 06:5098:
  "ran away", status FF).
- The battle dissolve 00:1BBE (1.52.0): its 10,240 stores (00:1BD4 / 1BD7) run inside the VRAM
  bracket, so the code gets the CPU only in the lines' hblanks (00:069F) and the dissolve shows
  over ~18 frames (fsw097: 129-147; fsw101: 108-126), 116-640 stores a frame, a few each line.
  Recorded per store (`vw` in waits.json: frame, LY, address) and replayed at those line times,
  the two residual frames match; one frame or 4 lines off fails them.

## 2026-10-14 — The input sweep (1.53.0)

- Coverage first: a V8 coverage run of `@ffl1k/core` over every trace showed 665 of 740
  functions called. Field item uses (items.ts 8/30), meat, the equipment and sphere windows,
  selling (the BCD price routines), the save write and others had never run against the original.
- The input sweep (`tools/ffl1/traces.py fuzz_sweep`, `ffl1-parity/test/fuzz{b,f,s}.test.ts`):
  seeded random single-button input from the first town's field loop with random items poked
  into the party (8 slots each, uses from the item table) and the bag (CC7C, 8 pairs), random
  classes, HP and stats, GP 120 / 50000 / 999999 (BCD): ybNN (48) a battle (area by the seed),
  yfNN (48) the field of a map warped to (FIELD_SWEEP), ysNN (41) a facility (command 4: shops
  00-18, inn F0, house of life F1, guilds F2-FF).
- **06:4938's early exit** (the damage at or below 0: "no damage") is `pop hl; ret`: it drops its
  caller's frame and leaves HL = the popped return address, so 06:4AA5 / 4A53 / 4AB1 go on to
  06:41D6 (the death check) reading the "HP" at 06:4A50 (ROM: C3 44, not a death); 4966 and 4AFC
  return with HL = 499D / 4B0E. The port had left HL on the target's HP, so a target at 0 HP
  "fell" a second time (yb16: the message, then every action after it).
- **The field direction read** (00:209D) comes after the objects' moves (00:1E26), whose CPU time
  can take the original past the next frame's tick (line 0): it then reads that frame's buttons.
  The trace records each read's time (`polls`); a read after the next tick resumes the port's
  code after it (TICK), and a TICK before a frame's line 0 now ticks with that frame's buttons
  (`Game.onTickInFrame`). ys00 / ys25: a step taken on a released direction.
- **The VRAM bracket's helpers** (00:00A3 / 00AC / 00B5 / 00BE: the stores 00:007C / 0085 / 0091
  / 009A) run in the lines' hblanks; their stores are recorded (`vw`) and the port's are applied at
  those lines (`Game.beginPacing` from 00:043D to 00:044E, only for those stores and the
  dissolve's). The menu's tiles copied over three frames were the after-busy frames of yf21 / 24 /
  30 / 40 / 44 (1,120-2,120 pixels). Pacing every bracket store (other routines included) misplaced
  records and was dropped; the screen's metatiles (00:14F0) paced too changed nothing (mutation).
- **The window** as PyBoy (and the DMG) draw it: it starts on the first line where LY = WY and
  stays to the end of the frame whatever WY becomes; the shared renderer took y >= WY per line. The
  FFL1 rig latches it (`Rig.windowLatch`): the menu's close (00:26CE) turns WY to 90 in mid-frame
  and the box stayed on screen to the frame's end (yf06 frames 292, 3674, 3792).
- **The menu's close** (00:26CE): the tileset, the layout and the attributes take the original
  frames of CPU time before the window goes off (00:26F1) and the palettes on (00:3DE0); the trace
  records 00:26F1 (`points`) and the port's code goes on in that frame, its LCD register writes
  landing on that line (`Game.untilPoint`, `schedule`).
- **The wave** (00:3DF5, the teleport item 00:3777): 60 rounds of per-line SCX from C600 through
  the STAT handler 00:3E8D; a round (the 144-byte table, the frame tick) takes the CPU one frame
  or two. The trace records each round's start (00:3E35, FFCB = 0) and the end (00:3E7B); the
  port's rounds land there (`Game.schedule`; the table stores' own lines changed nothing). yf06: SCX F4 / FFCB 90
  in the port against F0 / 20 (the last round two frames long) left the screen 4 pixels off
  until the next map; now state-exact.
- The wave's STAT handler taken late in its line (held by the frame tick): written in hblank, its
  SCX missed the line in PyBoy (recorded at 00:3E9B as `waveLate`, the port's write then lands
  before the next line; yf36 frame 4103). Open (pixel level, state identical): yf06 frames 2914 /
  2915 and yf36 4102, one line each written late in mode 3, which PyBoy draws with the old SCX or
  the new by the line's length (54, 13 and 70 pixels; kept as exact expectations in the test).

## 2026-10-15 — Targeted sweeps (1.54.0)

- **What was left:** after the input sweep, the coverage run (`@ffl1k/core`) still showed 42 of
  752 functions never called: the field uses of most items, the growth of mutants, the meat, the
  reaction items, the spheres, the title's sound test and name deletion, Continue, the sale of a
  worn item. Each got a recording that reaches it (`tools/ffl1/traces.py`): yiXXv (62: every
  field-usable item 00-17 and ability 80-86 in every slot and the bag, members hurt and with a
  status, input weighted to A and the menu), ygNN (16: won battles in area 16, two monsters (flags
  43) and two mutants (flags 23; the battle record's race +00 & C0 = 40), the 128 random counters
  C300 seeded per trace), yrNN (12: the reaction items 33 / 79 reflect, CD-CF inflict, D0 spikes
  chosen each round), yvNN (12: shops with every item worn), title2 (the cursor, B eleven times
  with Down + Start held: the sound test), newgame2 (a letter, its deletion, B with the name
  empty), reset1 (save, A+B+Select+Start, Continue), sphere1 / sphere2, empty1. All pass.
- **Soft reset** (00:071C `jp z,$0224` in the frame tick): the port threw `SoftReset` to its
  driver (the web player rebooted; the replay stopped). Now `Engine` restarts the code itself
  (`Game.restart`: di, the boot coroutine; a reset from inside the code unwinds it); the frame's
  lines go on as in the original. The direction reads made by the port's code before the reset
  (it runs at the frame's start, the original's reset comes at line 0) are dropped in the replay
  (`Game.onRestart`). reset1.
- **The mutants' uses change** (06:549A): + or - were taken as a random 0..field 3 / 4 (06:54F5's
  e); 06:54D2 / 54E0 reload a after the random call, and 00:07D3 keeps de, so the change is the
  item's field 3 itself (the random draw only advances its counter). yg02.
- **The spheres' quake and shake** (00:1779 / 00:1793, called from the bag's sphere row 00:2857 /
  00:2889) end with `jp $1AB8`: C5BD / C5BE / C3AB cleared and the bank C5D0 selected. The
  menu's calls lacked that tail (FF8B 2 against 0, FF94 1 against 0). sphere1, sphere2.
- **The member choice** (00:295F): on an empty slot it asks again with bc = CC00 + the record
  offset as the menu's page window (FFF6 / FFF7: CC / 3E for slot 2); the port kept its previous
  b / c. empty1 (the menu's Save, then Abil, slots 1-3 empty).
- **The spheres' menu** (00:2820) is asked again with de = the end of the object list placed by
  00:2586 (FFF4 / FFF5 = 63A7), e = a + 5 when C5E2 bit 7 skips the placing. sphere1.
- **The teleport wave started late** (yi860 frame 289, yi861 2746): a round whose frame tick ran
  past the poll's vblank starts on line 0, and its 144 table stores race the STAT handler (260 T
  of each line; the loop 184 T a byte at shift 3): lines 1-13 read the old table. The trace now
  records the line of each store of such a round (`waveStores`, from 00:3E4F) and the port lands
  each store on its line.
- **PyBoy's drawing of a line** (the residual frames yf06 2914 / 2915, yf36 4102 and 13 more in
  the teleport traces): PyBoy renders a line when its mode 3 ends (lcd.py: the switch to mode 0)
  with the SCX of that moment, catching up to the CPU's cycle + 4 of `ldh [$43],a`. The recorder
  no longer guesses from the mode at 00:3E9B: after each frame it compares the SCX PyBoy drew
  each line with (`tilemap_position_list`) with the value the handler wrote for it, and records
  the lines drawn without it (`waveLate`). Legend I has no residual frame left.
- **Still unrun:** the reflect reaction (06:460E, with its message pair 06:40B2): the reaction
  sweep reached inflict (CD-CF), spikes (D0) and the counter (06:4636: an attack that did no
  damage), but no damaging attack on a member holding 33 / 79 yet (area 16 and Defence 1 tried).
  rowMove (text codes 1E / 1F, 00:09F2): no text of the three tables (dialogue, battle, UI) uses
  1C-1F. Also uncalled by design: the NotPorted classes, the `SoftReset` class (only without the
  engine's hook) and `Engine.setOptions` (the app's). Dead code removed: `PopReturn`,
  `Memory.romAt`.
- **Coverage after:** 743 of 750 functions called.
- **Falsified** (each fails its trace when removed): the restart (reset1 throws), the reads
  dropped at the restart (reset1 frame 1513), the uses change (yg02 CC50), the 1AB8 tail (sphere1
  FF8B, sphere2 FF8B / FF94), the member choice's bc (empty1 FFF6 / 7), the sphere menu's de
  (sphere1 FFF4 / 5), the store lines (yi860 frame 289), the drawn-SCX `waveLate` (yi861: 8 frames
  of one line).
