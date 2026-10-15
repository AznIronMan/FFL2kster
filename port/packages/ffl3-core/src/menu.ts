/** Legend III menu boxes (09:4FEF, reached through 00:1E49): the boxes described at C8B0 (7 bytes
 *  each: x, y, width, height, text pointer, flags; ended by x = y = 0) drawn row by row into the
 *  line buffer C880, each row copied to 9E40 + 20 r, then the whole picture to the window map 9C00
 *  (rows of 20 tiles). Box text is drawn on every other row (flags bit 0 toggles: a row of control
 *  codes only, then a row of letters; code 05 after a row keeps the next one a letter row); the
 *  control codes take no column and run through the menu side of the text engine (CD3A set). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, copyB, fill, vramCopy, wait1, pushBank, popBank, memberOffset } from "./sys.js";
import { menuTextCode } from "./misc3.js";
import { monsterNameMenu } from "./textmore.js";

// ---------------------------------------------------------------- menu text codes

/** 00:20DE — a parameter byte: 80 -> CD4C, FF -> CD36; then below 80: 5-8 -> 0-3 (others as
 *  they are); 80 and above: - 7B. Returns [value, hl after]. */
export function param(m: Memory, hl: number): [number, number] {
  let a = m.rd(hl);
  hl = (hl + 1) & 0xffff;
  if (a === 0x80) a = m.rd(0xcd4c);
  else if (a === 0xff) a = m.rd(0xcd36);
  if (a >= 0x80) return [(a - 0x7b) & 0xff, hl];
  if (a >= 0x05 && a < 0x09) a -= 5;
  return [a, hl];
}

/** 00:3114 with CD3A set (00:3168): c characters from hl into the line at de on a letter row
 *  (flags bit 0, 00:1F97), else skipped; the row counter b loses c. Returns [de, b]. */
function menuChars(m: Memory, hl: number, c: number, de: number, b: number): [number, number] {
  if (!c) return [de, b];
  if (m.rd(0xcd12) & 0x01) copyB(m, hl, de, c);
  de = (de + c) & 0xffff;
  return [de, (b - c) & 0xff];
}

/** 00:2955 — code 1F p: a member's name (p < 5: the 6 letters at C507 + the record, copied to
 *  CDA9 with 4C shown as blank; CD34 bit 1: trailing blanks dropped), an entity's (5-F: 8 at
 *  C505 + ...), or (20 and above) the class name of the name entry's record (C68D bits 3-6 ->
 *  00:29D7 -> 09:78D7 + ..., 7 letters). */
function memberText(g: Game, hl: number, de: number, b: number): [number, number, number] {
  const m = g.m;
  const [a, after] = param(m, hl);
  if (a < 0x10) {
    const off = memberOffset(m, a);
    if (a < 5) {
      copy(m, (0xc507 + off) & 0xffff, 0xcda9, 6);
      let c = 6;
      const cd34 = m.rd(0xcd34);
      if (cd34 & 0x02) {
        m.wr(0xcd34, cd34 & 0xfd);
        for (let p = 0xcdae; ; p--) {
          if (m.rd(p) !== 0xff) break;
          c = (c - 1) & 0xff;
          if (!c) break;
        }
      }
      for (let p = 0xcdae; p >= 0xcda9; p--) if (m.rd(p) === 0x4c) m.wr(p, 0xff);
      [de, b] = menuChars(m, 0xcda9, c, de, b);
    } else {
      [de, b] = menuChars(m, (0xc505 + off) & 0xffff, 8, de, b);
    }
  } else if (a < 0x20) {
    [de, b] = monsterNameMenu(g, a, de, b);
  } else {
    const k = (m.rd(0xc68d) >> 3) & 0x0f;
    const t = m.rd(0x29d7 + k);
    pushBank(g, 0x09);
    [de, b] = menuChars(m, (0x78d7 + t) & 0xffff, 7, de, b);
    popBank(g);
  }
  return [after, de, b];
}

/** 00:2FBF — code 43 x y p: the 2 x 2 sprite of member p (p >= 5: p - 4) at OAM buffer C000 +
 *  16 p, top left (y, x), columns first (CD35 with p = 0: y 0; CDEB high nibble: x pushed off
 *  screen (F7) on one side of 58); nothing when CD1C is set or the position is the same (low
 *  bits aside). From slot 5 on (CD3C not 1) the tiles 4 * slot.. and attribute 0 too. */
