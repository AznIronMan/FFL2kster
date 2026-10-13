/** Legend I field dialogue: the text interpreter 00:0E1A-1164 (a stack of text contexts at
 *  C900: depth, then 8 bytes each: pointer, bank (0F = none), state, pending character, saved
 *  bank, member) and the message window 00:345D-3584 (window at 9C00, text from 9C21, each line
 *  a blank row above the characters). Codes: 00/04 end, 01/02 xx yy run event (C3A9, C3AA)
 *  then go on / end, 0A new line, 0D new line (two rows), 11 xx conditions and progress
 *  changes, 12 hh ll go to text hhll, 13 wait for A, 14/15 open/close the window, 16 n wait n
 *  frames, 19 n member n's name, 1A reload the objects. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { vsync, oamDma, waitRelease, joyRepeat, vramBegin, vramEnd, copy, fill, bufferClear, blitRows, sub16, mul8 } from "../sys.js";
import { frame } from "../title.js";
import { nibble, setNibble, placeObjects, clearObjects, loadPlayerTiles, objectTable, objectSprites, windowMid, windowOff } from "./load.js";

export interface DialogueCalls {
  /** 00:16E0 — run the event in C3A9/C3AA (C3AB = 1), from inside a dialogue. */
  runEvent(g: Game): Co;
}

interface Char { d: number; e: number; end: boolean }

export class Dialogue {
  constructor(readonly g: Game, readonly calls: DialogueCalls) {}

  get m(): Memory {
    return this.g.m;
  }

  // ------------------------------------------------------------ context stack

  /** 00:0E1A — address of field +o of the current context. */
  private ctx(o: number): number {
    let n = this.m.rd(0xc900);
    if (n) n--;
    return (0xc901 + o + n * 8) & 0xffff;
  }

  /** 00:0E4D (00:0156) — push a context for the text at de (no bank). */
  push(de: number): void {
    const m = this.m;
    m.wr(0xc900, m.rd(0xc900) + 1);
    const hl = this.ctx(0);
    m.wr(hl, de & 0xff);
    m.wr(hl + 1, de >> 8);
    m.wr(hl + 2, 0x0f);
    m.wr(hl + 3, 0);
  }

  /** 00:0F8E — pop a context. */
  private pop(): void {
    const m = this.m;
    const n = (m.rd(0xc900) - 1) & 0xff;
    m.wr(0xc900, n === 0xff ? 0 : n);
  }

  /** 00:0E72 — next byte of the current context (bank switched first when it has one). */
  private fetch(): number {
    const m = this.m;
    const bank = m.rd(this.ctx(2));
    if (bank !== 0x0f) this.g.selectBank(bank);
    const hl = this.ctx(0);
    const p = m.rd(hl) | (m.rd(hl + 1) << 8);
    const c = m.rd(p);
    m.wr(hl, (p + 1) & 0xff);
    m.wr(hl + 1, ((p + 1) >> 8) & 0xff);
    return c;
  }

  /** 00:0EAE — select the context's bank (when it has one). */
  private ctxBank(): void {
    const bank = this.m.rd(this.ctx(2));
    if (bank !== 0x0f) this.g.selectBank(bank);
  }

