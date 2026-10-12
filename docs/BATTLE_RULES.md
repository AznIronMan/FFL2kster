# Battle, reward, growth and meat rules (bank-0C calc VM)

Most battle bookkeeping in FFL2 is not machine code. It is bytecode for a small interpreter at
**0C:4000**, called the *calc VM* here. Eleven scripts (table **0C:4680**) run in a fixed order in
the battle flow (0D:40E2 … 0D:434B, through 0D:4361). Script 5 also runs from the field (00:3232).
Every item/ability effect is a VM subroutine, reached through **0C:53E1** in battle and **0C:5445**
in the field, indexed by item byte 3.

- Disassembler: `src/ffl2kster/calcvm.py`.
- Full decompiled listing: `data/battle/calcvm_listing.txt` (from `ffl2kster rules-export`).
- Reference implementations: `src/ffl2kster/rules.py`.
- Decoded tables: `data/battle/rules_tables.json`.

## VM summary (verified from the interpreter code)

**Opcode byte:** the low 5 bits are the op; the high 3 bits are the mode *m*.

**Operand by mode:**

| m | Operand |
|---|---|
| 0, 1, 2 | `CF:[a]`, 1/2/3 bytes |
| 3, 4 | byte/word at the pointer word `CF:[a]` |
| 5 | `rand(0..imm8)` (RNG stream 6) |
| 6 | imm8 |
| 7 | imm16 |

Addresses ≥ 0x4000 read bank 0C, which is mapped while the VM runs, so scripts read the bank-0C
tables directly.

**Statements:**

| Op | Meaning |
|---|---|
| 00 | assign: target `CF:[a]` (m ≥ 5: absolute addr16), then an expression |
| 01 | `if` expression; when false, the next statement is skipped. The `if` byte's own mode bits encode the first operand. |
| 02 | goto |
| 03 | native call (`03 20 00` = `rst $20`, print battle message `D90C`) |
| 04 | `C1A0 = imm` |
| 05 | gosub |
| 06 | return |
| 07 / 08 | inc / dec |
| 09 | gosub through a pointer |
| 1F | end |

**Expression ops.** Expressions use a 24-bit accumulator and are evaluated strictly left to right
(no operator precedence):

| Op | Meaning |
|---|---|
| 00 | load |
| 01 | signed multiply |
| 02 | signed divide |
| 03 | add |
| 04 | subtract |
| 11 | subtract, clamped at 0 |
| 05–09 | and / or / nand / xor / not |
| 0A / 0B | shift right / shift left |
| 0C–10 | `== < > <= >=`: in an `if`, these save the left-hand side and start the right-hand side; elsewhere they just load |
| 12 | `rand(0..CF:[a])` (stream 5) |
| 13 | load absolute addr16 (acts as `==` in an `if`) |
| 1F | end of expression |

**RNG (00:043E, verified by disassembly):**

- `A` is the stream number. The game increments the byte at `C0A0+stream`, then reads `T = 0F:4000[counter]`.
- With `E` = min and `D` = max, the result is `min + T mod (max−min+1)`.
- If max = 0, the raw `T` is returned. That means `rand(0..0)` is **not** 0, a quirk worth keeping for parity.
- Battle code uses streams 5, 6, 7, 8 and 0x30–0x33. Encounters use stream 0x0A.

## Scripts

| # | Purpose (status) | Key rule |
|---|---|---|
| 0 | First strike / surprise (probable) | OR together the flags1 bytes (item byte 1) of every ability on each side: bit7 = first strike, bit6 = prevents surprise. The party bit is dropped when rand(0..100) > 50 or the enemy has bit6; the enemy bit is dropped when rand > 20 or the party has bit6. More bits gives "Strike first!" (D800=1) or "Unexpected attack!" (D800=2). |
| 1 | Run (probable) | Fails if the formation flag D844 bit5 is set. Succeeds after a first strike. Otherwise the party score (alive member: AGL; empty party slot: 100) must exceed the enemy AGL sum plus rand(0..50). A failure gives the enemy the initiative (D800=2). |
| 2 | Enemy action choice (probable) | Roll rand(0..255) against the cumulative thresholds at `0C:6F00 + 8·AI` (AI = hi nibble of `0C:7D50+id`). Slots whose item byte 0 bit0 is clear are skipped. Targets come from usage bits 0x20/0x10/0x80. Status bits 0x98, 2 and 1 force actions 255, 270 and 271. |
| 3 | Turn order (probable) | Initiative = v + rand(0..v), with v = AGL (party and guest: AGL/4 + AGL). Bubble-sorted descending into D803. |
| 4 | Confusion (probable) | 10% per turn to recover ("Back to sane."). Otherwise the actor uses a random ability on a random target. |
| 5 | Execute action (probable) | Effect = item byte 3 → handler `0C:53E1[effect]` in battle, `0C:5445[effect]` in the field. Also tracks the cannon counter (msg 107). |
| 6 | Poison (probable) | Damage = rand(m..2m)+1 with m = max HP/20. 20% chance to neutralise. |
| 7 | Regeneration (probable) | Groups holding ability 254, or 126 with type 3, recover max HP/10 per turn. |
| 8 | **GP and drops (verified)** | See below. |
| 9 | **Meat (verified)** | See below. |
| 10 | **Growth (verified: HP chance; rest probable)** | See below. |

