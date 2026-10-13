/** Legend III battle formation layout and monster pictures (bank 0B, 0B:405A's steps):
 *  - 0B:5A18 lays out the three monster groups CC59-CC5B: picture size classes CC30-CC32, monsters
 *    per group CC33-CC35, picture shapes (width, height) CC3B-CC40, slot counts CC36-CC38, the
 *    slot list CC41.. (x, y per slot), the slot shapes CC51.. and the group masks CC5E-CC60;
 *  - 0B:40BF decompresses each group's picture (two bitplanes to D000 / D400), interleaves them
 *    into tiles from D800 and gives each slot its first tile (CC61..);
 *  - 0B:4205 writes each slot's tile map into the D000 screen buffer (filled with FF by 0B:405A).
 *  Callers run these with bank 0B selected (the tables 0B:4301, 0B:43C4, 0B:43CC, 0B:43E4 and
 *  0B:5BD8 are read from the current bank). */
import type { Game } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, fill, far0Sync, decompress } from "./sys.js";
import { multiply, divide, randomBelow } from "./math.js";

/** 0B:4301 — per monster id: picture byte (size class << 3 | picture index in its sheet). */
const PICTURE_TABLE = 0x4301;
/** 0B:43C4 — per size class (low nibble of 0B:43CC): tiles per picture. */
const TILES_TABLE = 0x43c4;
/** 0B:43CC — per size class: decompress bank (high nibble) | tile-count class (low nibble). */
const CLASS_TABLE = 0x43cc;
/** 0B:43E4 — per size class: 3 words (the sheet's plane 0 start, plane 1 start, end). */
const SHEET_TABLE = 0x43e4;
/** 0B:5BD8 — per size class + 1: the shape byte (width - 1) << 4 | (height - 1); FF = none. */
const SHAPE_TABLE = 0x5bd8;

/** The stack pointer inside 0B:5A18 (its return address pushed). 00:1C9C stores it - 8 in
 *  C0C1/C0C2. HYPOTHESIS / placeholder: the battle entry's call depth is not known from the
 *  disassembly here (bank 0D); set it from a trace (C0C1/C0C2 after 0B:5A18, + 8). */
export const FORMATION_LAYOUT_SP = 0xcfe0;

// ---------------------------------------------------------------- 0B:5A18 formation layout

/** 0B:5A18 — the formation layout (unless CEDA = FF: only the masks, 0B:5B76). CC30-CC58 cleared;
 *  CC30 + k = size class of group CC59 + k (0B:4301 >> 3 -> 0B:43CC low nibble) + 1 (0 when the
 *  group is FF); CC3B + 2k / CC3C + 2k = width / height of its shape (0B:5BD8). Monsters per group
 *  CC33-CC35: with FFCA bit 7, two bits each from CC5D (bits 5-4, 3-2, 1-0) + 1; otherwise CC33 =
 *  random 1..(CC5D >> 6) + 1, CC3A = what is left of the 20-tile row / width of group 2 (less 2
 *  for some size pairs), CC34 = random 1..r (r = random 0..CC3A; 0 when CC5A = FF or r = 0) and
 *  CC35 = r - CC34 (0 when CC5B = FF). CC39 = CC33, CC3A = CC34 + CC35. Then the slots: x from
 *  (20 - total width) / 2, per monster (x, 0) and for size classes 0-2 also (x, 4) (two rows,
 *  slot counts CC36-CC38 doubled), at CC41..; the slot shapes at CC51..; the masks. */
