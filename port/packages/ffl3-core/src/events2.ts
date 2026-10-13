/** Legend III scripted field motion for the scene events (00:1236): the leader's steps of bank 01
 *  (01:441D-4609: target cell, passability 01:4645, the scroll by C6F4 a frame and the new BG
 *  row / column 00:0A3A-0D13 sent through the vblank tile list C100, 00:394C), the objects'
 *  steps (01:50AC-51FF, 01:529A, 01:52AE, 01:5312), the per-frame object behaviours (01:4F66),
 *  the layer switch wipe (01:5CD3), the interrupt handlers swapped to the normal ones meanwhile
 *  (00:1B2D / 00:1B50), and the event bodies built on them (types 26, 27, 28: 01:66E9, 01:67F5,
 *  01:691E). The routines of bank 01 run with bank 01 selected by their caller. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, copy, vramCopy, bracketEnter, bracketLeave, wait1 } from "./sys.js";
import { NotPorted } from "./irq.js";
import { fa, fget, fset, slot, setSlot, copySlotUp, oamHideAll, drawObject, drawObject4, setFlag, clearFlag } from "./objects.js";
import { tableWord, blocked, blockedLeader, cellByte, cellLook, objectSprite, drawObjects, cellRead, cellArgs,
  leaderInit } from "./actors.js";
import { drawView, loadMap, leaderLook } from "./mapload.js";
import { random } from "./math.js";
import { mapAnimation } from "./window.js";

type Pair = "c210" | "c230" | "c290" | "c2b0";

/** swap (nibbles). */
const swap = (a: number): number => ((a << 4) | (a >> 4)) & 0xff;

/** A 16-bit field of the slot plus d (signed), the high byte masked by [mask] (CA04 / CA05). */
function addField(m: Memory, f: Pair, d: number, mask?: number): void {
  const a = fa(m, f);
  const s = m.rd(a) + d;
  m.wr(a, s & 0xff);
  let h = (m.rd(a + 1) + (s > 0xff ? 1 : s < 0 ? -1 : 0)) & 0xff;
  if (mask !== undefined) h &= m.rd(mask);
  m.wr(a + 1, h);
}

// ---------------------------------------------------------------- bank-0 helpers

/** 00:0165 — the step speed C6F4 = 00:017D[C6F0 & 3] (1, 2, 4, 8 pixels a frame). */
export function stepSpeed(m: Memory): void {
  m.wr(0xc6f4, m.rd(0x017d + (m.rd(0xc6f0) & 0x03)));
}

/** 00:01DB — FF96 = the highest free slot (C20F down to the first C200 entry that is 0). */
export function lastFreeSlot(m: Memory): void {
  let hl = 0xc20f, a: number;
  do {
    a = m.rd(hl);
    hl = (hl - 1) & 0xffff;
  } while (a);
  m.hram[0x16] = (hl + 1) & 0xff;
}

/** 00:1B2D — a frame, then the normal handlers (vblank 00:11A2 at C0B9, STAT 00:11E3 at C0BC)
 *  with the current ones kept at CA5A / CA5D (di ... reti). */
export function* normalHandlers(g: Game): Co {
  const m = g.m;
  yield* wait1(g);
  g.ime = false;
  copy(m, 0xc0bc, 0xca5a, 3);
  copy(m, 0xc0b9, 0xca5d, 3);
  m.wr(0xc0bd, 0xe3); m.wr(0xc0be, 0x11); m.wr(0xc0bc, 0xc3);
  m.wr(0xc0ba, 0xa2); m.wr(0xc0bb, 0x11); m.wr(0xc0b9, 0xc3);
  yield* g.reti();
}

/** 00:1B50 — the handlers kept by 00:1B2D back (di ... reti). */
export function* restoreHandlers(g: Game): Co {
  const m = g.m;
  g.ime = false;
  copy(m, 0xca5a, 0xc0bc, 3);
  copy(m, 0xca5d, 0xc0b9, 3);
  yield* g.reti();
}

/** 00:394C — the vblank tile list C100 for VRAM hl, tiles at de: c >= b: b rows of c tiles (each
 *  row 20 further, within 98xx-9Bxx); else c columns of b tiles (the column address is not
 *  advanced); C800-C803 = l, h, b, c; 00 ends the list. */
function tileList(m: Memory, hl: number, de: number, b: number, c: number): void {
  m.wr(0xc800, hl & 0xff);
  m.wr(0xc801, hl >> 8);
  m.wr(0xc802, b);
  m.wr(0xc803, c);
  let p = 0xc100;
  if (c >= b) {
    do {
      const n = m.rd(0xc803);
      m.wr(p++, m.rd(0xc801));
      m.wr(p++, m.rd(0xc800));
      m.wr(p++, n);
      for (let k = n || 256; k; k--) m.wr(p++, m.rd(de++));
      const s = m.rd(0xc800) + 0x20;
      m.wr(0xc800, s & 0xff);
      m.wr(0xc801, (((m.rd(0xc801) + (s >> 8)) & 0x03) | 0x98) & 0xff);
      b = (b - 1) & 0xff;
    } while (b);
  } else {
    do {
      const n = m.rd(0xc802);
      m.wr(p++, m.rd(0xc801));
      m.wr(p++, m.rd(0xc800));
      m.wr(p++, n | 0x80);
      for (let k = n || 256; k; k--) m.wr(p++, m.rd(de++));
      const v = m.rd(0xc800);
      m.wr(0xc800, (v & 0xe0) | (v & 0x1f));
      c = (c - 1) & 0xff;
    } while (c);
  }
  m.wr(p, 0);
}

/** 00:0DE4 — the BG map address (98xx | CA2A) of the screen cell (c, b) with the scroll FF91 /
 *  FF92. */
function bgAddr(m: Memory, c: number, b: number): number {
  const l = ((((m.hram[0x11]! & 0xf8) + c) & 0xff) >> 3) & 0xff;
  const h = 0x98 | m.rd(0xca2a);
  const de = ((((m.hram[0x12]! & 0xf8) + b) & 0xff) << 2) & 0x3ff;
  return (((h << 8) | l) + de) & 0xffff;
}

/** 00:0DB3 — C801/C802 = D000 + ((de >> 4) & (CA07 - 1)) + c rows of CA07 (high byte & CA06 |
 *  D0). */
function cellPointer(m: Memory, de: number, c: number): void {
  de = (de & 0xffff) >> 4;
  let hl = 0xd000 + (de & 0xff & ((m.rd(0xca07) - 1) & 0xff));
  for (; c; c--) hl = (hl + m.rd(0xca07)) & 0xffff;
  m.wr(0xc801, hl & 0xff);
  m.wr(0xc802, ((hl >> 8) & m.rd(0xca06)) | 0xd0);
}

/** The cell row c = (y lo >> 4) | swap(y hi) of 00:0D14-0D91. */
const cellRow = (lo: number, hi: number): number => (((lo >> 4) & 0x0f) | swap(hi)) & 0xff;

/** 00:0D14 — the cell pointer 16 px up-left of the view (the row above). */
function cellUpLeft(m: Memory): void {
  const x = ((m.rd(0xc6e7) << 8) | m.rd(0xc6e6)) - 0x10;
  const y0 = m.rd(0xc6e4) - 0x10;
  const yh = ((m.rd(0xc6e5) - (y0 < 0 ? 1 : 0)) & 0xff) & m.rd(0xca04);
  cellPointer(m, x, cellRow(y0 & 0xff, yh));
}

/** 00:0D41 — the cell pointer of the row below the view (y + A0, x - 10). */
function cellDownLeft(m: Memory): void {
  const x = ((m.rd(0xc6e7) << 8) | m.rd(0xc6e6)) - 0x10;
  const y0 = m.rd(0xc6e4) + 0xa0;
  const yh = ((m.rd(0xc6e5) + (y0 >> 8)) & 0xff) & m.rd(0xca04);
  cellPointer(m, x, cellRow(y0 & 0xff, yh));
}

/** 00:0D6D — the cell pointer of the column left of the view (x - 20, y). */
function cellLeft(m: Memory): void {
  const x = ((m.rd(0xc6e7) << 8) | m.rd(0xc6e6)) - 0x20;
  cellPointer(m, x, cellRow(m.rd(0xc6e4), m.rd(0xc6e5)));
}

/** 00:0D91 — the cell pointer of the column right of the view (x + B0, y). */
function cellRight(m: Memory): void {
  const x = ((m.rd(0xc6e7) << 8) | m.rd(0xc6e6)) + 0xb0;
  cellPointer(m, x, cellRow(m.rd(0xc6e4), m.rd(0xc6e5)));
}

/** 01:5EA6 — a layout byte's block offset e (byte << 2) with the layer (carry = bit 6 of the
 *  byte): CA12 bit 6 set keeps the upper-layer blocks (else 0), clear shows them as block 1. */