  /** 00:0EBA (00:0150) — the next character: d = tile (character & 7F) or control code | 80,
   *  e = 7F; end = the text ended (the context is popped). */
  *next(): Co<Char> {
    const m = this.m;
    const state = m.rd(this.ctx(3));
    if (state === 1) {
      const r = this.memberChar();
      if (r !== null) return r;
    } else if (state === 2) {
      // 00:1164 — the second character of a pair
      const a = m.rd(this.ctx(4));
      m.wr(this.ctx(3), 0);
      return this.ret(a);
    }
    // 00:0ED2
    const bank = m.rd(this.ctx(2));
    if (bank !== 0x0f) m.wr(this.ctx(5), this.g.selectBank(bank));
    for (;;) {
      const a = this.fetch();
      if (a === 0x00) { this.ctxBank(); return this.end(); }
      if (a === 0x13) {
        do { yield* vsync(this.g); joyRepeat(m); } while (!(m.hram[0x0e]! & 1));
        continue;
      }
      if (a < 0x03) {
        m.wr(0xc3a9, this.fetch());
        m.wr(0xc3aa, this.fetch());
        m.wr(0xc3ab, 1);
        yield* this.calls.runEvent(this.g);
        if (a === 1) continue;
        this.ctxBank();
        return this.end();
      }
      if (a === 0x04) return this.end();
      if (a === 0x11) { this.cond(); continue; }
      if (a === 0x12) {
        const d = this.fetch(), e = this.fetch();
        const de = (((d << 8) | e) * 2 + 0x7b10) & 0xffff;
        const hl = this.ctx(0);
        m.wr(hl, m.rd(de));
        m.wr(hl + 1, m.rd(de + 1));
        continue;
      }
      if (a === 0x19) {
        // 00:10EE — member name mode
        const hl = this.ctx(3);
        m.wr(hl, 1);
        m.wr(hl + 1, 0);
        let n = this.fetch();
        if (n === 0xff) n = m.rd(0xcc8c);
        m.wr(hl + 3, n);
        const r = this.memberChar();
        if (r !== null) return r;
        continue;
      }
      if (a === 0x14) { yield* this.window(0); continue; }
      if (a === 0x15) { yield* this.window(1); continue; }
      if (a === 0x16) {
        for (let n = this.fetch() || 256; n; n--) yield* vsync(this.g);
        continue;
      }
      if (a === 0x1a) { yield* this.reloadObjects(); continue; }
      if (a < 0x50) return this.ret(a | 0x80, true);
      if (a >= 0x80 && !(a >= 0xc0 && a < 0xe8)) return this.ret(a);
      const idx = a >= 0xc0 ? a - 0x40 - 0x50 : a - 0x50;
      const p = 0xc800 + idx * 2;
      const first = m.rd(p);
      m.wr(this.ctx(3), 2);
      m.wr(this.ctx(4), m.rd(p + 1));
      return this.ret(first);
    }
  }

  /** 00:0F5C/0F79 — return a character (and select the context bank, 00:0EAE). */
  private ret(a: number, control = false): Char {
    this.ctxBank();
    return { d: control ? a : a & 0x7f, e: 0x7f, end: false };
  }
  /** 00:0F6D */
  private end(): Char {
    this.pop();
    return { d: 0, e: 0x7f, end: true };
  }

  /** 00:1106 — the next letter of member [ctx+6]'s name (4 letters), or null when done (back to
   *  state 0). */
  private memberChar(): Char | null {
    const m = this.m;
    const de = (mul8(m.rd(this.ctx(6)), 0x1f) + 0xcc00) & 0xffff;
    const cnt = this.ctx(4);
    const a = (m.rd(cnt) + 1) & 0xff;
    m.wr(cnt, a);
    if (a === 5) {
      m.wr(this.ctx(3), m.rd(this.ctx(3)) - 1);
      return null;
    }
    return this.ret(m.rd(de + a));
  }

  /** 00:0F9E — code 11 xx: by the high nibble of xx (00:0FBD). */
  private cond(): void {
    const m = this.m;
    const e = this.fetch();
    const lo = e & 0x0f;
    const skip = () => { this.fetch(); this.fetch(); this.fetch(); };
    switch (e >> 4) {
      case 0: {
        // 00:0FFF — go on when the progress nibble lo is within [hi, lo] of the next byte
        const v = nibble(m, lo);
        const d = this.fetch();
        if ((d >> 4) > v || (d & 0x0f) < v) skip();
        return;
      }
      case 1: this.hpChange(lo, this.fetch()); return;
      case 2: {
        // 00:108B — go on when the item is in the bag or with a member
        const d = this.fetch();
        if (!this.hasItem(d)) skip();
        return;
      }
      case 3: {
        // 00:10C6 — progress nibble: set (lo = 0) or add (capped at 15)
        const a = this.fetch();
        const n = a >> 4, v = a & 0x0f;
        const cur = nibble(m, n);
        setNibble(m, n, lo === 0 ? v : Math.min(cur + v, 0x0f));
        return;
      }
      default:
        throw new Error(`dialogue code 11 ${e.toString(16)}: no handler (00:0FBD has 4)`);
    }
  }

