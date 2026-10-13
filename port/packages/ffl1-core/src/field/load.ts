/** Legend I map loading and the field's sprite/screen setup (bank 0): 00:22BC/22CC/231B map
 *  change, 00:3F97 tileset, 00:2403 attributes, 00:24F8 sprite set, 00:2554 player tiles,
 *  00:2586 objects, 00:14B0/14F0 screen, 00:1C80/1D26 object sprites, 00:1F81/1FC2 player sprite,
 *  00:211A player BG priority. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { vramBegin, vramEnd, vsync, oamDma, copy, copyBank16, vramCopy16, vramCopyBank } from "../sys.js";
import { cell, cellAttr, attrOf, passable, drawLayout } from "./map.js";

const C0 = (m: Memory, a: number, v: number) => { m.wr(a, v); m.wr(a | 0x100, v); };

/** 00:3DCF — palettes off (C3A6-C3A8 and BGP/OBP0/OBP1 = 0). */
export function palettesOff(m: Memory): void {
  m.wr(0xc3a6, 0); m.wr(0xff47, 0);
  m.wr(0xc3a7, 0); m.wr(0xff48, 0);
  m.wr(0xc3a8, 0); m.wr(0xff49, 0);
}
/** 00:3DE0 — field palettes (E4, D1, 00). */
export function palettesOn(m: Memory): void {
  m.wr(0xc3a6, 0xe4); m.wr(0xff47, 0xe4);
  m.wr(0xc3a7, 0xd1); m.wr(0xff48, 0xd1);
  m.wr(0xc3a8, 0); m.wr(0xff49, 0);
}

/** 00:23EF — movement speed C5B2/C5B3 from 00:245A + CCC1 (movement mode). */
export function setSpeed(m: Memory): void {
  const v = m.rd(0x245a + m.rd(0xccc1));
  m.wr(0xc5b2, v);
  m.wr(0xc5b3, v);
}

/** 00:3F97 — tileset `set`: record at [02:4820 + 2 set]: two bytes = four 1 KiB blocks of bank 01
 *  (staged at D000-DFFF, block numbers kept in FFD0-FFD3), then 128 tile indexes -> 8800-8FFF. */
export function* loadTileset(g: Game, set: number): Co {
  const m = g.m;
  const prev = g.selectBank(0x02);
  let hl = m.rd16((0x4820 + ((set << 1) & 0xff)) & 0xffff);
  for (let k = 0; k < 2; k++) {
    const v = m.rd(hl++);
    m.hram[0x50 + 2 * k] = v >> 4;
    m.hram[0x51 + 2 * k] = v & 15;
  }
  let de = 0xd000;
  for (let k = 0; k < 4; k++) {
    const h = ((m.hram[0x50 + k]! * 4) + 0x40) & 0xff;
    [, de] = copyBank16(g, 0x01, h << 8, de, 0x0400);
  }
  yield* vramBegin(g);
  de = 0x8800;
  for (let b = 0; b < 0x80; b++) {
    const t = m.rd(hl++);
    [, de] = copy(m, (0xd000 + t * 16) & 0xffff, de, 0x10);
  }
  yield* vramEnd(g);
  g.selectBank(prev);
}

/** 00:2403 — metatile attributes of set a (02:4840 + 64 a -> DF80), then the parked vehicles of
 *  this map (CC99: 3 x (map, row, col, attributes)): the cell becomes 0x1F with attributes
 *  8C / (attributes | slot << 6) in DFBE/DFBF. */
