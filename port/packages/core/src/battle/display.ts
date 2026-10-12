/** Battle display (bank 0F, 0F:6080-64E7): the entry table 0F:6080 — battle opening (enemy
 *  graphics, layout and the wavy intro), drawing the enemy groups into the BG map, the enemy
 *  vanish (death) animation with its sprite burst, sliding enemies back into view, the
 *  backdrop pattern of battles of kind 2 — plus the bank-0 copy/fill helpers these use.
 *
 *  WRAM read/written (original addresses): D501 + 0x100 k group present (count), D90D-D90F
 *  group already vanished, D920 group count, D921/D922 + 2k graphic class/index, D927/D928 +
 *  2k width/height (tiles), D92D/D92E + 2k first tile / tile count, D933-D935 centre column,
 *  D936-D938 left column, D939-D93B top row, D943-D954 burst sprite positions, D975-D978 row
 *  pointers, D97A enemy area dark, D97C burst step, D986-D988 group needs redraw (slide in),
 *  D98B battle kind (0 normal, 1 formation listed at 0F:62A6, 2 C7F3 = 0), C700-C702 palette
 *  copies, C7F3 formation, FF90-FF92 scratch (FF90 = current group), FFA5/FFA6 (kind 2). */
import type { Co, Game } from "../game.js";
import type { Memory } from "../memory.js";
import type { Engine } from "../engine.js";
import type { Regs } from "../text/engine.js";
import { vsync, fill, copy, mul8 } from "../sys.js";
import { frameTick } from "../irq.js";
import { vramBegin, vramEnd } from "../field/sprites.js";
import { enemyLayout, enemySizes, enemyGraphicSource, loadSpriteTiles, restoreEnemies, installBattleAnim } from "./anim.js";

const H90 = 0x10, H91 = 0x11, H92 = 0x12;

// ---------------------------------------------------------------- bank-0 helpers

/** 8-bit loop count of a dec b / jr nz loop: 0 means 256. */
export const loop8 = (b: number): number => (b & 0xff) || 0x100;

/** 00:04BF — far call bookkeeping around `body`: the trampoline at C0E4 (ld a,n; jp nnnn)
 *  gets the caller's A (C0E5) and the target (C0E7/C0E8); the target bank is mapped for the
 *  call and the caller's bank restored afterwards. */
export function* farcall<T>(m: Memory, bank: number, addr: number, a: number, body: () => Co<T>): Co<T> {
  const prev = farEnter(m, bank, addr, a);
  const r = yield* body();
  m.selectBank(prev);
  return r;
}

/** 00:04BF around a routine without frame waits. */
export function farcallSync<T>(m: Memory, bank: number, addr: number, a: number, body: () => T): T {
  const prev = farEnter(m, bank, addr, a);
  const r = body();
  m.selectBank(prev);
  return r;
}

function farEnter(m: Memory, bank: number, addr: number, a: number): number {
  m.wr(0xc0e7, addr & 0xff);
  m.wr(0xc0e8, (addr >> 8) & 0xff);
  m.wr(0xc0e5, a & 0xff);
  return m.selectBank(bank);
}

/** 00:0094 — fill b bytes (0 = 256) at hl with v inside a VRAM access window (2 frames). */
export function* r00_0094(g: Game, hl: number, b: number, v: number): Co {
  yield* vramBegin(g);
  fill(g.m, hl, loop8(b), v);
  yield* vramEnd(g);
}

/** 00:009C — fill bc bytes at hl with v inside a VRAM access window. */
export function* r00_009C(g: Game, hl: number, bc: number, v: number): Co {
  yield* vramBegin(g);
  fill(g.m, hl, bc, v);
  yield* vramEnd(g);
}

/** 00:00AC — copy bc bytes from hl to de inside a VRAM access window (00:00A4: 8-bit b). */
export function* r00_00AC(g: Game, hl: number, de: number, bc: number): Co {
  yield* vramBegin(g);
  copy(g.m, hl, de, bc);
  yield* vramEnd(g);
}

