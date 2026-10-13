/** Legend III text window: the frame (0F:78BA), the slide open / closed (00:35AF / 00:35D2: a
 *  STAT raster 00:3631 at LYC moving by 2 lines a frame, with the field's frame work 00:3575 and
 *  an extra sound tick each frame), and the field frame work itself (00:3575: map animation
 *  01:54A0, objects 00:01A0, scroll, shake, objects below the window hidden). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, farSync, textBegin, textEnd, windowOn, windowOff, wait1, vramCopy, fill } from "./sys.js";
import { NotPorted, scroll, shake } from "./irq.js";
import { drawObjects } from "./actors.js";
import { oamHideBelow } from "./objects.js";
import { lineReset } from "./text.js";

// ---------------------------------------------------------------- the frame

/** 0F:792C — fill bc VRAM bytes at hl with a (paced like 00:20FF); returns hl after. */
function vramFill(m: Memory, hl: number, bc: number, a: number): number {
  return fill(m, hl, bc, a);
}

/** 0F:78BA — the box frame around the text box at CD04 (one row up, one column left): corners
 *  F7 F9 / F8 FA, edges FC (top, bottom) and FB (sides) around CD00 x CD0A blank tiles (FF). */
export function boxFrame(g: Game): void {
  const m = g.m;
  const w = m.rd(0xcd00);
  let hl = (m.rd16(0xcd04) - 0x21) & 0xffff;
  const row = (l: number, mid: number, r: number) => {
    hl = vramFill(m, hl, 1, l);
    hl = vramFill(m, hl, w, mid);
    hl = vramFill(m, hl, 1, r);
  };
  const next = () => { hl = (hl + ((0x1e - w) & 0xff)) & 0xffff; };
  row(0xf7, 0xfc, 0xf9);
  next();
  for (let b = m.rd(0xcd0a); b; b--) { row(0xfb, 0xff, 0xfb); next(); }
  row(0xf8, 0xfc, 0xfa);
}

// ---------------------------------------------------------------- the field frame work

/** 01:5993 — map mode 22: every 32 frames the water tiles 9620/9660 and 9720/9760 swap
 *  (through C800). */
function animWater(m: Memory): void {
  if (m.hram[0x13]! & 0x1f) return;
  for (const [a, b] of [[0x9620, 0x9660], [0x9720, 0x9760]] as const) {
    vramCopy(m, a, 0xc800, 0x20);
    vramCopy(m, b, a, 0x20);
    vramCopy(m, 0xc800, b, 0x20);
  }
}

/** 01:5730 — a 2-tile strip (hl, hl + 16) scrolled right by a pixel (each plane byte pair
 *  rotated through), at FF93 & 0F = 6 (hl) or 0E (hl + 100); C800 counts the 16 bytes. The
 *  original polls hblank per byte and ends with reti (interrupts on). */
function stripScroll(g: Game, hl: number): void {
  const m = g.m;
  const f = m.hram[0x13]! & 0x0f;
  if (f === 0x0e) hl += 0x100;
  else if (f !== 0x06) { g.ime = true; return; }
  for (let k = 0; k < 0x10; k++) {
    m.wr(0xc800, k);
    const p = hl + k;
    let b = m.rd(p), c = m.rd(p + 0x10);
    const c0 = c & 1;
    const b0 = b & 1;
    b = ((b >> 1) | (c0 << 7)) & 0xff;
    c = ((c >> 1) | (b0 << 7)) & 0xff;
    m.wr(p + 0x10, c);
    m.wr(p, b);
  }
  m.wr(0xc800, 0x10);
  g.ime = true;
}

/** 01:57A9 — the tile at hl rolled down a pixel row (its 16 bytes rotated by 2 through
 *  C800-C810). */
function tileRollDown(m: Memory, hl: number): void {
  vramCopy(m, hl, 0xc800, 0x10);
  for (let b = 0; b < 2; b++) {
    for (let p = 0xc80f; p >= 0xc800; p--) m.wr(p + 1, m.rd(p));
    m.wr(0xc800, m.rd(0xc810));
  }
  vramCopy(m, 0xc800, hl, 0x10);
}

/** 01:5814 — map mode 23: the strip 9080 / 9180 (01:56E4), and every 4 frames the tiles 9600
 *  and 9610 rolled down (a waterfall). */
function animFalls(g: Game): void {
  const m = g.m;
  stripScroll(g, 0x9080);
  if (m.hram[0x13]! & 0x03) return;
  tileRollDown(m, 0x9600);
  tileRollDown(m, 0x9610);
}

/** 01:54A0 — the map mode's tile animation (CA18; once: CA6F). */
function mapAnimation(g: Game): void {
  const m = g.m;
  if (m.rd(0xca6f)) return;
  m.wr(0xca6f, 1);
  const mode = m.rd(0xca18);
  if (mode === 0x22) animWater(m);
  else if (mode === 0x23) animFalls(g);
  else if (mode !== 0x00 && mode !== 0x0c) throw new NotPorted(`01:54A0 map animation mode ${mode.toString(16)}`);
  m.wr(0xca6f, 0);
}

