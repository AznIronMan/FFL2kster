# ROM Map — Final Fantasy Legend II (USA)

Supported ROM: SHA-256 `ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e`.
Addresses are `BB:AAAA` (MBC1 bank : CPU address) with the file offset in parentheses.
Status: **verified** (controlled change produced exactly the predicted effect and nothing
else, or direct code + RAM evidence), **probable** (strong evidence, not fully falsified),
**hypothesis** (plausible, untested), **external claim** (public reference, not locally
checked). Evidence details and dates are in `docs/FINDINGS.md`.

## Cartridge

| Field | Value | Status | Evidence |
|---|---|---|---|
| Size | 262144 bytes (16 × 16 KiB banks) | verified | file size |
| Title | `SAGA2` | verified | header 0x134 |
| Mapper | MBC1 + RAM + Battery (0x03) | verified | header 0x147 |
| ROM / SRAM | 256 KiB (0x03) / 8 KiB (0x02) | verified | header 0x148/0x149 |
| Destination / version | 0x01 overseas / 0 | verified | header 0x14A/0x14C |
| Checksums | header 0xCD, global 0xD970, both valid | verified | recomputed |
| Disassembly round-trip | mgbdis output rebuilds byte-identical with RGBDS 1.0.4 | verified | same SHA-256 |

## Text encoding (names)

| Byte | Char | Status |
|---|---|---|
| 0xBA–0xD3 | `A`–`Z` | verified (relative search + decoded tables) |
| 0xD4–0xED | `a`–`z` | verified |
| 0xB0–0xB9 | `0`–`9` | probable (decodes "ROBO-28", "G-7") |
| 0xFF | space / padding | verified |
| 0xF2 | `-` | probable ("Baby-D", "Sho-gun") |
| 0x9E–0xAF, 0x3C, 0x3D | item/ability icon glyphs | probable |

Dialogue (verified, M3): dictionary pairs at `0F:6560` for bytes 0x4E–0x9D; control codes
0x00–0x4D via jump table `00:13BE` (argument lengths in `src/ffl2kster/script_text.py`).
Punctuation: 0xEE `'`, 0xEF `,`, 0xF0 `.`, 0xF1 `…`, 0xF3 `!`, 0xF4 `?`, 0xF5 `:`, 0xF6 `/`.

| Pointer table | Entries | Content | Status |
|---|---|---|---|
| `0A:4000` | 256 | field/town messages | verified (parse + round trip) |
| `0B:4000` | 192 | story event scripts with dialogue | verified (parse + round trip) |
| `0B:6B80` | 109 | battle messages | verified (emulator reinsertion) |
| `0B:7400` | 77 | menu/UI templates (incl. debug menu) | probable |

## Tables

### Monster / enemy stats — `0D:6F80` (0x36F80–0x3797F) — **verified**

256 records × 10 bytes, indexed by monster id 0–255. Shared by enemies, party monster
forms, guests (Mr. S = id 225 "Teacher"), party creation types (ids 240–247) and bosses.

| Byte | Field | Encoding | Status | Evidence |
|---|---|---|---|---|
| 0 hi | `type` | nibble: 0 human, 1 mutant, 2 monster, 3 robot | probable | party-load code stores byte0>>4; ids 240–247 read 0/0/1/1/3/2/2/2 for Human M/F, Mutant M/F, Robot, Slime, Baby-D, Imp |
| 0 lo | `ability_count_minus1` | nibble, count = n+1 | verified | code `and $0f; inc a` loop; controlled change adds one list entry; equals pointer delta for 247/256 ids |
| 1 | `unknown_1` | u8, 0 in all 256 records | hypothesis | controlled change reaches only scratch copy DE01 |
| 2–3 | `hp` | u16 LE, max HP | verified | controlled changes on ids 120 & 45; RAM matches ids 45/120/180/185 (battle) and 225/240 (party) |
| 4 | `str` | u8 | verified | controlled change → only D50E; status screen label STR |
| 5 | `agl` | u8 | verified | controlled change → only D50F; status screen label AGL |
| 6 | `mana` | u8 | verified | controlled change → only D510; status screen label MANA; robots 0 |
| 7 | `def` | u8 | verified | controlled change → only D511 (ids 120 & 45); status screen label DEF |
| 8–9 | `ability_ptr` | u16 LE pointer into bank 0D | verified | code reads it after stats; controlled change → only first ability slot D512 |

