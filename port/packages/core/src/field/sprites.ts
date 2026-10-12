/** Field sprites: player and object (NPC/vehicle) composition into the two OAM shadow pages
 *  C000/C100 (alternated every 16 frames for the walk animation), object movement and the
 *  sprite tile pages (bank 0, 00:29E2-2ADE, 00:3249-3449, 00:344B-36D5). */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { rand } from "../rng.js";
import { cellAddr, cellGet, cellMark, resolveMeta, attrOf, offMap } from "./map.js";
import { fieldFrame, scrollApply } from "./view.js";
import { vsync, varGet } from "../sys.js";

/** Object slot i: C600 + 16i. +0 x (bit 7 = slot unused, bit 6 = fixed), +1 fine x, +2 y,
 *  +3 fine y, +4 steps left, +5 facing/direction (bits 4-5 facing, 6-7 move dir, 0-2 sprite
 *  set), +6 BG priority flags, +7 OAM offset, +8 tile offset, +9 message, +A kind, +B layer,
 *  +C flag/vehicle bit, +D flags. */
export const OBJ = 0xc600;

/** 00:2A5D — compose a 16x16 sprite (four 8x8 OAM entries) at hl (16-byte block, both
 *  pages) from the 32-byte record at de (bank 1): per entry [y0, y1, x1, x0, tile0, tile1,
 *  attr1, attr0] (suffix = page), plus (y, x). C43A bit 5/4 put the top/bottom half behind BG. */
export function composeSprite(m: Memory, hl: number, de: number, y: number, x: number): void {
  for (let i = 0; i < 16; i++) {
    m.wr(hl + i, 0);
    m.wr((hl | 0x100) + i, 0);
  }
  m.selectBank(0x01);
  const src = (o: number) => m.romAt(1, (de & 0xff00) | ((de + o) & 0xff));
  let o = 0, b = y, c = x;
  for (let s = 0; s < 4; s++) {
    const p0 = hl + 4 * s, p1 = p0 | 0x100;
    m.wr(p0, src(o) + b);
    m.wr(p1, src(o + 1) + b);
    m.wr(p1 + 1, src(o + 2) + c);
    m.wr(p0 + 1, src(o + 3) + c);
    m.wr(p0 + 2, src(o + 4));
    m.wr(p1 + 2, src(o + 5));
    m.wr(p1 + 3, src(o + 6));
    m.wr(p0 + 3, src(o + 7));
    o += 8;
    c = (c + 8) & 0xff;
    if (s & 1) {
      c = (c - 16) & 0xff;
      b = (b + 8) & 0xff;
    }
  }
  const f = m.rd(0xc43a);
  const behind = (a: number) => {
    m.wr(a, m.rd(a) | 0x80);
    m.wr(a | 0x100, m.rd(a | 0x100) | 0x80);
  };
  if (f & 0x20) { behind(hl + 3); behind(hl + 7); }
  if (f & 0x10) { behind(hl + 0x0b); behind(hl + 0x0f); }
}

/** 00:29E2 — draw the player facing a (0 down, 1 up, 2 left, 3 right) into OAM slots 0-3. */
export function drawPlayer(m: Memory, a: number): void {
  const c0 = ((a & 3) * 32) & 0xff;
  let e = (m.rd(0xc432) + c0) & 0xff, d = m.rd(0xc433);
  const kind = m.rd(0xc431);
  if (m.rd(0xc437) && kind !== 1 && kind < 3) {
    const hl = 0x4180 + (((kind >> 1) << 8) | ((kind & 1) << 7));
    e = ((hl & 0xff) + c0) & 0xff;
    d = hl >> 8;
  }
  const y = (m.rd(0xc42f) + 0x10) & 0xff, x = m.rd(0xc42e);
  m.wr(0xc43a, m.rd(0xc43b));
  if (m.rd(0xc45b)) {
    for (let i = 0; i < 16; i++) {
      m.wr(0xc000 + i, 0);
      m.wr(0xc100 + i, 0);
    }
    return;
  }
  composeSprite(m, 0xc000, (d << 8) | e, y, x);
  const add = ((m.rd(0xc430) << 4) | (m.rd(0xc430) >> 4)) & 0xff;
  for (let s = 0; s < 4; s++) {
    const p = 0xc002 + 4 * s;
    m.wr(p, m.rd(p) + add);
    m.wr(p | 0x100, m.rd(p | 0x100) + add);
  }
}

