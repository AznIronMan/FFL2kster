/** Legend III field menu items 2 and 4 (09:4A4A / 09:439F, from the item table 09:4034).
 *  Item 2: a member chosen (09:413F), then its 8 bytes C548-C54F (4 rows CD15 0-3, 2 columns
 *  C081 10 / 58; the row's line of the text 09:7143 shown at the top through CDE6) used with CE25
 *  = 1 (09:49C0). Item 4, the equipment: a member chosen (09:413F), then its 8 slots C540-C547
 *  (cursor rows CD15 0-3 at C080 60 + 10 CD15, columns C081 10 / 58); A picks a slot (CDDC/CDDD,
 *  CD18 / C085 kept, CD17 = 1) and shows the bag list of the slot's range CD21-CD22 (09:464A;
 *  scroll CD1A, the list scrolls 00:3470 / 00:34E0 with a = 9, b = 6); A on a bag entry
 *  (CDDE/CDDF = C6FF + 2 (CD1A + CD15)) swaps it with the slot (00:2503: the checks, the bag
 *  updates, the slot and its use count C500, the worn-out weapons 0B:6683, the stats removed and
 *  added 0B:7124). All of it runs with bank 09 selected. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, copyB, fill, far0, farcall, farSync, pushBank, popBank, soundBuzz } from "./sys.js";
import { menuInput } from "./title.js";
import { drawMenu } from "./menu.js";
import { printText } from "./text.js";
import { entityOffset } from "./bstats.js";
import { equipStats, wornOutBack } from "./equip.js";
import { listCursorsOff, cursorsHide } from "./fieldmenu.js";
import { chooseMember, useTarget, oamHold, waitAB, listScrollDown, listScrollUp } from "./menuitems.js";

// ---------------------------------------------------------------- small helpers

/** swap a (the nibbles exchanged). */
const swap = (a: number): number => ((a << 4) | (a >> 4)) & 0xff;

/** 00:1EBB — hl moved on past b 4C bytes (bank 09 pushed): hl at the b-th 4C after it. */
function nextLines(g: Game, hl: number, b: number): number {
  const m = g.m;
  pushBank(g, 0x09);
  b = b || 256;
  do {
    do hl = (hl + 1) & 0xffff; while (m.rd(hl) !== 0x4c);
  } while (--b);
  popBank(g);
  return hl;
}

/** 00:1EC9 — hl moved back to the b-th 4C before it (bank 09 pushed). */
function prevLines(g: Game, hl: number, b: number): number {
  const m = g.m;
  pushBank(g, 0x09);
  b = b || 256;
  do {
    do hl = (hl - 1) & 0xffff; while (m.rd(hl) !== 0x4c);
  } while (--b);
  popBank(g);
  return hl;
}

/** 09:52F9 — the entity CD36 (00:1FC4) dead (C501 bit 6)? (nz) */
function isDead(m: Memory): boolean {
  return !!(m.rd((entityOffset(m) + 0xc501) & 0xffff) & 0x40);
}

// ---------------------------------------------------------------- the bag (bank 0B)

/** 0B:706C — one of item CE91 taken from the bag C6FF (24 pairs id, count): not found or a count
 *  of 0: CE91 = FF; else its count - 1. Returns hl (at the count when found). */
function bagTake(m: Memory): number {
  const id = m.rd(0xce91);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (m.rd(hl) === id) {
      hl = (hl + 1) & 0xffff;
      const n = m.rd(hl);
      if (!n) break;
      m.wr(hl, (n - 1) & 0xff);
      return hl;
    }
    hl = (hl + 2) & 0xffff;
  }
  m.wr(0xce91, 0xff);
  return hl;
}

/** 0B:7037 — item CE94 into the bag C6FF: its pair counts one more (9 or more: CE94 = FF), else
 *  the first free pair (id FF) = CE94, 1; none: CE94 = FF. Returns hl (at the count when put). */
function bagPut(m: Memory): number {
  const id = m.rd(0xce94);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (m.rd(hl) === id) {
      hl = (hl + 1) & 0xffff;
      const n = m.rd(hl);
      if (n >= 0x09) { m.wr(0xce94, 0xff); return hl; }
      m.wr(hl, (n + 1) & 0xff);
      return hl;
    }
    hl = (hl + 2) & 0xffff;
  }
  hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (m.rd(hl) === 0xff) {
      m.wr(hl, m.rd(0xce94));
      hl = (hl + 1) & 0xffff;
      m.wr(hl, 0x01);
      return hl;
    }
    hl = (hl + 2) & 0xffff;
  }
  m.wr(0xce94, 0xff);
  return hl;
}

