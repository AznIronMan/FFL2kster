/** Legend III battle menus (bank 0B, 0B:5BDF and its callees): the window routine 0B:5BDF for its
 *  three modes (CE88: 0 the battle start, 1 a round of commands, 2 the battle end), the command
 *  menus of 0B:5DBF (a table of ten sub-menus), the target choice 0B:6718 and the battle-script
 *  natives 00:1D69 / 00:1D71 / 00:1D74 / 00:1D77 that reach them.
 *  Per-member command records CE00 + 4 k (k = CD36): +0 the command (high nibble: the menu entry,
 *  low nibble: the menu page), +1 the list position, +2 the target, +3 the item / spell.
 *  Menus run through the menu input dispatcher 00:1E51 (`menuInput`): a handler returning true
 *  is the original's `jp $1E79` / `pop hl; pop hl` (the menu left).
 *  Every routine here runs with bank 0B selected (tables of bank 0B are read from the current
 *  bank). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, farSync, farcall, far0, far0Sync, copy, copyB, fill, textBegin, textEnd, wait1,
  windowOn, windowOff, fadeOut, soundOk, soundBuzz, memberOffset } from "./sys.js";
import { NotPorted } from "./irq.js";
import { oamClear } from "./names.js";
import { windowClear } from "./newgame.js";
import { menu } from "./menu.js";
import { menuInput } from "./title.js";
import { printText } from "./text.js";
import { rst30 } from "./battle.js";
import { battleEffect } from "./banim.js";
import { memberLimit, loadSpriteTiles, partySprites } from "./sprites.js";
import { entityOffset } from "./bstats.js";
import { itemLoad } from "./bitems.js";
import { nativeRoutines } from "./bscript.js";
import { wornOutBack } from "./equip.js";

// ---------------------------------------------------------------- small helpers

/** 00:1FCD — the record offset of entity a (the table doubles a in 8 bits). */
const offsetOf = (m: Memory, a: number): number => memberOffset(m, a & 0x7f);

/** 00:1EF1 — the bit 1 << a (0 for a >= 8). */
const bitOf = (a: number): number => (a < 8 ? (1 << a) & 0xff : 0);

/** swap (nibbles). */
const swap = (a: number): number => ((a << 4) | (a >> 4)) & 0xff;

/** 0B:6072 — hl = de + 4 CD36 (a 4-byte record of the member CD36). */
function memberSlot(m: Memory, de: number): number {
  return (de + 4 * m.rd(0xcd36)) & 0xffff;
}

/** 0B:5CD9 — the command record CE00 + 4 CD36 (0B:6072 with de = CE00). */
function commandSlot(m: Memory): number {
  return memberSlot(m, 0xce00);
}

/** 0B:65DE — the status text slot CDEC + 4 CD36 (8-bit 4 CD36). */
function statusSlot(m: Memory): number {
  return (0xcdec + ((m.rd(0xcd36) * 4) & 0xff)) & 0xffff;
}

/** 0B:6705 — the cursor C080 = (a << 4 | a >> 4) + 60. */
function cursorRow(m: Memory, a: number): void {
  m.wr(0xc080, (swap(a) + 0x60) & 0xff);
}

/** 0B:66D2 — the first 20 objects of the OAM buffer hidden (y 0). */
function oamClear20(m: Memory): void {
  for (let k = 0; k < 0x14; k++) m.wr(0xc000 + 4 * k, 0);
}

/** 0B:6E65 — the 40 objects of the OAM buffer hidden (y 0). */
function oamClear40(m: Memory): void {
  for (let k = 0; k < 0x28; k++) m.wr(0xc000 + 4 * k, 0);
}

/** 0B:6C2D — the live-enemy bits CC5E | CC5F | CC60. */
function enemyBits(m: Memory): number {
  return m.rd(0xcc5e) | m.rd(0xcc5f) | m.rd(0xcc60);
}

/** 0B:6ED1 — CE95 = CE96 = 1 (returns a = 1). */
function battleFlags(m: Memory): number {
  m.wr(0xce95, 1);
  m.wr(0xce96, 1);
  return 1;
}

/** 0B:66E1 — the target CE1C, CE1C = FF. */
function takeTarget(m: Memory): number {
  const a = m.rd(0xce1c);
  m.wr(0xce1c, 0xff);
  return a;
}

/** 0F:78B2 — the list cursors off (C088 = C08C = 0). */
function listCursorsOff(m: Memory): void {
  m.wr(0xc088, 0);
  m.wr(0xc08c, 0);
}

/** 0F:7D97 — the OAM DMA held (CD39 = 1), then 00:20CF. */
function oamHold(g: Game): void {
  g.m.wr(0xcd39, 1);
  oamClear(g);
}

/** 0F:7DB4 — bit 7 of C500 + the record of CD36 (00:1FC4): returns [set, hl, a = the offset's
 *  low byte]. */
function recordBit7(m: Memory): [boolean, number, number] {
  const off = entityOffset(m);
  const hl = (off + 0xc500) & 0xffff;
  return [!!(m.rd(hl) & 0x80), hl, off & 0xff];
}

/** 0F:7D8D — bit 7 of C550 + the record of CD36 (00:1FC4). */
function bit7At50(m: Memory): boolean {
  return !!(m.rd((entityOffset(m) + 0xc550) & 0xffff) & 0x80);
}

/** 0F:7D9F — the objects of the OAM buffer (40) whose y is in [d, e) get y = 4. */
function oamHideRows(m: Memory, d: number, e: number): void {
  for (let l = 0; l < 0xa0; l += 4) {
    const a = m.rd(0xc000 + l);
    if (a >= d && a < e) m.wr(0xc000 + l, 4);
  }
}

/** 0F:7A2E — wait (a frame at a time) for a button of c (FF8B; another one buzzes), then the
 *  cursor sound (00:1E7C). 0F:7A24: c = FF; 0F:7A2C: c = 03 (A or B). */
function* waitKeys(g: Game, c: number): Co {
  const m = g.m;
  for (;;) {
    yield* wait1(g);
    const a = m.hram[0x0b]!;
    if (!a) continue;
    if (a & c) break;
    yield* soundBuzz(g);
  }
  soundOk(m);
}

/** 00:276D — up to c frames (0 = 256), cut short by A (FF8B): returns whether A ended it. */
function* pauseFrames(g: Game, c: number): Co<boolean> {
  for (;;) {
    yield* wait1(g);
    if (g.m.hram[0x0b]! & 0x01) return true;
    c = (c - 1) & 0xff;
    if (!c) return false;
  }
}

/** 00:2766 — a pause of n = [hl] frames, then n more, cut short by A. */
function* pause(g: Game, hl: number): Co {
  const n = g.m.rd(hl);
  if (!(yield* pauseFrames(g, n))) yield* pauseFrames(g, n);
}

/** 00:1EBB — from hl (bank 09), b times the next 4C (the end of a list entry); returns hl. */
function textSkip(g: Game, hl: number, b: number): number {
  const m = g.m;
  pushBank(g, 0x09);
  do {
    do hl = (hl + 1) & 0xffff; while (m.rd(hl) !== 0x4c);
    b = (b - 1) & 0xff;
  } while (b);
  popBank(g);
  return hl;
}

/** 0B:4047 — battle effect 16 (0B:4049: DE00, 02:4394 through rst $30). */
function* effect16(g: Game): Co {
  g.m.wr(0xde00, 0x16);
  yield* rst30(g, 0x02, 0x4394, () => battleEffect(g));
}

/** 0B:6C76 — the background map 9800 blank (0x800 x FF, 0F:792C). */
function backgroundClear(g: Game): void {
  farSync(g, 0x0f, () => { fill(g.m, 0x9800, 0x0800, 0xff); });
}

/** 00:29EF — the status index of member a (CD37 clear: the first set bit of C501 & FC, 1-6;
 *  CD37 set: of the entity CD36, C501 bits 7-6 -> 1-2, C502 bits 7-5 -> 7-9, C501 bits 5-2 ->
 *  3-6); 0 when none. Returns [index, hl = 6D73 + 4 index]. */
function statusIndex(m: Memory, a: number): [number, number] {
  const scan = (v: number, e: number, d: number): [boolean, number] => {
    for (;;) {
      e = (e + 1) & 0xff;
      const c = v & 0x80;
      v = (v << 1) & 0xff;
      if (c) return [true, e];
      d--;
      if (!d) return [false, e];
    }
  };
  let e: number;
  if (!m.rd(0xcd37)) {
    let v = m.rd((offsetOf(m, a) + 0xc501) & 0xffff) & 0xfc;
    if (!v) return [0, 0x6d73];
    e = 0;
    for (;;) { e++; const c = v & 0x80; v = (v << 1) & 0xff; if (c) break; }
  } else {
    const hl = (entityOffset(m) + 0xc501) & 0xffff;
    const s1 = m.rd(hl), s2 = m.rd(hl + 1);
    if (!((s1 & 0xfc) | (s2 & 0xe0))) return [0, 0x6d73];
    let f: boolean;
    [f, e] = scan(s1, 0, 2);
    if (!f) {
      [f, e] = scan(s2, 6, 3);
      if (!f) [, e] = scan((s1 << 2) & 0xff, 2, 4);
    }
  }
  return [e, (0x6d73 + 4 * e) & 0xffff];
}

// ---------------------------------------------------------------- 09:40E8

/** 09:40E8 — sprites reset: the sprite tiles (0B:7DCA), the OAM buffer C000 (36 entries at 0, 0
 *  with tiles 0-35; then 4 more with y 0); in battle (CD37) the cursor objects 09:412F (16 bytes)
 *  to C090 and three times to C050-C07F; then (09:4127) the walking figures. */
function* resetSpritesAll(g: Game): Co {
  const m = g.m;
  farSync(g, 0x0b, () => loadSpriteTiles(g, 0));
  g.ime = false;
  let hl = 0xc000;
  for (let c = 0; c < 0x24; c++) {
    m.wr(hl++, 0); m.wr(hl++, 0); m.wr(hl++, c); m.wr(hl++, 0);
  }
  for (let k = 0; k < 4; k++) { m.wr(hl, 0); hl += 4; }
  if (m.rd(0xcd37)) {
    copy(m, 0x412f, 0xc090, 16);
    copy(m, 0x412f, 0xc050, 16);
    copy(m, 0xc050, 0xc060, 16);
    copy(m, 0xc060, 0xc070, 16);
  }
  g.ime = false;
  partySprites(g, m.hram[0x13]!);
  yield* g.reti();
}