export function loadAttributes(g: Game, set: number): void {
  const m = g.m;
  const bc = ((set >> 2) << 8) | ((set & 3) << 6);
  g.selectBank(0x02);
  copy(m, 0x4840 + bc, 0xdf80, 0x40);
  let hl = 0xcc99;
  const map = m.rd(0xccc7);
  for (let b = 3; b; b--) {
    const a = m.rd(hl++);
    if (a !== 0 && a === map) {
      const e = m.rd(hl);
      hl++;
      if (!m.rd(0xccc1)) {
        const [addr] = cell(m, e, m.rd(hl));
        if (addr !== null) m.wr(addr, 0x1f);
      }
      hl++;
      const bb = (((4 - b) & 0xff) << 6) & 0xff;
      m.wr(0xdfbf, m.rd(hl) | bb);
      m.wr(0xdfbe, 0x8c);
      return;
    }
    hl += 3;
  }
}

/** 00:24F8 — object sprite set n (02:5240 + 6n): six bank-01 blocks to 8100.. (256 bytes each;
 *  bit 7: 64 bytes from 01:6000 + (n & 0x7F) * 64 after the shift; FD: 128 bytes from 01:4000),
 *  then 01:7F00 -> 8700. Leaves bank 01 selected. */
export function* loadSpriteSet(g: Game, n: number): Co {
  const m = g.m;
  let hl = (0x5240 + ((n * 6) & 0xff)) & 0xffff;
  let de = 0x8100;
  for (let b = 6; b; b--) {
    g.selectBank(0x02);
    const a = m.rd(hl);
    if (!(a & 0x80)) {
      g.selectBank(0x01);
      [, de] = yield* vramCopy16(g, ((a + 0x60) & 0xff) << 8, de, 0x0100);
    } else if (a === 0xfd) {
      [, de] = yield* vramCopyBank(g, 0x01, 0x4000, de, 0x80);
    } else {
      const src = ((((a >> 2) + 0x60) & 0xff) << 8) | ((a & 3) << 6);
      [, de] = yield* vramCopyBank(g, 0x01, src, de, 0x40);
    }
    hl++;
  }
  g.selectBank(0x01);
  yield* vramCopy16(g, 0x7f00, 0x8700, 0x0100);
}

/** 00:2554 — the player's sprite tiles (bank 01, 256 bytes -> 8000): the vehicle (CCC1) or the
 *  leader's class graphics (high nibble of 02:7438 + [CC05]). */
export function* loadPlayerTiles(g: Game): Co {
  const m = g.m;
  const v = m.rd(0xccc1);
  let h: number;
  if (v) h = (v + 0x1a + 0x60) & 0xff;
  else {
    g.selectBank(0x02);
    h = 0x60 + (m.rd(0x7438 + m.rd(0xcc05)) >> 4);
  }
  g.selectBank(0x01);
  yield* vramCopy16(g, h << 8, 0x8000, 0x0100);
}

/** 00:264B — event bit a set (CCA5 bit field, MSB first)? */
export function flagBit(m: Memory, a: number): boolean {
  return (m.rd(0xcca5 + (a >> 3)) & (0x80 >> (a & 7))) !== 0;
}
/** 00:2629 — set event bit a to e's bit (e = 1 sets it). */
export function setFlagBit(m: Memory, a: number, e: number): void {
  const hl = 0xcca5 + (a >> 3);
  let n = (a & 7) + 1;
  while (n--) e = ((e >> 1) | ((e & 1) << 7)) & 0xff;
  m.wr(hl, e | ((e ^ 0xff) & m.rd(hl)));
}
/** 00:2669 — progress nibble a (CC91 + a/2; even a: high nibble). */
export function nibble(m: Memory, a: number): number {
  const v = m.rd(0xcc91 + (a >> 1));
  return a & 1 ? v & 15 : v >> 4;
}
/** 00:2680 — set progress nibble a to e. */
export function setNibble(m: Memory, a: number, e: number): void {
  const hl = 0xcc91 + (a >> 1);
  const v = m.rd(hl);
  m.wr(hl, a & 1 ? (v & 0xf0) | e : (v & 0x0f) | ((e << 4) & 0xff));
}