/** Sprite record address of an object (00:347F-3492): bank 1, 0x4000 + 0x80 * set + 0x20 * facing. */
function objectRecord(m: Memory, slot: number): number {
  const f = m.rd(slot + 5);
  return (0x4000 + ((f & 7) << 7)) + (((f & 0x30) * 2) & 0xff);
}

/** 00:344B — per frame: draw visible objects (OAM from C010 on), advance moving objects one
 *  pixel, keep map occupancy, count idle/unused objects in C440 (F0 + n; 0 = all idle), and
 *  offset the drawn sprites by the scroll in progress. */
export function updateObjects(m: Memory): void {
  m.wr(0xc440, 0xf0);
  m.wr(0xc47f, 0x10);
  const cy = m.rd(0xc42d), cx = m.rd(0xc42c);
  for (let s = OBJ; s < 0xc700; s += 0x10) {
    const x0 = m.rd(s);
    if (x0 & 0x80) {
      m.wr(0xc440, m.rd(0xc440) + 1);
      continue;
    }
    // draw
    const dx = ((x0 & 0x3f) - cx) & 0xff;
    const dy = (m.rd(s + 2) - cy) & 0xff;
    if (dx < 0x0b && dy < 0x09) {
      const c = ((((dx << 4) | (dx >> 4)) & 0xff) + m.rd(s + 1)) & 0xff;
      const b = ((((dy << 4) | (dy >> 4)) & 0xff) + 0x10 + m.rd(s + 3)) & 0xff;
      const de = objectRecord(m, s);
      m.wr(0xc43a, m.rd(s + 6));
      const oam = m.rd(0xc47f);
      m.wr(s + 7, oam);
      if (oam !== 0xa0) {
        composeSprite(m, 0xc000 | oam, de, b, c);
        m.wr(0xc47f, oam + 0x10);
        const t = m.rd(s + 8);
        for (let k = 0; k < 4; k++) {
          const p = 0xc000 | ((oam + 2 + 4 * k) & 0xff);
          m.wr(p, m.rd(p) + t);
          m.wr(p | 0x100, m.rd(p | 0x100) + t);
        }
      }
    }
    // move
    if (moveObject(m, s)) m.wr(0xc440, m.rd(0xc440) + 1);
  }
  // clear unused OAM entries
  for (let l = m.rd(0xc47f); l < 0xa0; l += 4) {
    m.wr(0xc000 | l, 0);
    m.wr(0xc100 | l, 0);
  }
  // follow the scroll in progress
  const dir = m.rd(0xc43d);
  if (!dir) return;
  const scy = m.hram[0x41]!, scx = m.hram[0x42]!;
  let c: number, start = 0xc010;
  if (dir === 1) c = -scy & 0x0f;
  else if (dir === 2) c = (-scy & 0x0f) | 0xf0;
  else if (dir === 3) { c = (-(scx + 8) & 0x0f) | 0xf0; start = 0xc011; }
  else { c = -(scx + 8) & 0x0f; start = 0xc011; }
  const end = m.rd(0xc47f);
  for (let l = start & 0xff; l < end; l += 4) {
    const p = 0xc000 | l;
    m.wr(p, m.rd(p) + c);
    m.wr(p | 0x100, m.rd(p | 0x100) + c);
  }
}

/** Movement part of 00:344B for slot s (00:34C7-35B7). Returns true when the object counts as
 *  idle (C440 += 1). */