export function formationLayout(g: Game, sp: number = FORMATION_LAYOUT_SP): void {
  const m = g.m;
  if (((m.rd(0xceda) + 1) & 0xff) === 0) {
    groupMasks(m);
    return;
  }
  fill(m, 0xcc30, 0x29, 0x00); // 00:3934
  for (let k = 0; k < 3; k++) {
    let a = m.rd(0xcc59 + k);
    if (a !== 0xff) {
      a = (m.rd((PICTURE_TABLE + a) & 0xffff) & 0xf8) >> 3;
      a = m.rd((CLASS_TABLE + a) & 0xffff) & 0x0f;
    }
    m.wr(0xcc30 + k, (a + 1) & 0xff);
  }
  for (let k = 0; k < 3; k++) {
    const c = m.rd((SHAPE_TABLE + m.rd(0xcc30 + k)) & 0xffff);
    m.wr(0xcc3b + 2 * k, ((c >> 4) + 1) & 0xff);
    m.wr(0xcc3c + 2 * k, ((c & 0x0f) + 1) & 0xff);
  }
  const counts = m.rd(0xcc5d);
  if (m.hram[0x4a]! & 0x80) {
    // FFCA bit 7: fixed counts from CC5D
    let b = counts & 0x3f;
    for (let k = 0; k < 3; k++) {
      const a = m.rd(0xcc59 + k) === 0xff ? 0 : ((b >> 4) & 0x03) + 1;
      m.wr(0xcc33 + k, a);
      b = (b << 2) & 0xff;
    }
  } else {
    const d = (counts >> 6) + 1;
    const n1 = (randomBelow(m, d) + 1) & 0xff;
    m.wr(0xcc33, n1);
    const used = multiply(m.rd(0xcc3b), n1).de & 0xff;
    let l = (0x14 - used) & 0xff;
    const w2 = m.rd(0xcc3d);
    const s0 = m.rd(0xcc30);
    if (s0 !== 0x02 && s0 < 0x04) {
      const s1 = m.rd(0xcc31);
      if (s1 === 0x01 || s1 === 0x03) l = (l - 2) & 0xff;
    }
    m.wr(0xcc3a, divide(g, l, w2, sp).hl & 0xff);
    let done = false;
    if (m.rd(0xcc5a) !== 0xff && m.rd(0xcc3a) !== 0) {
      const r = randomBelow(m, (m.rd(0xcc3a) + 1) & 0xff);
      if (r) {
        const c = (randomBelow(m, r) + 1) & 0xff;
        m.wr(0xcc34, c);
        m.wr(0xcc35, m.rd(0xcc5b) !== 0xff ? (r - c) & 0xff : 0);
        done = true;
      }
    }
    if (!done) {
      m.wr(0xcc34, 0);
      m.wr(0xcc35, 0);
    }
  }
  // 5B0B
  const rest = (m.rd(0xcc35) + m.rd(0xcc34)) & 0xff;
  m.wr(0xcc39, m.rd(0xcc33));
  m.wr(0xcc3a, rest);
  let c = 0;
  for (let k = 0; k < 3; k++) {
    c = (c + (multiply(m.rd(0xcc3b + 2 * k), m.rd(0xcc33 + k)).de & 0xff)) & 0xff;
  }
  c = ((0x14 - c) & 0xff) >> 1;
  let hl = 0xcc41;
  for (let k = 0; k < 3; k++) {
    const { b, e } = slotCount(m, k);
    [hl, c] = placeGroup(m, hl, c, b, e, m.rd(0xcc3b + 2 * k));
  }
  hl = 0xcc51;
  for (let k = 0; k < 3; k++) hl = slotShapes(m, hl, 0xcc30 + k, m.rd(0xcc36 + k));
  groupMasks(m);
}

/** 0B:5B76 — the group masks CC5E-CC60 over the slot list: c = FF shifted left by the slot
 *  counts so far (CC36, CC37, CC38 in turn); CC5E + k = ~c ^ (the previous ~c). */
function groupMasks(m: Memory): void {
  let b = 0x00, c = 0xff;
  for (let k = 0; k < 3; k++) {
    let a = (m.rd(0xcc36 + k) + 1) & 0xff;
    for (;;) {
      a = (a - 1) & 0xff;
      if (!a) break;
      c = (c << 1) & 0xff;
    }
    const nc = c ^ 0xff;
    m.wr(0xcc5e + k, nc ^ b);
    b = nc;
  }
}

/** 0B:5B98 — slot count of group a: CC36 + a = CC33 + a, doubled when its size class CC30 + a is
 *  below 3 (two rows) (out: b = monsters CC33 + a, e = 1 for two rows, else 0). */
function slotCount(m: Memory, a: number): { b: number; e: number } {
  const e = m.rd(0xcc30 + a) < 0x03 ? 1 : 0;
  const b = m.rd(0xcc33 + a);
  m.wr(0xcc36 + a, e ? (b + b) & 0xff : b);
  return { b, e };
}

