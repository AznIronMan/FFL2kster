/** Map loading: destinations, header, tileset, layout, attributes, objects, vehicles and the
 *  player's initial state (bank 0, 00:1997-1A40, 00:1AE7-1F54, 00:2232-266F, 00:338A-3449). */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { drawLayout } from "@ffl2k/importer";
import { varGet, flagTest } from "../sys.js";
import { cellAddr, cellMark, resolveMeta, attrOf, playerCell } from "./map.js";
import { resetView, fadeIn, fadeOut, restoreStat } from "./view.js";
import { drawPlayer, refreshObjects, loadPlayerTiles, playerSpriteSource, loadObjectTiles } from "./sprites.js";
import { fadeInFor } from "./effects.js";

/** 00:1C61 — read a destination record at hl (current bank): header pointer → C2A5/C2A6 and
 *  C44B/C44C, camera C42C/C42D (cell - 5/4), facing C436, C44D, sound FFB2 = 0x16 (bit 7). */
export function readDestination(m: Memory, bank: number, hl: number, ram = false): void {
  const rd = (a: number) => (ram ? m.rd(a) : m.romAt(bank, a));
  const e = rd(hl), d = rd(hl + 1), b2 = rd(hl + 2), b3 = rd(hl + 3);
  m.wr(0xc2a5, e); m.wr(0xc44b, e);
  m.wr(0xc2a6, d); m.wr(0xc44c, d);
  m.wr(0xc42c, (b2 & 0x3f) - 5);
  m.wr(0xc436, b2 >> 6);
  m.wr(0xc42d, (b3 & 0x3f) - 4);
  m.wr(0xc44d, b3 & 0x40);
  if (b3 & 0x80) m.hram[0x32] = 0x16;
  m.wr(0xc319, m.rd(0xc319) | (b3 & 0x80));
  m.wr(0xc42f, 0x40);
  m.wr(0xc42e, 0x50);
}

/** 00:1BF0 — warp to the destination in C442/C443 (C443 = 0E: alternate table 07:6F80; else
 *  index C442 + 256 * (~C443 & 1) into 07:4000; index FF with C443 even = return point C316),
 *  saving the current position (facing reversed, one cell down) as the return point C316-C319. */
export function warpTarget(m: Memory): void {
  const [px, py] = playerCell(m);
  cellMark(m, px, py, false);
  const l = m.rd(0xc442), b = m.rd(0xc443);
  if (b === 0x0e) {
    m.selectBank(0x07);
    savePosition(m);
    readDestination(m, 0x07, 0x6f80 + 4 * l);
    return;
  }
  const h = (b & 1) ^ 1;
  if (h && l === 0xff) {
    readDestination(m, 0, 0xc316, true);
    return;
  }
  m.selectBank(0x07);
  savePosition(m);
  readDestination(m, 0x07, 0x4000 + 4 * ((h << 8) | l));
}

function savePosition(m: Memory): void {
  m.wr(0xc316, m.rd(0xc2a5));
  m.wr(0xc317, m.rd(0xc2a6));
  const x = (m.rd(0xc42c) + (m.rd(0xc42e) >> 4)) & 0xff;
  m.wr(0xc318, ((((m.rd(0xc436) ^ 1) & 3) << 6) | x) & 0xff);
  m.wr(0xc319, (m.rd(0xc42d) + (m.rd(0xc42f) >> 4) + 1) & 0xff);
}

/** 00:1BDB — go to destination C442 + 256 * (C443 & 1) without saving a return point. */
export function returnTarget(m: Memory): void {
  m.selectBank(0x07);
  const i = (((m.rd(0xc443) & 1) << 8) | m.rd(0xc442)) * 4;
  readDestination(m, 0x07, 0x4000 + i);
}

/** 00:1CAF — read the map header at C44B (bank 7): layout C44E/C44F, tileset C450, trigger
 *  metatiles C451, objects flag C452, encounters C453 (+ zone C454, rate C455), animation
 *  C456, trigger table C457/C458 and the sprite/object list C459/C45A. */
export function readHeader(m: Memory): void {
  m.selectBank(0x07);
  let p = m.rd(0xc44b) | (m.rd(0xc44c) << 8);
  const r = () => m.romAt(0x07, p++);
  m.wr(0xc44e, r());
  m.wr(0xc44f, r());
  m.wr(0xc450, r());
  const c = r();
  m.wr(0xc451, c & 0x0f);
  m.wr(0xc452, c & 0x80);
  m.wr(0xc453, c & 0x40);
  m.wr(0xc456, (c >> 4) & 3);
  if (c & 0x40) {
    m.wr(0xc454, r());
    m.wr(0xc455, r());
  }
  const n = r();
  m.wr(0xc457, p & 0xff);
  m.wr(0xc458, p >> 8);
  const t = p + 2 * n;
  m.wr(0xc459, t & 0xff);
  m.wr(0xc45a, (t >> 8) & 0xff);
}