// ---------------------------------------------------------------- 0B:5BDF

/** 0B:5BDF — the battle windows by CE88 (0B:5D50 first): 0 the battle start, 1 a round of
 *  commands (0B:5BEF), 2 the battle end (0B:5CDF); modes 0 and 1 end at 0B:5C2B: the members'
 *  items (0B:5E7B), objects hidden (00:20CF), WY 8F, the window blank (01:7DFD), the bracket left
 *  (00:1DF3). */
export function* windowsAll(g: Game): Co {
  const m = g.m;
  const mode = m.rd(0xce88);
  yield* windowsBegin(g, mode);
  if (mode === 2) { yield* battleEnd(g); return; }
  if (mode !== 0) yield* commandRound(g);
  // 0B:5C2B
  itemsCheck(g);
  oamClear(g);
  m.wr(0xff4a, 0x8f);
  farSync(g, 0x01, () => windowClear(g));
  yield* textEnd(g);
}

/** 0B:5D50 — 00:1D98, CE02/CE03 + 4 k = FF (k < 5); mode 0: 0B:6ED1 -> CD37, C081, the window
 *  blank, WX 7, window on (00:3A44). Other modes (0B:5D68): unless CDC3 is FF (then CDC3 = 0) a
 *  pause of 3C frames (00:2766) when WY is 58 or 40, effect 16 (0B:4047), the window blank,
 *  8x8 sprites, the sprites reset (09:40E8), the status texts (0B:5DAE), C089 = C08D = 8; then the
 *  temporary items given back (0B:6683) and the enemy count (0B:6906). */
function* windowsBegin(g: Game, mode: number): Co {
  const m = g.m;
  yield* textBegin(g);
  for (let k = 0; k < 5; k++) { m.wr(0xce02 + 4 * k, 0xff); m.wr(0xce03 + 4 * k, 0xff); }
  if (mode === 0) {
    const a = battleFlags(m);
    m.wr(0xcd37, a);
    m.wr(0xc081, a);
    farSync(g, 0x01, () => windowClear(g));
    m.wr(0xff4b, 0x07);
    windowOn(m);
    return;
  }
  const v = (m.rd(0xcdc3) + 1) & 0xff;
  m.wr(0xcdc3, v);
  if (v) {
    m.wr(0xcdc3, (v - 1) & 0xff);
    const wy = m.rd(0xff4a);
    if (wy === 0x58 || wy === 0x40) yield* pause(g, 0x5dad);
    yield* effect16(g);
    farSync(g, 0x01, () => windowClear(g));
    m.wr(0xff40, m.rd(0xff40) & 0xfb);
    yield* farcall(g, 0x09, () => resetSpritesAll(g));
    statusTexts(g);
    m.wr(0xc089, 0x08);
    m.wr(0xc08d, 0x08);
  }
  farSync(g, 0x0b, () => wornOutBack(g));
  enemyCount(m);
}

/** 0B:5DAE — the status texts of members 4..0 (0B:65E8 with a = 0). */
function statusTexts(g: Game): void {
  for (let b = 5; b; b--) {
    g.m.wr(0xcd36, b - 1);
    statusText(g, 0);
  }
}

/** 0B:6906 — CD3E = the number of live-enemy bits (0B:6C2D). */
function enemyCount(m: Memory): void {
  let c = enemyBits(m), a = 0;
  for (let b = 0; b < 8; b++) { a += c >> 7; c = ((c << 1) | (c >> 7)) & 0xff; }
  m.wr(0xcd3e, a);
}

/** 0B:5BEF — a round of commands (WY 40): the command menu (0B:5DBF 0); cursor 60: each member
 *  (CD36 0..3, a fifth with the member limit 0B:6D12) chooses (0B:5C5A), a cancel (CDEA FF) going
 *  back to the previous member able to act (0B:5C3A) or to the menu; 70: run (FFBC = 0, D061
 *  bit 7); 80: the formation (0B:5DBF 3), then the menu again. */
function* commandRound(g: Game): Co {
  const m = g.m;
  m.wr(0xff4a, 0x40);
  let pc = 0x5bf3;
  let a = 0;
  for (;;) {
    switch (pc) {
      case 0x5bf3: {
        yield* farcall(g, 0x0b, () => menuSelect(g, 0));
        const c = m.rd(0xc080);
        if (c < 0x70) { a = 0; m.wr(0xcd36, a); pc = 0x5c14; break; }
        if (c === 0x70) {
          m.hram[0x3c] = 0;
          m.wr(0xd061, m.rd(0xd061) | 0x80);
          return;
        }
        yield* farcall(g, 0x0b, () => menuSelect(g, 3));
        break;
      }
      case 0x5c14: {
        yield* memberCommand(g, a);
        if (m.rd(0xcdea) === 0xff) { pc = 0x5c3a; break; }
        a = (m.rd(0xcd36) + 1) & 0xff;
        m.wr(0xcd36, a);
        if (a < 4) break;
        if (a !== 4) return;
        a = farSync(g, 0x0b, () => memberLimit(m));
        if (a) break;
        return;
      }
      case 0x5c3a: {
        a = m.rd(0xcd36);
        if (!a) { pc = 0x5bf3; break; }
        m.wr(0xcd36, a - 1);
        const [dead, , lo] = farSync(g, 0x0f, () => recordBit7(m));
        if (dead) break;
        [a] = statusIndex(m, lo);
        if (a === 0 || (a >= 3 && a < 7)) pc = 0x5c14;
        break;
      }
    }
  }
}

/** 0B:5C5A — the command of member CD36: none when its status index (00:29EF) is 1, 2 or 7 and
 *  above (CDEA = FE) or C500 bit 7 is set (0F:7DB4: CDEA = 3); else the command page of CE00 bit 0: page
 *  1 (0B:5DBF 1: entries 0-3 -> sub-menus 7, 4, 5, 6 by 0B:5C9D) or page 2 (0B:5DBF 2: entry 0
 *  -> 9, 1 -> 8); 4 switches the page, a cancel (FF) clears the member's command (0B:5CC7) and
 *  returns; done: the command's status text (0B:65E8 with a = 1). */
function* memberCommand(g: Game, a: number): Co {
  const m = g.m;
  [a] = statusIndex(m, a);
  if (a !== 0 && (a < 3 || a >= 7)) { m.wr(0xcdea, 0xfe); return; }
  const [dead] = farSync(g, 0x0f, () => recordBit7(m));
  if (dead) { m.wr(0xcdea, 0x03); return; }
  let pc = m.rd(commandSlot(m)) & 0x01 ? 0x5ca1 : 0x5c7f;
  for (;;) {
    if (pc === 0x5c7f) {
      commandClear(g);
      let hl = commandSlot(m);
      m.wr(hl, m.rd(hl) & 0xfe);
      a = yield* farcall(g, 0x0b, () => menuSelect(g, 1));
      if (a === 0xff) { commandClear(g); return; }
      if (a === 4) { pc = 0x5ca1; continue; }
      hl = (0x5c9d + a) & 0xffff;
      a = yield* menuSelect(g, m.rd(hl));
      if (a === 0xff) continue;
      break;
    }
    // 0B:5CA1
    commandClear(g);
    const hl = commandSlot(m);
    m.wr(hl, m.rd(hl) | 0x01);
    a = yield* farcall(g, 0x0b, () => menuSelect(g, 2));
    if (a === 0xff) { commandClear(g); return; }
    if (a === 4) { pc = 0x5c7f; continue; }
    if (a === 0) {
      yield* farcall(g, 0x0b, () => menuSelect(g, 9));
      break;
    }
    a = yield* farcall(g, 0x0b, () => menuSelect(g, 8));
    if (a === 0xff) continue;
    break;
  }
  statusText(g, 1);
}

/** 0B:5CC7 — CDD7 = (CD36 & 1 ^ 1) + 1, the status text (0B:65E8 with a = 0), the member's
 *  command undone (0B:5E93). */
function commandClear(g: Game): void {
  const m = g.m;
  m.wr(0xcdd7, ((m.rd(0xcd36) & 0x01) ^ 0x01) + 1);
  statusText(g, 0);
  commandUndo(g);
}

/** 0B:5E93 — undo the command of CD36: 11 (cover): the covered member's C561 bit 4 cleared
 *  (CE02 = FF); 01 (defend): C561 bit 5 cleared; else the item CE03 = FF given back
 *  (0B:5EA8). */
function commandUndo(g: Game): void {
  const m = g.m;
  let hl = commandSlot(m);
  const a = m.rd(hl);
  if (a === 0x11) {
    hl = (hl + 2) & 0xffff;
    const t = m.rd(hl);
    if (t === 0xff) return;
    m.wr(hl, 0xff);
    const p = (offsetOf(m, t) + 0xc561) & 0xffff;
    m.wr(p, m.rd(p) & 0xef);
    return;
  }
  if (a === 0x01) {
    const p = (entityOffset(m) + 0xc561) & 0xffff;
    m.wr(p, m.rd(p) & 0xdf);
    return;
  }
  hl = memberSlot(m, 0xce03);
  const item = m.rd(hl);
  m.wr(hl, 0xff);
  itemBack(g, item, hl);
}

/** 0B:5EA8 — an item a (C0-FE) chosen with the command 30 (record hl - 3) goes back to the
 *  inventory (CE94, 0B:7037). */
function itemBack(g: Game, a: number, hl: number): void {
  const m = g.m;
  if (a < 0xc0 || a === 0xff) return;
  m.wr(0xce94, a);
  if (m.rd((hl - 3) & 0xffff) !== 0x30) return;
  farSync(g, 0x0b, () => inventoryAdd(m));
}

/** 0B:5E7B — for members 0-4 (CD36): the item CE03 + 4 k given back (0B:5EA8). */
function itemsCheck(g: Game): void {
  const m = g.m;
  let a = 0;
  for (;;) {
    m.wr(0xcd36, a);
    const hl = memberSlot(m, 0xce03);
    itemBack(g, m.rd(hl), hl);
    a = m.rd(0xcd36);
    if (a === 4) return;
    a = (a + 1) & 0xff;
  }
}

