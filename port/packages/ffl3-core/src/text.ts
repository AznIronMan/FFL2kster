/** Legend III text engine 00:3211 (docs/ffl3/FINDINGS.md M3): one interpreter for dialogue,
 *  menus and battle text, drawing on the window map 9C00 through two 20-tile line buffers (C880
 *  upper row, C894 lower row).
 *
 *  Call (a = mode CD34, e = x CD02, d = y CD03, c = width CD00, b = height CD01 / CD0A, hl =
 *  text): 00:3232 sets the box up (bit 3: WY = 50; bit 6: go on in the open box; bits 3/5: the
 *  frame 0B:6C87; bit 0: inset), 00:3214 reads bytes: 00 end, 10 wait for A then end, 88-FF a
 *  run of literal tiles (00:32EA), others control codes through 00:3175 (01-04, 0E/0F, 16-1B,
 *  40-4A and 4E-87 dictionary entries, 00:308C). Mode bit 2 draws a whole line at once
 *  (00:3357); without it each tile appears after the text delay (00:338E, 00:3593). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { textBegin, textEnd, far0, fill, vramCopy, pushBank, popBank, copyB, wait1, farcall } from "./sys.js";
import { NotPorted } from "./irq.js";
import { scriptRef, sceneCode } from "./events.js";
import { windowToggle, boxFrame } from "./window.js";

const CD = (k: number) => 0xcd00 + k;

/** 00:33F7 — CD04/CD05 = 9C00 + 32 y + x. */
function cursorAddr(m: Memory): void {
  m.wr16(CD(4), (0x9c00 + m.rd(CD(3)) * 32 + m.rd(CD(2))) & 0xffff);
}

/** 00:328F — line state reset: the cursor, CD06-CD09 = 0, both line buffers FF. */
export function lineReset(m: Memory): void {
  cursorAddr(m);
  m.wr(CD(6), 0); m.wr(CD(8), 0); m.wr(CD(9), 0); m.wr(CD(7), 0);
  fill(m, 0xc880, 20, 0xff);
  fill(m, 0xc894, 20, 0xff);
}

/** 00:3680 — open a box level (CD3B): from the second level on, the outer box's state goes to
 *  CE90 + 8 (level - 1): CD34, CD00-CD03, CD0A, WX, WY. */
function boxPush(m: Memory): void {
  const n = m.rd(0xcd3b);
  m.wr(0xcd3b, n + 1);
  if (!n) return;
  let p = 0xce90 + ((((n << 4) | (n >> 4)) & 0xff) >> 1);
  m.wr(p++, m.rd(0xcd34));
  for (let i = 0; i < 4; i++) m.wr(p++, m.rd(CD(i)));
  m.wr(p++, m.rd(CD(0x0a)));
  m.wr(p++, m.rd(0xff4b));
  m.wr(p++, m.rd(0xff4a));
}

/** 00:36B1 — close a box level; the outer box's state back (WX/WY unless CDC1), and its line
 *  state reset unless the closing text kept the box open (bit 6). */
function boxPop(m: Memory): void {
  const n = (m.rd(0xcd3b) - 1) & 0xff;
  m.wr(0xcd3b, n);
  if (!n) return;
  const cur = m.rd(0xcd34);
  let p = 0xce90 + ((((n << 4) | (n >> 4)) & 0xff) >> 1);
  m.wr(0xcd34, m.rd(p++));
  for (let i = 0; i < 4; i++) m.wr(CD(i), m.rd(p++));
  m.wr(CD(0x0a), m.rd(p++));
  if (!m.rd(0xcdc1)) {
    m.wr(0xff4b, m.rd(p++));
    m.wr(0xff4a, m.rd(p++));
  }
  m.wr(0xcdc1, 0);
  if (!(cur & 0x40)) lineReset(m);
}

/** 00:3593 — the text delay: a frame, then up to CED9 more (A held ends it, B held holds it). */
export function* textDelay(g: Game): Co {
  const m = g.m;
  yield* wait1(g);
  let e = m.rd(0xced9);
  for (;;) {
    const a = m.hram[0x0a]!;
    if (a & 0x01) return;
    yield* wait1(g);
    if (a & 0x02) continue;
    e = (e - 1) & 0xff;
    if (!e) return;
  }
}

/** 00:3468 — 18 FF tiles at hl (0F:792C). */
function blankRow(g: Game, hl: number): void {
  farSyncFill(g, hl, 0x12, 0xff);
}
function farSyncFill(g: Game, hl: number, n: number, a: number): void {
  pushBank(g, 0x0f);
  fill(g.m, hl, n, a);
  popBank(g);
}

/** 00:34B2 — scroll b rows of the window box up by 2 rows (from 9C01 + 20 (a << 4) ...), CD38 = 1. */
function scrollRows(g: Game, a: number, b: number): void {
  const m = g.m;
  m.wr(0xcd38, 1);
  let de = (0x9c01 + 2 * (((a << 4) | (a >> 4)) & 0xff)) & 0xffff;
  let hl = (de + 0x40) & 0xffff;
  for (; b; b--) {
    let [h2, d2] = far0Sync0(g, () => vramCopy(m, hl, de, 0x14));
    hl = (h2 + 0x0c) & 0xffff;
    de = (d2 + 0x0c) & 0xffff;
  }
}
function far0Sync0<T>(_g: Game, fn: () => T): T {
  return fn();
}

