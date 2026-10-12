# Value caps: storage, rules and display

Map of where the original limits HP, stats and money, for the later cap-break option (QoL version,
mods, tower/arena; direction note D in DECISIONS.md). Findings only: nothing here changes the
faithful port. Labels as in ROM_MAP.md (verified / probable / hypothesis).

## Summary

The 999 HP and 99 stat limits are **rules and display clamps, not storage limits**. HP is a
16-bit word everywhere (party and enemies); stats are one byte (0-255). Enemies already go past
the party's limits in the original (HP up to 25,000, stats up to 120).

## Storage widths

| Value | Where | Width | Status |
|---|---|---|---|
| Party HP / max HP | C207 / C209 + 32·n; battle block +41 / +0C | 16-bit | verified (layout, P1-P3 traces) |
| Party STR/AGL/MANA/DEF | C20B-C20E + 32·n; battle block +0E-11 | 8-bit | verified |
| Enemy max HP, stats | record 0D:6F80 + 10·id (+2-3 HP, +4-7 stats); group block +0C-11 | 16-bit / 8-bit | verified |
| Enemy current HP | group block +41/+42 + 8·i (max HP − rand draw of up to max/8, 0D:443A) | 16-bit | verified |
| Damage / heal message values | D900 + 2·n, text code 0x30 | 16-bit, 5 digits | verified (port text engine = original) |
| GP | C2A2 | 24-bit | verified |
| Calc-VM arithmetic | ACC/OPR C1A5/C1A8 | 24-bit (multiply/divide on 16-bit magnitudes) | verified |

Largest values in the ROM's enemy table: HP 25,000 (id 254), 10,000 (ids 236, 239, 255), 6,000
(id 251); stats 120 (ids 239, 255), 99 (ids 164, 235, 254).

## Rule caps (where the game stops growth)

| Rule | Where | Behaviour | Status |
|---|---|---|---|
| Battle growth, max HP | script 10, 0C:515A `if CF0C.2 >= #999` | no growth once max HP ≥ 999, but the step itself (HP/50 + rand(0..10) + 5) can pass it: max HP 990 → 1,015-1,023 | **verified** (controlled change, HP pair forced to (200, 0)) |
| Battle growth, stats | script 10, 0C:51BB `if CF92 >= #99` | +1 only below 99, so it stops at exactly 99 | verified (listing + P3 traces) |
| Field stat item (effect 7: Power, Speed, Magic…) | 0C:66E7 `if [stat] >= #99`, then +3 | refused at ≥ 99, but 97-98 → 100-101 | probable (listing) |
| Field HP item (effect 8) | 0C:6718 `if maxHP >= #999`, then +40 | refused at ≥ 999, but 960-998 → 1,000-1,038 | probable (listing) |
| Effect 37 (enemy ability) | 0C:5DA8 | raises a byte, clamped at 255 | probable (listing) |
| Growth penalties | script 10 | one-byte intermediate stores (see BATTLE_RULES.md) | verified |

## Display clamps

| Display | Routine | Clamp | Status |
|---|---|---|---|
| Member HP / max HP (text codes 0x24, 0x25; status screens) | 00:1201/1204 | ≥ 1,000 shows 999 (3 digits) | verified (port = original) |
| Member stats (0x27-0x2A), counts (0x26, 0x2C) | 00:12D4 → 00:12E6 | ≥ 100 shows 99 (2 digits) | verified |
| Numbers in general | 00:15D9 | 5 decimal digits (to 65,535) | verified |
| GP | 00:1313 | ≥ 999,999 shows 999,999 | verified |

So a character can carry more than 999 HP or 99 in a stat in the original; the screens show the
clamped value.

## What a cap break has to touch (for the option, later)

1. **Party HP past 999:** the two growth rules (0C:515A, 0C:6718) and the HP display (00:1204,
   window widths). Storage and battle maths already hold up to 65,535.
2. **Stats past 99:** the growth/item rules (0C:51BB, 0C:66E7), the 2-digit display, and every
   formula that keeps a stat or a product in one byte (growth penalties, effect 37's clamp,
   one-byte compares such as AGL in hit chance). Up to 255 fits the storage.
3. **Enemies, NPCs and everything else** (direction note D): enemy HP is already 16-bit and their
   stats one byte, with the same one-byte formula limits on the battle side.
4. **Beyond 65,535 HP / 255 stats ("ideally infinite"):** not possible inside the original memory
   layout. It belongs to the remaster data model (END_GOAL.md): wider numeric fields (JS numbers
   are exact to 2^53; BigInt if truly unbounded), formulas written for wide values, and number
   displays that scale (e.g. abbreviations) instead of clamping.

Evidence: data/battle/calcvm_listing.txt (constants #999 / #99 / #255), build/analysis/rd (00:1204,
00:12E6, 00:15D9), build/tmp/probes/hp_overshoot.py (controlled change, local).
