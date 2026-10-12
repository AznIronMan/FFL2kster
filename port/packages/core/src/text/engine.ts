/** The text/script interpreter of bank 0 (00:0701-1665): one bytecode for window messages
 *  (rst $08), field/story scripts (rst $20), battle messages and small prints (names, numbers).
 *
 *  Bytes >= 0x9E are characters, 0x4E-0x9D dictionary pairs (0F:6560), 0x00-0x4D control codes
 *  (table 00:13BE). State lives where the original keeps it: FFA0 mode (0 window message,
 *  1 script bank 0B, 2 script bank 0A, 3 battle message, 4 special, 5 inline print), FFA1 saved
 *  bank, FFA2/FFA3 read pointer, C779 context stack (CCA0+), C77E line stride, C77F/C780 line
 *  budget, C781/C782 cursor, C783/C784 line start, C785+ print buffer, C799-C7A5 window
 *  geometry, C800 (or D000) window buffer, C380 menu cursor list.
 *
 *  The original returns from the whole interpreter on code 00 by discarding the dispatcher's
 *  return address (00:0B2D); here every interpreter loop returns when a step reports END. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { frameDma, joyRepeat, waitReleaseDma, vsync, dmaCurrent, varGet, varSet, flagSet, flagClear,
  bit2Test, bit2Set, bit2Clear, memberAddr, partySlot, rd24, wr24, lt24, sub24, fill, copy } from "../sys.js";
import { vramBegin, vramEnd } from "../field/sprites.js";

const END = 1;
type Step = Co<number | void>;

/** Register arguments for calls out of the text engine. */
export interface Regs { b?: number; c?: number; d?: number; e?: number; hl?: number; a?: number }

/** Calls from scripts into the rest of the game, by original address: bank 0 routines by
 *  address (00:1906-1921 field entries), banked ones as bank << 16 | address (01:5006 etc.
 *  bank-1 menus, shops and screens, 0D:4000 battle). */
export interface TextCalls {
  far(g: Game, addr: number, regs?: Regs): Co<number | void>;
  /** 00:0200 — restart the game. */
  reset(g: Game): never;
}

export class TextEngine {
  /** Times each control code (00-4D, and any other byte re-dispatched through 0x20) ran; a
   *  coverage aid for the parity sweeps. */
  readonly coverage: Record<number, number> = {};
  constructor(readonly g: Game, readonly calls: TextCalls) {}

  get m(): Memory {
    return this.g.m;
  }

  // ------------------------------------------------------------ pointers

  private get ptr(): number {
    return this.m.hram[0x22]! | (this.m.hram[0x23]! << 8);
  }
  private set ptr(v: number) {
    this.m.hram[0x22] = v & 0xff;
    this.m.hram[0x23] = (v >> 8) & 0xff;
  }
  /** rst $30 (00:0701): next script byte. */
  private next(): number {
    const p = this.ptr;
    this.ptr = p + 1;
    return this.m.rd(p);
  }
  private get mode(): number {
    return this.m.hram[0x20]!;
  }
  private set mode(v: number) {
    this.m.hram[0x20] = v;
  }
  private word(a: number): number {
    return this.m.rd(a) | (this.m.rd(a + 1) << 8);
  }
  private setWord(a: number, v: number): void {
    this.m.wr(a, v & 0xff);
    this.m.wr(a + 1, (v >> 8) & 0xff);
  }
  private get cursor(): number { return this.word(0xc781); } // 00:079F
  private set cursor(v: number) { this.setWord(0xc781, v); } // 00:07AA
  private get lineStart(): number { return this.word(0xc783); } // 00:078D
  private set lineStart(v: number) { this.setWord(0xc783, v); } // 00:0796

  /** 00:07E9 — map the text bank (0A for mode 2, else 0B); the old bank goes to FFA1. */
  private textBank(): void {
    const b = this.mode === 2 ? 0x0a : 0x0b;
    this.m.hram[0x21] = this.m.selectBank(b);
  }

  /** 00:07C7 — read pointer = table bc entry e (mode 2: 256 * (d - 1) + e; mode 3: D90C). */
  private tablePointer(bc: number, d: number, e: number): void {
    let hl: number;
    switch (this.mode) {
      case 2: hl = (((d - 1) & 0xff) << 8) | e; break;
      case 3: hl = this.m.rd(0xd90c); break;
      default: hl = e; break;
    }
    this.ptr = this.word((2 * hl + bc) & 0xffff);
  }

  // ------------------------------------------------------------ entry points

  /** rst $20 (00:0800) — run script DE (D = 0: bank 0B table 4000; D != 0: bank 0A; in battle:
   *  battle message D90C from 0B:6B80; E = 0x70 with D = 0: special full-screen text). */
  *script(de: number): Co {
    const m = this.m;
    const d = de >> 8, e = de & 0xff;
    let mode: number, bc: number;
    if (m.hram[0x0b]) { mode = 3; bc = 0x6b80; }
    else if (d) { mode = 2; bc = 0x4000; }
    else if (e !== 0x70) { mode = 1; bc = 0x4000; }
    else {
      // 00:0820 — mode 4: no context push
      this.mode = 4;
      m.wr(0xc77e, 0x14);
      this.textBank();
      this.tablePointer(0x4000, d, e);
      fill(m, 0xc800, 0x300, 0xff);
      this.lineStart = 0xc814;
      this.cursor = 0xc814;
      yield* this.loop();
      m.selectBank(m.hram[0x21]!);
      return;
    }
    // 00:084E — push the context (FFA0-FFA3) on the C779 stack
    let sp = this.word(0xc779);
    for (let i = 0; i < 4; i++) m.wr(sp++, m.hram[0x20 + i]!);
    this.setWord(0xc779, sp);
    m.wr(0xc77c, m.rd(0xc77d));
    m.wr(0xc77d, m.rd(0xc77d) + 1);
    this.mode = mode;
    this.textBank();
    this.tablePointer(bc, d, e);
    m.wr(0xc77e, 0x20);
    yield* this.loop();
    // 00:0881 — restore bank and pop the context
    m.selectBank(m.hram[0x21]!);
    sp = this.word(0xc779);
    for (let i = 3; i >= 0; i--) m.hram[0x20 + i] = m.rd(--sp);
    this.setWord(0xc779, sp);
    const depth = (m.rd(0xc77d) - 1) & 0xff;
    m.wr(0xc77d, depth);
    m.wr(0xc77c, depth - 1);
  }

