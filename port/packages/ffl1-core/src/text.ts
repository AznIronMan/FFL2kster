/** Legend I engine text (00:0901-0CE1): the interpreter behind rst $08 (UI strings, table
 *  03:7080), 00:088A (battle messages, 02:7860), 00:0862 (the prologue, 05:7B10) and 00:08D4.
 *  State lives in HRAM as in the original: FF95 line width, FF96/FF97 row/column, FF98 the
 *  column a new line returns to, FF99/FF9A text pointer, FF9B/FF9C destination, FF9D/FF9E start of
 *  the current line, FFDC/FFDD next free sprite (icons), FFDE per-character delay flag.
 *  Bytes: E8-FF and 80-BF are tiles (drawn as tile - 0x80), C0-E7 / 50-7F two-character pairs
 *  from C860 / C800 (copied from 05:4E40 at boot), 40-4F tiles 70-7F, 00-3F control codes (table
 *  00:0CE2). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { vsync, vramBegin, vramEnd, copy, fill, number, waitButton, spritePositions, spriteTiles, spriteFill, px8, sub16 } from "./sys.js";

const H = (m: Memory, a: number) => m.hram[a - 0xff80]!;
const setH = (m: Memory, a: number, v: number) => { m.hram[a - 0xff80] = v & 0xff; };
const w16 = (m: Memory, a: number) => H(m, a) | (H(m, a + 1) << 8);
const setW16 = (m: Memory, a: number, v: number) => { setH(m, a, v); setH(m, a + 1, v >> 8); };

/** Sentinel thrown inside a nested print to end it (control code 00 and friends). */
const END = Symbol("end");

export class TextEngine {
  /** Control codes run (coverage aid for the sweeps). */
  readonly coverage: Record<string, number> = {};
  constructor(readonly g: Game) {}

  get m(): Memory {
    return this.g.m;
  }

  /** 00:0901 — next byte of the text. */
  private next(): number {
    const m = this.m;
    const p = w16(m, 0xff99);
    const a = m.rd(p);
    setW16(m, 0xff99, p + 1);
    return a;
  }

  /** 00:0C82 — select text bank `bank` (old bank to FF94), returns the pointer of entry e of the
   *  table at bc. */
  private entry(bank: number, bc: number, e: number): number {
    const hl = (e * 2 + bc) & 0xffff;
    setH(this.m, 0xff94, this.g.selectBank(bank));
    return this.m.rd16(hl);
  }

  /** 00:08D4 — draw the text at de to hl: FF95 = a, FF96 = b, FF97 = FF98 = c, FFDC = C000. */
  *draw(a: number, b: number, c: number, de: number, hl: number): Co {
    const m = this.m;
    setH(m, 0xff95, a);
    setH(m, 0xff96, b);
    setH(m, 0xff97, c);
    setH(m, 0xff98, c);
    setW16(m, 0xff99, de);
    setW16(m, 0xff9b, hl);
    setW16(m, 0xff9d, hl);
    setW16(m, 0xffdc, 0xc000);
    yield* this.run();
  }

  /** rst $08 (00:08BE) — UI string e of 03:7080 drawn at hl (FFDE = 0, no delay). */
  *ui(a: number, b: number, c: number, e: number, hl: number): Co {
    setH(this.m, 0xffde, 0);
    const de = this.entry(0x03, 0x7080, e);
    yield* this.draw(a, b, c, de, hl);
    this.g.selectBank(H(this.m, 0xff94));
  }

  /** 00:0862 — the prologue (05:7B10 entry F6) on the BG map 9800, one character per frame. */
  *prologue(): Co {
    const m = this.m;
    const de = this.entry(0x05, 0x7b10, 0xf6);
    setW16(m, 0xff99, de);
    setW16(m, 0xff9b, 0x9800);
    setW16(m, 0xff9d, 0x9800);
    setH(m, 0xff95, 0x20);
    setH(m, 0xffde, 0x20);
    yield* this.run();
    this.g.selectBank(H(m, 0xff94));
  }

