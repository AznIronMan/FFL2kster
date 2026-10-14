/** Legend III field (out-of-battle) uses of items and spells and what the menu leaves to do:
 *   - 09:521A, the effect of item / spell CE26 (CE25 the id space) on the target CD36 (one member,
 *     or all of them for the kinds 18-1C with CD36 bit 7), from the use 09:49C0: the spell's
 *     points paid by the caster CE1C (09:52B7), the record (09:5D7F), the kind CEDD & 3F by the
 *     table 09:52E5 (healing by a percentage or a flat amount, the status cured, revived, a stat
 *     raised, the points full); CDEA = 0 when used, 83 (the buzzer) when the kind has no field
 *     effect;
 *   - 09:4D80, the field spells 21 20 25 1B 2C (01:40D6 / 01:4132 / 01:424D / 01:422E check
 *     whether they can be cast here): not here, the message 09:7301; short of points 09:71E5;
 *     else the points paid and the menu left at once (09:4DBF: `MenuExit`), CA16 = the spell;
 *   - 09:4DBB / 0F:7CB0, the key items E7 E8 E9 F5 used in the field (the same way out), and
 *     0F:7BC8 (item E6: how many of the items D8-E4 are still to be found in this world);
 *   - 01:402D's actions after the menu: 01:4049 (CA16 21, the vehicle comes down: events2.ts
 *     boardVehicle), 01:40DD (20, a step onto the cell ahead, vehicle state 2), 01:41D6 (1B / 2C,
 *     back to the place kept at C7C9-C7CB through the closing band 01:5F39 and a map load with
 *     CA6B = 2), 01:4233 (25, story flag 0A toggled, the leader's sprite again).
 *  The routines of bank 09 run with bank 09 selected, those of bank 01 with bank 01, those of
 *  bank 0F with bank 0F (by their callers' far calls). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, far0, farcall, farSync, pushBank, popBank, soundBuzz, soundOk, wait1, memberOffset, windowOn,
  windowOff } from "./sys.js";
import { NotPorted } from "./irq.js";
import { entityOffset, applyLowFlagC884 } from "./bstats.js";
import { itemLoad } from "./bitems.js";
import { div32 } from "./equip.js";
import { memberLimit } from "./sprites.js";
import { menuMessage, oamHold } from "./menuitems.js";
import { setSlot, testFlag, setFlag, clearFlag, oamHideAll } from "./objects.js";
import { cellRead, objectSprite, drawObjects, leaderInit } from "./actors.js";
import { boardVehicle, companionFollow, leaderNext, leaderShiftUp, leaderShiftDown, leaderShiftRight, leaderShiftLeft,
  leaderUp, leaderDown, leaderRight, leaderLeft } from "./events2.js";
import { mapAnimation } from "./window.js";
import { loadObjects, loadMap, leaderLook, spriteType, leaderTiles, drawView, bgAddr } from "./mapload.js";
import { printText } from "./text.js";
import { soundMain } from "./battle.js";

// ---------------------------------------------------------------- small helpers

/** swap (nibbles). */
const swap = (a: number): number => ((a << 4) | (a >> 4)) & 0xff;

/** 00:246B — hl x a (8-bit a, shift and add; 16 bits). */
const mulA = (hl: number, a: number): number => (hl * (a & 0xff)) & 0xffff;

/** 00:247E — hl / a: CD46/CD47 = hl, CD48/CD49 = 0, CD4A = a, CD4B = 0, the division 00:24C7;
 *  returns hl = CD46/CD47 (the quotient's low word). */
function divA(m: Memory, hl: number, a: number): number {
  m.wr(0xcd46, hl & 0xff);
  m.wr(0xcd47, hl >> 8);
  m.wr(0xcd48, 0);
  m.wr(0xcd49, 0);
  m.wr(0xcd4a, a);
  m.wr(0xcd4b, 0);
  div32(m);
  return m.rd16(0xcd46);
}

/** 09:52F9 — the entity CD36 (00:1FC4) dead (C501 bit 6)? (nz) */
function isDead(m: Memory): boolean {
  return !!(m.rd((entityOffset(m) + 0xc501) & 0xffff) & 0x40);
}

/** 0B:706C — one item CE91 taken from the bag C6FF (24 pairs id, count): found with a count, the
 *  count - 1; not found or count 0: CE91 = FF. Returns hl (the count's address when found, else
 *  C72F after the search). */
function bagTake(m: Memory): number {
  const a = m.rd(0xce91);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (m.rd(hl) === a) {
      hl = (hl + 1) & 0xffff;
      const n = m.rd(hl);
      if (!n) break;
      m.wr(hl, n - 1);
      return hl;
    }
    hl = (hl + 2) & 0xffff;
  }
  m.wr(0xce91, 0xff);
  return hl;
}

