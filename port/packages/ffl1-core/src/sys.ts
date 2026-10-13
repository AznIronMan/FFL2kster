/** Legend I bank-0 system routines (00:0000-0862): memory fills and copies, the VRAM-access
 *  bracket, OAM, joypad repeat, cursor sprites, arithmetic, the RNG and the save RAM. Each
 *  function names the original routine it reimplements; side effects on RAM that the original
 *  leaves behind (scratch bytes, HRAM) are reproduced so states compare byte for byte. */
import { VSYNC, type Game, type Co } from "./game.js";
import type { Memory } from "./memory.js";

// ---------------------------------------------------------------- fills and copies

/** 00:007C — fill b bytes (0 = 256) at hl with a; returns hl after. 00:007B: a = 0. */
export function fill(m: Memory, hl: number, b: number, a: number): number {
  let n = b || 256;
  while (n--) m.wr(hl++, a);
  return hl & 0xffff;
}

/** 00:0082 — fill bc bytes (0 = 65536) at hl with a; returns hl after. */
export function fill16(m: Memory, hl: number, bc: number, a: number): number {
  let n = bc || 0x10000;
  while (n--) m.wr(hl++, a);
  return hl & 0xffff;
}

/** 00:008F — copy b bytes (0 = 256) from hl to de; returns [hl, de] after. */
export function copy(m: Memory, hl: number, de: number, b: number): [number, number] {
  let n = b || 256;
  while (n--) m.wr(de++, m.rd(hl++));
  return [hl & 0xffff, de & 0xffff];
}

/** 00:0098 — copy bc bytes from hl to de. */
export function copy16(m: Memory, hl: number, de: number, bc: number): [number, number] {
  let n = bc || 0x10000;
  while (n--) m.wr(de++, m.rd(hl++));
  return [hl & 0xffff, de & 0xffff];
}

/** 00:0200/0207 — copy from ROM bank `bank` (rst $28 there and back). */
export function copyBank(g: Game, bank: number, hl: number, de: number, b: number): [number, number] {
  const prev = g.selectBank(bank);
  const r = copy(g.m, hl, de, b);
  g.selectBank(prev);
  return r;
}
export function copyBank16(g: Game, bank: number, hl: number, de: number, bc: number): [number, number] {
  const prev = g.selectBank(bank);
  const r = copy16(g.m, hl, de, bc);
  g.selectBank(prev);
  return r;
}

/** 00:021D — read [hl] in bank `bank`. */
export function readBank(g: Game, bank: number, hl: number): number {
  const prev = g.selectBank(bank);
  const v = g.m.rd(hl);
  g.selectBank(prev);
  return v;
}

// ---------------------------------------------------------------- frame waits

/** rst $10 (00:00C7): wait for the frame's vblank (halt until LY >= 0x90). */
export function* vsync(_g: Game): Co {
  yield VSYNC;
}

/** rst $18 — OAM DMA from C000 (the HRAM routine at FF80, copied from 00:00F0). */
export function oamDma(m: Memory): void {
  m.wr(0xff46, 0xc0);
}

/** 00:043D — wait, then install the VRAM-access STAT handler 00:069F (C39D: jp 069F). */
export function* vramBegin(g: Game): Co {
  yield* vsync(g);
  g.ime = false;
  const m = g.m;
  m.wr(0xc39d, 0xc3);
  m.wr(0xc39e, 0x9f);
  m.wr(0xc39f, 0x06);
  g.ime = true; // reti
}

/** 00:044E — wait, then the normal STAT handler 00:06D0. (00:044F without the wait.) */
export function* vramEnd(g: Game): Co {
  yield* vsync(g);
  statNormal(g);
}
export function statNormal(g: Game): void {
  const m = g.m;
  m.wr(0xc39d, 0xc3);
  m.wr(0xc39e, 0xd0);
  m.wr(0xc39f, 0x06);
  g.ime = true;
}

