/** Legend I title screen, prologue and hero creation (bank 03, 03:7A50-7EC9; 00:0D80). */
import type { Game, Co } from "./game.js";
import type { TextEngine } from "./text.js";
import { vsync, oamDma, oamClear, bufferClear, fill, copy, copyBank, vramFill16, vramCopy, vramBegin, vramEnd, frameInput,
  waitRelease, cursorSet, cursorMove, loadSharedTiles, blitRows, vramFill, vramCopyBank, mul8, readBank } from "./sys.js";
import { checkSave, newParty } from "./save.js";

/** 00:0D5C — a window frame in a buffer at hl: (b + 2) x (c + 2) tiles, rows b + 2 wide
 *  (tiles 77 78 79 / 7A 7B / 7C 7D 7E). */
export function frame(g: Game, hl: number, b: number, c: number): void {
  const m = g.m;
  m.wr(hl++, 0x77);
  hl = fill(m, hl, b, 0x78);
  m.wr(hl++, 0x79);
  for (let k = c || 256; k; k--) {
    m.wr(hl++, 0x7a);
    hl += b;
    m.wr(hl++, 0x7b);
  }
  m.wr(hl++, 0x7c);
  hl = fill(m, hl, b, 0x7d);
  m.wr(hl++, 0x7e);
}

/** 00:0483 far call bookkeeping: the trampoline C38A (call C38B/C38C, then the bank in C38F). */
export function farcallRam(g: Game, target: number, bank: number): number {
  const m = g.m;
  m.wr(0xc38b, target & 0xff);
  m.wr(0xc38c, target >> 8);
  const prev = g.selectBank(bank);
  m.wr(0xc38f, prev);
  return prev;
}

/** 00:05B5 — class/monster sprite tiles: 4 tiles (64 bytes) of frame c for id a, from bank 01
 *  at (0x60 + high nibble of 02:7438+id) * 256 + c * 64, to de. Returns de after. */
export function* classTiles(g: Game, id: number, c: number, de: number): Co<number> {
  const prev = g.selectBank(0x02);
  const h = (0x60 + (g.m.rd(0x7438 + id) >> 4)) & 0xff;
  const l = (c << 6) & 0xff;
  const [, de2] = yield* vramCopyBank(g, 0x01, (h << 8) | l, de, 0x40);
  g.selectBank(prev);
  return de2;
}

export class Title {
  /** Registers b, c as the original leaves them (they reach FF96-FF98 through 00:08D4). */
  private b = 0;
  private c = 0;
  constructor(readonly g: Game, readonly text: TextEngine) {}

  /** 03:7D50 — the title screen; returns "new" or "continue" (00:120C) after the choice. */
  *title(): Co<"new" | "continue"> {
    const g = this.g, m = g.m;
    yield* vramFill16(g, 0x9800, 0x0800, 0x7f);
    oamClear(m);
    yield* vsync(g);
    oamDma(m);
    m.wr(0xff47, 0xe4);
    m.wr(0xc3a6, 0xe4);
    let hl = 0x7f88, de = 0x9824;
    for (let c = 10; c; c--) {
      [hl, de] = yield* vramCopy(g, hl, de, 0x0c);
      de = (de + 0x14) & 0xffff;
    }
    yield* this.uiVram(7, 0x9960, 0, 0);
    yield* loadSharedTiles(g);
    const valid = checkSave(g);
    cursorSet(m, 0x0d, valid ? 0x0a : 0x00);
    m.hram[0x60] = 0x0e; // FFE0: title music
    yield* vsync(g);
    oamDma(m);
    m.wr(0xff40, 0xc3);
    m.wr(0xff49, 0xe4);
    m.wr(0xff48, 0xd1);
    m.wr(0xc3a7, 0xd1);
    m.wr(0xff43, 0);
    m.wr(0xff42, 0);
    m.hram[0x51] = m.hram[0x52] = m.hram[0x53] = 0xfa;
    yield* waitRelease(g);
    for (;;) {
      const a = yield* frameInput(g);
      if (a & 0x20) { this.toggle(); m.hram[0x52] = (m.hram[0x52]! + 1) & 0xff; continue; }
      if (a & 0x10) { this.toggle(); m.hram[0x51] = (m.hram[0x51]! + 1) & 0xff; continue; }
      if (a & 0x04) { m.hram[0x50] = 0; m.hram[0x53] = (m.hram[0x53]! + 1) & 0xff; continue; }
      if (a & 0x02) {
        // 03:7DDF: B eleven times then Down+Start opens the sound test
        m.hram[0x50] = (m.hram[0x50]! + 1) & 0xff;
        if (m.hram[0x50] === 0x0b && (m.hram[0x0e]! & 0x88) === 0x88) return yield* this.soundTest();
      }
      if (a & 0x01) {
        if (m.hram[0x13] === 0) return "new";
        if (checkSave(g)) return "continue";
        return "new";
      }
      cursorMove(m);
    }
  }

