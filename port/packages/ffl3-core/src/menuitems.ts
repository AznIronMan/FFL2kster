/** Legend III field menu items 0 and 1 (09:4350 / 09:435E, from the item table 09:4034) and what
 *  they reach: the member choice 09:413F / 09:4160 / 09:4165 (shared with items 3 and 4 and the
 *  item targets), the scrolling list 09:484B (items: hl = 09:6D00, CD1B = 0; spells of the member
 *  CD36: hl = 09:6E99, CD1B = 1; 8 lines of 24 shown in the box (1,1) 18 x 16, the text pointer
 *  CDE6 at the 4C before the top line, the scroll offset CD1A, the cursor row CD15 (C080 / C081),
 *  a picked entry CD17 / CD18 (the second cursor C084 / C085), the trash column C081 = 80), the
 *  list scrolls 00:3470 / 00:34E0, the swap / discard / use of an entry (09:4B34, 09:4CC4) and the
 *  messages 01:7E08 / 01:7E0D. All of it runs with bank 09 selected (its tables and texts are read
 *  from the current bank). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, far0, far0Sync, farcall, farSync, pushBank, popBank, vramCopy, soundBuzz, soundOk, wait1,
  memberOffset } from "./sys.js";
import { NotPorted } from "./irq.js";
import { oamClear } from "./names.js";
import { menuInput } from "./title.js";
import { memberLimit, loadSpriteTiles } from "./sprites.js";
import { drawMenu } from "./menu.js";
import { entityOffset } from "./bstats.js";
import { printText } from "./text.js";
import { itemLoad } from "./bitems.js";
import { statusIndex, recordBit7, listCursorsOff, cursorsHide, statusWord, statusWordSet, statusWords, cursorPlace, menuRedraw } from "./fieldmenu.js";
import { useEffect, fieldSpellCast, specialItemUse, itemsLeft } from "./fieldfx.js";

// ---------------------------------------------------------------- small helpers

/** 00:1FCD — the record offset of entity a (the table doubles a in 8 bits). */
const offsetOf = (m: Memory, a: number): number => memberOffset(m, a & 0x7f);

/** swap a (the nibbles exchanged). */
const swap = (a: number): number => ((a << 4) | (a >> 4)) & 0xff;

/** 00:1EF1 — the bit 1 << a (0 for a >= 8). */
const bitOf = (a: number): number => (a < 8 ? (1 << a) & 0xff : 0);

/** 0F:7D97 — the OAM DMA held (CD39 = 1), then the objects hidden (00:20CF). */
export function oamHold(g: Game): void {
  g.m.wr(0xcd39, 1);
  oamClear(g);
}

/** 09:4951 — the list cursors on: C088 = 50, C08C = 58. */
function listCursorsOn(m: Memory): void {
  m.wr(0xc088, 0x50);
  m.wr(0xc08c, 0x58);
}

/** 0F:7D9F — the objects of the OAM buffer (40, every 4 bytes) whose y is in [d, e) get y = 4. */
function oamHideRows(m: Memory, d: number, e: number): void {
  for (let l = 0; l < 0xa0; l += 4) {
    const a = m.rd(0xc000 + l);
    if (a >= d && a < e) m.wr(0xc000 + l, 4);
  }
}

/** 0F:7A2E — wait (a frame at a time, 00:358B) for a new press of a button of c (FF8B; another
 *  one buzzes, 00:1E83), then the cursor sound (00:1E7C). Returns a = the press & c. 0F:7A2C: c =
 *  03 (A or B). */
function* waitKeys(g: Game, c: number): Co<number> {
  const m = g.m;
  for (;;) {
    yield* wait1(g);
    const a = m.hram[0x0b]!;
    if (!a) continue;
    if (a & c) { soundOk(m); return a & c; }
    yield* soundBuzz(g);
  }
}

/** 0F:7A2C — wait for A or B (0F:7A2E with c = 03); returns the press & 03. */
export function* waitAB(g: Game): Co<number> {
  return yield* waitKeys(g, 0x03);
}

/** 01:7E08 (ok = true: the cursor sound 00:1E7C) / 01:7E0D (the buzzer 00:1E83) — a message: CD45
 *  = 1, C080 / C088 / C08C kept, the objects in rows 48-67 moved to y 4 (0F:7D9F), the text hl
 *  (bank 09) in the box (1,8) 18 x 2, mode 24, A or B (0F:7A2C), CD45 = 0, CD39 = 1, C08C / C088
 *  / C080 back. Bank 01 selected by the caller's farcall. */
export function* menuMessage(g: Game, hl: number, ok: boolean): Co {
  const m = g.m;
  if (ok) soundOk(m);
  else yield* soundBuzz(g);
  m.wr(0xcd45, 1);
  const c080 = m.rd(0xc080), c088 = m.rd(0xc088), c08c = m.rd(0xc08c);
  farSync(g, 0x0f, () => oamHideRows(m, 0x48, 0x68));
  yield* far0(g, 0x09, () => printText(g, 0x24, hl, 0x0801, 0x0212));
  yield* farcall(g, 0x0f, () => waitAB(g));
  m.wr(0xcd45, 0);
  m.wr(0xcd39, 1);
  m.wr(0xc08c, c08c);
  m.wr(0xc088, c088);
  m.wr(0xc080, c080);
}

// ---------------------------------------------------------------- the status words CDEC and the redraw