  /** rst $08 (00:0908) / 00:0901 (A = C7D2 flags) — window message E from 0B:7400: header
   *  [x | flag, y | flag, w, h], text drawn into the window buffer, then blitted. */
  *message(e: number, flags = 0): Co {
    const m = this.m;
    m.wr(0xc7d2, flags);
    this.mode = 0;
    m.wr(0xc799, 0);
    m.wr(0xc79a, 0);
    this.textBank();
    this.tablePointer(0x7400, 0, e);
    // header
    let p = this.ptr;
    for (let i = 0; i < 2; i++) {
      const v = m.rd(p++);
      m.wr(0xc799 + i, ((m.rd(0xc799 + i) << 1) | (v >> 7)) & 0xff);
      m.wr(0xc79b + i, v & 0x1f);
    }
    m.wr(0xc79d, m.rd(p++));
    m.wr(0xc79e, m.rd(p++));
    this.ptr = p;
    const buf = m.rd(0xc799) ? 0xd000 : 0xc800;
    fill(m, buf, m.rd(0xc799) ? 0x400 : 0x300, 0xff);
    const tab = m.hram[0x0b] ? 0x0b09 : m.rd(0xc764) ? 0x0b0b : 0x0b0d;
    m.wr(0xc7a4, m.rd(tab));
    m.wr(0xc7a5, m.rd(tab + 1));
    // cursor column/row
    const x = m.rd(0xc79b), y = m.rd(0xc79c);
    if (flags & 2) {
      m.wr(0xc7a1, x);
      m.wr(0xc7a2, x);
      m.wr(0xc7a3, y);
    } else {
      m.wr(0xc7a1, x + 1);
      m.wr(0xc7a2, x + 1);
      m.wr(0xc7a3, y + 1);
    }
    // 00:09A2 — subtract C7A4 from C79C (from C79D when bit 1: the pointer was not advanced)
    const adj = flags & 2 ? 0xc79d : 0xc79c;
    const yy = m.rd(adj) - m.rd(0xc7a4);
    m.wr(adj, yy < 0 ? 0 : yy);
    let hl: number;
    if (!(flags & 2)) hl = this.drawFrame(m.rd(0xc79d), m.rd(0xc79e));
    else hl = 0xc79e; // 00:09AC: hl still points into the header copy
    let b = m.rd(0xc79d);
    if (m.rd(0xc799)) b = 0x22;
    if (m.rd(0xc79a)) {
      m.wr(0xc7c8, hl & 0xff);
      m.wr(0xc7c9, hl >> 8);
      b = (b - 2) & 0xff;
      hl = (hl + b) & 0xffff;
    } else {
      const w = m.rd(0xc79d);
      hl = 0xc800 + ((flags & 2 ? w : 2 * w + 1) & 0xff);
    }
    m.wr(0xc77e, b);
    this.lineStart = hl;
    this.cursor = hl;
    // window extents (00:09E9)
    const c0 = m.rd(0xc79b), b0 = m.rd(0xc79c);
    m.wr(0xc79f, (m.rd(0xc79d) + c0 - 1) & 0xff);
    const bot = (m.rd(0xc79e) + b0 - 1) & 0xff;
    m.wr(0xc7a0, (m.rd(0xc7a4) + bot) & 0xff);
    m.wr(0xc7d0, c0);
    m.wr(0xc7d1, (b0 + m.rd(0xc7a4)) & 0xff);
    m.wr(0xc7cf, m.rd(0xc79a) ? m.rd(0xc7ca) : 0);
    yield* this.loop();
    // 00:0A1F — cursor sprites, blit, restore bank
    spriteTick(m);
    yield* this.blitWindow();
    m.selectBank(m.hram[0x21]!);
  }

  /** 00:155A — print the string at de inside the current context (names, numbers). */
  *print(de: number): Co {
    const m = this.m;
    const saved = this.ptr;
    this.ptr = de;
    const lvl = m.rd(0xc77c);
    m.wr(0xc77c, 1);
    yield* this.loop();
    m.wr(0xc77c, lvl);
    this.ptr = saved;
  }

  /** 00:155A with a 0F-bank string (00:0EBB). */
  private *printBank0F(de: number): Co {
    const prev = this.m.selectBank(0x0f);
    yield* this.print(de);
    this.m.selectBank(prev);
  }

  // ------------------------------------------------------------ the loop

  /** `call 070C; jr $-3` — interpret until an END. */
  *loop(): Co {
    for (;;) if ((yield* this.step()) === END) return;
  }

  /** 00:070C — one byte. */
  private *step(): Step {
    this.m.wr(0xc77b, 0);
    return yield* this.dispatch(this.next());
  }

  private *dispatch(a: number): Step {
    if (a >= 0x9e) return yield* this.char(a);
    if (a >= 0x4e) {
      // dictionary pair, 0F:6560
      const p = 0x6560 + 2 * (a - 0x4e);
      yield* this.char(this.m.romAt(0x0f, p));
      return yield* this.char(this.m.romAt(0x0f, p + 1));
    }
    return yield* this.control(a);
  }

  /** 00:073B — print a character at the cursor (mode 1-3: one frame per character, line
   *  budget, speed control). */
  private *char(a: number): Step {
    const m = this.m;
    const mode = this.mode;
    if (mode && mode !== 4) {
      if (mode !== 5) yield* this.openWindow();
      if (!m.rd(0xc77f)) {
        m.wr(0xc77f, m.rd(0xc77e));
        yield* this.newline2();
      }
      if (mode !== 5) yield* frameDma(this.g);
    }
    m.wr(0xc7a1, m.rd(0xc7a1) + 1);
    const c = this.cursor;
    m.wr(c, a);
    this.cursor = c + 1;
    if (!mode || mode === 4) return;
    m.wr(0xc77f, m.rd(0xc77f) - 1);
    if (mode === 5) return;
    yield* this.speed();
  }

  /** 00:08D6 — extra frames per character: 2 x C31B, A (FF89 bit 0) skips, B adds; C765 bits
   *  disable the A / B effects. */
  private *speed(): Co {
    const m = this.m;
    const e = m.rd(0xc765);
    if (!(e & 1) && m.hram[0x09]! & 1) return;
    let b = (m.rd(0xc31b) * 2) & 0xff;
    if (!b) return;
    for (;;) {
      const a = m.hram[0x09]!;
      if (!(e & 1) && a & 1) return;
      if (!(e & 2) && a & 2) b = (b + 1) & 0xff;
      yield* frameDma(this.g);
      b = (b - 1) & 0xff;
      if (!b) return;
    }
  }

  // ------------------------------------------------------------ window

  /** 00:0E30 — open the message window (once): flags, frame at 9C00, window on. */
  *openWindow(): Co {
    const m = this.m;
    if (m.rd(0xc764)) return;
    m.wr(0xc764, 1);
    m.wr(0xc7de, 1);
    if (m.hram[0x0b]) {
      m.wr(0xc7de, 0);
      fill(m, 0xc7a6, 0x20, 0);
      fill(m, 0xff97, 4, 0xff);
    }
    yield* frameDma(this.g);
    yield* this.resetWindow();
  }

  /** 00:0E5C — close the message window. */
  *closeWindow(): Co {
    const m = this.m;
    if (!m.rd(0xc764)) return;
    m.wr(0xc764, 0);
    m.wr(0xc7de, 0);
    yield* vsync(this.g);
    dmaCurrent(m);
    m.wr(0xff40, m.rd(0xff40) & 0xc3);
  }

  /** 00:0E72 — clear the message window: cursor 9C41, frame 20x8 (battle 20x10), WY 0x50
   *  (battle 0x40). */
  *resetWindow(): Co {
    const m = this.m;
    m.wr(0xc77f, 0x12); // 00:0E9C
    m.wr(0xc780, 0x12);
    this.cursor = 0x9c41;
    this.lineStart = 0x9c41;
    let e = 0x50, w = 0x14, h = 0x08;
    if (m.hram[0x0b]) { e = 0x40; h = 0x0a; }
    m.wr(0xc7a5, e);
    this.drawFrame(w, h);
    yield* this.blit(0x9c00, w, h);
  }