  /** 03:7E11 — the cursor between START (0) and CONTINUE (0x0A). */
  private toggle(): void {
    const m = this.g.m;
    m.hram[0x13] = m.hram[0x13] ? 0 : 0x0a;
  }

  /** 03:7EC3 — UI string e drawn straight to VRAM at hl (width 0x20). */
  private *uiVram(e: number, hl: number, b: number, c: number): Co {
    yield* vramBegin(this.g);
    yield* this.text.ui(0x20, b, c, e, hl);
    yield* vramEnd(this.g);
  }

  /** 03:7E1E — new game: new party, clear the map, the prologue, then the hero (00:0D80 for
   *  member 0 until it is not cancelled). Then 00:1212 (the field). */
  *newGame(): Co {
    const g = this.g, m = g.m;
    newParty(g);
    oamClear(m);
    yield* vsync(g);
    oamDma(m);
    yield* vramFill16(g, 0x9800, 0x0400, 0x7f);
    yield* this.text.prologue();
    for (;;) {
      const prev = farcallRam(g, 0x01bc, 0x03);
      const cancelled = yield* this.create(0, 0);
      g.selectBank(prev);
      if (!cancelled) break;
    }
  }

  /** 00:0D80 — create party member e (C3AC) with class list d (FF8A): class select (03:7A56)
   *  and name entry (03:7B0A), B in the name entry going back. Returns true when cancelled. */
  *create(e: number, d: number): Co<boolean> {
    const g = this.g, m = g.m;
    m.wr(0xc3ac, e);
    m.hram[0x0a] = d;
    const prev = g.selectBank(0x03);
    let cancelled = false;
    for (;;) {
      if (yield* this.classSelect()) { cancelled = true; break; }
      if (!(yield* this.nameEntry())) break;
    }
    g.selectBank(prev);
    return cancelled;
  }

  // ------------------------------------------------------------ class select

  /** 03:7A56 — returns true when cancelled (B). */
  *classSelect(): Co<boolean> {
    const g = this.g, m = g.m;
    yield* this.classSetup();
    for (;;) {
      const a = yield* frameInput(g);
      this.c = m.hram[0x0d]!;
      if (a & 0x80) { const v = m.hram[0x12]! + 2; m.hram[0x12] = v >= 0x12 ? 2 : v; }
      if (a & 0x40) { const v = m.hram[0x12]!; m.hram[0x12] = v === 2 || v - 2 === 0 ? 0x10 : v - 2; }
      if (a & 0x02) return true;
      if (a & 0x01) {
        m.wr(0xc3c8, m.rd(0xc3c8 + ((m.hram[0x12]! - 2) >> 1)));
        return false;
      }
      cursorMove(m);
    }
  }

  /** 03:7AA5 */
  private *classSetup(): Co {
    const g = this.g, m = g.m;
    oamClear(m);
    bufferClear(m);
    frame(g, 0xc600, 0x12, 0x10);
    cursorSet(m, 0x02, 0x01);
    copyBank(g, 0x05, (0x7f90 + ((m.hram[0x0a]! * 8) & 0xff)) & 0xffff, 0xc3c8, 8);
    yield* vsync(g);
    m.wr(0xff40, 0x80);
    m.wr(0xff4a, 0);
    m.wr(0xff4b, 0x07);
    let de = 0x8000;
    for (let k = 0; k < 8; k++) de = yield* classTiles(g, m.rd(0xc3c8 + k), 0, de);
    yield* loadSharedTiles(g);
    yield* this.text.ui(0x14, 0x01, 0x04, 0x00, 0xc62c);
    yield* blitRows(g, 0xc600, 0x9c00, 0x14, 0x12);
    this.b = 0x14; this.c = 0;
    yield* vsync(g);
    oamDma(m);
    m.wr(0xff40, 0xe3);
  }

  // ------------------------------------------------------------ name entry

