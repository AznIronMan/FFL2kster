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
| 00:11E3 | STAT handler (via C0BC): reti | verified (hook) |
| 00:11A2 work | DMA (CD39 = 0), joypad 00:36F1, CA26, then while FF95 counts: FF95 - 1, the tile list C100 (00:3757), FF93/94 + 1; scroll 00:3D2B, shake 00:108F, sound 00:1F3A; can run into the next frame (9253/144 to 9254/7 in `opening1`) | verified (parity opening1) |
| 00:1D9E / 00:1DFD | VRAM bracket enter / leave (nested, CDCE): IE/STAT/LYC and vectors saved to CDD0/CDCF/CDCA/CDC7/CDCB; IE \| 3, STAT 40, LYC 3, STAT -> 00:1F27, vblank -> 00:1EFA; di at the entry, then the switch, then the poll for mode 1, then reti (interrupts that came meanwhile are taken by the new handlers) | verified (parity title1/title2/newgame1; hooks) |
| 00:1D98 / 00:1DF3 | CD3D + 1 then enter / leave then CD3D - 1 | verified (parity) |
| 00:1EFA | bracket vblank: 00:3E26 sprite flip (CBFF), DMA, joypad, CDAF \|= FF8B, FF93/94 + 1, FF95 - 1 | verified (parity) |
| 00:1F27 | bracket STAT (LYC 3): sound (00:1F3A, bank 0F pushed), then 00:3549 while CD3D | verified (parity) |
| 00:3549 / 00:3557 | once (CDC5): CDC4 or WY = 50 -> bank 01 00:3575 (field work, then di); else 00:2192 party figures + 00:1ED7; ends back at 00:3552 | verified (parity title1/title2/newgame1; hooks) |
| 00:3A6D / 00:3A6B | frame wait: FF95 = n (1), halt until 0 (00:3A77) | verified (parity) |
| 00:36F1 | joypad: FF8A held (A B Sel Start low, R L U D high), FF8B new presses | verified (parity) |

## Bank switching and far calls

| Location | What | Status |
|---|---|---|
| rst $20 → 00:38E1 | push the current bank (stack C0A0, depth C0B0) and select bank A; current bank C0B1 | verified (hook) |
| rst $28 → 00:38FC | pop the bank | probable |
| rst $30 → 00:38D4 | call through the trampoline at C0B2 | probable |
| rst $18 → 00:378A | far call with one inline byte x: bit 3 clear → bank-0 routine 38C4[x&7] (3211, 20FF, 1F8A, 1F97, 1FB1, 1E51, 3D6E, 3D73) with bank x>>4 selected; bit 3 set → table entry (x&F0)\|2(x&7) at 3806/3807, bank 3802[hi>>6] ∈ {01, 09, 0B, 0F}, address ((hi&3F)\|40)<<8 \| lo | verified (disassembler output matches hooks) |
| 00:1F8A / 1F8D / 1F90 / 1F93 | copy 4 / 3 / 2 / 1 bytes hl→de (fall-through chain) | verified (battle RAM) |
| 00:1F50 / 1F53 / 1F55 | fill 9 / 6 / 4 bytes with A (the chain from 00:1F45 fills 20; corrected in 1.31.0, the earlier 6 / 3 / 2 was a misread) | probable (code) |
| 00:245F | A × 8 → hl | probable |
| 00:1C7E | 16-bit multiply de × hl → de | verified (record index) |
| 00:1F5A-1F95 / 00:1F45-1F58 | unrolled copy (20 .. 1 bytes by entry) / fill (20 .. 4) | verified (parity) |
| 00:1F97 / 00:1FB1 / 00:3921 | copy b / copy bc / fill bc bytes | verified (parity) |
| 00:20FF | VRAM copy bc bytes, 5 per hblank (or in vblank) clear of LYC - LY < 3; multi-frame | verified (parity, re-timed) |
| 00:3D76 | block decompressor (as the layouts) to a destination through C800; C840-C846 | verified (parity) |
| 00:1E51 | menu input: wait for a button (Select ignored), jump through the 8 words after the call by the lowest bit; handlers return into 00:1E57 (0B:6D22 key repeat pause) | verified (parity title2) |
| 0B:6D22 | key repeat pause (CDAF, CD38; Select held = 1 frame) | verified (parity title2) |
| 0F:79AE / 00:3A0C / 00:39F3 | fade levels CDB7/CDBA from CDB4 / fade in (CDBA, CDB7, CDB4, 5 frames each) / fade out | verified (parity) |