/** 0B:7037 — the item CE94 into the inventory C6FF (24 pairs id, count): its pair counts one
 *  more (up to 9), else the first free pair (id FF) gets it with count 1; when neither, CE94 =
 *  FF. */
function inventoryAdd(m: Memory): void {
  const id = m.rd(0xce94);
  for (let hl = 0xc6ff, b = 0; b < 0x18; b++, hl += 2) {
    if (m.rd(hl) !== id) continue;
    const n = m.rd(hl + 1);
    if (n >= 0x09) { m.wr(0xce94, 0xff); return; }
    m.wr(hl + 1, n + 1);
    return;
  }
  for (let hl = 0xc6ff, b = 0; b < 0x18; b++, hl += 2) {
    if (m.rd(hl) !== 0xff) continue;
    m.wr(hl, id);
    m.wr(hl + 1, 0x01);
    return;
  }
  m.wr(0xce94, 0xff);
}

/** 0B:65E8 — the 4-byte status text CDEC + 4 CD36 (0B:65DE). a = 0: by the status index
 *  (00:29EF): 1, 2, 7 and above: 0E:6D73 + 4 index; else C500 bit 7 (0F:7DB4): 09:74A7; else the index
 *  again (3-6: 0E:6D73 + 4 index, 0: the text cleared). a != 0 (0B:661E): by the command CE00 +
 *  4 k: page 1 entry e -> 09:74A7 + 4 (e < 2: e + 2, e > 2: e + 1; e = 2: 09:73B1), page 2 entry
 *  e -> 4 (e + 5), other pages -> entry 1. */
function statusText(g: Game, a: number): void {
  const m = g.m;
  if (a === 0) {
    let [s, hl] = statusIndex(m, a);
    if (s === 0 || (s >= 3 && s < 7)) {
      const [dead, , lo] = farSync(g, 0x0f, () => recordBit7(m));
      if (dead) {
        const de = statusSlot(m);
        far0Sync(g, 0x09, () => copy(m, 0x74a7, de, 4));
        return;
      }
      [s, hl] = statusIndex(m, lo);
      if (!s) { m.wr(statusSlot(m), 0); return; }
    }
    const de = statusSlot(m);
    far0Sync(g, 0x0e, () => copy(m, hl, de, 4));
    return;
  }
  // 0B:661E
  const v = m.rd(commandSlot(m));
  const lo = v & 0x0f;
  let e: number;
  if (lo === 0) {
    e = swap(v) & 0x0f;
    if (e === 2) {
      const de = statusSlot(m);
      far0Sync(g, 0x09, () => copy(m, 0x73b1, de, 4));
      return;
    }
    if (e > 2) e--;
    e += 2;
  } else if (lo === 1) e = ((swap(v) & 0x0f) + 5) & 0xff;
  else e = 1;
  const src = (e * 4 + 0x74a7) & 0xffff;
  const de = statusSlot(m);
  far0Sync(g, 0x09, () => copy(m, src, de, 4));
}

// ---------------------------------------------------------------- the battle end

/** 0B:5CDF — the battle end (mode 2): CEDA FF (lost): formation C2: 78 frames, then the reset
 *  (00:0200); else the "continue" question (0F:7F8F) and the map state back (0F:7DC9, DD00 ->
 *  C6E0); won: fade out (00:39F3), the background blank (0B:6C76). Then (0B:5CFF) members 0-4:
 *  C501 bit 7 or C510/C511 at 0 -> C510/C511 = 1, status C501 & 40; objects hidden, window off, WY 50,
 *  CD37 = 0; formation C2: CDC2 = C2, FF8A = FF8B = 0, C6E3 = 0, CED9 = 0D; the bracket left. */
function* battleEnd(g: Game): Co {
  const m = g.m;
  if (m.rd(0xceda) === 0xff) {
    if (m.rd(0xcc59) === 0xc2) {
      yield* g.wait(0x78);
      throw new NotPorted("00:0200 (the reset after the battle)");
    }
    yield* farcall(g, 0x0f, () => continueQuestion(g));
    farSync(g, 0x0f, () => far0Sync(g, 0x00, () => copyB(m, 0xdd00, 0xc6e0, 0x60)));
  } else {
    yield* fadeOut(g);
    farSync(g, 0x0b, () => backgroundClear(g));
  }
  let hl = 0xc501;
  for (let b = 0; b < 5; b++) {
    if (m.rd(hl) & 0x80) {
      m.wr(hl + 0x0f, 0x01);
      m.wr(hl + 0x10, 0x00);
    } else if (!(m.rd(hl + 0x10) | m.rd(hl + 0x0f))) {
      m.wr(hl + 0x0f, 0x01);
      m.wr(hl + 0x10, 0x00);
    }
    m.wr(hl, m.rd(hl) & 0x40);
    hl += 0x60;
  }
  oamClear(g);
  yield* g.point(0x0b5d2b); // after the 2 KiB background fill and 00:20CF (CPU time): WY 50 turns the frame work to the field
  windowOff(m);
  m.wr(0xff4a, 0x50);
  m.wr(0xcd37, 0);
  if (m.rd(0xcc59) === 0xc2) {
    m.wr(0xcdc2, 0xc2);
    m.hram[0x0a] = 0;
    m.hram[0x0b] = 0;
    m.wr(0xc6e3, 0);
    m.wr(0xced9, 0x0d);
  }
  yield* textEnd(g);
}

/** 0F:7F8F — the "continue" question (text 09:74FB in the box (1,1) 18 x 5, mode 24), cursor
 *  C080 78 / 88 (Up/Down), A: C080 = 0; 78: the background blank (0B:6C76), else the reset. */
function* continueQuestion(g: Game): Co {
  const m = g.m;
  yield* far0(g, 0x09, () => printText(g, 0x24, 0x74fb, 0x0101, 0x0512));
  m.wr(0xc080, 0x78);
  m.wr(0xc081, 0x70);
  yield* menuInput(g, function* (i) {
    if (i === 0) return true;
    if (i >= 6) { m.wr(0xc080, m.rd(0xc080) ^ 0xf0); return false; }
    yield* soundBuzz(g);
    return false;
  });
  const a = m.rd(0xc080);
  m.wr(0xc080, 0);
  if (a !== 0x78) throw new NotPorted("00:0200 (the reset after the battle)");
  farSync(g, 0x0b, () => backgroundClear(g));
}

// ---------------------------------------------------------------- 0B:5DBF

/** 0B:5DBF — the sub-menu a (CDE9 = a; 00:373A through 0B:5DC9): 0 the command menu (0B:5DE7),
 *  1/2 the member's command pages (0B:5ED7 / 0B:5EE6), 3 the formation (0B:5F2F), 4 the
 *  abilities (0B:5F5E), 5/6 the spells / items lists (0B:5FB8), 7 the attack (0B:65C9), 8 the
 *  cover target (0B:64BE), 9 the defence (0B:64B4); then (0B:5DDD) CDEB = 0. Returns CDEA (FF:
 *  cancelled, z). */
function* menuSelect(g: Game, a: number): Co<number> {
  const m = g.m;
  m.wr(0xcde9, a);
  switch (a & 0xff) {
    case 0: yield* commandMenu(g); break;
    case 1: yield* commandPage(g, 3, 0x73a0); break;
    case 2: yield* commandPage(g, 1, 0x73bd); break;
    case 3: yield* formation(g); break;
    case 4: yield* abilities(g); break;
    case 5: case 6: yield* listMenu(g); break;
    case 7: yield* attack(g); break;
    case 8: yield* cover(g); break;
    case 9: defend(g); break;
    default: throw new NotPorted(`0B:5DBF (sub-menu ${a.toString(16)})`);
  }
  m.wr(0xcdeb, 0);
  return m.rd(0xcdea);
}

/** 0B:5DE7 — the command menu: CD1C = 1, the boxes 0B:5E35 -> C8B0, OAM held (0F:7D97), cursor
 *  C080/C081 = 60, the menu (00:1E49), CD1C = 0; Up/Down move C080 over 60, 70, 80 (wrapping), A
 *  chooses. */
function* commandMenu(g: Game): Co {
  const m = g.m;
  m.wr(0xcd1c, 1);
  copy(m, 0x5e35, 0xc8b0, 16);
  farSync(g, 0x0f, () => oamHold(g));
  m.wr(0xc080, 0x60);
  m.wr(0xc081, 0x60);
  yield* menu(g);
  m.wr(0xcd1c, 0);
  yield* menuInput(g, function* (i) {
    if (i === 0) return true;
    if (i === 6) { // 0B:5E17
      const a = m.rd(0xc080);
      m.wr(0xc080, a === 0x60 ? 0x80 : (a - 0x10) & 0xff);
      return false;
    }
    if (i === 7) { // 0B:5E26
      const a = m.rd(0xc080);
      m.wr(0xc080, a === 0x80 ? 0x60 : (a + 0x10) & 0xff);
      return false;
    }
    yield* soundBuzz(g);
    return false;
  });
}

/** 0B:5ED7 / 0B:5EE6 (with 0B:5EF3) — a command page of n + 1 entries (CDD1 = n), text CDDA/CDDB =
 *  t: CDD3 = the command's entry (CE00 high nibble), the page (0B:5F18); a new entry: CE00 high
 *  nibble = CDD3, CE01 = 0. */
function* commandPage(g: Game, n: number, t: number): Co {
  const m = g.m;
  m.wr(0xcdd1, n);
  m.wr(0xcdda, t & 0xff);
  m.wr(0xcddb, t >> 8);
  m.wr(0xcdd3, swap(m.rd(commandSlot(m))) & 0x0f);
  yield* pageChoice(g);
  const hl = commandSlot(m);
  const b = m.rd(hl) & 0xf0;
  const a = swap(m.rd(0xcdd3));
  if (a === b) return;
  m.wr(hl, (m.rd(hl) & 0x0f) | a);
  m.wr(hl + 1, 0);
}

/** 0B:5F18 — CDEB low nibble = 1, the boxes (0B:6383), the choice (0B:607A), CDEA = CDD8. */
function* pageChoice(g: Game): Co {
  const m = g.m;
  m.wr(0xcdeb, (m.rd(0xcdeb) & 0xf0) | 0x01);
  yield* pageBoxes(g);
  yield* pageInput(g);
  m.wr(0xcdea, m.rd(0xcdd8));
}

