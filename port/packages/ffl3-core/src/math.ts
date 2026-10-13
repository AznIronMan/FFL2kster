/** Legend III bank-0 arithmetic and random helpers (00:1C7E-1D51, 00:39D5): 16 x 16 multiply,
 *  16 / 16 divide (through the RAM code C0C0), 24-bit add / subtract / compare of RAM values, the
 *  random byte FF90 and a random number below d. RAM side effects are kept (the parity replay
 *  compares RAM byte for byte). */
import type { Game } from "./game.js";
import type { Memory } from "./memory.js";

/** 00:39D5 — next random byte: FF90 = ((FF93 + FF90) ^ 1) rotated right one bit + FF90 (in: none;
 *  out: a = the new FF90; hl = FF90, not returned). */
export function random(m: Memory): number {
  const r = m.hram[0x10]!;
  let a = ((m.onRandom?.() ?? m.hram[0x13]!) + r) & 0xff;
  a ^= 0x01;
  a = ((a >> 1) | ((a & 1) << 7)) & 0xff; // rrca
  a = (a + r) & 0xff;
  m.hram[0x10] = a;
  return a;
}

/** 00:1C7E — 16 x 16 -> 32-bit multiply, shift and add (in: hl, de; out: hl = the high 16 bits,
 *  de = the low 16 bits of hl x de; a, bc kept; no RAM). The carry flag on return is the carry it
 *  was entered with (shifted through de and out), so it is not returned. */
export function multiply(hl: number, de: number): { hl: number; de: number } {
  const p = (hl & 0xffff) * (de & 0xffff);
  return { hl: Math.floor(p / 0x10000) & 0xffff, de: p & 0xffff };
}

/** 00:1C9C — 16 / 16 divide with the interrupts off (in: hl dividend, de divisor; out: hl =
 *  quotient, de = remainder; a, bc kept). It builds the RAM code C0C0 = `ld sp,nn ; ret`
 *  (C0C0 = 31, C0C3 = C9, C0C1/C0C2 = its stack pointer after pushing af, bc and the return
 *  1CD2, i.e. `sp` - 8, where `sp` is the SP at the `call $1C9C`), divides with SP = -de as the
 *  subtrahend (restoring division, inverted quotient bits), jumps to C0C0 to get its stack back
 *  and returns with reti (interrupts on). Divisor 0: quotient 0, remainder = dividend. */
export function divide(g: Game, hl: number, de: number, sp: number): { hl: number; de: number } {
  const m = g.m;
  g.ime = false; // di
  m.wr(0xc0c0, 0x31);
  m.wr(0xc0c3, 0xc9);
  m.wr16(0xc0c1, (sp - 8) & 0xffff);
  let bc = hl & 0xffff;
  de &= 0xffff;
  const neg = ((de ^ 0xffff) + 1) & 0xffff; // SP = -de
  let r = 0;
  for (let k = 0; k < 16; k++) {
    // sla c ; rl b ; rl l ; rl h
    const top = bc >> 15;
    bc = (bc << 1) & 0xffff;
    r = ((r << 1) | top) & 0xffff;
    // add hl,sp: carry = no borrow (r >= de)
    const s = r + neg;
    r = s & 0xffff;
    if (s <= 0xffff) {
      r = (r + de) & 0xffff;
      bc = (bc + 1) & 0xffff; // inc c (bit 0 is clear after the shift)
    }
  }
  // 1CD2: push hl ; hl = ~bc ; pop de ; pop bc ; pop af ; reti
  g.ime = true;
  return { hl: bc ^ 0xffff, de: r };
}

/** 00:1CDD — 24-bit add in RAM: [de..de+2] += [hl..hl+2], little endian (in: a, de, hl; out:
 *  a, de, hl kept; carry = carry out of the top byte). FF9F = a (its save slot). */
export function add24(m: Memory, a: number, de: number, hl: number): boolean {
  m.hram[0x1f] = a & 0xff;
  let c = 0;
  for (let i = 0; i < 3; i++) {
    const s = m.rd((de + i) & 0xffff) + m.rd((hl + i) & 0xffff) + c;
    m.wr((de + i) & 0xffff, s);
    c = s > 0xff ? 1 : 0;
  }
  return c === 1;
}

/** 24-bit [de] - [hl] (the body of 00:1CF5 / 00:1D0C): the three result bytes and the borrow. */
function sub24Bytes(m: Memory, de: number, hl: number, store: boolean): { c: boolean; z: boolean } {
  let borrow = 0, or = 0;
  for (let i = 0; i < 3; i++) {
    const d = m.rd((de + i) & 0xffff) - m.rd((hl + i) & 0xffff) - borrow;
    borrow = d < 0 ? 1 : 0;
    const v = d & 0xff;
    if (store) m.wr((de + i) & 0xffff, v);
    or |= v;
  }
  return { c: borrow === 1, z: or === 0 };
}

/** 00:1CF5 — 24-bit subtract in RAM: [de..de+2] -= [hl..hl+2], little endian (in: a, de, hl;
 *  out: a, bc, de, hl kept; carry = borrow (the result went below 0), zero = the 24-bit result
 *  is 0). FF9F = a (its save slot). */
export function sub24(m: Memory, a: number, de: number, hl: number): { c: boolean; z: boolean } {
  m.hram[0x1f] = a & 0xff;
  return sub24Bytes(m, de, hl, true);
}

/** 00:1D0C — 24-bit compare of RAM values: [de..de+2] - [hl..hl+2] without storing (in: a, de,
 *  hl; out: a, bc, de, hl kept; carry = [de] < [hl], zero = equal). FF9F = a (its save slot). */
export function cmp24(m: Memory, a: number, de: number, hl: number): { c: boolean; z: boolean } {
  m.hram[0x1f] = a & 0xff;
  return sub24Bytes(m, de, hl, false);
}

/** 00:1D2E — random number below d (in: d; out: a; de, hl kept): d = 0 -> 0 (no random byte);
 *  otherwise a = 00:39D5 (FF90 advanced); a = 0 -> 0; d < 9 -> a & 7; then a - d until a < d. */
export function randomBelow(m: Memory, d: number): number {
  d &= 0xff;
  if (!d) return 0;
  let a = random(m);
  if (!a) return 0;
  if (d < 9) a &= 0x07;
  while (a >= d) a -= d;
  return a;
}