/** 09:425D — CD39 = 1, the menu redrawn (09:427E). */
function* redraw(g: Game): Co {
  g.m.wr(0xcd39, 1);
  yield* menuRedraw(g);
}

// ---------------------------------------------------------------- the member choice (09:413F)

/** 09:4252 — C080 = 20 + (swap a) + (swap a rotated right) (the member row a: 20 + 18 a). */
function memberRow(m: Memory, a: number): void {
  const s = swap(a);
  const r = ((s >> 1) | (s << 7)) & 0xff;
  m.wr(0xc080, (r + s + 0x20) & 0xff);
}

/** 09:41D7 — Up in the member choice (CE28 bit 5 clear: the buzzer): CD15 & 7F - 1 (CD15 1 with
 *  CD35 clear: 0); from 0 (or 1 with CD35 set) to the last member: CD15 = 4, with a member limit
 *  (0B:6D12 nz) C080 = 88, else CD15 = 3 (09:4252); redrawn (09:425D). */
function* memberUp(g: Game): Co {
  const m = g.m;
  if (!(m.rd(0xce28) & 0x20)) { yield* soundBuzz(g); return; }
  let a = m.rd(0xcd15) & 0x7f;
  let wrap = false;
  if (!a) wrap = true;
  else {
    a = (a - 1) & 0xff;
    if (!a) {
      a = m.rd(0xcd35);
      if (a) wrap = true;
    }
  }
  if (wrap) {
    const lim = farSync(g, 0x0b, () => memberLimit(m));
    a = 0x04;
    m.wr(0xcd15, a);
    if (lim) {
      m.wr(0xc080, 0x88);
      yield* redraw(g);
      return;
    }
    a = 0x03;
  }
  m.wr(0xcd15, a);
  memberRow(m, a);
  yield* redraw(g);
}

/** 09:4201 — Down in the member choice (CE28 bit 5 clear: the buzzer): CD15 & 7F + 1 (below 4:
 *  09:4252); to 4 with a member limit (0B:6D12 nz): C080 = 88; from 4 (or to 4 without the limit):
 *  CD15 = CD35 (09:4252); redrawn (09:425D). */
function* memberDown(g: Game): Co {
  const m = g.m;
  if (!(m.rd(0xce28) & 0x20)) { yield* soundBuzz(g); return; }
  let a = m.rd(0xcd15) & 0x7f;
  if (a !== 0x04) {
    a = (a + 1) & 0xff;
    m.wr(0xcd15, a);
    if (a < 0x04) {
      memberRow(m, a);
      yield* redraw(g);
      return;
    }
    if (farSync(g, 0x0b, () => memberLimit(m))) {
      m.wr(0xc080, 0x88);
      yield* redraw(g);
      return;
    }
  }
  a = m.rd(0xcd35);
  m.wr(0xcd15, a);
  memberRow(m, a);
  yield* redraw(g);
}

/** 09:422A — Left / Right in the member choice (CE28 & 60 not 60: the buzzer): CD15 ^= 80 (bit 7:
 *  all the members); back to one: C080 = 20 + 18 CD15 (09:4252's sum), 4 and above 88. */
function* memberAll(g: Game): Co {
  const m = g.m;
  if ((m.rd(0xce28) & 0x60) !== 0x60) { yield* soundBuzz(g); return; }
  const a = m.rd(0xcd15) ^ 0x80;
  m.wr(0xcd15, a);
  if (a & 0x80) return;
  if (a < 0x04) memberRow(m, a);
  else m.wr(0xc080, 0x88);
}

/** 09:4165 — choose a member by CE28 (bit 5: one, bit 6: all; neither: CD36 = FF, a = FF at
 *  once): CD15 / C080 / C081 kept at CD1D-CD1F, CD16 kept and 0 meanwhile, the menu redrawn
 *  (09:425D); CD36 not FE: CD36 = FE, the cursor (20, 10), CD15 = 0 (bit 5) or 80 (bit 6 only);
 *  then the menu input (00:1E51): A CD36 = CD15 (bit 7: 80), B CD36 = FF; CD16 back; returns a =
 *  CD36. */
export function* selectMember(g: Game): Co<number> {
  const m = g.m;
  m.wr(0xcd1d, m.rd(0xcd15));
  m.wr(0xcd1e, m.rd(0xc080));
  m.wr(0xcd1f, m.rd(0xc081));
  if (!(m.rd(0xce28) & 0x60)) {
    m.wr(0xcd36, 0xff);
    return 0xff;
  }
  const column = m.rd(0xcd16);
  m.wr(0xcd16, 0x00);
  yield* redraw(g);
  if (m.rd(0xcd36) !== 0xfe) {
    m.wr(0xcd36, 0xfe);
    m.wr(0xc080, 0x20);
    m.wr(0xc081, 0x10);
    let a = m.rd(0xce28) & 0x60;
    if (a & 0x20) a = 0;
    m.wr(0xcd15, (a * 2) & 0xff);
  }
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: // 09:41BD
      case 1: { // 09:41C8
        let a = 0xff;
        if (i === 0) {
          a = m.rd(0xcd15);
          if (a & 0x80) a = 0x80;
        }
        m.wr(0xcd36, a);
        m.wr(0xcd16, column);
        return true;
      }
      case 4: case 5: yield* memberAll(g); return false;
      case 6: yield* memberUp(g); return false;
      case 7: yield* memberDown(g); return false;
      default: yield* soundBuzz(g); return false; // 2, 3: 00:1E83
    }
  });
  return m.rd(0xcd36);
}