/** 00:00B5 — copy b bytes from hl in bank `bank` (or RAM) to de, no VRAM window. */
export function r00_00B5(m: Memory, bank: number, hl: number, de: number, b: number): void {
  const prev = m.selectBank(bank);
  copy(m, hl, de, loop8(b));
  m.selectBank(prev);
}

/** 00:00C3 — copy n (8-bit count, already expanded) bytes from bank `bank` inside a VRAM
 *  access window; the source bank stays mapped (FF88) across the window's frame waits. */
export function* r00_00C3(g: Game, bank: number, hl: number, de: number, n: number): Co {
  const prev = g.m.selectBank(bank);
  yield* r00_00AC(g, hl, de, n);
  g.m.selectBank(prev);
}

/** 00:00CA — copy bc bytes from bank `bank` inside a VRAM access window (bank mapped across
 *  the waits). */
export function* r00_00CA(g: Game, bank: number, hl: number, de: number, bc: number): Co {
  const prev = g.m.selectBank(bank);
  yield* r00_00AC(g, hl, de, bc);
  g.m.selectBank(prev);
}

// ---------------------------------------------------------------- opening

/** 0F:6098 (entry 0F:6080) — battle opening: screen black, BG map 9800-9FFF and sprites
 *  cleared, UI tiles 04:4700 → 9700, battle kind D98B, enemy layout (0D:5012), sizes and tile
 *  offsets (0F:6257), enemy graphics to 9000+ (0F:627F), enemies drawn (0F:6146), window at
 *  WY 0x40; the intro (kind 0: wavy raster unfolding 0F:61ED; kind 2: FFA5 hook on), then
 *  palettes D2/D2/81 (copies C700-C702). */
export function* battleOpen(e: Engine): Co {
  const g = e.g, m = g.m;
  yield* vsync(g);
  m.wr(0xff47, 0); m.wr(0xff48, 0); m.wr(0xff49, 0);
  m.wr(0xff40, 0xc0);
  fill(m, 0xd920, 0x1e0, 0);
  m.hram[0x16] = 0; // FF96
  yield* r00_009C(g, 0x9800, 0x800, 0xff);
  fill(m, 0xcc00, 0xa0, 0);
  yield* vsync(g);
  m.wr(0xff46, 0xcc);
  yield* r00_00CA(g, 0x04, 0x4700, 0x9700, 0x100);
  m.wr(0xd90d, 0); m.wr(0xd90e, 0); m.wr(0xd90f, 0);
  const f = m.rd(0xc7f3);
  let kind = 2;
  if (f) {
    kind = 0;
    for (let i = 0; i < 7; i++) if (m.romAt(0x0f, 0x62a6 + i) === f) { kind = 1; break; }
  }
  m.wr(0xd98b, kind);
  const a = farcallSync(m, 0x0d, 0x5012, kind, () => enemyLayout(m));
  enemyTileOffsets(m, a);
  yield* loadEnemyGraphics(g);
  yield* drawEnemies(g);
  yield* vsync(g);
  m.wr(0xff4a, 0x40);
  m.wr(0xff4b, 0x07);
  m.wr(0xff42, 0);
  m.wr(0xff43, 0);
  m.wr(0xff40, 0xc3);
  const k = m.rd(0xd98b);
  if (!k) yield* wavyIntro(g);
  else if (k !== 1) { m.hram[0x25] = 1; m.hram[0x26] = 0; } // 0F:61E3 (kind 1: 0F:61EC ret)
  yield* vsync(g);
  m.wr(0xff47, 0xd2); m.wr(0xc700, 0xd2);
  m.wr(0xff48, 0xd2); m.wr(0xc701, 0xd2);
  m.wr(0xff49, 0x81); m.wr(0xc702, 0x81);
}

/** 0F:61ED — wavy intro, 16 frames with interrupts off: lines 0-63 get SCY = d + line / k
 *  (k = 1..4, d = E0/F0/F4/F8 from 0F:62A2/629E, four frames per step; written in the hblank
 *  of each line from the ramp at C800), the frame tick (00:016E) at line 64; then SCY = 0. */
