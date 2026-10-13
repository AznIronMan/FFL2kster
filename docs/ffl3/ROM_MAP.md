# Legend III ROM map (FFL3kster)

*Final Fantasy Legend III* (USA), "SAGA3", 262,144 bytes, MBC1+RAM+BATTERY, 8 KiB battery RAM,
DMG only. Addresses are `bank:address`; file offset = bank × 0x4000 + (address − 0x4000) for
banks ≥ 1. Status words as in docs/ffl1/ROM_MAP.md: **verified** (code + emulator test),
**probable** (code read, not tested), **hypothesis**.

## Start-up and interrupts

| Location | What | Status |
|---|---|---|
| 00:0100 | entry, `jp $0200` | verified |
| C0B9 / C0BC | RAM jump vectors for vblank / STAT (installed by 00:3D46 / 00:3D5A) | verified (PyBoy) |
| 00:11A2 | vblank handler (via C0B9) | verified (hook) |
| 00:11E3 | STAT handler (via C0BC) | verified (hook) |

## Bank switching and far calls

| Location | What | Status |
|---|---|---|
| rst $20 → 00:38E1 | push the current bank (stack C0A0, depth C0B0) and select bank A; current bank C0B1 | verified (hook) |
| rst $28 → 00:38FC | pop the bank | probable |
| rst $30 → 00:38D4 | call through the trampoline at C0B2 | probable |
| rst $18 → 00:378A | far call with one inline byte x: bit 3 clear → bank-0 routine 38C4[x&7] (3211, 20FF, 1F8A, 1F97, 1FB1, 1E51, 3D6E, 3D73) with bank x>>4 selected; bit 3 set → table entry (x&F0)\|2(x&7) at 3806/3807, bank 3802[hi>>6] ∈ {01, 09, 0B, 0F}, address ((hi&3F)\|40)<<8 \| lo | verified (disassembler output matches hooks) |
| 00:1F8A / 1F8D / 1F90 / 1F93 | copy 4 / 3 / 2 / 1 bytes hl→de (fall-through chain) | verified (battle RAM) |
| 00:1F50 / 1F53 / 1F55 | fill 6 / 3 / 2 bytes with A | probable |
| 00:245F | A × 8 → hl | probable |
| 00:1C7E | 16-bit multiply de × hl → de | verified (record index) |

## Encounters

| Location | What | Status |
|---|---|---|
| 01:4609-4636 | step end: rand < CA2B sets CA2C (battle) | verified (rate 00/FF) |
| 00:02EA | map byte bits 5-7 → rate class 00:119A (0, 3..9); next byte → zone CA2D | probable (code) |
| 00:10F5 / 00:1186 | zone (+vehicle state) and slot by the thresholds 03:76BC | verified |
| 03:76C2 | zones, 7 slots × 76 (bit 7: fixed counts) | verified |
| 0B:758B | formations, 5 bytes × 127: three ids, CC5C, CC5D | verified |
| 00:1126 | copies a formation to CC59-CC5D | verified |

## Text

| Location | What | Status |
|---|---|---|
| tiles B0-B9, BA-D3, D4-ED, FF | digits, A-Z, a-z, space | verified (title, name entry) |
| AF . F0 : F1 / F2 - F3 ! F4 ? AE … | punctuation (font tiles in VRAM) | verified |
| 9C00 | window map: menus | verified |
| 0E:7533 | monster names, 8 bytes × 195 (ids 00-C2), then the staff credits text | verified |
| 0E:6D4F / 6D73 | race names 6 × 6 (Robot … Mutant) / status names 10 × 4 (Good … Conf) | verified (text) |
| 0E:6D9B | spell names, icon + 5, ids 00-2F (icons A7/A8/A9 by 16) | verified (code 00:1E8F) |
| 0E:6EBB | item names, icon + 7, ids 30-FE | verified (code 00:1E8F, battle text) |
| 09:67BF / 67F7 | stat words 8 × 7 / monster skill names 8 bytes, ids 00-6D (+ resist/weak entries) | verified (battle text "Dive") |

## Monsters (bank 0B)

| Location | What | Status |
|---|---|---|
| 0B:470D | class record, 4 bytes × 195: b0 bits 0-5 level → entity +03, bits 6-7 → +0F/+68, b1-b3 → +65..+67 | verified |
| 0B:4A19 | battle record, 12 bytes × 195 (see docs/ffl3/FINDINGS.md) | verified |
| 0B:533D | ability list, 9 bytes × 195: mask, 8 ids | slot 1 verified, rest probable |
| 0B:469D | 16 × 4 bytes, indexed by b2>>4 → entity +59..+5C | verified |
| 0B:46DD | 3-byte entries, indexed by b4>>4 → entity +5D..+5F | verified |
| 0B:4499-44ED | battle set-up: up to 3 groups (ids CC59-CC5B, counts CC36-CC38) | verified (prologue) |
| 0B:4526 / 453A | enemy loader: name + battle record into staging entity D680 (id in CC70) | verified |
| 0B:45AB | HP / value 2 to current+max; × 16 for ids ≥ BB | verified |
| 0B:45CB | ability list and class record into the staging entity | verified |
| 0B:468B | copy the staging entity (0x80 bytes) once per enemy into D280, D300, ... | verified |
| 0B:728B / 7422 | recompute +36.., +39.., and (kind ≠ 4) +3D..+3F from the item list at +41 | verified (kind test) |

