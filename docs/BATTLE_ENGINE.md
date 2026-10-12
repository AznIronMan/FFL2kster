# Battle engine

Port notes on the battle code (banks 0D, 0F and the bank-1 battle menus), with evidence labels
(verified / probable / hypothesis) as in docs/ROM_MAP.md.

Wiring: `Engine` installs every module at construction (`installBattle`, `installBattleDisplay`,
`installBattleMenus`, plus `installFieldMenus` and `installSound`); routines are registered in
`engine.extra` under the entry addresses the original's callers use (0x191E, 0x190F, 0xD4000,
0xF6080-0xF6095, 0xD5000-0xD5018, 0x15015-0x15030). `@ffl2k/core` exports them as the `battle`
and `menu` namespaces. Several bank-0 helpers were ported locally by more than one module
(far-call bookkeeping 00:04BF, 00:0550, 00:0608); merging them into sys.ts is open clean-up.

## Battle menus (bank 1)

Port: `port/packages/core/src/menu/battle.ts` (`BattleMenus`, `installBattleMenus(engine)`).
Bank-1 battle code spans 01:6AD1-6FCD (6FCE-6FFF is data/padding; 01:6A51-6AD0 is the ending
screen of text code 0x4D, not battle code). Entry points from the 01:5000 jump table:

| Entry | Routine | What | Status |
|---|---|---|---|
| 01:5015 (00:01D7 ← 0D:40E9) | 01:6AD1 | battle screen: UI tiles (00:0550), blank window (6D12), D98B = 2 background (0F:608F), enemy window msg 0x32, party window msg 0x30 (+0x31 for the guest when progress variable 0 != 0) | verified (traces bm_init, bm_back, bm_cmd3); D98B = 2 branch probable (not traced) |
| 01:5018 (00:01DA ← 0D:412A) | 01:6AF9 | FIGHT/RUN (msg 0x33, B ignored), then a command per member able to act, B = back one member (from the first: 6AD1 again and FIGHT/RUN) | verified (bm_run, bm_back, bm_cmd1, bm_cmd2, bm_cmd3) |
| — | 01:6B52 | one member: list msg 0x34/0x35 (cursor per formation slot in C340 + 2*slot), entry must have id lo != FF, uses != 0 and item flag bit 0, else beep; none usable: msg 0x39 + beep, A = do nothing (FF8C = 0), B = back | verified (bm_cmd1-3; no-usable path with pokes) |
| — | 01:6C0C / 6C29 / 6D5D | enemy target: msg 0x36; flags bit 4 too: msg 0x38 and A/B (all enemies, D045 = 9); else group cursor over C380 = (D939+g, D933+g-2), only groups with [D501+0x100 g] != 0, down/right next, up/left previous (wrap over 3) | verified (bm_cmd1, bm_cmd2 with 3 groups) |
| — | 01:6AF2 | one-member target: party window again, menu → D045 = member | verified (bm_cmd1, guest's item 0x99) |
| — | 01:6D3C | leave: sprites/cursors off, window off (LCDC &= C3), battle tiles 04:6000 → 8200 (0x600) | verified |
| 01:501B (00:01DD ← 0D:429E) | 01:6C71 | meat prompt: meat sprite (6F74), push text context, msg 0x37 yes/no, msg 0x30 party list; member with status & 0x90 beeps; window rows 9C00 saved at 9D40 (0x140) and restored | verified (bm_meat_yes, bm_meat_no) |
| 01:5030 | 01:6F74 | meat sprite: 04:7C50 → 8000 (0D:5009), 10 steps of 2 frames (positions 0F:7B00 via 0D:500C, OAM at CC00 via 0D:500F, 0D:5006), tiles 8000 → 9000, BG 98C9/98E9 | verified with test stubs for the 0D routines |
| 01:502A (00:0CA2, text code 0x48 c b) | 01:6E27 | scripted monster appearance: D921 = c >> 4, D922 = c & 15, 0F:6092, tile source from 0D:5018 (A bank, HL, BC size); b != 0: plain copy to 9000; b = 0: interrupts off, wave (6F49) in, tiles streamed 0x20 bytes per vblank (6EE7), wave out | memory effect verified vs SM83 oracle; per-line SCX timing probable (no trace) |
| 01:502D (vblank 00:16DF when FFA5 != 0) | 01:6DC5 | tile animation: rotate the 2 bytes at [FFA7] right, low bits into [FFA9] (only when LY >= 0x90) | verified vs SM83 oracle |
| 01:5033 (frame tick 00:1718 when FFA5 != 0) | 01:6DF1 | FFA6 counter (0-15) → FFA7/A8 = 90E0/91D0 + 2(n&7), FFA9/AA = 9000/91C0 + 2(n&7) | verified vs SM83 oracle (FFA5 set by 0F:61E3) |

WRAM interface with the battle main loop (actor block D000 + 0x100 * member via 00:05D9 in
battle; member 4 = guest):

- inputs: D012 + 3i (i = 0-7) item/ability slots `[id lo, id hi, uses]` (verified);
  D040 status: `& 0x9B` member skipped (cannot act), `& 0x90` cannot eat meat (masks verified
  from code; bit meanings probable); D920 group count, D933/D939 group cursor column (+2)/row,
  D501 + 0x100 g live count (verified); D98B (= 2: extra background); progress variable 0
  (C2F6 high nibble) != 0: the guest is commanded too (verified).
- item flags: byte 0 of 0C:6F80 + 8 * id: bit 0 usable in battle, bit 5 enemy target (bit 4 with
  it: all enemies), bit 4 alone all members, neither: one member (verified by traces).
- outputs per member: D043/D044 item id lo/hi, D046 slot, D045 target: 0-4 member, 5-7 enemy
  group 0-2, 8 all members, 9 all enemies (verified). A member answering A to msg 0x39 keeps
  D043 = FF (set by 0D:4102) — it does nothing.
- 01:6AF9 result FF8C: FF = RUN; else the count of members commanded (4, or 5 with the guest);
  C709 = last member. 01:6C71 result FF8C: member who eats, or FF.
- 01:6D3C leaves the window off and reloads 04:6000 → 8200 before returning.
- calls out (`Engine.far`): 0F:608F (A = 2), 0F:6092 (A = c & 15), 0D:5018 (A = 0; returns A =
  bank and writes HL, B, C into the Regs object), 0D:5009 (HL = 7C50, B = 0x40), 0D:500C (HL,
  returns A, advances regs.hl), 0D:500F (A = 6, HL = CC00, B, C), 0D:5006 (B = 2). Entries
  0x1501B / 0x15030 take the caller's A from regs.a (else C0E5, which the farcall wrote).

Verification: `port/packages/parity/test/battle_menus.test.ts` replays traces
`bm_init bm_run bm_back bm_cmd1 bm_cmd2 bm_cmd3 bm_meat_yes bm_meat_no` (tools/trace_record.py
with `--hook 01:6AD1/6AF9/6C71 --mark 0D:40EC/412D/42A1`, pokes for bm_cmd2/3) through
`replayRoutine` (port/packages/parity/src/menuharness.ts): every rst $10 wait (1623 in all),
every frame's screen, and the machine at the return address (farcall trampoline C0E4-C0E8
included: nested farcalls mirror it with the caller's A). Tolerances: the blink timer and the joypad auto-repeat state C774/C775 are
re-phased when they are the only difference (after a cursor move the menu engine spends ~25
lines, so its next joypad read falls after the following frame's sample — measured in PyBoy).
6DC5/6DF1/6F49/6E27 are checked against the SM83 oracle on random inputs
(tools/battle_menu_oracle.py).

## Battle main loop (0D:4000)

Port: `port/packages/core/src/battle/main.ts` (bank 0D below 5000, `installBattle(engine)`) and
`port/packages/core/src/battle/formation.ts` (00:2ADF / 00:2AE6 / 00:2B14). Calc-VM generator
API: `CalcVm.runScriptCo(n, natives)` / `runCo(de, natives)` in `core/src/calcvm.ts`.

### Entry and flow (verified: traces bt_* replayed wait-for-wait, routine oracle)

Field script code 09 (00:0EC5) closes the window, calls **00:191E → 00:2ADF** (random formation
for the zone) or **00:190F → 00:2B14** (formation C), sets C764 = C763 = C7DE = 0, FF8B = FF
(battle mode), pushes the text context and **far-calls 0D:4000** (00:0EEE, A = FF; the far call
leaves C0E5 = A, C0E7/C0E8 = 00 40 and FF88 = 0D, and restores the caller's bank on return).

1. **Setup 0D:4000-40DB** (no waits): CF00-CFDF = 0 (VM variables); D844 = CFEA; D000/D001 …
   D700/D701 = 0; enemy groups packed from D500 for each non-zero count CFE0/CFE2/CFE4 (count at
   +00 and +01, id CFE1/3/5 at +0A); 0D:44F4 loads each group, D849-D84B = DE10 after each of the
   three slots (stale when the slot is empty); party blocks D000-D400 from the member records
   (0D:449A, record = 00:1B99(a, C200)); guest block cleared (D400/D401 = 0) unless progress
   variable 0 is set (00:0198 → 00:0608, FF90 = 5); enemy HP (0D:443A); MAGI owners from C2DA
   (14 × [owner nibble, count] → block +2A/+2B/+2C); ability flags 0D:43FA for all 8 blocks; last
   actions D84D-D85C = FF 00; music FFB0 = CFE9 + 0x11 (CFE9 = 3: unchanged).
2. 00:01D4 → **0F:6080** battle screen (A = music value); **script 0** (first strike); D848 = 0.
3. **Round** (0D:40E9): 00:01D7 → **01:5015** (A = 0, later 0x1F); 0D:40EC: D848 += 1, D803-D843
   = FF, D802 = 0, each block's action slots +43/+44 + 8i = FF 00, forced actions 0D:4579.
   Unless D800 = 2 (enemy initiative): 00:01DA → **01:5018** (A = D800), FF8C = FF → **script 1**
   (run): D801 ≠ 0 → escaped: FFB2 = 0x38, 0D:4152, 0D:437E, 00:1915, FFB0 = C31A, return; else
   0D:4579 again. Unless D800 = 1: **script 2** (enemy actions). D800 = 0; **script 3** (turn
   order D803).
4. **Actions** 0D:417E, pairs [slot, actor] from D803 until FF: actor block D0+actor alive (+01)
   and slot status (+40 + 8·slot) & 0x90 = 0 → status bit 3: **script 4** (confusion); **script
   5** (execute); 0D:41BD uses bookkeeping (last action D84D + 2·actor = [+43, +44] + 8·slot;
   uses at +14 + 3·[+46 + 8·slot] decremented unless FE, action FF, or 0E / 0F-with-target ≠ 0
   and target 1); 00:01E3 → **0F:6083** (A as computed); party alive sum D001-D401 = 0 → defeat,
   enemy sum D501-D701 = 0 → victory (0D:435A). D802 += 1 per entry.
5. End of round 0D:4217: checks; **script 6** (poison); 0F:6083 (A = 0x1F); checks; **script 7**
   (regeneration); next round.
6. **Defeat 0D:4251**: D90C = 0x59, rst $20; 0D:4152; BGP/OBP0/OBP1 = 0; D85E = C763 = 1;
   FFC0 = 2; FFB0 = 7; return (no field restore: 00:0EF7 runs the game-over script).
7. **Victory 0D:4274**: FFB0 = 3 unless D50A = FF; D85E = 0; D90C = 0x5A, rst $20; 0D:437E
   (write back); unless D50A = FF: **script 8** (GP, drops); D845 ≠ 0 → 00:01DD → **01:501B**
   (A = D845; FF8C = eater or FF) → D84C = eater, **script 9** (meat), D846 ≠ 0 → 0D:42C0
   transformation of the eater's record (00:1B99(eater, C204)); **script 10** (growth); 0D:4152;
   00:1915 (field restore); FFB0 = C31A.

0D:4152: wait (rst $10) until FF89 changes to a non-zero value, then 00:01F2 → 00:06F4 (FF8B,
C764, FF96, FFA5 = 0) → 00:0550 (03:7F00 → 8700 with VRAM pacing, bank 3 mapped).

### Formation (00:2ADF / 2AE6 / 2B14) (verified: 23 oracle cases each; bt_field trace)

00:2AE6: rand(stream 0A, 0..FF) against the 7 thresholds 0D:6560 → index c (0-7); formation =
0D:6570 + 8·C454 + c; bank 0D stays mapped (rst $28). 00:2B14: n = C & 0x7F, record 0D:6C70 +
5n: 3 enemy ids → CFE1/CFE3/CFE5, flag byte (byte 3, or byte 4 when C bit 7 — bit-7 path not
exercised in play; 391 synthesized oracle cases) → CFE9 = bits 7-6, D844 = CFEA = flags (bit 5 = no escape, probable from
script 1), row = bits 0-4 → 0D:6EF0 + 3·row: per group count = rand(stream 0B, hi nibble, lo
nibble) → CFE0/CFE2/CFE4; FFB2 = 0x28; then 00:2CBE split opening.

### Combatant blocks D000-D7FF (0x100 each; D0-D4 party members 0-3 + guest, D5-D7 enemy groups)

| Offset | Content | Status |
|---|---|---|
| 00 / 01 | count (party 1) / alive count (party: 1 − status bit 4) | verified (setup code, alive sums 0D:435A) |
| 02-09 | name (party: 4 bytes + FF × 4; enemies 0F:6EC0 + 8·id) | verified |
| 0A / 0B | id (class / monster id) / type (0D:6F80 byte 0 hi nibble for enemies) | verified |
| 0C-11 | max HP (2), STR, AGL, MANA, DEF | verified (copies of C209-C20E / 0D:6F80 + 2..7) |
| 12 + 3k | ability k (k = 0-7): id lo, id hi (0 when built; MAGI ids ≥ 0x100 probable), uses (FE unlimited, enemies) | verified layout; meaning probable |
| 2A-2C | MAGI [C2DA index, 1, count] (FF 00 FF none) | verified layout (0D:4096, 0D:43DF) |
| 2D / 2E | OR of 0C:6F85 + 8·id for abilities with 0C:6F82 & 0x30 = 0x10 / other | verified computation; meaning probable |
| 40 + 8i | member i: status (party: C206 hi nibble written back) | verified layout |
| 41-42 + 8i | member i HP (enemies: max − rand draw, 0D:443A) | verified |
| 43 / 44 + 8i | action (ability slot or code: FF none, 0E/0F forced by status bits 1/0) / target | probable |
| 46 + 8i | ability slot index whose uses are decremented | probable |

D800 initiative (1 party first, 2 enemy first) · D801 escaped · D802 actor counter · D803-D843
turn order pairs · D844 formation flags · D845 drop pending · D846/D847 transformation flag / new
id · D848 round counter · D849-D84B ability count − 1 per enemy slot (DE10) · D84C eater ·
D84D + 2·actor last action [code, target] · D85E defeat flag · D90C message id · D910 animation id ·
DE00-DE09 enemy record scratch, DE10 ability count − 1. (Writes verified by the oracle; meanings
probable unless used by the VM scripts documented in BATTLE_RULES.md.)

### Calc-VM call sites (0D:4361: pointer 0C:4680 + 2n, farcall 0C:4000 with A = pointer hi)

0D:40E2 script 0 · 0D:4136 script 1 · 0D:416F script 2 · 0D:4178 script 3 · 0D:41AF script 4 ·
0D:41B8 script 5 · 0D:422C script 6 · 0D:4247 script 7 · 0D:4294 script 8 · 0D:42B5 script 9 ·
0D:434B script 10. Natives: 0x0020 (rst $20, battle message D90C) and 0x01E0 (00:18AE → farcall
0D:5000 animation, A = 01) run inside the script where the interpreter calls them (frame waits
included) — `CalcVm.runCo` / `runScriptCo` take them as coroutines.

### Bank-0 calls (far-call stubs leave C0E5 = A, C0E7/C0E8 = target; FF88 = target bank)

01D4 → 0F:6080, 01D7 → 01:5015, 01DA → 01:5018, 01DD → 01:501B, 01E0 → 0D:5000, 01E3 → 0F:6083;
0198 → 0608 (FF90 = A, var 0), 01F2 → 06F4, 1915 → 1B5F (field restore), 1918 → 1B99 (member
record address). The 16-bit division 00:033F used by the VM saves SP in C0E1/C0E2 (a machine
stack address, excluded from trace comparison like the call stack).

### Evidence

- Routine oracle (tools/routine_oracle.py, scenarios battle_*; parity/test/battle.routines.test.ts):
  0D:4000 setup 27 cases, 40EC 42, 41BD 131, 435A 322, 4361 363 (scripts 0-3, 5-10), 437E 27,
  43FA 192, 443A 72, 449A 120, 44F4 38, 4579 42, 42C0 25 (meat transformations), 00:2AE6 23,
  00:2B14 23 — all memory changes, FF88 and live-out registers equal. Plus variants on the real
  snapshots (`routine_oracle.py synth`): formation numbers incl. bit 7 (391), zones (253), RNG
  counter (667), setup with other enemy ids / group counts / party order (575), write-back with
  other status / HP (253), forced actions by status (245) — 3879 cases in all.
- Traces (parity/test/battle.test.ts): bt_win45, bt_win180, bt_run, bt_runfail (D844 bit 5
  poked), bt_meat (party HP 1: death, meat, Eat prompt), bt_defeat (party HP 1 vs 3 × enemy 100),
  bt_field (world map → encounter → battle). With the display and menu modules installed every
  battle trace runs to the return of 0D:4000 with the same number of waits and the same screens
  and the machine at the return equal. After integration (all modules installed by the Engine)
  every wait of all seven traces matches (bt_win45 742, bt_win180 949, bt_run 196, bt_runfail
  1517, bt_meat 3080, bt_defeat 1106, bt_field 1056) with two fixes in the frame model: busy
  frames get a frame tick only where the original's sound-driver counter FFB4 advanced (the field
  restore 00:1B5F runs with the LCD off), and a wait reached by code polling LY with interrupts
  off (0F:61ED wavy intro, its own tick at line 64) is compared at the frame's end. Only bt_field
  frames 258 and 317 are listed screen exceptions (mid-frame register writes). Script 4
  (confusion) has no captured case (the VM itself is verified separately).

## Display and animation (0F:6080, 0D:5000)

Port: `port/packages/core/src/battle/display.ts` (bank 0F, 0F:6080-64E7), `anim.ts` (bank 0D,
0D:5000-60DA), `index.ts`; `installBattleDisplay(engine)` registers both entry tables in
`engine.extra` (0xF6080 ... 0xF6095, 0xD5000 ... 0xD5018). Each entry behaves like the
original far call: C0E7/C0E8 = entry, C0E5 = `regs.a` (left unchanged when `regs.a` is not
given), target bank mapped (FF88), caller's bank restored. Register results are written back
into the `regs` object (and A returned). Far calls between banks 0F and 0D inside these modules
do the same bookkeeping, with the A register tracked exactly (oracle-checked).

Labels: **verified** = PyBoy routine traces (hook at the entry, recorded until the return:
same machine state at every rst $10, same screens per frame, same machine at the return;
`port/packages/parity/test/battle_display.test.ts`, 164 traces, 7.3k waits, 7.7k frames) and/or
SM83 oracle (`port/packages/core/test/battle_oracle.test.ts`, 1352 entry snapshots from real
battles); **probable** = ported from the disassembly, not exercised.

### 0F:6080 table

| Entry | Code | What it does | Regs in → out | Status |
|---|---|---|---|---|
| 0F:6080 | 6098 | Battle opening: screen black, 9800-9FFF and CC00 cleared, UI tiles 04:4700 → 9700, D90D-F = 0, battle kind D98B (C7F3 = 0 → 2; C7F3 listed at 0F:62A6 → 1; else 0), enemy layout 0D:5012, tile offsets 0F:6257, graphics 0F:627F, enemies drawn 0F:6146, window WY 40/WX 7, intro (kind 0: wavy raster 0F:61ED, 16 frames, interrupts off, SCY per line, frame tick at line 64; kind 1: none; kind 2: FFA5 = 1 / FFA6 = 0), palettes D2/D2/81 (+ C700-C702) | — | verified (kinds 0, 1; 1-3 groups, 4 species); kind 2 probable (needs the bank-1 FFA5 handlers 01:502D/5033) |
| 0F:6083 | 62AD | After an action: 04:7FE0 → 8000 (16 bytes, 0D:5009); groups whose count D501+0x100k is 0 vanish once (62E9: rows blanked top/bottom inwards, 4 frames per pair, then a 9-sprite burst and OBP0 81/40 flash unless D97A; kind 2: 63E8 backdrop + quake/scroll 64 lines, sound 0x27), D986-marked groups slide back in from 7 rows above (6471); D97A set → 0D:5003 | A (C0E5 only) | verified (natural deaths, slide, dark restore, kind-2 death) |
| 0F:6086 | 6146 | Clear the enemy rows 9800-98FF (kind 2: backdrop pattern 61A9) and draw every present group (6166) | — | verified |
| 0F:6089 | 6166 | Draw B rows of C consecutive tiles from D at HL (stride 32, rows above 9800 skipped), VRAM window | HL, D, C, B → HL after, D after, A = 0x20, B = E = 0 | verified (traces) |
| 0F:608C | 6180 | Group FF90: D = first tile (D92D+2k), C = width, B = height | FF90 → A = 2k, B, C, D, HL = D928+2k | verified (oracle 116) |
| 0F:608F | 61A4 | Backdrop pattern (tiles 00 0E / 1C 1D) over 9900, 5 row pairs | — | verified (bd_restore_kind2) |
| 0F:6092 | 6257 | Sizes (0D:5015), then D92D+2k = running first tile, D92E+2k = w × h | A (C0E5) → A = tile total | verified (oracle 77) |
| 0F:6095 | 61CA | BG address of group A: 9800 + 32·D939[A] + D936[A] | A → HL (A, BC, DE kept) | verified (oracle 116) |

### 0D:5000 table

| Entry | Code | What it does | Regs in → out | Status |
|---|---|---|---|---|
| 0D:5000 | 501B | Battle animation D910 (OBP1 = 0x16 first). Bit 7 set: sprite script 07:6800+2i with tiles 04:6000+16n (n from 07:6700+2i, 0x200 bytes → 8000) on group CFF5−5, on each group in turn (CFF5 = 9, or D910 = A0 with per-group flips), or fixed (07:6701 bit 1). Script bytes: FF end; 80-9F/C0-FF screen effect (low 6 bits); A0-BF tile base D973 = next byte; else a frame: 6×8 cell grid RLE-unpacked from 01:7000+2n into D943, flips (bit 6 V, bit 5 H, bit 4 palette), OAM at CC00, shown 4·(lo+1) frames. Bit 7 clear: screen effect D910. | — | verified: every sprite animation 80-EA, single and all-groups targets |
| 0D:5003 | 5399 | Restore after darkness: screen copied to the window (shown full screen), enemies redrawn (0F:6086), window off, enemy area lightens from black (3 steps × 7 frames, palette band at LY 0x40), window rows restored, kind 2: 0F:608F | — | verified |
| 0D:5006 | 60D3 | B × (rst $10, OAM DMA from CC00) | B → B = 0, A = 0 | verified (traces) |
| 0D:5009 | 60BE | Copy B bytes of bank-04 tiles from HL to 8000 in a VRAM window | HL, B → HL, DE advanced, A = 4 | verified (traces) |
| 0D:500C | 60B9 | Byte at HL in bank 0F | HL → A, HL+1 | verified (oracle 136) |
| 0D:500F | 6082 | Compose sprite A of 0F:7B80 (records dy, dx, attr) at HL with offsets B (y), C (x) | A, B, C, HL → HL after (A, DE kept) | verified (oracle 136) |
| 0D:5012 | 525B | Enemy layout: D920 count, D921/D922 class/index (0D:6400 by id D50A+0x100k), sizes, centres D933 (0D:6540), left D936, tops D939 (0D:6550); FF90 scratch | → A | verified (oracle 77) |
| 0D:5015 | 52E0 | Sizes D927/D928 (0D:6500 by class) | → A | verified (oracle 150) |
| 0D:5018 | 5302 | Graphic of group FF90: A = bank, HL = base (0D:6510) + index·tiles·16, BC = tiles·16, D = tiles | FF90 → A, HL, BC, D | verified (oracle 116) |

### Screen effects (D910 bit 7 clear or script bytes; table 0D:5EB5, wrapped by 0D:533E = clear sprites, effect, clear sprites)

| # | Code | Effect | Status |
|---|---|---|---|
| 00 | 535B | window shakes vertically (WY 0x40 + 0D:5F03), twice | verified (natural enemy attack) |
| 01 | 5378 | message box moved down, enemy area darkens (5446), enemies erased behind a full window; D97A = 1 until 0D:5003 | verified |
| 02 | 5427 | darken then lighten the enemy area (palette band above LY 0x40) | verified |
| 03 | 54C2 | background shake SCX then SCY, twice | verified |
| 04 | 54E8 | LCD switched off/on at LY 0x91 (DIV wait) + 5 frames, twice | verified* |
| 05, 0A, 14, 1D | ret | nothing | verified |
| 06 | 5513 | target groups rise out of view (redrawn a row higher per step, rows blanked from the bottom), D986 = 1 → 0F:6083 slides them back | verified (1 target, all 3) |
| 07 | 55DC | target images roll up through themselves 3 times (buffer C800+0x100k) | verified (1, all 3) |
| 08 | 5687 | target group count = 0, then 0F:6083 (vanish) | verified |
| 09 | 569C | black band at lines 0x2F-0x30 for 15 frames | verified |
| 0B | 56C1 | 20 falling drops (particle engine) | verified |
| 0C | 5760 | fx 21, then a sprite rises from each group | verified (1, 2, 3 groups) |
| 0D | 5975 | bubbles | verified |
| 0E / 13 | 5A1A / 5A10 | sparkles (16 bursts / 8, 2 / 1 frames) | verified |
| 0F | 5AC8 | 40 particles spiral inwards (polar 0D:5F61, sine 0F:4100), then fx 01 | verified |
| 10 | 5B86 | sparkles | verified |
| 11 | 5801 | fx 21, then 10 particles rise swinging | verified |
| 12 | 547A | horizontal wobble, twice | verified |
| 15-18 | 5C38/4E/65/7C | flash at a corner, then a sprite with a 5-step diagonal trail | verified |
| 19 | 5D3C | tiles 9300/93E0/94C0 saved to D98C and animated (04:7D20+), 3 sprite flashes, then fx 1C | verified |
| 1A | 5E53 | the tiles animate back and are restored from D98C | verified |
| 1C | 5D87 | 4 sprites orbit with a growing radius, sound 0x26 | verified |
| 21 | 58CE | 10 particles slide right in waves | verified |
| 1B, 1E / 1F / 20 | 5E6E / 5E73 / 5E78 | far call 01:502A (01:6E27, enemy graphic change) with BC = 0033 / 0134 / 0135 | probable (bank 01 not in this port) |
| 22 | 5E82 | far call 01:5030 (01:6F74) | probable |

Particle engine 0D:5FBC: slots k < C994 (C800 delay, C828 done, C850 x/y, C8A0 phase, C8C8
sprite id, C8F0/C918 polar, C940 offsets −0x80), sprites composed through 0D:6082 at the pointer
C990; per-slot handler C992 and per-frame handler C993 from 0D:5E96 (15 handlers); ends when
all C828 = FF (0D:6057), then 0D:60CE. RNG streams 0x30-0x33 (00:043E). verified (oracle for
5F61/6057/6082, traces for all handlers).

\* Effect 04: the frame model has no LCD on/off timing. `anim.lcdRestarted` (WeakSet of Game)
marks that the LCD was restarted; the renderer must show no picture for the frames drawn
until the next frame wait (PyBoy: one uniform shade). The routine trace harness does this; the
app renderer should too. PyBoy also counts one extra tick per restart (absorbed by the
wait-synchronised replay as a busy frame).

### Notes for callers (main loop / bank-1 menus)

- Routines read: D500-D7FF group blocks (+0 present, +1 count, +0x0A id), D910 animation id,
  CFF5 target (5-7 group, 9 all), C7F3 formation (opening), FF90 current group (0F:608C, 0D:5018),
  D97A dark flag, D986-D988 slide-in flags, D98B kind; they write the D920-D98B layout and
  scratch, C800-C995, CC00 (OAM page shown by DMA from CC), FF90-FF92, FFB2 (sound requests 0x26/0x27).
- Raster parts use `game.lineHook` (palette band at LY 0x40: effects 01/02, 0D:5003; band
  0x2F-0x31: effect 09; wavy intro with `game.ime = false`): nothing else may own `lineHook`
  during those calls.
- Bank-0 helpers ported locally (display.ts): 00:04BF far-call bookkeeping (`farcall`,
  `farcallSync`), 00:0094, 00:009C, 00:00AC/00A4, 00:00B5, 00:00C3, 00:00CA (source bank stays
  mapped across the VRAM window's waits), `loop8` (dec b/jr nz counts, 0 = 256).
- Harness detail (routine traces): PyBoy's tick runs from line 0 through vblank; waits are
  compared at the end of the frame's lines (where the original wakes), waits completing in the
  hook's own tick are labelled −1, frames drawn while the original's code segment was still
  running (next wait > 1 frame later) are not compared pixel-wise (their state is checked at the
  next wait). `tools/bd_capture.py traces` / `snaps` regenerate every fixture (build/, never
  committed); controlled changes only rewrite D910/CFF5/D97A/D986/D98B/C7F3 or clone the real
  group block at the hooked entry.