  /** 00:088A — battle message e of 02:7860; the destination/line start come from FFD8-FFDB and
   *  are saved back there. */
  *battle(e: number): Co {
    const m = this.m;
    const de = this.entry(0x02, 0x7860, e);
    setW16(m, 0xff99, de);
    for (let k = 0; k < 4; k++) setH(m, 0xff9b + k, H(m, 0xffd8 + k));
    setH(m, 0xffde, 0x20);
    setH(m, 0xff95, 0x20);
    yield* this.run();
    for (let k = 0; k < 4; k++) setH(m, 0xffd8 + k, H(m, 0xff9b + k));
    setH(m, 0xffde, 0);
    this.g.selectBank(H(m, 0xff94));
  }

  /** The 00:0911 loop until an end code. */
  *run(): Co {
    try {
      for (;;) yield* this.step();
    } catch (e) {
      if (e !== END) throw e;
    }
  }

  /** 00:0911 — one byte. */
  private *step(): Co {
    const m = this.m;
    const c = this.next();
    if (c >= 0xe8 || (c >= 0x80 && c < 0xc0)) return yield* this.put(c);
    if (c >= 0xc0) return yield* this.pair(0xc860 + 2 * (c - 0xc0));
    if (c >= 0x50) return yield* this.pair(0xc800 + 2 * (c - 0x50));
    if (c >= 0x40) return yield* this.put(c + 0x30);
    const k = c.toString(16).padStart(2, "0");
    this.coverage[k] = (this.coverage[k] ?? 0) + 1;
    switch (c) {
      case 0x0a: return yield* this.newline();
      case 0x0d: yield* this.newline(); return yield* this.newline();
      // 3B -> 00:0A05: call 0A08 (call 0A0B, fall into 0A0B), then fall into 0A08 again: 4 new lines
      case 0x3b: for (let i = 0; i < 4; i++) yield* this.newline(); return;
      case 0x13: yield* waitButton(this.g); return;
      case 0x1c: setH(m, 0xff97, H(m, 0xff97) + 1); setW16(m, 0xff9b, w16(m, 0xff9b) + 1); return;
      case 0x1d: setH(m, 0xff97, H(m, 0xff97) - 1); setW16(m, 0xff9b, w16(m, 0xff9b) - 1); return;
      case 0x1e: setH(m, 0xff96, H(m, 0xff96) - 1); return this.rowMove(-H(m, 0xff95));
      case 0x1f: setH(m, 0xff96, H(m, 0xff96) + 1); return this.rowMove(H(m, 0xff95));
      case 0x20: return yield* this.put(this.next() + 0x80);
      case 0x21: return yield* (this.member(this.next()) !== null ? this.put(this.next() + 0x80) : this.skipBlank());
      case 0x22: return this.icon(this.next());
      case 0x23: return yield* this.name4(this.member(this.next()));
      case 0x24: return yield* this.name4(this.member(m.rd(0xc3ac)));
      case 0x25: return yield* this.memberName(this.next());
      case 0x26: { const l = m.rd(0xc3c8 + this.next()); return yield* (l !== 0xff ? this.bankName(0x4000 + 8 * l, 8) : this.blanks(8)); }
      case 0x27: return yield* this.statusOrRace(this.member(this.next()));
      case 0x28: return yield* this.itemName(this.next());
      case 0x29: return yield* this.uses(this.next(), true);
      case 0x2a: return yield* this.hp(this.member(this.next()), 6);
      case 0x2b: return yield* this.hp(this.member(this.next()), 8);
      case 0x2c: return yield* this.hpOrStatus(this.member(this.next()));
      case 0x2d: return yield* this.combatantName(0xffb0);
      case 0x2e: return yield* this.combatantName(0xffb1);
      case 0x2f: return yield* this.trimmedBankName(0x4640 + 8 * m.rd(0xffb2), 7);
      case 0x30: return yield* this.trimmedBankName(0x4640 + 8 * m.rd(0xffb3), 7);
      case 0x31: return yield* this.value999(m.rd16(0xffb4));
      case 0x32: return yield* this.digit(this.next());
      case 0x33: return yield* this.hpOrStatus(this.member(m.rd(0xc3ac)));
      case 0x34: return yield* this.hp(this.member(m.rd(0xc3ac)), 6);
      case 0x35: { const a = m.rd(0xc3e4 + this.next()); return yield* (a ? this.put(this.next() + 0x80) : this.skipBlank()); }
      case 0x36: this.bcd(this.next()); return yield* this.nested(this.copyz(0xc3c0, 7));
      case 0x37: return this.icon(m.rd(0xc3ac));
      case 0x38: return yield* this.trimmedBankName(0x4000 + 8 * m.rd(0xc3c8 + this.next()), 8);
      case 0x39: return yield* this.memberName(m.rd(0xc3ac));
      case 0x3a: this.bcd(this.next()); return yield* this.nested(this.copySkipFF(0xc3c0, 7));
      case 0x3c: return yield* this.uses(this.next(), false);
      default: throw END; // 08FD: end of the text
    }
  }