/** 00:2901 — the item flag of item a (D8-E7: C6F8 / C6F9, bit 7 - ((a - D8) & 7)) set? (nz) */
function itemFlag(m: Memory, a: number): boolean {
  let k = (a - 0xd8) & 0xff;
  const hl = k >= 0x08 ? 0xc6f9 : 0xc6f8;
  k &= 0x07;
  return !!((0x80 >> k) & m.rd(hl));
}

/** 0F:7D9F — the objects of the OAM buffer (40, every 4 bytes) whose y is in [d, e) get y = 4. */
function oamHideRows(m: Memory, d: number, e: number): void {
  for (let l = 0; l < 0xa0; l += 4) {
    const a = m.rd(0xc000 + l);
    if (a >= d && a < e) m.wr(0xc000 + l, 4);
  }
}

/** 0F:7A24 — wait (a frame at a time, 00:358B) for a new press of any button (FF8B), then the
 *  cursor sound (00:1E7C). */
function* waitAny(g: Game): Co {
  const m = g.m;
  do yield* wait1(g); while (!m.hram[0x0b]);
  soundOk(m);
}

// ---------------------------------------------------------------- the menu left from inside an item use

/** 09:4DBF — the stack pointer back from CD43/CD44 (kept by the field menu 09:4000) and a jump to
 *  09:408F: the menu is left at once from deep inside an item / spell use (CA16 = the item or
 *  spell, set by 09:4DD6), every return address in between dropped (bank pushes included).
 *  Thrown here; the field menu (09:4000, `startMenu`) catches it and runs 09:408F. */
export class MenuExit extends Error {
  constructor() {
    super("09:4DBF: the field menu left (to be caught by startMenu)");
  }
}

// ---------------------------------------------------------------- the effect (09:521A)

/** 09:536D — sound 17; an amount b = CEDC / 2 + (FF93 halved until below CEDC / 2). (CEDC below
 *  2 loops forever in the original.) */
function amount(m: Memory): number {
  m.sfx(0x17);
  const b = m.rd(0xcedc) >> 1;
  let a = m.hram[0x13]!;
  if (!b) throw new NotPorted("09:5379 (CEDC below 2: an endless loop)");
  while (a >= b) a >>= 1;
  return (a + b) & 0xff;
}

/** 09:5410-542B / 09:5449-5463 — the hit points C510/C511 of CD36 (00:1FC4) = cur + add (16
 *  bits), at most max. */
function hpRaise(m: Memory, cur: number, max: number, add: number): void {
  const de = (add + cur) & 0xffff;
  const v = max < de ? max : de;
  const hl = (entityOffset(m) + 0xc510) & 0xffff;
  m.wr(hl, v & 0xff);
  m.wr((hl + 1) & 0xffff, v >> 8);
}

/** 09:542C — the hit points of CD36 (C510) raised by max (C512) x CEDC / 10 (00:246B, 00:247E),
 *  at most max. */
function healPercent(m: Memory): void {
  const hl = (entityOffset(m) + 0xc510) & 0xffff;
  const cur = m.rd16(hl);
  const max = m.rd16((hl + 2) & 0xffff);
  const add = divA(m, mulA(max, m.rd(0xcedc)), 0x0a);
  hpRaise(m, cur, max, add);
}

/** 09:53F4 — the hit points of CD36 (C510) raised by 10 x CEDC (00:246B), at most max (C512). */
function healFlat(m: Memory): void {
  const hl = (entityOffset(m) + 0xc510) & 0xffff;
  const cur = m.rd16(hl);
  const max = m.rd16((hl + 2) & 0xffff);
  hpRaise(m, cur, max, mulA(0x000a, m.rd(0xcedc)));
}

/** 09:53D1 — entity CD36 revived: sound 18, its status C501 = 0 (00:1FC4). */
function revive(m: Memory): void {
  m.sfx(0x18);
  m.wr((entityOffset(m) + 0xc501) & 0xffff, 0);
}

/** 09:5395 — kind 18: item CA: the points C514/C515 = C516/C517 (full), revived (09:53D1), healed
 *  (09:542C); others: (not dead, 09:52F9) sound 17, healed (09:542C). */
function effectHeal(m: Memory): void {
  if (m.rd(0xce26) === 0xca) {
    const hl = (entityOffset(m) + 0xc517) & 0xffff;
    const a = m.rd(hl);
    const e = m.rd((hl - 1) & 0xffff);
    m.wr((hl - 2) & 0xffff, a);
    m.wr((hl - 3) & 0xffff, e);
    revive(m);
    healPercent(m);
    return;
  }
  if (isDead(m)) return;
  m.sfx(0x17);
  healPercent(m);
}

/** 09:53B9 — kind 19, the status cured: sound 18, C884 = 0, the flag of CEDB at C884 (0B:7400),
 *  C501 of CD36 &= ~C884. */