// ---------------------------------------------------------------- the discard question

/** 09:4921 — the question 09:6FAE (the buzzer; the cursor C080 kept, hidden with the cursors
 *  09:490E when 48-97; the text at de, 16 x 8, mode 24, 00:3211; A or B, 0F:7A2C; CD39 = 1, C080
 *  back): true (z) when A was pressed. */
function* askDiscard(g: Game, de: number): Co<boolean> {
  const m = g.m;
  yield* soundBuzz(g);
  const c080 = m.rd(0xc080);
  if (c080 >= 0x48 && c080 < 0x98) {
    m.wr(0xc080, 0);
    cursorsHide(m);
  }
  yield* far0(g, 0, () => printText(g, 0x24, 0x6fae, de, 0x0810));
  const b = yield* farcall(g, 0x0f, () => waitAB(g));
  m.wr(0xcd39, 1);
  m.wr(0xc080, c080);
  return !(b & 0x02);
}

/** 0B:6DB3 — 09:4921 at (2, 1) (CD37 clear: (2, 8)); true (z) when A was pressed. */
function* askDiscardAt(g: Game): Co<boolean> {
  const de = g.m.rd(0xcd37) ? 0x0102 : 0x0802;
  return yield* farcall(g, 0x09, () => askDiscard(g, de));
}

// ---------------------------------------------------------------- the equipment swap (00:2503)

/** 00:26B1 — CDE2 (the bag item) = CDE0 (the slot item)? (z) */
const sameItem = (m: Memory): boolean => m.rd(0xcde2) === m.rd(0xcde0);

/** 00:2607 — CDE0 = CE91 = CE94 = the slot item [CDDC]; CDE1 = its uses (below 78: C500 + slot -
 *  40 & 0F, else 1); CDE2 / CDE3 = the bag pair [CDDE]; returns 00:26B1 (z: the same item). */
function swapRead(m: Memory): boolean {
  let hl = m.rd16(0xcddc);
  const a = m.rd(hl);
  m.wr(0xcde0, a);
  m.wr(0xce91, a);
  m.wr(0xce94, a);
  if (a < 0x78) {
    hl = (hl + 0xffc0) & 0xffff;
    m.wr(0xcde1, m.rd(hl) & 0x0f);
  } else m.wr(0xcde1, 0x01);
  hl = m.rd16(0xcdde);
  m.wr(0xcde2, m.rd(hl));
  m.wr(0xcde3, m.rd((hl + 1) & 0xffff));
  return sameItem(m);
}

/** 00:2682 — the bag item CDE2 fits the slot (CDDC - the record's C540: 0-6, 7 as 6; the range
 *  00:26A4 [k] .. [k + 1] - 1) or is FF? false (z) when it does; true (nz) refused. */
function slotRefuses(m: Memory): boolean {
  const l = ((entityOffset(m) + 0xc540) & 0xffff) & 0xff;
  let a = (m.rd(0xcddc) - l) & 0xff;
  if (a === 0x07) a = 0x06;
  const hl = (0x26a4 + a) & 0xffff;
  const id = m.rd(0xcde2);
  if (id === 0xff) return false;
  if (id < m.rd(hl)) return true;
  if (id >= m.rd((hl + 1) & 0xffff)) return true;
  return false;
}

/** 00:263D — where the slot item goes in the bag (CDE4/CDE5): none (CDE0 FF) or not in the bag
 *  (0B:706C): the bag pair itself (CDDE -> CDE4), done when the items are the same, the slot empty,
 *  the bag entry empty, the bag item 6E-77 or its count 1; else into the bag (0B:7037; full or 9
 *  of it: refused (nz)), that pair's count 0 and CDE4 = it. In the bag: CDE4 = its pair (the count
 *  taken by 0B:706C given back). Returns true (nz) when refused. */
