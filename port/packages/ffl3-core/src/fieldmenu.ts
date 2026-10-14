/** Legend III field menu (Start in the field, 00:0846: `rst $18 ; farcall 09:4000`, then
 *  `call $402D` with bank 01 back): the menu screen 09:40AD (fade out, the bracket, the window at
 *  the top, the sprites, the frame tiles 0B:7CCD, the status words CDEC, the boxes 09:4317 drawn by
 *  09:4FEF, fade in), the menu input 00:1E51 with the handlers of 09:400F (A: the item CD15, B:
 *  close, Left / Right: the column CD16, Up / Down: the item CD15), the close 09:408D (01:7023:
 *  fade out, the bracket left, the map tiles reloaded (00:0150), the objects (00:01A0), fade in;
 *  then the CA16 message) and 01:402D (the action CA16 left by an item).
 *  The menu routines run with bank 09 selected (its tables are read from the current bank). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, far0, far0Sync, farcall, farSync, pushBank, popBank, vramCopy, fadeIn, fadeOut, textBegin,
  textEnd, windowOff, bracketEnter, bracketLeave, soundBuzz, memberOffset, wait1 } from "./sys.js";
import { NotPorted } from "./irq.js";
import { oamClear } from "./names.js";
import { windowTop, menuInput } from "./title.js";
import { resetSprites, loadSpriteTiles, memberLimit } from "./sprites.js";
import { drawMenu } from "./menu.js";
import { entityOffset } from "./bstats.js";
import { printText } from "./text.js";
import { menuItem0, menuItem1 } from "./menuitems.js";
import { menuItem2, menuItem4 } from "./menuitems2.js";
import { menuItem3, menuItem5, menuItem6 } from "./menuitems3.js";
import { leaderLook, loadTiles } from "./mapload.js";
import { drawObjects, tableWord } from "./actors.js";
import { setSlot, fset, testFlag } from "./objects.js";
import { wornOutBack } from "./equip.js";
import { MenuExit, afterCallVehicle, afterStepAhead, afterWarpBack, afterToggle0A } from "./fieldfx.js";

// ---------------------------------------------------------------- small helpers

/** 00:1FCD — the record offset of entity a (the table doubles a in 8 bits). */
const offsetOf = (m: Memory, a: number): number => memberOffset(m, a & 0x7f);

/** 00:29EF — the status index of member a (CD37 clear: the first set bit of C501 & FC, 1-6;
 *  CD37 set: of the entity CD36, C501 bits 7-6 -> 1-2, C502 bits 7-5 -> 7-9, C501 bits 5-2 ->
 *  3-6); 0 when none. Returns [index (a), hl = 6D73 + 4 index]. */
export function statusIndex(m: Memory, a: number): [number, number] {
  const scan = (v: number, e: number, d: number): [boolean, number] => {
    for (;;) {
      e = (e + 1) & 0xff;
      const c = v & 0x80;
      v = (v << 1) & 0xff;
      if (c) return [true, e];
      d--;
      if (!d) return [false, e];
    }
  };
  let e: number;
  if (!m.rd(0xcd37)) {
    let v = m.rd((offsetOf(m, a) + 0xc501) & 0xffff) & 0xfc;
    if (!v) return [0, 0x6d73];
    e = 0;
    for (;;) { e++; const c = v & 0x80; v = (v << 1) & 0xff; if (c) break; }
  } else {
    const hl = (entityOffset(m) + 0xc501) & 0xffff;
    const s1 = m.rd(hl), s2 = m.rd((hl + 1) & 0xffff);
    if (!((s1 & 0xfc) | (s2 & 0xe0))) return [0, 0x6d73];
    let f: boolean;
    [f, e] = scan(s1, 0, 2);
    if (!f) {
      [f, e] = scan(s2, 6, 3);
      if (!f) [, e] = scan((s1 << 2) & 0xff, 2, 4);
    }
  }
  return [e, (0x6d73 + 4 * e) & 0xffff];
}