function layerBlock(m: Memory, v: number): number {
  const e = (v << 2) & 0xff;
  const carry = !!(v & 0x40);
  if (m.rd(0xca12) & 0x40) return carry ? e : 0;
  return carry ? 4 : e;
}

/** The block of the layout byte at C801/C802 (01:5EA6, the 06:4000 table by CA17 with the bank
 *  register written directly, 00:0E0A): its 4 tiles. */
function blockTiles(m: Memory): number[] {
  const e = layerBlock(m, m.rd((m.rd(0xc802) << 8) | m.rd(0xc801)));
  m.wr(0x2100, 0x06);
  const de = (tableWord(m, 0x4000, m.rd(0xca17)) + e) & 0xffff;
  const t = [m.rd(de), m.rd(de + 1), m.rd(de + 2), m.rd(de + 3)];
  m.wr(0x2100, 0x01);
  return t;
}

/** The column loop of 00:0A3A / 00:0AEE: 11 blocks down the column (C800 0..16 by 2) into
 *  C880 (left tiles) / C896 (right tiles), C801/C802 a row further each. */
function columnBlocks(m: Memory): void {
  m.wr(0xc800, 0);
  do {
    const t = blockTiles(m);
    const p = 0xc880 + m.rd(0xc800);
    m.wr(p, t[0]!);
    m.wr(p + 1, t[1]!);
    m.wr(p + 0x16, t[2]!);
    m.wr(p + 0x17, t[3]!);
    const s = m.rd(0xc801) + m.rd(0xca07);
    m.wr(0xc801, s & 0xff);
    m.wr(0xc802, (((m.rd(0xc802) + (s >> 8)) & 0xff) & m.rd(0xca06)) | 0xd0);
    m.wr(0xc800, m.rd(0xc800) + 2);
  } while (m.rd(0xc800) !== 0x16);
}

/** The row loop of 00:0BA2 / 00:0C5B: 12 blocks along the row (C800 0..18 by 2) into C880 (top
 *  tiles) / C898 (bottom tiles), C801 a column further (wrapped by CA07). */
function rowBlocks(m: Memory): void {
  m.wr(0xc800, 0);
  do {
    const t = blockTiles(m);
    const p = 0xc880 + m.rd(0xc800);
    m.wr(p, t[0]!);
    m.wr(p + 1, t[2]!);
    m.wr(p + 0x18, t[1]!);
    m.wr(p + 0x19, t[3]!);
    const w1 = (m.rd(0xca07) - 1) & 0xff;
    const x = m.rd(0xc801);
    m.wr(0xc801, (x & (w1 ^ 0xff)) | ((x + 1) & w1));
    m.wr(0xc800, m.rd(0xc800) + 2);
  } while (m.rd(0xc800) !== 0x18);
}

/** 00:0A3A — scrolling right: at C6EF & 1F = 10 the new column (00:0D91) and its left tiles to
 *  the BG (B0, 0), C6E6/C6E7 + 10; at 08 its right tiles; CA0E = 1. */
function columnRight(m: Memory): void {
  const k = m.rd(0xc6ef) & 0x1f;
  if (k === 0x10) {
    cellRight(m);
    columnBlocks(m);
    tileList(m, bgAddr(m, 0xb0, 0x00), 0xc880, 0x16, 0x01);
    const s = m.rd(0xc6e6) + 0x10;
    m.wr(0xc6e6, s & 0xff);
    m.wr(0xc6e7, ((m.rd(0xc6e7) + (s >> 8)) & 0xff) & m.rd(0xca05));
    m.wr(0xca0e, 1);
  } else if (k === 0x08) {
    tileList(m, bgAddr(m, 0xb0, 0x00), 0xc896, 0x16, 0x01);
    m.wr(0xca0e, 1);
  }
}

/** 00:0AEE — scrolling left: at 10 the new column (00:0D6D), its right tiles to (E8, 0), C6E6/
 *  C6E7 - 10; at 08 its left tiles; CA0E = 1. */