function placeSprite(g: Game, hl: number): number {
  const m = g.m;
  let e = m.rd(hl), d = m.rd((hl + 1) & 0xffff);
  let [a, after] = param(m, (hl + 2) & 0xffff);
  if (a === 0 && m.rd(0xcd35)) d = 0;
  if (a >= 5) a = (a - 4) & 0xff;
  const l = ((a << 4) | (a >> 4)) & 0xff;
  if (m.rd(0xcd1c)) return after;
  const f = m.rd(0xcdeb) & 0xf0;
  if (f && f !== 0x30) {
    if (f === 0x10) { if (e >= 0x58) e = 0xf7; } else if (e < 0x58) e = 0xf7;
  }
  const at = (k: number) => 0xc000 | ((l + k) & 0xff);
  if ((m.rd(at(1)) & 0xfe) === e && (m.rd(at(0)) & 0xfd) === d) return after;
  const d8 = (d + 8) & 0xff, e8 = (e + 8) & 0xff;
  if (l < 0x50 || m.rd(0xcd3c) === 1) {
    m.wr(at(0), d); m.wr(at(1), e);
    m.wr(at(4), d8); m.wr(at(5), e);
    m.wr(at(8), d); m.wr(at(9), e8);
    m.wr(at(12), d8); m.wr(at(13), e8);
    return after;
  }
  const c = (((l << 4) | (l >> 4)) * 4) & 0xff;
  const ent: [number, number][] = [[d, e], [d8, e], [d, e8], [d8, e8]];
  ent.forEach(([y, x], k) => {
    m.wr(at(4 * k), y); m.wr(at(4 * k + 1), x); m.wr(at(4 * k + 2), (c + k) & 0xff); m.wr(at(4 * k + 3), 0);
  });
  return after;
}

/** 09:519C — a control code in a box row: the text engine's handler (00:3175 table) with hl the
 *  text after the code, de the line position and b the row's count, then 09:51BA (de - 1, b + 1:
 *  no column). Returns [hl, de, b]. */
function* menuCode(g: Game, c: number, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  m.wr(0xcd13, hl & 0xff);
  m.wr(0xcd14, hl >> 8);
  let r: [number, number, number];
  switch (c) {
    case 0x00: r = [(hl - 1) & 0xffff, (de + 1) & 0xffff, (b - 1) & 0xff]; break; // 00:26C6
    case 0x05: case 0x10: case 0x4c: r = [hl, de, b]; break; // ret
    case 0x06: { // 00:26CC with CD3A: the rest of the row blank (00:3155)
      const [d2, b2] = menuChars(m, 0x3155, b, de, b);
      r = [hl, d2, b2];
      break;
    }
    case 0x1f: r = memberText(g, hl, de, b); break;
    case 0x43: // sync point 00:2FBF: the object it places and the frame work's walking figures
      // (00:21A9, every 16 frames) write the same entries; the row's CPU time decides the order (zf04)
      yield* g.point(0x002fbf);
      r = [placeSprite(g, hl), de, b];
      break;
    default: r = yield* menuTextCode(g, c, hl, de, b); // the text engine's handler (00:3175), waits included
  }
  return [r[0], (r[1] - 1) & 0xffff, (r[2] + 1) & 0xff];
}

// ---------------------------------------------------------------- rows

/** 09:5143 — a code row: borders FB, the box's text (CD10) read for its codes only (the letters
 *  were blanked by the row fill); flags bit 0 set (the next row shows the letters). */
function* codeRow(g: Game, de: number): Co {
  const m = g.m;
  m.wr(de, 0xfb);
  de = (de + 1) & 0xffff;
  let hl = m.rd16(0xcd10);
  let b = m.rd(0xcd0e);
  do {
    const a = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (a < 0x88) [hl, de, b] = yield* menuCode(g, a, hl, de, b);
    de = (de + 1) & 0xffff;
    b = (b - 1) & 0xff;
  } while (b);
  m.wr(de, 0xfb);
  m.wr(0xcd12, m.rd(0xcd12) | 0x01);
}

/** 09:5169 — a letter row: borders FB, the box's letters and codes; the text pointer CD10 moves
 *  on, flags bit 0 cleared. Returns the text pointer. */
function* letterRow(g: Game, de: number): Co<number> {
  const m = g.m;
  m.wr(de, 0xfb);
  de = (de + 1) & 0xffff;
  let hl = m.rd16(0xcd10);
  let b = m.rd(0xcd0e);
  do {
    const a = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (a >= 0x88) m.wr(de, a);
    else [hl, de, b] = yield* menuCode(g, a, hl, de, b);
    de = (de + 1) & 0xffff;
    b = (b - 1) & 0xff;
  } while (b);
  m.wr(de, 0xfb);
  m.wr(0xcd12, m.rd(0xcd12) & 0xfe);
  m.wr(0xcd10, hl & 0xff);
  m.wr(0xcd11, hl >> 8);
  return hl;
}

/** 09:51BD — fill the box width (CD0E) at hl with a; returns hl after. */
function fillWidth(m: Memory, hl: number, a: number): number {
  return fill(m, hl, m.rd(0xcd0e), a);
}

/** 09:5070 — row CD0B of the box at desc in the line buffer: the descriptor in CD0C-CD12 while
 *  drawn (and back after); the top border F7 FC.. F9 on row y - 1, the bottom F8 FC.. FA on row
 *  y + h, inside FB (blank) FB with the text; below the first box the menu background (tiles
 *  04 05 / 06 07 row by row; battle: blank). */