/** 00:2616 — no objects: C55C + 5k = 0x5A for all 16. */
export function clearObjects(m: Memory): void {
  for (let k = 0; k < 16; k++) m.wr(0xc55c + 5 * k, 0x5a);
}

/** 00:2586 — objects of the event list at FFFB/FFFC (bank 02) into C55C (16 x row, col, command,
 *  parameter, sprite/flags). */
export function placeObjects(g: Game): void {
  const m = g.m;
  let de = m.hram[0x7b]! | (m.hram[0x7c]! << 8);
  g.selectBank(0x02);
  let b = m.rd(de++);
  if (b >= 0x10) b = 0x10;
  let hl = 0xc55c;
  const place = () => {
    // 00:2604 (de at the entry's second byte)
    de++;
    m.wr(hl + 1, m.rd(de++));
    m.wr(hl, m.rd(de++));
    for (let k = 2; k < 5; k++) m.wr(hl + k, m.rd(de++));
    hl += 5;
  };
  for (;;) {
    const a = m.rd(de);
    if (!(a & 0x80)) {
      const c = nibble(m, a) + 1;
      de++;
      const r = m.rd(de);
      if ((r & 15) >= c && (r >> 4) < c) place();
      else { de += 6; continue; }
    } else {
      de++;
      if (a === 0x81) return;
      if (a === 0xff) {
        if (flagBit(m, m.rd(de))) { de += 6; continue; }
        const f = m.rd(de);
        place();
        m.wr(hl - 3, (f + 0x10) & 0xff);
      } else {
        const bc = hl - 3;
        m.wr(hl + 1, m.rd(de++));
        m.wr(hl, m.rd(de) & 0x3f);
        m.wr(hl + 2, m.rd(bc));
        m.wr(hl + 3, m.rd(bc + 1));
        m.wr(hl + 4, (m.rd(bc + 2) & 0xcf) | ((m.rd(de) & 0xc0) >> 2));
        de++;
        hl += 5;
      }
    }
    if (--b === 0) return;
  }
}

/** 00:13CE — BG map address of scroll (SCX - 8 = d, SCY = a) into C5B4/C5B5. */
export function screenOrigin(m: Memory, scy: number, d: number): number {
  const hl = (scy * 4 + 0x9800 + (d >> 3)) & 0xffff;
  m.wr(0xc5b5, hl >> 8);
  m.wr(0xc5b4, hl & 0xff);
  return hl;
}

/** 00:14F0 — draw the 11 x 9 metatiles around the player to the BG map. */
export function* drawScreen(g: Game): Co {
  const m = g.m;
  let hl = screenOrigin(m, m.rd(0xff42), (m.rd(0xff43) - 8) & 0xff);
  let e = (m.rd(0xccc8) - 4) & 0xff, d0 = (m.rd(0xccc9) - 5) & 0xff;
  yield* vramBegin(g);
  for (let c = 9; c; c--) {
    let p = hl, d = d0;
    for (let b = 0x0b; b; b--) {
      const a = (cell(m, e, d)[1] * 4 + 0x80) & 0xff;
      m.wr(p, a);
      m.wr(p + 1, a + 1);
      m.wr((p & ~0xff) | ((p | 0x20) & 0xff), a + 2);
      m.wr((p & ~0xff) | (((p | 0x20) + 1) & 0xff), a + 3);
      let l = ((p & 0xff) + 2) & 0xff;
      l &= ~0x20;
      p = (p & ~0xff) | l;
      d = (d + 1) & 0xff;
    }
    hl = (hl + 0x40) & 0xffff;
    hl &= ~0x0400;
    e = (e + 1) & 0xff;
  }
  yield* vramEnd(g);
}

/** 00:1F81 — the player's four sprites at (0x50, 0x50) on both OAM pages, then the tiles and the
 *  BG priority of the cell. */