/** 09:4160 — CE28 = 20 (one member), the choice (09:4165). */
export function* chooseTarget(g: Game): Co<number> {
  g.m.wr(0xce28, 0x20);
  return yield* selectMember(g);
}

/** 09:413F — choose a member: the objects hidden (0F:7D97), CD15 = CD36, the cursor C080 = 20 +
 *  18 CD36 (80 -> 88), C081 = 10, CD36 = FE, then 09:4160. Returns a = the member (CD36), FF when
 *  cancelled. */
export function* chooseMember(g: Game): Co<number> {
  const m = g.m;
  farSync(g, 0x0f, () => oamHold(g));
  let a = m.rd(0xcd36);
  m.wr(0xcd15, a);
  const s = swap(a);
  a = ((s >> 1) + s + 0x20) & 0xff;
  if (a === 0x80) a = 0x88;
  m.wr(0xc080, a);
  m.wr(0xc081, 0x10);
  m.wr(0xcd36, 0xfe);
  return yield* chooseTarget(g);
}

// ---------------------------------------------------------------- the list scrolls (bank 0)

/** 00:1EBB — hl moved on past b 4C bytes (bank 09 pushed): hl at the b-th 4C after it. */
function nextLines(g: Game, hl: number, b: number): number {
  const m = g.m;
  pushBank(g, 0x09);
  b = b || 256;
  do {
    do hl = (hl + 1) & 0xffff; while (m.rd(hl) !== 0x4c);
  } while (--b);
  popBank(g);
  return hl;
}

/** 00:1EC9 — hl moved back to the b-th 4C before it (bank 09 pushed). */
function prevLines(g: Game, hl: number, b: number): number {
  const m = g.m;
  pushBank(g, 0x09);
  b = b || 256;
  do {
    do hl = (hl - 1) & 0xffff; while (m.rd(hl) !== 0x4c);
  } while (--b);
  popBank(g);
  return hl;
}

/** 00:34B2 — CD38 = 1; b rows of the window map moved up 2 rows (from 9C01 + 20 (swap a) + 40 to
 *  9C01 + 20 (swap a), 0x14 tiles a row, 00:20FF). */
function rowsUp(g: Game, a: number, b: number): void {
  const m = g.m;
  m.wr(0xcd38, 1);
  let de = (0x9c01 + 2 * swap(a)) & 0xffff;
  let hl = (de + 0x40) & 0xffff;
  b = b || 256;
  do {
    [hl, de] = far0Sync(g, 0, () => vramCopy(m, hl, de, 0x14));
    hl = (hl + 0x0c) & 0xffff;
    de = (de + 0x0c) & 0xffff;
  } while (--b);
}

/** 00:3505 — CD38 = 1; b rows of the window map moved down 2 rows, the last first (from 9C01 +
 *  20 (swap a) + 40 (b - 1) to 40 below it, 0x14 tiles a row, 00:20FF). */
function rowsDown(g: Game, a: number, b: number): void {
  const m = g.m;
  m.wr(0xcd38, 1);
  let hl = (0x9c01 + 2 * swap(a)) & 0xffff;
  const d2 = (((b - 1) & 0xff) * 2) & 0xff;
  hl = (hl + (((d2 >> 4) << 8) | ((d2 << 4) & 0xf0))) & 0xffff;
  let de = (hl + 0x40) & 0xffff;
  b = b || 256;
  do {
    [hl, de] = far0Sync(g, 0, () => vramCopy(m, hl, de, 0x14));
    hl = (hl - 0x34) & 0xffff;
    de = (de - 0x34) & 0xffff;
  } while (--b);
}

/** 00:349A — one list line drawn: hl (at the 4C before the line; bank 09 pushed) + 1, a 05 there
 *  skipped and the mode 94, else 84; the text (bank 09, 00:3211) at (1, d), 18 x 2. */
function* listLine(g: Game, hl: number, d: number): Co {
  const m = g.m;
  let e = 0x84;
  pushBank(g, 0x09);
  hl = (hl + 1) & 0xffff;
  if (m.rd(hl) === 0x05) {
    e |= 0x10;
    hl = (hl + 1) & 0xffff;
  }
  popBank(g);
  const at = hl;
  yield* far0(g, 0x09, () => printText(g, e, at, ((d & 0xff) << 8) | 0x01, 0x0212));
}

/** 00:3470 — the list scrolled down a line (CD19 bit 1 clear: the buzzer only): b rows from row
 *  a + 2 up (00:34B2), the text pointer CDE6 a line on (00:1EBB), the line b / 2 lines below it
 *  drawn at row a + b (00:349A). */
export function* listScrollDown(g: Game, a: number, b: number): Co {
  const m = g.m;
  const c = a;
  if (!(m.rd(0xcd19) & 0x02)) { yield* soundBuzz(g); return; }
  rowsUp(g, c, b);
  let hl = nextLines(g, m.rd16(0xcde6), 1);
  m.wr(0xcde6, hl & 0xff);
  m.wr(0xcde7, hl >> 8);
  const d = (b + c) & 0xff;
  hl = nextLines(g, hl, b >> 1);
  yield* listLine(g, hl, d);
}

/** 00:34E0 — the list scrolled up a line (CD19 bit 0 clear: the buzzer only): b rows from row a
 *  down (00:3505), the text pointer CDE6 a line back (00:1EC9), that line drawn at row a
 *  (00:349A). */