  /** 00:0A2B — draw a w x h frame into the window buffer (C800, D000 when C799); returns the
   *  position after the last byte. Tiles F7-FF: corners and edges. */
  drawFrame(w: number, h: number): number {
    const m = this.m;
    let hl = m.rd(0xc799) ? 0xd000 : 0xc800;
    const inner = ((w - 2) & 0xff) || 256; // 00:006D dec-loop: 0 means 256
    let rows = (h - 2) & 0xff;
    let a = 0xf7;
    // top: F7, F8 x inner, F9
    m.wr(hl++ & 0xffff, a);
    for (let i = 0; i < inner; i++) m.wr(hl++ & 0xffff, (a + 1) & 0xff);
    a = (a + 2) & 0xff;
    m.wr(hl++ & 0xffff, a);
    a = (a + 1) & 0xff; // FA
    do {
      m.wr(hl++ & 0xffff, a);
      for (let i = 0; i < inner; i++) m.wr(hl++ & 0xffff, 0xff);
      m.wr(hl++ & 0xffff, (a + 1) & 0xff);
      rows = (rows - 1) & 0xff;
    } while (rows);
    a = (a + 2) & 0xff; // FC
    m.wr(hl++ & 0xffff, a);
    for (let i = 0; i < inner; i++) m.wr(hl++ & 0xffff, (a + 1) & 0xff);
    m.wr(hl++ & 0xffff, (a + 2) & 0xff);
    return hl & 0xffff;
  }

  /** 00:0AC2 — copy the window buffer (w x h) to the BG map at de, then window on at WY C7A5. */
  *blit(de: number, w: number, h: number): Co {
    const m = this.m;
    const src = m.rd(0xc799) ? 0xd000 : 0xc800;
    yield* this.copyRect(src, de, w, h);
    yield* frameDma(this.g);
    m.wr(0xff4a, m.rd(0xc7a5));
    m.wr(0xff4b, 0x07);
    m.wr(0xff40, 0xe3);
  }

  /** 00:0AF3 — copy h rows of w bytes from hl to de (stride 32) inside a VRAM access window. */
  *copyRect(hl: number, de: number, w: number, h: number): Co {
    const m = this.m;
    // dec-loops: a width or height of 0 means 256; after each row de += (0x20 - w) & 0xff.
    yield* vramBegin(this.g);
    for (let r = 0; r < (h || 256); r++) {
      const n = w || 256;
      for (let i = 0; i < n; i++) m.wr((de + i) & 0xffff, m.rd((hl + i) & 0xffff));
      hl = (hl + n) & 0xffff;
      de = (de + n + ((0x20 - w) & 0xff)) & 0xffff;
    }
    yield* vramEnd(this.g);
  }

  /** 00:0A5C — after a window message: copy the buffer to the screen at (C79B, C79C) of 9C00
   *  (sliding windows C79A copy their visible part from C7C8 first). */
  *blitWindow(): Co {
    const m = this.m;
    if (m.rd(0xc7d2) & 1) return;
    const de = 0x9c00 + m.rd(0xc79b) + 32 * m.rd(0xc79c);
    if (m.rd(0xc79a)) {
      let d = 0xc800 + ((m.rd(0xc79d) + 1) & 0xff);
      let hl = (this.word(0xc7c8) + ((m.rd(0xc77e) * m.rd(0xc798)) & 0xffff)) & 0xffff;
      if (m.rd(0xc799)) {
        d = 0xd000 + ((m.rd(0xc79d) + 1) & 0xff);
        hl = (hl + m.rd(0xc797)) & 0xffff;
      }
      // dec-loops (00:0AA8): a size of 0 means 256
      const b = ((m.rd(0xc79d) - 2) & 0xff) || 256, c = ((m.rd(0xc79e) - 2) & 0xff) || 256;
      for (let r = 0; r < c; r++) {
        for (let i = 0; i < b; i++) m.wr((d + i) & 0xffff, m.rd((hl + i) & 0xffff));
        d = (d + b + 2) & 0xffff;
        hl = (hl + m.rd(0xc77e)) & 0xffff;
      }
    }
    yield* this.blit(de, m.rd(0xc79d), m.rd(0xc79e));
  }

  // ------------------------------------------------------------ lines

  /** 00:0DED — two newlines. */
  private *newline2(): Co {
    yield* this.newline();
    yield* this.newline();
  }

  /** 00:0DF0 — newline: reset the line budget; in a full script window scroll it up one line
   *  (00:08AA); else move the line start down by the stride. */
  private *newline(): Co {
    const m = this.m;
    m.wr(0xc77f, m.rd(0xc780));
    const mode = this.mode;
    if (mode && mode < 4) {
      yield* this.openWindow();
      const bottom = mode === 3 ? 0x9d01 : 0x9cc1;
      if (this.lineStart === bottom) {
        yield* this.scrollUp();
        this.cursor = this.lineStart;
        return;
      }
    }
    const hl = (this.lineStart + m.rd(0xc77e)) & 0xffff;
    this.cursor = hl;
    this.lineStart = hl;
    m.wr(0xc7a3, m.rd(0xc7a3) + 1);
    m.wr(0xc7a1, m.rd(0xc7a2));
  }

  /** 00:08AA — scroll the message window text up one line (20 or 28 bytes per line). */
  private *scrollUp(): Co {
    const m = this.m;
    const n = this.mode === 3 ? 0xe0 : 0xa0;
    yield* vramBegin(this.g);
    for (let i = 0; i < n; i++) m.wr(0x9c20 + i, m.rd(0x9c40 + i));
    fill(m, this.mode === 3 ? 0x9d01 : 0x9cc1, 0x12, 0xff);
    yield* vramEnd(this.g);
    yield* this.speed();
  }

  // ------------------------------------------------------------ control codes

