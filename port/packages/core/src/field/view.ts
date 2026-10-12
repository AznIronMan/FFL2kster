/** Field view: BG tilemap ring buffer (9800-9BFF), scrolling, water animation, palette fades and
 *  the per-frame field wait (bank 0, 00:1A97, 00:1FA4-2232, 00:2ECE-2F7F, 00:3E5B-3EDE). */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { vsync, dmaCurrent } from "../sys.js";
import { frameTick } from "../irq.js";
import { cellGet, displayMeta, offMap } from "./map.js";

// ---------------------------------------------------------------- frame

/** 00:1A97 — after a field frame wait: DMA the OAM page, apply SCX/SCY from the shadows
 *  FFC2/FFC1 (+ screen shake when C305 & F0 == 0x10, table 00:1927), advance C464. */
export function scrollApply(m: Memory): void {
  dmaCurrent(m);
  let p: number;
  if ((m.rd(0xc305) & 0xf0) === 0x10) {
    const k = (m.rd(0xc441) + 1) & 0xff;
    m.wr(0xc441, k);
    const t = 0x1927 + 2 * (k & 7);
    m.hram[0x43] = m.rd(t);
    m.hram[0x44] = m.rd(t + 1);
    p = t + 1;
  } else {
    m.hram[0x43] = 0;
    m.hram[0x44] = 0;
    p = 0x1928;
  }
  m.wr(0xff43, m.hram[0x42]! + m.rd(p));
  m.wr(0xff42, m.hram[0x41]! + m.rd(p - 1));
  m.wr(0xc464, (m.rd(0xc464) + 1) & 0x1f);
}

/** 00:2ECE — restore the default STAT handler (jp 16D9, LYC 0). */
export function restoreStat(m: Memory): void {
  m.wr(0xc706, 0xc3);
  m.wr(0xc707, m.rd(0x0013));
  m.wr(0xc708, m.rd(0x0014));
  m.io[0x45] = 0;
}

/** 00:2F7F — keep the STAT handler in line with the screen effect mode C305 & F0: mode 2
 *  installs the raster handler 2C95 and runs the frame tick by hand; otherwise the default. */
export function statVectorCheck(g: Game): void {
  const m = g.m;
  if ((m.rd(0xc305) & 0xf0) === 0x20) {
    if (m.rd(0xc707) !== 0x95) {
      m.wr(0xc464, 0);
      m.wr(0xc706, 0xc3); // 00:2EBC
      m.wr(0xc707, 0x95);
      m.wr(0xc708, 0x2c);
    }
    frameTick(g);
  } else if (m.rd(0xc707) !== m.rd(0x0013)) {
    m.wr(0xc464, 0);
    restoreStat(m);
  }
}

/** The field frame wait used everywhere in bank 0: 2F7F, rst $10, 1A97. */
export function* fieldFrame(g: Game): Co {
  statVectorCheck(g);
  yield* vsync(g);
  scrollApply(g.m);
}

// ---------------------------------------------------------------- tilemap

/** 00:2104 — one view row: 11 metatiles from (x, y) as 44 tile ids at C400. */
function buildRow(m: Memory, x: number, y: number): void {
  let p = 0xc400;
  for (let i = 0; i < 11; i++, x = (x + 1) & 0xff) {
    const v = offMap(x, y) ? 0 : cellGet(m, x, y);
    const t = (displayMeta(m, v) * 4) & 0xff;
    for (let k = 0; k < 4; k++) m.wr(p++, (t + k) & 0xff);
  }
}

/** 00:212C — one view column: 9 metatiles from (x, y) down, 36 tile ids at C400. */
function buildCol(m: Memory, x: number, y: number): void {
  let p = 0xc400;
  for (let i = 0; i < 9; i++, y = (y + 1) & 0xff) {
    const v = offMap(x, y) ? 0 : cellGet(m, x, y);
    const t = (displayMeta(m, v) * 4) & 0xff;
    for (let k = 0; k < 4; k++) m.wr(p++, (t + k) & 0xff);
  }
}

