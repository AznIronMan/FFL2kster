/** Legend III bank-0 system routines (docs/ffl3/ROM_MAP.md): the ROM bank stack, far calls,
 *  copies and fills, the block decompressor, the VRAM bracket, frame waits and palette fades.
 *  Each function names the original routine it mirrors; RAM side effects are kept (the parity
 *  replay compares RAM byte for byte). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";

// ---------------------------------------------------------------- ROM bank stack

/** 00:38E1 (rst $20) — select bank a and push the previous one: C0A0 + C0B0 = C0B1, C0B1 = a,
 *  C0B0 + 1. */
export function pushBank(g: Game, a: number): void {
  const m = g.m;
  m.wr(0x2000, a);
  const depth = m.rd(0xc0b0);
  m.wr(0xc000 | ((0xa0 + depth) & 0xff), m.rd(0xc0b1));
  m.wr(0xc0b1, a);
  m.wr(0xc0b0, depth + 1);
}

/** 00:38FC (rst $28) — pop the bank: C0B0 - 1, bank = C0B1 = C0A0 + C0B0. */
export function popBank(g: Game): void {
  const m = g.m;
  const depth = (m.rd(0xc0b0) - 1) & 0xff;
  m.wr(0xc0b0, depth);
  const a = m.rd(0xc000 | ((0xa0 + depth) & 0xff));
  m.wr(0x2000, a);
  m.wr(0xc0b1, a);
}

/** 00:3910 — select bank a with an empty stack (start code). */
export function setBank(g: Game, a: number): void {
  const m = g.m;
  m.wr(0xc0b1, a);
  m.wr(0x2100, a);
  m.wr(0xc0b0, 0);
}

/** rst $18 to a bank-0 routine with bank `bank` selected (x = bank << 4 | k; bank 0: none). */
export function* far0<T>(g: Game, bank: number, fn: () => Co<T>): Co<T> {
  if (bank) pushBank(g, bank);
  const r = yield* fn();
  if (bank) popBank(g);
  return r;
}
export function far0Sync<T>(g: Game, bank: number, fn: () => T): T {
  if (bank) pushBank(g, bank);
  const r = fn();
  if (bank) popBank(g);
  return r;
}

/** rst $18 through the far table (00:3806): the routine's bank pushed, popped after. */
export function* farcall<T>(g: Game, bank: number, fn: () => Co<T>): Co<T> {
  pushBank(g, bank);
  const r = yield* fn();
  popBank(g);
  return r;
}
export function farSync<T>(g: Game, bank: number, fn: () => T): T {
  pushBank(g, bank);
  const r = fn();
  popBank(g);
  return r;
}

// ---------------------------------------------------------------- copies and fills

/** The unrolled copy chain 00:1F5A-1F95: entry -> bytes copied. */
export const COPY_AT: Record<number, number> = { 0x1f5a: 20, 0x1f60: 18, 0x1f66: 16, 0x1f6c: 14, 0x1f78: 10, 0x1f7b: 9,
  0x1f7e: 8, 0x1f81: 7, 0x1f84: 6, 0x1f87: 5, 0x1f8a: 4, 0x1f8d: 3, 0x1f90: 2, 0x1f93: 1 };
/** The unrolled fill chain 00:1F45-1F58: entry -> bytes filled. */
export const FILL_AT: Record<number, number> = { 0x1f45: 20, 0x1f49: 16, 0x1f50: 9, 0x1f51: 8, 0x1f53: 6, 0x1f55: 4 };

/** Copy n bytes hl -> de; returns [hl, de] after. */
export function copy(m: Memory, hl: number, de: number, n: number): [number, number] {
  for (let i = 0; i < n; i++) m.wr((de + i) & 0xffff, m.rd((hl + i) & 0xffff));
  return [(hl + n) & 0xffff, (de + n) & 0xffff];
}
/** Fill n bytes at hl with a; returns hl after. */
export function fill(m: Memory, hl: number, n: number, a: number): number {
  for (let i = 0; i < n; i++) m.wr((hl + i) & 0xffff, a);
  return (hl + n) & 0xffff;
}
/** 00:1F97 — copy b bytes (0 = 256). */
export const copyB = (m: Memory, hl: number, de: number, b: number): [number, number] => copy(m, hl, de, b || 256);
/** 00:1FB1 — copy bc bytes (0 = 256). */
export const copyBC = (m: Memory, hl: number, de: number, bc: number): [number, number] => copy(m, hl, de, bc || 256);
/** 00:3921 — fill bc bytes with a (0 = 256). */
export const fillBC = (m: Memory, hl: number, bc: number, a: number): number => fill(m, hl, bc || 256, a);

