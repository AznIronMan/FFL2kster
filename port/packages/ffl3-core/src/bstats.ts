/** Legend III battle-entity attributes (bank 0B, 0B:6E74 and the group 0B:72C0-748E): the entity
 *  record of CD36 (00:1FC4: party members and monsters, C500 + offset), the equipment flag bytes
 *  rebuilt from the item records (loaded by 09:5D7F into CEDB-CEE1 for the item CE26), the
 *  equipment bonuses, the resistance byte and the learned-spell bits.
 *  Record fields used here (entity record + k): 01 status, 0D kind (low 3 bits), 36-38 weapon
 *  flags, 39-3B armour flags, 3D-3F equipment bonuses, 41-47 weapon/equipment items, 48-4F
 *  armour items, 51.. spell bit words, 58 resistances.
 *  Callers run these with bank 0B selected (the tables 0B:7104, 0B:7114 and 0B:73C9 are read
 *  from the current bank). */
import type { Game } from "./game.js";
import type { Memory } from "./memory.js";
import { farSync, memberOffset } from "./sys.js";
import { itemLoad } from "./bitems.js";

/** 0B:7104 — the bit of the high nibble of CEDB. */
const HIGH_BITS = 0x7104;
/** 0B:7114 — the bit (or byte) of the low nibble of CEDB. */
const LOW_BITS = 0x7114;
/** 0B:73C9 — the CEDB value of the items 70-8F (no record load). */
const CLASS_TABLE = 0x73c9;

// ---------------------------------------------------------------- record addresses

/** 00:1FC4 — the record offset of the entity CD36 (80 and above: - 7B), through 00:1FCD. */
export function entityOffset(m: Memory): number {
  let a = m.rd(0xcd36);
  if (a >= 0x80) a = (a - 0x7b) & 0xff;
  // 00:1FCD doubles a in 8 bits (add a): pass a & 7F so 2a wraps the same way.
  return memberOffset(m, a & 0x7f);
}

/** 0B:73F4 — the address of field a of the entity CD36: C500 + offset + a (returned in hl and de). */
export function entityField(m: Memory, a: number): number {
  const hl = entityOffset(m);
  return (hl + 0xc500 + (a & 0xff)) & 0xffff;
}

// ---------------------------------------------------------------- item records

/** 0B:73A2 — load the record of item CE26 with CE25 = 0 (09:5D7F), CE25 restored after. */
export function itemRecordPlain(g: Game): void {
  loadWithMode(g, 0);
}

/** 0B:73A7 — CE25 = mode, farcall 09:5D7F, CE25 restored (the old value was saved first). */
function loadWithMode(g: Game, mode: number): void {
  const m = g.m;
  const saved = m.rd(0xce25);
  m.wr(0xce25, mode);
  farSync(g, 0x09, () => itemLoad(g));
  m.wr(0xce25, saved);
}

/** 0B:7462 — CE26 = a, then load its record (0B:73A2). */
export function itemSelectLoad(g: Game, a: number): void {
  g.m.wr(0xce26, a);
  itemRecordPlain(g);
}

/** 0B:73B1 — the class byte CEDB of item CE26: items 70 and above from 0B:73C9 + (CE26 - 70);
 *  below 70 the record is loaded with CE25 = 1 (0B:73A7). */
export function itemClass(g: Game): void {
  const m = g.m;
  const a = (m.rd(0xce26) - 0x70) & 0xff;
  if (m.rd(0xce26) >= 0x70) {
    m.wr(0xcedb, m.rd((CLASS_TABLE + a) & 0xffff));
    return;
  }
  loadWithMode(g, 1);
}

/** 0B:7393 — CEE1 for items below 78, else CEDF. */
export function itemBonusByte(m: Memory): number {
  return m.rd(m.rd(0xce26) < 0x78 ? 0xcee1 : 0xcedf);
}

/** 0B:7383 — hl moved to the slot of item CE26: below 84 +0, below A0 +1, below B4 +2, else +3. */
export function itemSlot(m: Memory, hl: number): number {
  const a = m.rd(0xce26);
  if (a < 0x84) return hl;
  hl = (hl + 1) & 0xffff;
  if (a < 0xa0) return hl;
  hl = (hl + 1) & 0xffff;
  if (a < 0xb4) return hl;
  return (hl + 1) & 0xffff;
}

/** 0B:73E6 — the signed amount a for equipping (CE25 = 0: a, high 00) or removing (-a, high FF;
 *  a = 0 stays 0 with high 00). Returns [a, b]. */
export function signedAmount(m: Memory, a: number): [number, number] {
  a &= 0xff;
  if (!m.rd(0xce25)) return [a, 0];
  a = (~a + 1) & 0xff;
  if (!a) return [0, 0];
  return [a, 0xff];
}

