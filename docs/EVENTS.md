# Event system: scripts, triggers, NPCs, shops, chests, music

## One mechanism

Map trigger tiles, NPC/objects and the script op `0x19` all raise an **event (kind, arg)**.
The field loop handles it at **00:3924** (kind = C443, arg = C442). The handlers are
00:3A60 (message/script), 00:39B4 → 00:14AC → 01:647A (shop) and 00:1AEC (warp).

| Source | Kind | Arg |
|---|---|---|
| Header trigger | b1 | b0 |
| Object (A button, 00:3092) | attr & 0x0F (object +0x0A) | message byte (object +9) |
| Script `⟨19 k a⟩` | k | a |

| Kind | Meaning | Status |
|---|---|---|
| 0 | run story script `a` (0B:4000 table) | verified (Mr. S object → story[0]; town triggers) |
| 1 / 2 / 3 | field message/script `(k−1)·256 + a` (0A:4000) | verified (town NPC field[8..11], text changed with the byte) |
| 4 | shop `a` (8 ids at **0F:79E0 + 8a**); `a` = 0xFF → inn (01:628A) | verified (trigger rewritten to shops 0/3/20: 01:647A runs with E = n and stocks C71D from the table) |
| 5 / 6 | warp to destination record `a + 256·((k&1)^1)` | verified (door transitions) |
| 7 | sound: a < 0x40 song (FFB0, remembered in C31A); 0x40–0x7F → FFB1; ≥ 0x80 sound effect a − 0x80 | verified for songs (C31A 10 → 5); rest probable |
| 8 | nothing | probable |
| 9 | chest: item `a` with default uses `0C:7E80[a]`; 0xFF = "Empty."; "Can't carry." when full | verified (item 0x2A, 30 uses, into C2B9) |
| 0B | chest as 9, but offers "Drop item?" when full | probable |
| 0A | MAGI `a`: C2DA+2a count+1, value 0C:7F80[a]; C2D9 total+1 | probable |
| 0C / 0D | save return position (C45C–C45E), then warp | probable |
| 0E | warp through the alternate destination table 07:6F80 | probable |
| F0–FF | special (auto-walk, object control, …) | hypothesis |

**Chest objects.** Before giving the item, the game sets the object's open graphic (+5 |= 0x10)
and tests the opened flag (object +0x0C via 00:018C). Opening sets that flag (00:018F).

**Object visibility.** Chest objects use the flag condition (cond0 = 0x80, flag n), so a chest
whose flag is set is not shown again.

**Per-map music is script driven.** Triggers or objects run small story scripts such as
story[49] = `event sound(song=12)` (world theme) or story[16] = `warp 51; song 11`.

## Script ops (field/story tables)

The field and story text tables are the event script language. Control codes are the ops; the
dispatch table is at 00:13BE and argument counts are in `script_text.ARGS`. Names and evidence
are in `events.OPS`.

**Condition ops.** `if_var_in` (0x15), `if_yes` (0x16), `if_has_item` (0x17), `if_magi_*`
(0x1A/0x1B), `if_song` (0x44) and 0x45 skip **exactly 4 bytes** when the condition fails
(00:0C05). Scripts use that as `if …: event k a; end`, so a passing condition runs one event
and stops.

**Progress variables** (4-bit nibbles):

- read 00:063E, write 00:064A;
- `var_set` 0x14, `var_inc` 0x12, `var_dec` 0x13;
- the same variables gate NPC visibility: cond0 & 0x1F = var, cond1 = [lo, hi].

**Event flags** are bits, tested at 00:018C and set at 00:018F.

**Memo bits** (C31D) are set by 0x18/0x4B and cleared by 0x40.

## Exports

`ffl2kster events-export` writes `data/events/`:

- `scripts.txt` — every story and field script as pseudo-code;
- `events.json` — 230 chests, 105 shop placements, 24 shop inventories, 23 sound events, 412
  story-script placements, plus the op and kind tables.

## Open

- Kind-4 objects with args 58, 86 and 101–103 point past the 24 shop rows; their meaning is
  unknown.
- Special kinds F0–FF, and ops still unnamed (`op_XX` in the export).
- Header 0x4800 parses to implausible objects; it is probably not a real map.

## Field menus, shops, inns (bank 1)

Ported in `port/packages/core/src/menu/field.ts` and `menu/shop.ts` (`installFieldMenus`
registers the entries of the jump table 01:5000 in `Engine.extra`). **Verified** = PyBoy traces
`fm_*` (states from `tools/fm_states.py`: the first town warped by the game itself into map
4940 with controlled RAM changes) replayed through the full engine with identical machine state
at every frame wait, identical screens (documented tolerances), the same party block C200-C37F
at the end and the same battery RAM (`tools/fm_sram.py`); `port/packages/parity/test/field_menus.test.ts`.