## Encounters

| Location | What | Status |
|---|---|---|
| 01:4609-4636 | step end: rand < CA2B sets CA2C (battle) | verified (rate 00/FF) |
| 00:02EA | map byte bits 5-7 → rate class 00:119A (0, 3..9); next byte → zone CA2D | probable (code) |
| 00:10F5 / 00:1186 | zone (+vehicle state) and slot by the thresholds 03:76BC | verified |
| 03:76C2 | zones, 7 slots × 76 (bit 7: fixed counts) | verified |
| 0B:758B | formations, 5 bytes × 127: three ids, CC5C, CC5D | verified |
| 00:1126 | copies a formation to CC59-CC5D | verified |

## Maps (bank 06), shops (bank 01)

| Location | What | Status |
|---|---|---|
| 06:6C58 | 192 map pointers → 06:6DD8-7F68: 6-byte header + 6-byte objects + FF | verified |
| 03:731C | per-map table (2 × header byte 1): size nibbles, CA19-CA1C, CA17 | probable (code) |
| 07:7EA0 / 07:7EC0 | layout row width / tile count by layout index 1-31 | verified |
| 07:4000 / 08:4000 | layout data pointers (compressed, 00:3D76), 07:4022 / 08:4022 metatile tables | verified (D000 equal) |
| 0B:7982 / 79B1 / 79E0 | flag patches: map id / flag / pointer (one rectangle) | verified |
| 00:1236 | script events by type (CA29 & 3F), parameter CA28 | verified (types 0E, 1B) |
| 06:6BA4 | doors: 3 bytes × 60 (map, x, y) | verified |
| 06:6308 | position warps: 192 pointers, 4-byte entries | probable (code) |
| 01:7804 / 01:780C-794F | shop group pointers / 4 groups of 6-item shops | probable (code) |

## Graphics

| Location | What | Status |
|---|---|---|
| 07:7F5B / 05:hh00 | map tileset: four 512-byte blocks named by the 03:731C record → 9000 | verified (8 loads) |
| 03:4000 | font and window tiles → 8800 | verified |
| 0B:4301 / 43C4 / 43CC / 43E4 | picture code per monster / tiles per size / sheet bank+size / sheet spans | verified (6 monsters) |
| banks 0D/0E/0F | compressed picture sheets (bitplane 0, bitplane 1) | verified |

## Music (bank 0F)

| Location | What | Status |
|---|---|---|
| 0F:4006 / 402D / 41CE | driver per frame / song start / tempo accumulator, two ticks per carry | verified (pointer traces) |
| 0F:482F | 20 songs × 4 channel pointers | verified |
| 0F:41BE | 16 note durations (low nibble) | verified |
| 0F:4428 / 4448 / 4468 / 4488 | per-channel command tables F0-FF | verified (operand counts) |
| CB00 / CB01 / CB05+ (×0x18) | accumulator / tempo / channel state, counter, pointer | verified |

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

## Maps (bank 06), shops (bank 01)

| Location | What | Status |
|---|---|---|
| 06:6C58 | 192 map pointers → 06:6DD8-7F68: 6-byte header + 6-byte objects + FF | verified |
| 03:731C | per-map table (2 × header byte 1): size nibbles, CA19-CA1C, CA17 | probable (code) |
| 07:7EA0 / 07:7EC0 | layout row width / tile count by layout index 1-31 | verified |
| 07:4000 / 08:4000 | layout data pointers (compressed, 00:3D76), 07:4022 / 08:4022 metatile tables | verified (D000 equal) |
| 0B:7982 / 79B1 / 79E0 | flag patches: map id / flag / pointer (one rectangle) | verified |
| 00:1236 | script events by type (CA29 & 3F), parameter CA28 | verified (types 0E, 1B) |
| 06:6BA4 | doors: 3 bytes × 60 (map, x, y) | verified |
| 06:6308 | position warps: 192 pointers, 4-byte entries | probable (code) |
| 01:7804 / 01:780C-794F | shop group pointers / 4 groups of 6-item shops | probable (code) |

## Graphics