function effectCure(g: Game): void {
  const m = g.m;
  g.sfx(0x18);
  m.wr(0xc884, 0);
  farSync(g, 0x0b, () => applyLowFlagC884(m));
  const hl = (entityOffset(m) + 0xc501) & 0xffff;
  m.wr(hl, ~m.rd(0xc884) & m.rd(hl));
}

/** 09:53DF — kind 1C: (not dead, 09:52F9) sound 17; a spell (CE25 = 0, CE26 below 30) heals by a
 *  percentage (09:542C), others by 10 x CEDC (09:53F4). */
function effectHealItem(m: Memory): void {
  if (isDead(m)) return;
  m.sfx(0x17);
  if (!m.rd(0xce25) && m.rd(0xce26) < 0x30) healPercent(m);
  else healFlat(m);
}

/** 09:5303 / 09:5308 / 09:530D — kinds 22-24, a stat raised: c = C50D of CD36, the byte at C50D +
 *  de (C532 / C533 / C534) + the amount (09:536D), at most 63 (b = what was added); C50D & 7
 *  clear: the byte 1A below (C518 / C519 / C51A) + b too. */
function effectStat(m: Memory, de: number): void {
  const base = (entityOffset(m) + 0xc50d) & 0xffff;
  const c = m.rd(base);
  const hl = (base + de) & 0xffff;
  let b = amount(m);
  let a = (b + m.rd(hl)) & 0xff;
  m.wr(hl, a);
  if (a >= 0x64) {
    m.wr(hl, 0x63);
    a = (0x63 - a) & 0xff;
    b = (a + b) & 0xff;
  }
  if (c & 0x07) return;
  const p = (hl - 0x1a) & 0xffff;
  m.wr(p, (b + m.rd(p)) & 0xff);
}

/** 09:5350 — the word at hl + b, at most 999 (3E7; then b = what was added, 8 bits). Returns b. */
function addMax999(m: Memory, hl: number, b: number): number {
  const s = b + m.rd(hl);
  m.wr(hl, s & 0xff);
  const h1 = (hl + 1) & 0xffff;
  const hi = (m.rd(h1) + (s >> 8)) & 0xff;
  m.wr(h1, hi);
  if (hi < 0x03) return b;
  const lo = m.rd(hl);
  if (hi === 0x03 && lo < 0xe8) return b;
  b = (((0xe7 - lo) & 0xff) + b) & 0xff;
  m.wr(hl, 0xe7);
  m.wr(h1, 0x03);
  return b;
}

/** 0C:7F9E — the words at hl + 5 and hl + 3 + b. */
function addTwoWords(m: Memory, hl: number, b: number): void {
  const add = (p: number) => {
    const s = b + m.rd(p);
    m.wr(p, s & 0xff);
    const q = (p + 1) & 0xffff;
    m.wr(q, (m.rd(q) + (s >> 8)) & 0xff);
  };
  add((hl + 5) & 0xffff);
  add((hl + 3) & 0xffff);
}

/** 09:5338 — kind 25: the word C530 of CD36 + the amount (09:536D), at most 999 (09:5350); C50D &
 *  7 clear: the max and current hit points C512 / C510 + b too (00:1D5A: 0C:7F9E, bank 0C). */
function effectHpMax(g: Game): void {
  const m = g.m;
  const hl = (entityOffset(m) + 0xc530) & 0xffff;
  let b = amount(m);
  b = addMax999(m, hl, b);
  const p = (hl - 0x23) & 0xffff;
  if (m.rd(p) & 0x07) return;
  farSync(g, 0x0c, () => addTwoWords(m, p, b));
}

/** 09:5383 — kind 26: sound 17, the points C514/C515 of CD36 = C516/C517 (00:1F90). */
function effectPointsFull(m: Memory): void {
  m.sfx(0x17);
  const hl = (entityOffset(m) + 0xc514) & 0xffff;
  copy(m, (hl + 2) & 0xffff, hl, 2);
}

/** 09:52CF — the effect of kind CEDD & 3F on CD36 by the table 09:52E5 (18-1C -> 0-4, 22-26 ->
 *  5-9): 09:5395, 09:53B9, the buzzer (00:1E83), 09:53D1, 09:53DF, 09:5303, 09:5308, 09:530D,
 *  09:5338, 09:5383. */
function* effectOn(g: Game): Co {
  const m = g.m;
  let i = ((m.rd(0xcedd) & 0x3f) - 0x18) & 0xff;
  if (i >= 0x05) i = (i - 0x05) & 0xff;
  switch (i) {
    case 0: effectHeal(m); return;
    case 1: effectCure(g); return;
    case 2: yield* soundBuzz(g); return;
    case 3: revive(m); return;
    case 4: effectHealItem(m); return;
    case 5: effectStat(m, 0x25); return;
    case 6: effectStat(m, 0x26); return;
    case 7: effectStat(m, 0x27); return;
    case 8: effectHpMax(g); return;
    case 9: effectPointsFull(m); return;
    default: throw new NotPorted(`09:52E4 (effect index ${i.toString(16)} past the table)`);
  }
}