function columnLeft(m: Memory): void {
  const k = m.rd(0xc6ef) & 0x1f;
  if (k === 0x10) {
    cellLeft(m);
    columnBlocks(m);
    tileList(m, bgAddr(m, 0xe8, 0x00), 0xc896, 0x16, 0x01);
    const s = m.rd(0xc6e6) - 0x10;
    m.wr(0xc6e6, s & 0xff);
    m.wr(0xc6e7, ((m.rd(0xc6e7) - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca05));
    m.wr(0xca0e, 1);
  } else if (k === 0x08) {
    tileList(m, bgAddr(m, 0xe8, 0x00), 0xc880, 0x16, 0x01);
    m.wr(0xca0e, 1);
  }
}

/** 00:0BA2 — scrolling up: at 10 the new row (00:0D14), its bottom tiles to (F0, F8), C6E4/C6E5
 *  - 10; at 08 its top tiles; CA0E = 1. */
function rowUp(m: Memory): void {
  const k = m.rd(0xc6ef) & 0x1f;
  if (k === 0x10) {
    cellUpLeft(m);
    rowBlocks(m);
    tileList(m, bgAddr(m, 0xf0, 0xf8), 0xc898, 0x01, 0x18);
    const s = m.rd(0xc6e4) - 0x10;
    m.wr(0xc6e4, s & 0xff);
    m.wr(0xc6e5, ((m.rd(0xc6e5) - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca04));
    m.wr(0xca0e, 1);
  } else if (k === 0x08) {
    tileList(m, bgAddr(m, 0xf0, 0xf8), 0xc880, 0x01, 0x18);
    m.wr(0xca0e, 1);
  }
}

/** 00:0C5B — scrolling down: at 10 the new row (00:0D41), its top tiles to (F0, A0), C6E4/C6E5
 *  + 10; at 08 its bottom tiles; CA0E = 1. */
function rowDown(m: Memory): void {
  const k = m.rd(0xc6ef) & 0x1f;
  if (k === 0x10) {
    cellDownLeft(m);
    rowBlocks(m);
    tileList(m, bgAddr(m, 0xf0, 0xa0), 0xc880, 0x01, 0x18);
    const s = m.rd(0xc6e4) + 0x10;
    m.wr(0xc6e4, s & 0xff);
    m.wr(0xc6e5, ((m.rd(0xc6e5) + (s >> 8)) & 0xff) & m.rd(0xca04));
    m.wr(0xca0e, 1);
  } else if (k === 0x08) {
    tileList(m, bgAddr(m, 0xf0, 0xa0), 0xc898, 0x01, 0x18);
    m.wr(0xca0e, 1);
  }
}

// ---------------------------------------------------------------- per-frame work (bank 01)

/** 01:4F2B — slot 1 (the companion): sprite list xx44 (high byte 6E with CA13, else 00; in a
 *  vehicle state C6E3 01:4F5D[C6E3]), tile base 70, state 2. */
function companionInit(m: Memory): void {
  setSlot(m, 1);
  const a = fa(m, "c260");
  m.wr(a, 0x44);
  m.wr(a + 1, m.rd(0xca13) ? 0x6e : 0x00);
  const s = m.rd(0xc6e3);
  if (s) m.wr(a + 1, m.rd((0x4f5d + s) & 0xffff));
  fset(m, "c280", 0x70);
  fset(m, "c200", 0x02);
}

/** 01:4F24 — slot 0 copied to slot 1 (00:004B), then 01:4F2B. */
export function companionFollow(m: Memory): void {
  setSlot(m, 0);
  copySlotUp(m);
  companionInit(m);
}

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

/** 01:41C0 — a frame of an object's walk (FF96 kept): the map animation, the objects, a frame;
 *  returns the slot's C2D0 & 0F (the steps left). */
function* objectFrame(g: Game): Co<number> {
  const m = g.m;
  const s = slot(m);
  mapAnimation(g);
  drawObjects(g);
  yield* wait1(g);
  setSlot(m, s);
  return fget(m, "c2d0") & 0x0f;
}

// ---------------------------------------------------------------- the leader's steps (bank 01)

/** 01:4493 — the leader's sprite list C260 from the table hl by its kind C320. */
function leaderSprite(m: Memory, hl: number): void {
  setSlot(m, 0);
  const de = tableWord(m, hl, fget(m, "c320"));
  fset(m, "c260", de & 0xff);
  fset(m, "c260", de >> 8, 1);
}

/** 01:4609 — the step counter C6EF - C6F4; at 0 an encounter roll (CA2B the rate, not in a
 *  vehicle state on C6FB E4): random below CA2B -> CA2C = 1. */
function stepEnd(m: Memory): void {
  const c = (m.rd(0xc6ef) - m.rd(0xc6f4)) & 0xff;
  m.wr(0xc6ef, c);
  if (c) return;
  if (!m.rd(0xca2b)) return;
  if (m.rd(0xc6e3) >= 0x03 && m.rd(0xc6fb) === 0xe4) return;
  if (random(m) >= m.rd(0xca2b)) return;
  m.wr(0xca2c, 1);
}

/** The scroll of a leader step: FF92/CA03 (y) or FF91/CA02 (x) plus d, masked by CA04 / CA05. */
function scrollBy(m: Memory, y: boolean, d: number): void {
  const [h, hi, mask] = y ? [0x12, 0xca03, 0xca04] : [0x11, 0xca02, 0xca05];
  const s = m.hram[h]! + d;
  m.hram[h] = s & 0xff;
  m.wr(hi, ((m.rd(hi) + (s > 0xff ? 1 : s < 0 ? -1 : 0)) & 0xff) & m.rd(mask));
}

/** 01:445F — a frame of the step down: the new row (00:0C5B), C210 and the scroll + C6F4, then
 *  01:4609. */
function leaderDown(m: Memory): void {
  rowDown(m);
  setSlot(m, 0);
  addField(m, "c210", m.rd(0xc6f4), 0xca04);
  scrollBy(m, true, m.rd(0xc6f4));
  stepEnd(m);
}

/** 01:44E9 — a frame of the step up (00:0BA2, - C6F4). */
function leaderUp(m: Memory): void {
  rowUp(m);
  setSlot(m, 0);
  addField(m, "c210", -m.rd(0xc6f4), 0xca04);
  scrollBy(m, true, -m.rd(0xc6f4));
  stepEnd(m);
}

/** 01:4562 — a frame of the step right (00:0A3A, C230 + C6F4). */
function leaderRight(m: Memory): void {
  columnRight(m);
  setSlot(m, 0);
  addField(m, "c230", m.rd(0xc6f4), 0xca05);
  scrollBy(m, false, m.rd(0xc6f4));
  stepEnd(m);
}

/** 01:45DB — a frame of the step left (00:0AEE, - C6F4). */
function leaderLeft(m: Memory): void {
  columnLeft(m);
  setSlot(m, 0);
  addField(m, "c230", -m.rd(0xc6f4), 0xca05);
  scrollBy(m, false, -m.rd(0xc6f4));
  stepEnd(m);
}

/** 01:4736 / 01:4755 / 01:4774 / 01:4793 — the leader's next cell C800-C803 (its target C290 /
 *  C2B0 one cell left / up / down / right). */
function leaderNext(m: Memory, dir: number): void {
  const y = fa(m, "c290"), x = fa(m, "c2b0");
  let yl = m.rd(y), yh = m.rd(y + 1), xl = m.rd(x), xh = m.rd(x + 1);
  if (dir === 0x00) { const s = yl - 0x10; yl = s & 0xff; yh = ((yh - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca04); }
  else if (dir === 0x80) { const s = yl + 0x10; yl = s & 0xff; yh = ((yh + (s >> 8)) & 0xff) & m.rd(0xca04); }
  else if (dir === 0x40) { const s = xl + 0x10; xl = s & 0xff; xh = ((xh + (s >> 8)) & 0xff) & m.rd(0xca05); }
  else { const s = xl - 0x10; xl = s & 0xff; xh = ((xh - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca05); }
  m.wr(0xc800, yl); m.wr(0xc801, yh); m.wr(0xc802, xl); m.wr(0xc803, xh);
}

/** 01:471E — C804 = the leader's C2E0, the next cell by C6EE (01:4755 up, 4793 right, 4774
 *  down, 4736 left). */
function leaderTarget(m: Memory): void {
  m.wr(0xc804, fget(m, "c2e0"));
  const d = m.rd(0xc6ee);
  leaderNext(m, d === 0x00 || d === 0x40 || d === 0x80 ? d : 0xc0);
}

/** 01:46C5 — the leader pushes against a pushable object (kind 0B): 8 tries (CA26), then the
 *  object turns to C6EE and its next cell is checked (00:0FFD, 01:52AE; C800-C806 kept through
 *  C810); returns true (nz) until then or when that cell is taken. (The object's own move is its
 *  behaviour 01:51FE.) */
function pushObject(g: Game): boolean {
  const m = g.m;
  const n = (m.rd(0xca26) + 1) & 0xff;
  m.wr(0xca26, n);
  if (n !== 0x08) return true;
  m.wr(0xca26, 0);
  fset(m, "c2d0", m.rd(0xc6ee));
  copy(m, 0xc800, 0xc810, 7);
  objectTarget(m);
  let r = blocked(g);
  if (!r) r = objectAt(m);
  copy(m, 0xc810, 0xc800, 7);
  return r;
}

/** 01:465F — an object (slots 2-F, shown, C360 bit 6 clear) on the cell C800-C803 (and with C2E0
 *  bit 3: the same C2E0 as C804): true (nz) unless it is a pushable object (kind 0B) that gives
 *  way (01:46C5). FF96 is left at the object. */
function objectAhead(g: Game): boolean {
  const m = g.m;
  for (setSlot(m, 2); slot(m) !== 0x10; setSlot(m, slot(m) + 1)) {
    if (!fget(m, "c200")) continue;
    if (fget(m, "c360") & 0x40) continue;
    if (fget(m, "c290") !== m.rd(0xc800) || fget(m, "c290", 1) !== m.rd(0xc801)) continue;
    if (fget(m, "c2b0") !== m.rd(0xc802) || fget(m, "c2b0", 1) !== m.rd(0xc803)) continue;
    if (fget(m, "c2e0") & 0x08 && fget(m, "c2e0") !== m.rd(0xc804)) continue;
    if (fget(m, "c320") !== 0x0b) return true;
    if (pushObject(g)) return true;
  }
  return false;
}

/** 01:4645 — can the leader step in C6EE? (true = nz, blocked): the next cell (01:471E), the
 *  map (00:1024), the objects (01:465F); free: the cell byte and look (01:463D, 01:4E48). */
function leaderBlocked(g: Game): boolean {
  const m = g.m;
  setSlot(m, 0);
  leaderTarget(m);
  if (blockedLeader(g)) return true;
  if (objectAhead(g)) return true;
  setSlot(m, 0);
  cellByte(m);
  cellLook(m);
  return false;
}

/** The start of a leader step (01:441D / 44A8 / 4520 / 4599): CA30 = 0, CA56 = 1, C6F0 = C6F1,
 *  the speed, the sprite list (table), C6EE = dir; blocked: CA30 = 1; else CA51 = 0, C6EF = 10,
 *  the target C290 / C2B0 one cell on, then the first frame. */
function leaderStart(g: Game, table: number, dir: number, frame: (m: Memory) => void): void {
  const m = g.m;
  m.wr(0xca30, 0);
  m.wr(0xca56, 1);
  m.wr(0xc6f0, m.rd(0xc6f1));
  stepSpeed(m);
  leaderSprite(m, table);
  m.wr(0xc6ee, dir);
  if (leaderBlocked(g)) { m.wr(0xca30, 1); return; }
  m.wr(0xca51, 0);
  m.wr(0xc6ef, 0x10);
  setSlot(m, 0);
  if (dir === 0x80) addField(m, "c290", 0x10, 0xca04);
  else if (dir === 0x00) addField(m, "c290", -0x10, 0xca04);
  else if (dir === 0x40) addField(m, "c2b0", 0x10, 0xca05);
  else addField(m, "c2b0", -0x10, 0xca05);
  frame(m);
}

/** 01:441D — the leader starts a step down (sprite table 01:6ABE, C6EE 80). */
function leaderStartDown(g: Game): void { leaderStart(g, 0x6abe, 0x80, leaderDown); }
/** 01:44A8 — the leader starts a step up (01:6AFE, C6EE 00). */
function leaderStartUp(g: Game): void { leaderStart(g, 0x6afe, 0x00, leaderUp); }
/** 01:4520 — the leader starts a step right (01:6B7E, C6EE 40). */
function leaderStartRight(g: Game): void { leaderStart(g, 0x6b7e, 0x40, leaderRight); }
/** 01:4599 — the leader starts a step left (01:6B3E, C6EE C0). */
function leaderStartLeft(g: Game): void { leaderStart(g, 0x6b3e, 0xc0, leaderLeft); }

/** The forced leader step (01:5C02 / 5C22 / 5C43 / 5C64): C6EE = dir, C6EF = 10, the target one
 *  cell on (no check, the sprite list kept), then the first frame. */
function leaderShift(m: Memory, dir: number, frame: (m: Memory) => void): void {
  m.wr(0xc6ee, dir);
  m.wr(0xc6ef, 0x10);
  setSlot(m, 0);
  if (dir === 0x00) addField(m, "c290", -0x10, 0xca04);
  else if (dir === 0x80) addField(m, "c290", 0x10, 0xca04);
  else if (dir === 0x40) addField(m, "c2b0", 0x10, 0xca05);
  else addField(m, "c2b0", -0x10, 0xca05);
  frame(m);
}
/** 01:5C02 — the leader moved up without a check. */
export function leaderShiftUp(m: Memory): void { leaderShift(m, 0x00, leaderUp); }
/** 01:5C22 — the leader moved down without a check. */
export function leaderShiftDown(m: Memory): void { leaderShift(m, 0x80, leaderDown); }
/** 01:5C43 — the leader moved right without a check. */
export function leaderShiftRight(m: Memory): void { leaderShift(m, 0x40, leaderRight); }
/** 01:5C64 — the leader moved left without a check. */
export function leaderShiftLeft(m: Memory): void { leaderShift(m, 0xc0, leaderLeft); }

// ---------------------------------------------------------------- the layer switch (bank 01)

/** 01:5DE7 — one tile of the wipe: the BG map tile at (C802, C803) of the 9C00 map (CA2A = 4)
 *  copied to the 9800 map (CA2A = 0) in an hblank; returns C801 == C800 (z). The STAT polls of
 *  the original (CPU time) are not modelled. */
function wipeTile(m: Memory): boolean {
  const b = m.rd(0xc803), c = m.rd(0xc802);
  m.wr(0xca2a, 0x04);
  const de = bgAddr(m, c, b);
  m.wr(0xca2a, 0x00);
  const hl = bgAddr(m, c, b);
  m.wr(hl, m.rd(de));
  return m.rd(0xc801) === m.rd(0xc800);
}

/** 01:5DC3 / 5DCC / 5DD5 / 5DDE — the wipe position C802 (x) or C803 (y) +- 8. */
function wipeMove(m: Memory, k: number): void {
  if (k === 0) m.wr(0xc802, m.rd(0xc802) + 8);
  else if (k === 1) m.wr(0xc803, m.rd(0xc803) + 8);
  else if (k === 2) m.wr(0xc802, m.rd(0xc802) - 8);
  else m.wr(0xc803, m.rd(0xc803) - 8);
}

/** 01:5DA1 — a side of the outward spiral done: a frame while C800 < 10, C801 = 0, C804 + 1,
 *  every second side C800 + 1. */
function* wipeOutTurn(g: Game): Co {
  const m = g.m;
  if (m.rd(0xc800) < 0x10) yield* wait1(g);
  m.wr(0xc801, 0);
  m.wr(0xc804, m.rd(0xc804) + 1);
  if (m.rd(0xc804) & 1) return;
  m.wr(0xc800, m.rd(0xc800) + 1);
}

/** 01:5D66 — the outward spiral from the centre (50, 50): sides of C800 tiles (01:5DE7), turning
 *  right, down, left, up (01:5DC3 / 5DCC / 5DD5 / 5DDE) until C801 reaches 20. */
function* wipeOut(g: Game): Co {
  const m = g.m;
  m.wr(0xc800, 1);
  m.wr(0xc801, 0);
  m.wr(0xc804, 0);
  m.wr(0xc802, 0x50);
  m.wr(0xc803, 0x50);
  for (;;) {
    if (wipeTile(m)) yield* wipeOutTurn(g);
    wipeMove(m, m.rd(0xc804) & 0x03);
    const n = (m.rd(0xc801) + 1) & 0xff;
    m.wr(0xc801, n);
    if (n === 0x20) return;
  }
}

/** 01:5D4B — a side of the inward spiral done: a frame, C801 = 0, C804 + 1, every second side
 *  C800 - 1. */
function* wipeInTurn(g: Game): Co {
  const m = g.m;
  yield* wait1(g);
  m.wr(0xc801, 0);
  m.wr(0xc804, m.rd(0xc804) + 1);
  if (!(m.rd(0xc804) & 1)) return;
  m.wr(0xc800, m.rd(0xc800) - 1);
}

/** 01:5D0C — the inward spiral from the corner (E0, C0): sides of C800 (1B ..) tiles, turning
 *  right, up, left, down, until C800 is 0. */
function* wipeIn(g: Game): Co {
  const m = g.m;
  m.wr(0xc800, 0x1b);
  m.wr(0xc801, 0);
  m.wr(0xc804, 0);
  m.wr(0xc802, 0xe0);
  m.wr(0xc803, 0xc0);
  for (;;) {
    if (wipeTile(m)) yield* wipeInTurn(g);
    wipeMove(m, [0, 3, 2, 1][m.rd(0xc804) & 0x03]!);
    m.wr(0xc801, m.rd(0xc801) + 1);
    if (!m.rd(0xc800)) return;
  }
}

/** 01:5E14's / 01:5E56's object: on the other layer (C300 bit 6 != CA12) the frame bits 06, else
 *  from C2F0 bits 4-5; drawn with 00:3A7F (C360 bit 2) or 00:3B3F. */
function layerObject(m: Memory): void {
  const a = fa(m, "c250");
  if ((fget(m, "c300") & 0x40) !== m.rd(0xca12)) m.wr(a, (m.rd(a) & 0xf9) | 0x06);
  else m.wr(a, (m.rd(a) & 0xf1) | ((fget(m, "c2f0") & 0x30) >> 3));
  if (fget(m, "c360") & 0x04) drawObject(m);
  else drawObject4(m);
}

/** 01:5E14 — the OAM buffer cleared, only the leader drawn. */
function drawLeaderOnly(m: Memory): void {
  oamHideAll(m);
  m.hram[0x17] = 0;
  setSlot(m, 0);
  layerObject(m);
}

/** 01:5E56 — the OAM buffer cleared, the 16 slots drawn. */
function drawAllLayered(m: Memory): void {
  oamHideAll(m);
  m.hram[0x17] = 0;
  for (setSlot(m, 0); slot(m) !== 0x10; setSlot(m, slot(m) + 1)) layerObject(m);
}

/** 01:5CD3 — the leader changes layer (C300 bit 6 != CA12): in the bracket, CA12 ^= 40, the
 *  whole view into the 9C00 map (CA2E = 1, CA2A = 4, 00:0E34), the leader alone, the outward
 *  wipe to 9800; the view with the new layer into 9C00 again, the inward wipe, all objects. */
function* layerSwitch(g: Game): Co {
  const m = g.m;
  if ((m.rd(0xc300) & 0x40) === m.rd(0xca12)) return;
  yield* bracketEnter(g);
  m.wr(0xca12, m.rd(0xca12) ^ 0x40);
  m.wr(0xca2e, 1);
  m.wr(0xca2a, 0x04);
  yield* drawView(g);
  drawLeaderOnly(m);
  yield* wipeOut(g);
  m.wr(0xca2a, 0x04);
  yield* drawView(g);
  yield* wipeIn(g);
  drawAllLayered(m);
  yield* bracketLeave(g);
}

// ---------------------------------------------------------------- objects' steps (bank 01)

/** 01:5312 — C804 = the slot's C2E0, C800-C803 = its next cell by C2D0 (00 up, 40 right, 80
 *  down, C0 left). */
function objectTarget(m: Memory): void {
  m.wr(0xc804, fget(m, "c2e0"));
  let yl = fget(m, "c290"), yh = fget(m, "c290", 1), xl = fget(m, "c2b0"), xh = fget(m, "c2b0", 1);
  const d = fget(m, "c2d0") & 0xc0;
  if (d === 0x00) { const s = yl - 0x10; yl = s & 0xff; yh = ((yh - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca04); }
  else if (d === 0x40) { const s = xl + 0x10; xl = s & 0xff; xh = ((xh + (s >> 8)) & 0xff) & m.rd(0xca05); }
  else if (d === 0x80) { const s = yl + 0x10; yl = s & 0xff; yh = ((yh + (s >> 8)) & 0xff) & m.rd(0xca04); }
  else { const s = xl - 0x10; xl = s & 0xff; xh = ((xh - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca05); }
  m.wr(0xc800, yl); m.wr(0xc801, yh); m.wr(0xc802, xl); m.wr(0xc803, xh);
}

/** 01:52AE — another shown slot (any but FF96, kept in FF97) on the cell C800-C803 (C2E0 bit 3:
 *  the same C2E0 as C804)? FF96 back after. */
function objectAt(m: Memory): boolean {
  m.hram[0x17] = slot(m);
  let found = false;
  for (setSlot(m, 0); slot(m) !== 0x10; setSlot(m, slot(m) + 1)) {
    if (!fget(m, "c200")) continue;
    if (slot(m) === m.hram[0x17]) continue;
    if (fget(m, "c290") !== m.rd(0xc800) || fget(m, "c290", 1) !== m.rd(0xc801)) continue;
    if (fget(m, "c2b0") !== m.rd(0xc802) || fget(m, "c2b0", 1) !== m.rd(0xc803)) continue;
    if (fget(m, "c2e0") & 0x08 && fget(m, "c2e0") !== m.rd(0xc804)) continue;
    found = true;
    break;
  }
  setSlot(m, m.hram[0x17]!);
  return found;
}

/** 01:529A — can the slot step on? (true = nz, blocked): its next cell (01:5312), the map
 *  (00:0FFD), the objects (01:52AE); free: the cell byte and look. */
function objectBlocked(g: Game): boolean {
  const m = g.m;
  objectTarget(m);
  if (blocked(g)) return true;
  if (objectAt(m)) return true;
  cellByte(m);
  cellLook(m);
  return false;
}

/** 01:51F8 — C310 = 1 (the walking speed). */
function speedOne(m: Memory): void {
  fset(m, "c310", 0x01);
}

/** 01:51E4 — C2D0 - C310 (the steps left in the low nibble). */
function stepCount(m: Memory): void {
  fset(m, "c2d0", (fget(m, "c2d0") - fget(m, "c310")) & 0xff);
}

/** 01:5144 / 5100 / 518A / 51D0 — a frame of the slot's step: C210 (up / down) or C230 (right /
 *  left) by C310, then 01:51E4. */
function objectMove(m: Memory, dir: number): void {
  const v = fget(m, "c310");
  if (dir === 0x00) addField(m, "c210", -v, 0xca04);
  else if (dir === 0x80) addField(m, "c210", v, 0xca04);
  else if (dir === 0x40) addField(m, "c230", v, 0xca05);
  else addField(m, "c230", -v, 0xca05);
  stepCount(m);
}

/** The step start of 01:5124 / 50DF / 5169 / 51AF (check = true) and of 01:5117 / 50D1 / 515B /
 *  51A1 (no check): C2D0 = dir, the sprite (01:5272); blocked: stop; else C2D0 | 10 (01:51F0),
 *  the target one cell on, the first frame. */
function objectStart(g: Game, dir: number, check: boolean): void {
  const m = g.m;
  fset(m, "c2d0", dir);
  objectSprite(m, dir);
  if (check && objectBlocked(g)) return;
  fset(m, "c2d0", fget(m, "c2d0") | 0x10);
  if (dir === 0x00) addField(m, "c290", -0x10, 0xca04);
  else if (dir === 0x80) addField(m, "c290", 0x10, 0xca04);
  else if (dir === 0x40) addField(m, "c2b0", 0x10, 0xca05);
  else addField(m, "c2b0", -0x10, 0xca05);
  objectMove(m, dir);
}

/** 01:5121 / 50DC / 5166 / 51AC — C310 = 1 (01:51F8), then the checked step start in dir. */
function objectWalk(g: Game, dir: number): void {
  speedOne(g.m);
  objectStart(g, dir, true);
}

/** 01:50AC — a slot still stepping (C2D0 & 0F): one more frame by its facing; true (nz) then. */
function objectContinue(m: Memory): boolean {
  if (!(fget(m, "c2d0") & 0x0f)) return false;
  objectMove(m, fget(m, "c2d0") & 0xc0);
  return true;
}

/** 01:4DAE — on a moving-floor cell (C2F0 & C0 = 80; map 50: C280 30, C320 1B) the slot steps by
 *  C2F0 bits 0-1 at the speed 00:017D[C2F0 bits 2-3] (01:5124 / 5169 / 50DF / 51AF) and false (z)
 *  is returned; else true (nz). */
function movingFloor(g: Game): boolean {
  const m = g.m;
  if ((fget(m, "c2f0") & 0xc0) !== 0x80) return true;
  if (m.rd(0xc6e8) === 0x50) {
    fset(m, "c280", 0x30);
    fset(m, "c320", 0x1b);
  }
  fset(m, "c310", m.rd(0x017d + ((fget(m, "c2f0") & 0x0c) >> 2)));
  objectStart(g, [0x00, 0x40, 0x80, 0xc0][fget(m, "c2f0") & 0x03]!, true);
  return false;
}

/** 01:5060 — a wandering object: still stepping, or on a moving floor; else (not while CA0E) on
 *  map 50 its look back (C330 / C340), then one in four random bytes starts a step (FF90 & 3:
 *  down, up, left, right). */
function wander(g: Game): void {
  const m = g.m;
  if (objectContinue(m)) return;
  if (!movingFloor(g)) return;
  if (m.rd(0xca0e)) return;
  if (m.rd(0xc6e8) === 0x50) {
    fset(m, "c280", fget(m, "c330"));
    fset(m, "c320", fget(m, "c340"));
    objectSprite(m, fget(m, "c2d0") & 0xc0);
  }
  random(m);
  if (m.hram[0x10]! & 0xfc) return;
  objectWalk(g, [0x80, 0x00, 0xc0, 0x40][m.hram[0x10]! & 0x03]!);
}

/** 01:525B — the slot on a C2F0 EB cell: CA52 = 1, CA6D = the slot, C2F0 = 0. */
function onSwitch(m: Memory): void {
  if (fget(m, "c2f0") !== 0xeb) return;
  m.wr(0xca52, 1);
  m.wr(0xca6d, slot(m));
  fset(m, "c2f0", 0);
}

/** 01:51FE — a pushable object (kind 0B): still stepping, or on a moving floor; else (C2E0 bit 3:
 *  the leader's C2E0 must match) 01:525B, and when the leader's target C290 / C2B0 is its cell,
 *  a step in C6EE. */
function pushable(g: Game): void {
  const m = g.m;
  if (objectContinue(m)) return;
  if (!movingFloor(g)) return;
  if (fget(m, "c2e0") & 0x08 && m.rd(0xc2e0) !== fget(m, "c2e0")) return;
  onSwitch(m);
  if (fget(m, "c290") !== m.rd(0xc290) || fget(m, "c290", 1) !== m.rd(0xc291)) return;
  if (fget(m, "c2b0") !== m.rd(0xc2b0) || fget(m, "c2b0", 1) !== m.rd(0xc2b1)) return;
  objectWalk(g, [0x00, 0x40, 0x80, 0xc0][(swap(m.rd(0xc6ee)) >> 2) & 0x03]!);
}

/** 01:4F66 — the objects' behaviour each frame, slots 2-F by kind C320: 00-03 and 1B-1E wander
 *  (01:5060), 0B pushable (01:51FE), 0C sway (01:5007), 0F a 24-frame effect (01:4FDC), 19 rise
 *  (01:5049), 1F drift (01:5030), 20 fall (01:4FC9); others stand. */
export function objectsUpdate(g: Game): void {
  const m = g.m;
  for (setSlot(m, 2); slot(m) !== 0x10; setSlot(m, slot(m) + 1)) {
    if (!fget(m, "c200")) continue;
    const k = fget(m, "c320");
    if (k <= 0x03 || (k >= 0x1b && k <= 0x1e)) wander(g);
    else if (k === 0x0b) pushable(g);
    else if (k === 0x0c) sway(m);
    else if (k === 0x0f) effect24(m);
    else if (k === 0x19) rise(m);
    else if (k === 0x1f) drift(m);
    else if (k === 0x20) fall(m);
    else if (k > 0x20) throw new NotPorted(`01:4F79 object kind ${k.toString(16)}`);
  }
}

/** 01:4FC9 — kind 20: C210 + 2 (& CA04). */
function fall(m: Memory): void {
  addField(m, "c210", 2, 0xca04);
}

/** 01:4FDC — kind 0F: frame C250 and tile base C280 (50 | bits) from C2D0 >> 2, the sprite
 *  (01:5272 facing 0), C2D0 + 1; at 18 the slot is freed. */
function effect24(m: Memory): void {
  const b = (fget(m, "c2d0") >> 2) & 0x0f;
  fset(m, "c250", b);
  fset(m, "c280", (b & 0x0c) | 0x50);
  objectSprite(m, 0);
  const n = (fget(m, "c2d0") + 1) & 0xff;
  fset(m, "c2d0", n);
  if (n === 0x18) fset(m, "c200", 0);
}

/** 01:5007 — kind 0C: on odd frames C2D0 + 1 and C230 one pixel right (C2D0 bit 4 clear) or
 *  left (16-bit, unmasked). */
function sway(m: Memory): void {
  if (!(m.hram[0x13]! & 0x01)) return;
  const n = (fget(m, "c2d0") + 1) & 0xff;
  fset(m, "c2d0", n);
  addField(m, "c230", n & 0x10 ? -1 : 1);
}

/** 01:5030 — kind 1F: C2B0 + 2 and C230 + 2 (& CA05). */
function drift(m: Memory): void {
  addField(m, "c2b0", 2, 0xca05);
  addField(m, "c230", 2, 0xca05);
}

/** 01:5049 — kind 19: on even frames C290 - 1 and C210 - 1 (00:18DE, & CA04). */
function rise(m: Memory): void {
  if (m.hram[0x13]! & 0x01) return;
  addField(m, "c290", -1, 0xca04);
  addField(m, "c210", -1, 0xca04);
}

// ---------------------------------------------------------------- event 26: object set-up

/** 01:67ED — FF96 = CA28 & 0F (the slot of the event). */
function eventSlot(m: Memory): void {
  setSlot(m, m.rd(0xca28) & 0x0f);
}

/** 01:67DC — the sprite list of the slot by its facing (slot 0: C6EE, else C2D0). */
function facingSprite(m: Memory): void {
  objectSprite(m, slot(m) ? fget(m, "c2d0") : m.rd(0xc6ee));
}

/** 01:66E9 — event 26, an object change, CA28 = op << 4 | slot: 0-3 facing op << 6 (slot 0:
 *  C6EE), 4 hidden (C200 = 0), 5 shown (C200 = C370), 6 / 7 speed (slot 0: C6F0 = C6F1 = 0 / 1 and
 *  00:0165; else C310 = 1 / 2), 8-D a look from 01:6775 / 677B / 6781 (C280, C320, C360), E the
 *  leader's look, F the look back (C330 / C340). */
export function objectEvent(m: Memory): void {
  const op = (m.rd(0xca28) >> 4) & 0x0f;
  eventSlot(m);
  if (op <= 0x03) {
    const d = ((m.rd(0xca28) & 0x30) << 2) & 0xff;
    if (!slot(m)) m.wr(0xc6ee, d);
    else fset(m, "c2d0", d);
    objectSprite(m, d);
  } else if (op === 0x04) fset(m, "c200", 0);
  else if (op === 0x05) fset(m, "c200", fget(m, "c370"));
  else if (op === 0x06 || op === 0x07) {
    const v = op === 0x06 ? 0 : 1;
    if (!slot(m)) {
      m.wr(0xc6f1, v);
      m.wr(0xc6f0, v);
      stepSpeed(m);
    } else fset(m, "c310", v + 1);
  } else if (op <= 0x0d) {
    const c = (m.rd(0xca28) & 0x70) >> 4;
    fset(m, "c280", m.rd(0x6775 + c));
    fset(m, "c320", m.rd(0x677b + c));
    fset(m, "c360", m.rd(0x6781 + c));
    facingSprite(m);
  } else if (op === 0x0e) {
    setSlot(m, 0);
    const b = fget(m, "c320"), c = fget(m, "c280");
    eventSlot(m);
    fset(m, "c280", c);
    fset(m, "c320", b);
    facingSprite(m);
  } else {
    eventSlot(m);
    fset(m, "c280", fget(m, "c330"));
    fset(m, "c320", fget(m, "c340"));
    facingSprite(m);
  }
}

// ---------------------------------------------------------------- events 27 / 28: walks

/** 01:686B / 6884 / 68A0 / 68B9 — b steps of the leader (up / down with the layer switch 01:5CD3
 *  first / right / left): each a checked start (01:44A8 ...), then frames (01:41AF) until C6EF
 *  is 0; a blocked step (CA30) is skipped. */
function* leaderWalk(g: Game, dir: number, b: number): Co {
  const m = g.m;
  do {
    if (dir === 0x80) yield* layerSwitch(g);
    const [start, frame] = dir === 0x00 ? [leaderStartUp, leaderUp] : dir === 0x80 ? [leaderStartDown, leaderDown]
      : dir === 0x40 ? [leaderStartRight, leaderRight] : [leaderStartLeft, leaderLeft];
    start(g);
    if (!m.rd(0xca30)) while (yield* walkFrame(g)) frame(m);
    b = (b - 1) & 0xff;
  } while (b);
}

/** 01:698B / 699E / 69B1 / 69C4 — b forced steps of the leader (01:5C02 ...: no check, the
 *  facing sprite kept), each followed by frames until C6EF is 0. */
function* leaderShiftWalk(g: Game, dir: number, b: number): Co {
  const m = g.m;
  do {
    const [shift, frame] = dir === 0x00 ? [leaderShiftUp, leaderUp] : dir === 0x80 ? [leaderShiftDown, leaderDown]
      : dir === 0x40 ? [leaderShiftRight, leaderRight] : [leaderShiftLeft, leaderLeft];
    shift(m);
    while (yield* walkFrame(g)) frame(m);
    b = (b - 1) & 0xff;
  } while (b);
}

/** 01:68D2 / 68E5 / 68F8 / 690B (check) and 01:69D7 / 69EA / 69FD / 6A10 (no check) — b steps of
 *  the slot: a start (01:5121 ... / 01:5117 ...), then frames (01:41C0) while C2D0 & 0F. */
function* objectWalkSteps(g: Game, dir: number, b: number, check: boolean): Co {
  const m = g.m;
  do {
    if (check) objectWalk(g, dir);
    else objectStart(g, dir, false);
    while (yield* objectFrame(g)) objectMove(m, dir);
    b = (b - 1) & 0xff;
  } while (b);
}

/** The direction index of 01:67F5 / 01:691E: facing bits 7-6 -> 00 up, 40 right, 80 down, C0
 *  left. */
const dirOf = (f: number): number => f & 0xc0;

/** 01:67F5 — event 27, a walk of CA28 >> 4 steps (0: 256) by slot CA28 & 0F in its facing (slot
 *  0: C6EE), with the normal handlers meanwhile (00:1B2D / 00:1B50). */
export function* walkEvent(g: Game): Co {
  const m = g.m;
  yield* normalHandlers(g);
  eventSlot(m);
  const b = (m.rd(0xca28) >> 4) & 0x0f;
  if (!(m.rd(0xca28) & 0x0f)) yield* leaderWalk(g, dirOf(m.rd(0xc6ee)), b);
  else yield* objectWalkSteps(g, dirOf(fget(m, "c2d0")), b, true);
  yield* restoreHandlers(g);
}

/** 01:691E — event 28, as 27 but the steps are forced (no passability check; the leader keeps
 *  its sprite list: a step backwards). */
export function* shiftEvent(g: Game): Co {
  const m = g.m;
  yield* normalHandlers(g);
  eventSlot(m);
  const b = (m.rd(0xca28) >> 4) & 0x0f;
  if (!(m.rd(0xca28) & 0x0f)) yield* leaderShiftWalk(g, dirOf(m.rd(0xc6ee)), b);
  else yield* objectWalkSteps(g, dirOf(fget(m, "c2d0")), b, false);
  yield* restoreHandlers(g);
}

// ---------------------------------------------------------------- vehicle exits (bank 01)

/** 01:4198 — map C6E8 is 06-08 (z = true). */
function isMap678(m: Memory): boolean {
  const v = m.rd(0xc6e8);
  return v === 0x06 || v === 0x07 || v === 0x08;
}

/** 01:42E2 — story flag 04 set, then the cell C800-C803 (00:0187): attribute 00, 01, 02 or 88-8B
 *  clears flag 04 and returns false (z); other attributes return true (nz, flag 04 kept). */
function landingBlocked(g: Game): boolean {
  const m = g.m;
  setFlag(m, 0x04);
  cellRead(g);
  const a = m.rd(0xc805);
  if (a === 0x00 || a === 0x01 || a === 0x02 || (a & 0xfc) === 0x88) {
    clearFlag(m, 0x04);
    return false;
  }
  return true;
}

/** 00:089E — the leader's look (00:08AD), its cell (01:4000, bank 01). */
function* lookAndCell(g: Game): Co {
  yield* leaderLook(g);
  pushBank(g, 0x01);
  leaderInit(g);
  popBank(g);
}

/** 01:4307 — off the vehicle: C6E3 = 0, 00:089E, the companion (01:4F24). */
function* leaveVehicle(g: Game): Co {
  g.m.wr(0xc6e3, 0);
  yield* lookAndCell(g);
  companionFollow(g.m);
}

/** 01:4311 — vehicle state 1: a frame, the leader's cell (01:4700), 01:42E2; a landing cell: off
 *  (01:4307). */
function* leaveState1(g: Game): Co {
  yield* wait1(g);
  cellArgs(g.m);
  if (landingBlocked(g)) return;
  yield* leaveVehicle(g);
}

/** 01:4272 — vehicle state 2 (not on maps 06-08): a frame, the cell ahead in C6EE (01:4755 /
 *  4793 / 4774 / 4736), 01:42E2; a landing cell: a forced step onto it (01:5C02 ...), its frames
 *  (each step frame before the walk frame 01:41AF) and off (01:4307). */
function* leaveState2(g: Game): Co {
  const m = g.m;
  if (isMap678(m)) return;
  yield* wait1(g);
  setSlot(m, 0);
  const d = dirOf(m.rd(0xc6ee));
  leaderNext(m, d);
  if (landingBlocked(g)) return;
  const [shift, frame] = d === 0x00 ? [leaderShiftUp, leaderUp] : d === 0x80 ? [leaderShiftDown, leaderDown]
    : d === 0x40 ? [leaderShiftRight, leaderRight] : [leaderShiftLeft, leaderLeft];
  shift(m);
  do frame(m); while (yield* walkFrame(g));
  yield* leaveVehicle(g);
}

/** 00:0861 — event 12 special 0E, off the vehicle by C6E3 (bank 01): 0 nothing, 1 01:4311, 2
 *  01:4272, 3-8 01:4250. */
export function* leaveVehicleEvent(g: Game): Co {
  const s = g.m.rd(0xc6e3);
  if (s === 0x00) return;
  if (s === 0x01) yield* leaveState1(g);
  else if (s === 0x02) yield* leaveState2(g);
  else if (s <= 0x08) yield* disembark(g);
  else throw new NotPorted(`00:0864 vehicle state ${s.toString(16)}`);
}

/** 01:4250 — out of the vehicle into map 10: the leader's cell (01:4700), 01:42E2, C6E3 = C6F1 =
 *  C6F0 = 0, the speed, C6E4-C6E8 kept at C6E9 (00:1F87), then 01:636D: map 10 at (0, B0) facing
 *  up (00:027D). */
export function* disembark(g: Game): Co {
  const m = g.m;
  setSlot(m, 0);
  cellArgs(m);
  landingBlocked(g);
  m.wr(0xc6e3, 0);
  m.wr(0xc6f1, 0);
  m.wr(0xc6f0, 0);
  stepSpeed(m);
  copy(m, 0xc6e4, 0xc6e9, 5);
  m.wr(0xc6e4, 0x00);
  m.wr(0xc6e5, 0x00);
  m.wr(0xc6e6, 0xb0);
  m.wr(0xc6e7, 0x00);
  m.wr(0xc6ee, 0x00);
  m.wr(0xc6e8, 0x10);
  yield* loadMap(g);
}

// ---------------------------------------------------------------- scripted object spawns

/** 01:61D3 — the next spawn (CA60 < CA62): sound 16, the highest free slot (00:01DB) shown as
 *  kind 0F (C200 1, C2D0 0, C250 0, C280 50, C360 44, sprite facing 0) at y = swap of the CA68
 *  list's entry, x = the CA66 list's (cell units); CA60 + 1. */
function spawnNext(m: Memory): void {
  if (m.rd(0xca60) === m.rd(0xca62)) return;
  m.hram[0x3c] = 0x16;
  lastFreeSlot(m);
  fset(m, "c200", 0x01);
  fset(m, "c320", 0x0f);
  fset(m, "c2d0", 0x00);
  fset(m, "c250", 0x00);
  fset(m, "c280", 0x50);
  fset(m, "c360", 0x44);
  objectSprite(m, 0);
  const cell = (f: "c210" | "c230", list: number): void => {
    const b = m.rd((m.rd16(list) + m.rd(0xca60)) & 0xffff);
    fset(m, f, swap(b) & 0xf0);
    fset(m, f, swap(b) & 0x0f, 1);
  };
  cell("c210", 0xca68);
  cell("c230", 0xca66);
  m.wr(0xca60, m.rd(0xca60) + 1);
}

/** 01:617A — a spawn sequence from the table hl (8 bytes -> CA62-CA69: count, length in 16-frame
 *  ticks, the tick list, the x list, the y list), with the normal handlers and the shake on:
 *  each frame the animation, the objects' behaviour (01:4F66) and drawing; every 16th frame
 *  (FF93 & 0F = 0) a spawn when the tick CA61 matches, CA61 + 1; until CA61 = CA63. */
export function* spawnSequence(g: Game, hl: number): Co {
  const m = g.m;
  m.wr(0xca60, 0);
  m.wr(0xca61, 0);
  copy(m, hl, 0xca62, 8);
  yield* normalHandlers(g);
  m.wr(0xc6f2, 1);
  yield* wait1(g);
  do {
    mapAnimation(g);
    objectsUpdate(g);
    drawObjects(g);
    if (!(m.hram[0x13]! & 0x0f)) {
      const t = m.rd((m.rd16(0xca64) + m.rd(0xca60)) & 0xffff);
      if (m.rd(0xca61) === t) spawnNext(m);
      m.wr(0xca61, m.rd(0xca61) + 1);
    }
    yield* wait1(g);
  } while (m.rd(0xca63) !== m.rd(0xca61));
  m.wr(0xc6f2, 0);
  yield* restoreHandlers(g);
}

/** 01:6125 — event 1E 1D: sound 2D, the background palette inverted every 8 frames for 80
 *  frames (FF47 kept). */
export function* flashFrames(g: Game): Co {
  const m = g.m;
  m.hram[0x3c] = 0x2d;
  const bgp = m.rd(0xff47);
  for (let b = 0x80; b; b--) {
    if (!(m.hram[0x13]! & 0x07)) m.wr(0xff47, m.rd(0xff47) ^ 0xff);
    yield* wait1(g);
  }
  m.wr(0xff47, bgp);
}

// ---------------------------------------------------------------- event 25: the step down / up

/** 00:1AC3 — a step down (01:441D), then step frames until C6EF is 0 (01:445F, 01:41AF; a
 *  blocked start is not checked). */
export function* stepDown(g: Game): Co {
  const m = g.m;
  leaderStartDown(g);
  do leaderDown(m); while (yield* walkFrame(g));
}

/** 00:1ADE — a step up (01:44A8, 01:44E9, 01:41AF). */
export function* stepUp(g: Game): Co {
  const m = g.m;
  leaderStartUp(g);
  do leaderUp(m); while (yield* walkFrame(g));
}

// ---------------------------------------------------------------- map exits (bank 01)

/** 01:66B7 / 01:66AD / 01:66A1 — the return stack entries of level C7C8 - 2: C7B0 + (C7C8 - 2)
 *  (CA04 / CA05), C7A0 + (C7C8 - 2) (the cell y, x), C7C0 + (C7C8 - 2) / 2 (the map). */
const stackMasks = (m: Memory): number => (0xc7b0 + ((m.rd(0xc7c8) - 2) & 0xff)) & 0xffff;
const stackCell = (m: Memory): number => (0xc7a0 + ((m.rd(0xc7c8) - 2) & 0xff)) & 0xffff;
const stackMap = (m: Memory): number => (0xc7c0 + (((m.rd(0xc7c8) - 2) & 0xff) >> 1)) & 0xffff;

/** 01:6578 — event 04/05, back to the map of the return stack: CA04 / CA05, C6E4-C6E7 from the
 *  cell, one cell on in the facing C6EE, the map, C7C8 - 2, the load (00:027D). */
export function* exitBack(g: Game): Co {
  const m = g.m;
  let hl = stackMasks(m);
  m.wr(0xca04, m.rd(hl++));
  m.wr(0xca05, m.rd(hl));
  hl = stackCell(m);
  m.wr(0xc6e4, swap(m.rd(hl)) & 0xf0);
  m.wr(0xc6e5, swap(m.rd(hl)) & 0x0f);
  hl++;
  m.wr(0xc6e6, swap(m.rd(hl)) & 0xf0);
  m.wr(0xc6e7, swap(m.rd(hl)) & 0x0f);
  const d = m.rd(0xc6ee);
  const step = (lo: number, hi: number, delta: number, mask: number): void => {
    const s = m.rd(lo) + delta;
    m.wr(lo, s & 0xff);
    m.wr(hi, ((m.rd(hi) + (s > 0xff ? 1 : s < 0 ? -1 : 0)) & 0xff) & m.rd(mask));
  };
  if (d === 0x00) step(0xc6e4, 0xc6e5, -0x10, 0xca04);
  else if (d === 0x40) step(0xc6e6, 0xc6e7, 0x10, 0xca05);
  else if (d === 0x80) step(0xc6e4, 0xc6e5, 0x10, 0xca04);
  else step(0xc6e6, 0xc6e7, -0x10, 0xca05);
  m.wr(0xc6e8, m.rd(stackMap(m)));
  m.wr(0xc7c8, m.rd(0xc7c8) - 2);
  yield* loadMap(g);
}

/** 01:661C — event 08/09's fall: slot 0 and 1 states cleared (C200 / C201), the objects drawn, a
 *  forced step down (01:5C22) with its frames (01:445F, 00:01A0, a frame) until C6EF is 0, then
 *  C6E4/C6E5 - 10 (unmasked). */
export function* fallStep(g: Game): Co {
  const m = g.m;
  setSlot(m, 0);
  m.wr(0xc200, 0);
  m.wr(0xc201, 0);
  drawObjects(g);
  leaderShiftDown(m);
  do {
    leaderDown(m);
    drawObjects(g);
    yield* wait1(g);
  } while (m.rd(0xc6ef));
  const s = m.rd(0xc6e4) - 0x10;
  m.wr(0xc6e4, s & 0xff);
  m.wr(0xc6e5, (m.rd(0xc6e5) - (s < 0 ? 1 : 0)) & 0xff);
}

/** 01:664B — event 10 A: a return stack from the table 01:66C1[(CA28 - 1) & 0F]: C7C8 = its
 *  first byte, then per level (C7C8 / 2, top down) the masks (low / high nibble), the cell (2
 *  bytes) and the map; C7C8 back; C7C9-C7CB = level 0's cell and map. */
export function stackFromTable(m: Memory): void {
  let de = tableWord(m, 0x66c1, (m.rd(0xca28) - 1) & 0x0f);
  const n = m.rd(de++);
  m.wr(0xc7c8, n);
  let b = n >> 1;
  do {
    let hl = stackMasks(m);
    m.wr(hl++, m.rd(de) & 0x0f);
    m.wr(hl, swap(m.rd(de) & 0xf0));
    de++;
    hl = stackCell(m);
    m.wr(hl++, m.rd(de++));
    m.wr(hl, m.rd(de++));
    m.wr(stackMap(m), m.rd(de++));
    m.wr(0xc7c8, m.rd(0xc7c8) - 2);
    b = (b - 1) & 0xff;
  } while (b);
  m.wr(0xc7c8, n);
  m.wr(0xc7cb, m.rd(0xc7c0));
  m.wr(0xc7c9, m.rd(0xc7a0));
  m.wr(0xc7ca, m.rd(0xc7a1));
}

/** 01:6A23 — event 10 5: the highest free slot (00:01DB) placed at the leader's target cell
 *  (C290 / C2B0, also its pixel position C210 / C230). */
export function followerAtLeader(m: Memory): void {
  setSlot(m, 0);
  m.wr(0xc800, fget(m, "c290")); m.wr(0xc801, fget(m, "c290", 1));
  m.wr(0xc802, fget(m, "c2b0")); m.wr(0xc803, fget(m, "c2b0", 1));
  lastFreeSlot(m);
  fset(m, "c290", m.rd(0xc800)); fset(m, "c210", m.rd(0xc800));
  fset(m, "c290", m.rd(0xc801), 1); fset(m, "c210", m.rd(0xc801), 1);
  fset(m, "c2b0", m.rd(0xc802)); fset(m, "c230", m.rd(0xc802));
  fset(m, "c2b0", m.rd(0xc803), 1); fset(m, "c230", m.rd(0xc803), 1);
}

/** 01:6A74 — event 10 4: the follower's place C6E9-C6ED from entry (CA28 & 0F) - 1 of 01:6AAC
 *  (3 bytes: y, x cells, map; 00:1C7E for the offset). */
export function followerPlace(m: Memory): void {
  const n = ((m.rd(0xca28) & 0x0f) - 1) & 0xff;
  let hl = (0x6aac + ((n * 3) & 0xffff)) & 0xffff;
  m.wr(0xc6e9, swap(m.rd(hl)) & 0xf0);
  m.wr(0xc6ea, swap(m.rd(hl++)) & 0x0f);
  m.wr(0xc6eb, swap(m.rd(hl)) & 0xf0);
  m.wr(0xc6ec, swap(m.rd(hl++)) & 0x0f);
  m.wr(0xc6ed, m.rd(hl));
}

/** 01:64B4 — event 0F / 2F / 3F, the text of the map C6E8 from the lists 01:6503 / 6563 / 6575
 *  (by CA29; 33 entries at most) and the pointer tables 01:6523 / 6569 / 6576 (texts in bank 0A,
 *  mode 0, box (1,1) 18 x 6); a map not listed: nothing. Returns the text address or null. */
export function mapText(m: Memory): number | null {
  const c = m.rd(0xc6e8);
  const t = m.rd(0xca29);
  let hl = t === 0x0f ? 0x6503 : t === 0x2f ? 0x6563 : 0x6575;
  let b = 0xff;
  for (;;) {
    b = (b + 1) & 0xff;
    if (m.rd(hl++) === c) break;
    if (b === 0x20) return null;
  }
  const p = t === 0x0f ? 0x6523 : t === 0x2f ? 0x6569 : 0x6576;
  return tableWord(m, p, b);
}

/** 01:5B06 / 01:5B28 — 8 rows of a tile at de mixed with the tile 20 bytes before it (5B06: de's
 *  bits 55 with the other's AA; 5B28: AA with 55), then 20 bytes hl -> bc (00:015F). */
function tileMix(m: Memory, hl: number, de: number, bc: number, keep: number): void {
  let src = (de - 0x20) & 0xffff;
  for (let c = 8; c; c--) {
    for (let k = 2; k; k--) {
      m.wr(de, (m.rd(de) & keep) | (m.rd(src++) & (keep ^ 0xff)));
      de++;
    }
    src += 2;
    de += 2;
  }
  vramCopy(m, hl, bc, 0x20);
}

/** 01:5A6B — event 29, a tile morph: 94C0, 9200, 95C0, 9300 -> C800-C87F (00:015F), then four
 *  steps of 20 frames mixing the 9200 / 9300 tiles towards the 94C0 / 95C0 ones by alternate
 *  bits (01:5B06 / 01:5B28); CA17 = 11, story flag EC. */
export function* tileMorph(g: Game): Co {
  const m = g.m;
  let de = 0xc800;
  for (const hl of [0x94c0, 0x9200, 0x95c0, 0x9300]) [, de] = vramCopy(m, hl, de, 0x20);
  yield* g.wait(0x20);
  tileMix(m, 0xc820, 0xc820, 0x9200, 0x55);
  tileMix(m, 0xc860, 0xc860, 0x9300, 0x55);
  yield* g.wait(0x20);
  tileMix(m, 0xc820, 0xc822, 0x9200, 0xaa);
  tileMix(m, 0xc860, 0xc862, 0x9300, 0xaa);
  yield* g.wait(0x20);
  tileMix(m, 0xc820, 0xc820, 0x9200, 0xaa);
  tileMix(m, 0xc860, 0xc860, 0x9300, 0xaa);
  yield* g.wait(0x20);
  tileMix(m, 0xc820, 0xc822, 0x9200, 0x55);
  tileMix(m, 0xc860, 0xc862, 0x9300, 0x55);
  yield* g.wait(0x20);
  m.wr(0xca17, 0x11);
  setFlag(m, 0xec);
}

/** 00:1586 — the slots whose state C200 is b freed (C200 and C370 = 0), FF96 from 0 to 10. */
export function freeSlotsOf(m: Memory, b: number): void {
  for (setSlot(m, 0); slot(m) !== 0x10; setSlot(m, slot(m) + 1)) {
    if (fget(m, "c200") !== b) continue;
    fset(m, "c200", 0);
    fset(m, "c370", 0);
  }
}

/** 01:4063 — a vehicle object (state FE, kind 20, tile base 20, facing 80) in the highest free
 *  slot, 50 px above the leader's position, then 24 frames of the objects' behaviour (01:4F66:
 *  kind 20 falls 2 px a frame), animation, drawing. */
function* vehicleArrives(g: Game): Co {
  const m = g.m;
  setSlot(m, 0);
  m.wr(0xc800, fget(m, "c210")); m.wr(0xc801, fget(m, "c210", 1));
  m.wr(0xc802, fget(m, "c230")); m.wr(0xc803, fget(m, "c230", 1));
  lastFreeSlot(m);
  fset(m, "c200", 0xfe);
  const s = m.rd(0xc800) - 0x50;
  fset(m, "c210", s & 0xff);
  fset(m, "c210", ((m.rd(0xc801) - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca04), 1);
  fset(m, "c230", m.rd(0xc802)); fset(m, "c230", m.rd(0xc803), 1);
  fset(m, "c280", 0x20);
  fset(m, "c250", 0x00);
  fset(m, "c360", 0x00);
  fset(m, "c320", 0x20);
  fset(m, "c2d0", 0x80);
  objectSprite(m, 0x80);
  for (let b = 0x24; b; b--) {
    objectsUpdate(g);
    mapAnimation(g);
    drawObjects(g);
    yield* wait1(g);
  }
}

/** 01:4049 — event 12 0D, boarding: sound 1F, the vehicle comes down (01:4063), C6E3 = 1, the
 *  leader's look and cell (00:089E), the companion (01:4F24), the vehicle object freed (00:1586
 *  b = FE). */
export function* boardVehicle(g: Game): Co {
  const m = g.m;
  m.hram[0x3c] = 0x1f;
  yield* vehicleArrives(g);
  setSlot(m, 0);
  m.wr(0xc6e3, 0x01);
  yield* lookAndCell(g);
  companionFollow(m);
  freeSlotsOf(m, 0xfe);
}

/** 01:610D — event 12 11: C6FB = the highest item flag set (00:2901), searching down from DB. */
export function highestItemFlag(m: Memory): void {
  let b = 0xdc;
  for (;;) {
    b = (b - 1) & 0xff;
    const k = (b - 0xd8) & 0xff;
    const hl = k >= 0x08 ? 0xc6f9 : 0xc6f8;
    if ((0x80 >> (k & 0x07)) & m.rd(hl)) break;
  }
  m.wr(0xc6fb, b);
}