// ---------------------------------------------------------------- flag bytes

/** 0B:7403 — the low-nibble flag of CEDB (0B:7114) ORed at hl: kinds 0-6 into [hl], 7-9 into
 *  [hl + 1]; kinds 0A-0F store the table byte at [hl] and OR E0 into [hl + 1]. */
export function applyLowFlag(m: Memory, hl: number): void {
  const k = m.rd(0xcedb) & 0x0f;
  let a = m.rd((LOW_BITS + k) & 0xffff);
  if (k >= 0x0a) {
    m.wr(hl, a);
    hl = (hl + 1) & 0xffff;
    a = 0xe0;
  } else if (k >= 0x07) {
    hl = (hl + 1) & 0xffff;
  }
  m.wr(hl, a | m.rd(hl));
}

/** 0B:7400 — the low-nibble flag of CEDB applied at C884 (0B:7403). */
export function applyLowFlagC884(m: Memory): void {
  applyLowFlag(m, 0xc884);
}

/** 0B:7337 — the high-nibble bit of CEDB (0B:7104) ORed into [de], then the low-nibble flag at
 *  de + 1 (0B:7403). */
function applyFlags(m: Memory, de: number): void {
  const a = m.rd((HIGH_BITS + ((m.rd(0xcedb) & 0xf0) >> 4)) & 0xffff);
  m.wr(de, a | m.rd(de));
  applyLowFlag(m, (de + 1) & 0xffff);
}

/** 0B:7333 — load the record of item CE26 (0B:73A2) and apply its CEDB flags at de (0B:7337). */
export function weaponItemFlags(g: Game, de: number): void {
  itemRecordPlain(g);
  applyFlags(g.m, de);
}

/** 0B:732D — the class of item CE26 (0B:73B1) and its CEDB flags applied at de (0B:7337). */
export function armourItemFlags(g: Game, de: number): void {
  itemClass(g);
  applyFlags(g.m, de);
}

/** 0B:72E1 — the weapon flags: fields 36-38 cleared, then every item of fields 41-47 (not FF)
 *  goes through CE26 and 0B:7333 into them. */
export function weaponFlags(g: Game): void {
  const m = g.m;
  const de = entityField(m, 0x36);
  let hl = de;
  for (let i = 0; i < 3; i++) { m.wr(hl, 0); hl = (hl + 1) & 0xffff; }
  hl = (de + 0x0b) & 0xffff;
  for (let b = 7; b > 0; b--) {
    const a = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (a === 0xff) continue;
    m.wr(0xce26, a);
    weaponItemFlags(g, de);
  }
}

/** 0B:7305 — the armour flags: fields 39-3B cleared, then every item 70-85 of fields 48-4F goes
 *  through CE26 and 0B:732D into them. */
export function armourFlags(g: Game): void {
  const m = g.m;
  const de = entityField(m, 0x39);
  let hl = de;
  for (let i = 0; i < 3; i++) { m.wr(hl, 0); hl = (hl + 1) & 0xffff; }
  hl = (de + 0x0f) & 0xffff;
  for (let b = 8; b > 0; b--) {
    const a = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (a < 0x70 || a >= 0x86) continue;
    m.wr(0xce26, a);
    armourItemFlags(g, de);
  }
}

/** 0B:72C0 — the weapon flags (fields 36-38) ORed into the armour flags (fields 39-3B). */
export function mergeWeaponFlags(g: Game): void {
  const m = g.m;
  let de = entityField(m, 0x36);
  let hl = (de + 3) & 0xffff;
  for (let b = 3; b > 0; b--) {
    m.wr(hl, m.rd(de) | m.rd(hl));
    hl = (hl + 1) & 0xffff;
    de = (de + 1) & 0xffff;
  }
}

/** 0B:72D3 — rebuild the weapon and armour flags (0B:72E1, 0B:7305), then reload the record of
 *  the item CE26 had on entry (0B:7462). */
export function rebuildFlags(g: Game): void {
  const a = g.m.rd(0xce26);
  weaponFlags(g);
  armourFlags(g);
  itemSelectLoad(g, a);
}

/** 0B:736F — the class of item CE26 (0B:73B1) and its high-nibble bit (0B:7104) ORed into [de]. */
export function resistItemBit(g: Game, de: number): void {
  const m = g.m;
  itemClass(g);
  const a = m.rd((HIGH_BITS + ((m.rd(0xcedb) & 0xf0) >> 4)) & 0xffff);
  m.wr(de, a | m.rd(de));
}

/** 0B:7349 — the resistances of the entity CD36: field 58 cleared, then every item 86-8F of
 *  fields 48-4F ORs its bit into it (0B:736F). */
