/** Bank-0 system routines (00:0000-06FF): frame wait, OAM buffers, joypad, bit arrays,
 *  progress variables, party slot addressing and multi-byte arithmetic. Each function names the
 *  original routine it reimplements. */
import { VSYNC, type Game, type Co } from "./game.js";
import type { Memory } from "./memory.js";

// ---------------------------------------------------------------- frame / OAM

/** 00:06B0 — advance the frame counter C4FF and pick the OAM shadow page (C000/C100 by bit 4);
 *  in window mode (C7DE) copy it to CC00 with sprites at Y >= 0x5A hidden. */
export function oamPage(m: Memory): void {
  const c = (m.rd(0xc4ff) + 1) & 0xff;
  m.wr(0xc4ff, c);
  const page = 0xc0 | ((c & 0x10) >> 4);
  m.wr(0xc7df, page);
  if (!m.rd(0xc7de)) return;
  const n = m.hram[0x16] ? 0x24 : 0x28; // FF96
  for (let i = 0; i < n; i++) {
    const s = (page << 8) | (i * 4);
    const y = m.rd(s);
    m.wr(0xcc00 + i * 4, y < 0x5a ? y : 0);
    m.wr(0xcc01 + i * 4, m.rd(s + 1));
    m.wr(0xcc02 + i * 4, m.rd(s + 2));
    m.wr(0xcc03 + i * 4, m.rd(s + 3));
  }
  m.wr(0xc7df, 0xcc);
}

/** rst $10 (00:00D9): wait for the next vblank. */
export function* vsync(g: Game): Co {
  oamPage(g.m);
  yield VSYNC;
}

/** 00:068A — DMA the current OAM page. */
export function dmaCurrent(m: Memory): void {
  m.wr(0xff46, m.rd(0xc7df));
}

/** 00:068F — wait a frame, then DMA: page CC (text/menu sprites) while in battle (FF8B),
 *  a window is open (C764) or FF96 bit 0/1 is set; else the current page. */
export function* frameDma(g: Game): Co {
  const m = g.m;
  yield* vsync(g);
  let page = 0xcc;
  if (!m.hram[0x0b] && !m.rd(0xc764) && !(m.hram[0x16]! & 3)) page = m.rd(0xc7df);
  m.wr(0xff46, page);
}

// ---------------------------------------------------------------- joypad

/** 00:0469 — FF8A = newly pressed or auto-repeated buttons (30 frames delay, then every 5). */
export function joyRepeat(m: Memory): number {
  const c = m.hram[0x09]!; // FF89
  if (m.rd(0xc775) === c) {
    const n = m.rd(0xc774) - 1;
    if (n !== 0) {
      m.wr(0xc774, n);
      m.hram[0x0a] = 0;
      return 0;
    }
    m.wr(0xc774, 5);
    m.hram[0x0a] = c;
    return c;
  }
  m.wr(0xc774, 0x1e);
  m.hram[0x0a] = c;
  m.wr(0xc775, c);
  return c;
}

/** 00:0494 — joyRepeat then a DMA frame; returns FF8A. */
export function* joyFrame(g: Game): Co<number> {
  joyRepeat(g.m);
  yield* frameDma(g);
  return g.m.hram[0x0a]!;
}

/** 00:049D — wait (rst $10 frames) until no button is held. */
export function* waitRelease(g: Game): Co {
  do yield* vsync(g);
  while (g.m.hram[0x09]);
}

/** 00:04A6 — wait (DMA frames) until no button is held. */
export function* waitReleaseDma(g: Game): Co {
  do yield* frameDma(g);
  while (g.m.hram[0x09]);
}

/** Joypad sampling done by the frame interrupt (00:171F-1753): the history C770-C773 is
 *  shifted with an overlapping forward copy (00:0080 from C770 to C771, 3 bytes), so C771-C773
 *  all receive the previous sample; FF89 = (C773 | C772) & C771 & C770 = previous & current.
 *  Returns true for the A+B+Select+Start soft reset. */
export function sampleJoypad(m: Memory, held: number): boolean {
  const prev = m.rd(0xc770);
  m.wr(0xc771, prev);
  m.wr(0xc772, prev);
  m.wr(0xc773, prev);
  m.wr(0xc770, held & 0xff);
  const v = (m.rd(0xc773) | m.rd(0xc772)) & m.rd(0xc771) & m.rd(0xc770);
  m.hram[0x09] = v;
  return (v & 0x0f) === 0x0f;
}

// ---------------------------------------------------------------- bits, flags, variables

/** 00:0504 / 050B / 0512 — bit test/set/reset through the self-modified opcode at C0EA
 *  (CB 47 + 8 b: bit; CB C7: set; CB 87: res). The opcode byte stays in RAM. */
export function bitOp(m: Memory, op: 0x47 | 0xc7 | 0x87, b: number): void {
  m.wr(0xc0ea, (((b & 7) << 3) | op) & 0xff);
}