/** 0F:7DB4 — bit 7 of C500 + the record of CD36 (00:1FC4): set? (nz) */
export function recordBit7(m: Memory): boolean {
  return !!(m.rd((entityOffset(m) + 0xc500) & 0xffff) & 0x80);
}

/** 0F:78B2 — the list cursors off (C088 = C08C = 0). */
export function listCursorsOff(m: Memory): void {
  m.wr(0xc088, 0);
  m.wr(0xc08c, 0);
}

/** 09:490E — the 12 cursor objects from C050 hidden (y 0). */
export function cursorsHide(m: Memory): void {
  for (let k = 0; k < 0x0c; k++) m.wr(0xc050 + 4 * k, 0);
}

// ---------------------------------------------------------------- frame tiles (bank 0B)

/** 0B:7D60 — the menu frame tiles composed in VRAM: tile 9D (90D0) -> 90E0, tile 9C (90C0) ->
 *  90F0; then the 64 bytes 9040-907F = (90C0 + i & mask) | (9080 + i), the mask 0B:7DAA[i / 2]
 *  (each pair of bytes after an hblank poll 0B:7D9D: CPU time). */
function frameTilesCompose(g: Game): void {
  const m = g.m;
  let de = 0x90e0;
  [, de] = far0Sync(g, 0, () => vramCopy(m, 0x90d0, de, 0x10));
  far0Sync(g, 0, () => vramCopy(m, 0x90c0, de, 0x10));
  for (let i = 0; i < 0x20; i++) {
    const c = m.rd(0x7daa + i);
    for (let j = 0; j < 2; j++) {
      const off = 2 * i + j;
      m.wr(0x9040 + off, (m.rd(0x90c0 + off) & c) | m.rd(0x9080 + off));
    }
  }
}

/** 0B:7CCD — di; the frame tiles 03:48A0 -> 9080 (0x60 bytes), composed (0B:7D60); reti. */
function* frameTiles(g: Game): Co {
  const m = g.m;
  g.ime = false;
  far0Sync(g, 0x03, () => vramCopy(m, 0x48a0, 0x9080, 0x60));
  frameTilesCompose(g);
  yield* g.reti();
}

// ---------------------------------------------------------------- the status words CDEC

/** 09:4573 — hl = CDEC + 4 CD36 (the status word of member CD36). */
export function statusWord(m: Memory): number {
  return (0xcdec + ((m.rd(0xcd36) * 4) & 0xff)) & 0xffff;
}

/** 09:4593 — the status word of member CD36: a status index 1-2 (00:29EF): its 4 bytes 0E:6D73 +
 *  4 index; else C500 bit 7 (0F:7DB4): the 4 bytes 09:6E04; else a status index 3+: 0E:6D73 + 4
 *  index; none: the first byte 0. */
export function statusWordSet(g: Game): void {
  const m = g.m;
  let [e, hl] = statusIndex(m, m.rd(0xcd36));
  if (!e || e >= 0x03) {
    if (farSync(g, 0x0f, () => recordBit7(m))) {
      const de = statusWord(m);
      far0Sync(g, 0, () => copy(m, 0x6e04, de, 4));
      return;
    }
    [e, hl] = statusIndex(m, m.rd(0xcd36));
    if (!e) { m.wr(statusWord(m), 0); return; }
  }
  const de = statusWord(m);
  far0Sync(g, 0x0e, () => copy(m, hl, de, 4));
}

/** 09:457D — the status words of members 4..0 (09:4593; CD36 kept). */
export function statusWords(g: Game): void {
  const m = g.m;
  const saved = m.rd(0xcd36);
  for (let a = 4; a >= 0; a--) {
    m.wr(0xcd36, a);
    statusWordSet(g);
  }
  m.wr(0xcd36, saved);
}

// ---------------------------------------------------------------- the menu screen