export function* listScrollUp(g: Game, a: number, b: number): Co {
  const m = g.m;
  const c = a;
  if (!(m.rd(0xcd19) & 0x01)) { yield* soundBuzz(g); return; }
  rowsDown(g, c, b);
  const hl = prevLines(g, m.rd16(0xcde6), 1);
  m.wr(0xcde6, hl & 0xff);
  m.wr(0xcde7, hl >> 8);
  yield* listLine(g, hl, c);
}

// ---------------------------------------------------------------- the list (09:484B)

/** 09:479F — the list set up: CD1B = a, CDE6/CDE7 = hl, CD15 = CD1A = CD17 = 0, CD19 = 3, the list
 *  cursors (09:4951), the cursor (20, 18), the box 09:47D9 (9 bytes) -> C8B0 with the text CDE6,
 *  drawn (09:4FEF). */
function* listOpen(g: Game, hl: number, a: number): Co {
  const m = g.m;
  m.wr(0xcd1b, a);
  m.wr(0xcde6, hl & 0xff);
  m.wr(0xcde7, hl >> 8);
  m.wr(0xcd15, 0);
  m.wr(0xcd1a, 0);
  m.wr(0xcd17, 0);
  m.wr(0xcd19, 0x03);
  listCursorsOn(m);
  m.wr(0xc080, 0x20);
  m.wr(0xc081, 0x18);
  copy(m, 0x47d9, 0xc8b0, 9);
  copy(m, 0xcde6, 0xc8b4, 2);
  yield* drawMenu(g);
}

/** 09:4BA7 / 09:4D11 — the box text C8B4 = CDE6, the list drawn again (09:4FEF). */
function* listRedraw(g: Game): Co {
  const m = g.m;
  copy(m, 0xcde6, 0xc8b4, 2);
  yield* drawMenu(g);
}

/** 09:47E2 — the list up a line (00:34E0, a = 1, b = 0E), CD1A - 1; a picked entry (CD17, not in
 *  the trash column C085 = 80): CD18 + 1 and its cursor C084: 0 -> 24, 1-7 + 10, else 0. */
function* listUp(g: Game): Co {
  const m = g.m;
  yield* listScrollUp(g, 0x01, 0x0e);
  m.wr(0xcd1a, m.rd(0xcd1a) - 1);
  if (!m.rd(0xcd17)) return;
  if (m.rd(0xc085) === 0x80) return;
  const a = (m.rd(0xcd18) + 1) & 0xff;
  m.wr(0xcd18, a);
  if (!a) m.wr(0xc084, 0x24);
  else if (a < 0x08) m.wr(0xc084, m.rd(0xc084) + 0x10);
  else m.wr(0xc084, 0x00);
}

/** 09:4812 — the list down a line (00:3470, a = 1, b = 0E), CD1A + 1; a picked entry (CD17, not
 *  in the trash column C085 = 80): CD18 - 1 and its cursor C084: 7 -> 94, below 7 - 10, else 0. */
function* listDown(g: Game): Co {
  const m = g.m;
  yield* listScrollDown(g, 0x01, 0x0e);
  m.wr(0xcd1a, m.rd(0xcd1a) + 1);
  if (!m.rd(0xcd17)) return;
  if (m.rd(0xc085) === 0x80) return;
  const a = (m.rd(0xcd18) - 1) & 0xff;
  m.wr(0xcd18, a);
  if (a === 0x07) m.wr(0xc084, 0x94);
  else if (a < 0x07) m.wr(0xc084, m.rd(0xc084) - 0x10);
  else m.wr(0xc084, 0x00);
}

/** 09:4892 — Left / Right: C081 ^= 98 (18 <-> 80, the trash column); to 80: C080 kept at CDD4 and
 *  C080 = 50; back: C080 = CDD4. */
function listColumn(m: Memory): void {
  const a = m.rd(0xc081) ^ 0x98;
  m.wr(0xc081, a);
  if (a === 0x80) {
    m.wr(0xcdd4, m.rd(0xc080));
    m.wr(0xc080, 0x50);
  } else m.wr(0xc080, m.rd(0xcdd4));
}

/** 09:48A9 — Up: in the trash column 09:4892; CD15 above 0: CD15 - 1, C080 - 10; at 0: CD19 bit
 *  0 set: the list up (09:47E2), else the buzzer. */
function* listKeyUp(g: Game): Co {
  const m = g.m;
  if (m.rd(0xc081) === 0x80) { listColumn(m); return; }
  const a = m.rd(0xcd15);
  if (a) {
    m.wr(0xcd15, a - 1);
    m.wr(0xc080, m.rd(0xc080) - 0x10);
    return;
  }
  if (!(m.rd(0xcd19) & 0x01)) { yield* soundBuzz(g); return; }
  yield* listUp(g);
}

/** 09:48CA — Down: in the trash column 09:4892; CD15 below 7: CD15 + 1, C080 + 10; at 7: CD19
 *  bit 1 set: the list down (09:4812), else the buzzer. */
function* listKeyDown(g: Game): Co {
  const m = g.m;
  if (m.rd(0xc081) === 0x80) { listColumn(m); return; }
  const a = m.rd(0xcd15);
  if (a !== 0x07) {
    m.wr(0xcd15, a + 1);
    m.wr(0xc080, m.rd(0xc080) + 0x10);
    return;
  }
  if (!(m.rd(0xcd19) & 0x02)) { yield* soundBuzz(g); return; }
  yield* listDown(g);
}

