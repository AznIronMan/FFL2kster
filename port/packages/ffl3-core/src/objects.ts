/** Legend III map objects: 16 slots (index FF96) with their fields in parallel tables C200-C37F
 *  (00:3C03-3C9F give the address of a field for the current slot), the story flags C760 / C780
 *  (00:3CA0-3CF9), and drawing objects into the OAM buffer C000 (00:3A7F, 00:3B3F). Slot 0 is
 *  the party leader on the map. */
import type { Memory } from "./memory.js";

/** Field tables: [base, bytes per slot] (00:3C03 .. 00:3C98). */
export const F = {
  c200: [0xc200, 1], c210: [0xc210, 2], c230: [0xc230, 2], c250: [0xc250, 1], c260: [0xc260, 2], c280: [0xc280, 1],
  c290: [0xc290, 2], c2b0: [0xc2b0, 2], c2d0: [0xc2d0, 1], c2e0: [0xc2e0, 1], c2f0: [0xc2f0, 1], c300: [0xc300, 1],
  c310: [0xc310, 1], c320: [0xc320, 1], c330: [0xc330, 1], c340: [0xc340, 1], c350: [0xc350, 1], c360: [0xc360, 1],
  c370: [0xc370, 1],
} as const;
/* Meanings so far: C200 state (0 = free), C210 / C230 pixel y / x (16-bit), C250 frame bits,
 * C260 sprite list pointer, C280 tile base, C290 / C2B0 target y / x, C2D0 facing (00 up, 40
 * down, 80 left, C0 right, as 00:0741), C2E0 / C2F0 / C300 the map cell attributes, C320 kind,
 * C330 / C340 tile base / kind backups, C350 type (0 talk, 2 shop), C370 the script. */
export type Field = keyof typeof F;

/** The accessor routine of each field (for 00:004B's list and the CA53 trampoline). */
export const ACCESSOR: Record<Field, number> = {
  c200: 0x3c03, c210: 0x3c0b, c230: 0x3c14, c250: 0x3c1d, c260: 0x3c25, c280: 0x3c2e, c290: 0x3c36, c2b0: 0x3c3f, c2d0: 0x3c48,
  c2e0: 0x3c50, c2f0: 0x3c58, c300: 0x3c60, c310: 0x3c68, c320: 0x3c70, c330: 0x3c78, c340: 0x3c80, c350: 0x3c88,
  c360: 0x3c90, c370: 0x3c98,
};

/** The current slot (FF96). */
export const slot = (m: Memory): number => m.hram[0x16]!;
export const setSlot = (m: Memory, i: number): void => { m.hram[0x16] = i & 0xff; };

/** 00:3C03 .. — the address of field f for the current slot (the low byte wraps within the page). */
export function fa(m: Memory, f: Field): number {
  const [base, n] = F[f];
  return (base & 0xff00) | (((base & 0xff) + n * slot(m)) & 0xff);
}
export const fget = (m: Memory, f: Field, k = 0): number => m.rd(fa(m, f) + k);
export const fset = (m: Memory, f: Field, v: number, k = 0): void => m.wr(fa(m, f) + k, v);

// ---------------------------------------------------------------- story flags