  /** Control codes 00-4D (table 00:13BE). Returns END for 00/0E. */
  private *control(a: number): Step {
    const m = this.m, g = this.g;
    this.coverage[a] = (this.coverage[a] ?? 0) + 1;
    switch (a) {
      case 0x00: case 0x0e: return yield* this.end();
      case 0x01: m.wr(0xc7a1, m.rd(0xc7a1) + 1); this.cursor = this.cursor + 1; return;
      case 0x02: m.wr(0xc7a1, m.rd(0xc7a1) - 1); this.cursor = this.cursor - 1; return;
      case 0x03: case 0x04: {
        const up = a === 0x03;
        m.wr(0xc7a3, m.rd(0xc7a3) + (up ? -1 : 1));
        const bc = up ? -m.rd(0xc77e) : m.rd(0xc77e);
        this.lineStart = this.lineStart + bc;
        this.cursor = this.cursor + bc;
        return;
      }
      case 0x05: return yield* this.newline();
      case 0x06: return yield* this.newline2();
      case 0x07: return yield* this.char(this.next());
      case 0x08: return yield* this.portrait();
      case 0x09: return yield* this.battle();
      case 0x0a: return yield* this.printBank0F(0x7ad5);
      case 0x0b: return yield* this.waitButton();
      case 0x0c: return yield* this.openWindow();
      case 0x0d: return yield* this.closeWindow();
      case 0x0f: return yield* this.resetWindow();
      case 0x10: yield* this.calls.far(g, 0x1909); return yield* frameDma(g);
      case 0x11: {
        // 00:0CC0: dec-loop, so a count of 0 means 256 (512 frames)
        let b = this.next();
        do {
          yield* frameDma(g);
          yield* frameDma(g);
          b = (b - 1) & 0xff;
        } while (b);
        return;
      }
      case 0x12: { const e = this.next(); const v = varGet(m, e); varSet(m, e, v === 0x0f ? v : v + 1); return; }
      case 0x13: { const e = this.next(); const v = varGet(m, e); varSet(m, e, v ? v - 1 : 0); return; }
      case 0x14: { const e = this.next(); varSet(m, e, this.next()); return; }
      case 0x15: {
        const e = this.next(), c = this.next();
        const lo = c >> 4, hi = ((c & 0x0f) + 1) & 0xff;
        const v = varGet(m, e);
        if (v < lo || v >= hi) this.skip4();
        return;
      }
      case 0x16: if (yield* this.yesNo()) this.skip4(); return;
      case 0x17: if (!this.hasItem(this.next())) this.skip4(); return;
      case 0x18: { const [d, e] = this.nibbles(); bit2Set(m, d, e); return; }
      case 0x40: { const [d, e] = this.nibbles(); bit2Clear(m, d, e); return; }
      case 0x19: {
        const hl = this.ptr;
        const d = this.next(), e = this.next();
        if (d < 4) return yield* this.script((d << 8) | e);
        if (d === 4) return yield* this.event4((d << 8) | e);
        this.ptr = (yield* this.calls.far(g, 0x1906, { hl })) as number;
        return;
      }
      case 0x1a: if (m.rd(0xc2d9) >= ((this.next() + 1) & 0xff)) this.skip4(); return;
      case 0x1b: if (!(m.rd(0xc2da + 2 * this.next()) & 0x0f)) this.skip4(); return;
      case 0x1c: return yield* this.itemName8();
      case 0x1d: return yield* this.magiCount();
      case 0x1e: this.formatGp(this.next()); return yield* this.printZ(0xc785);
      case 0x1f: return yield* this.memberName();
      case 0x20: {
        m.wr(0xc77b, 0x21);
        return yield* this.control(this.next());
      }
      case 0x21: return yield* this.speciesName();
      case 0x22: return yield* this.itemName();
      case 0x23: case 0x2b: return yield* this.itemUses();
      case 0x24: return yield* this.hp(m.hram[0x0b] ? 0xd041 : 0xc207);
      case 0x25: return yield* this.hp(m.hram[0x0b] ? 0xd00c : 0xc209);
      case 0x26: return yield* this.number2(0xc70d + this.next());
      case 0x27: return yield* this.stat(0xc20b);
      case 0x28: return yield* this.stat(0xc20e);
      case 0x29: return yield* this.stat(0xc20c);
      case 0x2a: return yield* this.stat(0xc20d);
      case 0x2c: return yield* this.number2(0xc2d9);
      case 0x2d: {
        const c = varGet(m, 0x18);
        const n = this.next();
        if (n !== c && n > c) return this.dropMenuItem();
        yield* this.printN0F((n * 16 + 0x76c0) & 0xffff, 0x10);
        return yield* this.newline2();
      }
      case 0x2e: this.menuItem(0xc380); return;
      case 0x2f: return yield* this.printBank0F(0x7ae2);
      case 0x30: return yield* this.number(this.word(0xd900 + 2 * this.next()), 0);
      case 0x31: return;
      case 0x32: {
        const e = this.next();
        yield* this.saveWindowRows();
        yield* this.message(e);
        while ((yield* this.menu(0)) === 0xff);
        yield* this.restoreWindowRows();
        return;
      }
      case 0x33: {
        m.wr(0xc70a, this.next());
        m.wr(0xc70b, this.next());
        m.wr(0xc70c, 0);
        if (!lt24(m, 0xc2a2, 0xc70a)) sub24(m, 0xc2a2, 0xc70a);
        else wr24(m, 0xc2a2, 0);
        return;
      }
      case 0x34: {
        yield* this.closeWindow();
        yield* this.prepareMenu();
        yield* this.calls.far(g, 0x15006, { a: 2 }); // A = 2 from 00:14DF
        const bank = m.hram[0x08]!;
        yield* this.calls.far(g, 0x1915);
        m.selectBank(bank);
        return yield* this.endMenu();
      }
      case 0x35: {
        this.formatGp(this.next());
        const n = (this.next() + 2) & 0xff;
        return yield* this.printZ(0xc785 + ((8 - n) & 0xff));
      }
      case 0x36: { const c = this.next(); m.wr(0xc7a1, m.rd(0xc7a1) + c); this.cursor = this.cursor + c; return; }
      case 0x37: if (m.rd(0xc763)) yield* this.script(0x0003); return;
      case 0x38: return yield* this.guestJoin();
      case 0x39: {
        this.menuItem(0xd500);
        yield* this.blanks(1);
        const v = this.next();
        const i = m.rd(0xc7d6);
        m.wr(0xc7d6, i + 1);
        m.wr(0xd400 + i, v);
        return yield* this.dispatch(v);
      }
      case 0x3a: {
        const hl = 0xd500 + (this.next() << 8);
        if (!m.rd(hl)) return yield* this.blanks(2);
        return yield* this.number2(hl + 1);
      }
      case 0x3b: return yield* this.statusOrMaxHp();
      case 0x3c: return yield* this.printBank0F(0x7ae5);
      case 0x3d: return yield* this.printBank0F(0x7ae8);
      case 0x3e: yield* this.calls.far(g, 0x1501e); return;
      case 0x3f: { const c = this.next(), b = this.next(); yield* this.calls.far(g, 0x15027, { b, c }); return; }
      case 0x41: return yield* this.phraseList();
      case 0x42: return yield* this.phrase();
      case 0x43: {
        let n = 0;
        for (let i = 0; i < 4; i++) if (m.rd(memberAddr(m, i, 0xc206)) & 0x10) n++;
        if (n !== 4) this.skip4();
        return;
      }
      case 0x44: if (m.hram[0x30] !== this.next()) this.skip4(); return;
      case 0x45: if (m.rd(0xc2a1) < this.next()) this.skip4(); return;
      case 0x46: {
        const prev = m.selectBank(0x01);
        yield* this.calls.far(g, 0x15021);
        m.wr(0xc2a0, 0xe4);
        yield* this.calls.far(g, 0x15024);
        yield* this.calls.far(g, 0x1921);
        m.selectBank(prev);
        return;
      }
      case 0x47: {
        yield* this.saveWindowRows();
        yield* this.message(0x45);
        const v = yield* this.menu(0);
        if (v !== 0xff) {
          const s = m.romAt(0x0f, 0x7aee + v);
          m.hram[0x30] = s;
          m.wr(0xc31a, s);
        }
        return yield* this.restoreWindowRows();
      }
      case 0x48: { const c = this.next(), b = this.next(); yield* this.calls.far(g, 0x1502a, { b, c }); return; }
      case 0x49: return yield* this.saveOp(this.next());
      case 0x4a: m.wr(0xc765, 3); m.wr(0xc31b, 4); return;
      case 0x4b: {
        const [d, e] = this.nibbles();
        bit2Set(m, d, e);
        return yield* this.phraseText(d, e);
      }
      case 0x4c: m.wr(0xc354, 0xff); return;
      case 0x4d: {
        yield* this.calls.far(g, 0x15036);
        yield* this.waitButton();
        return this.calls.reset(g);
      }
      default:
        throw new Error(`text control code ${a.toString(16)} has no handler`);
    }
  }

  /** 00:0B0F — end of text; a top-level script window waits for a button and closes. */
  private *end(): Step {
    const m = this.m;
    const mode = this.mode;
    if (mode && mode < 3 && !m.rd(0xc77c) && m.rd(0xc764)) {
      yield* this.waitButton();
      yield* waitReleaseDma(this.g);
      yield* this.closeWindow();
    }
    return END;
  }

  /** 00:0CA9 — wait for a new button press (DMA frames). */
  *waitButton(): Co {
    yield* waitReleaseDma(this.g);
    do {
      yield* frameDma(this.g);
      joyRepeat(this.m);
    } while (!this.m.hram[0x0a]);
    yield* waitReleaseDma(this.g);
  }

