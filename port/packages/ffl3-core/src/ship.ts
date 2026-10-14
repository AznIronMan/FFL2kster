/** Legend III ship console (event 23: 00:19B8 selects bank 01 with `rst $20`, calls 01:7972, then
 *  dispatches on CA57): the key items D8-E4 taken out of the bag into the flags C6F8 / C6F9
 *  (01:7C1B), the console boxes (01:7BCC: the template 01:7C04 -> C8B0, the texts of the item
 *  table 01:7BF0), the cursor C080 on five rows (50-90) through the menu input 00:1E51 (A:
 *  01:7A43, B: 01:7A8C, Up / Down: 01:7A92 / 01:7AA1, the others the buzzer 00:1E83). The first
 *  row leaves the console (01:79B3); rows 2-5 open the four sub-items of the table 01:7A84
 *  (01:7AB2, 01:7AE9, 01:7B19, 01:7B42) with the sub-menu cursor C084 (01:7B6F). CA57 is left
 *  for 00:19B8: 0 (B), 1 (A on the first row), 2 (A on rows 2-5).
 *  Every routine here runs with bank 01 selected (its tables are read from the current bank). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, copyB, far0, far0Sync, farcall, farSync, fadeIn, fadeOut, textBegin, textEnd, windowOff, soundOk,
  soundBuzz, wait1 } from "./sys.js";
import { NotPorted } from "./irq.js";
import { menuInput, windowTop } from "./title.js";
import { menu } from "./menu.js";
import { printText } from "./text.js";
import { oamClear } from "./names.js";
import { resetSprites } from "./sprites.js";
import { testFlag, setFlag } from "./objects.js";
import { wornOutBack } from "./equip.js";
import { waitAB } from "./menuitems.js";
import { scriptRef } from "./events.js";
import { windowClose } from "./window.js";
import { menuClose } from "./fieldmenu.js";

const swap = (a: number): number => ((a << 4) | (a >> 4)) & 0xff;

// ---------------------------------------------------------------- helpers of other banks

/** 00:2901 — the item flag of a (D8-E7: k = a - D8, bit 1 << (7 - (k & 7)) (00:1EF1) of C6F8,
 *  of C6F9 for k >= 8): set? (nz) */
function itemFlag(m: Memory, a: number): boolean {
  const k = (a - 0xd8) & 0xff;
  const hl = k < 0x08 ? 0xc6f8 : 0xc6f9;
  const n = ((~(k & 0x07) & 0xff) + 0x08) & 0xff;
  let bit = 0x01;
  for (let c = n; c; c--) bit = (bit << 1) & 0xff;
  return !!(bit & m.rd(hl));
}

/** 0B:706C — one of item CE91 taken from the bag C6FF (0x18 pairs id, count): not found or a
 *  count of 0: CE91 = FF; else the count - 1. */
function bagTake(m: Memory): void {
  const a = m.rd(0xce91);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (a === m.rd(hl)) {
      hl = (hl + 1) & 0xffff;
      const n = m.rd(hl);
      if (!n) break;
      m.wr(hl, (n - 1) & 0xff);
      return;
    }
    hl = (hl + 2) & 0xffff;
  }
  m.wr(0xce91, 0xff);
}

/** 0F:7D9F — the objects of the OAM buffer C000 (0x28, every 4 bytes) whose y is in [d, e) get
 *  y = 4. */
function oamHideRows(m: Memory, d: number, e: number): void {
  for (let l = 0; l < 0xa0; l += 4) {
    const a = m.rd(0xc000 + l);
    if (a >= d && a < e) m.wr(0xc000 + l, 4);
  }
}

/** 0F:7BA7 — CDC0 (and a) by the story flags: flag 05 set: 08; else flag 0E: 01; else flag 0F:
 *  04; else 02. */
function shipStage(m: Memory): number {
  let a: number;
  if (testFlag(m, 0x05)) a = 0x08;
  else if (testFlag(m, 0x0e)) a = 0x01;
  else if (testFlag(m, 0x0f)) a = 0x04;
  else a = 0x02;
  m.wr(0xcdc0, a);
  return a;
}

/** 0F:7A2E — wait (a frame at a time, 00:358B) for a new press (FF8B) of a button of c (another
 *  one buzzes, 00:1E83), then the cursor sound (00:1E7C). Returns the press & c. */
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