/** 09:52B7 — a spell's points paid by the caster CE1C: C514/C515 (00:1FCD) - CE29. */
function payPoints(m: Memory): void {
  const hl = (memberOffset(m, m.rd(0xce1c) & 0x7f) + 0xc514) & 0xffff;
  const v = m.rd(hl) - m.rd(0xce29);
  m.wr(hl, v & 0xff);
  if (v < 0) {
    const h1 = (hl + 1) & 0xffff;
    m.wr(h1, (m.rd(h1) - 1) & 0xff);
  }
}

/** 09:521A — the effect of CE26 on the target CD36. CE25 = 0: a spell (below 30) paid by the
 *  caster (09:52B7); a weapon (30-77) / armour (78-BF) stands for the spell CEE0 / CEDE (CE26 =
 *  it, CE27 = 0). Then the record (09:5D7F) and the kind CEDD & 3F: 18-1C (CD36 bit 7: all the
 *  members: CDEA = the members alive (C503 not FF, C501 bit 6 clear, of the 5 records), CD36 = 0
 *  .. 3 (4 with a member limit, 0B:6D12) each through 09:52CF) or 22-26 (CDEA = 1, 09:52CF on
 *  CD36); then CDEA = CD15 = C080 = 0, CD3C = 2, a frame (00:358B). Other kinds: CDEA = 83, the
 *  buzzer (00:1E83). The caller goes on at 09:4A05 with CDEA. */
export function* useEffect(g: Game): Co {
  const m = g.m;
  if (!m.rd(0xce25)) {
    const a = m.rd(0xce26);
    if (a < 0x30) payPoints(m);
    else if (a < 0xc0) {
      m.wr(0xce26, a < 0x78 ? m.rd(0xcee0) : m.rd(0xcede));
      m.wr(0xce27, 0);
    }
  }
  // 09:523F
  farSync(g, 0x09, () => itemLoad(g));
  const k = m.rd(0xcedd) & 0x3f;
  if (k >= 0x27 || k < 0x18 || (k >= 0x1d && k < 0x22)) {
    m.wr(0xcdea, 0x83);
    yield* soundBuzz(g);
    return;
  }
  if (k < 0x22 && m.rd(0xcd36) & 0x80) {
    let b = 0;
    for (let c = 0, hl = 0xc503; c < 5; c++, hl += 0x60) {
      if (m.rd(hl) === 0xff) continue;
      if (m.rd(hl - 2) & 0x40) continue;
      b = (b + 1) & 0xff;
    }
    m.wr(0xcdea, b);
    let n = farSync(g, 0x0b, () => memberLimit(m)) ? 5 : 4;
    let a = 0;
    do {
      m.wr(0xcd36, a);
      yield* effectOn(g);
      a = (m.rd(0xcd36) + 1) & 0xff;
    } while (--n);
  } else {
    m.wr(0xcdea, 0x01);
    yield* effectOn(g);
  }
  // 09:529D
  m.wr(0xcdea, 0);
  m.wr(0xcd15, 0);
  m.wr(0xc080, 0);
  m.wr(0xcd3c, 0x02);
  yield* wait1(g);
}

// ---------------------------------------------------------------- the field spells (09:4D80)

/** 01:418A — the map C6E8 is not one of 02-05 (01:4194; 00:101F: nz, true). */
function notMaps2to5(m: Memory): boolean {
  const v = m.rd(0xc6e8);
  return !(v === 0x02 || v === 0x03 || v === 0x04 || v === 0x05);
}

/** 01:4198 — the map C6E8 is one of 06-08 (01:41A2; z, true). */
function isMap678(m: Memory): boolean {
  const v = m.rd(0xc6e8);
  return v === 0x06 || v === 0x07 || v === 0x08;
}

/** 01:40D6 — spell 21 not castable (nz, true): in a vehicle (C6E3, 00:0008) or not on maps 02-05
 *  (01:418A). */
export function callVehicleBlocked(m: Memory): boolean {
  if (m.rd(0xc6e3)) return true;
  return notMaps2to5(m);
}

/** 01:4132 — spell 20 not castable (nz, true): in a vehicle (C6E3), not on maps 02-05 (01:418A),
 *  or the cell ahead of the leader (slot 0, 00:01D7; by C6EE: 01:4755 / 4793 / 4774 / 4736) has
 *  an attribute C805 (00:0187) & E4 other than 40 (01:4177; 00:101F). */
export function stepAheadBlocked(g: Game): boolean {
  const m = g.m;
  if (m.rd(0xc6e3)) return true;
  if (notMaps2to5(m)) return true;
  setSlot(m, 0);
  leaderNext(m, m.rd(0xc6ee) & 0xc0);
  cellRead(g);
  return (m.rd(0xc805) & 0xe4) !== 0x40;
}