/** The picked entry b (C085 = 80: FF, else CD1A + CD18) and the cursor's c (C081 = 80: FF, else
 *  CD1A + CD15) — 09:4B34-4B57 / 09:4CC4-4CE7. */
function listPair(m: Memory): [number, number] {
  let b = 0xff;
  if (m.rd(0xc085) !== 0x80) b = (m.rd(0xcd1a) + m.rd(0xcd18)) & 0xff;
  let c = 0xff;
  if (m.rd(0xc081) !== 0x80) c = (m.rd(0xcd1a) + m.rd(0xcd15)) & 0xff;
  return [b, c];
}

/** 09:4841 — the second A on a picked entry: CD1B 0 (items) 09:4B34, else (spells) 09:4CC4. */
function* listChosen(g: Game): Co {
  if (!g.m.rd(0xcd1b)) yield* itemChosen(g);
  else yield* spellChosen(g);
}

/** 09:484B — the list (09:479F: hl the text, a = CD1B), then the menu input (00:1E51): A 09:4860
 *  (a picked entry CD17: unpicked, C084 = 0, 09:4841; else picked: CD17 = 1, C084/C085 = C080 + 4
 *  / C081, CD18 = CD15), B 09:4884 (a picked entry unpicked, C084 = 0; else the list left),
 *  Select / Start the buzzer (00:1E83), Right / Left 09:4892, Up 09:48A9, Down 09:48CA. */
export function* itemList(g: Game, hl: number, a: number): Co {
  const m = g.m;
  yield* listOpen(g, hl, a);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: // 09:4860
        if (m.rd(0xcd17)) {
          m.wr(0xcd17, 0);
          m.wr(0xc084, 0);
          yield* listChosen(g);
        } else {
          m.wr(0xcd17, m.rd(0xcd17) + 1);
          m.wr(0xc084, m.rd(0xc080) + 0x04);
          m.wr(0xc085, m.rd(0xc081));
          m.wr(0xcd18, m.rd(0xcd15));
        }
        return false;
      case 1: // 09:4884
        if (!m.rd(0xcd17)) return true; // 00:1E79: the list left
        m.wr(0xcd17, 0);
        m.wr(0xc084, 0);
        return false;
      case 4: case 5: listColumn(m); return false;
      case 6: yield* listKeyUp(g); return false;
      case 7: yield* listKeyDown(g); return false;
      default: yield* soundBuzz(g); return false; // 2, 3: 00:1E83
    }
  });
}

// ---------------------------------------------------------------- items (09:4B34)

/** 09:4BB3 — one of the bag pair whose count is at hl used: count - 1; at 0 the count and the id
 *  (hl - 1) FF. */
function useOne(m: Memory, hl: number): void {
  const n = (m.rd(hl) - 1) & 0xff;
  m.wr(hl, n);
  if (n) return;
  m.wr(hl, (n - 1) & 0xff);
  m.wr((hl - 1) & 0xffff, 0xff);
}

/** 01:7726 — the word at hl + off moved to the word 2 bytes below it. */
function wordDown(m: Memory, hl: number, off: number): void {
  let p = (hl + off) & 0xffff;
  const d = m.rd(p); p = (p - 1) & 0xffff;
  const e = m.rd(p); p = (p - 1) & 0xffff;
  m.wr(p, d); p = (p - 1) & 0xffff;
  m.wr(p, e);
}

/** 01:7701 — every member (4; 5 with a member limit, 0B:6D12), the last first, not dead (C501
 *  bit 6; 01:7713): the words C516 -> C514 and C512 -> C510. */
function healAll(g: Game): void {
  const m = g.m;
  const lim = farSync(g, 0x0b, () => memberLimit(m));
  for (let b = lim ? 5 : 4; b; b--) {
    const hl = (offsetOf(m, b - 1) + 0xc501) & 0xffff;
    if (m.rd(hl) & 0x40) continue;
    wordDown(m, hl, 0x16);
    wordDown(m, hl, 0x12);
  }
}

/** 09:4DD6 — CE26 in the 0-ended list at hl (bank 09)? found: CA16 = it (nz, true). */
function inList(m: Memory, hl: number): boolean {
  const d = m.rd(0xce26);
  for (;;) {
    const a = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (!a) return false;
    if (a === d) {
      m.wr(0xca16, a);
      return true;
    }
  }
}

/** 09:4DB4 — the items E8 E9 E7 F5 (09:4DC9; CA16 = it) go through 0F:7CB0 (not ported); others:
 *  false (z). */
function* specialItem(g: Game): Co<boolean> {
  if (!inList(g.m, 0x4dc9)) return false;
  return yield* specialItemUse(g);
}

/** 09:4C35 — the list cursors (09:4951), the box 09:4C48 (4 bytes) -> C8B0, C8B6-C8B8 = 0. */
function listBoxBack(m: Memory): void {
  listCursorsOn(m);
  far0Sync0(() => copy(m, 0x4c48, 0xc8b0, 4));
  m.wr(0xc8b6, 0);
  m.wr(0xc8b7, 0);
  m.wr(0xc8b8, 0);
}
/** rst $18 to a bank-0 routine with bank 0 (no bank pushed). */
function far0Sync0<T>(fn: () => T): T {
  return fn();
}

