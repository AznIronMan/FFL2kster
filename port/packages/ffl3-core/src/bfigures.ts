/** Legend III battle-mode frame work (00:2247, run by 00:2192 from the STAT handler while CD37
 *  is set): the battle cursor / target figures in the OAM buffer C050-C09F, drawn by the bank-0B
 *  helpers 0B:6894 (clear), 0B:67EE (place one figure) and 0B:68C5 (the target bit set).
 *  No frame waits: plain functions. */
import type { Game } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, memberOffset, lowBit } from "./sys.js";
import { memberLimit } from "./sprites.js";
import { NotPorted } from "./irq.js";

/** 0B:68BC — write a to the y bytes of four OAM entries from hl (step 4); returns hl + 16. */
function clearFour(m: Memory, hl: number, a: number): number {
  for (let k = 0; k < 4; k++) {
    m.wr(hl, a);
    hl = (hl + 4) & 0xffff;
  }
  return hl;
}

/** 0B:6894 — hide the battle figures: y = 0 for the OAM entries C050-C07C and C090-C09C, and
 *  C080-C08C too when CE1E is non-zero. */
function clearFigures(m: Memory): void {
  let hl = 0xc050;
  hl = clearFour(m, hl, 0);
  hl = clearFour(m, hl, 0);
  hl = clearFour(m, hl, 0);
  if (m.rd(0xce1e)) hl = clearFour(m, hl, 0); // xor a: a = 0 either way below
  else hl = (hl + 16) & 0xffff;
  clearFour(m, hl, 0);
}

/** 0B:67D8 — the screen position of enemy slot a (5-12) from CC41 + 2 (a - 5):
 *  c = (byte 0 swapped >> 1) + 8 (x), b = (byte 1 swapped >> 1) + 0x10 (y). */
function enemySlotPos(m: Memory, a: number): [number, number] {
  const hl = (0xcc41 + (((a - 5) * 2) & 0xff)) & 0xffff;
  const rot = (v: number) => {
    const s = ((v << 4) | (v >> 4)) & 0xff;
    return ((s >> 1) | (s << 7)) & 0xff;
  };
  const c = (rot(m.rd(hl)) + 0x08) & 0xff;
  const b = (rot(m.rd((hl + 1) & 0xffff)) + 0x10) & 0xff;
  return [b, c];
}

/** 0B:67EE — place figure d (four OAM entries at C040 + 16 d) on target a: a < 5 from the
 *  position table 0B:6826 (y, x; a 2x2 block 0x18 tall, 8 wide); a >= 5 on enemy slot a
 *  (0B:67D8), its size from CC4C + a (low nibble * 8 tall, high nibble / 2 wide). */
function placeFigure(m: Memory, a: number, d: number): void {
  const base = (((((d << 4) | (d >> 4)) & 0xff) + 0x40) & 0xff) | 0xc000;
  if (a < 5) {
    const hl = (0x6826 + ((a * 2) & 0xff)) & 0xffff;
    const y = m.rd(hl), x = m.rd((hl + 1) & 0xffff);
    m.wr(base, y);
    m.wr(base + 1, x);
    m.wr(base + 4, (y + 0x18) & 0xff);
    m.wr(base + 5, x);
    m.wr(base + 8, y);
    m.wr(base + 9, (x + 0x08) & 0xff);
    m.wr(base + 12, (y + 0x18) & 0xff);
    m.wr(base + 13, (x + 0x08) & 0xff);
    return;
  }
  const [b, c] = enemySlotPos(m, a);
  const v = m.rd((0xcc4c + a) & 0xffff);
  const s = ((v & 0x0f) << 4) & 0xff;
  const dd = ((s >> 1) | (s << 7)) & 0xff;
  const ee = (((v & 0xf0) >> 1) | ((v & 0xf0) << 7)) & 0xff;
  m.wr(base, b);
  m.wr(base + 1, c);
  m.wr(base + 4, (b + dd) & 0xff);
  m.wr(base + 5, c);
  m.wr(base + 8, b);
  m.wr(base + 9, (c + ee) & 0xff);
  m.wr(base + 12, (b + dd) & 0xff);
  m.wr(base + 13, (c + ee) & 0xff);
}

/** 0B:6C2D — the live-enemy bits CC5E | CC5F | CC60. */
function enemyBits(m: Memory): number {
  return m.rd(0xcc5e) | m.rd(0xcc5f) | m.rd(0xcc60);
}

