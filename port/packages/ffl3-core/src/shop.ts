/** Legend III shops, clinics and inns (01:6FD4, entered with bank 01 selected: from event 17
 *  00:19AE through `rst $18 ; farcall`, and from 00:0A2F by `jp`). CA2F = the shop index - 1, bit 7
 *  set for the shops that also take the third option (and, at index 0 with bit 7, the item 3C in a
 *  member's weapon slot exchanged for 3B first: 0C:7F63). CE2A = CA2F & 7F picks the kind:
 *   - 00-3F, a shop: its record of 6 bytes (01:7804: four groups of 16 records of 4-6 item ids,
 *     FF the end) -> CE2B; the menu screen (09:40D3), the main menu (Exit, Buy, Sell and, with
 *     CA2F bit 7, a third option: 00-1F a forge (two materials D7 / D6 for one of the four items
 *     of 01:77F4 / 01:77FC), 20-3F a mix (two of the items D2-D5 make one of 01:77E4));
 *   - 40-4F, a clinic: the missing HP and MP of the party (01:7731) is the price, Yes heals the
 *     party (01:7701);
 *   - 50 and above, a service: a 2-byte script reference of 01:7950 (-> CE2B) told (00:2EF8).
 *  The money is GP C6E0-C6E2 (24-bit, at most 999999 = 0F423F, 01:77CA); prices (00:2E54) are
 *  the words of 01:7E4F for the items below D2 (CE7C-CE7E). The cursor is C080 (y) / C081 (x),
 *  saved at CE39 / CE3A while a message waits (01:77CD / 01:77DB). The menu screen closes with
 *  01:7023 (fieldmenu.ts menuClose). Every routine here runs with bank 01 selected (its tables
 *  are read from the current bank); the texts are in bank 09. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, copyB, fill, far0, far0Sync, farcall, farSync, pushBank, popBank, vramCopy, fadeIn, fadeOut,
  textBegin, textEnd, soundOk, soundBuzz, memberOffset, wait1 } from "./sys.js";
import { NotPorted } from "./irq.js";
import { menuInput, windowTop } from "./title.js";
import { menu } from "./menu.js";
import { printText } from "./text.js";
import { oamClear } from "./names.js";
import { resetSprites, memberLimit } from "./sprites.js";
import { equipStats, wornOutBack } from "./equip.js";
import { waitAB, listScrollDown, listScrollUp } from "./menuitems.js";
import { listCursorsOff, menuClose } from "./fieldmenu.js";
import { scriptRef } from "./events.js";
import { windowClose } from "./window.js";

const swap = (a: number): number => ((a << 4) | (a >> 4)) & 0xff;

// ---------------------------------------------------------------- helpers of other banks

/** 0B:706C — one of item CE91 taken from the bag C6FF (0x18 pairs id, count): not found or a
 *  count of 0: CE91 = FF; else the count - 1. Returns hl as left (the count's address when
 *  found; C72F when not). */