function* swapTarget(g: Game): Co<boolean> {
  const m = g.m;
  let hl: number;
  found: {
    if (m.rd(0xcde0) === 0xff) break found;
    hl = farSync(g, 0x0b, () => bagTake(m));
    if (m.rd(0xce91) === 0xff) break found;
    m.wr(hl, (m.rd(hl) + 1) & 0xff);
    hl = (hl - 1) & 0xffff;
    m.wr(0xcde4, hl & 0xff);
    m.wr(0xcde5, hl >> 8);
    return false;
  }
  // 00:264F
  copy(m, 0xcdde, 0xcde4, 2);
  if (sameItem(m)) return false;
  if (m.rd(0xcde0) === 0xff) return false;
  const a = m.rd(0xcde2);
  if (a === 0xff) return false;
  if (a >= 0x6e && a < 0x78) return false;
  if (m.rd(0xcde3) === 0x01) return false;
  hl = farSync(g, 0x0b, () => bagPut(m));
  const b = m.rd(0xce94);
  if (b >= 0xfe) return b !== 0xfe;
  m.wr(hl, 0);
  hl = (hl - 1) & 0xffff;
  m.wr(0xcde4, hl & 0xff);
  m.wr(0xcde5, hl >> 8);
  return false;
}

/** 00:25ED — the slot item would make 10 or more of it at [CDE4] (the same id, CDE1 + the count):
 *  the discard question (0B:6DB3); returns true (nz) when refused (B). */
function* swapOverflow(g: Game): Co<boolean> {
  const m = g.m;
  const hl = m.rd16(0xcde4);
  if (m.rd(0xcde0) !== m.rd(hl)) return false;
  if (((m.rd(0xcde1) + m.rd((hl + 1) & 0xffff)) & 0xff) < 0x0a) return false;
  return !(yield* farcall(g, 0x0b, () => askDiscardAt(g)));
}

/** 00:2551 — the swap: a slot item (not FF): the slot FF, it goes to [CDE4] (the same id: count +
 *  CDE1, at most 9; else id CDE0, count CDE1), weapons (below 78) clear the uses C500 & F0. Then a
 *  bag item (CDE2 not FF; the same as the slot's only for 6E-77): the bag pair [CDDE] changed (its
 *  id not CDE2 any more): the slot = CDE2 (below 78: uses = CDE3); else the slot = its id, 6E-77:
 *  the uses = the count and the count 0, below 6E: uses 1, count - 1; 78 and above: count - 1. */
function swapApply(m: Memory): void {
  let hl = m.rd16(0xcddc);
  if (m.rd(hl) !== 0xff) {
    m.wr(hl, 0xff);
    hl = m.rd16(0xcde4);
    const a = m.rd(0xcde0);
    if (a === m.rd(hl)) {
      hl = (hl + 1) & 0xffff;
      let n = (m.rd(0xcde1) + m.rd(hl)) & 0xff;
      if (n >= 0x0a) n = 0x09;
      m.wr(hl, n);
    } else {
      m.wr(hl, a);
      m.wr((hl + 1) & 0xffff, m.rd(0xcde1));
    }
    // 00:257C
    if (m.rd(0xcde0) < 0x78) {
      const p = (entityOffset(m) + 0xc500) & 0xffff;
      m.wr(p, m.rd(p) & 0xf0);
    }
  }
  // 00:258E
  const a = m.rd(0xcde2);
  if (a === 0xff) return;
  if (sameItem(m)) {
    if (a < 0x6e) return;
    if (a >= 0x78) return;
  }
  // 00:259E
  hl = m.rd16(0xcddc);
  let de = m.rd16(0xcdde);
  const c = m.rd(de);
  if (a !== c) {
    m.wr(hl, a);
    if (a >= 0x78) return;
    hl = (hl + 0xffc0) & 0xffff;
    m.wr(hl, (m.rd(hl) & 0xf0) | m.rd(0xcde3));
    return;
  }
  // 00:25C6
  m.wr(hl, c);
  hl = (hl + 0xffc0) & 0xffff;
  const id = m.rd(de);
  de = (de + 1) & 0xffff;
  if (id >= 0x6e && id < 0x78) {
    m.wr(hl, (m.rd(hl) & 0xf0) | m.rd(de));
    m.wr(de, 0);
    return;
  }
  if (id < 0x78) m.wr(hl, (m.rd(hl) & 0xf0) | 0x01);
  m.wr(de, (m.rd(de) - 1) & 0xff);
}

/** 00:2535 — the swap checked and done: the same item (00:2607) and FF: refused; the slot range
 *  (00:2682), the bag target (00:263D), 10 or more (00:25ED) may refuse; else the swap (00:2551)
 *  and the worn-out weapons back (0B:6683). Returns true (nz) when refused. */
function* swapCheck(g: Game): Co<boolean> {
  const m = g.m;
  if (swapRead(m) && m.rd(0xcde2) === 0xff) return true;
  if (slotRefuses(m)) return true;
  if (yield* swapTarget(g)) return true;
  if (yield* swapOverflow(g)) return true;
  swapApply(m);
  farSync(g, 0x0b, () => wornOutBack(g));
  return false;
}

