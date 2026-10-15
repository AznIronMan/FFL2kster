/** Legend III text engine control codes: the handlers of the word table 00:3175 (codes 00-4D),
 *  shared by the text interpreter 00:3211 (CD3A clear: characters go to the line buffer C894 and
 *  are flushed, 00:3127 / 00:3304 / 00:331B) and the menu box renderer 09:4FEF (CD3A set: letters
 *  copied into the row at de on a letter row, CD12 bit 0; the row count b loses them, 00:3168).
 *  A handler runs with hl = the text after the code byte, de = the output position, b = the
 *  column counter; `textCode` returns its [hl, de, b]. The scene codes (0A, 0D, 12, 13, 32, 38,
 *  3B, 3D, 3F -> 00:3086) and the dictionary codes (-> 00:308C) are handled by the callers.
 *
 *  Number formatting is 00:2009 (CD2B-CD31, blanked leading zeros); many codes print fields of a
 *  member's record (00:1FCD: C500 + the record offset) or of the entity CD36 (00:1FC4). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, farSync, far0, copy, copyB, fill, vramCopy, memberOffset, wait1, soundBuzz } from "./sys.js";
import { NotPorted } from "./irq.js";
import { flush, lineReset, textDelay, printText } from "./text.js";
import { param } from "./menu.js";
import { boxFrame, windowToggle } from "./window.js";
import { scriptRef } from "./events.js";
import { testFlag, setFlag, clearFlag } from "./objects.js";
import { entityOffset } from "./bstats.js";
import { memberLimit } from "./sprites.js";
import { menuInput } from "./title.js";
import { sceneTextCode, dictTextCode, lowestSetBit } from "./textmore.js";

// ---------------------------------------------------------------- bank-0 helpers

/** swap (nibbles). */
const swap = (a: number): number => ((a << 4) | (a >> 4)) & 0xff;

/** 00:1FCD — the record offset of member a (the table index 2a is computed in 8 bits). */
const recordOffset = (m: Memory, a: number): number => memberOffset(m, a & 0x7f);

/** 00:1EE7 — the index of the lowest set bit of a (rra until carry). */
function lowestBit(a: number): number {
  return lowestSetBit(a, false); // both callers (00:2801, 00:3073) enter with the carry clear
}

/** 00:1EF1 — the bit 1 << a (0 for a >= 8). */
const bitOf = (a: number): number => (a < 8 ? (1 << a) & 0xff : 0);

/** 00:2009 — the number at hl in decimal tiles (B0 = '0'): a = 1: the byte at hl (CD2B-CD2E =
 *  B0, CD2F-CD31 hundreds, tens, ones); a = 2: the word at hl (CD2B/CD2C = B0, CD2D-CD31 10000s
 *  .. ones); otherwise the 3 bytes at hl (CD32/CD33 the digit pointer from CD2B: millions to
 *  10000s at CD2B-CD2D, then CD2E-CD31). Then up to 6 leading B0 from CD2B -> FF. */
function decimal(m: Memory, a: number, hl: number): void {
  let p: number;
  let v: number; // the remainder below 100 (00:2072)
  /** 00:20AA — the 16-bit digit of bc at p (AF counted up). */
  const digit16 = (de: number, bc: number): number => {
    const q = Math.floor(de / bc);
    m.wr(p++, (0xb0 + q) & 0xff);
    return de - q * bc;
  };
  if (a === 1) {
    // 00:2062
    v = m.rd(hl);
    fill(m, 0xcd2b, 4, 0xb0);
    p = 0xcd2f;
    m.wr(p++, (0xb0 + Math.floor(v / 100)) & 0xff); // 00:20BD
    v %= 100;
  } else {
    let de: number;
    if (a === 2) {
      // 00:2042
      de = m.rd16(hl);
      m.wr(0xcd2b, 0xb0);
      m.wr(0xcd2c, 0xb0);
      p = 0xcd2d;
      de = digit16(de, 10000);
    } else {
      // 00:2011: 3 bytes e, d, b; the digits through the pointer CD32/CD33
      let n = m.rd(hl) | (m.rd(hl + 1) << 8) | (m.rd(hl + 2) << 16);
      m.wr(0xcd32, 0x2b);
      m.wr(0xcd33, 0xcd);
      for (const div of [1000000, 100000, 10000]) {
        const q = Math.floor(n / div); // 00:208E
        n -= q * div;
        const at = m.rd16(0xcd32);
        m.wr(at, (0xb0 + q) & 0xff);
        m.wr16(0xcd32, (at + 1) & 0xffff);
      }
      de = n & 0xffff;
      p = 0xcd2e;
    }
    // 00:2053
    de = digit16(de, 1000);
    de = digit16(de, 100);
    v = de & 0xff;
  }
  // 00:2072
  m.wr(p++, (0xb0 + Math.floor(v / 10)) & 0xff);
  m.wr(p, (0xb0 + (v % 10)) & 0xff);
  p = 0xcd2b;
  for (let b = 6; b && m.rd(p) === 0xb0; b--) m.wr(p++, 0xff);
}

/** 00:1E8F — the name of id [hl]: FF: 00:3155 (blanks), c = 8; below 30: 6D9B + 6 id, c = 6;
 *  30 and above: 6EBB + 8 (id - 30), c = 8 (bank 0E as selected). Returns [hl, c]. */
function nameSource(m: Memory, hl: number): [number, number] {
  const a = m.rd(hl);
  if (a === 0xff) return [0x3155, 0x08];
  if (a < 0x30) return [(0x6d9b + a * 6) & 0xffff, 0x06];
  return [(0x6ebb + ((a - 0x30) & 0xff) * 8) & 0xffff, 0x08];
}

/** 00:2901 — the item flag of a (D8-E7: bit 7 - (k & 7) of C6F8 / C6F9 for k = a - D8): set? */
function itemFlag(m: Memory, a: number): boolean {
  const k = (a - 0xd8) & 0xff;
  const hl = k >= 0x08 ? 0xc6f9 : 0xc6f8;
  return !!(bitOf(((~(k & 0x07)) + 0x08) & 0xff) & m.rd(hl));
}

/** 00:29EF — the status index e of member a (CD37 clear: the first set bit of C501 & FC from
 *  bit 7, 1-6; CD37 set, the entity CD36: C501 bits 7-6 -> 1-2, C502 bits 7-5 -> 7-9, C501 bits
 *  5-2 -> 3-6); none: hl = 6D73, else hl = 6D73 + 4 e. */