/** 00:00A3 — VRAM fill b bytes with a. */
export function* vramFill(g: Game, hl: number, b: number, a: number): Co<number> {
  yield* vramBegin(g);
  const r = fill(g.m, hl, b, a);
  yield* vramEnd(g);
  return r;
}
/** 00:00AC — VRAM fill bc bytes with a. */
export function* vramFill16(g: Game, hl: number, bc: number, a: number): Co<number> {
  yield* vramBegin(g);
  const r = fill16(g.m, hl, bc, a);
  yield* vramEnd(g);
  return r;
}
/** 00:00B5 — VRAM copy b bytes. */
export function* vramCopy(g: Game, hl: number, de: number, b: number): Co<[number, number]> {
  yield* vramBegin(g);
  const r = copy(g.m, hl, de, b);
  yield* vramEnd(g);
  return r;
}
/** 00:00BE — VRAM copy bc bytes. */
export function* vramCopy16(g: Game, hl: number, de: number, bc: number): Co<[number, number]> {
  yield* vramBegin(g);
  const r = copy16(g.m, hl, de, bc);
  yield* vramEnd(g);
  return r;
}
/** 00:020E / 00:0215 — VRAM copy from ROM bank `bank`. */
export function* vramCopyBank(g: Game, bank: number, hl: number, de: number, b: number): Co<[number, number]> {
  const prev = g.selectBank(bank);
  const r = yield* vramCopy(g, hl, de, b);
  g.selectBank(prev);
  return r;
}
export function* vramCopyBank16(g: Game, bank: number, hl: number, de: number, bc: number): Co<[number, number]> {
  const prev = g.selectBank(bank);
  const r = yield* vramCopy16(g, hl, de, bc);
  g.selectBank(prev);
  return r;
}

/** 00:046E — copy a c-row block of b-wide tile rows from hl to the BG map at de (32 wide). */
export function* blitRows(g: Game, hl: number, de: number, b: number, c: number): Co {
  yield* vramBegin(g);
  let n = c || 256;
  while (n--) {
    [hl, de] = copy(g.m, hl, de, b);
    de = (de + ((0x20 - b) & 0xff)) & 0xffff;
  }
  yield* vramEnd(g);
}

/** 00:0461 — the shared tiles 01:7FC0 -> 87C0 (64 bytes). */
export function* loadSharedTiles(g: Game): Co {
  yield* vramCopyBank(g, 0x01, 0x7fc0, 0x87c0, 0x40);
}

// ---------------------------------------------------------------- OAM and buffers

/** 00:0408 — clear the OAM shadow C000-C09F. */
export function oamClear(m: Memory): void {
  fill(m, 0xc000, 0xa0, 0);
}

/** 00:0410 — clear the window buffer C600-C767 with the blank tile 0x7F. */
export function bufferClear(m: Memory): void {
  fill16(m, 0xc600, 0x168, 0x7f);
}

/** 00:038B — d, e *= 8 (tile to pixel). */
export const px8 = (v: number): number => (v << 3) & 0xff;

const SPRITE_OFFSETS = 0x072e; // 4 x (dy, dx), applied cumulatively from the last

/** 00:03A4 — positions of a 2x2 sprite group at hl from (d, e) = (y, x). */
export function spritePositions(m: Memory, hl: number, d: number, e: number): void {
  for (let c = 4; c >= 1; c--) {
    const t = SPRITE_OFFSETS + 2 * (c - 1);
    d = (d + m.rd(t)) & 0xff;
    e = (e + m.rd(t + 1)) & 0xff;
    m.wr(hl, d);
    m.wr(hl + 1, e);
    hl += 4;
  }
}

/** 00:03FA — tiles a, a+1, a+2, a+3 every 4 bytes from hl. 00:03ED: the same value a. */
export function spriteTiles(m: Memory, hl: number, a: number): void {
  for (let k = 0; k < 4; k++) m.wr(hl + 4 * k, (a + k) & 0xff);
}
export function spriteFill(m: Memory, hl: number, a: number): void {
  for (let k = 0; k < 4; k++) m.wr(hl + 4 * k, a);
}