/** 0B:5E45 — the party boxes 0B:5E6B -> C8B0: with no member limit (0B:6D12 z) the first only;
 *  else both, the second first unless CD36 is 4. Returns de after the terminator. */
function partyBoxes(g: Game): number {
  const m = g.m;
  const lim = farSync(g, 0x0b, () => memberLimit(m));
  let de: number;
  if (!lim) {
    [, de] = copy(m, 0x5e6b, 0xc8b0, 7);
    [, de] = copy(m, 0x5e79, de, 2);
    return de;
  }
  if (m.rd(0xcd36) === 4) {
    [, de] = copy(m, 0x5e6b, 0xc8b0, 16);
    return de;
  }
  [, de] = copy(m, 0x5e72, 0xc8b0, 7);
  [, de] = copy(m, 0x5e6b, de, 7);
  [, de] = copy(m, 0x5e79, de, 2);
  return de;
}

/** 0B:6383 — the party boxes (0B:5E45), CDEB high nibble = (CDD7 1: 2, 2: 1, else 0), and a
 *  third box 0B:63CC (8 x 8 at x 1 (CDD7 1) or B (2), none for 0) with the text CDDA/CDDB; the
 *  menu (00:1E49). */
function* pageBoxes(g: Game): Co {
  const m = g.m;
  let de = partyBoxes(g);
  const k = m.rd(0xcdd7);
  const c = k === 1 ? 0x20 : k === 2 ? 0x10 : 0x00;
  m.wr(0xcdeb, (m.rd(0xcdeb) & 0x0f) | c);
  de = (de - 2) & 0xffff;
  [, de] = copy(m, 0x63cc, de, 9);
  let hl = (de - 5) & 0xffff;
  m.wr(hl, m.rd(0xcdda));
  m.wr(hl + 1, m.rd(0xcddb));
  hl = (de - 9) & 0xffff;
  if (k === 0) { m.wr(hl, 0); m.wr(hl + 1, 0); } else m.wr(hl, k === 1 ? 0x01 : 0x0b);
  yield* menu(g);
}

/** 0B:6120 — the cursor column C081 by CDD7: 1 -> 10, 2 -> 60, else 0. */
function pageColumn(m: Memory): void {
  const k = m.rd(0xcdd7);
  m.wr(0xc081, k === 1 ? 0x10 : k === 2 ? 0x60 : 0x00);
}

/** 0B:607A — the page choice: cursor row CDD3 (0B:6705), column CDD7 (0B:6120). A: (CDD7 0:
 *  buzz) CDD8 = CDD3 (first entry of text 73A0: not when 0F:7D8D is set); B: CDD8 = FF; Start (sub-menus
 *  1/2): the command cleared, CDD3 = 0, CDD8 = 4; Left/Right: CDD7 (0-2, wrapping), the boxes again;
 *  Up/Down: CDD3 over 0..CDD1 (wrapping; CDD7 0: buzz). */
function* pageInput(g: Game): Co {
  const m = g.m;
  cursorRow(m, m.rd(0xcdd3));
  pageColumn(m);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: { // 0B:60AD
        if (!m.rd(0xcdd7)) break;
        if (m.rd(0xcdda) === 0xa0 && !m.rd(0xcdd3) && farSync(g, 0x0f, () => bit7At50(m))) break;
        m.wr(0xcdd8, m.rd(0xcdd3));
        return true;
      }
      case 1: m.wr(0xcdd8, 0xff); return true; // 0B:60CF
      case 3: { // 0B:6095
        const k = m.rd(0xcde9);
        if (k !== 1 && k !== 2) break;
        m.wr(commandSlot(m), 0);
        m.wr(0xcdd3, 0);
        m.wr(0xcdd8, 0x04);
        return true;
      }
      case 4: case 5: { // 0B:60E5 / 0B:60D3
        let a = m.rd(0xcdd7);
        if (i === 4) { a = (a + 1) & 0xff; if (a === 3) a = 0; } else a = a ? a - 1 : 0x02;
        m.wr(0xcdd7, a);
        pageColumn(m);
        yield* pageBoxes(g);
        return false;
      }
      case 6: case 7: { // 0B:60F0 / 0B:6109
        if (!m.rd(0xcdd7)) break;
        let a = m.rd(0xcdd3);
        if (i === 6) a = a ? (a - 1) & 0xff : m.rd(0xcdd1);
        else a = a === m.rd(0xcdd1) ? 0 : (a + 1) & 0xff;
        m.wr(0xcdd3, a);
        cursorRow(m, a);
        return false;
      }
    }
    yield* soundBuzz(g);
    return false;
  });
}

/** 0B:5F2F — the formation: C080 = 0, CE1D = 8 (members), CE1C = 1, CD35 = 1; each member chosen
 *  (0B:6718) has its C500 bit 7 (0F:7DB4) toggled and its status text redrawn; until
 *  cancelled (CE1C FF): CD35 = 0. */
function* formation(g: Game): Co {
  const m = g.m;
  m.wr(0xc080, 0);
  m.wr(0xce1d, 0x08);
  m.wr(0xce1c, 0x01);
  m.wr(0xcd35, 0x01);
  for (;;) {
    yield* targetSelect(g);
    const a = m.rd(0xce1c);
    if (a === 0xff) break;
    m.wr(0xcd36, a);
    const [, hl] = farSync(g, 0x0f, () => recordBit7(m));
    m.wr(hl, m.rd(hl) ^ 0x80);
    statusText(g, 0);
  }
  m.wr(0xcd35, 0);
}

/** 0B:5F5E — the abilities (C548 + record, 8): CDD2 = 1, CDD3/CDD4 = CE01 >> 2 (arithmetic) / & 3,
 *  CDD1 = 3; the list (0B:66D2, 0B:63D5, 0B:6136) until an ability (not FF, else buzz) gets its
 *  target (0B:6557) or the list is cancelled (CDD8 FF); CE01 = 4 CDD3 + CDD4. */
function* abilities(g: Game): Co {
  const m = g.m;
  m.wr(0xcdd2, 1);
  let hl = memberSlot(m, 0xce01);
  const v = m.rd(hl);
  m.wr(0xcdd3, ((v >> 2) | (v & 0x80 ? 0xc0 : 0)) & 0xff);
  m.wr(0xcdd4, v & 0x03);
  m.wr(0xcdd1, 0x03);
  for (;;) {
    oamClear20(m);
    yield* abilityBox(g);
    yield* listInput(g);
    const a = m.rd(0xcdd8);
    m.wr(0xcdea, a);
    if (a === 0xff) break;
    const p = (entityOffset(m) + 0xc548 + a) & 0xffff;
    if (m.rd(p) === 0xff) { yield* soundBuzz(g); continue; }
    if (!(yield* abilityTarget(g))) break;
  }
  hl = memberSlot(m, 0xce01);
  m.wr(hl, (((m.rd(0xcdd3) * 4) & 0xff) + m.rd(0xcdd4)) & 0xff);
}

/** 0B:63D5 — CD19 = 0, the box 0B:63E5 -> C8B0, the menu (00:1E49). */
function* abilityBox(g: Game): Co {
  const m = g.m;
  m.wr(0xcd19, 0);
  copy(m, 0x63e5, 0xc8b0, 9);
  yield* menu(g);
}

/** 0B:5FB8 — the spells (5, list text 0B:73CB) or items (6, 0B:7033) list: CDD2 = 0, CDD1 = 3,
 *  CDE6/CDE7 the list text; CE01 below FE: the list from entry CE01 (0B:63EE); FE/FF: the
 *  equipment view (CDD4 = ~CE01, CDD3 = FF, CDD2 = 1, 0B:62E4). Then the list input (0B:6136)
 *  until a usable choice gets its target (items: inventory count not 0, id 30-CA or D1, 0B:6527;
 *  spells: a known spell (0B:6583) with the MP, 0B:6589) or the list is cancelled; CE01 kept
 *  (0B:6058), the list cursors off (0F:78B2), CDE8 = 0. */
function* listMenu(g: Game): Co {
  const m = g.m;
  m.wr(0xcdd2, 0);
  m.wr(0xcdd1, 0x03);
  const t = m.rd(0xcde9) === 0x06 ? 0x7033 : 0x73cb;
  m.wr(0xcde6, t & 0xff);
  m.wr(0xcde7, t >> 8);
  const a = m.rd(memberSlot(m, 0xce01));
  if (a < 0xfe) {
    m.wr(0xcdd3, a);
    m.wr(0xcdd4, 0);
    yield* listFrom(g);
  } else {
    m.wr(0xcdd4, (~a) & 0xff);
    m.wr(0xcdd3, 0xff);
    m.wr(0xcdd2, 0x01);
    yield* equipView(g);
  }
  for (;;) {
    yield* listInput(g);
    const b = m.rd(0xcdd8);
    m.wr(0xcdea, b);
    if (b === 0xff) break;
    let nz: boolean;
    if (m.rd(0xcde9) === 0x06) {
      const hl = (0xc700 + ((b * 2) & 0xff)) & 0xffff;
      const id = m.rd(hl - 1);
      if (!m.rd(hl) || id === 0xff || id < 0x30 || (id !== 0xd1 && id >= 0xcb)) {
        yield* soundBuzz(g);
        continue;
      }
      nz = yield* itemTarget(g);
    } else {
      if (spellAt(g, b) === 0xff) { yield* soundBuzz(g); continue; }
      nz = yield* spellTarget(g);
    }
    if (!nz) break;
    yield* listBox(g);
  }
  listKeep(m);
  farSync(g, 0x0f, () => listCursorsOff(m));
  m.wr(0xcde8, 0);
}

/** 0B:6058 — CE01 + 4 CD36 = CDD3 + CDE8 (CDD3 FF: ~CDD4). */
function listKeep(m: Memory): void {
  const hl = memberSlot(m, 0xce01);
  const a = m.rd(0xcdd3);
  if (a === 0xff) { m.wr(hl, (~m.rd(0xcdd4)) & 0xff); return; }
  m.wr(hl, a);
  m.wr(hl, (m.rd(0xcde8) + m.rd(hl)) & 0xff);
}

/** 0B:63EE — CD19 = 3 (both scroll ways); CDD3 3F and above: the equipment view (0B:62C0); 4 and
 *  above: the list text CDE6 moved CDD3 - 3 entries on (00:1EBB), CDE8 = CDD3 - 3, CDD3 = 3; else
 *  CDE8 = 0; the list (0B:6420). */