/** 00:342C — the box is full: the delay, 4 rows up (battle: 2), the last two rows blank. */
function* scrollBox(g: Game): Co {
  const m = g.m;
  yield* textDelay(g);
  if (m.rd(0xcd37)) {
    scrollRows(g, 1, 2);
    blankRow(g, 0x9c61);
    blankRow(g, 0x9c81);
  } else {
    scrollRows(g, 1, 4);
    blankRow(g, 0x9ca1);
    blankRow(g, 0x9cc1);
  }
}

/** 00:338E — the line buffers drawn tile by tile at the cursor (each after the text delay, both
 *  rows); at column 1 on the row below the box (CD03 + CD01) the box scrolls first. */
function* lineByTile(g: Game): Co {
  const m = g.m;
  let hl = m.rd16(CD(4));
  let de = 0xc880;
  for (let b = m.rd(CD(6)); b; b--) {
    if (((hl & 0x1f) - 1) === 0 && ((hl >> 5) & 0x1f) === ((m.rd(CD(3)) + m.rd(CD(1))) & 0xff)) {
      yield* scrollBox(g);
      hl = (hl - 0x40) & 0xffff;
      m.wr16(CD(4), hl);
    }
    yield* textDelay(g);
    m.wr(hl, m.rd(de));
    m.wr((hl + 0x20) & 0xffff, m.rd(de + 0x14));
    m.wr(CD(7), m.rd(CD(7)) + 1);
    hl = (hl + 1) & 0xffff;
    de++;
  }
  m.wr16(CD(4), hl);
}

/** 00:3357 — a whole line at once: CD06 tiles of C880 to the cursor and of C894 one row down,
 *  then the cursor to the next line (two rows down, column CD02). */
function* lineAtOnce(g: Game): Co {
  const m = g.m;
  const n = m.rd(CD(6));
  const at = m.rd16(CD(4));
  yield* far0(g, 0, function* () { vramCopy(m, 0xc880, at, n); });
  yield* far0(g, 0, function* () { vramCopy(m, 0xc894, (at + 0x20) & 0xffff, n); });
  m.wr(CD(7), 0);
  const lo = ((m.rd(CD(4)) & 0xe0) | m.rd(CD(2))) + 0x40;
  m.wr(CD(4), lo & 0xff);
  if (lo > 0xff) m.wr(CD(5), m.rd(CD(5)) + 1);
}

/** 00:331B — flush the line buffers (CD34 bit 7 stops the text: CD08 = 80). */
export function* flush(g: Game): Co {
  const m = g.m;
  if (m.rd(0xcd34) & 0x80) m.wr(CD(8), 0x80);
  if (m.rd(CD(6))) {
    if (!(m.rd(0xcd34) & 0x04)) yield* lineByTile(g);
    else yield* lineAtOnce(g);
    m.wr(CD(6), 0);
  }
  fill(m, 0xc880, 20, 0xff);
  fill(m, 0xc894, 20, 0xff);
}

/** 00:3304 — b tiles from `src` into the lower line buffer at CD06; flushed unless mode bit 2. */
function* putTiles(g: Game, src: number, b: number): Co {
  const m = g.m;
  const at = m.rd(CD(6));
  m.wr(CD(6), at + b);
  for (let i = 0; i < b; i++) m.wr(0xc894 + at + i, m.rd(src + i));
  if (m.rd(0xcd34) & 0x04) return;
  yield* flush(g);
}

/** 00:26CC — control code 06, new line: flush (whole lines keep their own step), then the
 *  cursor two rows down at column CD02; at the box's bottom (CD03 + CD01 + 2) it stays and the
 *  box scrolls (00:342C). */
function* newline(g: Game): Co {
  const m = g.m;
  if (m.rd(0xcd3a)) throw new NotPorted("00:26D3 (list newline)");
  if (m.rd(0xcd34) & 0x10) throw new NotPorted("00:26E3 (upper-row newline)");
  if (m.rd(CD(6))) {
    yield* flush(g);
    if (m.rd(0xcd34) & 0x04) return;
  }
  const at = m.rd16(CD(4));
  const bc = ((at & 0xffe0) | m.rd(CD(2))) + 0x40 & 0xffff;
  const row = (bc >> 5) & 0x1f;
  if (((m.rd(CD(3)) + m.rd(CD(1)) + 2) & 0xff) === row) {
    m.wr16(CD(4), (bc - 0x40) & 0xffff);
    yield* scrollBox(g);
  } else m.wr16(CD(4), bc);
  m.wr(CD(7), 0);
}

/** 00:275C — code 10 / 08: flush, then poll FF8B until A is pressed (a busy loop: no frame
 *  wait). */
function* waitA(g: Game): Co {
  yield* flush(g);
  yield* g.until(() => !!(g.m.hram[0x0b]! & 0x01));
}