  /** 03:7B0A — returns true when B is pressed with an empty name (back to the class select). */
  *nameEntry(): Co<boolean> {
    const g = this.g, m = g.m;
    yield* this.nameSetup();
    yield* waitRelease(g);
    for (;;) {
      const a = yield* frameInput(g);
      this.c = m.hram[0x0d]!;
      if (a & 0x80) { const v = m.hram[0x12]! + 2; m.hram[0x12] = v >= 0x11 ? 6 : v; }
      if (a & 0x40) { const v = m.hram[0x12]!; m.hram[0x12] = v === 6 || v - 2 === 0 ? 0x10 : v - 2; }
      if (a & 0x20) { const v = m.hram[0x13]!; if (v >= 1) m.hram[0x13] = v - 2; }
      if (a & 0x10) { const v = m.hram[0x13]!; if (v < 0x10) m.hram[0x13] = v + 2; }
      if (a & 0x08) { yield* this.nameDone(); return false; }
      if (a & 0x02) { if (yield* this.backspace()) return true; }
      if (a & 0x01) yield* this.addChar();
      cursorMove(m);
      if (m.rd(0xc420) !== m.rd(0xc421)) {
        m.wr(0xc421, m.rd(0xc420));
        this.grid();
        yield* blitRows(g, 0xc664, 0x9ca0, 0x14, 0x0c);
        this.b = 0x14; this.c = 0;
      }
    }
  }

  private get cursor(): number { return this.g.m.rd16(0xc422); }
  private set cursor(v: number) { this.g.m.wr16(0xc422, v); }

  /** 03:7C50 */
  private *nameSetup(): Co {
    const g = this.g, m = g.m;
    m.wr(0xc420, 0);
    m.wr(0xc421, 0);
    oamClear(m);
    bufferClear(m);
    fill(m, 0xc768, 0x98, 0xff);
    m.wr(0xc780, 0);
    this.cursor = 0xc77c;
    frame(g, 0xc600, 0x12, 0x02);
    frame(g, 0xc650, 0x12, 0x0c);
    yield* this.text.ui(0x14, 0x01, 0x01, 0x01, 0xc629);
    this.grid();
    cursorSet(m, 0x06, 0x00);
    yield* vsync(g);
    m.wr(0xff40, 0x80);
    yield* classTiles(g, m.rd(0xc3c8), 0, 0x8000);
    yield* blitRows(g, 0xc600, 0x9c00, 0x14, 0x12);
    this.b = 0x14; this.c = 0;
    yield* vsync(g);
    oamDma(m);
    m.wr(0xff40, 0xe3);
  }

  /** 03:7CB6 — the character grid (03:7548, 6 rows x 28) into the buffer; C420 scrolls it. */
  private grid(): void {
    const g = this.g, m = g.m;
    let hl = 0xc666;
    for (let c = 6; c; c--) hl = fill(m, hl, 0x11, 0x7f) + 0x17;
    const off = m.rd(0xc420);
    let de = 0x7548 + off;
    let d0: number, d1: number;
    if (off >= 0x14) { d0 = 0x1c - off; d1 = (~(d0 - 0x0a)) & 0xff; }
    else { d0 = 9; d1 = 0; }
    m.hram[0x50] = d0;
    m.hram[0x51] = d1;
    hl = 0xc67a;
    for (let b = 6; b; b--) {
      // 03:7D08: one row into C768 (every other byte), then 03:7CF9 draws it
      let p = 0xc768;
      for (let k = d0; k; k--) { m.wr(p, m.rd(de++)); p += 2; }
      if (d1) {
        de = (de - 0x1c) & 0xffff;
        for (let k = d1; k; k--) { m.wr(p, m.rd(de++)); p += 2; }
      }
      m.wr(p - 1, 0);
      de = (de + (d1 ? 0x2f : 0x13)) & 0xffff;
      // 03:7CF9: 00:08D4 with b = the row counter, c = 0 (left by the clearing loop)
      this.drawSync(0x14, b, 0, 0xc768, hl);
      hl = (hl + 0x28) & 0xffff;
    }
    this.b = 0;
    this.c = 0;
  }

  /** 00:08D4 run synchronously (buffer text without delay codes cannot wait). */
  private drawSync(a: number, b: number, c: number, de: number, hl: number): void {
    const it = this.text.draw(a, b, c, de, hl);
    for (let r = it.next(); !r.done; r = it.next()) throw new Error("buffer text waited");
  }

  /** 03:7B6B — A: the character under the cursor appended (up to 4). */
  private *addChar(): Co {
    const g = this.g, m = g.m;
    if (m.rd(0xc422) === 0x80) return;
    let hl = (mul8((m.hram[0x12]! - 6) >> 1, 0x1c) + 0x7548) & 0xffff;
    let c = (m.rd(0xc420) + (m.hram[0x13]! >> 1)) & 0xff;
    if (c >= 0x1c) c = (c - 0x1c) & 0xff;
    hl += c;
    const ch = m.rd(hl);
    let de = this.cursor;
    m.wr(de, ch);
    this.cursor = de + 1;
    this.b = 0; this.c = ch;
    yield* this.nameRedraw();
  }