function* listFrom(g: Game): Co {
  const m = g.m;
  m.wr(0xcd19, 0x03);
  let c = 0;
  const a = m.rd(0xcdd3);
  if (a >= 0x3f) { yield* equipViewFrom(g); return; }
  if (a >= 0x04) {
    const b = (a - 3) & 0xff;
    c = b;
    const hl = textSkip(g, m.rd16(0xcde6), b);
    m.wr(0xcde6, hl & 0xff);
    m.wr(0xcde7, hl >> 8);
    m.wr(0xcdd3, 0x03);
  }
  m.wr(0xcde8, c);
  yield* listBox(g);
}

/** 0B:6420 — OAM 0-19 hidden (0B:66D2), the list box 0B:6445 -> C8B0 with the text CDE6/CDE7,
 *  the list cursors C088 = 70, C08C = 78, the menu (00:1E49). */
function* listBox(g: Game): Co {
  const m = g.m;
  oamClear20(m);
  copy(m, 0x6445, 0xc8b0, 9);
  m.wr(0xc8b4, m.rd(0xcde6));
  m.wr(0xc8b5, m.rd(0xcde7));
  m.wr(0xc088, 0x70);
  m.wr(0xc08c, 0x78);
  yield* menu(g);
}

/** 0B:6273 — the list box 0B:6445 -> C8B0 with the text CDE6/CDE7, the menu (00:1E49), then the
 *  list cursors C088 = 70, C08C = 78. */
function* listRedraw(g: Game): Co {
  const m = g.m;
  copy(m, 0x6445, 0xc8b0, 9);
  m.wr(0xc8b4, m.rd(0xcde6));
  m.wr(0xc8b5, m.rd(0xcde7));
  yield* menu(g);
  m.wr(0xc088, 0x70);
  m.wr(0xc08c, 0x78);
}

/** 0B:62C0 — the equipment view from the list: with a held choice (CDD9) its mark C084 (CDD5 0-1:
 *  CDD5 << 4 + 84; FF: 64; else 0); CDD3 = FF; then 0B:62E4. */
function* equipViewFrom(g: Game): Co {
  const m = g.m;
  if (m.rd(0xcdd9)) {
    const a = m.rd(0xcdd5);
    m.wr(0xc084, a < 2 ? (swap(a) + 0x84) & 0xff : a === 0xff ? 0x64 : 0x00);
  }
  m.wr(0xcdd3, 0xff);
  yield* equipView(g);
}

/** 0B:62E4 — the equipment view: list cursors off (0F:78B2), OAM 0-19 hidden (0B:66D2), the boxes
 *  0B:62F5 -> C8B0, the menu (00:1E49). */
function* equipView(g: Game): Co {
  const m = g.m;
  farSync(g, 0x0f, () => listCursorsOff(m));
  oamClear20(m);
  copy(m, 0x62f5, 0xc8b0, 16);
  yield* menu(g);
}

/** 0B:62AF — the cursor column of a list column a: 0 -> 10, else 58. */
const listX = (a: number): number => (a ? 0x58 : 0x10);

/** 0B:6296 — the list cursor columns: CDD2 1 (two columns): C081 by CDD4, C085 by CDD6
 *  (0B:62AF); else both 18. */
function listColumns(m: Memory): void {
  if (m.rd(0xcdd2) === 1) {
    m.wr(0xc081, listX(m.rd(0xcdd4)));
    m.wr(0xc085, listX(m.rd(0xcdd6)));
    return;
  }
  m.wr(0xc081, 0x18);
  m.wr(0xc085, 0x18);
}

/** 0B:636D — the chosen entry: CDE8 + CDD3; two columns (CDD2): 2 that + CDD4. */
function listEntry(m: Memory): number {
  const a = (m.rd(0xcde8) + m.rd(0xcdd3)) & 0xff;
  if (!m.rd(0xcdd2)) return a;
  return (((a * 2) & 0xff) + m.rd(0xcdd4)) & 0xff;
}

/** 0B:6136 — the list input: cursor row CDD3 (0B:6705), columns (0B:6296). A: choose (CDD8 =
 *  0B:636D; the item list (6): a first A holds the entry (CDD9, CDD5/CDD6, mark C084/C085), a
 *  second on another entry swaps the two (0B:6305)); B: CDD8 = FF (a held entry: let go);
 *  Left/Right: the column CDD4 over 0..CDD2; Up/Down: the row CDD3 over 0..3 with the list
 *  scrolling (CD19 bits 0/1: 0B:6481 / 0B:644E) or wrapping, and between the equipment view (CDD3
 *  FF) and the list. */
function* listInput(g: Game): Co {
  const m = g.m;
  cursorRow(m, m.rd(0xcdd3));
  listColumns(m);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: { // 0B:6154
        let toSwap = false;
        if (m.rd(0xcde9) === 0x06) {
          const f = m.rd(0xcdd9) ^ 0x01;
          m.wr(0xcdd9, f);
          if (f) {
            m.wr(0xcdd5, m.rd(0xcdd3));
            m.wr(0xcdd6, m.rd(0xcdd4));
            m.wr(0xc084, (m.rd(0xc080) + 0x04) & 0xff);
            m.wr(0xc085, m.rd(0xc081));
            return false;
          }
          m.wr(0xc084, 0);
          toSwap = m.rd(0xcdd5) !== m.rd(0xcdd3) || m.rd(0xcdd6) !== m.rd(0xcdd4);
        }
        if (toSwap) { // 0B:61A8
          if (yield* swapCheck(g)) yield* soundBuzz(g);
          if (m.rd(0xcdd3) !== 0xff) yield* listRedraw(g);
          else yield* equipView(g);
          return false;
        }
        if (m.rd(0xcdd3) === 0xff) break;
        m.wr(0xcdd8, listEntry(m));
        return true;
      }
      case 1: { // 0B:61B9
        if (m.rd(0xcde9) === 0x06 && m.rd(0xcdd9)) {
          m.wr(0xcdd9, 0);
          m.wr(0xc084, 0);
          return false;
        }
        m.wr(0xcdd8, 0xff);
        return true;
      }
      case 4: case 5: { // 0B:61E4 / 0B:61D2
        let a = m.rd(0xcdd4);
        if (i === 4) a = a === m.rd(0xcdd2) ? 0 : (a + 1) & 0xff;
        else a = a ? (a - 1) & 0xff : m.rd(0xcdd2);
        m.wr(0xcdd4, a);
        listColumns(m);
        return false;
      }
      case 6: { // 0B:61F4
        const a = m.rd(0xcdd3);
        if (a !== 0) {
          if (a === 0xff) break;
          m.wr(0xcdd3, a - 1);
          cursorRow(m, a - 1);
          return false;
        }
        const s = m.rd(0xcd19);
        if (!s) {
          const n = m.rd(0xcdd1);
          m.wr(0xcdd3, n);
          cursorRow(m, n);
          return false;
        }
        if (s & 0x01) { scrollUp(g); return false; }
        if (m.rd(0xcde9) !== 0x06) break;
        m.wr(0xcdd2, 0x01);
        listColumns(m);
        yield* equipViewFrom(g);
        return false;
      }
      case 7: { // 0B:622B
        const a = m.rd(0xcdd3);
        if (a === 0xff) { // 0B:624B
          m.wr(0xcdd3, 0);
          m.wr(0xcdd2, 0);
          listColumns(m);
          if (m.rd(0xcdd9)) {
            const h = m.rd(0xcdd5);
            if (h === 0xff) m.wr(0xc084, 0);
            else if (h < 4) m.wr(0xc084, (swap(h) + 0x64) & 0xff);
          }
          yield* listRedraw(g);
          return false;
        }
        if (a !== 3) {
          m.wr(0xcdd3, a + 1);
          cursorRow(m, a + 1);
          return false;
        }
        const s = m.rd(0xcd19);
        if (!s) { m.wr(0xcdd3, 0); cursorRow(m, 0); return false; }
        if (!(s & 0x02)) break;
        scrollDown(g);
        return false;
      }
    }
    yield* soundBuzz(g);
    return false;
  });
}

/** 0B:644E — the list one entry down: a held entry's mark follows (CDD5 - 1; FF: off, below 4:
 *  C084 = CDD5 << 4 + 64), 00:3470 (b = 6, a = 1), CDE8 + 1. */
function scrollDown(g: Game): void {
  const m = g.m;
  if (m.rd(0xcde9) === 0x06 && m.rd(0xcdd9)) {
    const a = (m.rd(0xcdd5) - 1) & 0xff;
    m.wr(0xcdd5, a);
    if (a === 0xff) m.wr(0xc084, 0);
    else if (a < 4) m.wr(0xc084, (swap(a) + 0x64) & 0xff);
  }
  throw new NotPorted("00:3470 (the list scrolled down)");
}

/** 0B:6481 — the list one entry up: a held entry's mark follows (CDD5 + 1; 4: off, below 4:
 *  C084 = CDD5 << 4 + 64), 00:34E0 (a = 1, b = 6), CDE8 - 1. */
function scrollUp(g: Game): void {
  const m = g.m;
  if (m.rd(0xcde9) === 0x06 && m.rd(0xcdd9)) {
    const a = (m.rd(0xcdd5) + 1) & 0xff;
    m.wr(0xcdd5, a);
    if (a === 4) m.wr(0xc084, 0);
    else if (a < 4) m.wr(0xc084, (swap(a) + 0x64) & 0xff);
  }
  throw new NotPorted("00:34E0 (the list scrolled up)");
}

/** 0B:634F — the equipment slot C540 + record + a of CD36 -> CDDC/CDDD; nz when CD36 is 4 and
 *  the slot holds an item (not FF). */
function slotItem(m: Memory, a: number): boolean {
  const hl = (entityOffset(m) + 0xc540 + a) & 0xffff;
  m.wr(0xcddc, hl & 0xff);
  m.wr(0xcddd, hl >> 8);
  if (m.rd(0xcd36) < 4) return false;
  return m.rd(hl) !== 0xff;
}

/** 0B:6305 — the swap of the held entry and the chosen one (the inventory pair C6FF + 2 (CDE8 +
 *  entry) -> CDDE/CDDF, the equipment slot CDDC/CDDD, 00:2503); nz (refused) when neither is in
 *  the equipment view or the slot is locked (0B:634F). */