function moveObject(m: Memory, s: number): boolean {
  const fx = m.rd(s + 1);
  if (fx) {
    if (fx & 0x0f) return stepFine(m, s + 1);
    return arrive(m, s, s + 1);
  }
  const fy = m.rd(s + 3);
  if (fy) {
    if (fy & 0x0f) return stepFine(m, s + 3);
    return arrive(m, s, s + 3);
  }
  // 00:34E0 — not moving: start a pending step, else mark the cell
  if (m.rd(s + 4)) {
    const dir = m.rd(s + 5) >> 6;
    m.wr(s + 1, [0, 0, 0xff, 1][dir]!);
    m.wr(s + 3, [1, 0xff, 0, 0][dir]!);
    return beginStep(m, s);
  }
  markHere(m, s);
  return true;
}

/** 00:34D4 — one pixel further: magnitude of the fine offset grows by 1. */
function stepFine(m: Memory, a: number): boolean {
  const v = m.rd(a);
  m.wr(a, v & 0x80 ? v - 1 : v + 1);
  return false;
}

/** 00:3506 — a 16-pixel fine offset completes the step: coordinate += sign, fine = +-1; then
 *  continue with the next step or stop and mark the cell. */
function arrive(m: Memory, s: number, fine: number): boolean {
  const v = m.rd(fine);
  const sgn = ((v << 24) >> 28) & 0xff; // sra x4
  m.wr(fine, sgn);
  const co = fine - 1;
  const old = m.rd(co);
  m.wr(co, (old & 0xc0) | ((sgn + old) & 0x3f));
  if (m.rd(s + 4)) return beginStep(m, s);
  m.wr(fine, 0);
  markHere(m, s);
  return true;
}

/** 00:3527 — mark the object's cell occupied. */
function markHere(m: Memory, s: number): void {
  cellMark(m, m.rd(s) & 0x3f, m.rd(s + 2), true);
}

/** 00:353A — begin a step: steps -= 1, move occupancy to the destination cell and take the
 *  destination's layer and BG priority. */
function beginStep(m: Memory, s: number): boolean {
  m.wr(s + 4, m.rd(s + 4) - 1);
  const x = m.rd(s) & 0x3f, y = m.rd(s + 2);
  cellMark(m, x, y, false);
  const ny = (m.rd(s + 3) + m.rd(s + 2)) & 0x3f;
  const nx = (m.rd(s + 1) + m.rd(s)) & 0x3f;
  const a = cellAddr(nx, ny);
  m.wr(a, m.rd(a) | 0x80);
  const meta = resolveMeta(m, m.rd(a));
  const attr = attrOf(m, meta);
  if (!(attr & 0x80) && !(attr & 0x04)) {
    let v = attr & 3;
    if (v) v ^= 3;
    m.wr(s + 0x0b, v);
  }
  const layer = m.rd(s + 0x0b);
  if ((m.rd(0xc43c) ^ (meta & 0x20)) !== 0) m.wr(s + 6, 0x30);
  else if (attr >= 0xc0) m.wr(s + 6, 0);
  else m.wr(s + 6, (attr & 0x04) && (layer & 1) ? 0x30 : attr & 0x30);
  return false;
}

/** 00:3249 — random NPC walk: with chance 1/4 per frame pick a slot (stream 0) and a
 *  direction (stream 0x20 + slot) and start a one-cell step if the target is free and walkable. */
export function npcWander(m: Memory): void {
  if (rand(m, 1, 0, 3)) return;
  const b = rand(m, 0, 0, 0x0f);
  const s = OBJ + 16 * b;
  const x0 = m.rd(s);
  if (x0 & 0xc0) return;
  const dir = rand(m, (0x20 + b) & 0xff, 0, 3) & 3;
  m.wr(0xc47e, dir);
  const c = ([0, 0, 0xff, 1][dir]! + x0) & 0xff;
  if (m.rd(s + 1)) return;
  const by = ([1, 0xff, 0, 0][dir]! + m.rd(s + 2)) & 0xff;
  if (offMap(c, by)) return;
  if (m.rd(s + 3) || m.rd(s + 4)) return;
  const cell = cellGet(m, c, by);
  if (cell & 0x80) return;
  const meta = resolveMeta(m, cell);
  const attr = attrOf(m, meta);
  if (attr & 0x80) return;
  if (m.rd(s + 0x0b) & attr) return;
  if (!(attr & 0x04)) {
    let v = attr & 3;
    if (v) {
      if (v === 3) return;
      v ^= 3;
    }
    m.wr(s + 0x0b, v);
  }
  m.wr(s + 4, 1);
  const f = m.rd(s + 5);
  const d5 = (dir << 2) | dir;
  m.wr(s + 5, ((((d5 << 4) | (d5 >> 4)) & 0xff) | (f & 0x0f)) & 0xff);
}