/** 09:4C24 — the objects hidden (0F:7D97), CD15 / C080 / C081 back from CD1D-CD1F, then 09:4C35. */
function listBack(g: Game): void {
  const m = g.m;
  farSync(g, 0x0f, () => oamHold(g));
  m.wr(0xcd15, m.rd(0xcd1d));
  m.wr(0xc080, m.rd(0xcd1e));
  m.wr(0xc081, m.rd(0xcd1f));
  listBoxBack(m);
}

/** 09:4C1D — after a use: CDEA - 1 of 81 and above (CDEA 0 or 82 and above): 09:4C24. */
function afterUse(g: Game): void {
  if (((g.m.rd(0xcdea) - 1) & 0xff) < 0x81) return;
  listBack(g);
}

/** 09:4A2C — the caster (00:1FC4) short of points: C515 0 and C514 below CE29: the message
 *  09:71E5 (01:7E0D) and true (nz). */
function* shortOfPoints(g: Game): Co<boolean> {
  const m = g.m;
  const hl = (entityOffset(m) + 0xc515) & 0xffff;
  const e = m.rd(0xce29);
  if (m.rd(hl)) return false;
  if (m.rd((hl - 1) & 0xffff) >= e) return false;
  yield* farcall(g, 0x01, () => menuMessage(g, 0x71e5, false));
  return true;
}

/** 09:4D79 — the field spells 21 20 25 1B 2C (09:4DA2; CA16 = it) go through 01:40D6 / 01:4132 /
 *  01:424D / 01:422E (not ported); others: false (z). */
function* fieldSpell(g: Game): Co<boolean> {
  if (!inList(g.m, 0x4da2)) return false;
  return yield* fieldSpellCast(g);
}

/** 09:49C0 — use CE26 (CE25 the id space, CE27 kept): its record (09:5D7F) with CE27 back; CE28 &
 *  60 0: the buzzer, CDEA = 81; a spell (CE25 = CE27 = 0, CE26 below 30) of the field (09:4D79) or
 *  short of points (09:4A2C): CDEA = 80; else CE1C = CD36, the target (09:4165): cancelled CDEA =
 *  82, else the effect (09:521A, not ported). Then (09:4A05) CDEA - 1 of 81 and above: CD36 =
 *  CE1C, the objects hidden (0F:7D97), CD15 / C080 / C081 back from CD1D-CD1F. */
export function* useTarget(g: Game): Co {
  const m = g.m;
  const ce27 = m.rd(0xce27);
  farSync(g, 0x09, () => itemLoad(g));
  m.wr(0xce27, ce27);
  let a: number;
  if (!(m.rd(0xce28) & 0x60)) {
    yield* soundBuzz(g);
    a = 0x81;
  } else {
    const spell = !m.rd(0xce25) && !m.rd(0xce27) && m.rd(0xce26) < 0x30;
    if (spell && (yield* fieldSpell(g))) a = 0x80;
    else if (spell && (yield* shortOfPoints(g))) a = 0x80;
    else {
      m.wr(0xce1c, m.rd(0xcd36));
      const r = yield* selectMember(g);
      if (r !== 0xff) { yield* useEffect(g); a = -1; } // 09:4A02: 09:521A leaves CDEA itself
      else a = 0x82;
    }
  }
  if (a >= 0) m.wr(0xcdea, a);
  // 09:4A05
  if (((m.rd(0xcdea) - 1) & 0xff) < 0x81) return;
  m.wr(0xcd36, m.rd(0xce1c));
  farSync(g, 0x0f, () => oamHold(g));
  m.wr(0xcd15, m.rd(0xcd1d));
  m.wr(0xc080, m.rd(0xcd1e));
  m.wr(0xc081, m.rd(0xcd1f));
}

/** 09:4C4C — a spell book a (below 30): CD20 = a, a member chosen (09:4160) with C683 = FF
 *  meanwhile; cancelled: 09:4C24; the spell bit (C551 + the record + (a >> 3 ^ 1), bit a & 7)
 *  already set: the message 09:6F8B (01:7E0D); member 0's spell bits (00:1FCD with a = 0) 24 or
 *  more: 09:6F9C (01:7E0D); else the bit set, one book used (count at hl), 09:6FDD (01:7E08);
 *  then 09:4C24. */
function* learnSpell(g: Game, hl: number, a: number): Co {
  const m = g.m;
  m.wr(0xcd20, a);
  const c683 = m.rd(0xc683);
  m.wr(0xc683, 0xff);
  yield* chooseTarget(g);
  m.wr(0xc683, c683);
  const who = m.rd(0xcd36);
  if (who === 0xff) { listBack(g); return; }
  const id = m.rd(0xcd20);
  const p = (offsetOf(m, who) + 0xc551 + (((id >> 3) & 0x1f) ^ 0x01)) & 0xffff;
  const c = bitOf(id & 0x07);
  if (c & m.rd(p)) {
    yield* farcall(g, 0x01, () => menuMessage(g, 0x6f8b, false));
    listBack(g);
    return;
  }
  let q = (offsetOf(m, 0) + 0xc551) & 0xffff;
  let b = 0;
  for (let e = 6; e; e--) {
    let v = m.rd(q);
    q = (q + 1) & 0xffff;
    for (let d = 8; d; d--) {
      if (v & 0x80) b = (b + 1) & 0xff;
      v = (v << 1) & 0xff;
    }
  }
  if (b >= 0x18) {
    yield* farcall(g, 0x01, () => menuMessage(g, 0x6f9c, false));
    listBack(g);
    return;
  }
  m.wr(p, c | m.rd(p));
  useOne(m, hl);
  yield* farcall(g, 0x01, () => menuMessage(g, 0x6fdd, true));
  listBack(g);
}