/** 00:03D9 — a 2x2 sprite group at hl: positions from (d, e), tiles a.., attributes c. */
export function spriteGroup(m: Memory, hl: number, d: number, e: number, a: number, c: number): void {
  spritePositions(m, hl, d, e);
  spriteTiles(m, hl + 2, a);
  spriteFill(m, hl + 3, c);
}

/** 00:03C9 — cursor at tile (d, e): FF92/FF93, then 00:03CF (sprite group C090, tiles 7C.., attr 0). */
export function cursorSet(m: Memory, d: number, e: number): void {
  m.hram[0x12] = d;
  m.hram[0x13] = e;
  cursorDraw(m, d, e);
}
/** 00:03CF — the cursor sprites at C090 from tile (d, e). */
export function cursorDraw(m: Memory, d: number, e: number): void {
  spriteGroup(m, 0xc090, px8(d), px8(e), 0x7c, 0x00);
}
/** 00:0398 — reposition the cursor sprites from FF92/FF93. */
export function cursorMove(m: Memory): void {
  spritePositions(m, 0xc090, px8(m.hram[0x12]!), px8(m.hram[0x13]!));
}

// ---------------------------------------------------------------- joypad

/** 00:034F — FF8E = FF8D on change, then repeated after 30 frames every 5; else 0. */
export function joyRepeat(m: Memory): number {
  const c = m.hram[0x0d]!;
  if (m.rd(0xc3a5) === c) {
    const n = (m.rd(0xc3a4) - 1) & 0xff;
    if (n !== 0) {
      m.wr(0xc3a4, n);
      m.hram[0x0e] = 0;
      return 0;
    }
    m.wr(0xc3a4, 5);
    m.hram[0x0e] = c;
    return c;
  }
  m.wr(0xc3a4, 0x1e);
  m.hram[0x0e] = c;
  m.wr(0xc3a5, c);
  return c;
}

/** 00:037A — wait, OAM DMA, joypad repeat; returns FF8E. */
export function* frameInput(g: Game): Co<number> {
  yield* vsync(g);
  oamDma(g.m);
  return joyRepeat(g.m);
}

/** 00:0382 — wait until no button is held (FF8D = 0). */
export function* waitRelease(g: Game): Co {
  do yield* vsync(g);
  while (g.m.hram[0x0d]);
}

/** 00:0CA0 — wait for a (repeated) button press; returns FF8E. */
export function* waitButton(g: Game): Co<number> {
  for (;;) {
    const a = yield* frameInput(g);
    if (a) return a;
  }
}

/** 00:041B — busy-wait for LY = 0x90 (no halt; the next vblank). */
export function* waitLy90(g: Game): Co {
  yield; // not a rst $10 wait
}

// ---------------------------------------------------------------- arithmetic

/** 00:0736 — h * l -> hl by shift-and-add with an 8-bit accumulator: `add l` then `srl a`
 *  drops the add's carry, so the result is the exact product only while the partial sums fit
 *  (always for l < 129). af and bc are preserved. */
export function mul8(h: number, l: number): number {
  h &= 0xff; l &= 0xff;
  let a = 0, c = 0;
  for (let b = 8; b; b--) {
    const cy = h & 1;
    h >>= 1;
    if (cy) a = (a + l) & 0xff;
    const lo = a & 1;
    a >>= 1;
    c = (c >> 1) | (lo << 7);
  }
  return (a << 8) | c;
}

/** 00:074D — hl * de (16 x 16 -> 32): returns [high16 (hl), low16 (de)]. Leaves SP in C381/C382
 *  (stack data, not compared). */
export function mul16(hl: number, de: number): [number, number] {
  const p = (hl & 0xffff) * (de & 0xffff);
  return [Math.floor(p / 0x10000) & 0xffff, p & 0xffff];
}

/** 00:0773 — de / hl: returns [quotient (de), remainder (hl)]. Side effects: FF88 = 1 and C385/C386
 *  = the partial remainder before the last subtraction, as the ROM's shift-subtract loop leaves
 *  them. (A zero divisor gives quotient 0xFFFF, remainder de, as the loop does.) */