function* boxRow(g: Game, desc: number, buf: number): Co {
  const m = g.m;
  copy(m, desc, 0xcd0c, 7);
  const de = (buf + ((m.rd(0xcd0c) - 1) & 0xff)) & 0xffff;
  let hl = de;
  const c = (m.rd(0xcd0d) - 1) & 0xff;
  const row = m.rd(0xcd0b);
  const end = (m.rd(0xcd0f) + c + 1) & 0xff;
  if (row === c) {
    m.wr(hl, 0xf7);
    hl = fillWidth(m, (hl + 1) & 0xffff, 0xfc);
    m.wr(hl, 0xf9);
  } else if (row < c) {
    // above the box
  } else if (end === row) {
    m.wr(hl, 0xf8);
    hl = fillWidth(m, (hl + 1) & 0xffff, 0xfc);
    m.wr(hl, 0xfa);
  } else if (end < row) {
    if (desc === 0xc8ce) {
      if (m.rd(0xcd37)) fill(m, hl, 0x14, 0xff);
      else {
        const f = m.rd(0xcd12) ^ 0x01;
        m.wr(0xcd12, f);
        const a = f & 0x01 ? 0x04 : 0x06;
        for (let k = 0; k < 10; k++) { m.wr(hl, a); m.wr(hl + 1, a + 1); hl += 2; }
      }
    }
  } else {
    hl = fillWidth(m, (hl + 1) & 0xffff, 0xff);
    let empty = false;
    if (m.rd(0xcd3c) === 1) {
      const t = m.rd(0xcd10);
      const rec = t === 0x2f ? 0xc503 : t === 0x46 ? 0xc563 : t === 0x5d ? 0xc5c3 : 0;
      if (rec && m.rd(rec) === 0xff) { m.wr(hl, 0xfb); m.wr(de, 0xfb); empty = true; }
    }
    if (!empty) {
      if (!(m.rd(0xcd12) & 0x01)) yield* codeRow(g, de);
      else {
        const p = yield* letterRow(g, de);
        const a = m.rd(p);
        if (a === 0x05 || (a === 0x4c && m.rd((p + 1) & 0xffff) === 0x05)) yield* codeRow(g, de);
      }
    }
  }
  copy(m, 0xcd0c, desc, 7);
}

/** 09:5045 — rows 0-17 (battle: 0-9), every box, each row to 9E40 + 20 r (00:20FF). Each row
 *  starts at the original's time (sync point 09:504F): the rows take CPU time, and an object a
 *  box places (00:2FBF) may come before or after a frame work's walking figures. */
function* menuRows(g: Game): Co {
  const m = g.m;
  let c = m.rd(0xcd37) ? 0x0a : 0x12;
  do {
    yield* g.point(0x09504f);
    for (let hl = 0xc8ce; m.rd(hl) | m.rd(hl + 1); hl += 7) yield* boxRow(g, hl, 0xc880);
    const r = m.rd(0xcd0b);
    vramCopy(m, 0xc880, (0x9e40 + r * 20) & 0xffff, 0x14);
    m.wr(0xcd0b, r + 1);
  } while (--c);
}

/** 09:5020 — a frame, then the rows at 9E40 to the window map 9C00 (20 tiles a row; the copies
 *  00:20FF wait for hblank windows, frames of CPU time: with a trace the routine ends where the
 *  original's did, sync point 09:5044). */
function* menuShow(g: Game): Co {
  const m = g.m;
  yield* wait1(g);
  let de = 0x9c00, hl = 0x9e40;
  let b = m.rd(0xcd37) ? 0x0a : 0x12;
  do {
    // (each row shows from the lines the original wrote it, a frame work may hold a chunk up to a
    // frame: a list redrawn after an item's use lands over the frame after, zucf)
    const d = de;
    [hl, de] = g.vramPaced(() => vramCopy(m, hl, d, 0x14), d, 0x14, 154);
    de = (de + 0x0c) & 0xffff;
  } while (--b);
  yield* g.point(0x095044);
}

/** 09:4FEF — the menu: the descriptors C8B0 -> C8CE (0x1E bytes), row 0, CD3A = 1 (menu text),
 *  the arrow tiles 22 / 23 (C08A / C08E), the OAM DMA held (CD39) while the rows are drawn, then
 *  shown. */
export function* drawMenu(g: Game): Co {
  const m = g.m;
  copyB(m, 0xc8b0, 0xc8ce, 0x1e);
  m.wr(0xcd0b, 0);
  m.wr(0xcd3a, 1);
  m.wr(0xc08a, 0x22);
  m.wr(0xc08e, 0x23);
  m.wr(0xcd39, 1);
  yield* menuRows(g);
  yield* g.point(0x095014); // the rows take CPU time, the OAM DMA held meanwhile
  m.wr(0xcd39, 0);
  yield* menuShow(g);
  m.wr(0xcd3a, 0);
}

/** 00:1E49 — 09:4FEF with bank 09 (a sync point: the copies before a menu take CPU time). */
export function* menu(g: Game): Co {
  yield* g.point(0x1e49);
  pushBank(g, 0x09);
  yield* drawMenu(g);
  popBank(g);
}