/** 00:3183 — object occupying cell (x, y) (moving objects count at their next cell);
 *  returns the slot address or 0. */
export function objectAt(m: Memory, x: number, y: number): number {
  for (let s = OBJ; s < 0xc700; s += 0x10) {
    let c = m.rd(s);
    if (c & 0x80) continue;
    c &= 0x3f;
    const fx = m.rd(s + 1);
    if (fx) c = fx < 0x80 ? c + 1 : c - 1;
    if ((c & 0x3f) !== x) continue;
    let b = m.rd(s + 2);
    const fy = m.rd(s + 3);
    if (fy) b = fy < 0x80 ? b + 1 : b - 1;
    if ((b & 0xff) === y) return s;
  }
  return 0;
}

/** 00:32D8 — re-mark object cells (idle objects) and refresh each object's BG priority and
 *  layer from the cell it stands on. */
export function refreshObjects(m: Memory): void {
  for (let s = OBJ; s < 0xc700; s += 0x10) {
    const x0 = m.rd(s);
    if (x0 & 0x80) continue;
    const c = x0 & 0x3f, b = m.rd(s + 2);
    const moving = m.rd(s + 1) | m.rd(s + 3);
    const a = cellAddr(c, b);
    let e = m.rd(a);
    if (!moving) {
      e |= 0x80;
      m.wr(a, e);
    }
    const meta = resolveMeta(m, e);
    const attr = attrOf(m, meta);
    if ((m.rd(0xc43c) ^ (meta & 0x20)) === 0) {
      if (attr >= 0xc0) continue;
      m.wr(s + 6, attr & 0x30);
    } else m.wr(s + 6, 0x30);
    if (attr >= 0x80 || attr & 0x04) continue;
    let v = attr & 3;
    if (v) v ^= 3;
    m.wr(s + 0x0b, v);
  }
}

/** 00:362A — clear OAM shadow entries 4-39 on both pages. */
export function clearObjectSprites(m: Memory): void {
  for (let l = 0x10; l < 0xa0; l += 4) {
    m.wr(0xc000 | l, 0);
    m.wr(0xc100 | l, 0);
  }
}

/** 00:367B — redraw one object (slot base s) immediately, then a field frame. */
export function* redrawObject(g: Game, s: number): Co {
  const m = g.m;
  const cy = m.rd(0xc42d), cx = m.rd(0xc42c);
  const c = ((((m.rd(s) & 0x3f) - cx) & 0xff) << 4) & 0xff;
  const b = (((((m.rd(s + 2) - cy) & 0xff) << 4) & 0xff) + 0x10) & 0xff;
  const de = objectRecord(m, s);
  m.wr(0xc43a, m.rd(s + 6));
  const oam = m.rd(s + 7);
  if (oam === 0xa0) return;
  composeSprite(m, 0xc000 | oam, de, b, c);
  const t = m.rd(s + 8);
  for (let k = 0; k < 4; k++) {
    const p = 0xc000 | ((oam + 2 + 4 * k) & 0xff);
    m.wr(p, m.rd(p) + t);
    m.wr(p | 0x100, m.rd(p | 0x100) + t);
  }
  yield* fieldFrame(g);
}

// ---------------------------------------------------------------- sprite tiles

/** 00:1674 + copy + 00:1691: VRAM copy with a frame wait before and after (2 frames). */
export function* vramCopy(g: Game, bank: number, src: number, dst: number, n: number): Co {
  const m = g.m;
  yield* vramBegin(g);
  for (let i = 0; i < n; i++) m.wr(dst + i, m.romAt(bank, src + i));
  yield* vramEnd(g);
}