/** 09:4BC8 — use the bag entry a (C6FF + 2a): CE26 = its id; the special items (09:4DB4): 09:4C35;
 *  E6: 0F:7BC8 (not ported); D2 and above: the buzzer; below 30: a spell book (09:4C4C); CB: sound
 *  19, one used (09:4BB3), the party healed (01:7701); else CE25 = 0, CE27 = 1, (CD-D0: C683 = FF
 *  meanwhile) the use (09:49C0); C0 and above with CDEA 0: one used (09:4BB3); then 09:4C1D. */
function* useItem(g: Game, a: number): Co {
  const m = g.m;
  let hl = (0xc6ff + ((a * 2) & 0xff)) & 0xffff;
  m.wr(0xce26, m.rd(hl));
  hl = (hl + 1) & 0xffff;
  if (yield* specialItem(g)) { listBoxBack(m); return; }
  const id = m.rd(0xce26);
  if (id === 0xe6) { yield* farcall(g, 0x0f, () => itemsLeft(g)); listBoxBack(m); return; } // 09:4BC4, then 09:4C35
  if (id >= 0xd2) { yield* soundBuzz(g); return; }
  if (id < 0x30) { yield* learnSpell(g, hl, id); return; }
  if (id === 0xcb) {
    g.sfx(0x19);
    useOne(m, hl);
    farSync(g, 0x01, () => healAll(g));
    return;
  }
  m.wr(0xce25, 0);
  m.wr(0xce27, 1);
  const c683 = m.rd(0xc683);
  if (id >= 0xcd && id < 0xd1) m.wr(0xc683, 0xff);
  yield* useTarget(g);
  m.wr(0xc683, c683);
  if (m.rd(0xce26) >= 0xc0 && !m.rd(0xcdea)) useOne(m, hl);
  afterUse(g);
}

/** 09:4B34 — the second A in the item list (b the picked entry, c the cursor's; FF in the trash
 *  column): both entries: the same one: used (09:4BC8), CA16 = FF; else the two bag pairs C6FF +
 *  2b / 2c swapped; one in the trash: that entry thrown away (FF FF) unless its id is D8 or above
 *  or 38-3C (the buzzer); both in the trash: nothing. Then the list drawn again (09:4BA7). */
function* itemChosen(g: Game): Co {
  const m = g.m;
  const [b, c] = listPair(m);
  let a: number;
  if (!(b & 0x80)) {
    if (!(c & 0x80)) {
      if (b === c) {
        yield* useItem(g, b);
        m.wr(0xca16, 0xff);
      } else {
        const p = (0xc6ff + ((b * 2) & 0xff)) & 0xffff;
        const e = m.rd(p), d = m.rd((p + 1) & 0xffff);
        const q = (0xc6ff + ((c * 2) & 0xff)) & 0xffff;
        m.wr(p, m.rd(q));
        m.wr(q, e);
        m.wr((p + 1) & 0xffff, m.rd((q + 1) & 0xffff));
        m.wr((q + 1) & 0xffff, d);
      }
      yield* listRedraw(g);
      return;
    }
    a = b;
  } else {
    if (c & 0x80) return;
    a = c;
  }
  // 09:4B8F
  const hl = (0xc6ff + ((a * 2) & 0xff)) & 0xffff;
  const id = m.rd(hl);
  if (id >= 0xd8 || (id >= 0x38 && id < 0x3d)) { yield* soundBuzz(g); return; }
  m.wr(hl, 0xff);
  m.wr((hl + 1) & 0xffff, 0xff);
  yield* listRedraw(g);
}

// ---------------------------------------------------------------- spells (09:4CC4)

/** 09:51EA — CD20 = the spell of the (a + 1)-th set bit of the spell bits C551 + the record of
 *  CD36 (00:1FC4; 6 bytes, MSB first; ((6 - c) ^ 1) * 8 + b - 1); FF when there is none. */
function spellIndex(m: Memory, a: number): void {
  let hl = (entityOffset(m) + 0xc551) & 0xffff;
  let e = (a + 1) & 0xff;
  for (let c = 6; c; c--) {
    let v = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    for (let b = 8; b; b--) {
      const carry = v & 0x80;
      v = ((v << 1) | (v >> 7)) & 0xff;
      if (carry) {
        e = (e - 1) & 0xff;
        if (!e) {
          m.wr(0xcd20, ((((6 - c) ^ 1) * 8 + b - 1) & 0xff));
          return;
        }
      }
    }
  }
  m.wr(0xcd20, 0xff);
}

/** 09:52F9 — the entity CD36 (00:1FC4) dead (C501 bit 6)? (nz) */
function isDead(m: Memory): boolean {
  return !!(m.rd((entityOffset(m) + 0xc501) & 0xffff) & 0x40);
}

/** 0B:7037 — item CE94 into the bag C6FF (24 pairs id, count): its pair counts one more (9 or
 *  more: CE94 = FF), else the first free pair (id FF) gets it with count 1; neither: CE94 = FF.
 *  Returns b (the pairs left in the search; 0 only when the bag is full). */