| Location | What | Status |
|---|---|---|
| 07:7F5B / 05:hh00 | map tileset: four 512-byte blocks named by the 03:731C record → 9000 | verified (8 loads) |
| 03:4000 | font and window tiles → 8800 | verified |
| 0B:4301 / 43C4 / 43CC / 43E4 | picture code per monster / tiles per size / sheet bank+size / sheet spans | verified (6 monsters) |
| banks 0D/0E/0F | compressed picture sheets (bitplane 0, bitplane 1) | verified |

## Music (bank 0F)

| Location | What | Status |
|---|---|---|
| 0F:4006 / 402D / 41CE | driver per frame / song start / tempo accumulator, two ticks per carry | verified (pointer traces) |
| 0F:482F | 20 songs × 4 channel pointers | verified |
| 0F:41BE | 16 note durations (low nibble) | verified |
| 0F:4428 / 4448 / 4468 / 4488 | per-channel command tables F0-FF | verified (operand counts) |
| CB00 / CB01 / CB05+ (×0x18) | accumulator / tempo / channel state, counter, pointer | verified |

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

## Title and sprites (port P1)

| Location | What | Status |
|---|---|---|
| 01:7C79 | title: music 6, bracket, palettes 01:7DDA -> CDB4, picture 03:5C00 -> D000 -> 9000, font 03:4000 -> 8800, window 0B:6D04, sprites 09:40E8, 03:71B5 -> 8180, logo 9C22 (8 x 16), texts 09:7215, cursor C080, fade in, menu 00:1E51 (Up/Down toggle C080 ^ 10, others buzz, A 01:7D21) | verified (parity title1/title2) |
| 09:40E8 / 0B:7DCA / 0B:7E17 | sprite reset: member sprite tiles (bank 04 by 0B:6DC7, mirrored for a status) to 8000, shared tiles bank 03 5700-57BF to 8180; OAM buffer C000 | verified (parity) |
| 00:21A9 | party walking figures in C000 / C050 (CD3C), frame by FF93 bit 4, type by 0B:748F (00:2315 / 00:2322) | verified (parity) |
| 00:2205 | cursor step C080 (CD15 bit 7) | probable (code; CD15 clear in the traces) |

## New game, map load, events, window (port P1)

| Location | What | Status |
|---|---|---|
| 01:7D21 / 01:7D40 | title choice; New Game: party records copied, window clear 01:7DFD, CA6E, window off, prologue text 09:5EAD (then 01:7D75 names, not ported yet) | verified (parity newgame1) |
| 00:027D | map load: zone override 00:0409, CA6B before/after, layout pointer 00:0E1C, layout 00:0F42 (C100 -> 9C00, then back), patches 01:78F5 / 01:7926, tiles 00:0535 / 00:0427 (shared 01:7F00, tilesets 01:7F5B, town test 01:418A), objects 00:05BF (talked 00:0715, pair 00:0730), leader 00:054D, slot 1 01:4F2B, view 00:0E34 (cell 00:0D14, pointer 00:0DB3, BG address 00:0DE4; blocks hidden by bit 6 and CA12, 01:5EA6) | verified (parity newgame1) |
| 00:2EF8 | script reference (lo, hi): hi < 40 event (CA28/CA29, 0F:7DD4 closes the window for some types, 00:1236), else text in bank 09 (40-7F), 0A (80-BF), 03 (C0-FF) | verified (parity) |
| 0B:6C35 / 0B:6C4C | text scene codes -> event types (32 26, 3D 28, 3B 27, 13 1D, 12 1C, 3F 1B, 0A 10, 0D 0E, 38 12) | verified (parity, 0D/38 used) |
| 00:1236 | event dispatcher (CA29 & 3F; CD3D cleared meanwhile): 0D/0E door 00:1389 (06:6BA4 + 3(n-1)), 12 special 00:16B9, 06/07 and >= 2D (but 2F, 3F) nothing | verified for 0E, 12 (parity) |
| 00:1B64 | return point C7C9-C7CB for maps below 0A, one step back against the facing | verified (parity) |
| 00:35AF / 00:35D2 / 00:27AB | text window open / close / toggle (code 14): slide 6B -> 51 (2 lines a frame) with STAT 00:3631 (BGP flashes, WX on/off, LYC mirrored around 6E), a sound tick and the field work per frame | verified (parity) |
| 00:3575 | field frame work: map animation 01:54A0 (CA6F guard; CA18 mode table at 01:54B4), objects 00:01A0, scroll 00:3D2B, shake 00:108F, objects under the window hidden (00:3A32) | verified (parity) |
| 01:54A0 / 01:54B4 | map animation, 36 modes (CA18): 00/0C nothing; strip scrolls 01:5730 (a 2-tile strip a pixel right at FF93 & 0F = 6, or + 100 at 0E; hblank-paced, ends with reti; 01:5723 at 6 only) for 01-06, 09, 0A, 1C, 1F, 20, 08, 17, 0E, 23; tile rolls down 01:57A9 / up 01:57CE (pairs 01:578C, 01:5798, 01:5828, 01:5836); byte rotations 01:5847 (0D, 0E); swaps through C800 (01:6101/6107 32 bytes, 01:60F5/60FB 16) in 08, 0B, 14, 16, 17, 19, 1A, 1B (01:5964), 21, 22 (01:5993); frame tables 01:5601 (0F, 15, 1E) and 01:565F (12, 13) | verified for 1B, 22, 23 (parity); the rest from the code |
| 00:0020 / 00:0028 | rst $20 / rst $28: di, bank push 00:38E1 / pop 00:38FC, reti (the interrupts on: in the frame work, 00:01A0's rst $20 lets a nested STAT in) | verified (parity opening1) |
| 00:2EF8 -> 00:2F0B / 00:12CA | a script reference's event is called at 00:2F0B; 00:1236 returns through 00:12CA (C2F0, CD3D back); both are sync points (the events' CPU time decides whether a STAT frame work sees CD3D) | verified (parity opening1) |
| 00:1B2D / 00:1B50 | a frame, then the normal handlers (11A2 / 11E3) with the current ones kept at CA5A / CA5D; back | verified (parity opening1) |
| 01:41AF / 01:41C0 | a frame of the leader's / an object's scripted walk: map animation, objects, a frame (the leader's steps 01:441D-4609, the objects' 01:50AC-5312) | verified where `opening1` reaches (scripted walks) |
| 00:3211 and helpers | text engine: flush 00:331B, line at once 00:3357, tile by tile 00:338E (delay 00:3593), box scroll 00:342C / 00:34B2, dictionary 00:308C / 00:30B8, wait for A 00:275C | verified (parity) |