function* swapCheck(g: Game): Co<boolean> {
  const m = g.m;
  const held = (m.rd(0xcdd5) + m.rd(0xcde8)) & 0xff;
  let e: number;
  if (m.rd(0xcdd3) !== 0xff) {
    if (held !== 0xff) { yield* soundBuzz(g); return true; }
    if (slotItem(m, m.rd(0xcdd6))) return true;
    e = m.rd(0xcdd3);
  } else {
    if (held === 0xff) return false;
    if (slotItem(m, m.rd(0xcdd4))) return true;
    e = m.rd(0xcdd5);
  }
  // 0B:633A
  const a = (((m.rd(0xcde8) + e) & 0xff) * 2) & 0xff;
  const hl = (0xc6ff + a) & 0xffff;
  m.wr(0xcdde, hl & 0xff);
  m.wr(0xcddf, hl >> 8);
  throw new NotPorted("00:2503 (the equipment swap)");
}

// ---------------------------------------------------------------- targets of a choice

interface Pick { a: number; carry: boolean; z: boolean }

/** 0B:66EC — the record of CE26 (09:5D7F), then 0B:66EE. */
function* recordTarget(g: Game): Co<Pick> {
  farSync(g, 0x09, () => itemLoad(g));
  return yield* targetOf(g);
}

/** 0B:66EE — the target kinds CE1D = CE28 (0: buzz, a = FF, nc nz); else the target choice
 *  (0B:670D), a = CE1C (CE1C = FF, 0B:66E1), the cursor sound; carry when a < FE. */
function* targetOf(g: Game): Co<Pick> {
  const m = g.m;
  const v = m.rd(0xce28);
  m.wr(0xce1d, v);
  if (!v) { yield* soundBuzz(g); return { a: 0xff, carry: false, z: false }; }
  yield* targetStart(g);
  const a = takeTarget(m);
  soundOk(m);
  return { a, carry: a < 0xfe, z: a === 0xfe };
}

/** 0B:6527 — the item of the inventory pair CDEA (C6FF + 2 CDEA: CE26, CE25 = 0, CE27 = 1) gets
 *  its target (0B:66EC); chosen: CDEA = the id (C0 and above: the count - 1), CE03 + 4 k = the
 *  id, CE02 + 4 k = the target. Returns nz (not chosen). */
function* itemTarget(g: Game): Co<boolean> {
  const m = g.m;
  let hl = (0xc6ff + ((m.rd(0xcdea) * 2) & 0xff)) & 0xffff;
  m.wr(0xce26, m.rd(hl));
  m.wr(0xce25, 0);
  m.wr(0xce27, 1);
  const r = yield* recordTarget(g);
  if (!r.carry) return !r.z;
  const a = m.rd(hl);
  hl = (hl + 1) & 0xffff;
  m.wr(0xcdea, a);
  if (a >= 0xc0) m.wr(hl, m.rd(hl) - 1);
  hl = memberSlot(m, 0xce03);
  m.wr(hl, a);
  m.wr(hl - 1, r.a);
  return false;
}

/** 0B:6557 — the ability C548 + record + CDEA (CE26, CE25 = 1) gets its target (0B:66EC); chosen:
 *  CDEA and CE03 + 4 k = the ability, CE02 + 4 k = the target. Returns nz (not chosen). */
function* abilityTarget(g: Game): Co<boolean> {
  const m = g.m;
  const hl = (entityOffset(m) + 0xc548 + m.rd(0xcdea)) & 0xffff;
  m.wr(0xce26, m.rd(hl));
  m.wr(0xce25, 1);
  const r = yield* recordTarget(g);
  if (!r.carry) return !r.z;
  const a = m.rd(hl);
  m.wr(0xcdea, a);
  const p = memberSlot(m, 0xce03);
  m.wr(p, a);
  m.wr(p - 1, r.a);
  return false;
}

/** 09:51EA — CD20 = the spell of the (a + 1)-th set bit of the spell bits C551 + record (6
 *  bytes, MSB first, byte pairs swapped: (byte ^ 1) * 8 + bit); FF when there is none. */
function spellIndex(m: Memory, a: number): void {
  let hl = (entityOffset(m) + 0xc551) & 0xffff;
  let e = (a + 1) & 0xff;
  for (let c = 6; c; c--) {
    let v = m.rd(hl++);
    for (let b = 8; b; b--) {
      const carry = v & 0x80;
      v = ((v << 1) | (v >> 7)) & 0xff;
      if (carry) {
        e = (e - 1) & 0xff;
        if (!e) {
          m.wr(0xcd20, ((((6 - c) ^ 1) * 8 + b - 1) & 0xff));
          return;
        }
      }
    }
  }
  m.wr(0xcd20, 0xff);
}

/** 0B:6583 — the spell of list entry a (09:51EA): CD20. */
function spellAt(g: Game, a: number): number {
  farSync(g, 0x09, () => spellIndex(g.m, a));
  return g.m.rd(0xcd20);
}

/** 0B:6589 — the spell of entry CDEA (0B:6583; its record CE26, CE25 = 0, 09:5D7F): too little
 *  MP (C515 0 and C514 below CE29): the message 0B:71E5 (0B:6661), nz; else its target
 *  (0B:66EE); chosen: CE02 + 4 k = the target, CDEA and CE03 + 4 k = the spell. Returns nz (not
 *  chosen). */
function* spellTarget(g: Game): Co<boolean> {
  const m = g.m;
  const c = spellAt(g, m.rd(0xcdea));
  m.wr(0xce26, c);
  m.wr(0xce25, 0);
  farSync(g, 0x09, () => itemLoad(g));
  const hl = (entityOffset(m) + 0xc515) & 0xffff;
  const v = m.rd(hl);
  m.wr(hl, (v + 1) & 0xff);
  m.wr(hl, v);
  if (!v && m.rd(hl - 1) < m.rd(0xce29)) {
    yield* message(g, 0x71e5);
    return true;
  }
  const r = yield* targetOf(g);
  if (!r.carry) return !r.z;
  const p = memberSlot(m, 0xce02);
  m.wr(p, r.a);
  m.wr(0xcdea, c);
  m.wr(p + 1, c);
  return false;
}

/** 0B:65C9 — the attack: the weapon C540 + record (09:5D64: CE25 = CE27 = 0, CE26; FF: CE28 = 81,
 *  else 09:5D7F), its target (0B:66EE) -> CDEA; chosen: CE02 + 4 k. */
function* attack(g: Game): Co {
  const m = g.m;
  farSync(g, 0x09, () => {
    m.wr(0xce25, 0);
    m.wr(0xce27, 0);
    const a = m.rd((entityOffset(m) + 0xc540) & 0xffff);
    m.wr(0xce26, a);
    if (a === 0xff) m.wr(0xce28, 0x81);
    else itemLoad(g);
  });
  const r = yield* targetOf(g);
  m.wr(0xcdea, r.a);
  if (r.a === 0xff) return;
  m.wr(memberSlot(m, 0xce02), r.a);
}

/** 0B:64BE — cover: CE1D = 8 (members), CE1C = 0; the target choice (0B:6718) -> CDEA until FF
 *  (cancel) or a member that is not CD36, with C501 & C0 clear and not covered yet (C561 bit 4:
 *  the message 0B:74E2 for it, then again; otherwise buzz): its C561 = C561 & E0 | 10 | CD36,
 *  CE02 + 4 k = the member. */
function* cover(g: Game): Co {
  const m = g.m;
  m.wr(0xce1d, 0x08);
  m.wr(0xce1c, 0);
  for (;;) {
    yield* targetSelect(g);
    const b = takeTarget(m);
    m.wr(0xcdea, b);
    if (b === 0xff) return;
    let hl = (offsetOf(m, b) + 0xc501) & 0xffff;
    if (m.rd(0xcd36) === b || (m.rd(hl) & 0xc0)) {
      yield* soundBuzz(g);
      m.wr(0xce1c, m.rd(0xcdea));
      continue;
    }
    hl = (hl + 0x60) & 0xffff;
    if (m.rd(hl) & 0x10) { // 0B:650C
      const saved = m.rd(0xcd36);
      m.wr(0xcd36, b);
      yield* message(g, 0x74e2);
      m.wr(0xcd36, saved);
      m.wr(0xce1c, m.rd(0xcdea));
      continue;
    }
    m.wr(hl, (m.rd(hl) & 0xe0) | 0x10 | m.rd(0xcd36));
    m.wr(memberSlot(m, 0xce02), b);
    return;
  }
}

/** 0B:64B4 — defend: C561 + record bit 5. */
function defend(g: Game): void {
  const m = g.m;
  const hl = (entityOffset(m) + 0xc561) & 0xffff;
  m.wr(hl, m.rd(hl) | 0x20);
}

/** 0B:6661 — a message: CD45 = 1, buzz, the objects at y 68-87 moved off (0F:7D9F), the text hl
 *  (bank 09) in the box (1,4) 18 x 2, mode 24, A or B (0F:7A2C), CD45 = 0. */
function* message(g: Game, hl: number): Co {
  const m = g.m;
  m.wr(0xcd45, 1);
  yield* soundBuzz(g);
  farSync(g, 0x0f, () => oamHideRows(m, 0x68, 0x88));
  yield* far0(g, 0x09, () => printText(g, 0x24, hl, 0x0401, 0x0212));
  yield* farcall(g, 0x0f, () => waitKeys(g, 0x03));
  m.wr(0xcd45, 0);
}

// ---------------------------------------------------------------- the target choice

/** 0B:670D — the first target: CE1D bit 7 (enemies first): 0B:6BDC, else 0; CE1C = that; then
 *  0B:6718. */
function* targetStart(g: Game): Co {
  const m = g.m;
  const a = m.rd(0xce1d) & 0x80 ? firstEnemy(m, true) : 0;
  m.wr(0xce1c, a);
  yield* targetSelect(g);
}