## Encounters

| Location | What | Status |
|---|---|---|
| 01:4609-4636 | step end: rand < CA2B sets CA2C (battle) | verified (rate 00/FF) |
| 00:02EA | map byte bits 5-7 → rate class 00:119A (0, 3..9); next byte → zone CA2D | probable (code) |
| 00:10F5 / 00:1186 | zone (+vehicle state) and slot by the thresholds 03:76BC | verified |
| 03:76C2 | zones, 7 slots × 76 (bit 7: fixed counts) | verified |
| 0B:758B | formations, 5 bytes × 127: three ids, CC5C, CC5D | verified |
| 00:1126 | copies a formation to CC59-CC5D | verified |

## Text

| Location | What | Status |
|---|---|---|
| 00:3211 | script interpreter (00 end, 10 wait + end, ≥ 88 literal runs, 4E-87 + 22 low codes dictionary, others via 00:3175) | verified |
| 00:3175 | control-code handlers, 0x4E words | verified (operand counts) |
| 00:2EF6 | script reference: hi < 40 scene change (0F:7DD4), else text in 09/0A/03 | verified (all refs land) |
| 03:71C5 | dictionary, 80 length-prefixed entries (to 731B) | verified |
| 03:6287-71B4, 09:5EAC-67BE, 09:6C5F-78FD, 09:79C4-7FFF, 0A:4000-4003, 0A:41E2-791D, 0A:792E-7FFF | 1,639 scripts | verified (exact parse) |
| 0A:4004 / 09:78FE / 0A:791E | pointer tables: 239 map texts / 99 battle messages / 8 | verified |
| 09:6015 | the prologue script (power-on, flag 31) | verified |

## Items, spells, skills (bank 09)

| Location | What | Status |
|---|---|---|
| 09:5D7F / 5D87 | record loader: id CE26, mode CE25 (1 = monster skill); 7 bytes → CEDB | verified (hook) |
| 09:55C4 | weapons, ids 30-77, 7 bytes (byte 1 power) | verified (loads, damage) |
| 09:57BC | monster skills, ids 00-6D, 6 bytes (byte 1 power) | verified (loads, damage) |
| 09:5A50 | spells, ids 00-2F, 6 bytes | probable (code, contiguity) |
| 09:5B70 | items, ids C0-DB, 5 bytes | probable |
| 09:5BFC | armor and accessories, ids 78-BF, 5 bytes: resist element/status, Defence/M.Def., Evade/M.Evade, linked id, weight | verified (Equip menu) |
| 0B:7422 | sums armor nibbles into +3D..+3F from the item list at +41 | verified (Equip menu) |
| 0B:7104 | element group → resistance bit (4 → 0x10) | verified (one value) |
| 00:2448 / 2453 / 243D | A × 6 / × 7 / × 5 → hl | verified (code) |

## RAM

| Address | What | Status |
|---|---|---|
| C0B1 | current ROM bank | verified |
| CC59-CC5B / CC36-CC38 | battle group ids / counts (prologue: 46 4B FF / 02 02 00) | verified |
| CC70 | id being loaded | verified (poke) |
| CC73 / CC74 | loader copies of record bytes 2 / 4 | verified |
| D280 + 0x80·k | enemy entity k: +05 name, +0D kind, +0E id, +10/+12 HP cur/max, +14/+16 value 2, +18 stats, +48 abilities | verified |
| D680 | staging entity | verified |
| C500 + 0x60·k | party records (Arthur, Curtis, Gloria, Myron, Sharon): +07 name, +10/+12 HP, +14/+16 MP, +18..+1B Attack/Defence/Agility/Magic, +21 base Defence, +28 u16 10 × weight, +2D weight, +36..+3A resistance bits, +3C Defence bonus, +3D Evade, +3E M.Def., +3F M.Evade, +40..+47 equipment (weapon, shield, helm, armor, gloves, shoes, others ×2) | verified (status/equip screens) |
| C703 | inventory: (id, count) pairs | probable (Radar at C703, poke used by the tests) |
| D000 + 0x80·k | party battle entities (copies of the party records) | verified (HP traces) |
| CE25 / CE26 / CEDB | loader mode / id / record copy | verified |
| CA2B / CA2C / CA2D / FFCA | encounter rate / battle request / zone / formation (+bit 7) | verified |
| CC59-CC5D / CC36-CC38 | battle groups (ids, flags, counts byte) / counts | verified |
| C996 / C9D4 / C9ED | battle values that follow the level of the loaded enemy (1/4/1 at level 1, 3/12/3 at level 5) | verified (meaning unknown) |