/** 00:20FF — copy bc bytes to VRAM, 5 at a time in hblank/vblank windows clear of LYC (the
 *  duration is CPU time, re-timed by the parity replay); returns [hl, de] after. */
export function vramCopy(m: Memory, hl: number, de: number, bc: number): [number, number] {
  return copy(m, hl, de, bc);
}

// ---------------------------------------------------------------- decompression

/** 00:3D76 — decompress hl.. (end at `end`) to `dest` through the block buffer C800: a
 *  block-size byte s (blocks of 4 << (s + 1) bytes), then per block a fill byte, an MSB-first bit
 *  mask (1 = the next literal, 0 = the fill) and the literals. RAM: C800 (last block), C840 size,
 *  C841 fill, C842/C843 end, C844/C845 destination, C846 mask scratch; CD3D kept. */
export function decompress(m: Memory, hl: number, end: number, dest: number): number {
  const cd3d = m.rd(0xcd3d);
  m.wr(0xcd3d, 0);
  m.wr16(0xc842, end);
  m.wr16(0xc844, dest);
  const s = m.rd(hl++);
  let size = 4;
  for (let b = (s + 1) & 0xff || 256; b; b--) size = (size << 1) & 0xff;
  m.wr(0xc840, size);
  do {
    m.wr(0xc841, m.rd(hl++));
    let bc = hl;
    hl = (hl + (size >> 3)) & 0xffff;
    let de = 0xc800;
    const masks = size === 8 ? 1 : size === 16 ? 2 : size === 32 ? 4 : 8;
    for (let k = 0; k < masks; k++) {
      let mask = m.rd(bc);
      for (let i = 0; i < 8; i++) {
        const bit = mask & 0x80;
        mask = (mask << 1) & 0xff;
        m.wr(0xc846, mask);
        m.wr(de++, bit ? m.rd(hl++) : m.rd(0xc841));
      }
      bc++;
    }
    let d = m.rd16(0xc844);
    for (let i = 0; i < size; i++) m.wr(d++, m.rd(0xc800 + i));
    m.wr16(0xc844, d & 0xffff);
  } while (hl < m.rd16(0xc842));
  m.wr(0xcd3d, cd3d);
  return hl;
}

// ---------------------------------------------------------------- VRAM bracket, waits

/** 00:1E38 — with CD3D set, the frame work of 00:3549 (also run by the bracket's STAT handler);
 *  the code goes on when it is done (its CPU time, `Game.workDone`). */
function* bracketWork(g: Game): Co {
  if (!g.m.rd(0xcd3d)) return;
  g.hooks.statWork?.(g);
  if (g.workIrq) {
    // the work turned the interrupts on (01:5730's reti) until its di (00:356B): a STAT
    // meanwhile nests (CDC5 set: the sound only)
    g.ime = true;
    yield* g.workDone();
    g.ime = false;
  } else yield* g.workDone();
}

/** 00:1D9E — enter the VRAM bracket (nested: CDCE counts): di; the first level saves IE, STAT,
 *  LYC and the interrupt vectors, enables vblank + STAT at LYC 3 with the handlers 00:1F27 (STAT)
 *  and 00:1EFA (vblank); then waits for mode 1 and returns with reti (the interrupts pending
 *  meanwhile are taken by the new handlers). */
export function* bracketEnter(g: Game, timed = false): Co {
  const m = g.m;
  if (!timed) yield* g.pollStart();
  g.ime = false;
  const n = m.rd(0xcdce);
  m.wr(0xcdce, n + 1);
  if (n === 0) {
    yield* bracketWork(g);
    m.wr(0xcdd0, m.hram[0x7f]!);
    m.wr(0xcdcf, m.rd(0xff41));
    m.wr(0xcdca, m.rd(0xff45));
    copy(m, 0xc0bc, 0xcdc7, 3);
    copy(m, 0xc0b9, 0xcdcb, 3);
    m.hram[0x7f] = m.hram[0x7f]! | 0x03;
    m.wr(0xff41, 0x40);
    m.wr(0xff45, 0x03);
    g.lycWrittenLate(); // (00:1D9E-1DDD take more than a line: an entry on line 2 misses LYC 3)
    copy(m, 0x1e40, 0xc0bc, 3);
    copy(m, 0x1e43, 0xc0b9, 3);
  }
  yield* g.untilVblank(true);
  yield* g.reti();
}

/** 00:1DFD — leave the VRAM bracket: di; the last level restores IE, STAT, LYC and the vectors;
 *  then waits for mode 1 and returns with reti (as 00:1D9E: a STAT at LYC 3 that came during the
 *  poll is taken by the restored handler). */
