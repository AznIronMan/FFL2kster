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