  // ------------------------------------------------------------ drawing

  /** 00:094C — draw tile a - 0x80 at the destination, advance; with FFDE a frame before and the
   *  delay after (00:0CA7, 00:0CCB). */
  *put(a: number): Co {
    const m = this.m;
    if (H(m, 0xffde)) yield* vsync(this.g);
    setH(m, 0xff97, H(m, 0xff97) + 1);
    const hl = w16(m, 0xff9b);
    m.wr(hl, (a - 0x80) & 0xff);
    setW16(m, 0xff9b, hl + 1);
    if (H(m, 0xffde)) yield* this.delay();
  }

  private *pair(hl: number): Co {
    const m = this.m;
    yield* this.put(m.rd(hl));
    yield* this.put(m.rd(hl + 1));
  }

  /** 00:0CCB — text delay: none while A is held; else CCCA*2+1 frames, held while B is held. */
  *delay(): Co {
    const m = this.m;
    if (m.hram[0x0d]! & 1) return;
    let b = (m.rd(0xccca) * 2 + 1) & 0xff;
    do {
      yield* vsync(this.g);
      const a = m.hram[0x0d]!;
      if (a & 1) return;
      if (a & 2) b = (b + 1) & 0xff;
      b = (b - 1) & 0xff;
    } while (b);
  }

  /** 00:0A0B — new line (with FFDE at the bottom of the message window, 9A01+: scroll it, 00:0CB0). */
  *newline(): Co {
    const m = this.m;
    let hl = w16(m, 0xff9d);
    const fde = H(m, 0xffde);
    if (fde) {
      const c = sub16(m, fde, hl, 0x9a01);
      if (!c.carry) {
        setW16(m, 0xff9b, hl);
        yield* vramBegin(this.g);
        copy(m, 0x9940, 0x9920, 0xe0);
        fill(m, 0x9a01, 0x12, 0x7f);
        yield* vramEnd(this.g);
        yield* this.delay();
        return;
      }
    }
    hl = (hl + H(m, 0xff95)) & 0xffff;
    setW16(m, 0xff9b, hl);
    setW16(m, 0xff9d, hl);
    setH(m, 0xff96, H(m, 0xff96) + 1);
    setH(m, 0xff97, H(m, 0xff98));
  }

  /** 00:09F2 — move the destination and line start by bc (one row up/down). */
  private rowMove(d: number): void {
    const m = this.m;
    const bc = d & 0xff ? (d < 0 ? 0xff00 | (d & 0xff) : d) : 0;
    setW16(m, 0xff9b, w16(m, 0xff9b) + bc);
    setW16(m, 0xff9d, w16(m, 0xff9d) + bc);
  }