/** 0B:5BB3 — b slots of width d from x = c at hl: (x, 0) and with e also (x, 4); x += d (out:
 *  hl, c after). */
function placeGroup(m: Memory, hl: number, c: number, b: number, e: number, d: number): [number, number] {
  for (; b; b--) {
    m.wr(hl, c); hl = (hl + 1) & 0xffff;
    m.wr(hl, 0x00); hl = (hl + 1) & 0xffff;
    if (e) {
      m.wr(hl, c); hl = (hl + 1) & 0xffff;
      m.wr(hl, 0x04); hl = (hl + 1) & 0xffff;
    }
    c = (c + d) & 0xff;
  }
  return [hl, c];
}

/** 0B:5BC8 — b slot shapes at hl: the 0B:5BD8 byte of the size class at de (out: hl after). */
function slotShapes(m: Memory, hl: number, de: number, b: number): number {
  const v = m.rd((SHAPE_TABLE + m.rd(de)) & 0xffff);
  for (; b; b--) {
    m.wr(hl, v);
    hl = (hl + 1) & 0xffff;
  }
  return hl;
}

// ---------------------------------------------------------------- 0B:40BF monster pictures

/** 0B:40BF — the monster pictures: CC20/CC21 = CC61 (the slot first-tile pointer), CC69 = 0 (next
 *  tile), CC2C/CC2D = D800 (tile output); per group CC59 + k: its picture sheet decompressed
 *  (0B:417D), then for CC36 + k slots the first tile and the picture's tiles (0B:4153). */
export function monsterPictures(g: Game): void {
  const m = g.m;
  m.wr(0xcc20, 0x61);
  m.wr(0xcc21, 0xcc);
  m.wr(0xcc69, 0x00);
  m.wr(0xcc2c, 0x00);
  m.wr(0xcc2d, 0xd8);
  for (let k = 0; k < 3; k++) {
    pictureSheet(g, m.rd(0xcc59 + k));
    pictureSlots(g, m.rd(0xcc36 + k));
  }
}

/** 0B:4153 — b slots (none when 0): CC2B = tiles per picture (0B:43C4 by CC22); the b bytes at
 *  [CC20] = CC69 (the first tile), CC20/CC21 advanced, CC69 += CC2B; then the tiles (0B:40FD). */
function pictureSlots(g: Game, b: number): void {
  const m = g.m;
  if (!b) return;
  const c = m.rd((TILES_TABLE + m.rd(0xcc22)) & 0xffff);
  m.wr(0xcc2b, c);
  let hl = m.rd16(0xcc20);
  const a = m.rd(0xcc69);
  do {
    m.wr(hl, a);
    hl = (hl + 1) & 0xffff;
    b = (b - 1) & 0xff;
  } while (b);
  m.wr(0xcc69, (a + c) & 0xff);
  m.wr(0xcc20, hl & 0xff);
  m.wr(0xcc21, hl >> 8);
  pictureTiles(m);
}

/** 0B:40FD — the picture's CC2B tiles to [CC2C]: from offset CC2A x 8 x CC2B in the planes D000
 *  and D400, interleaved byte by byte (8 rows per tile; counters CC2F rows, CC2E tiles); CC2C/CC2D
 *  advanced. */
function pictureTiles(m: Memory): void {
  const e = m.rd(0xcc2b);
  m.wr(0xcc2e, e);
  m.wr(0xcc2f, 0x08);
  let de = multiply(0x08, e).de;
  de = multiply(m.rd(0xcc2a), de).de;
  let bc = (0xd000 + de) & 0xffff;
  de = (0xd400 + de) & 0xffff;
  let hl = m.rd16(0xcc2c);
  let tiles: number;
  do {
    let rows: number;
    do {
      m.wr(hl, m.rd(bc)); bc = (bc + 1) & 0xffff; hl = (hl + 1) & 0xffff;
      m.wr(hl, m.rd(de)); de = (de + 1) & 0xffff; hl = (hl + 1) & 0xffff;
      rows = (m.rd(0xcc2f) - 1) & 0xff;
      m.wr(0xcc2f, rows);
    } while (rows);
    m.wr(0xcc2f, 0x08);
    tiles = (m.rd(0xcc2e) - 1) & 0xff;
    m.wr(0xcc2e, tiles);
  } while (tiles);
  m.wr(0xcc2c, hl & 0xff);
  m.wr(0xcc2d, hl >> 8);
}

