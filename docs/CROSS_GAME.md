# Cross-game comparison (Legend I, II and III)

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

## Legend III (first notes, milestone 1; evidence in docs/ffl3/)

| Topic | Legend III (USA) | Closest to |
|---|---|---|
| Cartridge | MBC1+RAM+BATTERY, 256 KiB, 8 KiB SRAM, DMG only | Legend II (same type and sizes) |
| Encounters | a zone row of 7 formations picked by 6 random thresholds (03:76BC / 03:76C2); later battles open with a raster wipe (01:5EB8) | not compared yet |
| Save | 3 slots and a stash (slot 3) of the 2D2 bytes C500-C7D1, each kept twice (A000 + 2D8 k and + B60) with a magic and a 3-byte checksum; a bad copy is repaired from the other on load | not compared yet |
| Bank switch | `rst $20` pushes a bank on a RAM stack (C0A0, depth C0B0, current C0B1), `rst $28` pops; `rst $18` far call with an inline byte (bank-0 routine or table entry) | neither (a bank stack instead of save/return) |
| Interrupts | vblank / STAT through RAM vectors C0B9 / C0BC | Legend I's STAT jp in RAM (C39D) |
| Alphabet | `A` = 0xBA, `a` = 0xD4, `0` = 0xB0 (punctuation AF . F0 : F1 / F2 - F3 ! F4 ?) | Legend II (identical letters and digits) |
| Text | one script interpreter for dialogue, battle and menus; dictionary of 80 length-prefixed entries (03:71C5) reached by 4E-87 and 22 low codes, recursive (entries may hold codes); scripts reference each other by a 2-byte bank-coded address; scene changes are script codes | Legend II's dictionary range 4E-9D is similar; Legend I has two interpreters |
| Monster data | three tables in bank 0B, 195 ids: battle record 12 bytes (4A19), class record 4 bytes (470D), ability list 9 bytes (533D); names 0E:7533 | split, unlike both (one record per id in I and II) |
| Monster HP | 12-bit value (byte + low nibble of the next), × 16 for the eight last ids (bosses) | Legend II (stored value), not Legend I (class + random) |
| Battle entity | 0x80 bytes per enemy, built in a staging slot (D680) and copied once per group member (D280, D300, ...); name copied into it | Legend II (name in WRAM); Legend I keeps 32-byte slots |
| Ability list | a mask byte + 8 fixed slots (set bit: battle ability) | neither (count + list in I and II) |
| Items | one id space for spells (00-2F), weapons, armor, items; four record tables of 6/7/5/5 bytes chosen by id range; names icon + 5 (spells) or icon + 7 | split by kind, unlike Legend I's single 8-byte table |
| Encounters | per-map rate (rand < rate per step) and zone; zone = 7 formation slots chosen by six thresholds; formation = 3 ids + flags + fixed-count byte | Legend I's zone → area → formation chain, flatter |
| Growth | EXP and levels (EXP per battle = sum of the enemies' class byte / 4); equipment totals stored in the party record when equipped | neither (no EXP in I or II) |
| Graphics | maps and monster pictures compressed (fill byte + bit mask per block); pictures bitplane-separated in sheets of up to 8 slots; map tilesets as four 512-byte blocks | Legend I: uncompressed tiles and pictures |
| Music | 4 channels incl. noise, 20 songs; tempo accumulator with two ticks per carry; duration in the note's low nibble; per-channel command tables with two loop counters | Legend I: 3 channels, 18 songs, tempo ticks at 60 |
| Monster abilities | a separate skill id space (00-6D, 6-byte records, own names) selected by a mode flag (CE25) | neither (I and II share the item ids) |

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
- Legend I's battle screen effects are polled per-line register loops with interrupts off (bank
  07); the port renders them through line hooks, as the Legend II port does for its own rasters.
- Sound: Legend I's driver (bank 07) is a different design from Legend II's (three music channels
  with per-channel envelope / pitch / duty / panning table walkers, tempo accumulator CEC2, jingles
  that save the music); the port reuses only the APU model (@ffl2k/audio) and the web audio path.
- Parity: both games need the same counted rules for CPU time (late writes, tears, joypad
  re-phase); Legend I adds rules for its polled rasters, PyBoy's LCD-off blanking, DIV-seeded
  random counters at start-up, frame-tick polling loops (TICK) and late LCD register writes. The
  field sweep design (every map through its first warp) carried over from Legend II's P2.
- Runtime (Legend III, port P1): frame waits count FF95 down in the vblank handler (Legend I:
  rst $10 halts until LY >= 90); VRAM is written by polling hblank (00:20FF) inside a bracket
  that swaps the interrupt handlers, not by a line-paced STAT handler as in Legend I. The
  port-side design (generators, original RAM, busy frames from the trace) carries over; the busy
  frames are taken at the wait's start because Legend III's copies span several frames.
  Legend III's interrupt-time frame work (00:3557, up to ~90 lines of hblank-paced copies) can
  nest a second STAT (only the sound runs, CDC5 set); the replay takes its end from the trace.
  Legend III's battle flow is a bytecode script (0C:4000 interpreting 0C:4A2D, natives by
  address), not native code as in Legend I/II; its random draws depend on the interpreter's CPU
  time, so the replay supplies the frame counter at each draw.
  A frame wait's frame should be taken from the vblank interrupt that ends it, not from where the
  code resumes: Legend III's normal vblank handler (tile list, sound) can run into the next frame.
  Its rst $20 / rst $28 bank switches end with reti, so code that switches banks turns the
  interrupts on (an interrupt-time frame work can be interrupted).
  Legend III's wave fade runs a STAT handler at every line; its SCX write lands within a few
  dots of the end of the line's drawing (mode 3, lengthened by objects), so whether a line shows
  the new value is a cycle-level question. The port picks one side and the replay accepts both.
  Legend III's VRAM bracket polls STAT mode 1 with the interrupts off; entered on line 153 it ends
  at the next frame's top or a whole frame later depending on cycles, which a trace (frames, not
  cycles) shows only through what the original ran next: the port takes it from there.
  Legend III's sound driver is ported like Legend I's (the original RAM compared), but its
  requests are written by code whose CPU time the port does not spend: the replay times the writes
  from a record of them (a list per request byte) rather than with sync points that would hold the
  code.
- 1.47.0: Legend III's earthquake (event 2C) is a raster effect — an hblank STAT interrupt on every
  visible line rewriting SCY — so the port models hblank requests line by line for it; its ending
  runs the credits through the battle screen and the opening's slide code.
- 1.48.0: Legend III's hblank copy 00:20FF keeps clear of the LYC lines (no chunk while LYC - LY
  < 3) and rewrites a chunk whose hblank ended under it (STAT mode 2 seen after the writes); the
  bytes still land, so a chunk shows from the first line it was tried on.
- 1.49.0: Legend III's object drawing (00:01A0) holds the vblank DMA with CD39 and releases it
  just before returning; a vblank in between DMAs the finished buffer.
