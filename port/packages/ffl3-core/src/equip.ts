/** Legend III equipment stats (bank 0B): an item's stats put on or taken off an entity (0B:7124)
 *  and the worn-out weapons taken back (0B:6683, run after a battle, the field menu and event 13). */
import type { Game } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, fill, farSync } from "./sys.js";
import { mul16 } from "./names.js";
import { entityOffset, entityField, itemRecordPlain, itemBonusByte, itemSlot, signedAmount, applyLowFlagC884,
  rebuildFlags, equipBonuses, addSaturatingBoth, mergeWeaponFlags, entityResist, itemSelectLoad } from "./bstats.js";

// ---------------------------------------------------------------- the stats of an item (0B:7124)

/** 00:24C7 — CD46-CD49 / CD4A-CD4B (restoring division, 32 steps over CD46-CD4B): the quotient in
 *  CD46-CD49, the remainder in CD4A-CD4B. */
export function div32(m: Memory): void {
  const e = m.rd(0xcd4a);
  m.wr(0xcd4a, 0);
  const d = m.rd(0xcd4b);
  m.wr(0xcd4b, 0);
  for (let b = 0x20; b; b--) {
    let carry = 0;
    for (let k = 0; k < 6; k++) {
      const v = (m.rd(0xcd46 + k) << 1) | carry;
      carry = v >> 8;
      m.wr(0xcd46 + k, v & 0xff);
    }
    let sub = !!carry;
    if (!sub) {
      const hi = m.rd(0xcd4b);
      if (hi > d) sub = true;
      else if (hi === d) sub = m.rd(0xcd4a) >= e;
    }
    if (!sub) continue;
    m.wr(0xcd46, m.rd(0xcd46) | 0x01);
    const lo = m.rd(0xcd4a) - e;
    m.wr(0xcd4a, lo & 0xff);
    m.wr(0xcd4b, (m.rd(0xcd4b) - d - (lo < 0 ? 1 : 0)) & 0xff);
  }
}

/** 0B:7245 — the word at hl += the signed amount of C888 (0B:73E6; CE25 set: minus). */
function addC888(m: Memory, hl: number): void {
  const [a, b] = signedAmount(m, m.rd(0xc888));
  const s = a + m.rd(hl);
  m.wr(hl, s & 0xff);
  const h = (hl + 1) & 0xffff;
  m.wr(h, (b + m.rd(h) + (s >> 8)) & 0xff);
}

/** 0B:7251 — the current value (the word at hl - 2) scaled to the new maximum (the word at hl)
 *  from the old one (CD4A/CD4B): hl - 2 .. +3 -> CD46 (00:1F8A), CD46-49 = max x current
 *  (00:2499), / the old max (00:24C7), the low word back; 0 becomes 1. */
function scaleCurrent(g: Game, hl: number): void {
  const m = g.m;
  const de = (hl - 2) & 0xffff;
  copy(m, de, 0xcd46, 4);
  mul16(g);
  div32(m);
  const b = m.rd(0xcd46);
  copy(m, 0xcd46, de, 2);
  const a = m.rd(0xcd47);
  if (a | b) return;
  m.wr(de, (a + 1) & 0xff);
}

/** 0B:7124 — the stats of item CE26 on (CE25 = 0) or off (CE25 = 1, minus; 0B:73E6) the entity
 *  CD36: its record (0B:73A2), C880-C888 = 0, C880 = its bonus byte (0B:7393) & 0F, C888 = 10 x
 *  C880 (00:243D); armour (78 and above): C881 = CEDC >> 4, C883 = 0B:7104 [CEDB >> 4], the low
 *  flag at C884 (0B:7400). Field 1C-1F + 5 for bonus bits 7-4, the slot (0B:7383) of field 2C +
 *  C880, 3C + C881, the flags rebuilt (0B:72D3), the word 28 (A0 and above 2A) + C888; kind (0D &
 *  7) not 4: the bonuses (0B:7422), 18-1B + 5 by bits 7-4 (0B:7468), 19 + C881, the flags merged
 *  (0B:72C0), the resistances (0B:7349, the record of CE26 back); kind 1: the slot of 18 + C880,
 *  the maximum 12/13 (A0 and above 16/17) + C888 with its current value scaled (0B:7251). Then
 *  (0B:726E) field 57 = min(63, 4B + (03 + 1A) / 4) and (0B:72B0) 58 &= ~39 | 0F. */