/** 00:1B37 — clear the NPC part of both OAM shadow pages (C010-C09F, C110-C19F). */
export function clearNpcOam(m: Memory): void {
  for (let i = 0; i < 0x90; i++) {
    m.wr(0xc010 + i, 0);
    m.wr(0xc110 + i, 0);
  }
}

/** 00:1B4B — clear both OAM shadow pages. */
export function clearOam(m: Memory): void {
  for (let i = 0; i < 0xa0; i++) {
    m.wr(0xc000 + i, 0);
    m.wr(0xc100 + i, 0);
  }
}

/** 00:1F55 — tileset t: 32 metatile blocks (64 bytes, bank 2 at 0x4000 + 64 * index) listed at
 *  07:7800 + 32t, to 9000-97FF (done with the LCD off). */
export function loadTileset(m: Memory, t: number): void {
  m.selectBank(0x02);
  const tab = 0x7800 + ((t << 5) & 0xffff);
  for (let i = 0; i < 32; i++) {
    const blk = m.romAt(0x07, tab + i);
    const src = 0x4000 + ((blk << 6) & 0xffff);
    for (let k = 0; k < 0x40; k++) m.wr(0x9000 + i * 0x40 + k, m.romAt(0x02, src + k));
  }
  m.wr(0xff40, 0xc3);
  m.wr(0xc439, 0);
}

/** 00:2232 — draw the layout C44E/C44F into D000 (banks 08/09) and turn metatiles 3..3+C451-1
 *  into trigger cells (00:2647). The drawing itself is the verified layout model. */
export function loadLayout(m: Memory, rom: Uint8Array): void {
  let hl = m.rd(0xc44e) | (m.rd(0xc44f) << 8);
  let bank = 0x09;
  m.selectBank(0x09);
  if (!(hl & 0x4000)) {
    hl = (hl + 0x4000) & 0xffff;
    bank = 0x08;
    m.selectBank(0x08);
  }
  const off = bank * 0x4000 + hl - 0x4000;
  const vars = Array.from({ length: 32 }, (_, v) => varGet(m, v));
  const saved = new Uint8Array(256);
  for (let i = 0; i < 256; i++) saved[i] = m.rd(0xc500 + i);
  const initial = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) initial[i] = m.rd(0xd000 + i);
  const res = drawLayout(rom, off, {
    vars, initial, saved, triggerCount: m.rd(0xc451),
    cursor: [m.rd(0xc473), m.rd(0xc474)], lastEnd: [m.rd(0xc475), m.rd(0xc476)],
  });
  for (let i = 0; i < 4096; i++) m.wr(0xd000 + i, res.grid[i]!);
  for (let i = 0; i < 256; i++) m.wr(0xc500 + i, saved[i]!);
  m.wr(0xc473, res.cursor[0]); m.wr(0xc474, res.cursor[1]);
  m.wr(0xc475, res.lastEnd[0]); m.wr(0xc476, res.lastEnd[1]);
}

/** 00:1BB9 — tile attributes of tileset t (07:7000 + 32t) to C520. */
export function loadAttributes(m: Memory, t: number): void {
  m.selectBank(0x07);
  const src = 0x7000 + ((t << 5) & 0xffff);
  for (let i = 0; i < 32; i++) m.wr(0xc520 + i, m.romAt(0x07, src + i));
}

/** 00:338A — objects of the map (only with header flag 0x80): load their sprite pages, then
 *  place each listed object whose condition holds (flag clear, or progress var in range) into
 *  C600+ ; the remaining slots are marked unused (0x80). */
export function* loadObjects(g: Game): Co {
  const m = g.m;
  let de = 0xc600;
  if (m.rd(0xc452)) {
    let hl = yield* loadObjectTiles(g);
    de = placeObjects(m, hl);
  }
  for (let a = de; a < 0xc700; a += 0x10) m.wr(a, 0x80);
}

/** 00:3397 — parse the 6-byte object records at hl (bank 7) into slots from C600; returns the
 *  first unused slot. */