/** 09:4264 — the cursor C080 = 20 + 10 CD15 (y), C081 = CD16 ? 08 + (swap CD16 >> 1) : 0 (x). */
export function cursorPlace(m: Memory): void {
  m.wr(0xc080, (((m.rd(0xcd15) << 4) | (m.rd(0xcd15) >> 4)) + 0x20) & 0xff);
  let a = m.rd(0xcd16);
  if (a) a = (((((a << 4) | (a >> 4)) & 0xff) >> 1) + 0x08) & 0xff;
  m.wr(0xc081, a);
}

/** 09:427E — the menu redrawn: CD39 = 1, the status words (09:457D); unless CD36 is FE: with the
 *  column CD16 = 3 the objects hidden (00:20CF) and CD1C = 1, else the cursors C050.. hidden
 *  (09:490E) and the list cursors off (0F:78B2); the cursor (09:4264). Then the boxes -> C8B0:
 *  no member limit (0B:6D12 z): 09:4317 (7 bytes) and an end; CD36 FE with CD15 4: 09:4317 (16);
 *  else 09:431E, 09:4317, the end 09:4325; over the end: CD35 set: 09:4347 (9), else by CD16
 *  (3: 09:4327, C: 09:4337, 16 bytes; 0: none); drawn (09:4FEF); CD1C = 0; CD3C set: CD3C = 0
 *  and the sprite tiles (0B:7DCA). */
export function* menuRedraw(g: Game): Co {
  const m = g.m;
  m.wr(0xcd39, 1);
  statusWords(g);
  if (m.rd(0xcd36) !== 0xfe) {
    if (m.rd(0xcd16) === 0x03) {
      oamClear(g);
      m.wr(0xcd1c, 1);
    } else {
      cursorsHide(m);
      farSync(g, 0x0f, () => listCursorsOff(m));
    }
    cursorPlace(m);
  }
  let de = 0xc8b0;
  if (!farSync(g, 0x0b, () => memberLimit(m))) {
    [, de] = copy(m, 0x4317, de, 7);
    m.wr(de, 0); de = (de + 1) & 0xffff;
    m.wr(de, 0); de = (de + 1) & 0xffff;
  } else if (m.rd(0xcd36) === 0xfe && m.rd(0xcd15) === 0x04) {
    [, de] = copy(m, 0x4317, de, 16);
  } else {
    [, de] = copy(m, 0x431e, de, 7);
    [, de] = copy(m, 0x4317, de, 7);
    [, de] = copy(m, 0x4325, de, 2);
  }
  if (m.rd(0xcd35)) {
    copy(m, 0x4347, (de - 2) & 0xffff, 9);
  } else {
    const a = m.rd(0xcd16);
    if (a) copy(m, a === 0x03 ? 0x4327 : 0x4337, (de - 2) & 0xffff, 16);
  }
  yield* drawMenu(g);
  m.wr(0xcd1c, 0);
  if (!m.rd(0xcd3c)) return;
  m.wr(0xcd3c, 0);
  yield* farcall(g, 0x0b, () => loadSpriteTiles(g, 0));
}

/** 09:40D3 — the menu screen: fade out (00:39F3), the bracket with CD3D (00:1D98), the window at
 *  the top (0B:6D04), the sprites reset (09:40E8), C089 = C08D = 8, the frame tiles (0B:7CCD). */
function* menuScreen(g: Game): Co {
  const m = g.m;
  yield* fadeOut(g);
  yield* textBegin(g);
  farSync(g, 0x0b, () => windowTop(g));
  yield* farcall(g, 0x09, () => resetSprites(g));
  m.wr(0xc089, 0x08);
  m.wr(0xc08d, 0x08);
  yield* farcall(g, 0x0b, () => frameTiles(g));
}

/** 01:547A — the leader's C250, C2F0, C2E0 kept at C7CD-C7CF. */
function leaderKeep(m: Memory): void {
  m.wr(0xc7cd, m.rd(0xc250));
  m.wr(0xc7ce, m.rd(0xc2f0));
  m.wr(0xc7cf, m.rd(0xc2e0));
}