/** 0F:7A24 — wait for any button (0F:7A2E with c = FF). */
function* waitAny(g: Game): Co<number> {
  return yield* waitKeys(g, 0xff);
}


// ---------------------------------------------------------------- the key items (01:7C1B)

/** 01:7C3A — CE91 = c, one of it taken from the bag (0B:706C); returns CE91 + 1 (0: not there). */
function bagTakeItem(g: Game, c: number): number {
  const m = g.m;
  m.wr(0xce91, c);
  farSync(g, 0x0b, () => bagTake(m));
  return (m.rd(0xce91) + 1) & 0xff;
}

/** 01:7C49 — key item c received: CE94 = c; below E1 the story flag 01:7B98[c] (01:7C70..) set
 *  (00:3CA0); the text 09:7889 (mode 0C, box (1,1) 18 x 6), any button (0F:7A24), the window
 *  closed (00:35D2). */
function* keyItemGot(g: Game, c: number): Co {
  const m = g.m;
  m.wr(0xce94, c);
  if (c < 0xe1) {
    const a = m.rd((0x7b98 + c) & 0xffff);
    setFlag(m, a);
  }
  yield* far0(g, 0x09, () => printText(g, 0x0c, 0x7889, 0x0101, 0x0612));
  yield* farcall(g, 0x0f, () => waitAny(g));
  yield* windowClose(g);
}

/** 01:7C1B — the key items D8-E4: each one found in the bag (taken out of it, 01:7C3A) sets its
 *  bit of C6F8 / C6F9 (from bit 7 of C6F8 on) and is announced (01:7C49); then the worn-out
 *  weapons and the empty bag pairs (0B:6683). */
function* keyItems(g: Game): Co {
  const m = g.m;
  let b = 0x80, c = 0xd8, hl = 0xc6f8;
  do {
    if (bagTakeItem(g, c)) {
      m.wr(hl, b | m.rd(hl));
      yield* keyItemGot(g, c);
    }
    const carry = b & 0x01;
    b = ((b >> 1) | (carry << 7)) & 0xff;
    if (carry) hl = (hl + 1) & 0xffff;
    c = (c + 1) & 0xff;
  } while (c < 0xe5);
  farSync(g, 0x0b, () => wornOutBack(g));
}

// ---------------------------------------------------------------- the boxes

/** 01:7BCC — the console boxes for item a: the 0x17-byte template 01:7C04 -> C8B0 (00:1F97),
 *  the text words of 01:7BF0 + 4 a -> C8B4 and C8BB (00:1F90), drawn (00:1E49), the window at the
 *  top (0B:6D04). */
function* boxes(g: Game, a: number): Co {
  const m = g.m;
  far0Sync(g, 0, () => copyB(m, 0x7c04, 0xc8b0, 0x17));
  let hl = (0x7bf0 + ((a * 4) & 0xff)) & 0xffff;
  [hl] = copy(m, hl, 0xc8b4, 2);
  copy(m, hl, 0xc8bb, 2);
  yield* menu(g);
  farSync(g, 0x0b, () => windowTop(g));
}

/** 01:7BC1 — the text hl (bank 09, mode 04) in the box (1,3) 18 x 2. */
function* itemText(g: Game, hl: number): Co {
  yield* far0(g, 0x09, () => printText(g, 0x04, hl, 0x0301, 0x0212));
}

// ---------------------------------------------------------------- the sub-menu (01:7B6F)

/** 01:7B96 — sub-menu Up: C084 50 -> 90, else - 10. */
function subUp(m: Memory): void {
  const a = m.rd(0xc084);
  m.wr(0xc084, a === 0x50 ? 0x90 : (a - 0x10) & 0xff);
}

/** 01:7BA5 — sub-menu Down: C084 90 -> 50, else + 10. */
function subDown(m: Memory): void {
  const a = m.rd(0xc084);
  m.wr(0xc084, a === 0x90 ? 0x50 : (a + 0x10) & 0xff);
}

/** 01:7B6F — the sub-menu: C084 = 50, the menu input (00:1E51) with A 01:7B8D (a = swap(C084 -
 *  50), the row 0-4), B 01:7B86 (a = FF), Up 01:7B96, Down 01:7BA5, the others the buzzer; both
 *  A and B leave (`cp $ff ; jp $1e79`). Returns a (FF: cancelled, the callers' `ret z`). */