function bagTake(m: Memory): number {
  const a = m.rd(0xce91);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (a === m.rd(hl)) {
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
 *  the first free pair (FF) = CE94, 1; none: CE94 = FF. */
function bagPut(m: Memory): void {
  const id = m.rd(0xce94);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--, hl += 2) {
    if (m.rd(hl) !== id) continue;
    const n = m.rd(hl + 1);
    if (n >= 0x09) { m.wr(0xce94, 0xff); return; }
    m.wr(hl + 1, n + 1);
    return;
  }
  hl = 0xc6ff;
  for (let b = 0x18; b; b--, hl += 2) {
    if (m.rd(hl) !== 0xff) continue;
    m.wr(hl, m.rd(0xce94));
    m.wr(hl + 1, 0x01);
    return;
  }
  m.wr(0xce94, 0xff);
}

/** 0F:7A2E — wait (a frame at a time, 00:358B) for a new press (FF8B) of a button of c (another
 *  one buzzes, 00:1E83), then the cursor sound (00:1E7C). Returns the press & c. */
function* waitKeys(g: Game, c: number): Co<number> {
  const m = g.m;
  for (;;) {
    yield* wait1(g);
    const a = m.hram[0x0b]!;
    if (!a) continue;
    if (a & c) { soundOk(m); return a & c; }
    yield* soundBuzz(g);
  }
}

/** 0F:7A24 — wait for any button (0F:7A2E with c = FF). */
function* waitAny(g: Game): Co<number> {
  return yield* waitKeys(g, 0xff);
}

/** 0C:7F63 — CA2F 80 only: the first of members 0-3 (C540 + 60 k) whose weapon slot holds item
 *  3C gets 3B instead: CE26 = 3C, CD36 = the member, CE25 = 1 and the stats of 3C off (0B:7124),
 *  CE25 = 0, CE26 = CE91 = 3B and its stats on (0B:7124), one 3B taken from the bag (0B:706C), the
 *  worn-out weapons and the empty bag pairs (0B:6683). */
function weaponExchange(g: Game): void {
  const m = g.m;
  if (m.rd(0xca2f) !== 0x80) return;
  let hl = 0xc540;
  let b = 0x04;
  for (;;) {
    if (m.rd(hl) === 0x3c) break;
    hl = (hl + 0x60) & 0xffff;
    b = (b - 1) & 0xff;
    if (!b) return;
  }
  m.wr(hl, (m.rd(hl) - 1) & 0xff);
  m.wr(0xce26, 0x3c);
  m.wr(0xcd36, (0x04 - b) & 0xff);
  m.wr(0xce25, 0x01);
  farSync(g, 0x0b, () => equipStats(g));
  m.wr(0xce25, 0x00);
  m.wr(0xce26, 0x3b);
  m.wr(0xce91, 0x3b);
  farSync(g, 0x0b, () => equipStats(g));
  farSync(g, 0x0b, () => bagTake(m));
  farSync(g, 0x0b, () => wornOutBack(g));
}

/** 00:1D52 — bank 0C pushed, 0C:7F63, popped. */
function exchangeCheck(g: Game): void {
  pushBank(g, 0x0c);
  weaponExchange(g);
  popBank(g);
}

/** 00:2E54 — the price of item a: CE7C-CE7E = 0; below D2 the word 01:7E4F + 2a (bank 01
 *  pushed) -> CE7C / CE7D. */
function itemPrice(g: Game, a: number): void {
  const m = g.m;
  pushBank(g, 0x01);
  m.wr(0xce7c, 0);
  m.wr(0xce7d, 0);
  m.wr(0xce7e, 0);
  if (a < 0xd2) {
    const hl = (0x7e4f + 2 * a) & 0xffff;
    m.wr(0xce7c, m.rd(hl));
    m.wr(0xce7d, m.rd((hl + 1) & 0xffff));
  }
  popBank(g);
}

// ---------------------------------------------------------------- the menu screen (09:40D3)

/** 0B:7D60 — the menu frame tiles composed in VRAM: tile 9D (90D0) -> 90E0, tile 9C (90C0) ->
 *  90F0; then the 64 bytes 9040-907F = (90C0 + i & mask) | (9080 + i), the mask 0B:7DAA[i / 2].
 *  (As fieldmenu.ts, not exported there.) */
function frameTilesCompose(g: Game): void {
  const m = g.m;
  let de = 0x90e0;
  [, de] = far0Sync(g, 0, () => vramCopy(m, 0x90d0, de, 0x10));
  far0Sync(g, 0, () => vramCopy(m, 0x90c0, de, 0x10));
  for (let i = 0; i < 0x20; i++) {
    const c = m.rd(0x7daa + i);
    for (let j = 0; j < 2; j++) {
      const off = 2 * i + j;
      m.wr(0x9040 + off, (m.rd(0x90c0 + off) & c) | m.rd(0x9080 + off));
    }
  }
}

/** 0B:7CCD — di; the frame tiles 03:48A0 -> 9080 (0x60 bytes), composed (0B:7D60); reti. */
function* frameTiles(g: Game): Co {
  const m = g.m;
  g.ime = false;
  far0Sync(g, 0x03, () => vramCopy(m, 0x48a0, 0x9080, 0x60));
  frameTilesCompose(g);
  yield* g.reti();
}

/** 09:40D3 — the menu screen: fade out (00:39F3), the bracket with CD3D (00:1D98), the window at
 *  the top (0B:6D04), the sprites reset (09:40E8), C089 = C08D = 8, the frame tiles (0B:7CCD).
 *  (As fieldmenu.ts, not exported there.) */
function* menuScreen(g: Game): Co {
  const m = g.m;
  yield* fadeOut(g);
  yield* textBegin(g);
  farSync(g, 0x0b, () => windowTop(g));
  yield* farcall(g, 0x09, () => resetSprites(g));
  m.wr(0xc089, 0x08);
  m.wr(0xc08d, 0x08);
  yield* farcall(g, 0x0b, () => frameTiles(g));
}

// ---------------------------------------------------------------- texts and boxes

/** 01:76D8 — the text hl (bank 09, mode 04) in the box (1, d) 18 x 2. */
function* textAt(g: Game, hl: number, d: number): Co {
  yield* far0(g, 0x09, () => printText(g, 0x04, hl, ((d & 0xff) << 8) | 0x01, 0x0212));
}

/** 01:76E2 — the message a of the kind (CE2A below 40: the table 01:795C, else 01:796A; bank 09,
 *  mode 04) in the box (1, d) 18 x 4. */
function* message(g: Game, a: number, d: number): Co {
  const m = g.m;
  const c = (a * 2) & 0xff;
  const t = m.rd(0xce2a) < 0x40 ? 0x795c : 0x796a;
  const hl = m.rd16((t + c) & 0xffff);
  yield* far0(g, 0x09, () => printText(g, 0x04, hl, ((d & 0xff) << 8) | 0x01, 0x0412));
}

/** 01:710C — the message box cleared: the text 09:76C5 (mode 24) in the box (1,1) 18 x 4. */
function* messageClear(g: Game): Co {
  yield* far0(g, 0x09, () => printText(g, 0x24, 0x76c5, 0x0101, 0x0412));
}

/** 01:7159 — the text word CDE6 / CDE7 into the descriptor just copied (de - 3, de - 2); de
 *  back. */
function listText(m: Memory, de: number): number {
  de = (de - 3) & 0xffff;
  m.wr(de, m.rd(0xcde6));
  de = (de + 1) & 0xffff;
  m.wr(de, m.rd(0xcde7));
  return (de + 2) & 0xffff;
}

/** 01:711A — the shop boxes -> C8B0: the two of 01:7168 (14 bytes, 00:1F6C); the cursor C080
 *  below 40 (the main menu): the list box 01:717D (with the text CDE6, 01:7159) before the
 *  message box 01:7176 (7 bytes each, 00:1F81); else the message box first, the list box after
 *  (14 bytes); the end 01:7184 (00:1F90). No member limit (0B:6D12 z): C8B4 / C8B5 = 3C, 77. Drawn
 *  (00:1E49). */
function* shopBoxes(g: Game): Co {
  const m = g.m;
  let hl: number, de: number;
  [hl, de] = copy(m, 0x7168, 0xc8b0, 14);
  if (m.rd(0xc080) < 0x40) {
    [hl, de] = copy(m, 0x717d, de, 7);
    de = listText(m, de);
    [hl, de] = copy(m, 0x7176, de, 7);
  } else {
    [hl, de] = copy(m, 0x7176, de, 14);
    de = listText(m, de);
  }
  copy(m, 0x7184, de, 2);
  if (!farSync(g, 0x0b, () => memberLimit(m))) {
    m.wr(0xc8b4, 0x3c);
    m.wr(0xc8b5, 0x77);
  }
  yield* menu(g);
}

/** 01:77CD — the cursor C080 / C081 kept at CE39 / CE3A (00:1F90), C080 = 0. */
function cursorSave(m: Memory): void {
  copy(m, 0xc080, 0xce39, 2);
  m.wr(0xc080, 0x00);
}

/** 01:77DB — the cursor back from CE39 / CE3A (00:1F90). */
function cursorBack(m: Memory): void {
  copy(m, 0xce39, 0xc080, 2);
}

/** 01:70B1 — a list set up: the list cursors off (0F:78B2), CDE6 / CDE7 = 76FD (the shop's item
 *  list text), CD15 = 0, the cursor C080 / C081 = 48, 18. */
function listSetup(g: Game): void {
  const m = g.m;
  farSync(g, 0x0f, () => listCursorsOff(m));
  m.wr(0xcde6, 0xfd);
  m.wr(0xcde7, 0x76);
  m.wr(0xcd15, 0);
  m.wr(0xc080, 0x48);
  m.wr(0xc081, 0x18);
}

/** 01:70CE — the list scrolls (CD19 = 3) with the list cursors C088 = 58, C08C = 60. */
function listScrolls(m: Memory): void {
  m.wr(0xcd19, 0x03);
  m.wr(0xc088, 0x58);
  m.wr(0xc08c, 0x60);
}

/** 01:70C8 — the buy list: a fifth item (CE2F not FF): scrolls (01:70CE); else CD19 = 0. */
function buyScrolls(m: Memory): void {
  const a = (m.rd(0xce2f) + 1) & 0xff;
  if (!a) { m.wr(0xcd19, a); return; }
  listScrolls(m);
}

// ---------------------------------------------------------------- money

/** 01:7778 — GP C6E0-C6E2 - CE7C-CE7E: not enough (carry): nothing; else the GP. Returns the
 *  carry. */
function pay(m: Memory): boolean {
  let s = m.rd(0xc6e0) - m.rd(0xce7c);
  const e = s & 0xff;
  s = m.rd(0xc6e1) - m.rd(0xce7d) - (s < 0 ? 1 : 0);
  const d = s & 0xff;
  s = m.rd(0xc6e2) - m.rd(0xce7e) - (s < 0 ? 1 : 0);
  if (s < 0) return true;
  m.wr(0xc6e2, s & 0xff);
  m.wr(0xc6e1, d);
  m.wr(0xc6e0, e);
  return false;
}

/** 01:7794 — GP C6E0-C6E2 + the word CE7C / CE7D; over 999999 (01:77CA): CE7C / CE7D less the
 *  excess (the low 16 bits) and GP = 999999 (00:1F8D). */
function earn(m: Memory): void {
  let s = m.rd(0xce7c) + m.rd(0xc6e0);
  m.wr(0xc6e0, s & 0xff);
  s = m.rd(0xce7d) + m.rd(0xc6e1) + (s >> 8);
  m.wr(0xc6e1, s & 0xff);
  if (s > 0xff) m.wr(0xc6e2, (m.rd(0xc6e2) + 1) & 0xff);
  // 01:77A4
  let t = m.rd(0xc6e0) - m.rd(0x77ca);
  const e = t & 0xff;
  t = m.rd(0xc6e1) - m.rd(0x77cb) - (t < 0 ? 1 : 0);
  const d = t & 0xff;
  t = m.rd(0xc6e2) - m.rd(0x77cc) - (t < 0 ? 1 : 0);
  if (t < 0) return;
  let u = m.rd(0xce7c) - e;
  m.wr(0xce7c, u & 0xff);
  u = m.rd(0xce7d) - d - (u < 0 ? 1 : 0);
  m.wr(0xce7d, u & 0xff);
  copy(m, 0x77ca, 0xc6e0, 3);
}

/** 01:703C — item CE94 into the bag (0B:7037): refused (CE94 FF): the buzzer (00:1E83), true (z);
 *  else the sound FFBC = 35, false. */
function* bagPutChecked(g: Game): Co<boolean> {
  const m = g.m;
  farSync(g, 0x0b, () => bagPut(m));
  if (!((m.rd(0xce94) + 1) & 0xff)) { yield* soundBuzz(g); return true; }
  m.hram[0x3c] = 0x35;
  return false;
}

// ---------------------------------------------------------------- the question (01:75E1)

/** 01:75E1 — Yes / No: the cursor kept (01:77CD), at 60, 38; the box 09:75C6 (mode 24, (6,9)
 *  8 x 2); the menu input (00:1E51): A 01:7608 (Yes when C081 is 38), B 01:7611 (No), Right /
 *  Left 01:7619 (C081 ^ 60), the others the buzzer; the cursor back (01:77DB). Returns true for
 *  Yes (the z of the original). */
function* askYes(g: Game): Co<boolean> {
  const m = g.m;
  cursorSave(m);
  m.wr(0xc080, 0x60);
  m.wr(0xc081, 0x38);
  yield* far0(g, 0x09, () => printText(g, 0x24, 0x75c6, 0x0906, 0x0208));
  let yes = false;
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: yes = m.rd(0xc081) === 0x38; cursorBack(m); return true; // 01:7608
      case 1: yes = false; cursorBack(m); return true; // 01:7611
      case 4: case 5: m.wr(0xc081, m.rd(0xc081) ^ 0x60); return false; // 01:7619
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
  return yes;
}

// ---------------------------------------------------------------- buy (01:7186)

/** 01:7255 — the buy message (01:76E2, 1, row 1). */
function* buyMessage(g: Game): Co {
  yield* message(g, 0x01, 0x01);
}

/** 01:724C — the buy list: set up (01:70B1), its scrolls (01:70C8), the boxes (01:711A), the
 *  message (01:7255). */
function* buyScreen(g: Game): Co {
  listSetup(g);
  buyScrolls(g.m);
  yield* shopBoxes(g);
  yield* buyMessage(g);
}

/** 01:71B5 — the message a (row 1) with the cursor kept (01:77CD, the boxes 01:711A), any button
 *  (0F:7A24), the cursor back (01:77DB); then 01:71EC. */
function* buyOutcome(g: Game, a: number): Co {
  const m = g.m;
  cursorSave(m);
  yield* shopBoxes(g);
  yield* message(g, a, 0x01);
  yield* farcall(g, 0x0f, () => waitAny(g));
  cursorBack(m);
  yield* buyEnd(g);
}

/** 01:71EC — the boxes (01:711A), the buy message (01:7255). */
function* buyEnd(g: Game): Co {
  yield* shopBoxes(g);
  yield* buyMessage(g);
}

/** 01:719B — A on the buy list: the item CE2B + CD15 (CE94; FF: the buzzer), its price (00:2E54)
 *  paid (01:7778): not enough: the message 2; else the question 09:75C0 (01:710C, 01:76D8,
 *  01:75E1): No: paid back (01:7794); Yes: into the bag (01:703C): refused: paid back, message 4;
 *  taken: message 3. */
function* buyA(g: Game): Co {
  const m = g.m;
  const a = m.rd((0xce2b + m.rd(0xcd15)) & 0xffff);
  m.wr(0xce94, a);
  if (a === 0xff) { yield* soundBuzz(g); return; }
  itemPrice(g, a);
  if (pay(m)) { yield* buyOutcome(g, 0x02); return; }
  yield* messageClear(g);
  yield* textAt(g, 0x75c0, 0x01);
  if (!(yield* askYes(g))) {
    earn(m); // 01:71E9
    yield* buyEnd(g);
    return;
  }
  if (yield* bagPutChecked(g)) {
    earn(m); // 01:71E2
    yield* buyOutcome(g, 0x04);
    return;
  }
  yield* buyOutcome(g, 0x03);
}

/** 01:71F2 — Up on the buy list: CD15 - 1 with the cursor C080 - 10 (at 48 the list scrolled up,
 *  00:34E0 with a = b = 6); at the top: four items (CE2F FF): CD15 = 3, C080 = 78; else the
 *  buzzer. */
function* buyUp(g: Game): Co {
  const m = g.m;
  const n = m.rd(0xcd15);
  if (n) {
    m.wr(0xcd15, n - 1);
    const a = m.rd(0xc080);
    if (a !== 0x48) { m.wr(0xc080, (a - 0x10) & 0xff); return; }
    yield* listScrollUp(g, 0x06, 0x06);
    return;
  }
  if ((m.rd(0xce2f) + 1) & 0xff) { yield* soundBuzz(g); return; }
  m.wr(0xcd15, 0x03);
  m.wr(0xc080, 0x78);
}

/** 01:721B — Down on the buy list: the last row b = 3 (CE2F FF) or 5; CD15 + 1 with the cursor
 *  C080 + 10 (at 78 the list scrolled down, 00:3470 with a = b = 6); at the last row: 3: CD15 =
 *  0, C080 = 48; 5: the buzzer. */
function* buyDown(g: Game): Co {
  const m = g.m;
  const b = (m.rd(0xce2f) + 1) & 0xff ? 0x05 : 0x03;
  const n = m.rd(0xcd15);
  if (n === b) {
    if (n !== 0x03) { yield* soundBuzz(g); return; }
    m.wr(0xcd15, 0);
    m.wr(0xc080, 0x48);
    return;
  }
  m.wr(0xcd15, (n + 1) & 0xff);
  const a = m.rd(0xc080);
  if (a !== 0x78) { m.wr(0xc080, (a + 0x10) & 0xff); return; }
  yield* listScrollDown(g, 0x06, 0x06);
}

/** 01:7186 — Buy: the list (01:724C), the menu input (00:1E51): A 01:719B, B leaves, Up 01:71F2,
 *  Down 01:721B, the others the buzzer. */
function* buy(g: Game): Co {
  yield* buyScreen(g);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: yield* buyA(g); return false;
      case 1: return true; // 00:1E79
      case 6: yield* buyUp(g); return false;
      case 7: yield* buyDown(g); return false;
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
}

// ---------------------------------------------------------------- sell (01:725C)

/** 01:7335 — the sell message (01:76E2, 5, row 1). */
function* sellMessage(g: Game): Co {
  yield* message(g, 0x05, 0x01);
}

/** 01:7324 — the bag list: set up (01:70B1), scrolling (01:70CE), CDE6 / CDE7 = 7033 (the bag's
 *  list text), the boxes (01:711A), the message (01:7335). */
function* sellScreen(g: Game): Co {
  const m = g.m;
  listSetup(g);
  listScrolls(m);
  m.wr(0xcde6, 0x33);
  m.wr(0xcde7, 0x70);
  yield* shopBoxes(g);
  yield* sellMessage(g);
}

/** 01:72D8 — the boxes (01:711A), the sell message (01:7335). */
function* sellEnd(g: Game): Co {
  yield* shopBoxes(g);
  yield* sellMessage(g);
}

/** 01:7271 — A on the bag list: the pair C6FF + 2 CD15 (CD28 / CD29 = its address; CE94 = its
 *  item, FF: the buzzer); its price (00:2E54): none: the text 09:75CE and A or B (0F:7A2C); else
 *  halved and earned at once (01:7794), the text 09:75DA, the message 6 (row 3), the question
 *  (01:75E1): No: paid back (01:7778); Yes: its count - 1 (0: the pair FF FF), the message 3 with
 *  the cursor kept and any button (0F:7A24). */
function* sellA(g: Game): Co {
  const m = g.m;
  const p = (0xc6ff + ((m.rd(0xcd15) * 2) & 0xff)) & 0xffff;
  m.wr(0xcd28, p & 0xff);
  m.wr(0xcd29, p >> 8);
  const a = m.rd(p);
  m.wr(0xce94, a);
  if (a === 0xff) { yield* soundBuzz(g); return; }
  itemPrice(g, a);
  if (!(m.rd(0xce7c) | m.rd(0xce7d))) {
    // 01:72DE
    yield* messageClear(g);
    yield* textAt(g, 0x75ce, 0x01);
    yield* farcall(g, 0x0f, () => waitAB(g));
    yield* sellEnd(g);
    return;
  }
  const hi = m.rd(0xce7d);
  m.wr(0xce7d, hi >> 1);
  m.wr(0xce7c, ((m.rd(0xce7c) >> 1) | ((hi & 1) << 7)) & 0xff);
  earn(m);
  yield* messageClear(g);
  yield* textAt(g, 0x75da, 0x01);
  yield* message(g, 0x06, 0x03);
  if (!(yield* askYes(g))) {
    pay(m); // 01:72D5
    yield* sellEnd(g);
    return;
  }
  const hl = (m.rd16(0xcd28) + 1) & 0xffff;
  let n = (m.rd(hl) - 1) & 0xff;
  m.wr(hl, n);
  if (!n) {
    n = (n - 1) & 0xff;
    m.wr(hl, n);
    m.wr((hl - 1) & 0xffff, 0xff);
  }
  // 01:72C1
  cursorSave(m);
  yield* shopBoxes(g);
  yield* message(g, 0x03, 0x01);
  yield* farcall(g, 0x0f, () => waitAny(g));
  cursorBack(m);
  yield* sellEnd(g);
}

/** 01:72ED — Up on the bag list: CD15 0: the buzzer; else - 1 with the cursor C080 - 10 (at 48
 *  the list scrolled up, 00:34E0 with a = b = 6). */
function* sellUp(g: Game): Co {
  const m = g.m;
  const n = m.rd(0xcd15);
  if (!n) { yield* soundBuzz(g); return; }
  m.wr(0xcd15, n - 1);
  const a = m.rd(0xc080);
  if (a !== 0x48) { m.wr(0xc080, (a - 0x10) & 0xff); return; }
  yield* listScrollUp(g, 0x06, 0x06);
}

/** 01:7308 — Down on the bag list: CD15 17: the buzzer; else + 1 with the cursor C080 + 10 (at 78
 *  the list scrolled down, 00:3470 with a = b = 6). */
function* sellDown(g: Game): Co {
  const m = g.m;
  const n = m.rd(0xcd15);
  if (n === 0x17) { yield* soundBuzz(g); return; }
  m.wr(0xcd15, (n + 1) & 0xff);
  const a = m.rd(0xc080);
  if (a !== 0x78) { m.wr(0xc080, (a + 0x10) & 0xff); return; }
  yield* listScrollDown(g, 0x06, 0x06);
}

/** 01:725C — Sell: the bag list (01:7324), the menu input (00:1E51): A 01:7271, B leaves, Up
 *  01:72ED, Down 01:7308, the others the buzzer. */
function* sell(g: Game): Co {
  yield* sellScreen(g);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: yield* sellA(g); return false;
      case 1: return true; // 00:1E79
      case 6: yield* sellUp(g); return false;
      case 7: yield* sellDown(g); return false;
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
}

// ---------------------------------------------------------------- the forge (01:733C, CE2A 00-1F)

/** 01:744B — the forge texts 09:75E7 (row 1) and 09:75F9 (row 3). */
function* forgeTexts(g: Game): Co {
  yield* textAt(g, 0x75e7, 0x01);
  yield* textAt(g, 0x75f9, 0x03);
}

/** 01:742A — the forge: its four (item, costs) pairs 01:77F4 (CE2A below 10) or 01:77FC -> CE31
 *  (8 bytes, 00:1F7E), a list set up (01:70B1), CDE6 / CDE7 = 774D, the boxes (01:711A), the
 *  texts (01:744B). */
function* forgeScreen(g: Game): Co {
  const m = g.m;
  const hl = m.rd(0xce2a) < 0x10 ? 0x77f4 : 0x77fc;
  copy(m, hl, 0xce31, 8);
  listSetup(g);
  m.wr(0xcde6, 0x4d);
  m.wr(0xcde7, 0x77);
  yield* shopBoxes(g);
  yield* forgeTexts(g);
}

/** 01:73F6 — CE91 = a, one taken from the bag (0B:706C); found: put back (the count + 1) and a
 *  = the count, else a = 0; returns a - b, its borrow, and hl (the count's address as 0B:706C
 *  left it). */
function material(g: Game, a: number, b: number): { a: number; c: boolean; hl: number } {
  const m = g.m;
  m.wr(0xce91, a);
  const hl = farSync(g, 0x0b, () => bagTake(m));
  a = (m.rd(0xce91) + 1) & 0xff;
  if (a) {
    m.wr(hl, (m.rd(hl) + 1) & 0xff);
    a = m.rd(hl);
  }
  return { a: (a - b) & 0xff, c: a < b, hl };
}

/** 01:73DB — the materials: D7 less CE84 and D6 less CE88 (01:73F6); either short: carry, the
 *  bag untouched; else both counts lowered. Returns the carry and the two count addresses (hl:
 *  D6, de: D7). */
function materials(g: Game): { c: boolean; hl: number; de: number } {
  const m = g.m;
  const r1 = material(g, 0xd7, m.rd(0xce84));
  if (r1.c) return { c: true, hl: r1.hl, de: 0 };
  const c = r1.a;
  const r2 = material(g, 0xd6, m.rd(0xce88));
  const de = r1.hl;
  if (r2.c) return { c: true, hl: r2.hl, de };
  m.wr(r2.hl, r2.a);
  m.wr(de, c);
  return { c: false, hl: r2.hl, de };
}

/** 01:73A7 — the message a (row 1) after the boxes (01:711A); 01:73B1: any button (0F:7A24), the
 *  cursor back (01:77DB); 01:73D5: the boxes (01:711A), the texts (01:744B). */
function* forgeOutcome(g: Game, a: number): Co {
  yield* shopBoxes(g);
  yield* message(g, a, 0x01);
  yield* forgeWait(g);
}

/** 01:73B1 — any button (0F:7A24), the cursor back (01:77DB), then 01:73D5. */
function* forgeWait(g: Game): Co {
  yield* farcall(g, 0x0f, () => waitAny(g));
  cursorBack(g.m);
  yield* forgeEnd(g);
}

/** 01:73D5 — the boxes (01:711A), the texts (01:744B). */
function* forgeEnd(g: Game): Co {
  yield* shopBoxes(g);
  yield* forgeTexts(g);
}

/** 01:7359 — A on the forge list: CE84-CE8B = 0 (00:1F51), the pair CE31 + 2 CD15: CE94 = the
 *  item, CE84 / CE88 = the high / low nibble of its costs; the texts 09:7605 (row 1), 09:7614
 *  (row 3), the question (01:75E1): No: 01:73D5; Yes: the cursor kept (01:77CD), the materials
 *  (01:73DB): short: the text 09:7625; else into the bag (01:703C): refused: the materials back,
 *  message 4; taken: the empty pairs (0B:6683), message 3. */
function* forgeA(g: Game): Co {
  const m = g.m;
  fill(m, 0xce84, 8, 0);
  const p = (0xce31 + ((m.rd(0xcd15) * 2) & 0xff)) & 0xffff;
  m.wr(0xce94, m.rd(p));
  const v = m.rd((p + 1) & 0xffff);
  m.wr(0xce84, swap(v) & 0x0f);
  m.wr(0xce88, v & 0x0f);
  yield* messageClear(g);
  yield* textAt(g, 0x7605, 0x01);
  yield* textAt(g, 0x7614, 0x03);
  if (!(yield* askYes(g))) { yield* forgeEnd(g); return; }
  cursorSave(m);
  const r = materials(g);
  if (r.c) {
    // 01:73C8
    yield* shopBoxes(g);
    yield* textAt(g, 0x7625, 0x01);
    yield* forgeWait(g);
    return;
  }
  if (yield* bagPutChecked(g)) {
    // 01:73B8
    m.wr(r.hl, (m.rd(0xce88) + m.rd(r.hl)) & 0xff);
    m.wr(r.de, (m.rd(0xce84) + m.rd(r.de)) & 0xff);
    yield* forgeOutcome(g, 0x04);
    return;
  }
  farSync(g, 0x0b, () => wornOutBack(g));
  yield* forgeOutcome(g, 0x03);
}

/** 01:7413 — CD15 = a, the cursor C080 = 48 + 10 a. */
function forgeRow(m: Memory, a: number): void {
  m.wr(0xcd15, a);
  m.wr(0xc080, (swap(a) + 0x48) & 0xff);
}

/** 01:7407 — Up on the forge list: CD15 - 1, 0 -> 3 (01:7413). */
function forgeUp(m: Memory): void {
  const a = m.rd(0xcd15);
  forgeRow(m, a ? a - 1 : 0x03);
}

/** 01:741C — Down on the forge list: CD15 + 1, 3 -> 0 (01:7413). */
function forgeDown(m: Memory): void {
  const a = m.rd(0xcd15);
  forgeRow(m, a === 0x03 ? 0 : a + 1);
}

/** 01:733C — the third option: CE2A 20 and above: the mix (01:745B); else the forge (01:742A)
 *  and the menu input (00:1E51): A 01:7359, B leaves, Up 01:7407, Down 01:741C, the others the
 *  buzzer. */
function* third(g: Game): Co {
  const m = g.m;
  if (m.rd(0xce2a) >= 0x20) { yield* mix(g); return; }
  yield* forgeScreen(g);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: yield* forgeA(g); return false;
      case 1: return true; // 00:1E79
      case 6: forgeUp(m); return false;
      case 7: forgeDown(m); return false;
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
}

// ---------------------------------------------------------------- the mix (01:745B, CE2A 20-3F)

/** 01:75A6 — the text 09:7679 (mode 04) in the box (17,6) 1 x 8. */
function* mixMarks(g: Game): Co {
  yield* far0(g, 0x09, () => printText(g, 0x04, 0x7679, 0x0611, 0x0801));
}

/** 01:75B4 — the mix boxes 01:75C3 (0x1E bytes, 00:1F97) -> C8B0, drawn (00:1E49), then
 *  01:75A6. */
function* mixBoxes(g: Game): Co {
  const m = g.m;
  far0Sync(g, 0, () => copyB(m, 0x75c3, 0xc8b0, 0x1e));
  yield* menu(g);
  yield* mixMarks(g);
}

/** 01:7596 — the mix texts 09:7635 (row 1) and 09:7643 (row 3). */
function* mixTexts(g: Game): Co {
  yield* textAt(g, 0x7635, 0x01);
  yield* textAt(g, 0x7643, 0x03);
}

/** 01:7584 — the mix screen: CE3B = 0, the objects hidden (00:20CF), the cursor 48, 50, the boxes
 *  (01:75B4), the texts (01:7596). */
function* mixScreen(g: Game): Co {
  const m = g.m;
  m.wr(0xce3b, 0);
  oamClear(g);
  m.wr(0xc080, 0x48);
  m.wr(0xc081, 0x50);
  yield* mixBoxes(g);
  yield* mixTexts(g);
}

/** 01:757B — the first pick CE40 back into the bag (CE94, 0B:7037). */
function mixBackFirst(g: Game): void {
  const m = g.m;
  m.wr(0xce94, m.rd(0xce40));
  farSync(g, 0x0b, () => bagPut(m));
}

/** 01:7573 — both picks back into the bag: CE41 (0B:7037), then CE40 (01:757B). */
function mixBackBoth(g: Game): void {
  const m = g.m;
  m.wr(0xce94, m.rd(0xce41));
  farSync(g, 0x0b, () => bagPut(m));
  mixBackFirst(g);
}

/** 01:74D8 — the cursor kept (01:77CD), any button (0F:7A24), the cursor back (01:77DB), the
 *  boxes (01:75B4), the texts (01:7596). */
function* mixWait(g: Game): Co {
  const m = g.m;
  cursorSave(m);
  yield* farcall(g, 0x0f, () => waitAny(g));
  cursorBack(m);
  yield* mixBoxes(g);
  yield* mixTexts(g);
}

/** 01:74D5 — both picks back (01:7573), then 01:74D8. */
function* mixReturn(g: Game): Co {
  mixBackBoth(g);
  yield* mixWait(g);
}

/** 01:7470 — A on the mix list: the item D2 + the row (C080 48-78) -> CE91, CE3C, taken from the
 *  bag (0B:706C; not there: the buzzer); CE40 + CE3B = it, the text 09:7630 at row 8 (first) or
 *  C (second), the marks (01:75A6); CE3B = CE3B + 1 & 1. The second pick: the message box
 *  cleared (01:710C), the result 01:77E4 [4 (CE41 - D2) + CE40 - D2]: none: the texts 09:7654 /
 *  09:7666 and the picks back (01:74D5); else CE3C = it, the text 09:7631 (box (12,15) 6 x 2), the
 *  text 09:7673 and the question (01:75E1): No: the picks back, the boxes, the texts; Yes: the
 *  cursor kept, the boxes (01:75B4), CE94 = CE3C into the bag (01:703C): refused: message 4 and
 *  the picks back (01:74D5); taken: the empty pairs (0B:6683), message 3 (01:74D8). */
function* mixA(g: Game): Co {
  const m = g.m;
  let a = ((swap((m.rd(0xc080) - 0x48) & 0xff)) + 0xd2) & 0xff;
  m.wr(0xce91, a);
  m.wr(0xce3c, a);
  farSync(g, 0x0b, () => bagTake(m));
  a = (m.rd(0xce91) + 1) & 0xff;
  if (!a) { yield* soundBuzz(g); return; }
  const b = (a - 1) & 0xff;
  const k = m.rd(0xce3b);
  m.wr((0xce40 + k) & 0xffff, b);
  yield* textAt(g, 0x7630, k ? 0x0c : 0x08);
  yield* mixMarks(g);
  const n = (m.rd(0xce3b) + 1) & 0x01;
  m.wr(0xce3b, n);
  if (n) return;
  yield* messageClear(g);
  const i = ((((m.rd(0xce41) - 0xd2) * 4) & 0xff) + ((m.rd(0xce40) - 0xd2) & 0xff)) & 0xff;
  const r = m.rd((0x77e4 + i) & 0xffff);
  if (!r) {
    yield* textAt(g, 0x7654, 0x01);
    yield* textAt(g, 0x7666, 0x03);
    yield* mixReturn(g);
    return;
  }
  // 01:74E6
  m.wr(0xce3c, r);
  yield* far0(g, 0x09, () => printText(g, 0x04, 0x7631, 0x0f0c, 0x0206));
  yield* textAt(g, 0x7673, 0x01);
  if (!(yield* askYes(g))) {
    // 01:7531
    mixBackBoth(g);
    yield* mixBoxes(g);
    yield* mixTexts(g);
    return;
  }
  cursorSave(m);
  yield* mixBoxes(g);
  m.wr(0xce94, m.rd(0xce3c));
  if (!(yield* bagPutChecked(g))) {
    // 01:7522
    farSync(g, 0x0b, () => wornOutBack(g));
    yield* message(g, 0x03, 0x01);
    cursorBack(m);
    yield* mixWait(g);
    return;
  }
  yield* message(g, 0x04, 0x01);
  cursorBack(m);
  yield* mixReturn(g);
}

/** 01:753A — B on the mix list: no pick yet: leaves (true); else CE3B = 0, the text 09:7651 at
 *  row 8, the first pick back (01:757B), the marks (01:75A6). */
function* mixB(g: Game): Co<boolean> {
  const m = g.m;
  if (!m.rd(0xce3b)) return true; // 01:7552
  m.wr(0xce3b, 0);
  yield* textAt(g, 0x7651, 0x08);
  mixBackFirst(g);
  yield* mixMarks(g);
  return false;
}

/** 01:7555 — Up on the mix list: C080 48 -> 78, else - 10. */
function mixUp(m: Memory): void {
  const a = m.rd(0xc080);
  m.wr(0xc080, a === 0x48 ? 0x78 : (a - 0x10) & 0xff);
}

/** 01:7564 — Down on the mix list: C080 78 -> 48, else + 10. */
function mixDown(m: Memory): void {
  const a = m.rd(0xc080);
  m.wr(0xc080, a === 0x78 ? 0x48 : (a + 0x10) & 0xff);
}

/** 01:745B — the mix: the screen (01:7584), the menu input (00:1E51): A 01:7470, B 01:753A, Up
 *  01:7555, Down 01:7564, the others the buzzer. */
function* mix(g: Game): Co {
  const m = g.m;
  yield* mixScreen(g);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: yield* mixA(g); return false;
      case 1: return yield* mixB(g);
      case 6: mixUp(m); return false;
      case 7: mixDown(m); return false;
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
}

// ---------------------------------------------------------------- the shop's main menu (01:704A)

/** 01:70E2 — the main menu: a list set up (01:70B1), the cursor 30, 38, CD15 = 1, the boxes
 *  (01:711A), the message 0 (row 1), the options text 09:7557 (CA2F bit 7: 09:7566) at row 3. */
function* mainScreen(g: Game): Co {
  const m = g.m;
  listSetup(g);
  m.wr(0xc080, 0x30);
  m.wr(0xc081, 0x38);
  m.wr(0xcd15, 0x01);
  yield* shopBoxes(g);
  yield* message(g, 0x00, 0x01);
  yield* textAt(g, m.rd(0xca2f) & 0x80 ? 0x7566 : 0x7557, 0x03);
}

/** 01:70A3 — the cursor x C081 = 01:70AD [CD15] (10, 38, 58, 80). */
function mainCursor(m: Memory): void {
  m.wr(0xc081, m.rd((0x70ad + m.rd(0xcd15)) & 0xffff));
}

/** 01:7077 — Right on the main menu: CD15 3 -> 0; 2 -> 3 with CA2F bit 7, else 0; else + 1;
 *  the cursor (01:70A3). */
function mainRight(m: Memory): void {
  const a = m.rd(0xcd15);
  if (a === 0x03) m.wr(0xcd15, 0);
  else if (a === 0x02 && !(m.rd(0xca2f) & 0x80)) m.wr(0xcd15, 0);
  else m.wr(0xcd15, (a + 1) & 0xff);
  mainCursor(m);
}

/** 01:7090 — Left on the main menu: CD15 - 1; 0 -> 3 with CA2F bit 7, else 2; the cursor
 *  (01:70A3). */
function mainLeft(m: Memory): void {
  const a = m.rd(0xcd15);
  if (a) m.wr(0xcd15, a - 1);
  else {
    m.wr(0xcd15, 0x03);
    if (!(m.rd(0xca2f) & 0x80)) m.wr(0xcd15, 0x02);
  }
  mainCursor(m);
}

/** 01:7062 — A on the main menu: CD15 0 (Exit) leaves (true); else the option CD15 - 1 (00:373A:
 *  01:7186 Buy, 01:725C Sell, 01:733C the third), returning to the main menu (01:70E2). */
function* mainA(g: Game): Co<boolean> {
  const a = g.m.rd(0xcd15);
  if (!a) return true; // 00:1E79
  switch (a - 1) {
    case 0: yield* buy(g); break;
    case 1: yield* sell(g); break;
    case 2: yield* third(g); break;
    default: throw new NotPorted(`01:706E (shop option ${a - 1}: past the table 01:7071)`);
  }
  yield* mainScreen(g);
  return false;
}

/** 01:704A — the shop: the main menu (01:70E2), fade in (00:3A0C), the menu input (00:1E51): A
 *  01:7062, B leaves, Right 01:7077, Left 01:7090, the others the buzzer. */
function* shop(g: Game): Co {
  const m = g.m;
  yield* mainScreen(g);
  yield* fadeIn(g);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: return yield* mainA(g);
      case 1: return true; // 00:1E79
      case 4: mainRight(m); return false;
      case 5: mainLeft(m); return false;
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
}

// ---------------------------------------------------------------- the clinic (01:7621, CE2A 40-4F)

/** 01:7726 — the word at hl + de moved to the word 2 bytes below it. */
function wordDown(m: Memory, hl: number, de: number): void {
  let p = (hl + de) & 0xffff;
  const d = m.rd(p); p = (p - 1) & 0xffff;
  const e = m.rd(p); p = (p - 1) & 0xffff;
  m.wr(p, d); p = (p - 1) & 0xffff;
  m.wr(p, e);
}

/** 01:7713 — member a, unless dead (C501 bit 6): C516 -> C514, C512 -> C510 (full points). */
function healMember(m: Memory, a: number): void {
  const hl = (memberOffset(m, a & 0x7f) + 0xc501) & 0xffff;
  if (m.rd(hl) & 0x40) return;
  wordDown(m, hl, 0x16);
  wordDown(m, hl, 0x12);
}

/** 01:7701 — every member (4; 5 with a member limit, 0B:6D12) healed (01:7713), last first. */
function healAll(g: Game): void {
  const m = g.m;
  const z = farSync(g, 0x0b, () => memberLimit(m)) === 0;
  for (let b = z ? 4 : 5; b; b--) healMember(m, b - 1);
}

/** 01:775E — CE7C-CE7E + (the word at hl + de - 1 less the word at hl + de - 3). */
function missingAdd(m: Memory, hl: number, de: number): void {
  const p = (hl + de) & 0xffff;
  const top = m.rd((p - 1) & 0xffff) | (m.rd(p) << 8);
  const cur = m.rd((p - 3) & 0xffff) | (m.rd((p - 2) & 0xffff) << 8);
  const v = (top - cur) & 0xffff;
  let s = (v & 0xff) + m.rd(0xce7c);
  m.wr(0xce7c, s & 0xff);
  s = (v >> 8) + m.rd(0xce7d) + (s >> 8);
  m.wr(0xce7d, s & 0xff);
  if (s > 0xff) m.wr(0xce7e, (m.rd(0xce7e) + 1) & 0xff);
}

/** 01:7731 — the clinic's price CE7C-CE7E = 0 + for each member (4; 5 with a member limit,
 *  0B:6D12; last first) not dead (C501 bit 6): C512 - C510 and C516 - C514 (01:775E). */
function clinicPrice(g: Game): void {
  const m = g.m;
  const z = farSync(g, 0x0b, () => memberLimit(m)) === 0;
  m.wr(0xce7c, 0);
  m.wr(0xce7d, 0);
  m.wr(0xce7e, 0);
  for (let b = z ? 4 : 5; b; b--) {
    const hl = (memberOffset(m, (b - 1) & 0x7f) + 0xc501) & 0xffff;
    if (m.rd(hl) & 0x40) continue;
    missingAdd(m, hl, 0x12);
    missingAdd(m, hl, 0x16);
  }
}

/** 01:7697 — the clinic boxes 01:76B0 (0x17 bytes, 00:1F97) -> C8B0; no member limit (0B:6D12
 *  z): C8BB / C8BC = CA, 76; drawn (00:1E49). */
function* clinicBoxes(g: Game): Co {
  const m = g.m;
  far0Sync(g, 0, () => copyB(m, 0x76b0, 0xc8b0, 0x17));
  if (!farSync(g, 0x0b, () => memberLimit(m))) {
    m.wr(0xc8bb, 0xca);
    m.wr(0xc8bc, 0x76);
  }
  yield* menu(g);
}

/** 01:7668 — the clinic screen: the cursor 48, 50, the boxes (01:7697), the messages 0 (row 1)
 *  and 1 (row 3) (01:768A), the Yes / No text 09:754C (mode 24, (9,6) 10 x 2; 01:767C), fade in
 *  (00:3A0C). */
function* clinicScreen(g: Game): Co {
  const m = g.m;
  m.wr(0xc080, 0x48);
  m.wr(0xc081, 0x50);
  yield* clinicBoxes(g);
  yield* message(g, 0x00, 0x01);
  yield* message(g, 0x01, 0x03);
  yield* far0(g, 0x09, () => printText(g, 0x24, 0x754c, 0x0609, 0x020a));
  yield* fadeIn(g);
}

/** 01:7639 — A at the clinic: No (C081 not 50) leaves; Yes: the price paid (01:7778): the party
 *  healed (01:7701, bank 01 far call), message 2; not enough: message 3; the objects hidden
 *  (00:20CF), the boxes (01:7697), the message at row 3, A or B (0F:7A2C); leaves. */
function* clinicA(g: Game): Co {
  const m = g.m;
  if (m.rd(0xc081) !== 0x50) return;
  let a: number;
  if (!pay(m)) {
    farSync(g, 0x01, () => healAll(g));
    a = 0x02;
  } else a = 0x03;
  oamClear(g);
  yield* clinicBoxes(g);
  yield* message(g, a, 0x03);
  yield* farcall(g, 0x0f, () => waitAB(g));
}

/** 01:7621 — the clinic: the price (01:7731), the screen (01:7668), the menu input (00:1E51): A
 *  01:7639 (leaves), B leaves, Right / Left 01:7660 (C081 ^ 28), the others the buzzer. */
function* clinic(g: Game): Co {
  const m = g.m;
  clinicPrice(g);
  yield* clinicScreen(g);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: yield* clinicA(g); return true;
      case 1: return true; // 00:1E79
      case 4: case 5: m.wr(0xc081, m.rd(0xc081) ^ 0x28); return false; // 01:7660
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
}

// ---------------------------------------------------------------- the entry

/** 01:76C7 — a service (CE2A 50 and above): the bracket with CD3D (00:1D98), the script reference
 *  CE2B told (00:2EF8, mode 08), the window closed (00:35D2), the bracket left (00:1DF3). */
function* service(g: Game): Co {
  yield* textBegin(g);
  yield* scriptRef(g, 0x08, 0xce2b);
  yield* windowClose(g);
  yield* textEnd(g);
}

/** 01:6FD4 — a shop, clinic or service (bank 01 selected; CA2F = the index - 1, bit 7 the third
 *  option): the weapon exchange (00:1D52 -> 0C:7F63); CE2A = CA2F & 7F; below 40 the record
 *  01:7804 [CE2A >> 4] + 6 (CE2A & F) (00:2448), 50 and above the word 01:7950 + 2 (CE2A - 50):
 *  6 bytes -> CE2B (00:1F84). 50 and above: the service (01:76C7). Else the menu screen
 *  (09:40D3), the shop (01:704A, below 40) or the clinic (01:7621), then the screen closed
 *  (01:7023, the return address pushed at 01:7017). */
export function* shopMenu(g: Game): Co {
  const m = g.m;
  exchangeCheck(g);
  const a = m.rd(0xca2f) & 0x7f;
  m.wr(0xce2a, a);
  if (a < 0x40) {
    const de = m.rd16((0x7804 + 2 * (a >> 4)) & 0xffff);
    const hl = (de + (a & 0x0f) * 6) & 0xffff;
    copy(m, hl, 0xce2b, 6);
  } else if (a >= 0x50) {
    const hl = (0x7950 + (((a - 0x50) * 2) & 0xff)) & 0xffff;
    copy(m, hl, 0xce2b, 6);
  }
  if (m.rd(0xce2a) >= 0x50) { yield* service(g); return; }
  yield* farcall(g, 0x09, () => menuScreen(g));
  if (m.rd(0xce2a) < 0x40) yield* shop(g);
  else yield* clinic(g);
  yield* menuClose(g);
}