/** 09:40AD — the menu opened: the screen (09:40D3), the temporary items back (0B:6683), CD15 = 0,
 *  CD42 = 1, CD16 = 0C, the status words (09:457D), CA16 = FF, the menu drawn (09:427E), C7CC =
 *  the music FFBA, the leader kept (01:547A), fade in (00:3A0C). */
function* menuOpen(g: Game): Co {
  const m = g.m;
  yield* farcall(g, 0x09, () => menuScreen(g));
  farSync(g, 0x0b, () => wornOutBack(g));
  yield* g.point(0x0940b1); // after the screen's tile work (CPU time): a frame work before it sees CD42 0
  m.wr(0xcd15, 0);
  m.wr(0xcd42, 1);
  m.wr(0xcd16, 0x0c);
  statusWords(g);
  m.wr(0xca16, 0xff);
  yield* menuRedraw(g);
  m.wr(0xc7cc, m.hram[0x3a]!);
  farSync(g, 0x01, () => leaderKeep(m));
  yield* fadeIn(g);
}

// ---------------------------------------------------------------- the close (00:0150 and its tiles)

/** 00:0150 — the map's tiles reloaded in the VRAM bracket (00:1D9E, 00:0427, 00:1DFD). */
function* reloadTiles(g: Game): Co {
  yield* bracketEnter(g);
  yield* loadTiles(g);
  yield* bracketLeave(g);
}

/** 01:7E49 — the tiles reloaded (00:0150), the objects drawn (00:01A0). */
function* fieldRestore(g: Game): Co {
  yield* reloadTiles(g);
  drawObjects(g);
}

/** 01:7023 — the menu screen closed: CD42 = 0, fade out (00:39F3), objects hidden (00:20CF),
 *  window off (00:3A4B), the bracket left (00:1DF3), WY 50, the field restored (01:7E49), fade in
 *  (00:3A0C). */
export function* menuClose(g: Game): Co {
  const m = g.m;
  m.wr(0xcd42, 0);
  yield* fadeOut(g);
  oamClear(g);
  windowOff(m);
  yield* textEnd(g);
  m.wr(0xff4a, 0x50);
  yield* farcall(g, 0x01, () => fieldRestore(g));
  yield* fadeIn(g);
}

/** 09:408F — the menu left: 01:7023; then a CA16 of 30-FE (CA16 + 1 >= 31): CA16 = FF and the
 *  text CDE6/CDE7 (bank 0A, mode CD34, box (1,1) 18 x 6); else CA16 is left for 01:402D. */
function* menuLeave(g: Game): Co {
  const m = g.m;
  yield* farcall(g, 0x01, () => menuClose(g));
  const a = (m.rd(0xca16) + 1) & 0xff;
  if (a < 0x31) return;
  m.wr(0xca16, 0xff);
  const hl = m.rd16(0xcde6);
  const mode = m.rd(0xcd34);
  yield* far0(g, 0x0a, () => printText(g, mode, hl, 0x0101, 0x0612));
}

// ---------------------------------------------------------------- the menu input (09:400F)

/** 09:4085 — the column CD16 is 0: the handler returns at once (`pop af; ret`). */
const columnNone = (m: Memory): boolean => !m.rd(0xcd16);

/** 09:401F — A: (CD16 0: nothing) CD36 = 0; the item CD15 (09:4034: 4350, 435E, 4A4A, 4377, 439F,
 *  43B1, 43F0), returning through a frame (00:358B) and the redraw (09:427E). */