export function* wavyIntro(g: Game): Co {
  const m = g.m;
  m.hram[H90] = 0xff;
  yield* vsync(g);
  m.wr(0xff47, 0xd2);
  g.ime = false;
  let d = 0, last = false;
  const step = (): boolean => {
    const a = (m.hram[H90]! + 1) & 0xff;
    if (a >= 4) return false;
    m.hram[H90] = a;
    m.hram[H91] = m.romAt(0x0f, 0x62a2 + a);
    ramp(m);
    d = m.romAt(0x0f, 0x629e + m.hram[H90]!);
    return true;
  };
  step();
  g.lineHook = (ly) => {
    if (ly >= 1 && ly <= 0x40) m.wr(0xff42, m.rd(0xc800 + ly - 1) + d);
    if (ly !== 0x40) return;
    frameTick(g);
    if (!last) return;
    // 0F:623C: SCY = 0, reti
    m.wr(0xff42, 0);
    g.lineHook = null;
    g.ime = true;
  };
  // The original changes step (dec e) at line 64, after the frame tick; that only affects the
  // next frame's lines, so here it runs at the start of the next frame's code. The last frame
  // (step 3, e = 1) ends inside the hook at line 64 (SCY = 0, reti), and the caller's rst $10
  // (0F:612F) then waits for that frame's vblank.
  let e = 4;
  for (;;) {
    yield;
    if (--e === 0) {
      e = 4;
      step();
    }
    if (e === 1 && m.hram[H90] === 3) {
      last = true;
      return;
    }
  }
}

/** 0F:6240 — C800 + i = i / FF91 for i < 0x40. */
function ramp(m: Memory): void {
  const e = m.hram[H91]!;
  let hl = 0xc800, a = 0, c = 0x40;
  for (;;) {
    let b = loop8(e);
    do {
      m.wr(hl++, a);
      if (!--c) return;
    } while (--b);
    a = (a + 1) & 0xff;
  }
}

/** 0F:6257 (entry 0F:6092) — group sizes (0D:5015), then D92D + 2k = first tile (running
 *  total), D92E + 2k = width x height. `a` is the caller's A (far call byte C0E5); returns A
 *  (the tile total). */
export function enemyTileOffsets(m: Memory, a: number): number {
  farcallSync(m, 0x0d, 0x5015, a, () => enemySizes(m));
  let b = loop8(m.rd(0xd920)), hl = 0xd927, de = 0xd92d, c = 0;
  do {
    m.wr(de++, c);
    const n = mul8(m.rd(hl), m.rd(hl + 1)) & 0xff;
    m.wr(de++, n);
    hl += 2;
    c = (c + n) & 0xff;
  } while (--b);
  return c;
}

/** 0F:627F — copy each group's graphic (0D:5018) to 9000+ (00:00CA). */
export function* loadEnemyGraphics(g: Game): Co {
  const m = g.m;
  let b = loop8(m.rd(0xd920)), de = 0x9000, a = 0;
  m.hram[H90] = 0;
  do {
    const s = farcallSync(m, 0x0d, 0x5018, a, () => enemyGraphicSource(m));
    yield* r00_00CA(g, s.a, s.hl, de, s.bc);
    de = (de + s.bc) & 0xffff;
    a = s.a;
    m.hram[H90] = (m.hram[H90]! + 1) & 0xff;
  } while (--b);
}

// ---------------------------------------------------------------- drawing

/** 0F:6146 (entry 0F:6086) — clear the enemy rows (0F:6190) and draw every present group. */
export function* drawEnemies(g: Game): Co {
  const m = g.m;
  yield* clearEnemyRows(g);
  for (let k = 0; k < 3; k++) {
    m.hram[H90] = k;
    if (!m.rd(0xd501 + (k << 8))) continue;
    // 0F:615E
    const t = groupTiles(m);
    yield* drawTiles(g, groupMapAddr(m, m.hram[H90]!), t.d, t.c, t.b);
  }
}

/** 0F:6190 — enemy rows 9800-98FF: blank (FF), or the backdrop pattern in battles of kind 2. */
function* clearEnemyRows(g: Game): Co {
  if (g.m.rd(0xd98b) !== 2) yield* r00_009C(g, 0x9800, 0x100, 0xff);
  else yield* patternRows(g, 0x9800, 4);
}