### Rewards: script 8 (verified)

- Reward byte `0C:7C50 + id`:
  - bit 7 = drops meat;
  - bit 6 = +80, bit 5 = +20 (drop threshold);
  - bits 0–4 = GP index into the word table `0C:7E50` (0, 30, 60 … 450).
- GP per defeated group = `(gp/10·n + gp)·n`, where n is the number defeated. Total GP is capped
  at `0C:7FF0` = 999999.
- Drops: groups are tried in order. A group drops when rand(0..100) ≤ threshold + n, and the first
  success ends the check, so there is at most one drop per battle.
  - Meat: `CF10 = id` and the Eat prompt appears.
  - Item: enemy ability slot rand(0..last); an id > 127 gives nothing. The item goes to the first
    free inventory slot (`C2B9`, 16 × [id, uses]) with default uses `0C:7E80[id]`.
- Controlled changes (Asigaru ×1, deterministic RNG from a fixed state; `tests/test_acceptance_emu.py`):

  | Reward byte | Result |
  |---|---|
  | 0x21 (original) | 33 GP + Long |
  | 0x01 | 33 GP, no drop |
  | 0x22 | 66 GP + Long |
  | 0xA1 | "Asigaru's meat" + Eat prompt |

### Meat: script 9 (verified)

- Inputs:
  - eater = battle copy `D00A`, which must be type 2 (otherwise "Nothing happened").
  - meat = `CF10`.
  - `0C:7800+id` gives family f (hi nibble) and class c (lo nibble).
- Steps:
  1. If the meat's family f2 > 5, then f2 += 1.
  2. k = f1 + f2. If k < 6, k += 12. If k > 17, k −= 12. Then k −= 6.
  3. cls = min(max(c1 + c2 − 1, 0), 2).
  4. lv = max(level(eater), level(meat)), where level = lo nibble of `0C:7D50+id`.
  5. result = `0C:7900[(k·3 + cls)·16 + lv]`.
- If result = eater, the game prints "Nothing happened."
- `rules.meat_result` reproduces **all 32,940** emulator-measured eater×meat results
  (`test_meat_formula_matches_every_measured_transformation`).

### Growth: script 10

- Runs for each party member of type 0 (human) or 1 (mutant) that is not dead or stoned.
- The **battle level** L is the level of the first enemy group.
- Growth parameters live at `0C:7F90 + 16·type` as (b0, b1) pairs.
- chance(b0, b1, penalty) = max(L·b1 − penalty, 0) + b0.

**Steps, in order:**

1. **New ability.** Uses the ability pair. Happens when rand(0..200) < chance, with penalty =
   b1·⌊HP/(HP/26+50)⌋. Humans' pair is (0, 0).
   - The ability comes from `0C:7FB0`/`0C:7FD0`: the first of 32 cumulative thresholds ≥
     rand(0..min(L·24+15, 255)).
   - It replaces a slot following the rules in the listing (messages 15/16/17).
2. **Max HP.** Uses the HP pair and the same penalty. Happens when rand(0..200) ≤ chance, and
   only while HP < 999. New HP = HP + HP/50 + rand(0..10) + 5.
   **Verified:** (0, 0) → no gains; (200, 0) → every member gains; the baseline gain is
   59 → +15.
3. **Otherwise, one stat.**
   - The stat is the first set flag (bit7 STR, 6 AGL, 5 MANA, 4 DEF) of `0C:7B40 + last action
     id` (D84D + 2·member).
   - Parameters: the pair at `0C:7F94 + (type·5 + stat)·2`, penalty = stat·b1/(stat/20+5).
   - +1 when rand(0..200) ≤ chance, and only while the stat < 99.
   - Note: for type 1 this address arithmetic lands the STR pair on (0, 0); see the open questions.

### Weapons: effect 49 (verified against milestone 2)

- **Hit:** rand(0..100) ≤ 97 − 2·max(target AGL − attacker AGL, 0) (L6AB5/L6B1F). A target
  with the right status can counter (message 44).
- **Damage:** max(STR·power + rand(0..STR) − 5·DEF, 0). It is halved when the target guards
  or has the defence status bits, and a result of 0 prints "no damage" (msg 34).
- STR and DEF are halved by status bits 0x20 / 0x40. Holding the matching MAGI (word id
  256/257/259 at member +42) adds (C2DA/C2DC/C2E0 & 15) + 5.
- `rules.weapon_damage` / `rules.hit_chance`.

**Effect index.** `rules_tables.json → effects` maps each effect id to its battle/field handler
and the items that use it (effect 49 = 25 ordinary weapons; 26 = attack spells; 27 = status
spells; 0 = equipment; …). Port option: transliterate the handlers from the listing, or
embed the calc VM and run the original bytecode (user-supplied ROM).

## Open questions

- **Mutant growth.** Mutant stat parameters look shifted (type·5 rather than type·8). Verify with
  a mutant party.
- **Battle effect handlers.** The 50 effect handlers are decompiled but not yet named
  (`effect_N` in the listing). Damage formulas from milestone 2 cover the weapon routine.