function bagAdd(m: Memory): number {
  const id = m.rd(0xce94);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--, hl += 2) {
    if (m.rd(hl) !== id) continue;
    const n = m.rd(hl + 1);
    if (n >= 0x09) { m.wr(0xce94, 0xff); return b; }
    m.wr(hl + 1, n + 1);
    return b;
  }
  hl = 0xc6ff;
  for (let b = 0x18; b; b--, hl += 2) {
    if (m.rd(hl) !== 0xff) continue;
    m.wr(hl, m.rd(0xce94));
    m.wr(hl + 1, 0x01);
    return b;
  }
  m.wr(0xce94, 0xff);
  return 0;
}

/** 09:4921 — the question 09:6FAE (the buzzer; the cursor C080 kept, hidden with the cursors
 *  09:490E when 48-97; the text at de, 16 x 8, mode 24, 00:3211; A or B, 0F:7A2C; CD39 = 1, C080
 *  back): true (z) when A was pressed. */
function* askDiscard(g: Game, de: number): Co<boolean> {
  const m = g.m;
  yield* soundBuzz(g);
  const c080 = m.rd(0xc080);
  if (c080 >= 0x48 && c080 < 0x98) {
    m.wr(0xc080, 0);
    cursorsHide(m);
  }
  yield* far0(g, 0, () => printText(g, 0x24, 0x6fae, de, 0x0810));
  const b = yield* farcall(g, 0x0f, () => waitAB(g));
  m.wr(0xcd39, 1);
  m.wr(0xc080, c080);
  return !(b & 0x02);
}

/** 0B:6DB3 — 09:4921 at (2, 1) (CD37 clear: (2, 8)); true (z) when A was pressed. */
function* askDiscardAt(g: Game): Co<boolean> {
  const de = g.m.rd(0xcd37) ? 0x0102 : 0x0802;
  return yield* farcall(g, 0x09, () => askDiscard(g, de));
}

/** 09:4D1D — spell CD20 of CD36 back to the bag (CD36 4: the buzzer): CE94 = CD20 into the bag
 *  (0B:7037); the bag full: the message 09:6F55 (01:7E0D); already 9 (CE94 FF): the question
 *  (0B:6DB3), B keeps it; then (09:4D37) the spell bit cleared. */
function* spellToBag(g: Game): Co {
  const m = g.m;
  if (m.rd(0xcd36) === 0x04) { yield* soundBuzz(g); return; }
  m.wr(0xce94, m.rd(0xcd20));
  const b = farSync(g, 0x0b, () => bagAdd(m));
  if (!b) {
    yield* farcall(g, 0x01, () => menuMessage(g, 0x6f55, false));
    return;
  }
  if (m.rd(0xce94) === 0xff) {
    if (!(yield* farcall(g, 0x0b, () => askDiscardAt(g)))) return;
  }
  // 09:4D37
  const id = m.rd(0xcd20);
  const p = (entityOffset(m) + 0xc551 + (((id >> 3) & 0x1f) ^ 0x01)) & 0xffff;
  m.wr(p, ~bitOf(id & 0x07) & m.rd(p));
}

/** 09:4D60 — cast spell CD20 (the caster dead, 09:52F9: the buzzer): CE26 = CD20, CE25 = CE27 = 0,
 *  the use (09:49C0), then 09:4C1D. */
function* castSpell(g: Game): Co {
  const m = g.m;
  if (isDead(m)) { yield* soundBuzz(g); return; }
  m.wr(0xce26, m.rd(0xcd20));
  m.wr(0xce25, 0);
  m.wr(0xce27, 0);
  yield* useTarget(g);
  afterUse(g);
}

/** 09:4CC4 — the second A in the spell list (b the picked entry, c the cursor's; FF in the trash
 *  column): both entries: the same one: cast (09:51EA, 09:4D60), CA16 = FF, drawn again; two
 *  different ones: nothing; one in the trash: that spell (09:51EA; none: nothing) back to the bag
 *  (09:4D1D), drawn again (09:4D11); both in the trash: nothing. */
function* spellChosen(g: Game): Co {
  const m = g.m;
  const [b, c] = listPair(m);
  let a: number;
  if (!(b & 0x80)) {
    if (!(c & 0x80)) {
      if (b !== c) return;
      farSync(g, 0x09, () => spellIndex(m, b));
      yield* castSpell(g);
      m.wr(0xca16, 0xff);
      yield* listRedraw(g);
      return;
    }
    a = b;
  } else {
    if (c & 0x80) return;
    a = c;
  }
  farSync(g, 0x09, () => spellIndex(m, a));
  if (m.rd(0xcd20) === 0xff) return;
  yield* spellToBag(g);
  yield* listRedraw(g);
}

// ---------------------------------------------------------------- the menu items

/** 09:4350 — menu item 0, the items: the objects hidden (0F:7D97), the list 09:6D00 (09:484B, a =
 *  0), CD15 = 0. */
export function* menuItem0(g: Game): Co {
  farSync(g, 0x0f, () => oamHold(g));
  yield* itemList(g, 0x6d00, 0x00);
  g.m.wr(0xcd15, 0);
}

/** 09:435E — menu item 1, the spells: a member chosen (09:413F) and the list of its spells
 *  09:6E99 (the objects hidden, 0F:7D97; 09:484B, a = 1), again until cancelled; then CD15 = 1. */
export function* menuItem1(g: Game): Co {
  for (;;) {
    const a = yield* chooseMember(g);
    if (a === 0xff) break;
    farSync(g, 0x0f, () => oamHold(g));
    yield* itemList(g, 0x6e99, 0x01);
  }
  g.m.wr(0xcd15, 0x01);
}
