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

/** The frame counter FF93. */
function frame(m: Memory): number {
  return m.hram[0x13]!;
}

/** 01:6101 / 01:015F / 01:6107 (n = 32) and 01:60F5 / 00:0159 / 01:60FB (n = 16) — the tiles at
 *  a and b swapped through C800. */
function tileSwap(m: Memory, a: number, b: number, n: number): void {
  vramCopy(m, a, 0xc800, n);
  vramCopy(m, b, a, n);
  vramCopy(m, 0xc800, b, n);
}

/** 01:5730 — a 2-tile strip (hl, hl + 16) scrolled right by a pixel (each plane byte pair
 *  rotated through), at FF93 & 0F = 6 (hl) or 0E (hl + 100; not for 01:5723, `once`); C800
 *  counts the 16 bytes. The original polls hblank per byte and ends with reti (interrupts on). */
function stripScroll(g: Game, hl: number, once = false): void {
  const m = g.m;
  const f = frame(m) & 0x0f;
  if (f === 0x0e && !once) hl += 0x100;
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

/** 01:57CE — the tile at hl rolled up a pixel row (copied to C801-C810, rotated by 2 through
 *  C800-C810, back from C801). */
function tileRollUp(m: Memory, hl: number): void {
  vramCopy(m, hl, 0xc801, 0x10);
  for (let b = 0; b < 2; b++) {
    for (let p = 0xc801; p <= 0xc810; p++) m.wr(p - 1, m.rd(p));
    m.wr(0xc810, m.rd(0xc800));
  }
  vramCopy(m, 0xc801, hl, 0x10);
}

/** 01:5847 (through C800) — the 16 bytes of the tile at hl each rotated right (rrc). */
function tileRotate(m: Memory, hl: number): void {
  vramCopy(m, hl, 0xc800, 0x10);
  for (let p = 0xc800; p < 0xc810; p++) { const v = m.rd(p); m.wr(p, ((v >> 1) | (v << 7)) & 0xff); }
  vramCopy(m, 0xc800, hl, 0x10);
}

/** 01:5836 — every 4 frames the tiles 9790 and 97A0 rolled down. */
function anim5836(m: Memory): void {
  if (frame(m) & 0x03) return;
  tileRollDown(m, 0x9790);
  tileRollDown(m, 0x97a0);
}

/** 01:5828 — at FF93 & 3 = 2 the tile 9190 rolled down, then 01:5836. */
function anim5828(m: Memory): void {
  if ((frame(m) & 0x03) === 2) tileRollDown(m, 0x9190);
  anim5836(m);
}

/** 01:578C / 01:5798 — at FF93 & 3 = 2 the tile up rolled up (01:57C7), at 0 the tile down rolled
 *  down (01:57A4). */
function rollPair(m: Memory, up: number, down: number): void {
  if ((frame(m) & 0x03) === 2) tileRollUp(m, up);
  if (!(frame(m) & 0x03)) tileRollDown(m, down);
}

/** 01:58A1 — every 16 frames the tiles 97B0 / 9690 and 96D0 / 9790 swapped (32 bytes). */
function anim58A1(m: Memory): void {
  if (frame(m) & 0x0f) return;
  tileSwap(m, 0x97b0, 0x9690, 0x20);
  tileSwap(m, 0x96d0, 0x9790, 0x20);
}

/** 01:5964 — every 16 frames the tiles 9220 / 9250 and 9320 / 9350 swapped (32 bytes). */
function anim5964(m: Memory): void {
  if (frame(m) & 0x0f) return;
  tileSwap(m, 0x9220, 0x9250, 0x20);
  tileSwap(m, 0x9320, 0x9350, 0x20);
}

/** 01:5601 — every 16 frames tiles 9060 and 9160 (32 bytes each) from one of four frames
 *  (FF93 bits 4-5): 9460 / 94A0 / 94C0 / 94E0 and 9560 / 95A0 / 95C0 / 95E0. */
function anim5601(m: Memory): void {
  if (frame(m) & 0x0f) return;
  const k = (frame(m) >> 4) & 3;
  const src = [0x9460, 0x94a0, 0x94c0, 0x94e0][k]!;
  vramCopy(m, src, 0x9060, 0x20);
  vramCopy(m, src + 0x100, 0x9160, 0x20);
}

/** 01:565F — every 16 frames tiles 96D0 and 97D0 (32 bytes each) from one of four frames: 90A0 /
 *  90C0 / 90E0 / 9440 and 91A0 / 91C0 / 91E0 / 9540; then 01:5836. */
function anim565F(m: Memory): void {
  if (!(frame(m) & 0x0f)) {
    const k = (frame(m) >> 4) & 3;
    const src = [0x90a0, 0x90c0, 0x90e0, 0x9440][k]!;
    vramCopy(m, src, 0x96d0, 0x20);
    vramCopy(m, src + 0x100, 0x97d0, 0x20);
  }
  anim5836(m);
}

/** 01:54A0 — the map mode's tile animation (CA18, the table at 01:54B4; once: CA6F). The strip
 *  scrolls (01:5730) end with reti; the others leave the interrupts as they are. */
export function mapAnimation(g: Game): void {
  const m = g.m;
  if (m.rd(0xca6f)) return;
  m.wr(0xca6f, 1);
  const mode = m.rd(0xca18);
  const f = frame(m);
  switch (mode) {
    case 0x00: case 0x0c: break; // 01:5500
    case 0x01: stripScroll(g, 0x9080); break; // 01:56E4
    case 0x02: stripScroll(g, 0x9600); break; // 01:571E
    case 0x03: stripScroll(g, 0x9680, true); break; // 01:5723
    case 0x04: stripScroll(g, 0x9200); break; // 01:56DF
    case 0x05: stripScroll(g, 0x9680); break; // 01:5719
    case 0x06: stripScroll(g, 0x9000); break; // 01:5714
    case 0x07: rollPair(m, 0x9020, 0x91b0); break; // 01:578C
    case 0x08: // 01:59C2
      stripScroll(g, 0x96c0);
      if ((f & 0x3f) === 0x20) tileSwap(m, 0x97e0, 0x96e0, 0x20);
      else if (!(f & 0x3f)) tileSwap(m, 0x97c0, 0x96c0, 0x20);
      break;
    case 0x09: stripScroll(g, 0x9400); break; // 01:56C8
    case 0x0a: stripScroll(g, 0x9080); stripScroll(g, 0x9400); break; // 01:56C5
    case 0x0b: if (!(f & 0x3f)) tileSwap(m, 0x97e0, 0x96e0, 0x20); break; // 01:59FE
    case 0x0d: // 01:57F2
      if ((f & 0x0f) === 0x08) tileRollUp(m, 0x9380);
      else if (!(f & 0x0f)) tileRotate(m, 0x9390);
      break;
    case 0x0e: // 01:56E9
      if (f & 0x0f) { stripScroll(g, 0x9000); break; }
      tileRotate(m, 0x9190);
      stripScroll(g, 0x9600); // 01:5701
      stripScroll(g, 0x9060);
      break;
    case 0x0f: case 0x15: case 0x1e: anim5601(m); break;
    case 0x10: anim5836(m); break;
    case 0x11: case 0x1d: anim5828(m); break;
    case 0x12: case 0x13: anim565F(m); break;
    case 0x14: // 01:586A
      if (!(f & 0x1f)) { tileSwap(m, 0x9440, 0x9460, 0x20); tileSwap(m, 0x9540, 0x9560, 0x20); }
      break;
    case 0x16: rollPair(m, 0x9220, 0x93b0); anim58A1(m); break; // 01:589E
    case 0x17: stripScroll(g, 0x9000); anim58A1(m); break; // 01:5899
    case 0x18: rollPair(m, 0x9220, 0x93b0); break; // 01:5798
    case 0x19: // 01:58D0
      if (!(f & 0x0f)) tileSwap(m, 0x90c0, 0x92a0, 0x10); // 01:594A
      anim5964(m);
      break;
    case 0x1a: // 01:58D6
      if (!(f & 0x0f)) tileSwap(m, 0x9500, 0x9510, 0x10);
      if (!(f & 0x1f)) {
        tileSwap(m, 0x92e0, 0x96c0, 0x10);
        tileSwap(m, 0x93e0, 0x96d0, 0x10);
        tileSwap(m, 0x93b0, 0x9640, 0x10);
        tileSwap(m, 0x93c0, 0x9750, 0x10);
      }
      break;
    case 0x1b: anim5964(m); break;
    case 0x1c: // 01:56CD
      if (!(f & 0x03)) { tileRollDown(m, 0x8600); tileRollDown(m, 0x8610); }
      stripScroll(g, 0x9200);
      break;
    case 0x1f: stripScroll(g, 0x9600); stripScroll(g, 0x9060); break; // 01:5701
    case 0x20: stripScroll(g, 0x9260); stripScroll(g, 0x9400); break; // 01:5709
    case 0x21: if (!(f & 0x0f)) tileSwap(m, 0x9660, 0x9760, 0x20); break; // 01:5850
    case 0x22: // 01:5993
      if (!(f & 0x1f)) { tileSwap(m, 0x9620, 0x9660, 0x20); tileSwap(m, 0x9720, 0x9760, 0x20); }
      break;
    case 0x23: // 01:5814
      stripScroll(g, 0x9080);
      if (!(f & 0x03)) { tileRollDown(m, 0x9600); tileRollDown(m, 0x9610); }
      break;
    default: throw new NotPorted(`01:54A0 map animation mode ${mode.toString(16)}`);
  }
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
 *  to the mirror line DC - LYC (the box's bottom edge, then back). Entered late (the interrupt
 *  taken once the line's hblank had begun, 00:366E then waits for the next), it all comes a line
 *  later (`Game.lateLines`). */
export function slideRaster(g: Game): void {
  const m = g.m;
  for (let k = 1; k <= 5; k++) if (g.ly + k < 144) g.lateLines.add(g.ly + k);
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