/** 0F:61A9 — c row pairs of the backdrop pattern (tiles 00 0E ... / 1C 1D ...) from hl, in a
 *  VRAM window (0F:61A4, entry 0F:608F: 5 pairs from 9900). */
export function* patternRows(g: Game, hl: number, c: number): Co {
  const m = g.m;
  yield* vramBegin(g);
  let n = loop8(c);
  do {
    for (let i = 0; i < 16; i++) { m.wr(hl++, 0x00); m.wr(hl++, 0x0e); }
    for (let i = 0; i < 16; i++) { m.wr(hl++, 0x1c); m.wr(hl++, 0x1d); }
  } while (--n);
  yield* vramEnd(g);
}

/** 0F:6180 (entry 0F:608C) — group FF90: d = first tile, c = width, b = height (hl = D928 +
 *  2k, a = 2k). */
export function groupTiles(m: Memory): { a: number; b: number; c: number; d: number; hl: number } {
  const a = (m.hram[H90]! * 2) & 0xff;
  return { a, d: m.rd(0xd92d + a), c: m.rd(0xd927 + a), b: m.rd(0xd928 + a), hl: 0xd928 + a };
}

/** 0F:61CA (entry 0F:6095) — BG map address of group a: 9800 + 32 top row + left column. */
export function groupMapAddr(m: Memory, a: number): number {
  const e = m.rd(0xd936 + a), l = m.rd(0xd939 + a);
  return (l * 32 + e + 0x9800) & 0xffff;
}

/** 0F:6166 (entry 0F:6089) — draw b rows of c consecutive tiles from d at hl (row stride 32,
 *  rows above 9800 skipped) inside a VRAM window. Returns hl after the last row and d. */
export function* drawTiles(g: Game, hl: number, d: number, c: number, b: number): Co<{ hl: number; d: number }> {
  const m = g.m;
  yield* vramBegin(g);
  let rows = loop8(b);
  do {
    let p = hl, e = loop8(c);
    do {
      if (p >> 8 >= 0x98) m.wr(p, d);
      p = (p + 1) & 0xffff;
      d = (d + 1) & 0xff;
    } while (--e);
    hl = (hl + 0x20) & 0xffff;
  } while (--rows);
  yield* vramEnd(g);
  return { hl, d };
}

// ---------------------------------------------------------------- update after actions

/** 0F:62AD (entry 0F:6083) — after an action: the 16-byte sprite tile 04:7FE0 → 8000 (0D:5009),
 *  groups whose count reached 0 vanish (0F:62E9) and those marked in D986 slide back in
 *  (0F:6471); if the enemy area is dark (D97A), 0D:5003 redraws and lightens it. `a` is the
 *  caller's A (far call byte C0E5). */
export function* updateEnemies(e: Engine, a: number): Co {
  const g = e.g, m = g.m;
  yield* farcall(m, 0x0d, 0x5009, a, () => loadSpriteTiles(g, 0x7fe0, 0x10));
  let b = loop8(m.rd(0xd920)), hl = 0xd501, de = 0xd986, c = 0;
  do {
    if (!m.rd(hl)) {
      yield* vanishGroup(g, c);
      m.wr(de, 0);
    }
    if (m.rd(de)) {
      m.hram[H90] = c;
      yield* slideInGroup(g);
    }
    de++;
    hl = (hl + 0x100) & 0xffff;
    c = (c + 1) & 0xff;
  } while (--b);
  const d = m.rd(0xd97a);
  if (d) yield* farcall(m, 0x0d, 0x5003, d, () => restoreEnemies(e));
}

/** 0F:62E9 — group c vanishes (once, D90D + c): its rows are blanked from the top and the bottom
 *  towards the middle (4 frames per pair), then (screen not dark) a burst of 9 sprites flies
 *  apart from its centre and OBP0 flashes 81/40; in battles of kind 2, 0F:63E8 instead. */