/** 01:422E — spells 1B / 2C not castable (nz, true) where CA6C is set (the map's header bit 7). */
export function warpBackBlocked(m: Memory): boolean {
  return !!m.rd(0xca6c);
}

/** 01:424D — spell 25: always castable (z, false). */
export function toggleBlocked(): boolean {
  return false;
}

/** 09:4A2C — the caster (00:1FC4) short of points: C515 0 and C514 below CE29: the message
 *  09:71E5 (01:7E0D) and true (nz). */
function* pointsShort(g: Game): Co<boolean> {
  const m = g.m;
  const hl = (entityOffset(m) + 0xc515) & 0xffff;
  const e = m.rd(0xce29);
  if (m.rd(hl)) return false;
  if (m.rd((hl - 1) & 0xffff) >= e) return false;
  yield* farcall(g, 0x01, () => menuMessage(g, 0x71e5, false));
  return true;
}

/** 09:4D80 — a field spell CE26 (found in 09:4DA2 by 09:4D79: CA16 = it): its check by the
 *  table 09:4D8A (21 01:40D6, 20 01:4132, 25 01:424D, 1B / 2C 01:422E, bank 01), returning to
 *  09:4D94: not castable: the message 09:7301 (01:7E0D) and true (nz); short of points (09:4A2C,
 *  its message): true; else the points C514/C515 of the caster - CE29 and the menu left
 *  (09:4DBF, `MenuExit`) for 01:402D. Returns what 09:4D79 returns (nz = true). */
export function* fieldSpellCast(g: Game): Co<boolean> {
  const m = g.m;
  const id = m.rd(0xce26);
  let blocked: boolean;
  if (id === 0x21) blocked = farSync(g, 0x01, () => callVehicleBlocked(m));
  else if (id === 0x20) blocked = farSync(g, 0x01, () => stepAheadBlocked(g));
  else if (id === 0x25) blocked = farSync(g, 0x01, () => toggleBlocked());
  else if (id === 0x1b || id === 0x2c) blocked = farSync(g, 0x01, () => warpBackBlocked(m));
  else throw new NotPorted(`09:4D87 (field spell ${id.toString(16)} not in the table)`);
  // 09:4D94
  if (blocked) {
    yield* farcall(g, 0x01, () => menuMessage(g, 0x7301, false));
    return true;
  }
  if (yield* pointsShort(g)) return true;
  const hl = (entityOffset(m) + 0xc514) & 0xffff;
  const v = m.rd(hl) - m.rd(0xce29);
  m.wr(hl, v & 0xff);
  if (v < 0) {
    const h1 = (hl + 1) & 0xffff;
    m.wr(h1, (m.rd(h1) - 1) & 0xff);
  }
  throw new MenuExit();
}

// ---------------------------------------------------------------- the key items (0F:7CB0, 0F:7BC8)

/** 0F:7D7C — the text left for 09:408F: CD34 = a (its mode), CDE6/CDE7 = hl (bank 0A); false (z). */
function textAfter(m: Memory, a: number, hl: number): boolean {
  m.wr(0xcd34, a);
  m.wr(0xcde6, hl & 0xff);
  m.wr(0xcde7, hl >> 8);
  return false;
}

/** 0F:7CB0 — the field use of the key item a (E7 E8 E9 F5); not usable here: true (nz, 0F:7D79);
 *  used: the text it leaves (0F:7D7C) and false (z).
 *  F5: CE91 = F5; on map 7F: its bag pair cleared (0B:706C, then FF FF), story flag B6 cleared,
 *  A9 set, the text 0A:686F mode 08.
 *  E7: not with flag CF or BB, in a vehicle, or off maps 00 / 01 / 05, nor without flag E1: sound
 *  2B, flag 82 set, the text 0A:4000.
 *  E8: item E9 in the bag (0B:706C, given back), not in a vehicle, on map 05 at the cell C6E4-C6E7
 *  = 0F:7D89 (30 01 A0 01): the map's objects again (00:1D90), the text 0A:695F.
 *  E9: on map 00: items E7 and E3 both in the bag (0B:706C, given back): the text 0A:6988, else
 *  0A:61AE. */