function statusText(m: Memory, a: number): number {
  let e = 0;
  if (!m.rd(0xcd37)) {
    let v = m.rd((recordOffset(m, a) + 0xc501) & 0xffff) & 0xfc;
    if (!v) return 0x6d73;
    for (;;) { e++; const c = v & 0x80; v = (v << 1) & 0xff; if (c) break; }
  } else {
    const hl = (entityOffset(m) + 0xc501) & 0xffff;
    const s1 = m.rd(hl), s2 = m.rd((hl + 1) & 0xffff);
    if (!((s1 & 0xfc) | (s2 & 0xe0))) return 0x6d73;
    // 00:2A4B: e + 1 per bit from bit 7, d bits at most; carry = found
    const scan = (v: number, d: number): boolean => {
      for (;;) {
        e = (e + 1) & 0xff;
        const c = v & 0x80;
        v = (v << 1) & 0xff;
        if (c) return true;
        if (!--d) return false;
      }
    };
    e = 0;
    if (!scan(s1, 2)) {
      e = 6;
      if (!scan(s2, 3)) {
        e = 2;
        scan((s1 << 2) & 0xff, 4);
      }
    }
  }
  return (0x6d73 + ((e * 4) & 0xffff)) & 0xffff;
}

/** 0B:706C — one of item CE91 taken from the bag C6FF (0x18 pairs id, count): not found or a
 *  count of 0: CE91 = FF; else the count - 1. Returns hl (the count's address when found). */
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

/** 09:51EA — CD20 = the spell of the (a + 1)-th set bit of the spell bits C551 + the record of
 *  CD36 (6 bytes, MSB first; ((6 - c) ^ 1) * 8 + b - 1); FF when there is none. */
