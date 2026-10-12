/** The bank-1 menu engine (01:5039-5470, entered through 00:18C3 → 01:500C) and the cursor
 *  helpers the bank-1 screens share. Menu items are (row, column) pairs at C380 (D500 when
 *  C7CD bit 2), FF-terminated, recorded by the text engine (code 0x2E). C7CD bit 0: two-step
 *  selection (first FF8D, then FF8C), bit 1: scrolling list (C797/C798 offsets, window bounds
 *  C7D0/C7D1, C79F/C7A0). FF9B = current item; result FF8C (FF = cancelled); cursors
 *  FF97/FF98 and FF99/FF9A. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { joyFrame } from "../sys.js";

export interface MenuHooks {
  /** 00:0A5C — redraw the scrolled window (01AD). */
  redraw(g: Game): Co;
}

/** 01:5EFE — "can't" beep (FFB2 = FF9F = 0x13). */
export function beep(m: Memory): void {
  m.hram[0x32] = 0x13;
  m.hram[0x1f] = 0x13;
}
/** 01:5F07 — confirm sound (FFB2 = 0x37). */
export function confirm(m: Memory): void {
  m.hram[0x32] = 0x37;
}

const list = (m: Memory) => (m.rd(0xc7cd) & 4 ? 0xd500 : 0xc380);

/** 01:5450 — (row, column) of item FF9B. */
export function itemPos(m: Memory): [number, number] {
  const hl = list(m) + 2 * m.hram[0x1b]!;
  return [m.rd(hl), m.rd(hl + 1)];
}

/** 01:546A — main cursor at (b, c). */
export function setCursor(m: Memory, b: number, c: number): void {
  m.hram[0x17] = b;
  m.hram[0x18] = c;
}

/** 01:543B — from hl, skip entries (2 bytes, FF90 += 1 each) until [hl] is FF or equals a. */
function seek(m: Memory, hl: number, a: number): number {
  for (;;) {
    const v = m.rd(hl);
    if (v === 0xff || v === a) return hl;
    hl += 2;
    m.hram[0x10] = m.hram[0x10]! + 1;
  }
}

/** 01:5334 (down) / 01:53BE (up): nearest item in column c below/above row b.
 *  Returns [found, row, index]. */
function searchCol(m: Memory, b: number, c: number, down: boolean): [boolean, number, number] {
  let hl = list(m);
  let d = 0, e = down ? 0xff : 0;
  m.hram[0x10] = 0;
  for (;;) {
    hl = seek(m, hl + 1, c);
    if (m.rd(hl) === 0xff) return [d !== 0, e, m.hram[0x11]!];
    hl--;
    const r = m.rd(hl);
    if (down ? b < r && !(e < r) : r < b && !(r < e)) {
      e = r;
      d = 0xff;
      m.hram[0x11] = m.hram[0x10]!;
    }
    m.hram[0x10] = m.hram[0x10]! + 1;
    hl += 2;
  }
}

/** 01:537D (smallest column > c) / 01:5407 (largest column < c) among items in row b. */
function searchRow(m: Memory, b: number, c: number, right: boolean): [boolean, number, number] {
  let hl = list(m);
  let d = 0, e = right ? 0xff : 0;
  m.hram[0x10] = 0;
  for (;;) {
    hl = seek(m, hl, b);
    if (m.rd(hl) === 0xff) return [d !== 0, e, m.hram[0x11]!];
    hl++;
    const v = m.rd(hl);
    if (right ? c < v && !(e < v) : v < c && !(v < e)) {
      e = v;
      d = 0xff;
      m.hram[0x11] = m.hram[0x10]!;
    }
    m.hram[0x10] = m.hram[0x10]! + 1;
    hl++;
  }
}

/** 01:52CF — (b, c) relative to the scroll offsets C798/C797. */
function scrolled(m: Memory, b: number, c: number): [number, number] {
  return [(b - m.rd(0xc798)) & 0xff, (c - m.rd(0xc797)) & 0xff];
}

/** 01:52DC — item a lies outside the visible part of a scrolling window (carry). Returns
 *  [outside, b, c] with b/c made window-relative when tested. */
function outside(m: Memory, a: number, b: number, c: number): [boolean, number, number] {
  if (!(m.rd(0xc7cd) & 2)) return [false, b, c];
  if (a < m.rd(0xc7cf)) return [false, b, c];
  [b, c] = scrolled(m, b, c);
  const bottom = (m.rd(0xc7a0) - 1) & 0xff;
  if (bottom < b) return [true, b, c];
  const top = (m.rd(0xc7d1) + 2) & 0xff;
  if (top === b) return [false, b, c];
  return [!(top < b), b, c];
}

/** 01:5305 — scroll so that row b becomes visible; returns the clamped row. */
function scrollTo(m: Memory, b: number): number {
  const d = m.rd(0xc798);
  const top = (m.rd(0xc7d1) + 2) & 0xff;
  if (top < b) {
    const e = (m.rd(0xc7a0) - 1) & 0xff;
    m.wr(0xc798, (b - e + d) & 0xff);
    return e;
  }
  m.wr(0xc798, (d - (top - b)) & 0xff);
  return top;
}