| Entry | Routine | What | Status |
|---|---|---|---|
| 01:5000 | 01:5471 | Start menu (message 1: Abil, Item, Equip, MAGI, Memo, Save; GP 2, MAGI count 3, party 4/5); far call from 00:1884 (C0E5 = C305) | verified |
| 01:5003 | 01:5F51 | Select menu: formation (message 0x10/0x11), two-step choice, portraits slide (16 + dy + 16 frames), slots swapped in C2A0; dead/stone (C206 & 0x90) can't move | verified (swap) / probable (dead member paths) |
| 01:5009 | 01:647A | event kind 4 scene E: shop E (stock 0F:79E0 + 8E with default uses 0C:7E80, prices 0F:7860 + 3·id at C745), E = FF → inn | verified |
| 01:5012 | 01:628A | inn: cost 1 GP per missing HP (C745/C746) of members not dead/stone; Stay pays and runs 01:6332 (sound 0x33), not enough GP → message 0x1F, Exit → 0x2A | verified |
| 01:501E | 01:6332 | full recovery: HP = max; by type C205: mutant abilities (ids ≥ 0x80) and monster record abilities (0D:6F80 + 10·id) back to 0C:7E80 uses, robot items without record flag bit 7 to half; MAGI uses from 0C:7F80 | verified (inn, Tent; all four types); entry via text code 0x3E probable |
| 01:5021 / 01:5024 | 01:60AA / 01:607A | MAGI owner nibbles of C2DA ↔ members' MAGI slots C21F (formation order) and the list C7E0 | verified (Select menu) / entries via text code 0x46 probable |
| 01:5027 | 01:6448 | heal members (and guest) not dead/stone by BC HP, capped at max | probable (text code 0x3F) |
| 01:5036 | 01:6A51 | ending: tiles 04:5800 → 8800, 240 frames, eight strips from 01:6AC1/6AC9 every 4 frames | probable (text code 0x4D) |

**Shop.** Buy (message 0x23; menu items limited to the stocked entries): no free bag slot →
"Can't carry!" (0x2B); GP < price → message 0x25 with the price copied to C760; else GP −= price,
the item (with default uses) goes to the first free slot (sound 0x22). Sell (0x26): price =
item price / default uses × uses left (only when they differ; 00:040B / 00:03DC), halved,
at least 1 GP; Yes adds it to GP and empties the slot. All **verified** (fm_shop_buy, _poor,
_full, _sell).

**Item use (01:5BC6/5BCD).** Not with 0 uses or with C206 bit 4; record byte 0 bit 1 =
usable in the field, bit 4 = all members (CFF3 = 8) else a member is chosen; the calc VM script 5
(00:3232 → far call 0C:4000) leaves the outcome in CFF4: 0 HP/status (party window redrawn),
1 "Nothing happened", 2 Warp (list 0x2F; vars 1D/1E cleared; the menu is left by resetting SP
to C7D7 and running script 0x60 + choice), 3 full recovery, 4 MAGI left in this world (0F:6600
+ var 0E − C2D9), 5-8 Strength/Agility/Mana Up, HP Max, other: script 0x0255. A use is spent
unless MAGI or FE; at 0 the slot empties (bag, humans, mutants' items < 0x80). **Verified**
for 0 (Cure, Elixier), 2 (Door), 3 (Tent), 4 (Prism), 5 (Power), 8 (Body); 6/7/other probable.

**Equip (01:5685).** Exchanging a member slot with a bag slot removes the old item's bonuses
(armour power from DEF, record byte 2 bit 6: byte 5 = stat bits STR/AGL/MANA/DEF + amount) and
adds the new one's; an armour piece whose slot (record byte 2 low nibble) is already covered is
refused; monsters can't equip; robots instead get 0C:7B40 growth (HP and max HP ± 9(n+1),
STR/AGL/DEF ± 2(n+1)) and moving items halve uses (01:58CD). **Verified** for humans, robots and
monsters (fm_menu_equip, fm_menu_types). Abil (two-step swap / use), Item (swap, trash entry 0x10,
use), MAGI (equip to a member, use) and Save (slot, confirm, battery RAM) are **verified**.

**Memo (01:5A89)** is ported from the listing but not verifiable: its window messages 0x41
(height 0) and 0x42 (width 0) make the frame drawer 00:0A2B write ~33 KB from D000, wiping RAM
(observed in PyBoy from first_town.state: GP FFFFFF, party gone).

**Findings for other modules** (not changed here, patched only inside the parity test):
text code 0x35 (00:12F9) takes two bytes (GP slot n for 00:1313, then padding); codes 0x1C/0x1D
(00:1086/00:121E) address the MAGI slot as C21F + 32·C709 (00:004C), not 16·C709; 00:0AF3
copies 0 rows/columns as 256 and steps the destination by 0x20 − w (8-bit with carry), which the
width-0/height-0 windows 0x3A-0x3E rely on. The field's warp split effect after script 0x60
differs on screen (field/effects.ts).