  /** 00:0B66 */
  private nibbles(): [number, number] {
    const v = this.next();
    return [v >> 4, v & 0x0f];
  }

  /** 00:0B72 — item n carried by a member (8 slots each), the guest, or in the bag. */
  private hasItem(n: number): boolean {
    const m = this.m;
    const find = (hl: number, c: number) => {
      for (let i = 0; i < c; i++) if (m.rd(hl + 2 * i) === n) return true;
      return false;
    };
    for (let k = 0, hl = 0xc20f; k < 4; k++, hl += 0x20) if (find(hl, 8)) return true;
    if (varGet(m, 0) && find(0xc28f, 8)) return true;
    return find(0xc2b9, 16);
  }

  /** 00:0CEC / 00:0CEF — record the cursor (row + 1, column - 1) as the next menu item. */
  private menuItem(list: number): void {
    const m = this.m;
    const i = m.rd(0xc7ca);
    m.wr(0xc7ca, i + 1);
    const hl = list + 2 * i;
    m.wr(hl, m.rd(0xc7a3) + 1);
    m.wr(hl + 1, m.rd(0xc7a1) - 1);
  }

  /** 00:11BA — remove the last menu item. */
  private dropMenuItem(): void {
    const m = this.m;
    const i = (m.rd(0xc7ca) - 1) & 0xff;
    m.wr(0xc7ca, i);
    m.wr(0xc380 + 2 * i, 0xff);
    m.wr(0xc381 + 2 * i, 0xff);
  }

  /** 00:13B6 — member argument: < 5 itself, else the current member C709. */
  private memberArg(): number {
    const a = this.next();
    return a < 5 ? a : this.m.rd(0xc709);
  }

  /** 00:1201/1204 — a member's 16-bit value (HP) at base hl, 3 digits (max 999). */
  private *hp(base: number, member = this.memberArg()): Co {
    const m = this.m;
    const hl = memberAddr(m, member, base);
    let v = m.rd(hl) | (m.rd(hl + 1) << 8);
    if (v >= 1000) v = 999;
    yield* this.number(v, 2);
  }

  /** 00:12D4 — a member's stat byte, 2 digits. */
  private *stat(base: number): Co {
    yield* this.number2(memberAddr(this.m, this.memberArg(), base));
  }

  /** 00:0FF2 — member name (4 bytes; battle: enemies D002 + ...). */
  private *memberName(): Co {
    const m = this.m;
    let hl = m.hram[0x0b] ? 0xd002 : 0xc200;
    const a = this.next();
    let b = 4;
    if (a < 5) hl = memberAddr(m, a, hl);
    else if (a < 0x0a) hl = (hl + (((a - 5) * 32) & 0xff)) & 0xffff; // 00:101E: x32 (00:004C)
    else if (a < 0x0d) {
      const i = m.rd(0xd906 + 2 * (a - 0x0a));
      hl = memberAddr(m, i, 0xd002);
      b = 8;
    } else hl = memberAddr(m, m.rd(0xc709), hl);
    yield* this.printN(hl, b);
  }

  /** 00:1032 — species/monster name (0F:6EC0 table). */
  private *speciesName(): Co {
    const m = this.m;
    const a = this.next();
    let hl: number;
    if (a < 5) hl = memberAddr(m, a, 0xc204);
    else if (a < 0x0d) hl = 0xc73d + (a - 5);
    else if (a < 0x10) hl = 0xd906 + 2 * (a - 0x0d);
    else if (a === 0x10) hl = memberAddr(m, m.rd(0xc709), 0xc204);
    else if (a < 0x14) {
      hl = 0xd500 + ((a - 0x11) << 8);
      if (!m.rd(hl)) return yield* this.blanks(8);
      hl += 0x0a;
    } else return yield* this.name8(0x6ec0, this.next());
    yield* this.name8(0x6ec0, m.rd(hl));
  }

  /** 00:1086 — name from the 0F:6E40 table (C7E0 list / C71D list / equipment of C709). */
  private *itemName8(): Co {
    const m = this.m;
    const a = this.next();
    let hl: number;
    if (a < 0x10) hl = 0xc7e0 + a;
    else if (a >= 0x30) hl = 0xc21f + ((m.rd(0xc709) * 32) & 0xff);
    else hl = 0xc71d + (((a - 0x20) * 2) & 0xff);
    const v = m.rd(hl);
    if (v === 0xff) return yield* this.blanks(8);
    yield* this.name8(0x6e40, v);
  }

  /** 00:121E — MAGI count of the listed MAGI, 1 digit. */
  private *magiCount(): Co {
    const m = this.m;
    const a = this.next();
    const hl = a < 0x10 ? 0xc7e0 + a : 0xc21f + ((m.rd(0xc709) * 32) & 0xff);
    const v = m.rd(hl);
    if (v === 0xff) return yield* this.blanks(1);
    yield* this.number(m.rd(0xc2da + ((2 * v) & 0xff)) & 0x0f, 4);
  }

  /** 00:10BB — item name (0F:6640 table) from inventories, equipment, enemies. */
  private *itemName(): Co {
    const m = this.m;
    let hl = 0xc20f;
    let a = this.next();
    if (a < 0x10) hl = 0xc71d;
    else if (a < 0x20) { a -= 0x10; hl = 0xc2b9; }
    else if (a < 0x48) {
      const k = a < 0x28 ? 1 : a < 0x30 ? 2 : a < 0x38 ? 3 : a < 0x40 ? 4 : 5;
      a = (a - 8 * (k - 1) - 0x20) & 0xff;
      hl = (hl + 0x20 * k) & 0xffff;
    } else if (a < 0x51) {
      const b = a - 0x48;
      if (m.hram[0x0b]) {
        const p = this.enemyItem(b);
        if (p === null) return yield* this.blanks(8);
        return yield* this.name8(0x6640, m.rd(p) | (m.rd(p + 1) << 8));
      }
      hl = memberAddr(m, m.rd(0xc709), 0xc20f);
      a = b;
    } else if (a < 0x63) {
      const p = 0xd906 + (((a - 0x60) * 2) & 0xff);
      return yield* this.name8(0x6640, m.rd(p) | (m.rd(p + 1) << 8));
    } else return yield* this.name8(0x6640, this.next());
    hl = (hl + ((a * 2) & 0xff)) & 0xffff;
    const v = m.rd(hl);
    if (v === 0xff) return yield* this.blanks(8);
    yield* this.name8(0x6640, v);
  }

  /** 00:1622 — battle: action slot b of the current actor (D012 + 3b) if it is an item with
   *  0C:6F80 flag bit 0 set; returns its address or null. */
  private enemyItem(b: number): number | null {
    const m = this.m;
    const hl = memberAddr(m, m.rd(0xc709), 0xd012) + 3 * b;
    const lo = m.rd(hl);
    if (lo === 0xff) return null;
    const id = lo | (m.rd(hl + 1) << 8);
    if (!(m.romAt(0x0c, (id * 8 + 0x6f80) & 0xffff) & 1)) return null;
    return hl;
  }