function spellIndex(m: Memory, a: number): void {
  let hl = (entityOffset(m) + 0xc551) & 0xffff;
  let e = (a + 1) & 0xff;
  for (let c = 6; c; c--) {
    let v = m.rd(hl);
    hl = (hl + 1) & 0xffff;
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

/** 00:2E54 — the price of item a (bank 01): CE7C-CE7E = 0, then below D2 CE7C/CE7D = the word
 *  at 7E4F + 2a. */
function itemPrice(g: Game, a: number): void {
  const m = g.m;
  pushBank(g, 0x01);
  fill(m, 0xce7c, 3, 0x00);
  if (a < 0xd2) {
    const hl = (0x7e4f + 2 * a) & 0xffff;
    m.wr(0xce7c, m.rd(hl));
    m.wr(0xce7d, m.rd((hl + 1) & 0xffff));
  }
  popBank(g);
}

/** 01:7726 — the word at hl + de -> the word 2 bytes below it; returns de (the word). */
function wordDown(m: Memory, hl: number, off: number): number {
  let p = (hl + off) & 0xffff;
  const d = m.rd(p); p = (p - 1) & 0xffff;
  const e = m.rd(p); p = (p - 1) & 0xffff;
  m.wr(p, d); p = (p - 1) & 0xffff;
  m.wr(p, e);
  return (d << 8) | e;
}

/** 01:7701 — every member (4; 5 with a member limit, 0B:6D12) not dead (C501 bit 6): the words
 *  C516 -> C514 and C512 -> C510. Returns de as left (the last member is 0). */
function healAll(g: Game): number {
  const m = g.m;
  const z = farSync(g, 0x0b, () => memberLimit(m)) === 0;
  let de = 0;
  for (let b = z ? 4 : 5; b; b--) {
    // 01:7713
    const hl = (recordOffset(m, b - 1) + 0xc501) & 0xffff;
    de = 0xc501;
    if (m.rd(hl) & 0x40) continue;
    wordDown(m, hl, 0x16);
    de = wordDown(m, hl, 0x12);
  }
  return de;
}

/** 0B:6C5E — a = 0: 01:7701 (returns de, b = 0); else the status bits 7-2 of C501 cleared for
 *  the 5 records (every 0x60). Returns [de, b] or null (kept). */
function restore(g: Game, a: number): [number, number] | null {
  const m = g.m;
  if (!a) return [farSync(g, 0x01, () => healAll(g)), 0];
  let hl = 0xc501;
  for (let b = 5; b; b--) {
    m.wr(hl, m.rd(hl) & 0x03);
    hl = (hl + 0x60) & 0xffff;
  }
  return null;
}

// ---------------------------------------------------------------- 00:3114: characters

/** 00:3304 — b tiles from de into the lower line buffer C894 + CD06 (CD06 += b); flushed
 *  (00:331B) unless CD34 bit 2. */
function* putTiles(g: Game, de: number, b: number): Co {
  const m = g.m;
  const at = m.rd(0xcd06);
  m.wr(0xcd06, (at + b) & 0xff);
  copy(m, de, (0xc894 + at) & 0xffff, b);
  if (m.rd(0xcd34) & 0x04) return;
  yield* flush(g);
}

/** 00:3127 — c characters at hl into the text line: CD34 bit 1 (cleared here) trims the blanks
 *  (FF): the leading ones when the first is FF, else the trailing ones. Returns [de, b]. */
function* lineChars(g: Game, hl: number, c: number): Co<[number, number]> {
  const m = g.m;
  let b = c, de = hl;
  const a = m.rd(0xcd34);
  if (!(a & 0x02)) {
    yield* putTiles(g, de, b);
    return [(de + b) & 0xffff, 0];
  }
  m.wr(0xcd34, (a - 0x02) & 0xff);
  if (m.rd(hl) === 0xff) {
    // 00:314A
    for (;;) {
      if (m.rd(de) !== 0xff) {
        yield* putTiles(g, de, b);
        return [(de + b) & 0xffff, 0];
      }
      de = (de + 1) & 0xffff;
      b = (b - 1) & 0xff;
      if (!b) return [de, 0];
    }
  }
  let p = (hl + b - 1) & 0xffff;
  for (;;) {
    if (m.rd(p) !== 0xff) {
      yield* putTiles(g, de, b);
      return [(de + b) & 0xffff, 0];
    }
    p = (p - 1) & 0xffff;
    b = (b - 1) & 0xff;
    if (!b) return [de, 0];
  }
}

/** 00:3114 — c characters from hl (none when c = 0): CD3A set (menus, 00:3168): copied to de on
 *  a letter row (CD12 bit 0, 00:1F97), de += c either way, b -= c; CD3A clear: the text line
 *  (00:3127). Returns [de, b]. */
function* chars(g: Game, hl: number, c: number, de: number, b: number): Co<[number, number]> {
  const m = g.m;
  c &= 0xff;
  if (!c) return [de, b];
  if (m.rd(0xcd3a)) {
    if (m.rd(0xcd12) & 0x01) copyB(m, hl, de, c);
    return [(de + c) & 0xffff, (b - c) & 0xff];
  }
  return yield* lineChars(g, hl, c);
}

/** 00:3108 — 00:3114 with bank a selected (rst $20 / rst $28 around it). */
function* charsIn(g: Game, bank: number, hl: number, c: number, de: number, b: number): Co<[number, number]> {
  pushBank(g, bank);
  const r = yield* chars(g, hl, c, de, b);
  popBank(g);
  return r;
}

// ---------------------------------------------------------------- waits and the box

/** 00:276D — up to c frames (0 = 256), cut short by A (FF8B): returns whether A ended it. */
function* pauseFrames(g: Game, c: number): Co<boolean> {
  for (;;) {
    yield* wait1(g);
    if (g.m.hram[0x0b]! & 0x01) return true;
    c = (c - 1) & 0xff;
    if (!c) return false;
  }
}

/** 00:2766 — a pause of n = [hl] frames, then n more, cut short by A. Returns hl + 1. */
function* pause(g: Game, hl: number): Co<number> {
  const n = g.m.rd(hl);
  if (!(yield* pauseFrames(g, n))) yield* pauseFrames(g, n);
  return (hl + 1) & 0xffff;
}

/** 00:275C — flush the line (00:331B), then poll FF8B until A is pressed (no frame wait). */
function* waitA(g: Game): Co {
  yield* flush(g);
  yield* g.until(() => !!(g.m.hram[0x0b]! & 0x01));
}

/** 00:3468 — 18 FF tiles at hl (0F:792C). */
function blankRow(g: Game, hl: number): void {
  farSync(g, 0x0f, () => fill(g.m, hl, 0x12, 0xff));
}

/** 00:34B2 — b rows of the window box (from 9C01 + 2 swap(a)) moved up 2 rows (00:20FF, 20
 *  tiles a row); CD38 = 1. */
function scrollRows(g: Game, a: number, b: number): void {
  const m = g.m;
  m.wr(0xcd38, 1);
  let de = (0x9c01 + 2 * swap(a)) & 0xffff;
  let hl = (de + 0x40) & 0xffff;
  for (; b; b--) {
    const [h2, d2] = vramCopy(m, hl, de, 0x14);
    hl = (h2 + 0x0c) & 0xffff;
    de = (d2 + 0x0c) & 0xffff;
  }
}

/** 00:342C — the box is full: the text delay, 4 rows up (CD37, battle: 2), the last two rows
 *  blank. */
function* scrollBox(g: Game): Co {
  yield* textDelay(g);
  if (g.m.rd(0xcd37)) {
    scrollRows(g, 1, 2);
    blankRow(g, 0x9c61);
    blankRow(g, 0x9c81);
  } else {
    scrollRows(g, 1, 4);
    blankRow(g, 0x9ca1);
    blankRow(g, 0x9cc1);
  }
}

/** 00:26CC — code 06, new line: menus (CD3A) the rest of the row blank (b blanks of 00:3155);
 *  CD34 bit 4 (cleared): the lower line buffer (18 tiles) to the upper one, CD06 = 0; otherwise
 *  the line flushed (CD34 bit 2 then ends it) and the cursor CD04 two rows down at column CD02,
 *  at the box's bottom row (CD03 + CD01 + 2) kept there with the box scrolled (00:342C);
 *  CD07 = 0. Returns [de, b] as the registers are left (text: d = the new row, b = the high
 *  byte of the new cursor). */
function* newline(g: Game, de: number, b: number): Co<[number, number]> {
  const m = g.m;
  if (m.rd(0xcd3a)) return yield* chars(g, 0x3155, b, de, b);
  const cd34 = m.rd(0xcd34);
  if (cd34 & 0x10) {
    m.wr(0xcd34, cd34 & 0xef);
    copy(m, 0xc894, 0xc880, 18); // 00:1F60
    m.wr(0xcd06, 0);
    return [0xc880 + 18, b];
  }
  if (m.rd(0xcd06)) {
    yield* flush(g);
    if (m.rd(0xcd34) & 0x04) return [de, b];
  }
  const at = m.rd16(0xcd04);
  const bc = (((at & 0xffe0) | m.rd(0xcd02)) + 0x40) & 0xffff;
  const row = (bc >> 5) & 0x1f;
  if (((m.rd(0xcd03) + m.rd(0xcd01) + 2) & 0xff) === row) {
    m.wr16(0xcd04, (bc - 0x40) & 0xffff);
    yield* scrollBox(g);
  } else m.wr16(0xcd04, bc);
  m.wr(0xcd07, 0);
  return [(row << 8) | (de & 0xff), bc >> 8];
}

// ---------------------------------------------------------------- printing handlers

/** 00:27CD — code 1D p: the class (?) name of member p (p < 9: C50D & 7 = 2 shows blanks, else
 *  0E:7533 + 8 [C50E]); p >= 9: the entity of the lowest set bit of CC55 + p (+ 5; 0: blanks).
 *  8 letters, bank 0E. */
function* code1D(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const [a, after] = param(m, hl);
  let src: number;
  if (a < 0x09) {
    const p = (recordOffset(m, a) + 0xc50d) & 0xffff;
    src = (m.rd(p) & 0x07) === 0x02 ? 0x3155 : (0x7533 + 8 * m.rd((p + 1) & 0xffff)) & 0xffff;
  } else {
    const v = m.rd((0xcc55 + a) & 0xffff);
    if (!v) src = 0x3155;
    else {
      const k = (lowestBit(v) + 0x05) & 0xff;
      const p = (recordOffset(m, k) + 0xc50e) & 0xffff;
      src = (0x7533 + 8 * m.rd(p)) & 0xffff;
    }
  }
  [de, b] = yield* charsIn(g, 0x0e, src, 0x08, de, b);
  return [after, de, b];
}

/** 00:2818 — code 1E a (bank 0E selected by 00:280F): a name.
 *  - below 20: bag entry a (C6FF + 2a); with a range CD21..CD22 set, an id outside it shows
 *    F2 x 8 (00:2915);
 *  - 20-2F: equipment slot a - 20 of the entity CD36 (C540 + ...): the name from its second
 *    letter, 7 letters (FF: the slot's label 00:291D + 7 (a - 20));
 *  - 30-35: CE2B + ..., 36-39: CE31 + 2 (...), 3F: CE94 (FF: blanks); 3A-3E: CE3C + ...;
 *  - 40-4F: CE94 = item 98 + a when its flag (00:2901) is set, else FF; then as 3F;
 *  - 50-7F: the item CE94 (09:67F7 + 8 id; FF: blanks);
 *  - 80 and above: C564 of the entity CD36 (C562 = 10: 09:67F7 + 8 id).
 *  A 6-letter name gets 2 blanks unless CD34 bit 1 (the trim) is set (00:283A). */
function* itemName(g: Game, a: number, de: number, b: number): Co<[number, number]> {
  const m = g.m;
  const named = function* (p: number): Co<[number, number]> { // 00:283A
    const [src, c] = nameSource(m, p);
    if (c !== 0x06 || (m.rd(0xcd34) & 0x02)) return yield* chars(g, src, c, de, b);
    [de, b] = yield* chars(g, src, c, de, b);
    return yield* chars(g, 0x3155, 0x02, de, b);
  };
  const orBlank = function* (p: number): Co<[number, number]> { // 00:28BA
    if (m.rd(p) === 0xff) return yield* chars(g, 0x3155, 0x08, de, b);
    return yield* named(p);
  };
  if (a < 0x20) {
    const p = (0xc6ff + 2 * a) & 0xffff;
    const id = m.rd(p);
    if (id !== 0xff && m.rd(0xcd22)) {
      const d = (m.rd(0xcd22) + 1) & 0xff, e = m.rd(0xcd21);
      if (id < e || id >= d) return yield* chars(g, 0x2915, 0x08, de, b);
    }
    return yield* named(p);
  }
  if (a < 0x30) {
    const e = (a - 0x20) & 0xff;
    const p = (entityOffset(m) + 0xc540 + e) & 0xffff;
    let src: number;
    if (m.rd(p) === 0xff) src = (0x291d + 7 * e) & 0xffff;
    else src = (nameSource(m, p)[0] + 1) & 0xffff;
    return yield* chars(g, src, 0x07, de, b);
  }
  if (a < 0x40) {
    if (a === 0x3f) return yield* orBlank(0xce94);
    if (a < 0x36) return yield* orBlank((0xce2b + a - 0x30) & 0xffff);
    if (a < 0x3a) return yield* orBlank((0xce31 + 2 * (a - 0x36)) & 0xffff);
    return yield* named((0xce3c + a - 0x3a) & 0xffff);
  }
  if (a < 0x50) {
    const k = (a + 0x98) & 0xff;
    m.wr(0xce94, itemFlag(m, k) ? k : 0xff);
    return yield* orBlank(0xce94);
  }
  if (a < 0x80) return yield* itemOrBlank(g, m.rd(0xce94), de, b);
  const p = (entityOffset(m) + 0xc562) & 0xffff;
  const v = m.rd(p);
  const q = (p + 2) & 0xffff;
  if (v !== 0x10) return yield* named(q);
  const src = (0x67f7 + 8 * m.rd(q)) & 0xffff;
  popBank(g);
  pushBank(g, 0x09);
  return yield* chars(g, src, 0x08, de, b);
}

/** 00:2AEC — item a: blanks for FF, else 09:67F7 + 8 a; 8 letters (00:3108, bank 09). */
function* itemOrBlank(g: Game, a: number, de: number, b: number): Co<[number, number]> {
  const src = a === 0xff ? 0x3155 : (0x67f7 + 8 * a) & 0xffff;
  return yield* charsIn(g, 0x09, src, 0x08, de, b);
}

/** 00:2955 — code 1F p: a member's name (p < 5: the 6 letters at C507 + the record, copied to
 *  CDA9 with 4C shown as blank; CD34 bit 1 (cleared): trailing blanks dropped), an entity's (5-F:
 *  8 at C505 + ...), a monster name (10-1F: 07:7A88 + 60 (p - 0C), 6 letters, trimmed: CD34 bit
 *  1 set) or (20 and above) the class name of the name entry's record (C68D bits 3-6 -> 00:29D7
 *  -> 09:78D7 + ..., 7 letters). */
function* code1F(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const [a, after] = param(m, hl);
  if (a < 0x10) {
    const off = recordOffset(m, a);
    if (a < 0x05) {
      copy(m, (0xc507 + off) & 0xffff, 0xcda9, 6); // 00:1F84
      let c = 6;
      const cd34 = m.rd(0xcd34);
      if (cd34 & 0x02) {
        m.wr(0xcd34, cd34 & 0xfd);
        for (let p = 0xcdae; ; p--) {
          if (m.rd(p) !== 0xff) break;
          c = (c - 1) & 0xff;
          if (!c) break;
        }
      }
      for (let p = 0xcdae; p >= 0xcda9; p--) if (m.rd(p) === 0x4c) m.wr(p, 0xff);
      [de, b] = yield* chars(g, 0xcda9, c, de, b);
    } else {
      [de, b] = yield* chars(g, (0xc505 + off) & 0xffff, 0x08, de, b);
    }
  } else if (a < 0x20) {
    const k = (a - 0x0c) & 0xff;
    const src = (k * 0x60 + 0x7a88) & 0xffff; // 00:246B
    m.wr(0xcd34, m.rd(0xcd34) | 0x02); // 00:27C5
    [de, b] = yield* charsIn(g, 0x07, src, 0x06, de, b);
  } else {
    const k = (m.rd(0xc68d) >> 3) & 0x0f;
    const t = m.rd(0x29d7 + k);
    [de, b] = yield* charsIn(g, 0x09, (0x78d7 + t) & 0xffff, 0x07, de, b);
  }
  return [after, de, b];
}

/** 00:30E8 — field c of member a as a 2-digit number (00:2009 of the byte at C500 + c + the
 *  record): the last two digits CD30/CD31, or "99" (00:3106) from 100 on. */
function* twoDigits(g: Game, a: number, c: number, de: number, b: number): Co<[number, number]> {
  const m = g.m;
  decimal(m, 1, (recordOffset(m, a) + 0xc500 + c) & 0xffff);
  const src = m.rd(0xcd2f) === 0xff ? 0xcd30 : 0x3106;
  return yield* chars(g, src, 0x02, de, b);
}

/** 00:2D03 + 00:30E8 — the stat label a (67BF + a, 7 letters, bank as selected), then the
 *  member parameter at hl (00:20DE) and its field c as 2 digits. Returns [hl, de, b]. */
function* statLine(g: Game, a: number, c: number, hl: number, de: number, b: number): Co<[number, number, number]> {
  [de, b] = yield* chars(g, (0x67bf + a) & 0xffff, 0x07, de, b);
  const [p, after] = param(g.m, hl);
  [de, b] = yield* twoDigits(g, p, c, de, b);
  return [after, de, b];
}

/** 00:2B97 — the word at C500 + c + the record of member a (999 from 3E7 on, 00:2BBF) as 3
 *  digits (CD2F-CD31). */
function* threeDigits(g: Game, a: number, c: number, de: number, b: number): Co<[number, number]> {
  const m = g.m;
  let hl = (recordOffset(m, a) + 0xc500 + c) & 0xffff;
  const lo = m.rd(hl), hi = m.rd((hl + 1) & 0xffff);
  if (hi > 0x03 || (hi === 0x03 && lo >= 0xe7)) hl = 0x2bbf;
  decimal(m, 2, hl);
  return yield* chars(g, 0xcd2f, 0x03, de, b);
}

/** 00:2B3B — code 25 n: a member's points (n = 10 k + p: member p (00:20DE of p; 9 = CD36);
 *  k = 0: C510, 1: C512, 2: C510 "/" C512, 3: C514, 4: C516, 5 and above: C514 "/" C516; 3
 *  digits each, "/" = F1). The operand goes through CD28. Returns [hl + 1, de, b]. */
function* points(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  let a = m.rd(hl);
  let c = 1;
  for (;;) {
    const r = a - 0x0a;
    if (r < 0) break;
    a = r;
    c = (c + 1) & 0xff;
  }
  if (a === 0x09) a = 0xff;
  m.wr(0xcd28, a);
  [a] = param(m, 0xcd28);
  const slash = function* (): Co<void> { // 00:2B7B
    [de, b] = yield* chars(g, 0x2b84, 0x01, de, b);
  };
  switch (c) {
    case 1: [de, b] = yield* threeDigits(g, a, 0x10, de, b); break;
    case 2: [de, b] = yield* threeDigits(g, a, 0x12, de, b); break;
    case 3:
      [de, b] = yield* threeDigits(g, a, 0x10, de, b);
      yield* slash();
      [de, b] = yield* threeDigits(g, a, 0x12, de, b);
      break;
    case 4: [de, b] = yield* threeDigits(g, a, 0x14, de, b); break;
    case 5: [de, b] = yield* threeDigits(g, a, 0x16, de, b); break;
    default:
      [de, b] = yield* threeDigits(g, a, 0x14, de, b);
      yield* slash();
      [de, b] = yield* threeDigits(g, a, 0x16, de, b);
  }
  return [(hl + 1) & 0xffff, de, b];
}

/** 00:2BC1 — code 28 n (k = n >> 4, the status slot CDEC + 4 k): low nibble 0: the points of
 *  2B3B operand 2C1C + k (no status) or 2C17 + k and 4 blanks (a status); low nibble set: the
 *  status text CDEC + 4 k (4 letters), or without a status "C0 E2 E2 D7" (2C21) for low nibble 2,
 *  else 4 blanks. */
function* statusOrPoints(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const n = m.rd(hl);
  const after = (hl + 1) & 0xffff;
  const k = n >> 4;
  const slot = (0xcdec + ((4 * k) & 0xff)) & 0xffff;
  const l = m.rd(slot);
  if (!(n & 0x0f)) {
    if (!l) {
      [, de, b] = yield* points(g, 0x2c1c + k, de, b);
      return [after, de, b];
    }
    [, de, b] = yield* points(g, 0x2c17 + k, de, b);
    [de, b] = yield* chars(g, 0x3155, 0x04, de, b);
    return [after, de, b];
  }
  let src: number;
  if (!l) src = (n & 0x0f) === 0x02 ? 0x2c21 : 0x3155;
  else src = slot;
  [de, b] = yield* chars(g, src, 0x04, de, b);
  return [after, de, b];
}

/** 00:2C92 — the byte a rotated left c times, then the carry of rrca (bit 0). */
function rotBit(a: number, c: number): boolean {
  for (let i = c || 256; i; i--) a = ((a << 1) | (a >> 7)) & 0xff;
  return !!(a & 0x01);
}

/** 00:2C25 — code 29 n, a mark of the entity CD36 (1 letter): below 10: C550 bit 7 - n (F6 set,
 *  F5 clear); 10-1F: C539 bit (F5) or C558 bit (F6) by (n & F) + 1 rotations, else blank; 20 and
 *  above: (C53A rotated right 2 & 1F | C53B) bit: F5, else blank. */
function* mark(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const a = m.rd(hl);
  const after = (hl + 1) & 0xffff;
  let src: number;
  if (a < 0x10) {
    let v = m.rd((entityOffset(m) + 0xc550) & 0xffff);
    for (let d = a + 1; d; d--) v = ((v << 1) | (v >> 7)) & 0xff;
    src = v & 0x01 ? 0x2c9b : 0x2c9a;
  } else if (a < 0x20) {
    const c = (a & 0x0f) + 1;
    const p = (entityOffset(m) + 0xc539) & 0xffff;
    if (rotBit(m.rd(p), c)) src = 0x2c9a;
    else if (rotBit(m.rd((p + 0x1f) & 0xffff), c)) src = 0x2c9b;
    else src = 0x3155;
  } else {
    const c = (a & 0x0f) + 1;
    const p = (entityOffset(m) + 0xc53a) & 0xffff;
    const v0 = m.rd(p);
    const v = ((((v0 >> 2) | (v0 << 6)) & 0x1f) | m.rd((p + 1) & 0xffff)) & 0xff;
    src = rotBit(v, c) ? 0x2c9a : 0x3155;
  }
  [de, b] = yield* chars(g, src, 0x01, de, b);
  return [after, de, b];
}

/** 00:2D11 — code 2F n, one digit: below 20: the count of bag entry n (outside the range
 *  CD21..CD22: F2; an empty entry: blank); 20-2F: the low nibble of C500 + (n - 20) + the record
 *  of CD36 when C540 + ... is 6E-77 (else blank); 30 and above: the count of item n + A2 in the
 *  bag (0B:706C takes one, put back; none: 0), through FFA1. */
function* digit(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const a = m.rd(hl);
  const after = (hl + 1) & 0xffff;
  let src: number;
  if (a < 0x20) {
    const p = (0xc6ff + 2 * a) & 0xffff;
    let outside = false;
    if (m.rd(p) !== 0xff) {
      const e = m.rd(0xcd21), d = (m.rd(0xcd22) + 1) & 0xff;
      if (((d - 1) & 0xff) | e) {
        const v = m.rd(p);
        outside = v < e || v >= d;
      }
    }
    if (outside) src = 0x2dba;
    else if (m.rd(p) === 0xff) src = 0x3156;
    else {
      decimal(m, 1, (p + 1) & 0xffff);
      src = 0xcd31;
    }
  } else if (a < 0x30) {
    const e = a - 0x20;
    const p = (entityOffset(m) + 0xc540 + e) & 0xffff;
    const v = m.rd(p);
    if (v >= 0x6e && v < 0x78) {
      m.wr(0xcd28, m.rd((p - 0x40) & 0xffff) & 0x0f);
      decimal(m, 1, 0xcd28);
      src = 0xcd31;
    } else src = 0x3155;
  } else {
    m.wr(0xce91, (a + 0xa2) & 0xff);
    const p = farSync(g, 0x0b, () => bagTake(m));
    let v = 0;
    if (m.rd(0xce91) !== 0xff) {
      v = (m.rd(p) + 1) & 0xff;
      m.wr(p, v);
    }
    m.wr(0xffa1, v);
    decimal(m, 1, 0xffa1);
    src = 0xcd31;
  }
  [de, b] = yield* chars(g, src, 0x01, de, b);
  return [after, de, b];
}

/** 00:2DF0 — code 33 n, a sum of money + "C0": 0: the gold C6E0 (3 bytes, 6 digits); 1-4: the
 *  3-byte CE7C + 4 (n - 1) (trimmed: CD34 bit 1); 5-15: the price (00:2E54) of item CE2B + (n -
 *  10) (FF: 7 blanks; 5-F read below CE2B + 100); 16 and above: nothing. */
function* money(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const a = m.rd(hl);
  const after = (hl + 1) & 0xffff;
  if (a >= 0x05) {
    if (a >= 0x16) return [after, de, b];
    const v = m.rd((0xce2b + ((a - 0x10) & 0xff)) & 0xffff);
    if (v === 0xff) {
      [de, b] = yield* chars(g, 0x3155, 0x07, de, b);
      return [after, de, b];
    }
    itemPrice(g, v);
    decimal(m, 2, 0xce7c);
  } else if (a === 0) {
    decimal(m, 3, 0xc6e0);
  } else {
    decimal(m, 3, (0xce7c + ((4 * (a - 1)) & 0xff)) & 0xffff);
    m.wr(0xcd34, m.rd(0xcd34) | 0x02);
  }
  // 00:2E40
  [de, b] = yield* chars(g, 0xcd2c, 0x06, de, b);
  [de, b] = yield* chars(g, 0x2e53, 0x01, de, b);
  return [after, de, b];
}

/** 00:2E76 — code 34 p: two stat lines of member p (00:2D03 + 00:30E8) by the counter CD27
 *  (text: 0-3; menus (CD3A): 0-7, halved): 0 levels 18 / 57, 1: 19 / 3D, 2: 1A / 3E (each with
 *  hl back at the code, so the code runs again), 3: 1B / 3F (then on). */
function* statPairs(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  let a = m.rd(0xcd27);
  if (!m.rd(0xcd3a)) m.wr(0xcd27, (a + 1) & 0x03);
  else {
    m.wr(0xcd27, (a + 1) & 0x07);
    a >>= 1;
  }
  const pair = function* (a1: number, c1: number, a2: number, c2: number): Co<void> {
    [, de, b] = yield* statLine(g, a1, c1, hl, de, b);
    [, de, b] = yield* statLine(g, a2, c2, hl, de, b);
  };
  switch (a) {
    case 1: yield* pair(0x07, 0x19, 0x23, 0x3d); break;
    case 2: yield* pair(0x0e, 0x1a, 0x2a, 0x3e); break;
    case 3: {
      [, de, b] = yield* statLine(g, 0x15, 0x1b, hl, de, b);
      let after: number;
      [after, de, b] = yield* statLine(g, 0x31, 0x3f, hl, de, b);
      return [after, de, b];
    }
    default: yield* pair(0x00, 0x18, 0x1c, 0x57);
  }
  return [(hl - 1) & 0xffff, de, b];
}

/** 00:2DBB — code 30 n: the 3-byte number CE7C + 4 n, left aligned (the blanks skipped). */
function* number30(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const a = m.rd(hl);
  decimal(m, 3, (0xce7c + ((4 * a) & 0xff)) & 0xffff);
  let p = 0xcd2b, c = 7;
  while (m.rd(p) === 0xff && c) { p++; c--; }
  [de, b] = yield* chars(g, p, c, de, b);
  return [(hl + 1) & 0xffff, de, b];
}

/** 00:2DD7 — code 31 n: the 0-terminated string at CE3C + 16 n. */
function* string31(g: Game, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const p = (0xce3c + swap(m.rd(hl))) & 0xffff;
  let c = 0;
  while (m.rd((p + c) & 0xffff) !== 0 && c < 0xff) c++;
  if (c) [de, b] = yield* chars(g, p, c, de, b);
  return [(hl + 1) & 0xffff, de, b];
}

// ---------------------------------------------------------------- other handlers

/** 00:2779 — code 11 n: the arrow objects: n 0/1: C08A = 22 (CD19 bit 0 set) / 23 (cleared);
 *  n 2 / 3+: C08E = 23 (CD19 bit 1 set) / 22 (cleared). */
function arrows(m: Memory, n: number): void {
  let a = m.rd(0xcd19);
  if (n < 0x02) {
    if (n) { m.wr(0xc08a, 0x23); a &= 0xfe; } else { m.wr(0xc08a, 0x22); a |= 0x01; }
  } else if (n === 0x02) { m.wr(0xc08e, 0x23); a |= 0x02; } else { m.wr(0xc08e, 0x22); a &= 0xfd; }
  m.wr(0xcd19, a);
}

/** 00:2FBF — code 43 x y p: the 2 x 2 sprite of member p (p >= 5: p - 4) at OAM buffer C000 +
 *  16 p, top left (y, x), columns first (CD35 with p = 0: y 0; CDEB high nibble: x pushed off
 *  screen (F7) on one side of 58); nothing when CD1C is set or the position is the same (low
 *  bits aside). From slot 5 on (CD3C not 1) the tiles 4 * slot.. and attribute 0 too. Returns hl
 *  after the operands. */
function placeSprite(m: Memory, hl: number): number {
  let e = m.rd(hl), d = m.rd((hl + 1) & 0xffff);
  let [a, after] = param(m, (hl + 2) & 0xffff);
  if (a === 0 && m.rd(0xcd35)) d = 0;
  if (a >= 0x05) a = (a - 0x04) & 0xff;
  const l = swap(a);
  if (m.rd(0xcd1c)) return after;
  const f = m.rd(0xcdeb) & 0xf0;
  if (f && f !== 0x30) { // 00:3058
    if (f === 0x10) { if (e >= 0x58) e = 0xf7; } else if (e < 0x58) e = 0xf7;
  }
  const at = (k: number) => 0xc000 | ((l + k) & 0xff);
  if ((m.rd(at(1)) & 0xfe) === e && (m.rd(at(0)) & 0xfd) === d) return after;
  const d8 = (d + 8) & 0xff, e8 = (e + 8) & 0xff;
  if (l < 0x50 || m.rd(0xcd3c) === 1) {
    m.wr(at(0), d); m.wr(at(1), e);
    m.wr(at(4), d8); m.wr(at(5), e);
    m.wr(at(8), d); m.wr(at(9), e8);
    m.wr(at(12), d8); m.wr(at(13), e8);
    return after;
  }
  const c = (swap(l) * 4) & 0xff;
  const ent: [number, number][] = [[d, e], [d8, e], [d, e8], [d8, e8]];
  ent.forEach(([y, x], k) => {
    m.wr(at(4 * k), y); m.wr(at(4 * k + 1), x); m.wr(at(4 * k + 2), (c + k) & 0xff); m.wr(at(4 * k + 3), 0);
  });
  return after;
}

/** 00:2F5C — code 3C refA refB: the yes / no choice: a pause (00:2766, 1E frames twice), the box
 *  09:747B at (0B, 05) 8 x 2 (mode 24), the cursor object C09C (y 90, x 60, tile 7E), the menu
 *  input (00:1E51 with 00:2F99: A chooses (x 60 = yes), B = no, Right / Left move the cursor
 *  (x ^ E0), others buzz); the cursor hidden, the line state reset (00:328F); then the script
 *  reference refA (yes) or refB (no). Returns hl after both. */
function* yesNo(g: Game, hl: number): Co<number> {
  const m = g.m;
  yield* pause(g, 0x2f98);
  yield* far0(g, 0x09, () => printText(g, 0x24, 0x747b, 0x050b, 0x0208));
  m.wr(0xc09c, 0x90);
  m.wr(0xc09d, 0x60);
  m.wr(0xc09e, 0x7e);
  m.wr(0xc09f, 0x00);
  let yes = false;
  yield* menuInput(g, function* (i: number): Co<boolean> {
    switch (i) {
      case 0: yes = m.rd(0xc09d) === 0x60; return true; // 00:2FAB
      case 1: yes = false; return true; // 00:2FB3
      case 4: case 5: m.wr(0xc09d, m.rd(0xc09d) ^ 0xe0); return false; // 00:2FB7
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
  m.wr(0xc09c, 0);
  lineReset(m);
  if (yes) {
    const p = yield* scriptRef(g, 0x40, hl);
    return (p + 2) & 0xffff;
  }
  return yield* scriptRef(g, 0x40, (hl + 2) & 0xffff);
}

/** 00:2F38 — code 39 f refA refB: the script reference refA when story flag f is set, else
 *  refB (00:2EF6). Returns hl after both. */
function* flagBranch(g: Game, hl: number): Co<number> {
  const f = g.m.rd(hl);
  const p = (hl + 1) & 0xffff;
  if (testFlag(g.m, f)) return ((yield* scriptRef(g, 0x40, p)) + 2) & 0xffff;
  return yield* scriptRef(g, 0x40, (p + 2) & 0xffff);
}

/** 00:2F49 — code 3A f1 f2 refA refB refC: refA when flag f1 is set, else refB when f2 is set,
 *  else refC. Returns hl after all. */
function* flagBranch2(g: Game, hl: number): Co<number> {
  const m = g.m;
  if (testFlag(m, m.rd(hl))) {
    const p = yield* scriptRef(g, 0x40, (hl + 2) & 0xffff);
    return (p + 4) & 0xffff;
  }
  if (testFlag(m, m.rd((hl + 1) & 0xffff))) {
    const p = yield* scriptRef(g, 0x40, (hl + 4) & 0xffff);
    return (p + 2) & 0xffff;
  }
  return yield* scriptRef(g, 0x40, (hl + 6) & 0xffff);
}

// ---------------------------------------------------------------- the table 00:3175

/** Codes of 00:3086 (the scene commands 0B:6C35). */
const SCENE_CODES = new Set([0x0a, 0x0d, 0x12, 0x13, 0x32, 0x38, 0x3b, 0x3d, 0x3f]);

/** 00:3175 — the handler of control code c (00-4D) with hl = the text after the code byte, de =
 *  the output position, b = the column counter (menus: the row's count). Returns the handler's
 *  [hl, de, b] (de and b exact for the menu path, CD3A set; the text interpreter 00:3214 does not
 *  use them). The scene codes (00:3086) and the dictionary codes (00:308C) are not handled here. */
export function* textCode(g: Game, c: number, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  const at1 = (hl + 1) & 0xffff;
  switch (c) {
    case 0x00: return [(hl - 1) & 0xffff, (de + 1) & 0xffff, (b - 1) & 0xff]; // 00:26C6
    case 0x05: case 0x10: case 0x4c: return [hl, de, b]; // 00:26CB / 00:3174
    case 0x06: [de, b] = yield* newline(g, de, b); return [hl, de, b];
    case 0x07: // 00:2745
      lineReset(m);
      farSync(g, 0x0f, () => boxFrame(g));
      return [hl, de, b];
    case 0x08: yield* waitA(g); yield* windowToggle(g); return [hl, de, b]; // 00:274D
    case 0x09: [de, b] = yield* chars(g, 0x3155, m.rd(hl), de, b); return [at1, de, b]; // 00:2753
    case 0x0b: yield* waitA(g); return [hl, de, b]; // 00:275C
    case 0x0c: return [yield* pause(g, hl), de, b]; // 00:2766
    case 0x11: arrows(m, m.rd(hl)); return [at1, de, b]; // 00:2779
    case 0x14: yield* windowToggle(g); return [hl, de, b]; // 00:27AB
    case 0x15: { // 00:27BF
      const r = farSync(g, 0x0b, () => restore(g, m.rd(hl)));
      if (r) [de, b] = r;
      return [at1, de, b];
    }
    case 0x1c: m.wr(0xcd34, m.rd(0xcd34) | 0x02); return [hl, de, b]; // 00:27C5
    case 0x1d: return yield* code1D(g, hl, de, b);
    case 0x1e: { // 00:280F
      const a = m.rd(hl);
      pushBank(g, 0x0e);
      [de, b] = yield* itemName(g, a, de, b);
      popBank(g);
      return [at1, de, b];
    }
    case 0x1f: return yield* code1F(g, hl, de, b);
    case 0x20: { // 00:29E1: the status text of member p (0E:6D73 + 4 index, 4 letters)
      const [a, after] = param(m, hl);
      [de, b] = yield* charsIn(g, 0x0e, statusText(m, a), 0x04, de, b);
      return [after, de, b];
    }
    case 0x21: { // 00:2A52: "C5" and the level (field 03) of member p, 2 digits
      [de, b] = yield* chars(g, 0x2a64, 0x01, de, b);
      const [a, after] = param(m, hl);
      [de, b] = yield* twoDigits(g, a, 0x03, de, b);
      return [after, de, b];
    }
    case 0x22: { // 00:2A65: the kind text of member p (09:48EE: C50D & 7 -> 0-5), 0E:6D4F + 6 k
      const [a, after] = param(m, hl);
      pushBank(g, 0x09);
      const v = m.rd((recordOffset(m, a) + 0xc50d) & 0xffff);
      let k = v & 0x07;
      if (k === 0x02) k = v & 0x80 ? 0x05 : 0x04;
      else if (k > 0x02) k--;
      popBank(g);
      [de, b] = yield* charsIn(g, 0x0e, (0x6d4f + 6 * k) & 0xffff, 0x06, de, b);
      return [after, de, b];
    }
    case 0x23: { // 00:2A7B: "C7 BE D1 CD" and CD9D + 3 p minus C504 (3 bytes, 0 below) in 6
      // digits; p = 4: 10 blanks
      const [a, after] = param(m, hl);
      if (a === 0x04) {
        [de, b] = yield* chars(g, 0x3155, 0x0a, de, b);
        return [after, de, b];
      }
      [de, b] = yield* chars(g, 0x2ad8, 0x04, de, b);
      copy(m, (0xcd9d + ((3 * a) & 0xff)) & 0xffff, 0xcd28, 3); // 00:1F8D
      const src = (recordOffset(m, a) + 0xc504) & 0xffff;
      let borrow = 0;
      for (let k = 0; k < 3; k++) {
        const r = m.rd(0xcd28 + k) - m.rd((src + k) & 0xffff) - borrow;
        m.wr(0xcd28 + k, r & 0xff);
        borrow = r < 0 ? 1 : 0;
      }
      if (borrow) fill(m, 0xcd28, 3, 0);
      decimal(m, 3, 0xcd28);
      [de, b] = yield* chars(g, 0xcd2c, 0x06, de, b);
      return [after, de, b];
    }
    case 0x24: { // 00:2B08: "BE D1 C9" and C504 of member p (3 bytes, 7 digits); p = 4: 10 blanks
      const [a, after] = param(m, hl);
      if (a === 0x04) {
        [de, b] = yield* chars(g, 0x3155, 0x0a, de, b);
        return [after, de, b];
      }
      [de, b] = yield* chars(g, 0x2b38, 0x03, de, b);
      decimal(m, 3, (recordOffset(m, a) + 0xc504) & 0xffff);
      [de, b] = yield* chars(g, 0xcd2b, 0x07, de, b);
      return [after, de, b];
    }
    case 0x25: return yield* points(g, hl, de, b);
    case 0x26: { // 00:2ADC: equipment n of the entity CD36 (C548 + n): the item name, bank 09
      const a = m.rd((entityOffset(m) + 0xc548 + m.rd(hl)) & 0xffff);
      [de, b] = yield* itemOrBlank(g, a, de, b);
      return [at1, de, b];
    }
    case 0x27: m.wr(0xcdc1, 1); return [hl, de, b]; // 00:2B02
    case 0x28: return yield* statusOrPoints(g, hl, de, b);
    case 0x29: return yield* mark(g, hl, de, b);
    case 0x2a: { // 00:2C9C: the name of id n (CE94, trimmed: CD34 bit 1), bank 0E
      m.wr(0xce94, m.rd(hl));
      m.wr(0xcd34, m.rd(0xcd34) | 0x02);
      pushBank(g, 0x0e);
      const [src, n] = nameSource(m, 0xce94);
      [de, b] = yield* chars(g, src, n, de, b);
      popBank(g);
      return [at1, de, b];
    }
    case 0x2b: return yield* statLine(g, 0x00, 0x18, hl, de, b); // 00:2CB3
    case 0x2c: return yield* statLine(g, 0x07, 0x19, hl, de, b); // 00:2CBD
    case 0x2d: return yield* statLine(g, 0x0e, 0x1a, hl, de, b); // 00:2CC7
    case 0x2e: return yield* statLine(g, 0x15, 0x1b, hl, de, b); // 00:2CD1
    case 0x2f: return yield* digit(g, hl, de, b);
    case 0x30: return yield* number30(g, hl, de, b);
    case 0x31: return yield* string31(g, hl, de, b);
    case 0x33: return yield* money(g, hl, de, b);
    case 0x34: return yield* statPairs(g, hl, de, b);
    case 0x35: { // 00:2EC8: spell n of the entity CD36 (09:51EA; FF: CD20 as it is), 0E:6D9B + 6
      const a = m.rd(hl);
      if (a !== 0xff) farSync(g, 0x09, () => spellIndex(m, a));
      const s = m.rd(0xcd20);
      const src = s === 0xff ? 0x3155 : (0x6d9b + 6 * s) & 0xffff;
      [de, b] = yield* charsIn(g, 0x0e, src, 0x06, de, b);
      return [at1, de, b];
    }
    case 0x36: setFlag(m, m.rd(hl)); return [at1, de, b]; // 00:2EEE -> 00:3CA0
    case 0x37: clearFlag(m, m.rd(hl)); return [at1, de, b]; // 00:2EF2 -> 00:3CA6
    case 0x39: return [yield* flagBranch(g, hl), de, b];
    case 0x3a: return [yield* flagBranch2(g, hl), de, b];
    case 0x3c: return [yield* yesNo(g, hl), de, b];
    case 0x3e: return [yield* scriptRef(g, 0x40, hl), de, b]; // 00:2EF6
    case 0x43: // sync points 00:2FBF and 00:2FED (see menu.ts)
      yield* g.point(0x002fbf);
      if (!m.rd(0xcd1c)) yield* g.point(0x002fed);
      return [placeSprite(m, hl), de, b];
    case 0x4d: { // 00:306C: the name 72B3 + 11 k (k = the lowest set bit of CDC0; 11 letters,
      // bank as selected), trimmed (CD34 bit 1)
      m.wr(0xcd34, m.rd(0xcd34) | 0x02);
      const k = lowestBit(m.rd(0xcdc0));
      const a = ((k * 12) - k) & 0xff;
      [de, b] = yield* chars(g, (0x72b3 + a) & 0xffff, 0x0b, de, b);
      return [hl, de, b];
    }
  }
  if (SCENE_CODES.has(c)) return yield* sceneTextCode(g, c, hl, de, b);
  return yield* dictTextCode(g, c, hl, de, b);
}