export function div16(m: Memory, de: number, hl: number): [number, number] {
  const d = hl & 0xffff, neg = (0x10000 - d) & 0xffff;
  let r = 0, q = 0, n = de & 0xffff;
  for (let i = 16; i >= 1; i--) {
    m.hram[0x08] = i;
    r = ((r << 1) | (n >> 15)) & 0xffff;
    n = (n << 1) & 0xffff;
    m.wr(0xc385, r & 0xff);
    m.wr(0xc386, r >> 8);
    const s = r + neg;
    if (s > 0xffff) { r = s & 0xffff; q = ((q << 1) | 1) & 0xffff; }
    else q = (q << 1) & 0xffff;
  }
  return [q, r];
}

/** 00:07B5 — hl + (-de): returns the result, carry (set when the add does not carry, i.e.
 *  hl < de, and also for de = 0) and zero; FF88 = a (saved and restored around it). */
export function sub16(m: Memory, a: number, hl: number, de: number): { hl: number; carry: boolean; zero: boolean } {
  m.hram[0x08] = a & 0xff;
  const s = (hl & 0xffff) + ((0x10000 - (de & 0xffff)) & 0xffff);
  const v = s & 0xffff;
  return { hl: v, carry: s <= 0xffff, zero: v === 0 };
}

// ---------------------------------------------------------------- random numbers

/** 00:07EC — lo + (hi - lo) * r / 256 rounded (r = byte at hl): the 32-bit product
 *  (r * 256 + 0x80) * (hi - lo), byte 2, plus bit 15. lo = 0xFF -> 0xFF; hi = 0 -> 0; hi = lo -> lo. */
export function scaleRand(r: number, lo: number, hi: number): number {
  if (lo === 0xff) return 0xff;
  if (hi === 0) return 0;
  if (hi === lo) return lo;
  const e = (hi - lo) & 0xff;
  const p = ((r & 0xff) * 256 + 0x80) * e;
  const l = (p >> 16) & 0xff;
  return (l + ((p & 0x8000) ? 1 : 0) + lo) & 0xff;
}

/** 00:07D3 (via 00:016B) — random number in [lo, hi]: the caller's return address (low + high
 *  byte, & 0x7F) picks one of 128 counters at C300; the counter indexes the table CB00 (built
 *  at boot). `site` is the return address of the call. */
export function rand(m: Memory, site: number, lo: number, hi: number): number {
  const idx = ((site & 0xff) + (site >> 8)) & 0x7f;
  const c = (m.rd(0xc300 + idx) + 1) & 0xff;
  m.wr(0xc300 + idx, c);
  return scaleRand(m.rd(0xcb00 + c), lo, hi);
}

// ---------------------------------------------------------------- number formatting

/** 00:0835 — hl as 5 decimal digits at C3C0 (C3C0 = 0, then 10000s..1s). 00:0816 then turns
 *  leading zeros into blanks (0xFF) and digits into tiles (0x80+). 00:080A does both. */
export function decimal(m: Memory, hl: number): void {
  let v = hl & 0xffff, bc = 0xc3c0;
  m.wr(bc++, 0);
  for (const d of [10000, 1000, 100, 10]) {
    // 00:0856: subtract until it fails (07B5 leaves the count in FF88)
    let q = 0;
    while (v >= d) { v -= d; q++; }
    m.hram[0x08] = q;
    m.wr(bc++, q);
  }
  m.wr(bc, v & 0xff);
}
export function digitTiles(m: Memory): void {
  let b = 6, c = 0, hl = 0xc3c0;
  while (b) {
    let a = m.rd(hl);
    if (a === 0 && c === 0) {
      // leading zero: blank, except the last digit
      b--;
      if (b === 0) a = 0x81;
      b++;
      a = (a - 1) & 0xff;
    } else {
      c++;
      a = (a + 0x80) & 0xff;
    }
    m.wr(hl++, a);
    b--;
  }
}
export function number(m: Memory, hl: number): void {
  decimal(m, hl);
  digitTiles(m);
}