/** 00:062E — memo/flag bit n lives in C306 + n/8, bit n%8. */
export function flagTest(m: Memory, n: number): boolean { // 00:0615
  bitOp(m, 0x47, n);
  return ((m.rd(0xc306 + (n >> 3)) >> (n & 7)) & 1) !== 0;
}
export function flagSet(m: Memory, n: number): void { // 00:0621
  bitOp(m, 0xc7, n);
  const a = 0xc306 + (n >> 3);
  m.wr(a, m.rd(a) | (1 << (n & 7)));
}
export function flagClear(m: Memory, n: number): void { // 0512 = res
  bitOp(m, 0x87, n);
  const a = 0xc306 + (n >> 3);
  m.wr(a, m.rd(a) & ~(1 << (n & 7)));
}

/** 00:0679 — second bit array C31D + 2d (+1 if e bit 3), bit e%8 (used by MAGI/phrases). */
function bit2Addr(d: number, e: number): number {
  return 0xc31d + ((2 * d) & 0xff) + ((e & 8) ? 1 : 0);
}
export function bit2Test(m: Memory, d: number, e: number): boolean { // 00:066E
  bitOp(m, 0x47, e);
  return ((m.rd(bit2Addr(d, e)) >> (e & 7)) & 1) !== 0;
}
export function bit2Set(m: Memory, d: number, e: number): void { // 00:0B50 (050B = set)
  bitOp(m, 0xc7, e);
  const a = bit2Addr(d, e);
  m.wr(a, m.rd(a) | (1 << (e & 7)));
}
export function bit2Clear(m: Memory, d: number, e: number): void { // 00:0B5B (0512 = res)
  bitOp(m, 0x87, e);
  const a = bit2Addr(d, e);
  m.wr(a, m.rd(a) & ~(1 << (e & 7)));
}

/** 00:063E — progress variable e (0-31): nibble of C2F6 + e/2, high nibble for even e. */
export function varGet(m: Memory, e: number): number {
  const v = m.rd(0xc2f6 + ((e & 0x1f) >> 1));
  return e & 1 ? v & 0x0f : v >> 4;
}
/** 00:064A */
export function varSet(m: Memory, e: number, val: number): void {
  const a = 0xc2f6 + ((e & 0x1f) >> 1), v = m.rd(a);
  m.wr(a, e & 1 ? (v & 0xf0) | (val & 0x0f) : (v & 0x0f) | ((val & 0x0f) << 4));
}

// ---------------------------------------------------------------- party

/** 00:05EF — formation slot of party member a (C2A0 holds 4 x 2-bit slots); a >= 4 → 4. */
export function partySlot(m: Memory, a: number): number {
  if (a >= 4) return 4;
  return (m.rd(0xc2a0) >> (2 * a)) & 3;
}

/** 00:05D9 — address of member a's field at base hl: hl + 32*slot(a) in the field,
 *  hl + 256*a in battle (FF8B). */
export function memberAddr(m: Memory, a: number, hl: number): number {
  if (m.hram[0x0b]) return (hl + (a << 8)) & 0xffff;
  return (hl + ((partySlot(m, a) * 32) & 0xff)) & 0xffff;
}

// ---------------------------------------------------------------- arithmetic

/** 00:02F0 — 8x8 multiply. */
export const mul8 = (h: number, l: number): number => (h * l) & 0xffff;
/** 00:0306 — 8-bit divide: quotient, remainder. */
export function div8(h: number, l: number): [number, number] {
  return [Math.floor(h / l) & 0xff, h % l];
}
/** 00:0390 — 24-bit add [de] += [hl]. */
export function add24(m: Memory, de: number, hl: number): void {
  let c = 0;
  for (let i = 0; i < 3; i++) {
    const s = m.rd(de + i) + m.rd(hl + i) + c;
    m.wr(de + i, s);
    c = s >> 8;
  }
}
export const rd24 = (m: Memory, a: number): number => m.rd(a) | (m.rd(a + 1) << 8) | (m.rd(a + 2) << 16);
export function wr24(m: Memory, a: number, v: number): void {
  m.wr(a, v); m.wr(a + 1, v >> 8); m.wr(a + 2, v >> 16);
}
/** 00:03A6 — 24-bit subtract [de] -= [hl]; returns borrow. */
export function sub24(m: Memory, de: number, hl: number): boolean {
  const a = rd24(m, de), b = rd24(m, hl);
  wr24(m, de, (a - b) & 0xffffff);
  return a < b;
}
/** 00:03BC — 24-bit compare [de] - [hl]: returns borrow (de < hl). */
export const lt24 = (m: Memory, de: number, hl: number): boolean => rd24(m, de) < rd24(m, hl);

// ---------------------------------------------------------------- memory helpers

export function fill(m: Memory, a: number, n: number, v: number): void { // 00:006D / 0073
  for (let i = 0; i < n; i++) m.wr(a + i, v);
}
export function copy(m: Memory, src: number, dst: number, n: number): void { // 00:0080 / 0089
  for (let i = 0; i < n; i++) m.wr(dst + i, m.rd(src + i));
}
/** Copy from a ROM bank (00:00B5 / 00:00CA pattern: switch bank, copy, restore). */
export function copyBank(m: Memory, bank: number, src: number, dst: number, n: number): void {
  for (let i = 0; i < n; i++) m.wr(dst + i, m.romAt(bank, src + i));
}