export function* vanishGroup(g: Game, c: number): Co {
  const m = g.m;
  if (m.rd(0xd90d + c)) return;
  m.wr(0xd90d + c, 0xff);
  m.hram[H90] = c;
  if (m.rd(0xd986 + c)) return;
  if (m.rd(0xd98b) === 2) return yield* bigVanish(g);
  const k = m.hram[H90]!;
  const a2 = (k * 2) & 0xff;
  m.hram[H91] = m.rd(0xd927 + a2);
  const h = m.rd(0xd928 + a2);
  m.hram[H92] = h >> 1;
  const top = groupMapAddr(m, k);
  setPtr(m, 0xd975, top);
  setPtr(m, 0xd977, (((h - 1) & 0xff) * 32 + top) & 0xffff);
  do {
    yield* vsync(g);
    let p = ptr(m, 0xd975);
    fill(m, p, loop8(m.hram[H91]!), 0xff);
    setPtr(m, 0xd975, (p + 0x20) & 0xffff);
    yield* vsync(g);
    p = ptr(m, 0xd977);
    fill(m, p, loop8(m.hram[H91]!), 0xff);
    setPtr(m, 0xd977, (p - 0x20) & 0xffff);
    yield* vsync(g);
    yield* vsync(g);
    m.hram[H92] = (m.hram[H92]! - 1) & 0xff;
  } while (m.hram[H92]);
  if (m.rd(0xd97a)) return;
  // burst from the centre
  const x = (m.rd(0xd933 + k) * 8 + 4) & 0xff;
  const y = ((m.rd(0xd939 + k) + (m.rd(0xd928 + a2) >> 1)) * 8 + 8) & 0xff;
  for (let i = 0; i < 9; i++) { m.wr(0xd943 + 2 * i, y); m.wr(0xd944 + 2 * i, x); }
  m.wr(0xd97c, 0x08);
  m.wr(0xd97c, 0x01);
  for (;;) {
    burstSprites(m);
    yield* vsync(g);
    m.wr(0xff46, 0xcc);
    const e = m.rd(0xd944);
    const s = (m.rd(0xd97c) + 2) & 0xff;
    m.wr(0xd97c, s);
    if (s >= 0x20) break;
    const idx = ((s >> 3) * 2) & 0xff;
    m.wr(0xd946 + idx, e - s);
    m.wr(0xd94e + idx, e + s);
  }
  for (let i = 0; i < 2; i++) {
    const v = m.romAt(0x0f, 0x64e9 + i);
    for (let d = 0; d < 4; d++) {
      yield* vsync(g);
      m.wr(0xff48, v);
    }
  }
  fill(m, 0xcc00, 0x28, 0);
  yield* vsync(g);
  m.wr(0xff46, 0xcc);
  m.wr(0xff48, 0xd2);
}

/** 0F:6459 — the 9 burst positions D943+ as sprites (tile 0, attributes 0) at CC00. */
function burstSprites(m: Memory): void {
  for (let i = 0; i < 9; i++) {
    m.wr(0xcc00 + 4 * i, m.rd(0xd943 + 2 * i));
    m.wr(0xcc01 + 4 * i, m.rd(0xd944 + 2 * i));
    m.wr(0xcc02 + 4 * i, 0);
    m.wr(0xcc03 + 4 * i, 0);
  }
}

/** 0F:63E8 — vanish in battles of kind 2: backdrop pattern over 9900 (12 row pairs), the
 *  screen shakes and scrolls up 64 lines (0F:640F, sound 0x27), then the pattern is redrawn at
 *  9800 and SCY = 0. */
function* bigVanish(g: Game): Co {
  const m = g.m;
  m.hram[0x30] = 0; // FFB0
  yield* patternRows(g, 0x9900, 0x0c);
  for (let c = 0; c < 0x40; c++) {
    yield* quake(g, 2);
    m.wr(0xff42, m.rd(0xff42) - 1);
  }
  yield* patternRows(g, 0x9800, 4);
  yield* vsync(g);
  m.wr(0xff42, 0);
}