function* menuA(g: Game): Co {
  const m = g.m;
  if (columnNone(m)) return;
  m.wr(0xcd36, 0);
  const items = [0x4350, 0x435e, 0x4a4a, 0x4377, 0x439f, 0x43b1, 0x43f0];
  const k = m.rd(0xcd15);
  const at = items[k];
  if (at === undefined) throw new NotPorted(`09:4031 (menu item ${k}: past the table)`);
  if (k === 0) yield* menuItem0(g);
  else if (k === 1) yield* menuItem1(g);
  else if (k === 2) yield* menuItem2(g);
  else if (k === 3) yield* menuItem3(g);
  else if (k === 4) yield* menuItem4(g);
  else if (k === 5) yield* menuItem5(g);
  else if (k === 6) yield* menuItem6(g);
  else throw new NotPorted(`09:${at.toString(16).toUpperCase()} (menu item ${k})`);
  // the return addresses pushed by 09:401F: a frame (00:358B), then the menu redrawn (09:427E)
  yield* wait1(g);
  yield* menuRedraw(g);
}

/** 09:4056 — Right: (CD16 0: nothing) CD16 C -> 0, else -> C; redrawn (09:427E). */
function* menuRight(g: Game): Co {
  const m = g.m;
  if (columnNone(m)) return;
  m.wr(0xcd16, m.rd(0xcd16) !== 0x0c ? 0x0c : 0x00);
  yield* menuRedraw(g);
}

/** 09:4042 — Left: CD16 3: the buzzer (00:1E83); else 0 -> C, C -> 3; redrawn (09:427E). */
function* menuLeft(g: Game): Co {
  const m = g.m;
  const a = m.rd(0xcd16);
  if (a === 0x03) { yield* soundBuzz(g); return; }
  m.wr(0xcd16, a ? 0x03 : 0x0c);
  yield* menuRedraw(g);
}

/** 09:4062 — Up: (CD16 0: nothing) CD15 - 1, 0 -> 6; the cursor (09:4264). */
function menuUp(m: Memory): void {
  if (columnNone(m)) return;
  const a = m.rd(0xcd15);
  m.wr(0xcd15, a ? a - 1 : 0x06);
  cursorPlace(m);
}

/** 09:4074 — Down: (CD16 0: nothing) CD15 + 1, 6 -> 0; the cursor (09:4264). */
function menuDown(m: Memory): void {
  if (columnNone(m)) return;
  const a = m.rd(0xcd15);
  m.wr(0xcd15, a === 0x06 ? 0 : a + 1);
  cursorPlace(m);
}

/** The SP at 09:4003 when the menu comes from the field (00:0846): the field loop runs at the
 *  start SP CFFF (00:0204, 00:0265 is reached by falls and jumps only); `call $07BB` -> CFFD; the
 *  `rst $18` -> CFFB; the far-call trampoline 00:378A leaves its return 37FE and the caller's
 *  return 0848 on the stack: CFF9 at 09:4000 (and again at 09:4003 after `call $40AD`).
 *  `ld hl,sp+r8` has r8 = 0 (the disassembly's label 09:4005 "from 09:4003" is 4005 + r8). */
const MENU_SP = 0xcff9;

/** 09:4000 — the field menu: opened (09:40AD), the SP kept at CD43/CD44 (for the jump back to
 *  09:408F, 09:4DBF), then the menu input (00:1E51) with the handlers 09:400F: A 09:401F, B
 *  09:408D (the menu left, 09:408F), Select / Start the buzzer (00:1E83), Right 09:4056, Left
 *  09:4042, Up 09:4062, Down 09:4074. Runs with bank 09 selected. */
export function* startMenu(g: Game): Co {
  const m = g.m;
  yield* menuOpen(g);
  m.wr(0xcd43, MENU_SP & 0xff);
  m.wr(0xcd44, MENU_SP >> 8);
  try {
    yield* menuInput(g, function* (i) {
      switch (i) {
        case 0: yield* menuA(g); return false;
        case 1: yield* menuLeave(g); return true; // 09:408D: pop hl; pop hl (the menu left)
        case 4: yield* menuRight(g); return false;
        case 5: yield* menuLeft(g); return false;
        case 6: menuUp(m); return false;
        case 7: menuDown(m); return false;
        default: yield* soundBuzz(g); return false; // 2, 3: 00:1E83
      }
    });
  } catch (e) {
    if (!(e instanceof MenuExit)) throw e;
    yield* menuLeave(g); // 09:4DBF: SP = CD43/CD44, jp 09:408F
  }
}