export function equipStats(g: Game): void {
  const m = g.m;
  itemRecordPlain(g);
  fill(m, 0xc880, 9, 0);
  let a = itemBonusByte(m) & 0x0f;
  m.wr(0xc880, a);
  m.wr(0xc888, ((a * 5) * 2) & 0xff);
  if (m.rd(0xce26) >= 0x78) {
    m.wr(0xc881, (m.rd(0xcedc) & 0xf0) >> 4);
    a = (m.rd(0xcedb) & 0xf0) >> 4;
    m.wr(0xc883, m.rd((0x7104 + a) & 0xffff));
    farSync(g, 0x0b, () => applyLowFlagC884(m));
  }
  // 0B:7161
  let hl = entityField(m, 0x1c);
  let c = itemBonusByte(m);
  let [d] = signedAmount(m, 0x05);
  for (let b = 4; b; b--) {
    const carry = c & 0x80;
    c = ((c << 1) | (c >> 7)) & 0xff;
    if (carry) m.wr(hl, (d + m.rd(hl)) & 0xff);
    hl = (hl + 1) & 0xffff;
  }
  hl = itemSlot(m, entityField(m, 0x2c));
  [a] = signedAmount(m, m.rd(0xc880));
  m.wr(hl, (a + m.rd(hl)) & 0xff);
  hl = entityField(m, 0x3c);
  [a] = signedAmount(m, m.rd(0xc881));
  m.wr(hl, (a + m.rd(hl)) & 0xff);
  rebuildFlags(g);
  hl = (entityOffset(m) + (m.rd(0xce26) >= 0xa0 ? 0xc52a : 0xc528)) & 0xffff;
  addC888(m, hl);
  if ((m.rd(entityField(m, 0x0d)) & 0x07) !== 0x04) {
    equipBonuses(g);
    hl = entityField(m, 0x18);
    c = itemBonusByte(m);
    [d] = signedAmount(m, 0x05);
    for (let b = 4; b; b--) {
      const carry = c & 0x80;
      c = ((c << 1) | (c >> 7)) & 0xff;
      if (carry) addSaturatingBoth(m, hl, d);
      hl = (hl + 1) & 0xffff;
    }
    [a] = signedAmount(m, m.rd(0xc881));
    addSaturatingBoth(m, entityField(m, 0x19), a);
    mergeWeaponFlags(g);
    const id = m.rd(0xce26);
    entityResist(g);
    itemSelectLoad(g, id);
    if ((m.rd(entityField(m, 0x0d)) & 0x07) === 0x01) {
      hl = itemSlot(m, entityField(m, 0x18));
      [a] = signedAmount(m, m.rd(0xc880));
      addSaturatingBoth(m, hl, a);
      hl = (entityOffset(m) + (m.rd(0xce26) < 0xa0 ? 0xc512 : 0xc516)) & 0xffff;
      copy(m, hl, 0xcd4a, 2);
      addC888(m, hl);
      scaleCurrent(g, hl);
    }
  }
  // 0B:726E
  hl = entityField(m, 0x03);
  const s = m.rd(hl) + m.rd((hl + 0x17) & 0xffff);
  a = (((s >> 8) << 7) | ((s & 0xff) >> 1)) & 0xff;
  a = ((a >> 1) + 0x4b) & 0xff;
  if (a >= 0x64) a = 0x63;
  m.wr((hl + 0x17 + 0x3d) & 0xffff, a);
  // 0B:72B0
  hl = entityField(m, 0x39);
  a = (~m.rd(hl) | 0x0f) & 0xff;
  hl = (hl + 0x1f) & 0xffff;
  m.wr(hl, a & m.rd(hl));
}

/** 0B:6683 — for members 0-4 (CD36, kept) with no uses left (C500 & 0F) and a weapon at C540:
 *  C540 = FF and its stats off (CE26, CE25 = 1, 0B:7124); then the bag C6FF: a count of 0 makes
 *  both bytes FF. */
export function wornOutBack(g: Game): void {
  const m = g.m;
  const saved = m.rd(0xcd36);
  m.wr(0xcd36, 0);
  do {
    const hl = (entityOffset(m) + 0xc540) & 0xffff;
    if (!(m.rd((hl - 0x40) & 0xffff) & 0x0f)) {
      const a = m.rd(hl);
      if (a !== 0xff) {
        m.wr(hl, 0xff);
        m.wr(0xce26, a);
        m.wr(0xce25, 1);
        farSync(g, 0x0b, () => equipStats(g));
      }
    }
    m.wr(0xcd36, (m.rd(0xcd36) + 1) & 0xff);
  } while (m.rd(0xcd36) < 5);
  m.wr(0xcd36, saved);
  for (let hl = 0xc700, b = 0; b < 0x18; b++, hl += 2) {
    if (m.rd(hl) === 0) { m.wr(hl, 0xff); m.wr(hl - 1, 0xff); }
  }
}