function* subMenu(g: Game): Co<number> {
  const m = g.m;
  m.wr(0xc084, 0x50);
  let a = 0xff;
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: a = swap((m.rd(0xc084) - 0x50) & 0xff); return true; // 01:7B8D
      case 1: a = 0xff; return true; // 01:7B86
      case 6: subUp(m); return false;
      case 7: subDown(m); return false;
      default: yield* soundBuzz(g); return false; // 00:1E83
    }
  });
  return a;
}

// ---------------------------------------------------------------- the sub-items

/** 01:7BB4 — none available: C084 = 0, the text 09:77E2 (01:7BC1), A or B (0F:7A2C). */
function* itemNone(g: Game): Co {
  g.m.wr(0xc084, 0);
  yield* itemText(g, 0x77e2);
  yield* farcall(g, 0x0f, () => waitAB(g));
}

/** 01:7B5B — chosen: C084 = 0, the text 09:782C (mode 24, box (3,10) 14 x 2), A or B
 *  (0F:7A2C). */
function* itemChosen(g: Game): Co {
  g.m.wr(0xc084, 0);
  yield* far0(g, 0x09, () => printText(g, 0x24, 0x782c, 0x0a03, 0x020e));
  yield* farcall(g, 0x0f, () => waitAB(g));
}

/** 01:7AB2 — sub-item 1: the boxes (01:7BCC, 1); none of the flags C6F8 bits 1-0 / C6F9 bit 7:
 *  01:7BB4; else the text 09:77F4 and the sub-menu (01:7B6F) until cancelled or a row 0-2 whose
 *  item DE + row has its flag (00:2901): C6FA = that item, 01:7B5B; other rows buzz (00:1E83). */
function* item1(g: Game): Co {
  const m = g.m;
  yield* boxes(g, 0x01);
  if (!(m.rd(0xc6f8) & 0x03) && !(m.rd(0xc6f9) & 0x80)) { yield* itemNone(g); return; }
  yield* itemText(g, 0x77f4);
  for (;;) {
    const a = yield* subMenu(g);
    if (a === 0xff) return;
    if (a < 0x03) {
      const b = (a + 0xde) & 0xff;
      if (itemFlag(m, b)) {
        m.wr(0xc6fa, b);
        yield* itemChosen(g);
        return;
      }
    }
    yield* soundBuzz(g);
  }
}

/** 01:7AE9 — sub-item 2: the boxes (01:7BCC, 2); none of C6F9 bits 6-4: 01:7BB4; else the text
 *  09:7813 and the sub-menu (01:7B6F) until cancelled or a row 0-2 whose item E1 + row has its
 *  flag (00:2901): CA50 = the row; other rows buzz (00:1E83). */
function* item2(g: Game): Co {
  const m = g.m;
  yield* boxes(g, 0x02);
  if (!(m.rd(0xc6f9) & 0x70)) { yield* itemNone(g); return; }
  yield* itemText(g, 0x7813);
  for (;;) {
    const a = yield* subMenu(g);
    if (a === 0xff) return;
    if (a < 0x03) {
      const b = (a + 0xe1) & 0xff;
      if (itemFlag(m, b)) {
        m.wr(0xca50, (b - 0xe1) & 0xff);
        return;
      }
    }
    yield* soundBuzz(g);
  }
}

/** 01:7B19 — sub-item 3: the boxes (01:7BCC, 3), the text 09:7844, the sub-menu (01:7B6F) until
 *  cancelled or a row whose item (rows 0-3: D8 + row, row 4: E4) has its flag (00:2901): C6FB =
 *  that item, 01:7B5B; else the buzzer (00:1E83). */
function* item3(g: Game): Co {
  const m = g.m;
  yield* boxes(g, 0x03);
  yield* itemText(g, 0x7844);
  for (;;) {
    let a = yield* subMenu(g);
    if (a === 0xff) return;
    if (a === 0x04) a = 0x0c;
    const b = (a + 0xd8) & 0xff;
    if (itemFlag(m, b)) {
      m.wr(0xc6fb, b);
      yield* itemChosen(g);
      return;
    }
    yield* soundBuzz(g);
  }
}

/** 01:7B42 — sub-item 4: C084 = 0, the boxes (01:7BCC, 4); none of C6F8 bits 3-2: 01:7BB4; else
 *  the text 09:786F (01:7BC1) and A or B (0F:7A2C). */