export function keyItemUse(g: Game, a: number): boolean {
  const m = g.m;
  if (a === 0xf5) { // 0F:7CEC
    m.wr(0xce91, a);
    if (m.rd(0xc6e8) !== 0x7f) return true;
    const hl = farSync(g, 0x0b, () => bagTake(m));
    m.wr(hl, 0xff);
    m.wr((hl - 1) & 0xffff, 0xff);
    clearFlag(m, 0xb6);
    setFlag(m, 0xa9);
    return textAfter(m, 0x08, 0x686f);
  }
  if (a < 0xe8) { // 0F:7D42
    if (testFlag(m, 0xcf)) return true;
    if (testFlag(m, 0xbb)) return true;
    if (m.rd(0xc6e3)) return true;
    const map = m.rd(0xc6e8);
    if (map !== 0x00 && map !== 0x05 && map !== 0x01) return true;
    if (!testFlag(m, 0xe1)) return true;
    g.sfx(0x2b);
    setFlag(m, 0x82);
    return textAfter(m, 0x00, 0x4000);
  }
  if (a === 0xe8) { // 0F:7D0E
    m.wr(0xce91, 0xe9);
    const hl = farSync(g, 0x0b, () => bagTake(m));
    if (m.rd(0xce91) === 0xff) return true;
    m.wr(hl, (m.rd(hl) + 1) & 0xff);
    if (m.rd(0xc6e3)) return true;
    if (m.rd(0xc6e8) !== 0x05) return true;
    for (let k = 0; k < 4; k++) if (m.rd(0x7d89 + k) !== m.rd(0xc6e4 + k)) return true;
    pushBank(g, 0x06); loadObjects(g); popBank(g); // 00:1D90
    return textAfter(m, 0x00, 0x695f);
  }
  // E9: 0F:7CBB
  if (m.rd(0xc6e8)) return true;
  m.wr(0xce91, 0xe7);
  let hl = farSync(g, 0x0b, () => bagTake(m));
  if (m.rd(0xce91) !== 0xff) {
    m.wr(hl, (m.rd(hl) + 1) & 0xff);
    m.wr(0xce91, 0xe3);
    hl = farSync(g, 0x0b, () => bagTake(m));
    if (m.rd(0xce91) !== 0xff) {
      m.wr(hl, (m.rd(hl) + 1) & 0xff);
      return textAfter(m, 0x00, 0x6988);
    }
  }
  return textAfter(m, 0x00, 0x61ae);
}

/** 09:4DBB — a key item CE26 (found in 09:4DC9 by 09:4DB4: CA16 = it) used (0F:7CB0, with a =
 *  it): not usable: the message 09:7301 (01:7E0D) and true (nz); used: the menu left (09:4DBF,
 *  `MenuExit`; 09:408F prints the text 0F:7CB0 left). Returns what 09:4DB4 returns. */
export function* specialItemUse(g: Game): Co<boolean> {
  const m = g.m;
  const a = m.rd(0xce26);
  if (farSync(g, 0x0f, () => keyItemUse(g, a))) {
    yield* farcall(g, 0x01, () => menuMessage(g, 0x7301, false));
    return true;
  }
  throw new MenuExit();
}

/** 0F:7BA7 — CDC0 = the world by the story flags: 05 -> 08, 0E -> 01, 0F -> 04, else 02. */
function worldOf(m: Memory): number {
  let a: number;
  if (testFlag(m, 0x05)) a = 0x08;
  else if (testFlag(m, 0x0e)) a = 0x01;
  else if (testFlag(m, 0x0f)) a = 0x04;
  else a = 0x02;
  m.wr(0xcdc0, a);
  return a;
}

/** 0F:7C38 — the world bit a refined: 04 -> 10 with story flag 2F; 08 -> by the map C6E8: 09 and
 *  9B-AC 40, else 20. */
function worldBit(m: Memory, a: number): number {
  if (a === 0x04) return testFlag(m, 0x2f) ? 0x10 : 0x04;
  if (a !== 0x08) return a;
  const map = m.rd(0xc6e8);
  if (map === 0x0a || map === 0x0b) return 0x20;
  if (map === 0x09) return 0x40;
  if (map < 0x9b) return 0x20;
  if (map < 0xad) return 0x40;
  return 0x20;
}

/** 0F:7BC8 — item E6 used in the field: C080 kept; the objects in rows 38-77 moved to y 4
 *  (0F:7D9F); CDC0 = e = the world bit (0F:7BA7, 0F:7C38); d = the items D8-E4 whose item flag
 *  (00:2901) is clear, that are not in the bag (0B:706C, given back) and whose 0F:7B8F byte has a
 *  bit of e; the text 09:7285 (mode 24, (1, 6) 18 x 6), then d (CE7C, CE7D/CE7E = 0) and the text
 *  after it, or (d = 0) 09:72A6, mode 04 at the cursor, 18 x 4; a key (0F:7A24), the objects
 *  hidden (0F:7D97), C080 back. */