/** 01:402D — after the menu, the action an item left in CA16: 21 (01:4049), 20 (01:40DD), 1B or
 *  2C (01:41D6), 25 (01:4233); else nothing (CA16 = FF after a plain close). */
export function* menuAction(g: Game): Co {
  const a = g.m.rd(0xca16);
  if (a === 0x21) yield* afterCallVehicle(g);
  else if (a === 0x20) yield* afterStepAhead(g);
  else if (a === 0x1b || a === 0x2c) yield* afterWarpBack(g);
  else if (a === 0x25) yield* afterToggle0A(g);
}

/** 00:0846 — Start in the field (bank 01 selected): the menu (`rst $18 ; farcall 09:4000`), then
 *  `call $402D` (01:402D, bank 01 back). */
export function* fieldMenu(g: Game): Co {
  yield* farcall(g, 0x09, () => startMenu(g));
  yield* menuAction(g);
}

// ---------------------------------------------------------------- the frame tiles' animation (STAT work)

/** 0B:7D16 — 8 rows (2 bytes each) of the tile at hl: where the mask byte (0B table at de, one
 *  per row) has a 0 bit and the pixel is colour 3 (both planes set), the high plane's bit is
 *  cleared (colour 1); both bytes written back (each row after an hblank poll 0B:7D9D: no time). */
function frameTileMask(m: Memory, hl: number, de: number): void {
  for (let b = 0; b < 8; b++) {
    const c = m.rd((de + b) & 0xffff);
    const e = m.rd(hl);
    const d = m.rd((hl + 1) & 0xffff);
    const nd = d & (c | ~e) & 0xff;
    m.wr(hl, e);
    m.wr((hl + 1) & 0xffff, nd);
    hl = (hl + 2) & 0xffff;
  }
}

/** 0B:7D49 — the 16 bytes 90C0-90CF and 90D0-90DF rotated left together as 16-bit pairs (90D0 +
 *  i takes bit 7 of 90C0 + i, 90C0 + i takes bit 7 of the old 90D0 + i; hblank polls: no time). */
function frameTilesRotate(m: Memory): void {
  for (let i = 0; i < 0x10; i++) {
    const c1 = m.rd(0x90c0 + i) >> 7;
    const v = m.rd(0x90d0 + i);
    m.wr(0x90d0 + i, ((v << 1) | c1) & 0xff);
    const c2 = v >> 7;
    const w = m.rd(0x90c0 + i);
    m.wr(0x90c0 + i, ((w << 1) | c2) & 0xff);
  }
}

/** 0B:7CDD — the menu frame tiles' animation (from the STAT frame work 00:1ED7 with CD42 set,
 *  bank 0B selected, interrupts off) by the frame counter FF93: & 7 = 0: composed again
 *  (0B:7D60); 1: tiles 9C / 9D rotated (0B:7D49); 2 with FF93 & F0 = 0: masked (0B:7D16), FF93
 *  bit 3 clear: 9040 by 0B:7DAA and 9060 by 0B:7DBA, set: 9050 by 0B:7DB2 and 9070 by 0B:7DC2;
 *  else nothing. */
export function menuFrameWork(g: Game): void {
  const m = g.m;
  const f = m.hram[0x13]!;
  const a = f & 0x07;
  if (!a) { frameTilesCompose(g); return; }
  if (a < 0x02) { frameTilesRotate(m); return; }
  if (a !== 0x02) return;
  if (f & 0xf0) return;
  if (!(f & 0x08)) {
    frameTileMask(m, 0x9040, 0x7daa);
    frameTileMask(m, 0x9060, 0x7dba);
  } else {
    frameTileMask(m, 0x9050, 0x7db2);
    frameTileMask(m, 0x9070, 0x7dc2);
  }
}