/** 00:2503 — the slot [CDDC] swapped with the bag pair [CDDE] (00:2535); done: the old slot item's
 *  stats off (CE25 = 1, 0B:7124), the new one's on (CE25 = 0). Returns true (nz) when refused. */
export function* equipSwap(g: Game): Co<boolean> {
  const m = g.m;
  const d = m.rd(m.rd16(0xcddc));
  if (yield* swapCheck(g)) return true;
  if (d !== 0xff) {
    m.wr(0xce26, d);
    m.wr(0xce25, 0x01);
    farSync(g, 0x0b, () => equipStats(g));
  }
  const a = m.rd(m.rd16(0xcddc));
  if (a !== 0xff) {
    m.wr(0xce26, a);
    m.wr(0xce25, 0x00);
    farSync(g, 0x0b, () => equipStats(g));
  }
  return false;
}

// ---------------------------------------------------------------- the equipment screen (09:465A)

/** 09:45C8 — the slots shown: the list cursors off (0F:78B2), CD19 = 0, the boxes 09:45D9 (16
 *  bytes) -> C8B0, drawn (09:4FEF). */
function* slotsShow(g: Game): Co {
  const m = g.m;
  farSync(g, 0x0f, () => listCursorsOff(m));
  m.wr(0xcd19, 0);
  copy(m, 0x45d9, 0xc8b0, 16);
  yield* drawMenu(g);
}

/** 09:461A — the bag list drawn again: the text CDE6 -> C8BB, C080 = 60 + 10 CD15, the list
 *  cursors C088 = 70, C08C = 78, drawn (09:4FEF). */
function* bagRedraw(g: Game): Co {
  const m = g.m;
  copy(m, 0xcde6, 0xc8bb, 2);
  m.wr(0xc080, (swap(m.rd(0xcd15)) + 0x60) & 0xff);
  m.wr(0xc088, 0x70);
  m.wr(0xc08c, 0x78);
  yield* drawMenu(g);
}

/** 09:45E9 — the bag list for the picked slot: CD19 = 3, the range CD21/CD22 = 09:464A [2 (2 CD18
 *  + (C085 not 10))], the boxes 09:463A (16 bytes) -> C8B0, the text CDE6 = 09:7033, then 09:461A. */
function* bagShow(g: Game): Co {
  const m = g.m;
  m.wr(0xcd19, 0x03);
  let e = (m.rd(0xcd18) * 2) & 0xff;
  if (m.rd(0xc085) !== 0x10) e = (e + 1) & 0xff;
  const hl = (0x464a + ((e * 2) & 0xff)) & 0xffff;
  m.wr(0xcd21, m.rd(hl));
  m.wr(0xcd22, m.rd((hl + 1) & 0xffff));
  copy(m, 0x463a, 0xc8b0, 16);
  m.wr(0xcde6, 0x33);
  m.wr(0xcde7, 0x70);
  yield* bagRedraw(g);
}

/** 09:46A1 / 09:470C-4721 — back to the slots: CD17 = 0, C081 = C085, CD15 = CD18, C080 = 60 + 10
 *  CD15, the slots shown (09:45C8). */
function* slotsBack(g: Game): Co {
  const m = g.m;
  m.wr(0xcd17, 0);
  m.wr(0xc081, m.rd(0xc085));
  const a = m.rd(0xcd18);
  m.wr(0xcd15, a);
  m.wr(0xc080, (swap(a) + 0x60) & 0xff);
  yield* slotsShow(g);
}

/** 09:467D — A: in the bag list (CD17 set): the bag pair CDDE = C6FF + 2 (CD1A + CD15), the swap
 *  (00:2503): refused: the buzzer and the list again (09:461A); done: back to the slots. On the
 *  slots: C085 = C081, CD18 = CD15, the slot CDDC = C540 + the record of CD36 + 2 CD15 + (C081 not
 *  10); a member 4 and above with that slot taken: the buzzer; else CD1A = CD15 = 0, CD17 = 1, the
 *  cursor (60, 10) and the bag list (09:45E9). */