function* item4(g: Game): Co {
  const m = g.m;
  m.wr(0xc084, 0);
  yield* boxes(g, 0x04);
  if (!(m.rd(0xc6f8) & 0x0c)) { yield* itemNone(g); return; }
  yield* itemText(g, 0x786f);
  yield* farcall(g, 0x0f, () => waitAB(g));
}

// ---------------------------------------------------------------- the console input (01:79A1)

/** How the console input is left: the console left (01:79D2) or the menu screen closed
 *  (01:7A39); null: the input goes on. */
type Exit = "leave" | "close" | null;

/** 01:7A72 — back to the console: CA50 = FF, C081 = 10, C084 = 0, the boxes (01:7BCC, 0). */
function* consoleReset(g: Game): Co {
  const m = g.m;
  m.wr(0xca50, 0xff);
  m.wr(0xc081, 0x10);
  m.wr(0xc084, 0);
  yield* boxes(g, 0x00);
}

/** 01:7A3E — the buzzer (00:1E83), back to the console (01:7A72). */
function* itemRefused(g: Game): Co {
  yield* soundBuzz(g);
  yield* consoleReset(g);
}

/** 01:79E9 — the choice a = CA50 + 1 of sub-item 2 confirmed: a = 3: CDC0 = 08; else by the
 *  story flags (00:3CB2): flag 05 refuses (01:7A3E); flag 0E: a = 1 -> 0F:7BA7 ^ 3, else 0F:7BA7
 *  ^ 5; neither: a = 1 needs flag 0F clear (0F:7BA7 ^ 3), a = 2 flag 0F set (0F:7BA7 ^ 5), else
 *  refused. Then CDC0 = that value, the objects in rows 48-67 moved to y 4 (0F:7D9F), the text
 *  09:7314 (mode 24, box (1,8) 18 x 2), A or B (0F:7A2C): B back to the console (01:7A72), A
 *  leaves the input and closes the screen (01:7A39). */
function* itemConfirm(g: Game, a: number): Co<Exit> {
  const m = g.m;
  let b = a;
  let v: number;
  if (a === 0x03) v = 0x08;
  else {
    if (testFlag(m, 0x05)) { yield* itemRefused(g); return null; }
    let x5: boolean; // 01:7A13 (^ 5) rather than 01:7A08 (^ 3)
    if (testFlag(m, 0x0e)) {
      b = (b - 1) & 0xff; // 01:7A19
      x5 = b !== 0;
    } else {
      b = (b - 1) & 0xff;
      if (b !== 0) {
        if (!testFlag(m, 0x0f)) { yield* itemRefused(g); return null; } // 01:7A0E
        x5 = true;
      } else {
        if (testFlag(m, 0x0f)) { yield* itemRefused(g); return null; }
        x5 = false;
      }
    }
    v = farSync(g, 0x0f, () => shipStage(m)) ^ (x5 ? 0x05 : 0x03);
  }
  m.wr(0xcdc0, v);
  farSync(g, 0x0f, () => oamHideRows(m, 0x48, 0x68));
  yield* far0(g, 0x09, () => printText(g, 0x24, 0x7314, 0x0801, 0x0212));
  const k = yield* farcall(g, 0x0f, () => waitAB(g));
  if (k & 0x02) { yield* consoleReset(g); return null; }
  return "close";
}

/** 01:7A6B — after a sub-item: CA50 not FF: 01:79E9 with CA50 + 1; else back to the console
 *  (01:7A72). */
function* afterItem(g: Game): Co<Exit> {
  const a = (g.m.rd(0xca50) + 1) & 0xff;
  if (a) return yield* itemConfirm(g, a);
  yield* consoleReset(g);
  return null;
}

/** 01:79B3 — A on the first row: flag 05 set, or flag 0E clear with flags 0F and E1 set, leaves
 *  the console (01:79D2); else the buzzer (00:1E83). */
function* consoleTop(g: Game): Co<Exit> {
  const m = g.m;
  if (!testFlag(m, 0x05)) {
    if (testFlag(m, 0x0e) || !testFlag(m, 0x0f) || !testFlag(m, 0xe1)) {
      yield* soundBuzz(g);
      return null;
    }
  }
  return "leave";
}