export function entityResist(g: Game): void {
  const m = g.m;
  const de = entityField(m, 0x58);
  m.wr(de, 0);
  let hl = (de + 0xfff0) & 0xffff;
  for (let b = 8; b > 0; b--) {
    const a = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (a < 0x86 || a >= 0x90) continue;
    m.wr(0xce26, a);
    resistItemBit(g, de);
  }
}

// ---------------------------------------------------------------- bonuses

/** 0B:7422 — the equipment bonuses: fields 3D-3F cleared, then for every item of fields 41-47
 *  (not FF) its record is loaded (0B:7462) and 3D += CEDD high nibble, 3E += CEDC low nibble,
 *  3F += CEDD low nibble; the record of the item CE26 had on entry is reloaded at the end. */
export function equipBonuses(g: Game): void {
  const m = g.m;
  let hl = entityField(m, 0x3d);
  for (let i = 0; i < 3; i++) { m.wr(hl, 0); hl = (hl + 1) & 0xffff; }
  const saved = m.rd(0xce26);
  hl = entityField(m, 0x41);
  for (let b = 7; b > 0; b--) {
    const a = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (a === 0xff) continue;
    itemSelectLoad(g, a);
    let p = entityField(m, 0x3d);
    m.wr(p, ((m.rd(0xcedd) & 0xf0) >> 4) + m.rd(p));
    p = (p + 1) & 0xffff;
    m.wr(p, (m.rd(0xcedc) & 0x0f) + m.rd(p));
    p = (p + 1) & 0xffff;
    m.wr(p, (m.rd(0xcedd) & 0x0f) + m.rd(p));
  }
  itemSelectLoad(g, saved);
}

/** 0B:747F — [hl] += a saturating: a below 80 adds (carry: [hl] = FF), 80 and above subtracts
 *  (no carry: [hl] = 00). */
export function addSaturating(m: Memory, hl: number, a: number): void {
  const s = (a & 0xff) + m.rd(hl);
  m.wr(hl, s);
  if (a & 0x80) {
    if (s <= 0xff) m.wr(hl, 0);
  } else if (s > 0xff) m.wr(hl, 0xff);
}

/** 0B:7468 — 0B:747F at hl, and again at hl + 58 when CD37 is set. */
export function addSaturatingBoth(m: Memory, hl: number, a: number): void {
  addSaturating(m, hl, a);
  if (!m.rd(0xcd37)) return;
  addSaturating(m, (hl + 0x58) & 0xffff, a);
}

// ---------------------------------------------------------------- entry routines

/** 0B:728B — the attributes of the entity CD36: weapon and armour flags (0B:72E1, 0B:7305);
 *  unless its kind (field 0D & 7) is 4, the equipment bonuses (0B:7422) and the weapon flags
 *  merged into the armour flags (0B:72C0); then status field 01 loses the bits of field 3A and
 *  resistances field 58 loses the high-nibble bits of field 39. */
export function entityStats(g: Game): void {
  const m = g.m;
  weaponFlags(g);
  armourFlags(g);
  let hl = entityField(m, 0x0d);
  if ((m.rd(hl) & 0x07) !== 0x04) {
    equipBonuses(g);
    mergeWeaponFlags(g);
  }
  hl = entityField(m, 0x3a);
  let a = m.rd(hl);
  hl = (hl + 0xffc7) & 0xffff;
  m.wr(hl, ~a & m.rd(hl));
  hl = entityField(m, 0x39);
  a = (~m.rd(hl) | 0x0f) & 0xff;
  hl = (hl + 0x1f) & 0xffff;
  m.wr(hl, a & m.rd(hl));
}

/** 0B:6E74 — set bit (CE94 & 0F) of the big-endian spell word at entity field 51 + 2 (CE94 >> 4)
 *  (both bytes rewritten, low byte first). */
export function spellBit(g: Game): void {
  const m = g.m;
  let hl = (entityOffset(m) + 0xc551) & 0xffff;
  let a = m.rd(0xce94);
  while (a >= 0x10) { a -= 0x10; hl = (hl + 2) & 0xffff; }
  let d = m.rd(hl);
  hl = (hl + 1) & 0xffff;
  let e = m.rd(hl);
  const b = a;
  const rotr = (): void => {
    const c = e & 1;
    e = (e >> 1) | ((d & 1) << 7);
    d = (d >> 1) | (c << 7);
  };
  for (let n = b; n > 0; n--) rotr();
  e |= 0x01;
  for (let n = 0x10 - b; n > 0; n--) rotr();
  m.wr(hl, e);
  m.wr((hl - 1) & 0xffff, d);
}