/** 0B:417D — the picture sheet of monster a (nothing for FF): CC2A = picture index (0B:4301 & 7),
 *  CC22 / CC23 = low / high nibble of 0B:43CC by size class (0B:4301 >> 3), CC24-CC29 = its three
 *  words from 0B:43E4; plane 0 [CC24]..[CC26] decompressed (0B:41D5), plane 1 [CC26]..[CC28]
 *  (0B:41E4). */
function pictureSheet(g: Game, a: number): void {
  const m = g.m;
  if (a === 0xff) return;
  const c = m.rd((PICTURE_TABLE + a) & 0xffff);
  m.wr(0xcc2a, c & 0x07);
  const s = c >> 3;
  const b = m.rd((CLASS_TABLE + s) & 0xffff);
  m.wr(0xcc22, b & 0x0f);
  m.wr(0xcc23, b >> 4);
  copy(m, (SHEET_TABLE + ((s * 4) & 0xff)) & 0xffff, 0xcc24, 6); // 00:1F84
  decompressPlane0(g, m.rd16(0xcc24), m.rd16(0xcc26));
  decompressPlane1(g, m.rd16(0xcc26), m.rd16(0xcc28));
}

/** 0B:41D5 — decompress hl..de to D000 (00:3D6E) from bank CC23 when it is 0D, 0E or 0F;
 *  otherwise through 0B:41E4. */
function decompressPlane0(g: Game, hl: number, de: number): void {
  const m = g.m;
  const t = m.rd(0xcc23);
  if (t === 0x0f) far0Sync(g, 0x0f, () => decompress(m, hl, de, 0xd000));
  else if (t === 0x0d) far0Sync(g, 0x0d, () => decompress(m, hl, de, 0xd000));
  else if (t === 0x0e) far0Sync(g, 0x0e, () => decompress(m, hl, de, 0xd000));
  else decompressPlane1(g, hl, de);
}

/** 0B:41E4 — decompress hl..de to D400 (00:3D73) from bank CC23 when it is 0D, 0E or 0F;
 *  otherwise to D000 (00:3D6E) from bank 0F. */
function decompressPlane1(g: Game, hl: number, de: number): void {
  const m = g.m;
  const t = m.rd(0xcc23);
  if (t === 0x0f) far0Sync(g, 0x0f, () => decompress(m, hl, de, 0xd400));
  else if (t === 0x0d) far0Sync(g, 0x0d, () => decompress(m, hl, de, 0xd400));
  else if (t === 0x0e) far0Sync(g, 0x0e, () => decompress(m, hl, de, 0xd400));
  else far0Sync(g, 0x0f, () => decompress(m, hl, de, 0xd000));
}

// ---------------------------------------------------------------- 0B:4205 tile maps

/** 0B:4205 — the slot tile maps: CC6B = CC36 + CC37 + CC38 (8-bit), then slot CC6B - 1 down to 0
 *  (0B:421C), CC6B counting down (0 at first: 256 slots). */
export function monsterMaps(g: Game): void {
  const m = g.m;
  let a = (m.rd(0xcc36) + m.rd(0xcc37) + m.rd(0xcc38)) & 0xff;
  m.wr(0xcc6b, a);
  do {
    slotMap(m, a);
    a = (m.rd(0xcc6b) - 1) & 0xff;
    m.wr(0xcc6b, a);
  } while (a);
}

/** 0B:421C — the tile map of slot a - 1: origin from its (x, y) at CC41 + 2(a - 1) (0B:42E5),
 *  CC6F = its first tile CC61 + (a - 1), by its shape CC51 + (a - 1): 77 -> 0B:4240, F7 ->
 *  0B:4277, else 0B:42B6. */