export function placeObjects(m: Memory, hl: number): number {
  let de = 0xc600;
  const r = (a: number) => m.romAt(0x07, a);
  for (;;) {
    const r0 = r(hl);
    if (r0 === 0xff) return de;
    const r1 = r(hl + 1);
    let ok: boolean;
    if (r0 === 0x80) {
      ok = !flagTest(m, r1);
      if (ok) m.wr(de + 0x0c, r1);
    } else {
      const c = (varGet(m, r0 & 0x1f) + 1) & 0xff;
      ok = !((r1 >> 4) >= c) && !((r1 & 0x0f) < ((c - 1) & 0xff));
    }
    if (ok) {
      const r2 = r(hl + 2), r3 = r(hl + 3), l = r(hl + 4), h = r(hl + 5);
      m.wr(de + 0x0d, r0 & 0x40);
      m.wr(de + 0x09, l);
      m.wr(de + 0x0a, h & 0x0f);
      m.wr(de + 0x0b, 0);
      m.wr(de, (r2 & 0x3f) | ((h & 0x80) >> 1));
      m.wr(de + 1, 0);
      m.wr(de + 2, r3 & 0x3f);
      m.wr(de + 3, 0);
      m.wr(de + 4, 0);
      m.wr(de + 5, ((r3 & 0xc0) >> 6) | (r2 & 0xc0) | ((r2 & 0xc0) >> 2));
      m.wr(de + 6, 0);
      m.wr(de + 7, 0);
      m.wr(de + 8, h & 0x70);
      de += 0x10;
      if ((de & 0xff) === 0) return de;
    }
    hl += 6;
  }
}

/** 00:1D5C — vehicles parked on this map (C2A9: 4 x [header lo, header hi | slot-bits, x |
 *  dir, y | flags]) as objects C6F0, C6E0, C6D0, C6C0; the ridden one (var 0x1F) is hidden. */
export function placeVehicles(m: Memory): void {
  m.wr(0xc446, 0);
  let de = 0xc6f0;
  for (let n = 4, hl = 0xc2a9; n > 0; n--, hl += 4, de -= 0x10) {
    if (m.rd(0xc44b) !== m.rd(hl)) continue;
    const b1 = m.rd(hl + 1);
    if ((m.rd(0xc44c) ^ b1) & 0x3f) continue;
    m.wr(de + 0x0c, 1 << (b1 >> 6));
    const id = 5 - n;
    const riding = varGet(m, 0x1f) === id ? 0x80 : 0;
    const b2 = m.rd(hl + 2), b3 = m.rd(hl + 3);
    m.wr(de, (b2 & 0x3f) | 0x40 | riding);
    m.wr(de + 1, 0);
    if (!riding) cellMark(m, b2 & 0x3f, b3 & 0x3f, true);
    m.wr(de + 2, b3 & 0x3f);
    m.wr(de + 3, 0);
    m.wr(de + 4, 0);
    const f = (b3 & 0xc0) >> 2;
    m.wr(de + 0x0c, m.rd(de + 0x0c) | f);
    m.wr(de + 5, (b2 & 0xc0) | ((b2 & 0xc0) >> 2) | (f ? 1 : 0));
    m.wr(de + 6, 0);
    m.wr(de + 8, 0x10);
    m.wr(de + 9, (4 - n) | 8);
    m.wr(de + 0x0a, 0xf0);
    m.wr(de + 0x0b, 0);
    m.wr(de + 0x0d, 0);
  }
}

/** 00:1E21 — player state on arrival: vehicle speed/sprite or walking (1 px/frame, leader
 *  sprite), then 00:1E6C. */
export function initPlayer(m: Memory): void {
  const v = varGet(m, 0x1f);
  if (v) {
    const sp = 1 << (4 - v);
    m.wr(0xc43e, sp);
    m.wr(0xc43f, sp);
    m.wr(0xc430, 1);
    m.wr(0xc431, 1);
    m.wr(0xc432, 0x80);
    m.wr(0xc433, 0x40);
  } else {
    m.wr(0xc43e, 1);
    m.wr(0xc43f, 1);
    m.wr(0xc430, 0);
    playerSpriteSource(m);
  }
  m.wr(0xc437, 0);
  m.wr(0xc43d, 0);
  m.wr(0xc438, 0);
  playerCellState(m);
}

/** 00:1E6C — mark the player's cell, take its layer (C43C), layer side (C434) and BG priority
 *  (C43B) from the cell, draw the player. */
export function playerCellState(m: Memory): void {
  const [x, y] = playerCell(m);
  const a = cellAddr(x, y);
  m.wr(a, m.rd(a) | 0x80);
  const meta = resolveMeta(m, m.rd(a));
  m.wr(0xc43c, meta & 0x20);
  let e = attrOf(m, meta);
  if (e >= 0xc0) {
    m.wr(0xc43b, 0);
    m.wr(0xc434, 0);
  } else {
    if (!(e & 0x80)) {
      if (e & 0x04) {
        if (m.rd(0xc434) & 1) e = 0x30;
      } else {
        let s = e & 3;
        if (s) s ^= 3;
        m.wr(0xc434, s);
      }
    }
    m.wr(0xc43b, e & 0x30);
  }
  drawPlayer(m, m.rd(0xc436));
}