  /** 00:1096 — item d in the bag (CC7C) or a member's items (CC0F, CC2E, CC4D, CC6C)? */
  private hasItem(d: number): boolean {
    const m = this.m;
    for (const base of [0xcc7c, 0xcc0f, 0xcc2e, 0xcc4d, 0xcc6c]) for (let k = 0; k < 8; k++) if (m.rd(base + 2 * k) === d) return true;
    return false;
  }

  /** 00:1020 — add the signed amount a to the HP of the members in mask e (bits 0-3), between
   *  1 and the max HP; members with status bit 0 are skipped. */
  private hpChange(e: number, a: number): void {
    const m = this.m;
    let bc = 0xcc06;
    for (let k = 0; k < 4; k++, bc += 0x1f) {
      if (!(e & (1 << k))) continue;
      if (m.rd(bc - 6) & 1) continue;
      let hl = ((a & 0x80 ? 0xff00 : 0) | a) + m.rd16(bc);
      hl &= 0xffff;
      let acc: number;
      if (hl & 0x8000 || hl === 0) { acc = hl & 0x8000 ? m.rd(bc + 1) : 0; hl = 1; }
      else acc = (hl & 0xff) | (hl >> 8);
      const max = m.rd16(bc + 2);
      const c = sub16(m, acc, max, hl);
      m.wr16(bc, c.carry ? max : hl);
    }
  }

  /** 00:3550 — code 14 (a = 0: open the window, 00:345D) / 15 (close, 00:355A + a frame). */
  private *window(a: number): Co {
    if (a === 0) return yield* this.open();
    this.close();
    yield* vsync(this.g);
    oamDma(this.m);
  }

  /** 00:24DD — code 1A: objects re-placed (event flags changed). */
  private *reloadObjects(): Co {
    const g = this.g, m = g.m;
    m.wr(0xc5d0, m.hram[0x0b]!);
    clearObjects(m);
    placeObjects(g);
    yield* loadPlayerTiles(g);
    objectTable(m);
    objectSprites(m);
    yield* vsync(g);
    oamDma(m);
    g.selectBank(m.rd(0xc5d0));
  }

  // ------------------------------------------------------------ the window

  /** 00:3584 — sprites in the window area (Y >= 0x60, not hidden) moved out of view (+0x51), the
   *  window at Y 0x50 (00:14E4); C5CA = 7. */
  hideSprites(): void {
    const m = this.m;
    for (let k = 0; k < 0x24; k++) {
      const hl = 0xc000 + 4 * k;
      const y = m.rd(hl);
      if (y < 0x60 || y === 0xb0) continue;
      m.wr(hl, (y + 0x51) & 0xff);
      m.wr(hl | 0x100, (y + 0x51) & 0xff);
    }
    windowMid(m);
    m.wr(0xc5ca, 7);
  }

  /** 00:355A — undo 00:3584 (when C5CA), window off (00:14DB). */
  close(): void {
    const m = this.m;
    if (m.rd(0xc5ca)) {
      m.wr(0xc5ca, 0);
      for (let k = 0; k < 0x24; k++) {
        const hl = 0xc000 + 4 * k;
        const y = m.rd(hl);
        if (y < 0x60 || y === 0xb0) continue;
        m.wr(hl, (y - 0x51) & 0xff);
        m.wr(hl | 0x100, (y - 0x51) & 0xff);
      }
    }
    windowOff(m);
  }