/** 0B:6718 — the target choice by the kinds CE1D (bit 7: enemies (bit 0 one, bit 2 all: CE1C =
 *  81); else bit 3 a member, bit 4 all members (CE1C = 80); none: CE1C = FF). CDEB, CD36 and
 *  C080 kept; C080 = 0, CE1E = 1, OAM held, the list cursors off (0F:78B2), the cursor kind
 *  (0B:6868), the boxes (0B:67BF), the menu, the target cursors C050 -> C080 (0B:695C); the
 *  directions move the target (0B:698D, redrawn when CE24 is set), A chooses, B cancels (CE1C =
 *  FF); then (0B:679F) CE1E = 0, the cursors 0B:696E -> C080, C080/CDEB/CD36 back, a frame. */
function* targetSelect(g: Game): Co {
  const m = g.m;
  const f = m.rd(0xce1d);
  if (f & 0x80) {
    if (!(f & 0x01)) {
      if (!(f & 0x04)) { m.wr(0xce1c, 0xff); return; }
      m.wr(0xce1c, 0x81);
    }
  } else if (!(f & 0x08)) {
    if (!(f & 0x10)) { m.wr(0xce1c, 0xff); return; }
    m.wr(0xce1c, 0x80);
  }
  // 0B:6741
  const keptEB = m.rd(0xcdeb), kept36 = m.rd(0xcd36), kept80 = m.rd(0xc080);
  m.wr(0xc080, 0);
  m.wr(0xce1e, 1);
  m.wr(0xcd39, 1);
  farSync(g, 0x0f, () => listCursorsOff(m));
  targetKind(m);
  targetBoxes(g);
  yield* menu(g);
  copy(m, 0xc050, 0xc080, 16);
  yield* menuInput(g, function* (i) {
    if (i === 0) return true;
    if (i === 1) { m.wr(0xce1c, 0xff); return true; }
    if (i < 4) { yield* soundBuzz(g); return false; }
    // 0B:677C / 6780 / 6784 / 6787 -> 0B:6789
    yield* targetMove(g, i === 4 ? 3 : i === 5 ? 2 : i === 6 ? 0 : 1);
    targetKind(m);
    const a = (m.rd(0xce24) - 1) & 0xff;
    if (a) return false;
    m.wr(0xce24, a);
    targetBoxes(g);
    yield* menu(g);
    copy(m, 0xc050, 0xc080, 16);
    return false;
  });
  // 0B:679F
  m.wr(0xce1e, 0);
  copy(m, 0x696e, 0xc080, 16);
  m.wr(0xc080, kept80);
  m.wr(0xcdeb, keptEB);
  m.wr(0xcd36, kept36);
  yield* wait1(g);
}

/** 0B:6868 — the cursor kind CDEB by the target CE1C: a member (below 5): CD36 = it, CDEB = 1; an
 *  enemy: 30; all members (80): 2; all enemies / a group: 30. */
function targetKind(m: Memory): void {
  const a = m.rd(0xce1c);
  if (!(a & 0xc0)) {
    if (a < 5) { m.wr(0xcd36, a); m.wr(0xcdeb, 0x01); return; }
    m.wr(0xcdeb, 0x30);
    return;
  }
  m.wr(0xcdeb, a & 0x03 ? 0x30 : 0x02);
}

/** 0B:67BF — the party boxes (0B:5E45); with CD35 the box 0B:67CF after them. */
function targetBoxes(g: Game): void {
  const m = g.m;
  let de = partyBoxes(g);
  if (!m.rd(0xcd35)) return;
  de = (de - 2) & 0xffff;
  copy(m, 0x67cf, de, 9);
}

/** 0B:67D8 — the screen position of enemy slot a (5-12) from CC41 + 2 (a - 5): c = x (byte 0
 *  rotated: swap, rrca) + 8, b = y (byte 1) + 10. Returns [b, c]. */
function enemyPos(m: Memory, a: number): [number, number] {
  const hl = (0xcc41 + (((a - 5) * 2) & 0xff)) & 0xffff;
  const rot = (v: number) => { const s = swap(v); return ((s >> 1) | (s << 7)) & 0xff; };
  const c = (rot(m.rd(hl)) + 0x08) & 0xff;
  const b = (rot(m.rd(hl + 1)) + 0x10) & 0xff;
  return [b, c];
}

/** 0B:68C8 — the target set of target code a: bit 7 (all enemies): bit 0 ? 0B:6C2D : 1; bit 6
 *  (an enemy group): a & 3 ? CC5D[a & 3] : 1; a < 5 (member): 0 when C503 + record is FF, else
 *  80 when bit 7 of C501 + record is clear (else 0); a >= 5 (enemy slot): its bit masked by
 *  0B:6C2D. */
function targetBits(m: Memory, a: number): number {
  if (a & 0x80) return a & 0x01 ? enemyBits(m) : 1;
  if (a & 0x40) {
    a &= 0x03;
    return a ? m.rd(0xcc5d + a) : 1;
  }
  if (a < 5) {
    const hl = (offsetOf(m, a) + 0xc503) & 0xffff;
    if (m.rd(hl) === 0xff) return 0;
    return (m.rd(hl - 2) & 0x80) ^ 0x80;
  }
  return enemyBits(m) & bitOf((a - 5) & 0xff);
}

/** 0B:6918 — the live enemy slot (12 down to 5) at position (b, c) (0B:67D8), FF when none. */
function enemyAt(m: Memory, b: number, c: number): number {
  for (let e = 8; e; e--) {
    const [b2, c2] = enemyPos(m, e + 4);
    if (c2 !== c || b2 !== b) continue;
    if (targetBits(m, e + 4)) return e + 4;
  }
  return 0xff;
}

/** 0B:6947 — the group (0-2: CC5E..) of enemy slot a. */
function groupOf(m: Memory, a: number): number {
  const b = bitOf((a - 5) & 0xff);
  let v = b, c = 0, hl = 0xcc5e;
  for (;;) {
    if (v & m.rd(hl)) return c;
    hl++;
    v = b;
    c = (c + 1) & 0xff;
  }
}

/** 0B:6BE6 (top false) / 0B:6BDC (top true) — the live enemy slot leftmost (CC41 + 2 k: x), on a
 *  tie the lowest (6BE6) or highest (6BDC: y below) — through the RAM code at CD4D (CD4D = 00 /
 *  FF the first y, CD4E jp c / jp nc 6C24, jp 6C1E); 0D when none. */
function firstEnemy(m: Memory, top: boolean): number {
  m.wr(0xcd4d, top ? 0xff : 0x00);
  m.wr(0xcd4e, top ? 0xd2 : 0xda);
  m.wr(0xcd4f, 0x24);
  m.wr(0xcd50, 0x6c);
  m.wr(0xcd51, 0xc3);
  m.wr(0xcd52, 0x1e);
  m.wr(0xcd53, 0x6c);
  let kept = 0;
  let c = enemyBits(m);
  let e = 0xff, d = m.rd(0xcd4d);
  let hl = 0xcc41;
  for (let b = 8; b; b--) {
    const x = m.rd(hl++);
    const bit = c & 1;
    c = ((c >> 1) | (bit << 7)) & 0xff;
    if (bit) {
      let take = x < e;
      if (x === e) {
        const y = m.rd(hl);
        take = top ? y < d : y >= d;
      }
      if (take) {
        d = m.rd(hl);
        e = m.rd(hl - 1);
        kept = b;
      }
    }
    hl++;
  }
  return (0x0d - kept) & 0xff;
}

/** 0B:6AFA — CE24 = 1 (the boxes to redraw). */
function redraw(m: Memory): void {
  m.wr(0xce24, 1);
}

/** 0B:6AC5 — b to the other row (y +- 20). */
const otherRow = (b: number): number => (b < 0x20 ? b + 0x20 : b - 0x20) & 0xff;

/** 0B:697E — to the enemies (CE1D bit 0, else buzz): CE1C = 0B:6BE6. */
function* toEnemies(g: Game): Co {
  const m = g.m;
  if (!(m.rd(0xce1d) & 0x01)) { yield* soundBuzz(g); return; }
  m.wr(0xce1c, firstEnemy(m, false));
}

/** 0B:69EB — to all members (CE1D bit 4, else buzz): CE1F = CE1C, CE1C = 80. */
function* toAllMembers(g: Game): Co {
  const m = g.m;
  if (!(m.rd(0xce1d) & 0x10)) { yield* soundBuzz(g); return; }
  m.wr(0xce1f, m.rd(0xce1c));
  m.wr(0xce1c, 0x80);
}

/** 0B:6AB1 — to all enemies (CE1D bit 2, else buzz): CE1F = CE1C, CE1C = 81. */
function* toAllEnemies(g: Game): Co {
  const m = g.m;
  if (!(m.rd(0xce1d) & 0x04)) { yield* soundBuzz(g); return; }
  m.wr(0xce1f, m.rd(0xce1c));
  m.wr(0xce1c, 0x81);
}

/** 0B:698D — move the target CE1C in direction d (CE20; the previous one CE21): 0 up, 1 down,
 *  2 left, 3 right. Members (0-4: two columns, 4 alone below; CD35: 2 above 0): within the party,
 *  past its edges to the enemies (0B:697E) or all members (0B:69EB); an enemy slot (0B:6A21): to
 *  the nearest one in that direction (0B:6918), past the edges a group (bit 6), all members / the
 *  first member or all enemies; all (bit 7, 0B:6B00) and a group (bit 6, 0B:6BAD): back to the
 *  target before (CE1F), moving on from it (0B:6BD6). */
function* targetMove(g: Game, d: number): Co {
  const m = g.m;
  m.wr(0xce21, m.rd(0xce20));
  m.wr(0xce20, d);
  const t = m.rd(0xce1c);
  if (t & 0x80) { yield* allMove(g, t); return; }
  if (t & 0x40) {
    if (!(t & 0x03)) { yield* allMove(g, 0); return; }
    yield* groupMove(g);
    return;
  }
  if (t >= 5) { yield* enemyMove(g); return; }
  const dir = m.rd(0xce20);
  if (dir === 1) { // 0B:69D1
    let a = m.rd(0xce1c);
    if (a === 4) { yield* toAllMembers(g); return; }
    a = (a + 2) & 0xff;
    if (a < 4) { m.wr(0xce1c, a); return; }
    if (!farSync(g, 0x0b, () => memberLimit(m))) { yield* toAllMembers(g); return; }
    redraw(m);
    m.wr(0xce1c, 0x04);
    return;
  }
  if (dir === 2) { // 0B:69FF
    let a = m.rd(0xce1c);
    if (!(a & 0x01)) { yield* toAllMembers(g); return; }
    a = (a - 1) & 0xff;
    if (!a) a = m.rd(0xcd35) ? 0x02 : 0x00;
    m.wr(0xce1c, a);
    return;
  }
  if (dir === 3) { // 0B:6A13
    const a = m.rd(0xce1c);
    if (a & 0x01 || a === 4) { yield* toAllMembers(g); return; }
    m.wr(0xce1c, a + 1);
    return;
  }
  // 0B:69B6
  const b = m.rd(0xce1c);
  if (b === 4) redraw(m);
  if (b < 2) { yield* toEnemies(g); return; }
  let a = (b - 2) & 0xff;
  if (!a) a = m.rd(0xcd35);
  m.wr(0xce1c, a);
}