Record boundaries: corrupting the neighbouring records' bytes (id 119 byte 9, id 121 byte 2,
id 46 byte 2) produces **zero** WRAM differences in the id-120 / id-45 battles.

Ability-list contiguity exceptions (pointer delta ≠ count): ids 184, 204, 213, 214, 219,
224, 237, 238, 255 — shared or overlapping lists (unexplored).

### Ability id lists — `0D:7980`–(~0D:7Fxx) — **verified (format)**

Variable-length byte lists of ability/item name ids; length given by the record's low
nibble. Ability id → name via the item/ability name table below.

### Monster names — `0F:6EC0` (0x3EEC0–0x3F6BF) — **verified**

256 × 8-byte names in the text encoding, same index as the stats table. Code `0D:44F4`
copies `0F:6EC0 + 8·id` when loading an enemy; battle RAM shows "Jaguar" for id 120.

### Item / ability / spell names — `0F:6640` (0x3E640) — **probable**

8-byte names, id 0 = "Hammer". Ability ids in the lists decode to fitting names (Slime →
Dissolve, Octopus → Tentacle/Ink, Toad → Tongue). Monster names follow at name id 0x110.
Entries before 0x3E640 (0x3E610–0x3E63F: "Mr.S", "Ki", "Mask", "Lynn", …) are a separate
character-name list (hypothesis).

### Party creation / guest names — `0F:7600` (0x3F600) — **probable**

8-byte names: guests (Detectiv, Samurai, Guardian, Ancient, Haniwa, Dolphin, OdinCrow,
WarMach), then Human M … Imp (party creation list as shown on screen), then bosses and
location names at 0x3F6C0+.

### Items / weapons / armor / spells / abilities — `0C:6F80` (0x32F80–0x3377F) — **verified (location)**

256 × 8 bytes, one id space shared with the name table at `0F:6640` (ids 0x00–0x7F items,
0x80–0xFF monster abilities). See `src/ffl2kster/schema/items.py`.

| Byte | Field | Status | Meaning / evidence |
|---|---|---|---|
| 0 | `usage` | probable | target/use class; controlled change alters targeting |
| 1 | `flags1` | hypothesis | 08 shields/Defend/Tank, 10 Rune, 01 Revenge/Counter |
| 2 | `equip` | probable (0x40 verified) | slot nibble 1/2/4/8 = helm/body/gloves/boots; 0x40 stat bonus; 0x10 resist |
| 3 | `effect` | verified | battle action routine id (Long 0x31→0x14 changes behaviour) |
| 4 | `power` | verified | weapon power (damage = power·STR − 5·DEF ± rnd); armor DEF bonus |
| 5 | `param` | probable (stat bonus verified) | element/status bits, accuracy/evade, stat bonus `SSSS AAAA` |
| 6–7 | `anim` | hypothesis | presentation word |

### Item uses — `0C:7E80` (0x33E80), 1 byte × 256 — **verified**
254 = unlimited ("-" on screen). Loaded into (id, uses) pairs in party/enemy ability slots.

### Item prices — `0F:7860` (0x3F860), 3 bytes LE × 120 (ids 0x00–0x77) — **probable**
Location verified by code (`01:6678`); GP semantics not yet seen on a shop screen.

### Encounters — **verified** (controlled changes)
| Table | Location | Size |
|---|---|---|
| slot thresholds | `0D:6560` | 7 bytes |
| zone formation slots | `0D:6570 + 8·zone` | 135 × 8 |
| formations [id1,id2,id3,countA,countB] | `0D:6C70 + 5·f` | 128 × 5 |
| count patterns (min/max nibbles per group) | `0D:6EF0 + 3·p` | 32 × 3 |
Generator `00:2AE6`/`00:2B14` → CFE0–CFEA; zone from the map header (00:1CC4 → C454).