  /** 00:09A6 — a 2x2 sprite icon (tiles 4n..4n+3, attributes 0) at the cursor, 2 columns on. */
  private icon(n: number): void {
    const m = this.m;
    const a = (n * 4) & 0xff;
    const d = H(m, 0xff96), e = H(m, 0xff97);
    setH(m, 0xff97, e + 2);
    const hl = w16(m, 0xffdc);
    spritePositions(m, hl, px8(d), px8(e));
    spriteTiles(m, hl + 2, a);
    spriteFill(m, hl + 3, 0);
    setW16(m, 0xffdc, hl + 16);
    setW16(m, 0xff9b, w16(m, 0xff9b) + 2);
  }

  // ------------------------------------------------------------ nested strings (C3B0)

  /** 00:0BF8 — print the string at C3B0 (ends with 00) through the interpreter. */
  private *nested(_: void): Co {
    const m = this.m;
    const save = w16(m, 0xff99);
    setW16(m, 0xff99, 0xc3b0);
    yield* this.run();
    setW16(m, 0xff99, save);
  }

  /** 00:0BEE — b blanks. */
  private *blanks(b: number): Co {
    const hl = fill(this.m, 0xc3b0, b, 0xff);
    this.m.wr(hl, 0);
    yield* this.nested();
  }
  /** 00:0973 — skip a byte, one blank. */
  private *skipBlank(): Co {
    this.next();
    yield* this.blanks(1);
  }
  /** 00:008F + 0 — copy b bytes to C3B0 and terminate. */
  private copyz(hl: number, b: number): void {
    const [, de] = copy(this.m, hl, 0xc3b0, b);
    this.m.wr(de, 0);
  }
  /** 00:0A3C — copy b bytes skipping FF. */
  private copySkipFF(hl: number, b: number): void {
    const m = this.m;
    let de = 0xc3b0;
    for (let k = 0; k < b; k++) {
      const a = m.rd(hl++);
      if (a !== 0xff) m.wr(de++, a);
    }
    m.wr(de, 0);
  }
  /** 00:0C2F — copy b bytes, terminated after the last non-FF byte. */
  private copyTrim(hl: number, b: number): void {
    const m = this.m;
    let de = 0xc3b0, c = de & 0xff;
    for (let k = 0; k < b; k++) {
      const a = m.rd(hl++);
      m.wr(de++, a);
      if (a !== 0xff) c = de & 0xff;
    }
    m.wr(0xc300 | c, 0);
  }

  /** 00:0554 — party member record (CC00 + 31n) or null when its first byte is FF (00:0C4D). */
  member(n: number): number | null {
    const hl = 0xcc00 | ((n * 31) & 0xff);
    return this.m.rd(hl) === 0xff ? null : hl;
  }