/** 00:1EF1 — the bit 1 << a (0 for a >= 8). */
function bitOf(a: number): number {
  return a < 8 ? (1 << a) & 0xff : 0;
}

/** 0B:68C8 — the target set of target code a: bit 7 (all enemies): bit 0 ? 0B:6C2D : 1;
 *  bit 6 (an enemy group): a & 3 ? CC5D[a & 3] : 1; a < 5 (member): 0 when C503 + offset is
 *  FF, else 80 when bit 7 of C501 + offset is clear (else 0); a >= 5 (enemy slot): its bit
 *  1 << (a - 5) masked by 0B:6C2D. */
function targetBits(m: Memory, a: number): number {
  if (a & 0x80) {
    a &= 0x01;
    if (!a) return 1;
    return enemyBits(m);
  }
  if (a & 0x40) {
    a &= 0x03;
    if (!a) return 1;
    return m.rd((0xcc5d + a) & 0xffff);
  }
  if (a < 5) {
    let hl = (memberOffset(m, a) + 0xc503) & 0xffff;
    if (((m.rd(hl) + 1) & 0xff) === 0) return 0;
    hl = (hl + 0xfffe) & 0xffff;
    return (m.rd(hl) & 0x80) ^ 0x80;
  }
  const c = bitOf((a - 5) & 0xff);
  return enemyBits(m) & c;
}

/** 0B:68C5 — targetBits of the target CE1C. */
function currentTargetBits(m: Memory): number {
  return targetBits(m, m.rd(0xce1c));
}

/** 00:2259 — one figure (slot 1) on target a, unless CD45 is set. */
function singleFigure(m: Memory, a: number): void {
  if (m.rd(0xcd45)) return;
  clearFigures(m);
  placeFigure(m, a, 1);
}

/** 00:2247 — the battle cursor / target figures (bank 0B). CDEB = 30: CE1C a single target
 *  (bits 7-6 clear) -> one figure on it; else every 4th frame (FF93 & 3) five figures on the
 *  enemy slots of the target set (0B:68C5), cycling CE1E. CDEB low nibble 0 -> hidden; 2 ->
 *  every 4th frame three figures on the members of CE1E (cycled, below 4, or 5 when the member
 *  limit 0B:6D12 is non-zero); otherwise one figure on CD36, hidden on the CDEB 11 / 21 end
 *  states (by CD36 bit 0). */
export function battleFigures(g: Game): void {
  const m = g.m;
  pushBank(g, 0x0b);
  const cdeb = m.rd(0xcdeb);
  if (cdeb === 0x30) {
    const c = m.rd(0xce1c);
    if (!(c & 0xc0)) {
      singleFigure(m, c);
    } else if (!(m.hram[0x13]! & 0x03)) {
      clearFigures(m);
    } else {
      const e = currentTargetBits(m);
      if (!e || !m.rd(0xce1e)) throw new NotPorted("00:22D0 (empty target set: the original loops forever)");
      for (let d = 5; d > 0; d--) {
        let a: number;
        do {
          const r = m.rd(0xce1e);
          m.wr(0xce1e, ((r << 1) | (r >> 7)) & 0xff);
          a = e & m.rd(0xce1e);
        } while (!a);
        placeFigure(m, (lowBit(a) + 5) & 0xff, d);
      }
    }
  } else if (!(cdeb & 0x0f)) {
    clearFigures(m);
  } else if ((cdeb & 0x0f) === 2) {
    if (!(m.hram[0x13]! & 0x03)) {
      clearFigures(m);
    } else {
      const e = memberLimit(m) === 0 ? 4 : 5;
      if (!m.rd(0xce1e)) throw new NotPorted("00:22A1 (CE1E = 0: the original loops forever)");
      for (let d = 3; d > 0; d--) {
        let a: number;
        do {
          const r = m.rd(0xce1e);
          m.wr(0xce1e, ((r << 1) | (r >> 7)) & 0xff);
          a = lowBit(m.rd(0xce1e));
        } while (a >= e);
        placeFigure(m, a, d);
      }
    }
  } else {
    const end = m.rd(0xcd36) & 0x01 ? cdeb === 0x11 : cdeb === 0x21;
    if (end) clearFigures(m);
    else singleFigure(m, m.rd(0xcd36));
  }
  popBank(g);
}