/** Flag f of the set at base (C760, C780): bit 7 - (f & 7) of byte f >> 3. */
function flagByte(base: number, f: number): number {
  return (base & 0xff00) | (((base & 0xff) + (f >> 3)) & 0xff);
}
export function testFlagAt(m: Memory, base: number, f: number): boolean {
  return !!(m.rd(flagByte(base, f)) & (0x80 >> (f & 7)));
}
export function writeFlagAt(m: Memory, base: number, f: number, v: boolean): void {
  const a = flagByte(base, f), bit = 0x80 >> (f & 7);
  m.wr(a, v ? m.rd(a) | bit : m.rd(a) & ~bit);
}
/** 00:3CB2 — story flag f (C760), carry = set. */
export const testFlag = (m: Memory, f: number): boolean => testFlagAt(m, 0xc760, f);
/** 00:3CA0 / 00:3CA6 / 00:3CAC — set / clear / toggle story flag f. */
export const setFlag = (m: Memory, f: number): void => writeFlagAt(m, 0xc760, f, true);
export const clearFlag = (m: Memory, f: number): void => writeFlagAt(m, 0xc760, f, false);
export const toggleFlag = (m: Memory, f: number): void => writeFlagAt(m, 0xc760, f, !testFlag(m, f));
/** 00:3CCA / 00:3CB8 / 00:3CBE / 00:3CC4 — the second flag set C780. */
export const testFlag2 = (m: Memory, f: number): boolean => testFlagAt(m, 0xc780, f);
export const setFlag2 = (m: Memory, f: number): void => writeFlagAt(m, 0xc780, f, true);
export const clearFlag2 = (m: Memory, f: number): void => writeFlagAt(m, 0xc780, f, false);

// ---------------------------------------------------------------- slot copies

const COPY_LIST: [Field, number][] = [["c200", 1], ["c210", 2], ["c230", 2], ["c250", 1], ["c260", 2], ["c280", 1], ["c290", 2],
  ["c2b0", 2], ["c2d0", 1], ["c2e0", 1], ["c2f0", 1], ["c300", 1], ["c310", 1], ["c320", 1], ["c330", 1], ["c340", 1],
  ["c350", 1], ["c340", 1]];

/** 00:004B — copy every field of slot FF96 to slot FF96 + 1 (through the CA53 trampoline:
 *  CA53 = jp <accessor>; two-byte fields pass through C800/C801). */
export function copySlotUp(m: Memory): void {
  for (const [f, n] of COPY_LIST) {
    const acc = ACCESSOR[f];
    m.wr(0xca53, 0xc3); m.wr(0xca54, acc & 0xff); m.wr(0xca55, acc >> 8);
    const a = fa(m, f);
    if (n === 2) { m.wr(0xc800, m.rd(a)); m.wr(0xc801, m.rd(a + 1)); }
    const b = m.rd(a);
    setSlot(m, slot(m) + 1);
    const d = fa(m, f);
    if (n === 2) { m.wr(d, m.rd(0xc800)); m.wr(d + 1, m.rd(0xc801)); } else m.wr(d, b);
    setSlot(m, slot(m) - 1);
  }
}

// ---------------------------------------------------------------- drawing

/** 00:3A24 — y = 0 for the 39 entries of the OAM buffer. */
export function oamHideAll(m: Memory): void {
  for (let k = 0; k < 0x27; k++) m.wr(0xc000 + 4 * k, 0);
}

/** 00:3A32 — y = 0 for the OAM buffer entries at or below line d. */
export function oamHideBelow(m: Memory, d: number): void {
  for (let k = 0; k < 0x27; k++) if (m.rd(0xc000 + 4 * k) >= d) m.wr(0xc000 + 4 * k, 0);
}

/** Common head of 00:3A7F / 00:3B3F: the slot's state, screen position (FFCB-FFD3), clipped to
 *  the screen with the margin `lim` (E0 / F8). Returns false when nothing is drawn. */