export function playerSprites(g: Game): void {
  const m = g.m;
  let hl = 0xc000, e = 0x50, d = 0x50;
  for (let c = 2; c; c--) {
    for (let b = 2; b; b--) {
      C0(m, hl, e);
      C0(m, hl + 1, d);
      m.wr(hl + 3, m.rd(hl + 3) & 0x7f);
      m.wr(hl + 0x103, m.rd(hl + 0x103) & 0x7f);
      hl += 4;
      d ^= 8;
    }
    e ^= 8;
  }
  playerTiles(m);
  const p = passable(m, m.rd(0xccc8), m.rd(0xccc9));
  if (p.a & 0xf0) return;
  priority(m, p.e, p.d);
}

/** 00:1FC2 — the player's tiles/flips for direction C5B7 (00:200D, vehicles 00:202D): 4 per page. */
export function playerTiles(m: Memory): void {
  let de = (m.rd(0xc5b7) * 8 + (m.rd(0xccc1) ? 0x202d : 0x200d)) & 0xffff;
  for (const page of [0xc002, 0xc102]) {
    let hl = page;
    for (let b = 4; b; b--) {
      const a = m.rd(de++);
      m.wr(hl, a & 0x0f);
      m.wr(hl + 1, (m.rd(hl + 1) & 0xdf) | (a & 0xf0));
      hl += 4;
    }
  }
}

/** 00:211A — the player's BG priority (attribute bit 7) from the cell attributes (e, d): the top
 *  half by d bit 5, the bottom half by d bit 4, only when e & 0xE0 = 0. On foot only. */
export function priority(m: Memory, e: number, d: number): void {
  if (m.rd(0xccc1)) return;
  const set = (hl: number, on: boolean) => {
    for (const a of [hl, hl | 4, (hl | 4) | 0x100, hl | 0x100]) m.wr(a, on ? m.rd(a) | 0x80 : m.rd(a) & 0x7f);
  };
  set(0xc003, !(e & 0xe0) && (d & 0x20) !== 0);
  set(0xc00b, !(e & 0xe0) && (d & 0x10) !== 0);
}

/** 00:1C80 — the visible objects (within 11 x 11 of the player) into C52C (8 x index, Y, X, tile
 *  base, animation pointer), their BG priority bits into C5D2+. */
export function objectTable(m: Memory): void {
  for (let k = 0; k < 8; k++) m.wr(0xc52c + 6 * k, 0xff);
  const e = (m.rd(0xccc8) - 5) & 0xff, d = (m.rd(0xccc9) - 5) & 0xff;
  m.wr(0xc5d1, 0xd2);
  let hl = 0xc55c, bc = 0xc52c;
  for (let n = 0x10; n; n--) {
    m.wr(bc, (0x11 + (n ^ 0xff)) & 0xff);
    const row = m.rd(hl);
    const ry = (row - e) & 0xff;
    if (row >= 0x40 || ry >= 0x0b) { m.wr(bc, 0xff); hl += 5; continue; }
    m.wr(bc + 1, ((ry << 4) | (ry >> 4)) & 0xff);
    const rx = (m.rd(hl + 1) - d) & 0xff;
    if (rx >= 0x0b) { m.wr(bc, 0xff); hl += 5; continue; }
    m.wr(bc + 2, ((rx << 4) | (rx >> 4)) & 0xff);
    let [ae, ad] = cellAttr(m, row, m.rd(hl + 1));
    if (ae & 0xf0) ad = 0;
    const p = m.rd(0xc5d1);
    m.wr(0xc500 | p, (ad << 2) & 0xc0);
    m.wr(0xc5d1, p + 1);
    const f = m.rd(hl + 4);
    m.wr(bc + 3, ((f & 7) << 4) & 0xff);
    const base = f & 8 ? 0x2075 : 0x204d;
    const ptr = base + ((f >> 4) & 3) * 10;
    m.wr(bc + 4, ptr & 0xff);
    m.wr(bc + 5, ptr >> 8);
    bc += 6;
    hl += 5;
  }
}