  /** 00:124B — remaining uses of an item (FE = infinite: 0F:7AD2), 2 digits. */
  private *itemUses(): Co {
    const m = this.m;
    let hl = 0;
    let a = this.next();
    if (a < 0x10) hl = 0xc71d;
    else if (a < 0x20) { a -= 0x10; hl = 0xc2b9; }
    else if (a < 0x48) {
      const k = a < 0x28 ? 0 : a < 0x30 ? 1 : a < 0x38 ? 2 : a < 0x40 ? 3 : 4;
      a = (a - 8 * k - 0x20) & 0xff;
      hl = 0xc20f + 0x20 * k;
    } else {
      const b = a - 0x48;
      if (m.hram[0x0b]) {
        const p = this.enemyItem(b);
        if (p === null) return yield* this.blanks(2);
        return yield* this.usesAt(p + 2);
      }
      hl = memberAddr(m, m.rd(0xc709), 0xc20f + 2 * b);
      a = 0;
    }
    hl = (hl + ((a * 2) & 0xff)) & 0xffff;
    if (m.rd(hl) === 0xff) return yield* this.blanks(2);
    yield* this.usesAt(hl + 1);
  }

  private *usesAt(hl: number): Co {
    if (this.m.rd(hl) === 0xfe) return yield* this.printBank0F(0x7ad2);
    yield* this.number2(hl);
  }

  /** 00:11D8 — status name (0F:7840) if the member has a status, else max HP. */
  private *statusOrMaxHp(): Co {
    const m = this.m;
    const base = m.hram[0x0b] ? 0xd040 : 0xc206;
    const c = this.memberArg();
    const st = statusIndex(m, m.rd(memberAddr(m, c, base)));
    if (st) return yield* this.printN0F(0x7840 + 4 * (st - 1), 4);
    m.wr(0xc7a1, m.rd(0xc7a1) + 1);
    this.cursor = this.cursor + 1;
    yield* this.hp(m.hram[0x0b] ? 0xd00c : 0xc209, c);
  }

  /** 00:1153 — print the name of list d (0F:4250) if any of its 16 bits is set. */
  private *phraseList(): Co {
    const m = this.m;
    let d = this.next();
    if (d >= 0x10) d = m.rd(0xc7d9);
    for (let e = 0; e < 0x10; e++) {
      if (!bit2Test(m, d, e)) continue;
      const i = m.rd(0xc7da);
      m.wr(0xc7da, i + 1);
      m.wr(0xc71d + i, d);
      yield* this.blanks(1);
      yield* this.printTable0F(0x4250, d);
      return yield* this.newline2();
    }
    this.dropMenuItem();
  }

  /** 00:1184 — print phrase (C7D9, C7F2) inline if known. */
  private *phrase(): Co {
    const m = this.m;
    const d = m.rd(0xc7d9), e = m.rd(0xc7f2);
    if (!bit2Test(m, d, e)) return;
    m.wr(0xc77f, 0x12);
    m.wr(0xc780, 0x12);
    const mode = this.mode;
    this.mode = 5;
    yield* this.phraseText(d, e);
    this.mode = mode;
  }

  /** 00:11A1 — phrase e of list d: 0F:(4270 + 32d) word table. */
  private *phraseText(d: number, e: number): Co {
    yield* this.printTable0F((d * 32 + 0x4270) & 0xffff, e);
  }

  /** 00:11AB — print the 0F string whose pointer is entry a of the word table at hl. */
  private *printTable0F(hl: number, a: number): Co {
    const prev = this.m.selectBank(0x0f);
    const p = (hl + ((2 * a) & 0xff)) & 0xffff;
    const de = this.m.rd(p) | (this.m.rd(p + 1) << 8);
    yield* this.print(de);
    this.m.selectBank(prev);
  }

  /** 00:0F2F — the guest (slot 4) joins: from progress var 0. */
  private *guestJoin(): Co {
    const m = this.m;
    m.wr(0xc709, 4);
    m.wr(0xc348, 0);
    m.wr(0xc349, 0);
    const v = varGet(m, 0);
    this.initMember((v + 0xe0) & 0xff);
    for (let i = 0; i < 4; i++) m.wr(0xc280 + i, m.romAt(0x0f, 0x6610 + 4 * v + i));
  }

  /** 00:055D — initialize member C709 as monster/class n from 0D:6F80 + 10n. */
  initMember(n: number): void {
    const m = this.m;
    const prev = m.selectBank(0x0d);
    const src = (n * 10 + 0x6f80) & 0xffff;
    let de = memberAddr(m, m.rd(0xc709), 0xc204);
    const r = (o: number) => m.romAt(0x0d, src + o);
    m.wr(de++, n);
    const b0 = r(0);
    const race = b0 >> 4;
    m.wr(de++, race);
    m.wr(de++, 0);
    const hp = r(2) | (r(3) << 8);
    m.wr(de++, hp & 0xff); m.wr(de++, hp >> 8);
    m.wr(de++, hp & 0xff); m.wr(de++, hp >> 8);
    for (let i = 0; i < 4; i++) m.wr(de++, r(4 + i));
    const cnt = (b0 & 7) + 1;
    const lst = r(8) | (r(9) << 8);
    let d2 = de;
    for (let i = 0; i < cnt; i++) {
      m.wr(d2, m.romAt(0x0d, lst + i));
      d2 += 2;
    }
    m.selectBank(0x0c);
    for (let i = 0; i < cnt; i++) {
      let v = m.romAt(0x0c, 0x7e80 + m.rd(de));
      if (race === 3 && v !== 0xfe) v >>= 1;
      m.wr(de + 1, v);
      de += 2;
    }
    m.selectBank(prev);
  }

  /** 00:0D05 — portrait sprite of a member (8 slots C7A6, tiles 8000 + 0x80 slot). */
  private *portrait(): Co {
    const m = this.m;
    let a = this.next();
    let c: number, e: number;
    if (a >= 5 && a !== 0xff) {
      c = m.rd(0xc73d + (a - 5));
      e = 0xc0;
    } else {
      if (a === 0xff) a = m.rd(0xc709);
      if (a === 4 && !varGet(m, 0)) {
        this.cursor = this.cursor + 2;
        return;
      }
      const st = statusIndex(m, m.rd(memberAddr(m, a, m.hram[0x0b] ? 0xd040 : 0xc206)));
      e = m.romAt(0x0f, 0x4240 + st);
      c = m.rd(memberAddr(m, a, m.hram[0x0b] ? 0xd00a : 0xc204));
    }
    const b = m.rd(0xc796);
    m.wr(0xc796, (b + 1) & 7);
    const hl = 0xc7a6 + 4 * b;
    m.wr(hl, b | e);
    let k = m.romAt(0x01, 0x4300 + m.romAt(0x0d, 0x6b70 + c));
    if (k === 1) k |= 4;
    m.wr(hl + 1, k);
    const d = m.rd(0xc7a3), col = m.rd(0xc7a1);
    m.wr(0xc7a1, col + 2);
    m.wr(hl + 2, (d * 8) & 0xff);
    m.wr(hl + 3, (col * 8) & 0xff);
    // 00:160C — the class's tiles (bank 3) to 8000 + 0x80 * slot
    const page = (m.romAt(0x0d, 0x6b70 + c) + 0x40) & 0xff;
    const prev = m.selectBank(0x03);
    yield* vramBegin(this.g);
    for (let i = 0; i < 0x80; i++) m.wr(0x8000 + b * 0x80 + i, m.romAt(0x03, (page << 8) + i));
    yield* vramEnd(this.g);
    m.selectBank(prev);
    this.cursor = this.cursor + 2;
  }