### Monster sprite/family code — `0D:6B70` (0x36B70), 1 byte × 256 — **verified**
Families of five share a code (0x05–0x28); used for overworld sprite tiles (bank 03,
0x4000 + code·0x100) and as the eater family in meat transformations.

### Meat transformations — ROM location unknown; behaviour **measured** (data/meat_transformations.json)

## Routines

| Address | Purpose | Status | Evidence |
|---|---|---|---|
| `0D:44F4` | Load enemy group: copy name `0F:6EC0+8·id` → struct+2, record `0D:6F80+10·id` → scratch `DE00`; id read from struct+0x0A | verified | PyBoy hook fires once per battle load (5+ battles); DE00 copy changes under controlled change |
| `0D:427E`–`0D:4349` | Load a party slot from a monster record (id → `C204+32·n`, type, HP cur/max, 4 stats, ability ids) | probable | static disassembly read; party RAM matches ids 225, 240 |
| `00:055D` / `00:0568` | Compute `0x6F80 + 10·id` (bank 0D) | probable | static; not observed in the battle-load path |
| `00:00D2` | Read one byte from bank A at HL (far read) | verified | PyBoy hook logs (A = bank, HL = address) match known table reads |
| `0D:4361` | Script dispatcher: index → pointer `0C:4680 + 2·i`, run by engine at `0C:4000` | probable | static; pointer reads observed during battle end / meat eating |
| `01:5DB0` | Copy item record `0C:6F80 + 8·id` | verified | static + controlled changes |
| `01:6678` | Copy price `0F:7860 + 3·id` | probable | static |
| `0C:4000` | Calc VM interpreter (statements 0C:402D, expressions 0C:4129, operand 0C:4476) | verified | full handler read; listing decodes with no unknown ops |
| `0C:4680` | 11 calc-VM script pointers (battle flow order) | verified | callers 0D:40E2…434B pass index 0–10 |
| `0C:53E1` / `0C:5445` | Item-effect VM handlers, battle (50) / field (10), index = item byte 3 | probable | script 5 `gosub [CF23·2 + table]` |
| `00:043E` | RNG: stream A, counter C0A0+A, table 0F:4000, range E..D | verified | disassembly; encounter stream 0x0A matches M4 |
| `0C:7800` | Monster family (hi) / meat class (lo) | verified | meat formula reproduces all measurements |
| `0C:7900` | Meat result table [12][3][16] | verified | same |
| `0C:7B40` | Stat-growth flags per action id (272) | probable | script 10 |
| `0C:7C50` | Reward byte: meat bit7, drop +80/+20 bits6/5, GP index bits0–4 | verified | controlled changes 0x01/0x22/0xA1 |
| `0C:7D50` | AI type (hi) / level (lo) per monster | verified (level, via meat); probable (AI) | |
| `0C:6F00` | Enemy AI cumulative slot thresholds, 8 per AI type | probable | script 2 |
| `0C:7E50` | GP table (words) | verified | 30 → 33 GP, 60 → 66 GP |
| `0C:7F90` | Growth chance pairs per type (ability, HP, stats) | verified (HP) / probable | controlled change |
| `0C:7FB0` / `0C:7FD0` | Mutant ability thresholds / ids (32) | probable | script 10 |
| `0C:7FF0` | Max GP (3 bytes, 999999) | probable | script 8 cap |
| `0F:4250` / `0F:4270` | Memo topic names (16) / phrases (256) | verified | 0x4B handler; Isis line |
| `0F:4000` | RNG table (256) | verified | 00:043E |
| `00:3924` | Field event dispatcher (kind C443, arg C442) | verified (kinds 0/1/5/6) / probable | town NPC/trigger events |
| `00:3092` | A-button object interaction → event (attr nibble, message) | probable | static |
| `00:1490` | Script op 0x19 event (kind < 4 → message via rst $20) | verified | |
| `00:0C05` | Script conditional skip: 4 bytes | probable | static (all if_* ops) |
| `01:647A` | Shop (e = shop id, 0xFF → inn 01:628A); menu 32 | verified | controlled change (tools/shop_probe.py) |
| `0F:79E0` | Shop inventories, 8 item ids × 24 | verified | C71D stock equals table rows 0/3/20 |
| `00:3EDF` / `00:3F28` / `00:3F4E` | Chest: item / item with drop prompt / MAGI | probable | static |
| `0C:7F80` | MAGI value per MAGI id | hypothesis | 00:3F4E |
| `0E:409B` | Song start (FFB0 request): channel pointers → CB04/CB1C/CB34 | verified | |
| `0E:49F5` | Song table, 19 × 3 channel pointers | verified | all songs parse; timing matches |
| `0E:4244` | Note durations (13) | verified | timing test |
| `0E:419A` | Frequency table (NRx3/4 words, trigger bit set) | verified | equal-tempered from C2 |
| `0E:4358` / `0E:45AB` / `0E:4706` | Sequence command tables, channels 1/2/wave | verified (arg counts) | parse + timing |