function* equipA(g: Game): Co {
  const m = g.m;
  if (m.rd(0xcd17)) {
    const a = (((m.rd(0xcd1a) + m.rd(0xcd15)) & 0xff) * 2) & 0xff;
    const hl = (0xc6ff + a) & 0xffff;
    m.wr(0xcdde, hl & 0xff);
    m.wr(0xcddf, hl >> 8);
    if (yield* equipSwap(g)) {
      yield* soundBuzz(g);
      yield* bagRedraw(g);
      return;
    }
    yield* slotsBack(g);
    return;
  }
  // 09:46BB
  let hl = (entityOffset(m) + 0xc540) & 0xffff;
  const d = m.rd(0xc081);
  m.wr(0xc085, d);
  const a = m.rd(0xcd15);
  m.wr(0xcd18, a);
  let e = (a * 2) & 0xff;
  if (d !== 0x10) e = (e + 1) & 0xff;
  hl = (hl + e) & 0xffff;
  m.wr(0xcddc, hl & 0xff);
  m.wr(0xcddd, hl >> 8);
  if (m.rd(0xcd36) >= 0x04 && m.rd(hl) !== 0xff) { yield* soundBuzz(g); return; }
  // 09:46EE
  m.wr(0xcd1a, 0);
  m.wr(0xcd15, 0);
  m.wr(0xcd17, 1);
  m.wr(0xc080, 0x60);
  m.wr(0xc081, 0x10);
  yield* bagShow(g);
}

/** 09:4731 — Up: CD15 above 0: CD15 - 1, C080 - 10; at 0 on the slots: CD15 = 3, C080 = 90; in the
 *  bag list: CD19 bit 0 set: the list up (00:34E0, a = 9, b = 6), CD1A - 1; else the buzzer. */
function* equipUp(g: Game): Co {
  const m = g.m;
  const a = m.rd(0xcd15);
  if (a) {
    m.wr(0xcd15, a - 1);
    m.wr(0xc080, (m.rd(0xc080) - 0x10) & 0xff);
    return;
  }
  if (!m.rd(0xcd17)) {
    m.wr(0xcd15, 0x03);
    m.wr(0xc080, 0x90);
    return;
  }
  if (!(m.rd(0xcd19) & 0x01)) { yield* soundBuzz(g); return; }
  yield* listScrollUp(g, 0x09, 0x06);
  m.wr(0xcd1a, (m.rd(0xcd1a) - 1) & 0xff);
}

/** 09:4762 — Down: CD15 below 3: CD15 + 1, C080 + 10; at 3 on the slots: CD15 = 0, C080 = 60; in
 *  the bag list: CD19 bit 1 set: the list down (00:3470, a = 9, b = 6), CD1A + 1; else the buzzer. */
function* equipDown(g: Game): Co {
  const m = g.m;
  const a = m.rd(0xcd15);
  if (a !== 0x03) {
    m.wr(0xcd15, a + 1);
    m.wr(0xc080, (m.rd(0xc080) + 0x10) & 0xff);
    return;
  }
  if (!m.rd(0xcd17)) {
    m.wr(0xcd15, 0x00);
    m.wr(0xc080, 0x60);
    return;
  }
  if (!(m.rd(0xcd19) & 0x02)) { yield* soundBuzz(g); return; }
  yield* listScrollDown(g, 0x09, 0x06);
  m.wr(0xcd1a, (m.rd(0xcd1a) + 1) & 0xff);
}

/** 09:465A — the equipment of member CD36: CD15 = 0, the objects hidden (0F:7D97), the cursor
 *  (60, 10), the slots (09:45C8), then the menu input (00:1E51): A 09:467D, B 09:4704 (in the bag
 *  list: back to the slots; else CD21 = CD22 = 0 and left, 00:1E79), Select / Start the buzzer,
 *  Right / Left 09:4724 (on the slots: C081 ^= 48), Up 09:4731, Down 09:4762. */
function* equipScreen(g: Game): Co {
  const m = g.m;
  m.wr(0xcd15, 0);
  farSync(g, 0x0f, () => oamHold(g));
  m.wr(0xc080, 0x60);
  m.wr(0xc081, 0x10);
  yield* slotsShow(g);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: yield* equipA(g); return false;
      case 1: // 09:4704
        if (m.rd(0xcd17)) { yield* slotsBack(g); return false; }
        m.wr(0xcd21, 0);
        m.wr(0xcd22, 0);
        return true;
      case 4: case 5: // 09:4724
        if (!m.rd(0xcd17)) m.wr(0xc081, m.rd(0xc081) ^ 0x48);
        return false;
      case 6: yield* equipUp(g); return false;
      case 7: yield* equipDown(g); return false;
      default: yield* soundBuzz(g); return false; // 2, 3: 00:1E83
    }
  });
}

/** 09:439F — menu item 4, the equipment: a member chosen (09:413F) and its equipment (09:465A),
 *  again until cancelled; then CD15 = 4. */
