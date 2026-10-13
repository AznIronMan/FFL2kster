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
| Encounters | per-map zone slots → zone (rate + 7 areas weighted 1/2…1/128) → area (3 monster ids + formation, bit 7 = alternate) → formation nibble ranges; battle started as event command 8 | encounter tables per area (docs/ROM_MAP.md) |
| RNG | per-call-site counters (C300+, keyed by the caller's address) into a 256-byte table at CB00 | streams modelled in docs/ROM_MAP.md (00:043E) |
| Items | one 8-byte record per id at 06:7700; names share the monster name table; default uses kept in the name entry | separate item name and stats tables |
| Meat | drop chance in the monster record (b0 bits 0–2); result = family × family table, then level → monster | measured matrix / formula (docs/ROM_MAP.md) |
| GP rewards | class nibble in the monster record → 16-entry BCD table | per-enemy reward data (docs/ROM_MAP.md) |
| Maps | 200 records (variable length), 64 × 62 metatile buffer, layout command stream with 4 command forms (bank 03) | 212 maps; layout command format at 00:2253 (banks 08/09) |
| Events | per-map object lists with presence ranges on story flags; commands 0–2 dialogue, 3 chest, 4 facility, 5/6 warp, 8 battle | event kinds incl. F0–FF (docs/EVENTS.md) |
| Shops | 25 inventories × 10, 3-byte BCD prices per item (bank 05) | shop events + item price table (docs/ROM_MAP.md) |
| Graphics | uncompressed 2bpp; BG sets pick 128 tiles from 1 KiB blocks of bank 01; metatile m = tiles 0x80+4m; 1bpp font; monster pictures in 5 size classes (bank 04) indexed by the same family byte the meat code uses | monster art in banks 05/06 by family; tilesets via 00:1F55 (docs/ROM_MAP.md) |
| Music | 3 channels (pulse, pulse, wave), 18 songs; tempo accumulator ticks at 60; note byte = pitch nibble + duration index | sequence driver in bank 0E with envelopes, vibrato, wave tables, SFX table (docs/MUSIC.md) |
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

## Port (TOL engine core reuse)

- The native-port pattern transferred unchanged: one function per original routine over the
  original memory map, generators yielding at the frame wait, busy frames from the trace's wait
  gaps, wait-by-wait replay against PyBoy. `@ffl2k/render` (line PPU) is reused as is; Legend I
  adds an MBC2 memory (bank select by address bit 8, 512-nibble RAM) and its own interrupt layout
  (vblank 00:06D3, STAT handlers via the jp at C39D, rst $10 halts until LY ≥ 0x90).
- Both games' menu and text code read leftover caller registers (Legend I: 00:08D4 text position
  from b/c, 00:2B2E page window from de/b/c), so the port tracks those registers where they leak
  into RAM.
- Legend I has an RNG keyed by the caller's return address (00:07D3: 128 counters at C300 into
  the table at CB00) instead of Legend II's single stream; each rand site is named in the port.
- Same CPU-time effects in both (late joypad reads, mid-display writes), handled by counted
  replay rules rather than a CPU model.