/** 00:2155 — after a field frame, write the C400 row to the BG map at hl (column wrap 32). */
function* writeRow(g: Game, hl: number): Co {
  yield* fieldFrame(g);
  const m = g.m;
  for (let e = 0; e < 0x2c; e += 4) {
    m.wr(hl, m.rd(0xc400 + e));
    m.wr(hl + 1, m.rd(0xc401 + e));
    const lo = hl & 0xff;
    const b = (hl & 0xff00) | ((lo | 0x20) & 0xff);
    m.wr(b, m.rd(0xc402 + e));
    m.wr(b + 1, m.rd(0xc403 + e));
    let l = (((lo | 0x20) + 1) & 0xff) & ~0x20; // res 5,l: back to the top row
    l = ((l + 1) & 0xff) & ~0x20; // inc l; res 5,l: next metatile, wrapping in 32 columns
    hl = (hl & 0xff00) | l;
  }
}

/** 00:2178 — after a field frame, write the C400 column to the BG map at hl (row wrap). */
function* writeCol(g: Game, hl: number): Co {
  yield* fieldFrame(g);
  const m = g.m;
  for (let c = 0; c < 0x24; c += 4) {
    m.wr(hl, m.rd(0xc400 + c));
    m.wr(hl + 1, m.rd(0xc401 + c));
    const b = (hl & 0xff00) | ((hl | 0x20) & 0xff);
    m.wr(b, m.rd(0xc402 + c));
    m.wr(b + 1, m.rd(0xc403 + c));
    hl = (b + 0x20) & 0xffff;
    hl = ((hl & 0xfbff) & 0xffff);
  }
}

const bgPtr = (m: Memory): number => m.rd(0xc449) | (m.rd(0xc44a) << 8);
function setBgPtr(m: Memory, hl: number): void {
  m.wr(0xc449, hl & 0xff);
  m.wr(0xc44a, hl >> 8);
}

/** 00:20DB — draw the whole 11x9 metatile view at the ring position C449 (9 field frames). */
export function* drawView(g: Game): Co {
  const m = g.m;
  let hl = bgPtr(m), y = m.rd(0xc42d);
  for (let r = 0; r < 9; r++) {
    buildRow(m, m.rd(0xc42c), y);
    yield* writeRow(g, hl);
    hl = ((hl + 0x40) & 0xffff) & 0xfbff;
    y = (y + 1) & 0xff;
  }
}

/** 00:20C8 — reset the ring to 9800, scroll shadows SCY 0 / SCX 8, draw the view. */
export function* resetView(g: Game): Co {
  const m = g.m;
  setBgPtr(m, 0x9800);
  m.hram[0x41] = 0;
  m.hram[0x42] = 8;
  yield* drawView(g);
}

// ---------------------------------------------------------------- scrolling

/** 00:1FEA — start a one-metatile scroll in direction d: move the camera cell, draw the new
 *  row/column (one field frame) and take the first scroll step (00:1FAB). */
export function* scrollStart(g: Game, d: number): Co {
  const m = g.m;
  let hl = bgPtr(m);
  let y = m.rd(0xc42d), x = m.rd(0xc42c);
  switch (d & 3) {
    case 0: { // 00:2033 down
      m.wr(0xc42d, y + 1);
      y = (y + 9) & 0xff;
      hl = ((hl + 0x240) & 0xffff) & 0xfbff;
      buildRow(m, x, y);
      yield* writeRow(g, hl);
      const lo = m.rd(0xc449) + 0x40;
      m.wr(0xc449, lo);
      m.wr(0xc44a, (m.rd(0xc44a) + (lo >> 8)) & 0xfb);
      break;
    }
    case 1: { // 00:200F up
      m.wr(0xc42d, y - 1);
      y = (y - 1) & 0xff;
      hl = (hl + 0xffc0) & 0xffff;
      hl = (((hl >> 8) & 0xfb) | 0x08) << 8 | (hl & 0xff);
      setBgPtr(m, hl);
      buildRow(m, x, y);
      yield* writeRow(g, hl);
      break;
    }
    case 2: { // 00:2062 left
      m.wr(0xc42c, x - 1);
      x = (x - 1) & 0xff;
      hl = (hl & 0xffe0) | ((hl - 2) & 0x1f);
      setBgPtr(m, hl);
      buildCol(m, x, y);
      yield* writeCol(g, hl);
      break;
    }
    default: { // 00:2089 right
      m.wr(0xc42c, x + 1);
      x = (x + 0x0b) & 0xff;
      const col = (hl & 0xffe0) | ((hl + 0x16) & 0x1f);
      buildCol(m, x, y);
      yield* writeCol(g, col);
      const p = bgPtr(m);
      setBgPtr(m, (p & 0xffe0) | ((p + 2) & 0x1f));
      break;
    }
  }
  scrollStep(g.m);
}