  private *name4(hl: number | null): Co {
    if (hl === null) return yield* this.blanks(4);
    this.copyz(hl + 1, 4);
    yield* this.nested();
  }
  private *memberName(n: number): Co {
    const hl = 0xcc00 | ((n * 31) & 0xff);
    this.copyTrim(hl + 1, 4);
    yield* this.nested();
  }
  /** 00:0C16 — c bytes from bank 05 at hl. */
  private *bankName(hl: number, c: number): Co {
    const prev = this.g.selectBank(0x05);
    this.copyz(hl, c);
    this.g.selectBank(prev);
    yield* this.nested();
  }
  /** 00:0C24 — b bytes from bank 05, trimmed. */
  private *trimmedBankName(hl: number, b: number): Co {
    const prev = this.g.selectBank(0x05);
    this.copyTrim(hl & 0xffff, b);
    this.g.selectBank(prev);
    yield* this.nested();
  }
  /** 00:0C54 — status bit index of the record's status byte: 7FC0 + 8k, or null if none. */
  private status(hl: number): number | null {
    let c = this.m.rd(hl);
    if (!c) return null;
    let a = 8;
    for (;;) {
      const cy = c & 1;
      c = (c >> 1) | (cy << 7);
      a--;
      if (cy) break;
    }
    return (0x7fc0 + a * 8) & 0xffff;
  }
  private *statusOrRace(hl: number | null): Co {
    if (hl === null) return yield* this.blanks(8);
    const s = this.status(hl);
    if (s !== null) return yield* this.bankName(s, 8);
    return yield* this.bankName(0x4000 + 8 * this.m.rd(hl + 5), 8);
  }
  private *itemName(i: number): Co {
    const m = this.m;
    if (m.rd(0xc3da + i) === 0xff) return yield* this.blanks(7);
    return yield* this.bankName(0x4640 + 8 * m.rd(0xc3d0 + i), 7);
  }
  /** 0x29 / 0x3C — uses (FE = unlimited, from 00:00DB); 0x29 blanks an empty slot. */
  private *uses(i: number, check: boolean): Co {
    const l = this.m.rd(0xc3da + i);
    if (check && l === 0xff) return yield* this.blanks(2);
    if (check && l === 0xfe) return yield* this.bankName(0x00db, 2);
    number(this.m, Math.min(l, 0x63));
    return yield* this.bankName(0xc3c4, 2);
  }
  /** 0x2A/0x2B/0x34 — the word at record + o, at most 999, 4 characters from C3C3. */
  private *hp(hl: number | null, o: number): Co {
    if (hl === null) return yield* this.blanks(3);
    this.cap999(this.m.rd16(hl + o));
    this.copyz(0xc3c3, 4);
    yield* this.nested();
  }
  /** 0x2C/0x33 — status name (4) or max HP (4 from C3C2). */
  private *hpOrStatus(hl: number | null): Co {
    if (hl === null) return yield* this.blanks(4);
    const s = this.status(hl);
    if (s !== null) return yield* this.bankName(s, 4);
    this.cap999(this.m.rd16(hl + 8));
    this.copyz(0xc3c2, 4);
    yield* this.nested();
  }
  /** 00:0B1D — number (capped at 999; the compare leaves a in FF88). */
  private cap999(v: number): void {
    const c = sub16(this.m, v & 0xff, v, 0x3e7);
    number(this.m, !c.carry && !c.zero ? 0x3e7 : v);
  }
  private *value999(v: number): Co {
    this.cap999(v);
    this.copySkipFF(0xc3c3, 3);
    yield* this.nested();
  }
  /** 0x2D/0x2E — name of combatant [hl]: a party member (< 4) or the monster in slot n. */
  private *combatantName(p: number): Co {
    const m = this.m;
    const a = m.rd(p);
    if (a < 4) return yield* this.memberName(a);
    const id = m.rd(0xd01f + a * 32);
    return yield* this.trimmedBankName(0x4000 + 8 * id, 8);
  }
  /** 0x32 — one digit of C3AD + n (FF: a blank). */
  private *digit(n: number): Co {
    const m = this.m;
    const l = m.rd(0xc3ad + n);
    if (l === 0xff) return yield* this.blanks(1);
    number(m, l);
    m.wr(0xc3b0, m.rd(0xc3c5));
    m.wr(0xc3b1, 0);
    yield* this.nested();
  }
  /** 00:0A4E — the 3-byte BCD value at C400 + 3n as six digit tiles C3C0-C3C5. */
  private bcd(n: number): void {
    const m = this.m;
    let hl = 0xc400 + n * 3, de = 0xc3c0;
    for (let k = 0; k < 3; k++) {
      const v = m.rd(hl++);
      m.wr(de++, v >> 4);
      m.wr(de++, v & 15);
    }
    // 00:0816 digit tiles
    let b = 6, c = 0, p = 0xc3c0;
    while (b) {
      let a = m.rd(p);
      if (a === 0 && c === 0) { b--; if (b === 0) a = 0x81; b++; a = (a - 1) & 0xff; }
      else { c++; a = (a + 0x80) & 0xff; }
      m.wr(p++, a);
      b--;
    }
  }
}