## RAM

| Address | Meaning | Status | Evidence |
|---|---|---|---|
| `C200 + 32·n` (n=0..4) | Party slots (4 members + guest): name[4], id/type, HP cur (+7), HP max (+9), STR/AGL/MANA/DEF (+0x0B..0x0E), 8 × (item id, uses) at +0x0F (0xFF = empty) | verified (HP, stats) | RAM matches records 240/225; writing 11/22/33/44 to +0x0B..+0x0E shows STR 11 / AGL 22 / MANA 33 / DEF 44 |
| `C42C` / `C42D` | Player map X / Y (tile) | verified | step-diff: ±1 per step in each direction, used for navigation |
| `D500` | Enemy group block: alive, total, name[8], id, type, HP max (lo,hi), STR, AGL, MANA, DEF, (ability, uses)… | verified | controlled changes map 1:1 to D50C–D512; 4 species observed |
| `D541 + 8·i` | Per-enemy current HP | probable | moves with max HP (45→45/43/43, 99→99/92/92, 200→200/180/180); reaches 0 when "Jaguar fell." |
| `DE00`–`DE09` | Scratch copy of the last loaded monster record | verified | every controlled change shows up here |
| `D000 + 0x100·n` (n=0..4) | Party battle copies (enemy-block layout); eater id at `D00A` | verified | meat result follows D00A, not C204 |
| `D500/D600/D700` | Enemy groups 1–3 | probable | init loop at 0D:403C steps D by 1 |
| `CF10` | Meat source monster id at the Eat prompt | verified | changing it changes the transformation |
| `CF00`–`CFFF` | Calc VM variables (script-local; CF10 meat, CFE0 formation) | verified | VM operand modes 0–4 address page CF |
| `C0A0 + n` | RNG stream counters | verified | 00:043E |
| `C2A2` (3 bytes) | Party GP | verified | +33 after Asigaru battle |
| `C2B9` | Inventory, 16 × (id, uses) | verified | dropped item appears in first free slot |
| `C31D` (32 bytes) | Memo phrase bits (text 0x4B/0x40/0x18) | probable | handler code |
| `D800`/`D801` | Initiative (1 party first, 2 enemy first) / run attempt | probable | scripts 0/1 |
| `D803` | Turn order list (value, actor) pairs | probable | script 3 |
| `D900`–`D90B`, `D90C` | Battle message argument slots / message index for `rst $20` | verified | drop message D906 + D90C=11 |
| `C7A9`, `C7A5` | *Not* game-mode bytes (screen-layout flags) | falsified as mode indicators | toggle inside battle / persist after battle and menus |

### Game-mode indicators

- **Battle**: execution of `0D:44F4` (enemy load) — verified; enemy block at D500 populated.
- **Field**: D-pad changes C42C/C42D — verified behaviour (used by the harness).
- **Menu**: no single-byte RAM indicator found (three approaches falsified; see FINDINGS).