  /** 00:345D — open the message window (20 x 8 frame at 9C00). */
  *open(): Co {
    const g = this.g, m = g.m;
    this.hideSprites();
    bufferClear(m);
    frame(g, 0xc600, 0x12, 0x06);
    yield* blitRows(g, 0xc600, 0x9c00, 0x14, 0x08);
    yield* vsync(g);
    oamDma(m);
  }

  /** 00:346F — field text N (05:7B10 + 2N) in the window. */
  *text(n: number): Co {
    const g = this.g, m = g.m;
    m.wr(0xc5cf, g.selectBank(0x05));
    const de = m.rd16((n * 2 + 0x7b10) & 0xffff);
    yield* this.show(de);
    g.selectBank(m.rd(0xc5cf));
  }

  /** 00:3485 — text at de, then wait for a key (00:3CF7). */
  *showWait(de: number): Co {
    yield* this.show(de);
    yield* this.waitKey();
  }

  /** 00:348B — run the text at de into the window (from 9C21 unless it starts with code 0C). */
  *show(de: number): Co {
    const m = this.m;
    this.push(de);
    let c = yield* this.next();
    if (c.end) return;
    if (c.d !== 0x8c) {
      this.setCursor(0x9c21);
      yield* this.draw(c);
    }
    for (;;) {
      c = yield* this.next();
      if (c.end) return;
      yield* this.draw(c);
    }
  }

  private get cursor(): number { return this.m.rd(0xc5c1) | (this.m.rd(0xc5c2) << 8); }
  /** 00:34BB */
  setCursor(hl: number): void { this.m.wr(0xc5c1, hl & 0xff); this.m.wr(0xc5c2, hl >> 8); }

  /** 00:351A — draw one character: 8A new line, 8D two rows down, else the character (after
   *  the text-speed delay, none while A is held or at speed 0A) with e above it. */
  private *draw(c: Char): Co {
    const m = this.m;
    let hl = this.cursor;
    if (c.d === 0x8a) {
      hl = (hl & ~0xff) | ((hl & 0xe0) + 1);
      this.setCursor(hl);
      if ((hl & 0xff) === 0xc1) return yield* this.scrollText();
      this.setCursor((hl & ~0xff) | ((hl + 0x20) & 0xff));
      return;
    }
    if (c.d === 0x8d) return yield* this.lineFeed2(hl);
    yield* vsync(this.g);
    if (m.rd(0xccca) !== 0x0a && !(m.hram[0x0d]! & 1)) {
      for (let a = (m.rd(0xccca) + 1) & 0xff; a; a--) yield* vsync(this.g);
    }
    m.wr(hl, c.e);
    m.wr((hl + 0x20) & 0xffff, c.d);
    hl = (hl & ~0xff) | ((hl + 1) & 0xff);
    this.setCursor(hl);
    if ((hl & 0x1f) === 0x13) yield* this.lineFeed2(hl);
  }

  /** 00:34D7 — two rows down (the window scrolls twice at the bottom). */
  private *lineFeed2(hl: number): Co {
    hl = (hl & ~0xff) | ((hl & 0xe0) + 1);
    this.setCursor(hl);
    if ((hl & 0xff) === 0xa1) {
      yield* this.scrollText();
      yield* this.scrollText();
      return;
    }
    this.setCursor((hl & ~0xff) | ((hl + 0x40) & 0xff));
  }

  /** 00:34ED — the window's text rows 9C21-9CC1 up by one. */
  private *scrollText(): Co {
    const m = this.m;
    yield* vramBegin(this.g);
    let de = 0x9c21;
    for (let a = 5; a; a--) {
      copy(m, de + 0x20, de, 0x12);
      de += 0x20;
    }
    fill(m, 0x9cc1, 0x12, 0x7f);
    yield* vramEnd(this.g);
  }

  /** 00:3CF7 — a frame, then wait for all buttons released and a new press. */
  *waitKey(): Co {
    const g = this.g, m = g.m;
    yield* vsync(g);
    oamDma(m);
    yield* waitRelease(g);
    do yield* vsync(g);
    while (!joyRepeat(m));
  }
}
