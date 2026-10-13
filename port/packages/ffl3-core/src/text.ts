/** Legend III text engine 00:3211 (docs/ffl3/FINDINGS.md M3): one interpreter for dialogue,
 *  menus and battle text, drawing on the window map 9C00 through two 20-tile line buffers (C880
 *  upper row, C894 lower row).
 *
 *  Call (a = mode CD34, e = x CD02, d = y CD03, c = width CD00, b = height CD01 / CD0A, hl =
 *  text): 00:3232 sets the box up (bit 3: WY = 50; bit 6: go on in the open box; bits 3/5: the
 *  frame 0B:6C87; bit 0: inset), 00:3214 reads bytes: 00 end, 10 wait for A then end, 88-FF a
 *  run of literal tiles (00:32EA), others control codes through 00:3175 (01-04, 0E/0F, 16-1B,
 *  40-4A and 4E-87 dictionary entries). Mode bit 2 draws a whole line at once (00:3357); without
 *  it each tile appears with a frame wait (00:338E). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { textBegin, textEnd, far0, fill, vramCopy } from "./sys.js";
import { NotPorted } from "./irq.js";

const CD = (k: number) => 0xcd00 + k;

/** 00:33F7 — CD04/CD05 = 9C00 + 32 y + x. */
function cursorAddr(m: Memory): void {
  m.wr16(CD(4), (0x9c00 + m.rd(CD(3)) * 32 + m.rd(CD(2))) & 0xffff);
}

/** 00:328F — line state reset: the cursor, CD06-CD09 = 0, both line buffers FF. */
function lineReset(m: Memory): void {
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
function* flush(g: Game): Co {
  const m = g.m;
  if (m.rd(0xcd34) & 0x80) m.wr(CD(8), 0x80);
  if (m.rd(CD(6))) {
    if (!(m.rd(0xcd34) & 0x04)) throw new NotPorted("00:338E (text drawn tile by tile)");
    yield* lineAtOnce(g);
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

/** 00:26CC — control code 06, new line. */
function* newline(g: Game): Co {
  const m = g.m;
  if (m.rd(0xcd3a)) throw new NotPorted("00:26D3 (list newline)");
  if (m.rd(0xcd34) & 0x10) throw new NotPorted("00:26E3 (upper-row newline)");
  if (m.rd(CD(6))) {
    yield* flush(g);
    if (m.rd(0xcd34) & 0x04) return;
  }
  throw new NotPorted("00:2701 (newline cursor move)");
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
    if (c === 0x10) throw new NotPorted("00:275C (wait for A)");
    if (c < 0x88) {
      if (c === 0x06) yield* newline(g);
      else throw new NotPorted(`text control code ${c.toString(16).padStart(2, "0")}`);
    } else {
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