export function* bracketLeave(g: Game): Co {
  const m = g.m;
  yield* g.pollStart();
  g.ime = false;
  const n = (m.rd(0xcdce) - 1) & 0xff;
  m.wr(0xcdce, n);
  if (n === 0) {
    yield* bracketWork(g);
    m.hram[0x7f] = m.rd(0xcdd0);
    m.wr(0xff41, m.rd(0xcdcf));
    m.wr(0xff45, m.rd(0xcdca));
    copy(m, 0xcdc7, 0xc0bc, 3);
    copy(m, 0xcdcb, 0xc0b9, 3);
  }
  yield* g.untilVblank(true);
  yield* g.reti();
}

/** 00:1D98 — CD3D + 1, enter the bracket (the CPU time before it spent first: CD3D turns the
 *  STAT handler's frame work on). */
export function* textBegin(g: Game): Co {
  yield* g.pollStart();
  g.m.wr(0xcd3d, g.m.rd(0xcd3d) + 1);
  yield* bracketEnter(g, true);
}

/** 00:1DF3 — leave the bracket, CD3D - 1. */
export function* textEnd(g: Game): Co {
  yield* bracketLeave(g);
  g.m.wr(0xcd3d, g.m.rd(0xcd3d) - 1);
}

/** 00:358B — wait one frame. */
export function* wait1(g: Game): Co {
  yield* g.wait(1);
}

// ---------------------------------------------------------------- palettes

/** 0F:79AE — the fade levels: CDB7 + k and CDBA + k from the target palette CDB4 + k (BGP, OBP0,
 *  OBP1), each a step lighter (every 2-bit shade s -> s - 1, 0 stays). */
export function fadeLevels(m: Memory): void {
  for (let k = 0; k < 3; k++) {
    let a = m.rd(0xcdb4 + k);
    let de = 0xcdb7 + k;
    for (let b = 0; b < 2; b++) {
      const l = a;
      let x = (a & 0xaa) >> 1;
      x = ((x | l) & 0x55) ^ 0xff;
      a = (x + 1 + l) & 0xff;
      m.wr(de, a);
      de += 3;
    }
  }
}

/** 00:39E7 — BGP/OBP0/OBP1 = 3 bytes at hl, hl += 3 + bc, wait 5 frames. */
function* palStep(g: Game, hl: number, bc: number): Co<number> {
  copy(g.m, hl, 0xff47, 3);
  hl = (hl + 3 + bc) & 0xffff;
  yield* g.wait(5);
  return hl;
}

/** 00:3A0C — fade in: the levels (0F:79AE), then CDBA, CDB7, CDB4, 5 frames each, in the
 *  bracket with CD3D set. */
export function* fadeIn(g: Game): Co {
  farSync(g, 0x0f, () => fadeLevels(g.m));
  yield* fadeSteps(g, 0xcdba, 0xfffa);
}

/** 00:39F3 — fade out (nothing when all three palettes are 0): CDB7 three times. */
export function* fadeOut(g: Game): Co {
  const m = g.m;
  if (!(m.rd(0xff47) | m.rd(0xff48) | m.rd(0xff49))) return;
  farSync(g, 0x0f, () => fadeLevels(m));
  yield* fadeSteps(g, 0xcdb7, 0x0000);
}

/** 00:3A17 — 00:1D98, three palette steps (00:39E1 = 39E7 x 2 falling into 39E7), 00:1DF3. */
function* fadeSteps(g: Game, hl: number, bc: number): Co {
  yield* textBegin(g);
  for (let k = 0; k < 3; k++) hl = yield* palStep(g, hl, bc);
  yield* textEnd(g);
}

/** 00:3A44 — window on (LCDC bit 5). */
export function windowOn(m: Memory): void {
  m.wr(0xff40, m.rd(0xff40) | 0x20);
}
/** 00:3A4B — window off. */
export function windowOff(m: Memory): void {
  m.wr(0xff40, m.rd(0xff40) & 0xdf);
}

// ---------------------------------------------------------------- small helpers

/** 00:1FCD — the party record offset of member a (CD37 clear: 00:1FE3, x 0x60; set: 00:1FED). */
export function memberOffset(m: Memory, a: number): number {
  const t = m.rd(0xcd37) ? 0x1fed : 0x1fe3;
  return m.rd16((t + 2 * a) & 0xffff);
}

/** 00:1EE7 — index of the lowest set bit. */
export function lowBit(a: number): number {
  let c = 0;
  while (!(a & 1)) { a >>= 1; c++; if (c > 8) break; }
  return c;
}

/** 00:1E7C / 00:1E83 — the cursor sound (FFBC = 3A) / the buzzer (FFBC = 3B, then 2 frames). */
export function soundOk(m: Memory): void {
  m.sfx(0x3a);
}
export function* soundBuzz(g: Game): Co {
  g.sfx(0x3b);
  yield* g.wait(2);
}
