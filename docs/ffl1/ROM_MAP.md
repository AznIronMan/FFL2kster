# Legend I ROM map (The Final Fantasy Legend, USA)

Everything here was derived from this ROM; nothing is carried over from Legend II without its
own evidence. Status: **verified** (controlled change / code + emulator agreement), **probable**
(consistent evidence, not yet falsification-tested), **hypothesis**. Evidence: docs/ffl1/FINDINGS.md.
Addresses are `BB:AAAA` (bank:CPU address); file offset = bank × 0x4000 + (AAAA − 0x4000).

## Cartridge

| Item | Value | Status | Evidence |
|---|---|---|---|
| File | 131,072 bytes, SHA-256 `e5b1d116…0d906`, SHA-1 `901dfc83…a9bb`, MD5 `d5c27ff8…baf0` | verified | hashed from the file |
| Title | `SAGA` | verified | header 0x134 |
| Cartridge | 0x06 **MBC2+BATTERY** (Legend II: MBC1+RAM+BATTERY) | verified | header 0x147 |
| ROM / RAM | 128 KiB = 8 banks; RAM code 0 (MBC2's 512 × 4-bit RAM is built in) | verified | header 0x148/0x149 |
| Destination / version | 0x01 overseas / 0 | verified | header |
| Checksums | header 0xFF, global 0xBE66, both valid | verified | recomputed |
| Disassembly round trip | mgbdis output rebuilds byte-identical with RGBDS 1.0.4 | verified | same SHA-256 |
| Bank switch | `rst $28`: A = bank → stored in FF8B and written to `$2100` (MBC2 needs address bit 8 set); old bank returned in A; ends with `reti` | verified | 00:0028 → 00:00D1 (code) |
| Jump table | 00:0150… three-byte `jp` entries (e.g. 00:016B → 00:07D3 random range) | probable | disassembly |

## Text encoding (names)

| Byte | Char | Status |
|---|---|---|
| 0x8A–0xA3 | `A`–`Z` | verified (relative search; name table shows in battle; status screen) |
| 0xA4–0xBD | `a`–`z` | verified (intro text, name entry grid) |
| 0x80–0x89 | `0`–`9` | probable (`200`, `400` item names) |
| 0xFF | space / padding | verified |
| 0xF2 | `-` | probable (`P-FLOWER`, `TEN-GU`) |

Legend II's alphabet starts at 0xBA (0x30 higher); both use 0xFF as space and 0xF2 as `-`.
With BG tile data at 8800 (LCDC bit 4 = 0) the screen holds code − 0x80 (`I` = 0x12, space 0x7F).

## Tables (bank 06 battle data block, contiguous)

| Address | Size | Content | Status |
|---|---|---|---|
| `05:4000` | 8 × N | Shared name table: monsters 0–199 (`FLY` … `CREATOR`, incl. the 16 hero types 173–188 and bosses 189–199), then items from 200 (`POTION`, 7 chars + a trailing byte) | verified (monsters: battle window controlled change); items: probable |
| `06:6400` | 141 × 8 | Encounter zones: rate, then 7 area ids (slot weights 1/2 … 1/128; bit 7 = alternate formation) | verified |
| `06:6868` | 128 × 5 | Encounter areas: 3 monster ids (groups 1–3), formation index (byte 3), alternate formation (byte 4, used when FFBD bit 7 is set); bit 7 of the formation byte increments D3E6 | verified (code 06:56AD; controlled changes M1, M4) |
| `06:6AE8` | 200 × 9 | **Monster records** (below) | **verified** |
| `06:71F0` | 100 | One nibble per monster id (high nibble = even id), copied to combatant +1 | probable (code) |
| `06:7254` | 40 × 2 | Base HP per HP class, u16 LE (20, 40, 60, 82, …) | verified (controlled change) |
| `06:72A4` | 16 × 2 | GP rewards per class, BCD hi/lo (0, 40, 120, 240 … 9999) | verified |
| `06:72C4` | 31 × 3 | Formations: per group one byte, high nibble = minimum count, low = maximum | verified |
| `06:7321`–`76E1` | 960 | Monster ability id lists (contiguous, in monster id order) | verified |
| `06:7700` | 256 × 8 | **Item/ability records**: kind, flags, handler, uses (as a monster ability), power, param, ?, ? | verified (uses, power), probable (handler, param) |
| `06:403A` | 49 × 2 | Battle effect handlers (06:44B0–50B7), indexed by item byte 2 | probable |
| `06:7F00` | 8 | Mutant growth category thresholds (cumulative, vs rand 0..255) | verified (category 0) |
| `06:53DE` | 8 × 2 | Mutant growth handlers | probable |
| `06:7F0F` | 32 × 2 | Mutant "new ability" list: (id, uses) | verified |
| `02:7900` | 200 | Meat family byte per monster: group (bits 4–6) + index (low nibble); group starts 00:0E16 | verified |
| `02:6FD3` | 25 × 29 | Meat result row [eater family][meat family], FF = nothing | verified |
| `02:72A8` | 25 × 16 | Monster per result row and level | verified |
| `02:7438` | 200 | Monster level (low nibble) | verified |
| `05:4E40` | 88 × 2 | Text dictionary pairs (codes 0x50–0x7F, 0xC0–0xE7) | verified |
| `05:7B30` | 255 × 2 | Dialogue pointers (05:4EF0–7B30; `12 hi lo` addresses 05:7B10 + 2 × index) | verified (parse + reinsertion) |
| `02:7860` | 80 × 2 | Battle message pointers (02:7500–7858), message number of 06:5A71 → 00:088A | verified (parse + reinsertion) |
| `03:7080` | 51 × 2 | UI templates (title, menus, shops) | verified (parse + reinsertion) |
| `00:0CE2` | 64 × 2 | Engine text control-code handlers | verified (argument counts by full-table parse) |

### Monster record — `06:6AE8 + 9 × id` (file 0x1AAE8) — **verified**

| Byte | Field | Encoding | Status |
|---|---|---|---|
| 0 | class flags | bits 6–7 | hypothesis |
| 0 | ability count − 1 | bits 3–5 | verified |
| 0 | meat drop chance (eighths) | bits 0–2 | verified |
| 1 | HP class | index into 06:7254; HP = base − rand(0..base>>4) | verified |
| 2 | Str | u8 | verified (status screen) |
| 3 | Def | u8 | verified (status screen) |
| 4 | Agl | u8 | verified (status screen) |
| 5 | Mana | u8 | verified (status screen) |
| 6 | high nibble: picks combatant +0D = the n-th ability (probable); low nibble: GP class (06:72A4, verified) | nibbles | probable / verified |
| 7–8 | ability list pointer (bank 06) | u16 LE | verified |

## Maps and events

| Address | Size | Content | Status |
|---|---|---|---|
| `02:58D0` | 200 × 2 | Map record pointers (records 02:5A60–62E3, variable length, see FINDINGS M5) | verified (structure, zone slot change) |
| `03:xxxx` | — | Layout command streams (pointer in the map record; 00:153C) | verified (110/110 vs the ROM routine) |
| `02:4840` | 64 per set | Metatile attributes (e, d) × 32 → DF80 | probable |
| `02:4820` | 2 per set | Graphics set pointers (00:3F97) | probable |
| `02:5240` | 6 per set | Sprite sets (00:24F8) | probable |
| `02:52D0` | 474 × 3 | Warps (map, x, y) | verified (structure; warp 0 = town start) |
| `02:585E`, `02:62F0`–`6FA5` | 99 lists | Event lists (objects with command/parameter) | verified (parse; parameter change) |
| `05:7D10` | 25 × 10 | Shop inventories | verified |
| `05:7E10` | 128 × 3 | Prices, BCD (items 0x00–0x7F) | verified |

## Graphics

| Address | Content | Status |
|---|---|---|
| `02:4000` | 16 BG tileset records (0x82 each: 4 block nibbles + 128 tile indexes into bank 01) | verified (VRAM) |
| `01:4000`+ | graphics blocks (1 KiB BG blocks; sprite blocks from 01:6000; 01:7F00 shared) | verified |
| `02:5240` | 23 sprite sets (6 block numbers) | verified (VRAM) |
| `03:7100` | font, 1bpp, codes 0x80–0xF6 | verified |
| `02:79D2` / `02:79EA` | monster picture class bases (bank 04) / tiles per class | verified |
| `04:4000`–`7FFF` | monster pictures, 2bpp | verified |

## Sound (bank 07)

| Address | Content | Status |
|---|---|---|
| `07:4000` / `07:4003` | driver init / per-frame update | verified |
| `07:462F` | song table, 18 × 3 channel pointers | verified (decode + timing) |
| `07:4403` | note durations (15) | verified |
| `07:4412` | frequency table | probable |
| `07:6870`, `07:68D3`, `07:692F` | envelope tables | probable |
| `07:69BD` | wave patterns | probable |

## Code

| Address | Role | Status |
|---|---|---|
| `06:56AD` | build an encounter from area FFBD: area record, formation, three groups | probable |
| `06:5713` | load one monster into the next combatant slot (D3E7 = slot number) | verified |
| `06:57FA` | HP from the HP class (base − random) | verified |
| `06:5BF2` | read byte E of item D (06:7700 + 8D + E) | verified |
| `06:448F` | battle effect dispatch through 06:403A | probable |
| `06:5240` / `06:517A` | battle won: meat roll and GP per enemy | verified |
| `06:539E` | mutant growth after a won battle | verified |
| `00:07D3` | random(a..e): per-call-site counter (C300+) into the table at CB00 | probable |
| `00:0D9C` | meat transformation | verified |
| `00:0911` | engine text interpreter (battle, UI) | verified |
| `00:2266` | random encounter roll per step (zone, rate, area slot) | verified |
| `00:22CC` / `00:231B` | warp / map load | verified |
| `00:153C` | layout decoder | verified |
| `00:2586` | event list loader | verified |
| `00:13FA` | passability | probable |
| `00:3F97` | BG tileset loader | verified |
| `00:24F8` | sprite set loader | verified |
| `07:72C2` | battle picture loader | verified |
| `00:300E` | facility dispatch (shop, inn, house of life, guild) | verified (shop) |
| `00:16E0` | event command executor (C3A9 command, C3AA parameter; 8 = battle → 00:1BBE) | probable |
| `00:0EBA` | dialogue interpreter | verified |

## RAM

| Address | Content | Status |
|---|---|---|
| `D000 + 32k` | combatant slots (heroes 0–3, enemies 4–7): +0 b0, +1 nibble, +3/+4 HP LE, +5/+6 max HP, +7..+0A Str/Def/Agl/Mana, +0B/+0C ability attribute masks, +0D see byte 6, +0E..+15 ability ids, +16..+1D uses, +1F monster id (FF = empty) | verified (enemy slots) |
| `CC00 + 31i` | party records (4 × 31 bytes): +1 name (4), +5 type (monster id), +6/+7 HP, +8/+9 max HP, +0A class flags (0x83 HUMAN M, 0x23 MUTANT M, 0x43 CLIPPER; bit 6 = can eat meat, verified by 00:0D9C), +0B..+0E Str/Def/Agl/Mana, +0F..+1E eight (item, uses) slots | probable (stride from 00:0551; status screen; meat and growth tests) |
| `CCC9` / `CCC8` | field x / y tile | verified (navigation) |
| `CCC7` | current map id | verified |
| `D000` | map buffer 64 × 62 (shared with the battle slots) | verified |
| `DF80` | metatile attributes of the current map | probable |
| `C55C` | 16 event objects × 5 | probable |
| `CC8D`–`CC8F` | GP, BCD | verified (battle reward, shop) |
| `FFBD` | encounter area index (bit 7: alternate formation) | verified |
| `C5C2`–`C5C5` | the current map's four encounter zone slots | probable |
| `D3E6` / `D3E7` | encounter flag count / next combatant slot | probable |