/** 00:3575 — the field frame work (bank 01 selected by the caller). */
export function fieldWork(g: Game): void {
  const m = g.m;
  mapAnimation(g);
  drawObjects(g);
  scroll(m);
  shake(m);
  if (m.rd(0xff40) & 0x20) oamHideBelow(m, 0x60);
}

/** 00:3557's field branch: bank 01, 00:3575, bank back. */
export function fieldWorkBanked(g: Game): void {
  pushBank(g, 0x01);
  fieldWork(g);
  popBank(g);
}

// ---------------------------------------------------------------- the slide

/** 00:3631 — the slide's STAT handler at LYC: through the next four hblanks BGP = FF, 00, FF,
 *  then CDB4 (a bar), and the window on (WX 7) above line 70 or off (WX A5) below it; LYC moves
 *  to the mirror line DC - LYC (the box's bottom edge, then back). */
export function slideRaster(g: Game): void {
  const m = g.m;
  g.later(1, () => m.wr(0xff47, 0xff));
  g.later(2, () => m.wr(0xff47, (m.rd(0xff47) + 1) & 0xff));
  g.later(3, () => m.wr(0xff47, (m.rd(0xff47) - 1) & 0xff));
  g.later(4, () => {
    m.wr(0xff47, m.rd(0xcdb4));
    const l = m.rd(0xff45);
    if (l < 0x70) {
      m.wr(0xff4b, 0x07);
      m.wr(0xff45, (l + 2 * ((0x6e - l) & 0xff)) & 0xff);
    } else {
      m.wr(0xff4b, 0xa5);
      m.wr(0xff45, (l - 2 * ((l - 0x6e) & 0xff)) & 0xff);
    }
  });
}

/** 00:35F0 — the slide set-up: CD3D + 1 and the bracket (00:1D98), STAT -> 00:3631, WY = LYC = 50,
 *  bank 01, window on. */
function* slideBegin(g: Game): Co {
  const m = g.m;
  yield* textBegin(g);
  g.ime = false;
  m.wr(0xc0bd, 0x31);
  m.wr(0xc0be, 0x36);
  m.wr(0xff4a, 0x50);
  m.wr(0xff45, 0x50);
  yield* g.reti();
  pushBank(g, 0x01);
  windowOn(m);
}

/** 00:361F — one frame of the slide: LYC = a, a sound tick (0F:4006), the field frame work, a
 *  frame. */
function* slideFrame(g: Game, a: number): Co {
  const m = g.m;
  m.wr(0xff45, a);
  pushBank(g, 0x0f);
  g.hooks.soundTick?.(g);
  popBank(g);
  fieldWork(g);
  yield* wait1(g);
}

/** 00:3609 — the slide's end: WX 7, LYC 3, STAT -> 00:1F27, bank back, 00:1DF3. */
function* slideEnd(g: Game): Co {
  const m = g.m;
  g.ime = false;
  m.wr(0xff4b, 0x07);
  m.wr(0xff45, 0x03);
  m.wr(0xc0bd, 0x27);
  m.wr(0xc0be, 0x1f);
  yield* g.reti();
  popBank(g);
  yield* textEnd(g);
}

/** 00:35AF — open the text window: already on, 0B:6D0E (WY 50, WX 7, on); else WX = A5 and the
 *  slide up from line 6B to 51. */
export function* windowOpen(g: Game): Co {
  const m = g.m;
  if (m.rd(0xff40) & 0x20) {
    farSync(g, 0x0b, () => { m.wr(0xff4a, 0x50); m.wr(0xff4b, 0x07); windowOn(m); });
    return;
  }
  m.wr(0xff4b, 0xa5);
  yield* slideBegin(g);
  m.wr(0xcdc6, 0x6b);
  m.wr(0xff45, 0x6b);
  let a = 0x6b;
  for (;;) {
    yield* slideFrame(g, a);
    m.wr(0xcdc6, m.rd(0xcdc6) - 2);
    a = m.rd(0xcdc6);
    if (a < 0x51) break;
  }
  yield* slideEnd(g);
}

/** 00:35D2 — close the text window (when on): the slide down from line 51 to 6B, window off. */
export function* windowClose(g: Game): Co {
  const m = g.m;
  if (!(m.rd(0xff40) & 0x20)) return;
  yield* slideBegin(g);
  m.wr(0xcdc6, 0x51);
  m.wr(0xff45, 0x51);
  let a = 0x51;
  for (;;) {
    yield* slideFrame(g, a);
    m.wr(0xcdc6, m.rd(0xcdc6) + 2);
    a = m.rd(0xcdc6);
    if (a >= 0x6b) break;
  }
  windowOff(m);
  yield* slideEnd(g);
}

/** 00:27AB — text code 14: close the window if it is on, else frame it (00:2745) and open it. */
export function* windowToggle(g: Game): Co {
  const m = g.m;
  if (m.rd(0xff40) & 0x20) { yield* windowClose(g); return; }
  lineReset(m);
  pushBank(g, 0x0f);
  boxFrame(g);
  popBank(g);
  yield* windowOpen(g);
}