export function* itemsLeft(g: Game): Co {
  const m = g.m;
  const c080 = m.rd(0xc080);
  farSync(g, 0x0f, () => oamHideRows(m, 0x38, 0x78));
  const w = farSync(g, 0x0f, () => worldOf(m));
  const e = worldBit(m, w);
  m.wr(0xcdc0, e);
  let d = 0;
  for (let b = 0xd8; b < 0xe5; b++) {
    if (itemFlag(m, b)) continue;
    m.wr(0xce91, b);
    const hl = farSync(g, 0x0b, () => bagTake(m));
    if (m.rd(0xce91) !== 0xff) {
      m.wr(hl, (m.rd(hl) + 1) & 0xff);
      continue;
    }
    if (m.rd((0x7b8f + b) & 0xffff) & e) d = (d + 1) & 0xff;
  }
  const r = yield* far0(g, 0x09, () => printText(g, 0x24, 0x7285, 0x0601, 0x0612));
  let hl: number;
  if (d) {
    m.wr(0xce7c, d);
    m.wr(0xce7d, 0);
    m.wr(0xce7e, 0);
    hl = r.hl;
  } else hl = 0x72a6;
  const de = r.de;
  yield* far0(g, 0x09, () => printText(g, 0x04, hl, de, 0x0412));
  yield* farcall(g, 0x0f, () => waitAny(g));
  farSync(g, 0x0f, () => oamHold(g));
  m.wr(0xc080, c080);
}

// ---------------------------------------------------------------- after the menu (01:402D)

/** 01:41AF — a frame of the leader's walk: the companion (01:4F24), the map animation, the
 *  objects drawn, a frame; returns C6EF != 0 (still moving). */
function* walkFrame(g: Game): Co<boolean> {
  const m = g.m;
  companionFollow(m);
  mapAnimation(g);
  drawObjects(g);
  yield* wait1(g);
  return m.rd(0xc6ef) !== 0;
}

/** 00:089E — the leader's look (00:08AD), its cell (01:4000, bank 01). */
function* lookAndCell(g: Game): Co {
  yield* leaderLook(g);
  pushBank(g, 0x01);
  leaderInit(g);
  popBank(g);
}

/** 01:4049 — CA16 = 21 after the menu: the vehicle comes down (events2.ts boardVehicle). */
export function* afterCallVehicle(g: Game): Co {
  yield* boardVehicle(g);
}

/** 01:40DD — CA16 = 20 after the menu: (01:4132 again: not castable here, nothing) sound 27, a
 *  frame (00:3A6B); a forced step of the leader in its facing C6EE (01:5C02 up / 5C43 right /
 *  5C22 down / 5C64 left, then step frames 01:44E9 / 4562 / 445F / 45DB with 01:41AF until C6EF
 *  is 0); C6E3 = 2 (01:4182), the leader's look and cell (00:089E). */
export function* afterStepAhead(g: Game): Co {
  const m = g.m;
  if (stepAheadBlocked(g)) return;
  g.sfx(0x27);
  yield* g.wait(1);
  const d = m.rd(0xc6ee) & 0xc0;
  const [shift, frame] = d === 0x00 ? [leaderShiftUp, leaderUp] : d === 0x40 ? [leaderShiftRight, leaderRight]
    : d === 0x80 ? [leaderShiftDown, leaderDown] : [leaderShiftLeft, leaderLeft];
  shift(m);
  do frame(m); while (yield* walkFrame(g));
  m.wr(0xc6e3, 0x02);
  yield* lookAndCell(g);
}

/** 00:3A59 — the background off (LCDC bit 0). */
function bgOff(m: Memory): void {
  m.wr(0xff40, m.rd(0xff40) & 0xfe);
}
/** 00:3A52 — the background on (LCDC bit 0). */
function bgOn(m: Memory): void {
  m.wr(0xff40, m.rd(0xff40) | 0x01);
}

/** 00:3A78 (after a wait for mode 2/3, or the hblank of the line after): in line x, the writes
 *  `fn` makes in its hblank showing from the line after (`Game.later`). */
function* inHblank(g: Game, x: number, fn: () => void): Co {
  yield* g.untilLine(x);
  g.later(1, fn);
}

/** 01:6013 — the wipe's start (as wipe.ts's, not exported there): objects hidden (00:3A24); di,
 *  the vblank / STAT vectors `ret` (00:3D54 / 00:3D68), ei; the view at scroll (A8, F0) drawn into
 *  9C00 (CA2A = 4, 00:0E34), WX 57, WY 0, window on (00:3A44), the scroll back; then rows C800 =
 *  F8, F0+8 .. (C801 = 58): 22 tiles from the map address of (C801, C800) (00:0DE4) set FF, each
 *  in the next hblank. */
function* wipeBegin(g: Game): Co {
  const m = g.m;
  oamHideAll(m);
  g.ime = false;
  m.wr(0xc0b9, 0xc9);
  m.wr(0xc0bc, 0xc9);
  yield* g.reti(); // ei
  const sy = m.hram[0x12]!, sx = m.hram[0x11]!;
  m.hram[0x12] = 0xf0;
  m.hram[0x11] = 0xa8;
  m.wr(0xca2a, 0x04);
  yield* drawView(g);
  m.wr(0xff4b, 0x57);
  m.wr(0xff4a, 0);
  windowOn(m);
  m.hram[0x11] = sx;
  m.hram[0x12] = sy;
  m.wr(0xc800, 0xf8);
  m.wr(0xc801, 0x58);
  do {
    let hl = bgAddr(m, m.rd(0xc801), m.rd(0xc800));
    let x = g.ly;
    for (let b = 0x16; b; b--) {
      x = x >= 0x8f ? 0 : x + 1; // the next line with an hblank
      const a = hl;
      yield* inHblank(g, x, () => m.wr(a, 0xff));
      hl = (hl & 0xff00) | (hl & 0xe0) | ((hl + 1) & 0x1f);
    }
    m.wr(0xc800, (m.rd(0xc800) + 0x08) & 0xff);
  } while (m.rd(0xc800) !== 0xf8);
}