/** 00:30B8 — the dictionary entry of a code (4E-87: 0-57; the 22 low codes 00:30D1: 58-79). */
function dictIndex(c: number): number {
  if (c >= 0x4e) return c - 0x4e;
  const low = [0x01, 0x02, 0x03, 0x04, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x40, 0x41, 0x42, 0x44, 0x45, 0x46, 0x47,
    0x48, 0x49, 0x4a, 0x0e, 0x0f];
  return 0x3a + low.indexOf(c);
}

/** 00:308C — a dictionary entry (03:71C5, length-prefixed) copied to CD4D (+ 00) and drawn as a
 *  text in the open box (mode 40). */
function* dictionary(g: Game, c: number): Co {
  const m = g.m;
  const b = dictIndex(c);
  pushBank(g, 0x03);
  let hl = 0x71c5;
  for (let k = 0; k < b; k++) hl = (hl + 1 + m.rd(hl)) & 0xffff;
  const n = m.rd(hl++);
  const [, de] = copyB(m, hl, 0xcd4d, n);
  popBank(g);
  m.wr(de, 0);
  yield* far0(g, 0, () => printText(g, 0x40, 0xcd4d, 0, 0));
}

/** Codes handled by 00:3086 (the scene commands of 0B:6C35). */
const SCENE_CODES = new Set([0x0a, 0x0d, 0x12, 0x13, 0x32, 0x38, 0x3b, 0x3d, 0x3f]);

/** One control code at hl (after the code byte); returns hl after its operands. */
function* control(g: Game, c: number, hl: number): Co<number> {
  const m = g.m;
  if (c === 0x06) { yield* newline(g); return hl; }
  if (c === 0x05) return hl;
  if (c === 0x07) { lineReset(m); yield* farcall(g, 0x0f, function* () { boxFrame(g); }); return hl; }
  if (c === 0x14) { yield* windowToggle(g); return hl; }
  if (c === 0x3e) return yield* scriptRef(g, 0x40, hl);
  if (SCENE_CODES.has(c)) {
    const op = m.rd(hl);
    yield* farcall(g, 0x0b, () => sceneCode(g, c, op));
    return (hl + 1) & 0xffff;
  }
  if ((c >= 0x01 && c <= 0x04) || c === 0x0e || c === 0x0f || (c >= 0x16 && c <= 0x1b) || (c >= 0x40 && c <= 0x4a && c !== 0x43)
    || c >= 0x4e) {
    yield* dictionary(g, c);
    return hl;
  }
  throw new NotPorted(`text control code ${c.toString(16).padStart(2, "0")}`);
}

export interface TextResult { hl: number; de: number }

/** 00:3211 — draw the text at hl (bank as selected) with mode a, position e (x), d (y), size
 *  c x b. Returns hl after the terminator and de = the cursor (y, x). */
export function* printText(g: Game, a: number, hl: number, de: number, bc: number): Co<TextResult> {
  const m = g.m;
  // 00:3232
  if (a & 0x08) m.wr(0xff4a, 0x50);
  yield* textBegin(g);
  boxPush(m);
  if (a & 0x40) {
    m.wr(0xcd34, m.rd(0xcd34) | 0x40);
  } else {
    m.wr(0xcd34, a);
    m.wr(CD(2), de & 0xff); m.wr(CD(3), de >> 8);
    m.wr(CD(0), bc & 0xff); m.wr(CD(1), bc >> 8); m.wr(CD(0x0a), bc >> 8);
    lineReset(m);
    if (m.rd(0xcd34) & 0x28) throw new NotPorted("0B:6C87 (text box frame)");
    m.wr(CD(1), m.rd(CD(1)) & 0xfe);
    if (m.rd(0xcd34) & 0x01) {
      m.wr(CD(7), m.rd(CD(2)) - 1);
      m.wr(CD(2), 1);
      m.wr(CD(3), 1);
    }
  }
  // 00:3214
  for (;;) {
    const c = m.rd(hl++);
    if (c === 0x00) break;
    if (c === 0x10) { yield* waitA(g); break; }
    if (c < 0x88) hl = yield* control(g, c, hl);
    else {
      // 00:32EA: the run of literals
      const start = hl - 1;
      let p = start, b = 0xff;
      for (;;) {
        const v = m.rd(p++);
        if (!v || v < 0x88) break;
        b = (b - 1) & 0xff;
        if (!b) break;
      }
      p--;
      const n = (p - start) & 0xff;
      hl = p;
      yield* putTiles(g, start, n);
    }
    if (m.rd(CD(8))) break;
  }
  // 00:32B0
  let d = de;
  if (!(m.rd(0xcd34) & 0x40)) {
    yield* flush(g);
    // 00:3411: the cursor as (y, x)
    const addr = m.rd16(CD(4));
    m.wr(CD(4), addr & 0x1f);
    m.wr(CD(5), (((addr + 0x6400) & 0xffff) >> 5) & 0xff);
    d = (m.rd(CD(5)) << 8) | m.rd(CD(4));
  }
  boxPop(m);
  yield* textEnd(g);
  return { hl, de: d };
}