  /** 00:0EC5 — battle with formation n (FF: random by zone); after a defeat (C763) the game
   *  over script 3 runs and, if the player continues, the battle is fought again (C2A1 counts). */
  private *battle(): Co {
    const m = this.m, g = this.g;
    yield* this.closeWindow();
    const bank = m.hram[0x08]!;
    const n = this.next();
    m.wr(0xc7f3, n);
    if (n === 0xff) yield* this.calls.far(g, 0x191e);
    else yield* this.calls.far(g, 0x190f, { c: n });
    m.selectBank(bank);
    for (;;) {
      m.wr(0xc764, 0);
      m.wr(0xc763, 0);
      m.wr(0xc7de, 0);
      m.hram[0x0b] = 0xff;
      this.pushContext();
      yield* this.calls.far(g, 0xd4000);
      this.popContext();
      if (!m.rd(0xc763)) return;
      if (varGet(m, 0x0b)) return this.calls.reset(g);
      yield* this.script(0x0003);
      if (yield* this.yesNo()) return this.calls.reset(g);
      const r = (m.rd(0xc2a1) + 1) & 0xff;
      if (r) m.wr(0xc2a1, r);
    }
  }

  /** 00:14AC — event kind 4 (scene DE via 01:5009, then 00:191B). */
  *event4(de: number): Co {
    const m = this.m, g = this.g;
    yield* this.closeWindow();
    yield* this.prepareMenu();
    const prev = m.selectBank(0x01);
    yield* this.calls.far(g, 0x15009, { d: de >> 8, e: de & 0xff });
    yield* this.calls.far(g, 0x191b);
    m.selectBank(prev);
    yield* this.endMenu();
  }

  /** 00:0C27 — code 0x49 n: show save slot C7DD's summary from battery RAM (slot base
   *  A000 + 0x150 * C7DD, 00:0C8C): 0 slot number, 1/2 bytes 011C/00D9, 3 leader name,
   *  4 leader HP, other: leader status or max HP. */
  private *saveOp(n: number): Co {
    const m = this.m;
    if (n === 0) return yield* this.number((m.rd(0xc7dd) + 1) & 0xff, 4);
    m.wr(0x0000, 0x0a);
    const base = (off: number) => (0xa000 + ((m.rd(0xc7dd) * 16) & 0xff) * 0x15 + off) & 0xffff;
    switch (n) {
      case 1: yield* this.number2(base(0x011c)); break;
      case 2: yield* this.number2(base(0x00d9)); break;
      case 3: yield* this.printN(memberAddr(m, 0, base(0)), 4); break;
      case 4: yield* this.hp(base(0x0007), 0); break;
      default: {
        const st = statusIndex(m, m.rd(memberAddr(m, 0, base(0x0006))));
        if (st) yield* this.printN0F(0x7840 + 4 * (st - 1), 4);
        else yield* this.hp(base(0x0009), 0);
        break;
      }
    }
    m.wr(0x0000, 0x00);
  }

  /** 00:14CA — save the window map rows 9C00-9CFF to 9D00, then 00:14D5. */
  *saveWindowRows(): Co {
    const m = this.m;
    yield* vramBegin(this.g);
    for (let i = 0; i < 0x100; i++) m.wr(0x9d00 + i, m.rd(0x9c00 + i));
    yield* vramEnd(this.g);
    yield* this.prepareMenu();
  }

  /** 00:14D5 — menu mode: no scroll window, cursors off, menu list cleared, FF96 = 2, push the
   *  text context (00:14E3). */
  *prepareMenu(): Co {
    const m = this.m;
    m.wr(0xc798, 0);
    fill(m, 0xff97, 4, 0xff);
    m.hram[0x1b] = 0;
    m.wr(0xc7ca, 0);
    m.wr(0xc7cf, 0);
    fill(m, 0xc380, 0x80, 0xff);
    m.hram[0x16] = 2;
    this.pushContext();
  }

  /** 00:14FF — restore the window rows, then 00:150A. */
  *restoreWindowRows(): Co {
    const m = this.m;
    yield* vramBegin(this.g);
    for (let i = 0; i < 0x100; i++) m.wr(0x9c00 + i, m.rd(0x9d00 + i));
    yield* vramEnd(this.g);
    yield* this.endMenu();
  }

  /** 00:150A — leave menu mode: FF96 = 0, cursors off, cursor sprites cleared, a frame, DMA
   *  page CC, pop the text context. */
  *endMenu(): Co {
    const m = this.m;
    m.hram[0x16] = 0;
    fill(m, 0xff97, 4, 0xff);
    fill(m, 0xcc80, 0x20, 0);
    yield* vsync(this.g);
    m.wr(0xff46, 0xcc);
    this.popContext();
  }

  /** 00:14E3 — push FFA0-FFA3 and C77E-C784 on the C779 stack. */
  pushContext(): void {
    const m = this.m;
    let sp = this.word(0xc779);
    for (let i = 0; i < 4; i++) m.wr(sp++, m.hram[0x20 + i]!);
    for (let i = 0; i < 7; i++) m.wr(sp++, m.rd(0xc77e + i));
    this.setWord(0xc779, sp);
  }

  /** 00:151C — pop them. */
  popContext(): void {
    const m = this.m;
    let sp = this.word(0xc779);
    for (let i = 6; i >= 0; i--) m.wr(0xc77e + i, m.rd(--sp));
    for (let i = 3; i >= 0; i--) m.hram[0x20 + i] = m.rd(--sp);
    this.setWord(0xc779, sp);
  }

  /** 00:1477 — yes/no prompt (message 0x12); returns the choice (0 = yes). */
  *yesNo(): Co<number> {
    yield* this.saveWindowRows();
    yield* waitReleaseDma(this.g);
    yield* this.message(0x12);
    let a: number;
    do a = yield* this.menu(0);
    while (a === 0xff);
    yield* waitReleaseDma(this.g);
    yield* this.restoreWindowRows();
    return a;
  }

  /** 00:18BC / 00:18C3 — run the menu engine (01:500C) with C7CD = 2 * C79A | a; returns FF8C. */
  *menu(a: number): Co<number> {
    const m = this.m;
    m.wr(0xc7cd, ((m.rd(0xc79a) * 2) | a) & 0xff);
    const prev = m.selectBank(0x01);
    yield* this.calls.far(this.g, 0x1500c);
    m.selectBank(prev);
    return m.hram[0x0c]!;
  }

  // ------------------------------------------------------------ print helpers

  /** 00:0C05 — skip the next 4 script bytes (failed condition). */
  private skip4(): void {
    this.ptr = this.ptr + 4;
  }

  /** 00:1549 — print b blanks (nothing while sub-dispatching, C77B). */
  private *blanks(b: number): Co {
    const m = this.m;
    if (m.rd(0xc77b)) return;
    fill(m, 0xc785, b, 0xff);
    m.wr(0xc785 + b, 0);
    yield* this.print(0xc785);
  }

  /** 00:1598 + 00:1557 — copy b bytes from hl (current bank) to C785 and print them; while
   *  sub-dispatching (C77B) trailing blanks are dropped. */
  private *printN(hl: number, b: number): Co {
    const m = this.m;
    let de = 0xc785;
    if (!m.rd(0xc77b)) {
      for (let i = 0; i < b; i++) m.wr(de++, m.rd(hl + i));
    } else {
      let c = de;
      for (let i = 0; i < b; i++) {
        const a = m.rd(hl + i);
        m.wr(de++, a);
        if (a !== 0xff) c = de;
      }
      de = c;
    }
    m.wr(de, 0);
    yield* this.print(0xc785);
  }