## Menus and the name entry (port P1)

| Location | What | Status |
|---|---|---|
| 00:1E49 / 09:4FEF | menu boxes: C8B0 -> C8CE (0x1E), CD3A = 1, arrows 22/23 (C08A/C08E), DMA held (CD39) while 09:5045 draws rows 0-17 (battle 0-9) of every box (09:5070) into C880 -> 9E40 + 20 r, then 09:5020 copies them to 9C00 | verified (parity newgame2/3) |
| 09:5070 | one box row: descriptor (x, y, w, h, text, flags) in CD0C-CD12; top / bottom borders, inside FB..FB with text (09:5143 codes only, sets flags bit 0; 09:5169 letters, clears it, moves CD10; next byte 05 or 4C 05: codes again); below the first box tiles 04 05 / 06 07 (battle: blank); CD3C = 1: empty party slot boxes (C503/C563/C5C3 = FF) bordered only | verified (empty slots, background: code) |
| 09:519C / 09:51BA | a menu control code through the 00:3175 table; afterwards de - 1, b + 1 (no column) | verified |
| 00:20DE | parameter byte: 80 -> CD4C, FF -> CD36; 5-8 -> 0-3; >= 80 - 7B | verified (04, 20) |
| 00:2955 | code 1F p: p < 5 member name (C507 + record -> CDA9, 4C shown blank; CD34 bit 1 drops trailing blanks), 5-F entity name (C505 + ..., 8), 10-1F 00:29A5 (not ported), >= 20 class name of the named record (C68D, 7 letters) | verified (p 04, 20) |
| 00:2FBF | code 43 x y p: 2 x 2 figure of member p at C000 + 16 p (slot >= 5: also tiles 4 slot.. and attribute 0), unchanged when CD1C set or at the same place (low bits aside); CDEB nibble moves x off screen | verified (p 04) |
| 00:3114 / 00:3168 | with CD3A: c characters copied on a letter row, skipped on a code row; b - c | verified |
| 00:2766 | code 0C n: n frames then n more, A ends it | verified (parity newgame2) |
| 00:240E | letter grid 09:78A0 -> D000 (54 letters, each after FF), 00 | verified |
| 0F:7B64 | name entry screen of member a: 07:7A81 + 0x60 a -> C680, sprite tiles 0B:7DCA, boxes 0F:7B90, cursor (40, 10), window top | verified |
| 0F:7A44 | name entry (menu 00:1E51): A letter (first: name C687 cleared; blank stored 4C; 6: buzzer), B back (none: CDEA = FF, out), Select buzzer, Start keeps the name (C507 + record; empty: buzzer), directions move C080 / C081 with wrap (rows CD15 0-5) | verified (parity newgame3) |
| 01:7D75-7DD7 | after the prologue: fade out, C200 cleared, window top, objects hidden, grid, first screen, arrows x 8, fade in, 4 names, fade out, C620 -> C680, 0B:6DE4 (3, 2), 0B:6E33 (4), 0F:79D4, 9800 blank, WY 50, bracket left twice | verified |
| 0B:6DE4 / 0B:6E33 | member slot a from the starting record 0B:7573[b] (CE00 + 4 a cleared); slot a emptied (C503 + record = FF) | verified (3, 2 / 4) |
| 0F:79D4 / 00:2499 | per member 0-3: (L + 4)(L + 1)^2 (L = C503 + record; 99: 0) -> CD9D + 3 k, 16 x 16 multiply in CD46-CD49 | verified (RAM at waits) |
| 00:023F | start code after the title: story flag 31 clear -> fade in, opening script 09:6015 (box 1,1 18 x 6), flag 31 set, LYC 0, field loop 00:0265 | probable (port runs to the script's first event) |

## Battle (port P1)

| Location | What | Status |
|---|---|---|
| 00:19D0 | event 1B: objects hidden, a frame, bank 01, music kept (FFA0), sound 36 (00:10D7/10E1, 00:3A60 a sound tick from code), battle CA28 (FFCA = CA28 + 80; FF: from the zone 00:10F5), story flag 31: the map back (00:1151) | verified (parity battle1/2) |
| 00:1126 / 00:1D62 | formation l & 7F (0B:758B + 5 l -> CC59), CA14 set; 0B:6CEE, 0B:4000, bracket left; again while CEDA = FF | verified |
| 00:38D4 (rst $30) | far call through C0B2 (C3, C0B3/C0B4 written by the caller) with bank a | verified |
| 0B:6CEE / 0B:5BDF | battle screen: bracket, CE88 = 0, windows (0B:5BDF modes 0 battle start, 1 command menu, 2 end), 9800 blank, SCY 40 | verified (modes 0, 1) |
| 0B:4000 | the battle: music, backdrop 0B:405A, entities 0B:4444, C6E0 -> DD00, DDFF = 4/5, figures 0C:6001, effect 15, slide 0B:780A, script 0C:4A2D (0C:4000), effect 16 | verified |
| 0B:5A18 / 0B:40BF / 0B:4205 | formation layout CC30-CC58; monster pictures (0B:4301 sheet/size, 0B:43CC, 0B:43E4 -> decompress banks 0D/0E/0F to D000/D400, tiles to D800); group tile maps in D000 | verified (formation 01) |
| 0B:4444 | entities: party records -> D000 + 0x80 k, enemies (0E:7533 names, 0B:4A19 battle, 0B:533D abilities, 0B:470D class) through D680, 0B:708B ability flags | verified |
| 0B:780A / 0B:783B | opening slide: 32 steps of a bend table (0B:78D5) in DE40-DEBF; per frame, interrupts off, SCY/SCX for lines 0-40 as LY reaches them | verified |
| 0C:4000 | battle script interpreter (opcode table 0C:4320, expression codes 0C:433C, skip table 0C:437C; operand fetch 0C:43C0) | verified (statements reached by battle1/2) |
| 0C:4A2D | the battle script (tools/ffl3/bscript.py) | data |
| 02:4394 / 02:4364 | battle effects 00-17 by DE00 (14 and part of 12 jump into bank 0E) | verified for 15, 16, 17 and those battle2 reaches |
| 02:4000 | action display (C9BD effect or member/enemy action, 02:53EE action data) | verified (battle2) |
| 00:3175 | text control-code table (0x4E words); menu-mode output 00:3114 / 00:3168 | verified for the codes battle1/2 print |
| 00:39D5 / 00:1D2E | random byte FF90 = ror((FF93 + FF90) ^ 1) + FF90; below d | verified |
| 00:1C9C | 16-bit divide through the RAM code C0C0 (SP kept in C0C1/C0C2) | verified |