function objectHead(m: Memory, lim: number): boolean {
  const h = m.hram;
  const st = fget(m, "c200");
  if (!st) return false;
  h[0x4b] = st;
  h[0x4c] = fget(m, "c210"); h[0x4d] = fget(m, "c210", 1);
  h[0x4e] = fget(m, "c230"); h[0x4f] = fget(m, "c230", 1);
  h[0x50] = fget(m, "c250");
  h[0x51] = fget(m, "c260");
  const hi = fget(m, "c260", 1);
  if (!hi) return false;
  h[0x52] = hi;
  h[0x53] = fget(m, "c280");
  const b = m.rd(0xca04), c = m.rd(0xca05);
  let d = (h[0x4c]! - h[0x12]!) & 0xff;
  if (d >= lim) return false;
  let borrow = h[0x4c]! < h[0x12]! ? 1 : 0;
  h[0x4c] = d;
  let v = (h[0x4d]! - m.rd(0xca03) - borrow) & 0xff & b;
  h[0x4d] = v;
  if (v) return false;
  d = (h[0x4e]! - h[0x11]!) & 0xff;
  if (d >= lim) return false;
  borrow = h[0x4e]! < h[0x11]! ? 1 : 0;
  h[0x4e] = d;
  v = (h[0x4f]! - m.rd(0xca02) - borrow) & 0xff & c;
  h[0x4f] = v;
  return !v;
}

/** 00:3A7F — draw the slot's object from its sprite list (FFD1/FFD2 + 2 x frame FFD0): count,
 *  then per sprite y, x, tile (low nibble, or 6F for 6F/8F) + FFD3, attributes (6F/8F: 0 / 20);
 *  into C000 + FF97 (up to 9C). */
export function drawObject(m: Memory): void {
  if (!objectHead(m, 0xe0)) return;
  const h = m.hram;
  h[0x50] = (h[0x50]! << 1) & 0xff;
  const t = ((h[0x52]! << 8) | h[0x51]!) + h[0x50]!;
  let hl = m.rd16(t & 0xffff);
  let c = m.rd(hl++);
  if (!c) return;
  let e = h[0x17]!;
  while (c) {
    if (e >= 0x9c) return;
    m.wr(0xc000 | e, (h[0x4c]! + m.rd(hl)) & 0xff); hl++; e = (e + 1) & 0xff;
    m.wr(0xc000 | e, (h[0x4e]! + m.rd(hl)) & 0xff); hl++; e = (e + 1) & 0xff;
    let a = m.rd(hl);
    a = a === 0x6f || a === 0x8f ? 0x6f : a & 0x0f;
    m.wr(0xc000 | e, (a + h[0x53]!) & 0xff); e = (e + 1) & 0xff;
    a = m.rd(hl++);
    if (a === 0x6f || a === 0x8f) a = (a - 0x6f) & 0xff;
    m.wr(0xc000 | e, a); e = (e + 1) & 0xff;
    h[0x17] = (h[0x17]! + 4) & 0xff;
    c--;
  }
}

/** 00:3B3F — draw the slot's object as 4 sprites from a 2-frame list (FFD1/FFD2, frame FFD0 bit
 *  0): each entry y << 4 | x, then tile (+ FFD3) and flip bit 5; the attributes take FFD0 bit 1
 *  (sprites 2 and 4) or bit 2 (1 and 3) as the priority bit 7 (behind the background). */
export function drawObject4(m: Memory): void {
  if (!objectHead(m, 0xf8)) return;
  const h = m.hram;
  const p = ((h[0x52]! << 8) | h[0x51]!) + 2 * (h[0x50]! & 1);
  let de = m.rd16(p & 0xffff);
  let l = h[0x17]!;
  for (let c = 4; c; c--) {
    if (h[0x17]! >= 0x9c) return;
    const v = m.rd(de);
    m.wr(0xc000 | l, (h[0x4c]! + (v >> 4)) & 0xff); l = (l + 1) & 0xff;
    m.wr(0xc000 | l, (h[0x4e]! - 1 + (v & 0x0f)) & 0xff); l = (l + 1) & 0xff;
    de++;
    const w = m.rd(de);
    m.wr(0xc000 | l, ((w & 0x0f) + h[0x53]!) & 0xff); l = (l + 1) & 0xff;
    const flip = w & 0x20;
    const behind = h[0x50]! & (c & 1 ? 0x02 : 0x04) ? 0x80 : 0;
    m.wr(0xc000 | l, behind | flip); l = (l + 1) & 0xff;
    de++;
    h[0x17] = l;
  }
}