function slotMap(m: Memory, a: number): void {
  a = (a - 1) & 0xff;
  mapOrigin(m, (0xcc41 + a + a) & 0xffff);
  const b = m.rd((0xcc61 + a) & 0xffff);
  const hl = (0xcc51 + a) & 0xffff;
  m.wr(0xcc6f, b);
  const shape = m.rd(hl);
  if (shape === 0x77) map8x8(m);
  else if (shape === 0xf7) map16x8(m);
  else mapRect(m, shape);
}

/** 0B:42E5 — CC6D/CC6E = D000 + y x 32 + x from the (x, y) pair at hl. */
function mapOrigin(m: Memory, hl: number): void {
  const b = m.rd(hl);
  const l = m.rd((hl + 1) & 0xffff);
  const de = multiply(l, 0x20).de;
  const p = (0xd000 + de + b) & 0xffff;
  m.wr(0xcc6d, p & 0xff);
  m.wr(0xcc6e, p >> 8);
}

/** Write c tiles a, a + 1, .. at hl (out: hl, a after). */
function tileRow(m: Memory, hl: number, a: number, c: number): [number, number] {
  do {
    m.wr(hl, a);
    hl = (hl + 1) & 0xffff;
    a = (a + 1) & 0xff;
    c = (c - 1) & 0xff;
  } while (c);
  return [hl, a];
}

/** 0B:4240 — 8 x 8 map at [CC6D] from tile CC6F (CC6C = 8): the top row FF, 6 tiles, FF; then 7
 *  rows of 8 tiles (stride 32). */
function map8x8(m: Memory): void {
  m.wr(0xcc6c, 0x08);
  let hl = m.rd16(0xcc6d);
  let a = m.rd(0xcc6f);
  m.wr(hl, 0xff);
  hl = (hl + 1) & 0xffff;
  for (let i = 0; i < 6; i++) {
    m.wr(hl, a);
    hl = (hl + 1) & 0xffff;
    a = (a + 1) & 0xff;
  }
  m.wr(hl, 0xff);
  hl = (hl + 1 + 0x18) & 0xffff;
  let c = 0x08;
  for (let b = 7; b; b--) {
    [hl, a] = tileRow(m, hl, a, c);
    c = m.rd(0xcc6c);
    hl = (hl + 0x18) & 0xffff;
  }
}

/** 0B:4277 — 16 x 8 map at [CC6D] from tile CC6F (CC6C = 16): an edge row (0B:42A2), 6 rows of
 *  16 tiles (stride 32), an edge row. */
function map16x8(m: Memory): void {
  m.wr(0xcc6c, 0x10);
  let c = 0x10;
  let hl = m.rd16(0xcc6d);
  let a = m.rd(0xcc6f);
  [hl, a, c] = edgeRow(m, hl, a, c);
  hl = (hl + 0x10) & 0xffff;
  for (let b = 6; b; b--) {
    [hl, a] = tileRow(m, hl, a, c);
    c = m.rd(0xcc6c);
    hl = (hl + 0x10) & 0xffff;
  }
  edgeRow(m, hl, a, c);
}

/** 0B:42A2 — an edge row: FF, c - 2 tiles from a, FF; c = CC6C (out: hl, a, c after). */
function edgeRow(m: Memory, hl: number, a: number, c: number): [number, number, number] {
  m.wr(hl, 0xff);
  hl = (hl + 1) & 0xffff;
  c = (c - 2) & 0xff;
  [hl, a] = tileRow(m, hl, a, c);
  c = m.rd(0xcc6c);
  m.wr(hl, 0xff);
  hl = (hl + 1) & 0xffff;
  return [hl, a, c];
}

/** 0B:42B6 — a full rectangle at [CC6D] from tile CC6F: width (shape >> 4) + 1 (CC6C), height
 *  (shape & 0F) + 1 rows (stride 32). */
function mapRect(m: Memory, shape: number): void {
  const w = ((shape >> 4) + 1) & 0xff;
  m.wr(0xcc6c, w);
  let c = w;
  const e = (0x20 - w) & 0xff;
  let hl = m.rd16(0xcc6d);
  let a = m.rd(0xcc6f);
  for (let b = ((shape & 0x0f) + 1) & 0xff; b; b--) {
    [hl, a] = tileRow(m, hl, a, c);
    c = m.rd(0xcc6c);
    hl = (hl + e) & 0xffff;
  }
}