export class MenuEngine {
  constructor(readonly g: Game, readonly hooks: MenuHooks) {}

  get m(): Memory {
    return this.g.m;
  }

  /** 01:5294 — place the cursor on item FF9B, scrolling (and redrawing) when needed. */
  private *place(): Co {
    const m = this.m;
    let [b, c] = itemPos(m);
    const [out, rb, rc] = outside(m, m.hram[0x1b]!, b, c);
    if (out) {
      b = scrollTo(m, rb);
      c = rc;
      yield* this.hooks.redraw(this.g);
    } else if (m.rd(0xc7cd) & 2 && m.hram[0x1b]! >= m.rd(0xc7cf)) {
      b = rb;
      c = rc;
    }
    setCursor(m, b, c);
  }

  /** 01:52A6 — second cursor on the first choice of a two-step selection. */
  private second(): void {
    const m = this.m;
    if (!(m.rd(0xc7cd) & 1) || !m.rd(0xc7ce)) return;
    const hl = 0xc380 + 2 * m.hram[0x0d]!;
    let b = m.rd(hl), c = m.rd(hl + 1);
    const [out, rb, rc] = outside(m, m.hram[0x0d]!, b, c);
    if (out) { b = 0xff; c = 0xfe; }
    else if (m.rd(0xc7cd) & 2 && m.hram[0x0d]! >= m.rd(0xc7cf)) { b = rb; c = rc; }
    m.hram[0x19] = b;
    m.hram[0x1a] = (c + 1) & 0xff;
  }

  /** 01:5039 — run the menu until A or B. */
  *run(): Co {
    const m = this.m;
    m.wr(0xc7ce, 0);
    // last item (C7CB/C7CC)
    let hl = 0xc380;
    while (m.rd(hl++) !== 0xff);
    hl -= 2;
    m.wr(0xc7cc, m.rd(hl));
    m.wr(0xc7cb, m.rd(hl - 1));
    yield* this.place();
    for (;;) {
      this.second();
      const a = yield* joyFrame(this.g);
      const scroll = (m.rd(0xc7cd) & 2) !== 0;
      if (a & 0x80 || a & 0x40) {
        const down = (a & 0x80) !== 0;
        const [b, c] = itemPos(m);
        const [found, nb, idx] = searchCol(m, b, c, down);
        if (found) m.hram[0x1b] = idx;
        if (scroll) {
          if (!found) { beep(m); continue; }
          this.second();
          yield* this.place();
          continue;
        }
        let fb = nb, fc = c, ok = found;
        if (!ok) {
          // wrap: next/previous column of the first/last row
          const row = down ? m.rd(0xc380) : m.rd(0xc7cb);
          const [f2, nc, i2] = searchRow(m, row, c, down);
          if (f2) { m.hram[0x1b] = i2; fb = row; fc = nc; ok = true; }
          else fb = row;
        }
        if (!ok) {
          if (down) { fb = m.rd(0xc380); fc = m.rd(0xc381); m.hram[0x1b] = 0; }
          else { fb = m.rd(0xc7cb); fc = m.rd(0xc7cc); m.hram[0x1b] = (m.rd(0xc7ca) - 1) & 0xff; }
        }
        setCursor(m, fb, fc);
        continue;
      }
      if (a & 0x20) {
        if (scroll) {
          if (!m.hram[0x1b]) { beep(m); continue; }
          m.hram[0x1b] = m.hram[0x1b]! - 1;
          this.second();
          yield* this.place();
          continue;
        }
        let i = m.hram[0x1b]!;
        if (!i) i = m.rd(0xc7ca);
        m.hram[0x1b] = (i - 1) & 0xff;
        const [b, c] = itemPos(m);
        setCursor(m, b, c);
        continue;
      }
      if (a & 0x10) {
        const n = m.rd(0xc7ca);
        const i = (m.hram[0x1b]! + 1) & 0xff;
        if (scroll) {
          if (!(i < n)) { beep(m); continue; }
          m.hram[0x1b] = i;
          this.second();
          yield* this.place();
          continue;
        }
        m.hram[0x1b] = i < n ? i : 0;
        const [b, c] = itemPos(m);
        setCursor(m, b, c);
        continue;
      }
      if (a & 0x02) {
        if (m.rd(0xc7cd) & 1) {
          if (m.rd(0xc7ce)) {
            m.wr(0xc7ce, 0);
            m.hram[0x0c] = 0xff;
            m.hram[0x0d] = 0xff;
            m.hram[0x19] = 0xff;
            m.hram[0x1a] = 0xff;
            continue;
          }
          m.hram[0x0c] = 0xff;
          m.hram[0x0d] = 0xff;
          return;
        }
        m.hram[0x0c] = 0xff;
        return;
      }
      if (a & 0x01) {
        if (m.rd(0xc7cd) & 1) {
          if (m.rd(0xc7ce)) {
            m.hram[0x0c] = m.hram[0x0d]!;
            m.hram[0x0d] = m.hram[0x1b]!;
            return;
          }
          m.wr(0xc7ce, 1);
          m.hram[0x0d] = m.hram[0x1b]!;
          confirm(m);
          continue;
        }
        m.hram[0x0c] = m.hram[0x1b]!;
        return;
      }
    }
  }
}