export function* menuItem4(g: Game): Co {
  for (;;) {
    const a = yield* chooseMember(g);
    if (a === 0xff) break;
    yield* equipScreen(g);
  }
  g.m.wr(0xcd15, 0x04);
}

// ---------------------------------------------------------------- menu item 2 (09:4A4A)

/** 09:4AF6 — CD19 = 3, the boxes 09:4B1D (0x17 bytes, 00:1F97) -> C8B0, the second box's text
 *  C8BB/C8BC = CDE6, the list cursors C088 = 18, C08C = 20, drawn (09:4FEF). */
function* item2Show(g: Game): Co {
  const m = g.m;
  m.wr(0xcd19, 0x03);
  copyB(m, 0x4b1d, 0xc8b0, 0x17);
  m.wr(0xc8bb, m.rd(0xcde6));
  m.wr(0xc8bc, m.rd(0xcde7));
  m.wr(0xc088, 0x18);
  m.wr(0xc08c, 0x20);
  yield* drawMenu(g);
}

/** 09:4ACC — CDE6 = hl, its line drawn at (1, 1), 18 x 2, mode 84 (00:3211). */
function* item2Line(g: Game, hl: number): Co {
  const m = g.m;
  m.wr(0xcde6, hl & 0xff);
  m.wr(0xcde7, hl >> 8);
  yield* far0(g, 0, () => printText(g, 0x84, hl, 0x0101, 0x0212));
}

/** 09:4A85 — A: CE26 = C548 + the record of CD36 (00:1FC4) + 2 CD15 + (C081 not 10), CE25 = 1;
 *  the member dead (09:52F9): the buzzer, else the use (09:49C0); shown again (09:4AF6). */
function* item2A(g: Game): Co {
  const m = g.m;
  let hl = (entityOffset(m) + 0xc548) & 0xffff;
  let e = (m.rd(0xcd15) * 2) & 0xff;
  if (m.rd(0xc081) !== 0x10) e = (e + 1) & 0xff;
  hl = (hl + e) & 0xffff;
  m.wr(0xce26, m.rd(hl));
  m.wr(0xce25, 0x01);
  if (isDead(m)) yield* soundBuzz(g);
  else yield* useTarget(g);
  yield* item2Show(g);
}

/** 09:4A4A — menu item 2: a member chosen (09:413F; cancelled: CD15 = 2, back); CDE6 = 09:7143,
 *  CD15 = 0, the objects hidden (0F:7D97), the cursor (20, 10), shown (09:4AF6), then the menu
 *  input (00:1E51): A 09:4A85, B 09:4A7B (left, a member chosen again), Select / Start the buzzer,
 *  Right / Left 09:4AB0 (C081 ^= 48), Up 09:4AB8 (CD15 0: the buzzer; else CD15 - 1 and the line
 *  before, 00:1EC9, drawn), Down 09:4ADF (CD15 3: the buzzer; else CD15 + 1 and the next line,
 *  00:1EBB, drawn). */
export function* menuItem2(g: Game): Co {
  const m = g.m;
  for (;;) {
    const a = yield* chooseMember(g);
    if (a === 0xff) break;
    m.wr(0xcde6, 0x43);
    m.wr(0xcde7, 0x71);
    m.wr(0xcd15, 0);
    farSync(g, 0x0f, () => oamHold(g));
    m.wr(0xc080, 0x20);
    m.wr(0xc081, 0x10);
    yield* item2Show(g);
    yield* menuInput(g, function* (i) {
      switch (i) {
        case 0: yield* item2A(g); return false;
        case 1: return true; // 09:4A7B: pop hl; pop hl; jr $4A4A
        case 4: case 5: m.wr(0xc081, m.rd(0xc081) ^ 0x48); return false;
        case 6: { // 09:4AB8
          const k = m.rd(0xcd15);
          if (!k) { yield* soundBuzz(g); return false; }
          m.wr(0xcd15, k - 1);
          yield* item2Line(g, prevLines(g, m.rd16(0xcde6), 1));
          return false;
        }
        case 7: { // 09:4ADF
          const k = m.rd(0xcd15);
          if (k === 0x03) { yield* soundBuzz(g); return false; }
          m.wr(0xcd15, k + 1);
          yield* item2Line(g, nextLines(g, m.rd16(0xcde6), 1));
          return false;
        }
        default: yield* soundBuzz(g); return false; // 2, 3: 00:1E83
      }
    });
  }
  m.wr(0xcd15, 0x02);
}
