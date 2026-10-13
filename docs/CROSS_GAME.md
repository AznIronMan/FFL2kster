# Cross-game comparison (Legend I vs Legend II)

Running note of what transferred from the Legend II method to Legend I and what differed. It is
the design input for TOLkster later (not designed or built now). "Same" claims need evidence from
both ROMs; differences are listed first because they are the valuable part.

## Differences (evidence in docs/ffl1/ and docs/)

| Topic | Legend I (USA) | Legend II (USA) |
|---|---|---|
| Cartridge | MBC2+BATTERY, 128 KiB (8 banks), 512 × 4-bit built-in RAM | MBC1+RAM+BATTERY, 256 KiB (16 banks), 8 KiB SRAM |
| Bank switch | `rst $28`, writes `$2100`, keeps the bank in FF8B, returns the old bank | `rst $28` at 00:04B1 (MBC1 `$2000` range) |
| Alphabet | `A` = 0x8A, `a` = 0xA4, `0` = 0x80 | `A` = 0xBA, `a` = 0xD4, `0` = 0xB0 |
| Text | two interpreters: engine (00:0911, codes 00–3F) and dialogue (00:0EBA); dictionary in two blocks 0x50–0x7F + 0xC0–0xE7, copied to RAM | one interpreter; dictionary 0x4E–0x9D (0F:6560), control codes 0x00–0x4D via 00:13BE |
| Monster table | 06:6AE8, 200 × 9 bytes | 0D:6F80, 256 × 10 bytes |
| Monster HP | an HP class (index into 06:7254) with a random reduction of up to base/16 | a u16 HP value |
| Stat order | Str, Def, Agl, Mana | Str, Agl, Mana, Def |
| Ability count | b0 bits 3–5, + 1 | b0 low nibble, + 1 |
| Names | one shared table (05:4000): monsters 0–199 then items | monster names 0F:6EC0 (8 × 256) |
| Enemy name in battle | read from ROM when drawn | copied into the WRAM group block (D500) |
| Battle state | 32-byte combatant slots at D000 (heroes 0–3, enemies 4–7), HP little-endian at +3 | enemy group block D500, party slots C200 |
| Encounters | area records (3 ids + formation) at 06:6868, formation nibble ranges at 06:72C4 | encounter tables per area (docs/ROM_MAP.md) |
| RNG | per-call-site counters (C300+, keyed by the caller's address) into a 256-byte table at CB00 | streams modelled in docs/ROM_MAP.md (00:043E) |
| Items | one 8-byte record per id at 06:7700; names share the monster name table; default uses kept in the name entry | separate item name and stats tables |
| Meat | drop chance in the monster record (b0 bits 0–2); result = family × family table, then level → monster | measured matrix / formula (docs/ROM_MAP.md) |
| GP rewards | class nibble in the monster record → 16-entry BCD table | per-enemy reward data (docs/ROM_MAP.md) |
| Party creation | one hero created and named; the rest recruited later | the whole party chosen at the start |

## Transferred unchanged (method and generic code)

| Piece | How |
|---|---|
| Cartridge header, checksums, bank math, byte patch/diff | `ffl2kster.rom` / `ffl2kster.build` imported as is |
| Project manifest | `ffl2kster.project` imported as is |
| Name-space character | 0xFF = space/padding in both; 0xF2 = `-` (probable in both) |
| Method | relative search → table → loader code → controlled changes with neighbour controls → emulator acceptance; held up unchanged |
| Tooling | mgbdis + RGBDS round trip; PyBoy states from cold boot; hook-on-loader battle detection |

## Shared shape, different details

- Battle effects dispatch through a handler table indexed by an item/ability byte: 49 handlers in
  Legend I (06:403A), 50 in Legend II.
- Mutants grow randomly after battles and monsters change by eating meat in both games; the tables
  and formulas differ.

- Both games keep monsters, party monster forms and human types in one stats table indexed by a
  monster id, with an ability id list per record and a count in byte 0.
- Both build battles from a per-area record of monster ids plus a formation.