/** 01:7A43 — A: CA57 = 1 on the first row (C080 50), else 2; the first row: 01:79B3; rows 2-5:
 *  C081 = 0 and the sub-item of the table 01:7A84 (01:7AB2, 01:7AE9, 01:7B19, 01:7B42), returning
 *  to 01:7A6B. */
function* consoleA(g: Game): Co<Exit> {
  const m = g.m;
  let a = (m.rd(0xc080) - 0x50) & 0xff;
  if (a) a = 0x01;
  m.wr(0xca57, (a + 1) & 0xff);
  a = (m.rd(0xc080) - 0x50) & 0xff;
  if (!a) return yield* consoleTop(g);
  const off = (swap(a) * 2) & 0xff;
  const at = (0x7a82 + off) & 0xffff;
  m.wr(0xc081, 0);
  const item = m.rd16(at);
  switch (item) {
    case 0x7ab2: yield* item1(g); break;
    case 0x7ae9: yield* item2(g); break;
    case 0x7b19: yield* item3(g); break;
    case 0x7b42: yield* item4(g); break;
    default: throw new NotPorted(`01:7A6A (jp hl to 01:${item.toString(16).toUpperCase()}, C080 ${m.rd(0xc080).toString(16)})`);
  }
  return yield* afterItem(g);
}

/** 01:7A92 — Up: C080 50 -> 90, else - 10. */
function consoleUp(m: Memory): void {
  const a = m.rd(0xc080);
  m.wr(0xc080, a === 0x50 ? 0x90 : (a - 0x10) & 0xff);
}

/** 01:7AA1 — Down: C080 90 -> 50, else + 10. */
function consoleDown(m: Memory): void {
  const a = m.rd(0xc080);
  m.wr(0xc080, a === 0x90 ? 0x50 : (a + 0x10) & 0xff);
}

/** 01:79D2 (after `pop hl ; pop hl`) — the console left: CD42 = 0, fade out (00:39F3), the
 *  objects hidden (00:20CF), the window off (00:3A4B), the bracket left (00:1DF3), WY = 50. */
function* consoleLeave(g: Game): Co {
  const m = g.m;
  m.wr(0xcd42, 0);
  yield* fadeOut(g);
  oamClear(g);
  windowOff(m);
  yield* textEnd(g);
  m.wr(0xff4a, 0x50);
}

/** 01:7972 — event 23, the ship console (bank 01 selected): the bracket with CD3D (00:1D98), the
 *  key items (01:7C1B), fade out (00:39F3), the script reference 01:7AB0 (00:2EF6: event 1F),
 *  the boxes (01:7BCC, 0), the objects hidden (00:20CF), the sprites reset (09:40E8), the cursors
 *  C080/C081 = 50, 10 and C084/C085 = 0, 58, CA50 = FF, fade in (00:3A0C); then the menu input
 *  (00:1E51) with A 01:7A43, B 01:7A8C (CA57 = 0), Up 01:7A92, Down 01:7AA1, the others the
 *  buzzer. Left on the first row (01:79D2) or by B / a confirmed choice (01:7A39: the menu
 *  screen closed, 01:7023). CA57 is left for the dispatch of 00:19B8. */
export function* shipConsole(g: Game): Co {
  const m = g.m;
  yield* textBegin(g);
  yield* keyItems(g);
  yield* fadeOut(g);
  yield* scriptRef(g, 0x40, 0x7ab0);
  yield* boxes(g, 0x00);
  oamClear(g);
  yield* farcall(g, 0x09, () => resetSprites(g));
  m.wr(0xc080, 0x50);
  m.wr(0xc081, 0x10);
  m.wr(0xc084, 0x00);
  m.wr(0xc085, 0x58);
  m.wr(0xca50, 0xff);
  yield* fadeIn(g);
  let exit = null as Exit;
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: exit = yield* consoleA(g); return exit !== null;
      case 1: m.wr(0xca57, 0); exit = "close"; return true; // 01:7A8C
      case 6: consoleUp(m); return false;
      case 7: consoleDown(m); return false;
      default: yield* soundBuzz(g); return false; // 2-5: 00:1E83
    }
  });
  if (exit === "leave") yield* consoleLeave(g);
  else yield* farcall(g, 0x01, () => menuClose(g)); // 01:7A39: pop hl ; pop hl ; farcall 01:7023
}