  /** 00:153E — printN from bank 0F. */
  private *printN0F(hl: number, b: number): Co {
    const prev = this.m.selectBank(0x0f);
    const m = this.m;
    let de = 0xc785;
    if (!m.rd(0xc77b)) {
      for (let i = 0; i < b; i++) m.wr(de++, m.rd(hl + i));
    } else {
      let c = de;
      for (let i = 0; i < b; i++) {
        const a = m.rd(hl + i);
        m.wr(de++, a);
        if (a !== 0xff) c = de;
      }
      de = c;
    }
    m.wr(de, 0);
    this.m.selectBank(prev);
    yield* this.print(0xc785);
  }

  /** 00:1538/1539/153B — name n (8 bytes) from the 0F table de. */
  private *name8(de: number, n: number): Co {
    yield* this.printN0F((n * 8 + de) & 0xffff, 8);
  }

  /** 00:157A — copy the zero-terminated string at hl to C785 (skipping FF while
   *  sub-dispatching) and print it. */
  private *printZ(hl: number): Co {
    const m = this.m;
    let de = 0xc785;
    const skip = m.rd(0xc77b) !== 0;
    for (;;) {
      const a = m.rd(hl++);
      if (skip && a === 0xff) continue;
      m.wr(de++, a);
      if (!a) break;
    }
    yield* this.print(0xc785);
  }

  /** 00:15D9 + 00:15BA — v as 5 decimal digits (B0-B9) at C785, leading zeros blank. */
  private digits5(v: number): void {
    const m = this.m;
    v &= 0xffff;
    let p = 0xc785;
    for (const d of [10000, 1000, 100, 10]) {
      m.wr(p++, Math.floor(v / d) & 0xff);
      v %= d;
    }
    m.wr(p, v & 0xff);
    this.blankZeros(5);
  }

  /** 00:15BA — turn the b digit values at C785 into characters, leading zeros blank (the last
   *  digit always shown); terminator after. */
  private blankZeros(b: number): void {
    const m = this.m;
    let hl = 0xc785, seen = false;
    for (; b > 0; b--) {
      let a = m.rd(hl);
      if (a || seen) {
        seen = true;
        a = (a + 0xb0) & 0xff;
      } else a = b === 1 ? 0xb0 : 0xff;
      m.wr(hl++, a);
    }
    m.wr(hl, 0);
  }

  /** 00:15B5 then print from C785 + skip (00:157A): v with 5 - skip digits. */
  private *number(v: number, skip: number): Co {
    this.digits5(v);
    yield* this.printZ(0xc785 + skip);
  }

  /** 00:12E6 — byte at hl, capped at 99, two digits. */
  private *number2(hl: number): Co {
    let a = this.m.rd(hl);
    if (a >= 0x64) a = 0x63;
    yield* this.number(a, 3);
  }

  /** 00:1313 — GP (C2A2 or C745 + 3(n-1)) as up to 7 characters at C785 with the "GP" suffix
   *  (C0 C9); 9999999 and more shows as 8 blanks. */
  private formatGp(n: number): void {
    const m = this.m;
    let hl = n ? 0xc745 + ((3 * (n - 1)) & 0xff) : 0xc2a2; // 00:131A: 8-bit offset
    if ((m.rd(hl) & m.rd(hl + 1) & m.rd(hl + 2)) === 0xff) {
      fill(m, hl, 8, 0xff);
      m.wr(hl + 8, 0);
      return;
    }
    // cap at 999999 (00:1469: 3F 42 0F)
    if (rd24(m, hl) >= 0x0f423f) hl = 0x1469;
    copy(m, hl, 0xc70a, 3);
    let v = rd24(m, 0xc70a);
    let bc = 0xc785;
    for (const d of [100000, 10000, 1000, 100, 10]) {
      let q = 0;
      while (v >= d) { v -= d; q++; }
      m.wr(bc++, q);
    }
    wr24(m, 0xc70a, v);
    m.wr(bc, m.rd(0xc70a));
    // 00:136A — b = 6 digits
    let p = 0xc785, seen = false;
    for (let b = 6; b > 0; b--) {
      let a = m.rd(p);
      if (a || seen) {
        seen = true;
        a = (a + 0xb0) & 0xff;
      } else a = b === 1 ? 0xb0 : 0xff;
      m.wr(p++, a);
    }
    m.wr(p++, 0xc0);
    m.wr(p++, 0xc9);
    m.wr(p, 0);
  }
}

/** 00:176C — cursor/portrait sprites into CC00-CC9F (bank 0F tables 4200/4230): the 8 portrait
 *  entries C7A6 (when FF96 bit 0) and the two menu cursors FF97/FF98, FF99/FF9A; C7C6/C7C7
 *  blink every 16 frames. */
export function spriteTick(m: Memory): void {
  const r = (a: number) => m.romAt(0x0f, a);
  let t = (m.rd(0xc7c6) + 1) & 0xff;
  m.wr(0xc7c6, t);
  if (t & 0x10) {
    m.wr(0xc7c6, 0);
    m.wr(0xc7c7, (m.rd(0xc7c7) & 1) ^ 1);
  }
  const blink = m.rd(0xc7c7);
  const four = (hl: number, d: number, e: number) => {
    for (let k = 0, bc = 0x4230; k < 4; k++, hl += 4, bc += 2) {
      m.wr(hl, r(bc) + d);
      m.wr(hl + 1, r(bc + 1) + e);
    }
  };
  if (m.hram[0x16]! & 1) {
    fill(m, 0xcc00, 0x80, 0);
    for (let i = 0; i < 8; i++) {
      const p = 0xc7a6 + 4 * i;
      const f = m.rd(p);
      if (!(f & 0x80)) continue;
      const g = m.rd(p + 1);
      const d = m.rd(p + 2);
      let e = m.rd(p + 3);
      const hl = 0xcc00 + ((f & 7) << 4);
      if (f & 0x20 && !blink) continue;
      if (f & 0x40 && !(g & 4)) e = (e + blink) & 0xff;
      four(hl, d, e);
      let tab = 0x4200;
      if (f & 0x40 && blink) tab = 0x4218;
      if (f & 0x10) tab += 0x0c;
      tab += (g & 3) * 4;
      const base = (f & 7) << 3, pal = (f & 8) << 1;
      for (let k = 0; k < 4; k++) {
        const v = r(tab + k);
        m.wr(hl + 4 * k + 2, ((v & 0x0f) + base) & 0xff);
        m.wr(hl + 4 * k + 3, (v & 0xf0) | pal);
      }
    }
  }
  for (let c = 0; c < 2; c++) {
    const hl = c ? 0xcc80 : 0xcc90;
    const d = m.hram[0x17 + 2 * c]!, e = m.hram[0x18 + 2 * c]!;
    if (e === 0xff) {
      fill(m, hl, 0x10, 0);
      continue;
    }
    four(hl, (d * 8) & 0xff, (e * 8) & 0xff);
    for (let k = 0; k < 4; k++) {
      m.wr(hl + 4 * k + 2, 0x78 + k);
      m.wr(hl + 4 * k + 3, 0);
    }
  }
}

/** 00:1648 — first status bit set, in the priority order of 0F:4238, plus one; 0 when none. */
export function statusIndex(m: Memory, v: number): number {
  for (let i = 0; i < 8; i++) {
    const bit = m.romAt(0x0f, 0x4238 + i);
    m.wr(0xc0ea, (((bit & 7) << 3) | 0x47) & 0xff); // 00:0504
    if ((v >> (bit & 7)) & 1) return (bit + 1) & 0xff;
  }
  return 0;
}

export { END };