/** 00:1E10 — four sprites from the animation frame at de: flip bits b = [de], then tile offsets
 *  + base c; X flip (bit 5) of each attribute replaced. Returns de after the 5-byte frame (the
 *  callers draw the C1 page from the next frame: two frames per direction, 10 bytes). */
export function animSprites(m: Memory, hl: number, de: number, c: number): number {
  const b = m.rd(de++);
  for (let k = 0; k < 4; k++) {
    m.wr(hl, (m.rd(de++) + c) & 0xff);
    m.wr(hl + 1, (m.rd(hl + 1) & 0xdf) | b);
    hl += 4;
  }
  return de;
}

/** 00:1D26 — OAM (both pages) for the objects in C52C from C010, the rest hidden (Y = B0) up to
 *  C090; tiles and BG priority. C5B0 = 0. */
export function objectSprites(m: Memory): void {
  m.wr(0xc5b0, 0);
  let hl = 0xc010;
  for (let k = 0; k < 8; k++) {
    const de = 0xc52c + 6 * k;
    if (m.rd(de) === 0xff) continue;
    let c = m.rd(de + 1);
    const b = m.rd(de + 2);
    C0(m, hl, c); C0(m, hl + 1, b); C0(m, hl + 3, 0);
    C0(m, hl + 4, c); C0(m, hl + 5, (b + 8) & 0xff); C0(m, hl + 7, 0);
    c = (c + 8) & 0xff;
    C0(m, hl + 8, c); C0(m, hl + 9, b); C0(m, hl + 0x0b, 0);
    C0(m, hl + 0x0c, c); C0(m, hl + 0x0d, (b + 8) & 0xff); C0(m, hl + 0x0f, 0);
    hl += 0x10;
  }
  while ((hl & 0xff) < 0x90) {
    C0(m, hl, 0xb0);
    C0(m, hl + 3, 0);
    hl += 4;
  }
  hl = 0xc012;
  for (let k = 0; k < 8; k++) {
    const de = 0xc52c + 6 * k;
    if (m.rd(de) === 0xff) continue;
    const c = m.rd(de + 3);
    const ptr = m.rd(de + 4) | (m.rd(de + 5) << 8);
    animSprites(m, hl | 0x100, animSprites(m, hl, ptr, c), c);
    hl += 0x10;
  }
  hl = 0xc013;
  for (let k = 0; k < 8; k++) {
    const v = m.rd(0xc5d2 + k);
    for (const c of [v & 0x80, (v << 1) & 0xff]) {
      for (let j = 0; j < 2; j++) {
        m.wr(hl, m.rd(hl) | c);
        m.wr(hl | 0x100, m.rd(hl | 0x100) | c);
        hl += 4;
      }
    }
  }
}

/** 00:14B0 — field screen setup: scroll (0, 8), all sprites hidden, the screen drawn, objects
 *  and the player placed, the window below the screen (00:14DB). */
export function* fieldScreen(g: Game): Co {
  const m = g.m;
  m.wr(0xff42, 0);
  m.wr(0xff43, 8);
  for (let k = 0; k < 0x28; k++) {
    const hl = 0xc000 + 4 * k;
    C0(m, hl, 0xb0);
    C0(m, hl + 3, 0);
  }
  yield* drawScreen(g);
  objectTable(m);
  objectSprites(m);
  playerSprites(g);
  windowOff(m);
}
/** 00:14DB — window at (7, 0x90) (off screen). 00:14E8: at (7, 0); 00:14E4: at (7, 0x50). */
export function windowOff(m: Memory): void { m.wr(0xff4a, 0x90); m.wr(0xff4b, 7); }
export function windowTop(m: Memory): void { m.wr(0xff4a, 0); m.wr(0xff4b, 7); }
export function windowMid(m: Memory): void { m.wr(0xff4a, 0x50); m.wr(0xff4b, 7); }