/** 00:1FAB — water animation, then move the scroll shadow by C43E in direction C43D; at a
 *  16-pixel boundary the scroll ends (C43D 0, speed back to C43F, walk frame reset). */
export function scrollStep(m: Memory): void {
  waterAnim(m);
  const b = m.rd(0xc43e);
  let a: number;
  switch (m.rd(0xc43d)) {
    case 1: a = (m.hram[0x41]! + b) & 0xff; m.hram[0x41] = a; break;
    case 2: a = (m.hram[0x41]! - b) & 0xff; m.hram[0x41] = a; break;
    case 3: a = (m.hram[0x42]! - b) & 0xff; m.hram[0x42] = a; a = (a + 8) & 0xff; break;
    default: a = (m.hram[0x42]! + b) & 0xff; m.hram[0x42] = a; a = (a + 8) & 0xff; break;
  }
  if (a & 0x0f) return;
  m.wr(0xc43d, 0);
  m.wr(0xc43e, m.rd(0xc43f));
  m.wr(0xc437, 0);
}

/** 00:1FA4 — one scroll frame. */
export function* scrollFrame(g: Game): Co {
  yield* fieldFrame(g);
  scrollStep(g.m);
}

/** 00:21EA / 00:21C2 — animate tiles 0x78-0x7F (9780-97FF): with C456 = 0, swap row pairs
 *  between tiles 78-7B and 7C-7F; else rotate the 16-pixel rows of 7C/7D and 7E/7F right by
 *  C456. One row per call (C439 steps 0-0E, 20-2E). */
export function waterAnim(m: Memory): void {
  const s = m.rd(0xc456);
  const ph = m.rd(0xc439);
  if (!s) {
    const swap = (a: number, b: number) => {
      const t = m.rd(a);
      m.wr(a, m.rd(b));
      m.wr(b, t);
    };
    const l = (ph + 0x80) & 0xff, e = l ^ 0x40;
    swap(0x9700 | l, 0x9700 | e);
    swap(0x9700 | ((l + 1) & 0xff), 0x9700 | ((e + 1) & 0xff));
    const l2 = ((l + 1) & 0xff) | 0x10, e2 = ((e + 1) & 0xff) | 0x10;
    swap(0x9700 | l2, 0x9700 | e2);
    swap(0x9700 | ((l2 - 1) & 0xff), 0x9700 | ((e2 - 1) & 0xff));
  } else {
    let l = (ph + 0xc0) & 0xff;
    for (let k = 0; k < 2; k++, l = (l + 1) & 0xff) {
      const lo = 0x9700 | l, hi = 0x9700 | (l | 0x10);
      let v = (m.rd(lo) << 8) | m.rd(hi);
      for (let i = 0; i < s; i++) v = ((v >> 1) | ((v & 1) << 15)) & 0xffff;
      m.wr(hi, v & 0xff);
      m.wr(lo, v >> 8);
    }
  }
  let c = (m.rd(0xc439) + 2) & 0xff;
  if (!(c & 0x0f)) c = (c + 0x10) & 0x20;
  m.wr(0xc439, c);
}

// ---------------------------------------------------------------- palettes

function setPalettes(m: Memory, v: number): void {
  m.wr(0xff47, v);
  m.wr(0xff48, v);
  m.wr(0xff49, v);
}

/** 00:3EA2 — fade in to D2 in three steps of 7 field frames. */
export function* fadeIn(g: Game): Co {
  const m = g.m;
  for (let d = 1; d < 4; d++) {
    let b = 0;
    for (let i = 0; i < 4; i++) b |= Math.min((0xd2 >> (2 * i)) & 3, d) << (2 * i);
    yield* fieldFrame(g);
    setPalettes(m, b);
    for (let k = 0; k < 6; k++) yield* fieldFrame(g);
  }
}

/** 00:3E5B — fade out: three steps lowering the shades equal to 3, 2, 1. */
export function* fadeOut(g: Game): Co {
  const m = g.m;
  for (let d = 3; d > 0; d--) {
    const c = m.rd(0xff47);
    let b = 0;
    for (let i = 0; i < 4; i++) {
      let a = (c >> (2 * i)) & 3;
      if (a === d) a--;
      b |= a << (2 * i);
    }
    yield* fieldFrame(g);
    setPalettes(m, b);
    for (let k = 0; k < 6; k++) yield* fieldFrame(g);
  }
}