/** 0F:640F — b times: sound 0x27 (FFB2), SCX +4 / 0 / -4 every two frames. */
function* quake(g: Game, b: number): Co {
  const m = g.m;
  m.hram[H90] = 4;
  let n = loop8(b);
  do {
    yield* vsync(g);
    yield* vsync(g);
    m.hram[0x32] = 0x27;
    m.wr(0xff43, m.hram[H90]!);
    yield* vsync(g);
    yield* vsync(g);
    m.wr(0xff43, 0);
    yield* vsync(g);
    yield* vsync(g);
    m.wr(0xff43, -m.hram[H90]! & 0xff);
  } while (--n);
}

const ptr = (m: Memory, a: number) => m.rd(a) | (m.rd(a + 1) << 8);
const setPtr = (m: Memory, a: number, v: number) => { m.wr(a, v & 0xff); m.wr(a + 1, (v >> 8) & 0xff); };

/** 0F:6471 — group FF90 slides down into place from 7 rows above (drawn one row lower per
 *  step, 0F:6166), then the rows above it are blanked; D986 + k = 0. */
export function* slideInGroup(g: Game): Co {
  const m = g.m;
  const k = m.hram[H90]!;
  m.wr(0xd986 + k, 0);
  setPtr(m, 0xd975, (groupMapAddr(m, k) + 0xff20) & 0xffff);
  setPtr(m, 0xd977, 0x9800 + m.rd(0xd936 + k));
  m.hram[H91] = 8;
  const h = m.rd(0xd928 + ((2 * k) & 0xff));
  m.hram[H92] = (8 - h) & 0xff;
  do {
    const t = groupTiles(m);
    yield* drawTiles(g, ptr(m, 0xd975), t.d, t.c, t.b);
    setPtr(m, 0xd975, (ptr(m, 0xd975) + 0x20) & 0xffff);
    m.hram[H91] = (m.hram[H91]! - 1) & 0xff;
  } while (m.hram[H91]);
  while (m.hram[H92]) {
    const w = m.rd(0xd927 + ((2 * m.hram[H90]!) & 0xff));
    const p = ptr(m, 0xd977);
    yield* vsync(g);
    fill(m, p, loop8(w), 0xff);
    setPtr(m, 0xd977, (ptr(m, 0xd977) + 0x20) & 0xffff);
    m.hram[H92] = (m.hram[H92]! - 1) & 0xff;
  }
}

// ---------------------------------------------------------------- entries

/** Install the 0F:6080 entry table (as 0xF6080 ... 0xF6095) and the 0D:5000 table (0xD5000 ...
 *  0xD5018) into `e.extra`. Each entry runs like the original far call (C0E5 = regs.a when
 *  given, C0E7/C0E8 = entry, bank mapped, caller's bank restored); register results are
 *  written back into `regs`. */
export function installBattleDisplay(e: Engine): void {
  const entry = (addr: number, f: (e: Engine, r: Regs) => Co<number | void>) =>
    e.extra.set(0xf0000 | addr, (e, r) => farcall(e.g.m, 0x0f, addr, r.a ?? e.g.m.rd(0xc0e5), () => f(e, r)));
  entry(0x6080, (e) => battleOpen(e));
  entry(0x6083, (e, r) => updateEnemies(e, r.a ?? e.g.m.rd(0xc0e5)));
  entry(0x6086, (e) => drawEnemies(e.g));
  entry(0x6089, function* (e, r) {
    const o = yield* drawTiles(e.g, r.hl ?? 0, r.d ?? 0, r.c ?? 0, r.b ?? 0);
    r.hl = o.hl; r.d = o.d; r.b = 0; r.e = 0; r.a = 0x20;
    return 0x20;
  });
  entry(0x608c, function* (e, r) {
    const o = groupTiles(e.g.m);
    r.a = o.a; r.b = o.b; r.c = o.c; r.d = o.d; r.hl = o.hl;
    return o.a;
  });
  entry(0x608f, (e) => patternRows(e.g, 0x9900, 5));
  entry(0x6092, function* (e, r) { r.a = enemyTileOffsets(e.g.m, r.a ?? e.g.m.rd(0xc0e5)); return r.a; });
  entry(0x6095, function* (e, r) { r.hl = groupMapAddr(e.g.m, r.a ?? 0); return r.a; });
  installBattleAnim(e);
}
