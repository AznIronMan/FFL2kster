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

Dialogue text is out of scope for milestone 1; only fixed-width names were decoded.

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
| `C7A9`, `C7A5` | *Not* game-mode bytes (screen-layout flags) | falsified as mode indicators | toggle inside battle / persist after battle and menus |

### Game-mode indicators

- **Battle**: execution of `0D:44F4` (enemy load) — verified; enemy block at D500 populated.
- **Field**: D-pad changes C42C/C42D — verified behaviour (used by the harness).
- **Menu**: no single-byte RAM indicator found (three approaches falsified; see FINDINGS).
