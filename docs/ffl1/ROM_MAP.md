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
| `06:6868` | 128 × 5 | Encounter areas: 3 monster ids (groups 1–3), formation index (byte 3), alternate formation (byte 4, used when FFBD bit 7 is set); bit 7 of the formation byte increments D3E6 | probable (code 06:56AD; area 19 swap changes the battle's monster) |
| `06:6AE8` | 200 × 9 | **Monster records** (below) | **verified** |
| `06:71F0` | 100 | One nibble per monster id (high nibble = even id), copied to combatant +1 | probable (code) |
| `06:7254` | 56 × 2 | Base HP per HP class, u16 LE (20, 40, 60, 82, …) | verified (controlled change) |
| `06:72C4` | 31 × 3 | Formations: per group one byte, high nibble = minimum count, low = maximum | probable (code; 1 ASIGARU = formation 2 `00 00 11`) |
| `06:7321`–`76E1` | 960 | Monster ability id lists (contiguous, in monster id order) | verified |

### Monster record — `06:6AE8 + 9 × id` (file 0x1AAE8) — **verified**

| Byte | Field | Encoding | Status |
|---|---|---|---|
| 0 | class flags | bits 6–7 | hypothesis |
| 0 | ability count − 1 | bits 3–5 | verified |
| 0 | unknown | bits 0–2 | hypothesis |
| 1 | HP class | index into 06:7254; HP = base − rand(0..base>>4) | verified |
| 2 | Str | u8 | verified (status screen) |
| 3 | Def | u8 | verified (status screen) |
| 4 | Agl | u8 | verified (status screen) |
| 5 | Mana | u8 | verified (status screen) |
| 6 | high nibble: picks combatant +0D = the n-th ability; low nibble unknown (often 11 − high) | nibbles | probable / hypothesis |
| 7–8 | ability list pointer (bank 06) | u16 LE | verified |

## Code

| Address | Role | Status |
|---|---|---|
| `06:56AD` | build an encounter from area FFBD: area record, formation, three groups | probable |
| `06:5713` | load one monster into the next combatant slot (D3E7 = slot number) | verified |
| `06:57FA` | HP from the HP class (base − random) | verified |
| `06:5BF2` | read field E of item/ability D (attributes, uses) | hypothesis |

## RAM

| Address | Content | Status |
|---|---|---|
| `D000 + 32k` | combatant slots (heroes 0–3, enemies 4–7): +0 b0, +1 nibble, +3/+4 HP LE, +5/+6 max HP, +7..+0A Str/Def/Agl/Mana, +0B/+0C ability attribute masks, +0D see byte 6, +0E..+15 ability ids, +16..+1D uses, +1F monster id (FF = empty) | verified (enemy slots) |
| `CC00` | party record of the hero: +1 name (4), +5 type, +6/+7 HP, +8/+9 max HP, +0B..+0E Str/Def/Agl/Mana, +0F.. items | probable (one member observed; status screen) |
| `CCC9` / `CCC8` | field x / y tile | probable (moves with the D-pad) |
| `FFBD` | encounter area index (bit 7: alternate formation) | probable |
| `D3E6` / `D3E7` | encounter flag count / next combatant slot | probable |