/** 01:5F39 — the closing band before the warp's map load: WY kept; the wipe's start (01:6013);
 *  b = c = 48, d = 50; each frame from LY 0: WX + 1 (at most A5), SCX + 1, d - 1, (b not 0) b - 1
 *  and c + 1; at LY b window off, BGP / OBP0 / OBP1 0, the background off; at LY c window on, the
 *  background on, BGP = CDB4, a sound tick (00:3A60); until d is 0. Then window off, BGP 0, the
 *  vectors back (00:3D4E / 00:3D62, no di / ei), WY back, a frame (00:3A6B). LY polls. */
export function* warpOut(g: Game): Co {
  const m = g.m;
  const wy = m.rd(0xff4a);
  yield* wipeBegin(g);
  let b = 0x48, c = 0x48, d = 0x50;
  do {
    yield* g.untilLine(0);
    let a = (m.rd(0xff4b) + 1) & 0xff;
    if (a >= 0xa6) a = 0xa5;
    m.wr(0xff4b, a);
    m.wr(0xff43, (m.rd(0xff43) + 1) & 0xff);
    d = (d - 1) & 0xff;
    if (b) {
      b = (b - 1) & 0xff;
      c = (c + 1) & 0xff;
    }
    yield* g.untilLine(b);
    windowOff(m);
    m.wr(0xff47, 0);
    m.wr(0xff48, 0);
    m.wr(0xff49, 0);
    bgOff(m);
    yield* g.untilLine(c);
    windowOn(m);
    bgOn(m);
    m.wr(0xff47, m.rd(0xcdb4));
    yield* soundMain(g);
  } while (d);
  windowOff(m);
  m.wr(0xff47, 0);
  m.wr(0xc0b9, 0xc3);
  m.wr(0xc0bc, 0xc3);
  m.wr(0xff4a, wy);
  yield* g.wait(1);
}

/** 01:41D6 — CA16 = 1B / 2C after the menu: (CA6C set, 01:422E: nothing) the closing band
 *  (01:5F39), sound 1A, CA6B = 2; the facing C6EE = C6F7, the cell C6E4-C6E7 from C7C9 / C7CA
 *  (y, x: high nibble -> the high byte, low nibble -> the high nibble of the low byte), the map
 *  C6E8 = C7CB; maps 06-08 (01:4198): C6E3 = 2; C7C8 = 0, the map load (00:027D), CA6B = 0. */
export function* afterWarpBack(g: Game): Co {
  const m = g.m;
  if (warpBackBlocked(m)) return;
  yield* warpOut(g);
  g.sfx(0x1a);
  m.wr(0xca6b, 0x02);
  m.wr(0xc6ee, m.rd(0xc6f7));
  let v = m.rd(0xc7c9);
  m.wr(0xc6e4, swap(v) & 0xf0);
  m.wr(0xc6e5, swap(v) & 0x0f);
  v = m.rd(0xc7ca);
  m.wr(0xc6e6, swap(v) & 0xf0);
  m.wr(0xc6e7, swap(v) & 0x0f);
  m.wr(0xc6e8, m.rd(0xc7cb));
  if (isMap678(m)) m.wr(0xc6e3, 0x02);
  m.wr(0xc7c8, 0);
  yield* loadMap(g);
  m.wr(0xca6b, 0);
}

/** 00:01E7 — the leader's sprite again: bank 0B (rst $20), the type of sprite 0B (00:04F7, its
 *  00:08AD frame; pops the bank), the leader's tiles (00:04B1), the sprite list by C6EE (01:5272),
 *  a frame (00:3A6B). */
function* leaderSpriteAgain(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x0b);
  yield* spriteType(g, 0x0b);
  yield* leaderTiles(g);
  objectSprite(m, m.rd(0xc6ee));
  yield* g.wait(1);
}

/** 01:4233 — CA16 = 25 after the menu: sound 2C, story flag 0A toggled (00:3CB2, 00:3CA6 /
 *  00:3CA0; it turns the leader into the vehicle sprite FA / FB, 00:04F7), the leader's sprite
 *  again (00:01E7). */
export function* afterToggle0A(g: Game): Co {
  const m = g.m;
  g.sfx(0x2c);
  if (testFlag(m, 0x0a)) clearFlag(m, 0x0a);
  else setFlag(m, 0x0a);
  yield* leaderSpriteAgain(g);
}