/** Map setup shared by the field entry (00:19FE-1A3D) and map changes (00:1B03-1B2A). */
function* buildMap(g: Game, rom: Uint8Array, full: boolean): Co {
  const m = g.m;
  if (full) {
    loadTileset(m, m.rd(0xc450));
    loadLayout(m, rom);
    loadAttributes(m, m.rd(0xc450));
  }
}

/** 00:1AEC (warp = true, via 1BF0) / 00:1AE7 (via 1BDB) — change map: fade out, load, fade in. */
export function* changeMap(g: Game, rom: Uint8Array, warp = true): Co {
  const m = g.m;
  if (warp) warpTarget(m);
  else returnTarget(m);
  yield* fadeOut(g);
  m.wr(0xc463, m.rd(0xc305));
  m.wr(0xc305, m.rd(0xc305) & 0x0f);
  restoreStat(m);
  readHeader(m);
  clearNpcOam(m);
  if (!m.rd(0xc44d)) {
    loadTileset(m, m.rd(0xc450));
    loadLayout(m, rom);
    loadAttributes(m, m.rd(0xc450));
    yield* loadPlayerTiles(g);
    yield* loadObjects(g);
    placeVehicles(m);
  }
  initPlayer(m);
  refreshObjects(m);
  yield* resetView(g);
  yield* fadeInFor(g);
  m.wr(0xc305, m.rd(0xc463));
}

/** 00:19D6 (new game) / 00:1997 (continue) and 00:19F1-1A40 — enter the field. */
export function* enterField(g: Game, rom: Uint8Array, cont: boolean): Co {
  const m = g.m;
  m.wr(0xc468, 0x69);
  let flag = 0;
  if (cont) {
    m.wr(0xc44b, m.rd(0xc2a5));
    m.wr(0xc44c, m.rd(0xc2a6));
    const b = m.rd(0xc2a7);
    m.wr(0xc42c, (b & 0x3f) - 5);
    m.wr(0xc436, b >> 6);
    m.wr(0xc42d, (m.rd(0xc2a8) & 0x3f) - 4);
    m.wr(0xc42f, 0x40);
    m.wr(0xc42e, 0x50);
    m.wr(0xc466, 1);
  } else {
    m.wr(0xc466, 0);
    m.wr(0xc442, 0xfe);
    m.wr(0xc443, 0x06);
    warpTarget(m);
    flag = 1;
  }
  m.wr(0xc45b, flag);
  m.wr(0xff47, flag); m.wr(0xff48, flag); m.wr(0xff49, flag);
  m.wr(0xff4a, 0x90);
  clearNpcOam(m);
  readHeader(m);
  loadTileset(m, m.rd(0xc450));
  loadLayout(m, rom);
  loadAttributes(m, m.rd(0xc450));
  fieldReset(m);
  yield* loadPlayerTiles(g);
  initPlayer(m);
  yield* loadObjects(g);
  placeVehicles(m);
  refreshObjects(m);
  if (m.rd(0xc466)) {
    m.wr(0xc434, m.rd(0xc33d));
    m.wr(0xc43a, m.rd(0xc33e));
    m.wr(0xc43b, m.rd(0xc33f));
  }
  yield* resetView(g);
  yield* fadeIn(g);
}

/** 00:1A7B — reset field state for a fresh entry. */
function fieldReset(m: Memory): void {
  m.wr(0xc435, 0);
  m.hram[0x40] = 0; // FFC0
  m.wr(0xc45c, 0);
  m.wr(0xc45d, 0);
  m.wr(0xc442, 0xff);
  m.wr(0xc443, 0xff);
  m.wr(0xff40, 0xc3);
}

/** 00:194B — remember the field position for saving / leaving (C2A5-C2A8, C33D-C33F, C305). */
export function saveFieldPosition(m: Memory): void {
  m.wr(0xc2a5, m.rd(0xc44b));
  m.wr(0xc2a6, m.rd(0xc44c));
  const x = (m.rd(0xc42c) + (m.rd(0xc42e) >> 4)) & 0xff;
  m.wr(0xc2a7, (((m.rd(0xc436) & 3) << 6) | x) & 0xff);
  m.wr(0xc2a8, (m.rd(0xc42d) + (m.rd(0xc42f) >> 4)) & 0xff);
  m.wr(0xc33d, m.rd(0xc434));
  m.wr(0xc33e, m.rd(0xc43a));
  m.wr(0xc33f, m.rd(0xc43b));
  m.wr(0xc305, m.rd(0xc460));
}

export { buildMap };