/** 0B:6A21 — an enemy slot moved (see 0B:698D). */
function* enemyMove(g: Game): Co {
  const m = g.m;
  const dir = m.rd(0xce20);
  let [b, c] = enemyPos(m, m.rd(0xce1c));
  if (dir === 1) { // 0B:6A5D
    const r = enemyAt(m, (b + 0x20) & 0xff, c);
    if (r !== 0xff) { m.wr(0xce1c, r); return; }
    const a = m.rd(0xce1d) & 0x18;
    if (!a) { yield* soundBuzz(g); return; }
    m.wr(0xce1c, a === 0x10 ? 0x80 : 0x00);
    return;
  }
  if (dir === 2 || dir === 3) { // 0B:6A87 / 0B:6AD2
    for (;;) {
      if (dir === 2) {
        if (c < 0x08) break;
        c = (c - 0x08) & 0xff;
      } else {
        const a = (c + 0x08) & 0xff;
        if (a >= 0x98) break;
        c = a;
      }
      let r = enemyAt(m, b, c);
      if (r !== 0xff) { m.wr(0xce1c, r); return; }
      b = otherRow(b);
      r = enemyAt(m, b, c);
      if (r !== 0xff) { m.wr(0xce1c, r); return; }
      b = otherRow(b);
    }
    yield* toAllEnemies(g);
    return;
  }
  // 0B:6A2E
  if (b >= 0x20) {
    const r = enemyAt(m, b - 0x20, c);
    if (r !== 0xff) { m.wr(0xce1c, r); return; }
  }
  // 0B:6A45
  if (!(m.rd(0xce1d) & 0x02)) { yield* soundBuzz(g); return; }
  const t = m.rd(0xce1c);
  m.wr(0xce1f, t);
  m.wr(0xce1c, ((groupOf(m, t) + 1) & 0xff) | 0x40);
}

/** 0B:6B00 — all (CE1C bit 7; bit 0 all enemies: 0B:6B72) moved (see 0B:698D). */
function* allMove(g: Game, t: number): Co {
  const m = g.m;
  const back = () => m.wr(0xce1c, m.rd(0xce1f));
  const prev = m.rd(0xce21);
  const dir = m.rd(0xce20);
  if (t & 0x01) { // 0B:6B72
    if (!(m.rd(0xce1d) & 0x01)) { yield* soundBuzz(g); return; }
    if (dir === 2) { if (prev === 2) { yield* soundBuzz(g); return; } back(); return; }
    if (dir === 3) { if (prev === 3) { yield* soundBuzz(g); return; } back(); return; }
    back();
    yield* targetMove(g, m.rd(0xce20));
    return;
  }
  const a = m.rd(0xce1d) & 0x0f;
  if (!a) { yield* soundBuzz(g); return; }
  if (!(a & 0x08)) {
    if (dir) { yield* soundBuzz(g); return; }
    yield* toEnemies(g);
    return;
  }
  // 0B:6B1A
  if (dir === 1) {
    if (prev === 1) { yield* soundBuzz(g); return; }
    back();
  } else if (dir === 2) {
    if (prev === 2) { yield* soundBuzz(g); return; }
    back();
    if (prev === 3) return;
  } else if (dir === 3) {
    if (prev === 3) { yield* soundBuzz(g); return; }
    back();
    if (prev === 2) return;
  } else {
    back();
    if (prev === 1) return;
  }
  yield* targetMove(g, m.rd(0xce20));
}

/** 0B:6BAD — a group (CE1C bit 6, a & 3 != 0) moved: (CE1D bit 0, else buzz) down: back to
 *  CE1F; left/right: back and moved on (0B:6BD6); up: buzz. */
function* groupMove(g: Game): Co {
  const m = g.m;
  if (!(m.rd(0xce1d) & 0x01)) { yield* soundBuzz(g); return; }
  const dir = m.rd(0xce20);
  if (dir === 1) { m.wr(0xce1c, m.rd(0xce1f)); return; }
  if (dir === 2 || dir === 3) {
    m.wr(0xce1c, m.rd(0xce1f));
    yield* targetMove(g, m.rd(0xce20));
    return;
  }
  yield* soundBuzz(g);
}

// ---------------------------------------------------------------- natives 00:1D71 and 00:1D74

/** 0B:6E40 — a button (0F:7A24), effect 16 (0B:4047), objects hidden (00:20CF), 0B:6ED1, WY 40,
 *  all 40 objects hidden (0B:6E65), the text 09:26CA in the box (1,1) 18 x 8 (mode 24), CD37 =
 *  2. */
function* battleMessage(g: Game): Co {
  const m = g.m;
  yield* farcall(g, 0x0f, () => waitKeys(g, 0xff));
  yield* effect16(g);
  oamClear(g);
  battleFlags(m);
  m.wr(0xff4a, 0x40);
  oamClear40(m);
  yield* far0(g, 0x09, () => printText(g, 0x24, 0x26ca, 0x0101, 0x0812));
  m.wr(0xcd37, 0x02);
}

/** 0B:6F67 — CE1C = 0, the question (CD36 78 and above: 09:74D1, else 09:74C4) in the box
 *  (B,5) 8 x 4 (mode 24), cursor C080/C081 = 90/60. */
function* questionText(g: Game): Co {
  const m = g.m;
  m.wr(0xce1c, 0);
  const hl = m.rd(0xcd36) >= 0x78 ? 0x74d1 : 0x74c4;
  yield* far0(g, 0x09, () => printText(g, 0x24, hl, 0x050b, 0x0408));
  m.wr(0xc080, 0x90);
  m.wr(0xc081, 0x60);
}

/** 0B:6F8D — OAM 0-19 hidden (0B:66D2), the text at CE8D/CE8E in the box (1,1) 18 x 8 (mode
 *  24). */
function* turnText(g: Game): Co {
  const m = g.m;
  oamClear20(m);
  const hl = m.rd16(0xce8d);
  yield* far0(g, 0x09, () => printText(g, 0x24, hl, 0x0101, 0x0812));
}

/** 0B:6ED9 — a yes/no question about CD36 (kept): 00:1D98, 8x8 sprites, the sprites reset
 *  (09:40E8), the status texts (0B:5DAE), CE1D = 8; D203 = FF meanwhile; the question (0B:6F67),
 *  Left/Right toggle C081 (60 / 80); A on 60: a member chosen (0B:6718; down ones (C501/C502 &
 *  C0) buzz; a cancel: the text again, 0B:6F8D + 0B:6F67) -> CD36, the text 09:26CA, 0B:6ED1;
 *  otherwise (B, or A on 80): CDC3 = FF, CD36 = FF. D203 back, the bracket left (00:1DF3). */
function* memberQuestion(g: Game): Co {
  const m = g.m;
  const kept = m.rd(0xcd36);
  yield* textBegin(g);
  m.wr(0xff40, m.rd(0xff40) & 0xfb);
  yield* farcall(g, 0x09, () => resetSpritesAll(g));
  statusTexts(g);
  m.wr(0xce1d, 0x08);
  m.wr(0xcd36, kept);
  const d203 = m.rd(0xd203);
  m.wr(0xd203, 0xff);
  yield* questionText(g);
  let a = 0xff;
  yield* menuInput(g, function* (i) {
    if (i === 0 && m.rd(0xc081) === 0x60) { // 0B:6F17
      for (;;) {
        yield* targetSelect(g);
        const t = m.rd(0xce1c);
        if (t === 0xff) {
          yield* turnText(g);
          yield* questionText(g);
          return false;
        }
        const hl = (offsetOf(m, t) + 0xc501) & 0xffff;
        a = t;
        if (!((m.rd(hl) | m.rd(hl + 1)) & 0xc0)) return true;
        yield* soundBuzz(g);
      }
    }
    if (i === 0 || i === 1) { // 0B:6F3D
      a = 0xff;
      m.wr(0xcdc3, 0xff);
      return true;
    }
    if (i === 4 || i === 5) { m.wr(0xc081, m.rd(0xc081) ^ 0xe0); return false; }
    yield* soundBuzz(g);
    return false;
  });
  // 0B:6F42
  m.wr(0xcd36, a);
  if (a !== 0xff) {
    oamClear(g);
    yield* far0(g, 0x09, () => printText(g, 0x24, 0x26ca, 0x0101, 0x0812));
    battleFlags(m);
  }
  m.wr(0xd203, d203);
  yield* textEnd(g);
}

// ---------------------------------------------------------------- the natives

/** 00:1D69 — CE88 = 1, 0B:5BDF (a round of commands). */
export function* commandWindows(g: Game): Co {
  g.m.wr(0xce88, 1);
  yield* farcall(g, 0x0b, () => windowsAll(g));
}

/** 00:1D71 — 0B:6E40. */
export function* battleMessageNative(g: Game): Co {
  yield* farcall(g, 0x0b, () => battleMessage(g));
}

/** 00:1D74 — 0B:6ED9. */
export function* memberQuestionNative(g: Game): Co {
  yield* farcall(g, 0x0b, () => memberQuestion(g));
}

/** 00:1D77 — CE88 = 2, 0B:5BDF (the battle end). */
export function* endWindows(g: Game): Co {
  g.m.wr(0xce88, 2);
  yield* farcall(g, 0x0b, () => windowsAll(g));
}

nativeRoutines.set(0x1d69, (g) => commandWindows(g));
nativeRoutines.set(0x1d71, (g) => battleMessageNative(g));
nativeRoutines.set(0x1d74, (g) => memberQuestionNative(g));
nativeRoutines.set(0x1d77, (g) => endWindows(g));