  /** 03:7BA6 — B: delete the last character; with none, leave the name entry (true). */
  private *backspace(): Co<boolean> {
    const m = this.g.m;
    if (m.rd(0xc422) === 0x7c) return true;
    const de = this.cursor - 1;
    m.wr(de, 0xff);
    this.cursor = de;
    yield* this.nameRedraw();
    return false;
  }

  /** 03:7BFF — redraw the name line. */
  private *nameRedraw(): Co {
    const g = this.g, m = g.m;
    fill(m, 0xc621, 4, 0x7f); // leaves b = 0
    this.drawSync(0x14, 0, this.c, 0xc77c, 0xc635);
    yield* blitRows(g, 0xc614, 0x9c20, 0x14, 0x02);
    this.b = 0x14; this.c = 0;
  }

  /** 03:7B51 — Start: store the name and create the member record (00:061B). */
  private *nameDone(): Co {
    const g = this.g, m = g.m;
    const rec = 0xcc00 | ((m.rd(0xc3ac) * 31) & 0xff);
    fill(m, rec + 1, 4, 0xff);
    copy(m, 0xc77c, rec + 1, 4);
    m.hram[0x0a] = 3;
    newMember(g);
  }

  // ------------------------------------------------------------ sound test

  /** 03:7E4A — the sound test (never returns). */
  private *soundTest(): Co<never> {
    const g = this.g, m = g.m;
    yield* waitRelease(g);
    yield* vramFill(g, 0x99a0, 0x20, 0x7f);
    fill(m, 0xc3da, 0x0a, 0);
    for (;;) {
      yield* this.uiVram(0x0a, 0x99a0, this.b, this.c);
      for (;;) {
        const a = yield* frameInput(g);
        this.c = m.hram[0x0d]!;
        if (a & 0x80) { const hl = this.stEntry(); const v = m.rd(hl); m.wr(hl, v === 0 ? this.bMax : v - 1); break; }
        if (a & 0x40) { const hl = this.stEntry(); const v = m.rd(hl); m.wr(hl, v === this.bMax ? 0 : v + 1); break; }
        if (a & 0x30) { this.toggle(); continue; }
        if (a & 0x01) { m.hram[0x60] = m.rd(0xc3da); m.hram[0x64] = m.rd(0xc3db); continue; }
        cursorMove(m);
      }
    }
  }
  private bMax = 0;
  /** 03:7EB0 — the sound test entry (C3DA music / C3DB effect) and its maximum (03:7ED3). */
  private stEntry(): number {
    const m = this.g.m;
    const i = m.hram[0x13] ? 1 : 0;
    this.bMax = m.rd(0x7ed3 + i);
    return 0xc3da + i;
  }
}

/** 00:061F — party member C3AC from monster/class C3C8 (bank 06 tables): +0 status 0, +5 id,
 *  +6/+8 HP and max HP from the HP class (06:7254), +0A race bits (00:072B by b0 bits 6-7) |
 *  FF8A, +0B..+0E stats, +0F.. abilities with their default uses (05:4647 + 8 id), FF89 = b0. */
export function newMember(g: Game): void {
  const m = g.m;
  const prev = g.selectBank(0x06);
  const rec = 0xcc00 | ((m.rd(0xc3ac) * 31) & 0xff);
  m.wr(rec, 0);
  const id = m.rd(0xc3c8);
  m.wr(rec + 5, id);
  let de = rec + 6;
  const r = (mul8(id, 9) + 0x6ae9 - 1) & 0xffff; // record b0
  const hpw = (0x7254 + ((m.rd(r + 1) * 2) & 0xff)) & 0xffff;
  [, de] = copy(m, hpw, de, 2);
  [, de] = copy(m, hpw, de, 2);
  const b0 = m.rd(r);
  m.hram[0x09] = b0;
  m.wr(de++, m.hram[0x0a]! | m.rd(0x072b + ((b0 & 0xc0) >> 6)));
  [, de] = copy(m, r + 2, de, 4);
  fill(m, de, 0x10, 0xff);
  let hl = m.rd16(r + 7);
  for (let b = ((b0 >> 3) & 7) + 1; b; b--) {
    const ab = m.rd(hl++);
    m.wr(de++, ab);
    m.wr(de++, readBank(g, 0x05, (ab * 8 + 0x4647) & 0xffff));
  }
  g.selectBank(prev);
}