/** 00:1674 — wait a frame, then route STAT to 00:16A8 (VRAM access pacing), saving the vector. */
export function* vramBegin(g: Game): Co {
  const m = g.m;
  yield* vsync(g);
  for (let i = 0; i < 3; i++) m.wr(0xc7d3 + i, m.rd(0xc706 + i));
  m.wr(0xc706, 0xc3);
  m.wr(0xc707, 0xa8);
  m.wr(0xc708, 0x16);
}

/** 00:1691 — wait a frame, then restore the STAT vector. */
export function* vramEnd(g: Game): Co {
  const m = g.m;
  yield* vsync(g);
  for (let i = 0; i < 3; i++) m.wr(0xc706 + i, m.rd(0xc7d3 + i));
}

/** 00:1B99 — member a's field at base l: slot from the formation C2A0, a = 4 → guest (+0x80). */
export function memberField(m: Memory, a: number, hl: number): number {
  if (a === 4) return (hl & 0xff00) | ((hl + 0x80) & 0xff);
  const slot = (m.rd(0xc2a0) >> (2 * a)) & 3;
  return (hl & 0xff00) | ((hl + ((slot << 5) & 0xff)) & 0xff);
}

/** Party leader: first member (in order 0-4) without bit 4 of C206 (dead/absent); returns the
 *  address of its class byte (C204 + slot). */
function leaderClassAddr(m: Memory): number {
  for (let a = 0; ; a++) {
    const hl = memberField(m, a, 0xc206);
    if (!(m.rd(hl) & 0x10)) return hl - 2;
  }
}

/** 00:1F23 — load the leader's field sprite tiles (bank 3 page 0D:6B70[class]) to 8000. */
export function* loadPlayerTiles(g: Game): Co {
  const m = g.m;
  const c = m.rd(leaderClassAddr(m));
  m.selectBank(0x0d);
  const page = (m.romAt(0x0d, 0x6b70 + c) + 0x40) & 0xff;
  m.selectBank(0x03);
  yield* vramCopy(g, 0x03, page << 8, 0x8000, 0x100);
}

/** 00:1EC2 — player sprite record source: riding (var 1F) → 4080 kind 1; else the leader's
 *  class → 01:4300 index → kind C431 and record 4000 + 0x80 * kind (bank 1). */
export function playerSpriteSource(m: Memory): void {
  if (varGet(m, 0x1f)) { // vehicle being ridden (var 0x1F = low nibble of C305)
    m.wr(0xc431, 1);
    m.wr(0xc432, 0x80);
    m.wr(0xc433, 0x40);
    return;
  }
  const c = m.rd(leaderClassAddr(m));
  m.selectBank(0x0d);
  const i = m.romAt(0x0d, 0x6b70 + c);
  m.selectBank(0x01);
  const k = m.romAt(0x01, 0x4300 + i);
  m.wr(0xc431, k);
  const hl = 0x4000 + (((k >> 1) << 8) | ((k & 1) << 7));
  m.wr(0xc432, hl & 0xff);
  m.wr(0xc433, hl >> 8);
}

/** 00:363F — load up to six NPC sprite pages listed after the header triggers (C459) to
 *  8100-86FF (bit 7 = bank 4 page, else bank 3). Returns the list end pointer. */
export function* loadObjectTiles(g: Game): Co<number> {
  const m = g.m;
  let hl = m.rd(0xc459) | (m.rd(0xc45a) << 8);
  let d = 0x81;
  for (;;) {
    m.selectBank(0x07);
    if (d === 0x87) break;
    const a = m.romAt(0x07, hl++);
    if (a === 0xff) break;
    let bank = 0x03, page = (a + 0x40) & 0xff;
    if (page & 0x80) {
      page = (page & 0x7f) | 0x40;
      bank = 0x04;
    }
    m.selectBank(bank);
    yield* vramCopy(g, bank, page << 8, d << 8, 0x100);
    d++;
  }
  return hl;
}

/** Field frame helper re-exported for callers composing sprites. */
export { fieldFrame, scrollApply };
