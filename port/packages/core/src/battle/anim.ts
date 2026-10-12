/** Battle animation (bank 0D, 0D:5000-60DA): the entry table 0D:5000, weapon/attack sprite
 *  animations scripted in bank 07 (0D:501B), the 35 screen effects of the table 0D:5EB5
 *  (shakes, flashes, darkness, enemy vanish/roll, particle effects run by the sprite-particle
 *  engine 0D:5FBC), and the enemy layout tables (0D:525B-5302).
 *
 *  Work areas (all at the original addresses): D910 animation id (bit 7: sprite script,
 *  else effect index), CFF5 target (5-7 enemy group 0-2, 9 all enemies), D93C-D97B animation
 *  scratch (D93D/E script pointer, D93F/D940 sprite origin, D941 frame time, D942 flags,
 *  D943-D972 the 6x8 sprite cell grid, D973 tile base, D974 target group, D989/D98A "all
 *  enemies" mode), C800-C995 particle slots (C800 delay, C828 done, C850 (x, y), C8A0 phase,
 *  C8C8 sprite id, C8F0/C918 polar coordinates, C940 offsets, C990 OAM pointer, C992/C993
 *  per-particle/per-frame handlers, C994 count, C995 parameter), CC00 sprite page. */
import type { Co, Game } from "../game.js";
import type { Memory } from "../memory.js";
import type { Engine } from "../engine.js";
import type { Regs } from "../text/engine.js";
import { vsync, fill, copy, mul8 } from "../sys.js";
import { rand } from "../rng.js";
import { vramBegin, vramEnd } from "../field/sprites.js";
import {
  farcall, farcallSync, loop8, r00_0094, r00_009C, r00_00AC, r00_00B5, r00_00C3, r00_00CA,
  drawEnemies, drawTiles, groupTiles, groupMapAddr, patternRows, updateEnemies,
} from "./display.js";

const H90 = 0x10, H91 = 0x11, H92 = 0x12;
const nonEmpty = (m: Memory, k: number) => m.rd(0xd501 + ((k & 0xff) << 8)) !== 0;
const setPal = (m: Memory, v: number) => { m.wr(0xff47, v); m.wr(0xff48, v); m.wr(0xff49, v); };

// ---------------------------------------------------------------- frame helpers

/** 0D:60D3 (entry 0D:5006) — b frames of (rst $10, OAM DMA from CC00); b = 0 means 256. */
export function* spriteFrames(g: Game, b: number): Co {
  let n = loop8(b);
  do {
    yield* vsync(g);
    g.m.wr(0xff46, 0xcc);
  } while (--n);
}

/** 0D:60C6 — clear the sprite page CC00-CC9F. */
export function clearSprites(m: Memory): void {
  fill(m, 0xcc00, 0xa0, 0);
}

/** 0D:60CE — clear the sprite page and show it (one frame). */
export function* hideSprites(g: Game): Co {
  clearSprites(g.m);
  yield* spriteFrames(g, 1);
}

/** 0D:60BE (entry 0D:5009) / 0D:60C1 — copy b bytes (0 = 256) of bank-04 tiles from hl to de
 *  (60BE: de = 8000) inside a VRAM access window; returns the advanced source and target. */
export function* loadSpriteTiles(g: Game, hl: number, b: number, de = 0x8000): Co<{ hl: number; de: number }> {
  yield* r00_00C3(g, 0x04, hl, de, loop8(b));
  const n = loop8(b);
  return { hl: (hl + n) & 0xffff, de: (de + n) & 0xffff };
}

/** 0D:60B9 (entry 0D:500C) — byte at hl in bank 0F (00:00D2); returns it and hl + 1. */
export function readBank0F(m: Memory, hl: number): { a: number; hl: number } {
  return { a: m.romAt(0x0f, hl & 0xffff), hl: (hl + 1) & 0xffff };
}

/** 0D:6082 (entry 0D:500F) — compose sprite a of the 0F:7B80 table into OAM entries at hl:
 *  records [dy, dx, tile/attr] (FF ends) give (y + b, x + c, attr & 0x0F, attr & 0xF0).
 *  Returns hl past the last entry. */
export function composeSprite(m: Memory, a: number, b: number, c: number, hl: number): number {
  let de = hl;
  let p = (0x7b80 + ((a * 2) & 0xff)) & 0xffff;
  let r = readBank0F(m, p);
  const lo = r.a;
  r = readBank0F(m, r.hl);
  p = (r.a << 8) | lo;
  for (;;) {
    r = readBank0F(m, p);
    p = r.hl;
    if (r.a === 0xff) break;
    m.wr(de, r.a + b); de = (de + 1) & 0xffff;
    r = readBank0F(m, p); p = r.hl;
    m.wr(de, r.a + c); de = (de + 1) & 0xffff;
    r = readBank0F(m, p); p = r.hl;
    m.wr(de, r.a & 0x0f); de = (de + 1) & 0xffff;
    m.wr(de, r.a & 0xf0); de = (de + 1) & 0xffff;
  }
  return de;
}

/** 0D:6068 — compose sprite a at the OAM pointer C990 and advance it (0D:6079/606B/606E). */
function composeAtPointer(m: Memory, a: number, b: number, c: number): void {
  const hl = m.rd(0xc990) | (m.rd(0xc991) << 8);
  setPointer(m, composeSprite(m, a, b, c, hl));
}

/** 0D:606E — store the OAM pointer C990/C991. */
function setPointer(m: Memory, hl: number): void {
  m.wr(0xc990, hl & 0xff);
  m.wr(0xc991, hl >> 8);
}

// ---------------------------------------------------------------- enemy layout (no waits)

/** 0D:525B (entry 0D:5012) — enemy layout: D920 = number of groups (D500/D600/D700 != 0);
 *  per group the graphic class and index (D921/D922 + 2k, from 0D:6400 by enemy id D50A +
 *  0x100k), the size (0D:52E0), the centre columns D933-D935 (0D:6540 by group count), the
 *  left columns D936-D938 (centre - width / 2) and the top rows D939-D93B (0D:6550 by class).
 *  Returns A (the last top row). */
export function enemyLayout(m: Memory): number {
  m.wr(0xd920, 0);
  for (let k = 0; k < 3; k++) if (m.rd(0xd500 + (k << 8))) m.wr(0xd920, m.rd(0xd920) + 1);
  const n = m.rd(0xd920);
  let de = 0xd921, hl = 0xd50a, b = loop8(n);
  do {
    const t = m.romAt(0x0d, 0x6400 + m.rd(hl));
    m.wr(de, t >> 4);
    m.wr(de + 1, t & 0x0f);
    de += 2;
    hl = (hl + 0x100) & 0xffff;
  } while (--b);
  enemySizes(m);
  const c = m.rd(0xd920);
  const i = ((c - 1) * 3) & 0xff;
  for (let j = 0; j < 3; j++) m.wr(0xd933 + j, m.romAt(0x0d, 0x6540 + i + j));
  b = loop8(c);
  let k = 0;
  de = 0xd936;
  do {
    m.hram[H90] = k;
    const w = m.rd(0xd927 + ((2 * k) & 0xff)) >> 1;
    m.wr(de++, m.rd(0xd933 + k) - w);
    k = (k + 1) & 0xff;
  } while (--b);
  b = loop8(m.rd(0xd920));
  de = 0xd939;
  hl = 0xd921;
  let a = 0;
  do {
    a = m.romAt(0x0d, 0x6550 + m.rd(hl));
    hl += 2;
    m.wr(de++, a);
  } while (--b);
  return a;
}

/** 0D:52E0 (entry 0D:5015) — group sizes: D927/D928 + 2k = width/height of class D921 + 2k
 *  (0D:6500). Returns A (the last height). */
export function enemySizes(m: Memory): number {
  let b = loop8(m.rd(0xd920)), de = 0xd927, hl = 0xd921, a = 0;
  do {
    const t = m.romAt(0x0d, 0x6500 + m.rd(hl));
    hl += 2;
    m.wr(de++, t >> 4);
    a = t & 0x0f;
    m.wr(de++, a);
  } while (--b);
  return a;
}

/** 0D:5302 (entry 0D:5018) — graphic source of group FF90: class base [bank, address] at
 *  0D:6510 + 3 class, + index x tiles x 16. Returns a = bank, hl = address, bc = bytes. */
export function enemyGraphicSource(m: Memory): { a: number; hl: number; bc: number; d: number } {
  const k = m.hram[H90]!;
  const cls = m.rd(0xd921 + ((2 * k) & 0xff));
  const t = (0x6510 + ((cls * 3) & 0xff)) & 0xffff;
  const bank = m.romAt(0x0d, t);
  const base = m.romAt(0x0d, t + 1) | (m.romAt(0x0d, t + 2) << 8);
  const d = m.rd(0xd92e + ((2 * k) & 0xff));
  const idx = m.rd(0xd922 + ((2 * k) & 0xff));
  const hl = ((mul8(idx, d) << 4) + base) & 0xffff;
  return { a: bank, hl, bc: (d << 4) & 0xffff, d };
}

// ---------------------------------------------------------------- 0D:501B sprite animations

/** 0D:501B (entry 0D:5000) — play battle animation D910 (OBP1 = 0x16 first): bit 7 set: the
 *  sprite script 07:6800 + 2 (D910 & 0x7F) with the tiles of 07:6700 (04:6000 + 16 n, 0x200
 *  bytes to 8000), on target group CFF5 - 5, on every group (CFF5 = 9 or D910 = A0, flipped
 *  per group for A0) or at a fixed place (07:6701 bit 1); else screen effect D910. */
export function* battleAnimation(e: Engine): Co {
  const m = e.g.m, g = e.g;
  m.wr(0xff49, 0x16);
  m.wr(0xc702, 0x16);
  const id = m.rd(0xd910);
  if (!(id & 0x80)) {
    yield* effect(e, id);
    return;
  }
  const i = ((id & 0x7f) * 2) & 0xff;
  const c = m.romAt(0x07, 0x6700 + i), b = m.romAt(0x07, 0x6701 + i);
  m.wr(0xd93c, (b & 0x02) >> 1);
  const src = ((((b & 1) << 8) | c) * 16 + 0x6000) & 0xffff;
  yield* r00_00CA(g, 0x04, src, 0x8000, 0x200);
  m.wr(0xd989, 0);
  m.wr(0xd98a, 0);
  if (m.rd(0xd910) === 0xa0) m.wr(0xd989, 0xa0);
  else if (m.rd(0xd93c)) return yield* animScript(e);
  else {
    const t = m.rd(0xcff5);
    if (t !== 9) {
      m.wr(0xd974, t - 5);
      return yield* animScript(e);
    }
  }
  let a = 0;
  while (!nonEmpty(m, a)) a = (a + 1) & 0xff;
  for (;;) {
    m.wr(0xd974, a);
    yield* animScript(e);
    m.wr(0xd98a, m.rd(0xd98a) + 1);
    a = m.rd(0xd974);
    if (a >= 2) return;
    for (;;) {
      a = (a + 1) & 0xff;
      if (nonEmpty(m, a)) break;
      if (a >= 2) return;
    }
  }
}

/** 0D:51FF — next byte of the animation script (bank 07, pointer D93D/D93E). */
function scriptByte(m: Memory): number {
  const p = m.rd(0xd93d) | (m.rd(0xd93e) << 8);
  const a = m.romAt(0x07, p);
  const q = (p + 1) & 0xffff;
  m.wr(0xd93d, q & 0xff);
  m.wr(0xd93e, q >> 8);
  return a;
}

/** 0D:50A6 — run the sprite script of D910: FF end; 0x80-0x9F/0xC0-0xFF screen effect
 *  (low 6 bits); 0xA0-0xBF set the tile base D973 from the next byte; else a frame (0D:50E7)
 *  shown for D941 frames. */
export function* animScript(e: Engine): Co {
  const m = e.g.m;
  m.wr(0xd973, 0);
  const i = ((m.rd(0xd910) & 0x7f) * 2) & 0xff;
  const p = m.romAt(0x07, 0x6800 + i) | (m.romAt(0x07, 0x6801 + i) << 8);
  m.wr(0xd93d, p & 0xff);
  m.wr(0xd93e, p >> 8);
  for (;;) {
    const a = scriptByte(m);
    if (a === 0xff) return yield* hideSprites(e.g);
    if (a & 0x80) {
      if (a & 0x40 || !(a & 0x20)) yield* effect(e, a);
      else m.wr(0xd973, scriptByte(m));
      continue;
    }
    animFrame(m, a);
    yield* spriteFrames(e.g, m.rd(0xd941));
  }
}

/** 0D:50E7 — build one animation frame into CC00: time D941 = 4 (a & 0x0F) + 4, flags D942 =
 *  a & 0x70 (bit 6 vertical flip, bit 5 horizontal flip, bit 4 palette), origin (0x10,
 *  x of the target group (0D:5240) or 0x40), the 6x8 cell grid unpacked (run-length) from the
 *  bank-01 graphic 01:7000 + 2 n (n = next script byte); cells 0x1F are empty. */
export function animFrame(m: Memory, a: number): void {
  m.wr(0xd941, (((a & 0x0f) + 1) * 4) & 0xff);
  m.wr(0xd942, a & 0x70);
  m.wr(0xd93f, 0x10);
  m.wr(0xd940, 0x40);
  if (m.rd(0xd989) || !m.rd(0xd93c)) targetColumn(m);
  const n = scriptByte(m);
  const t = (0x7000 + n * 2) & 0xffff;
  let hl = m.romAt(0x01, t) | (m.romAt(0x01, t + 1) << 8);
  let de = 0xd943, b = 0x30;
  const next = () => { const v = m.romAt(0x01, hl); hl = (hl + 1) & 0xffff; return v; };
  outer: for (;;) {
    const v = next();
    if (v & 0x80) {
      const x = v & 0x7f;
      let c = next();
      for (;;) {
        m.wr(de++, x);
        if (!--b) break outer;
        c = (c - 1) & 0xff;
        if (!c) break;
      }
    } else {
      m.wr(de++, v);
      if (!--b) break;
    }
  }
  const f = m.rd(0xd942);
  if (f & 0x40) flipVertical(m);
  if (f & 0x20) flipHorizontal(m);
  if (m.rd(0xd989)) {
    const s = m.rd(0xd98a);
    if (s & 1) flipVertical(m);
    if (s & 2) flipHorizontal(m);
  }
  clearSprites(m);
  m.hram[H90] = m.rd(0xd93f);
  m.hram[H91] = m.rd(0xd940);
  let src = 0xd943, hl2 = 0xcc00;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 6; col++) {
      const v = m.rd(src);
      if ((v & 0x1f) !== 0x1f) {
        m.wr(hl2++, m.hram[H90]!);
        m.wr(hl2++, m.hram[H91]!);
        m.wr(hl2++, (v & 0x1f) + m.rd(0xd973));
        m.wr(hl2++, (v & 0x60) | (m.rd(0xd942) & 0x10));
      }
      src++;
      m.hram[H91] = (m.hram[H91]! + 8) & 0xff;
    }
    m.hram[H90] = (m.hram[H90]! + 8) & 0xff;
    m.hram[H91] = m.rd(0xd940);
  }
}

/** 0D:5240 — sprite x origin = 8 x centre column of group D974 - 0x10. */
export function targetColumn(m: Memory): void {
  m.wr(0xd940, ((m.rd(0xd933 + m.rd(0xd974)) * 8) - 0x10) & 0xff);
}

/** 0D:51B0 — flip the 6x8 cell grid vertically (cells get OAM attribute bit 6 toggled). */
function flipVertical(m: Memory): void {
  let hl = 0xd943, de = 0xd96d;
  for (let b = 0; b < 4; b++) {
    for (let c = 0; c < 6; c++) {
      const t = m.rd(hl);
      m.wr(hl++, m.rd(de) ^ 0x40);
      m.wr(de++, t ^ 0x40);
    }
    de -= 12;
  }
}

/** 0D:51D6 — flip the cell grid horizontally (attribute bit 5 toggled). */
function flipHorizontal(m: Memory): void {
  let hl = 0xd943, de = 0xd948;
  for (let b = 0; b < 8; b++) {
    for (let c = 0; c < 3; c++) {
      const t = m.rd(hl);
      m.wr(hl++, m.rd(de) ^ 0x20);
      m.wr(de--, t ^ 0x20);
    }
    hl += 3;
    de += 9;
  }
}

// ---------------------------------------------------------------- screen effects

/** 0D:533E — screen effect a & 0x3F (table 0D:5EB5) between two sprite clears. */
export function* effect(e: Engine, a: number): Co {
  yield* hideSprites(e.g);
  yield* dispatchEffect(e, a);
  yield* hideSprites(e.g);
}

/** 0D:5350 — effect handlers by index (table 0D:5EB5). */
export function* dispatchEffect(e: Engine, a: number): Co {
  const g = e.g;
  switch (a & 0x3f) {
    case 0x00: return yield* windowShake(g);
    case 0x01: return yield* darkRedraw(g);
    case 0x02: yield* darken(g); return yield* lighten(g);
    case 0x03: return yield* screenShake(g);
    case 0x04: return yield* lcdFlash(g);
    case 0x05: case 0x0a: case 0x14: case 0x1d: return; // 0D:5512, 56C0, 5C37, 5EB4: ret
    case 0x06: return yield* liftEnemies(e);
    case 0x07: return yield* rollEnemies(e);
    case 0x08: return yield* killTarget(e);
    case 0x09: return yield* bandFlash(g);
    case 0x0b: return yield* fx56C1(e);
    case 0x0c: return yield* fx5760(e);
    case 0x0d: return yield* fx5975(e);
    case 0x0e: return yield* fx5A1A(e, 0x10, 0x02);
    case 0x0f: yield* fx5ACE(e); return yield* darkRedraw(g);
    case 0x10: return yield* fx5B86(e);
    case 0x11: return yield* fx5801(e);
    case 0x12: return yield* waveX(g);
    case 0x13: return yield* fx5A1A(e, 0x08, 0x01);
    case 0x15: return yield* fx5C91(e, 0x0028, 0x1038, 0x11, 0x0d, 0);
    case 0x16: return yield* fx5C91(e, 0x1860, 0x2868, 0x11, 0x0e, 1);
    case 0x17: return yield* fx5C91(e, 0x2030, 0x3040, 0x09, 0x0f, 2);
    case 0x18: return yield* fx5C91(e, 0x0860, 0x1068, 0x09, 0x10, 3);
    case 0x19: return yield* fx5D3C(e);
    case 0x1a: return yield* fx5E53(e);
    case 0x1b: case 0x1e: return yield* bank1Call(e, 0x1502a, 0x6e, { b: 0x00, c: 0x33 });
    case 0x1c: return yield* fx5D87(e);
    case 0x1f: return yield* bank1Call(e, 0x1502a, 0x73, { b: 0x01, c: 0x34 });
    case 0x20: return yield* bank1Call(e, 0x1502a, 0x78, { b: 0x01, c: 0x35 });
    case 0x21: return yield* fx58CE(e);
    case 0x22: return yield* bank1Call(e, 0x15030, 0x82, {});
  }
  // indices 0x23-0x3F read past the table (data words); never used by the game
  throw new Error(`battle effect ${a & 0x3f} (beyond the table 0D:5EB5)`);
}

/** 0D:5E6E-5E82 — far calls into bank 01 (01:502A = 01:6E27 enemy graphic change with b, c;
 *  01:5030 = 01:6F74). `a` is the A register at the call (the trampoline byte C0E5). */
function* bank1Call(e: Engine, addr: number, a: number, regs: Regs): Co {
  yield* farcall(e.g.m, 0x01, addr & 0xffff, a, () => e.far(addr, { ...regs, a }) as Co);
}

/** 0D:535B — effect 0x00: the window (message box) shakes vertically, twice through the
 *  offsets 0D:5F03 (one per frame), then WY = 0x40. */
function* windowShake(g: Game): Co {
  const m = g.m;
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 8; i++) {
      yield* vsync(g);
      m.wr(0xff4a, 0x40 + m.romAt(0x0d, 0x5f03 + i));
    }
  }
  yield* vsync(g);
  m.wr(0xff4a, 0x40);
}

/** 0D:54C2 — effect 0x03: the background shakes (SCX, then SCY, through 0D:5F03), twice. */
function* screenShake(g: Game): Co {
  const m = g.m;
  for (let r = 0; r < 2; r++) {
    for (const reg of [0xff43, 0xff42]) {
      for (let i = 0; i < 8; i++) {
        yield* vsync(g);
        m.wr(reg, m.romAt(0x0d, 0x5f03 + i));
      }
    }
  }
  yield* vsync(g);
  m.wr(0xff43, 0);
  m.wr(0xff42, 0);
}

/** 0D:54E8 — effect 0x04: the LCD is switched off for a moment at the start of vblank (LY
 *  0x91, until DIV bit 2 after a DIV reset), then 5 frames; twice. */
function* lcdFlash(g: Game): Co {
  const m = g.m;
  for (let r = 0; r < 2; r++) {
    m.wr(0xff40, m.rd(0xff40) & 0x7f);
    m.io[0x04] = 0;
    m.wr(0xff40, m.rd(0xff40) | 0x80);
    lcdRestarted.add(g);
    for (let i = 0; i < 5; i++) yield* vsync(g);
  }
}

/** Games whose LCD was just switched off and on again (0D:54E8): no picture is shown until the
 *  restarted frame has been drawn. A renderer checks this when the game code reaches its next
 *  frame wait, draws the frames up to that wait blank (white) and removes the entry. (The frame
 *  model has no LCD on/off timing; this is the only place in the battle code that switches the
 *  LCD off and on.) */
export const lcdRestarted = new WeakSet<Game>();

/** 0D:5463 — palette e (BGP/OBP0/OBP1) above line 0x40, the normal palette 0D:5F0E below
 *  (polls LY == 0x40). */
function paletteBand(g: Game, e: number): void {
  const m = g.m;
  setPal(m, e);
  const v = m.romAt(0x0d, 0x5f0e);
  g.lineHook = (ly) => {
    if (ly !== 0x40) return;
    setPal(m, v);
    g.lineHook = null;
  };
}

/** 0D:5446 — darken the enemy area in three steps (0D:5F0B, 7 frames each); D97A = 1. */
function* darken(g: Game): Co {
  for (let b = 3; b > 0; b--) {
    const e = g.m.romAt(0x0d, 0x5f0b + b - 1);
    for (let d = 0; d < 7; d++) {
      yield* vsync(g);
      paletteBand(g, e);
    }
  }
  g.m.wr(0xd97a, 1);
}

/** 0D:542A — lighten it again (0D:5F0F); D97A = 0. */
function* lighten(g: Game): Co {
  for (let b = 3; b > 0; b--) {
    const e = g.m.romAt(0x0d, 0x5f0f + b - 1);
    for (let d = 0; d < 7; d++) {
      yield* vsync(g);
      paletteBand(g, e);
    }
  }
  g.m.wr(0xd97a, 0);
}

/** 0D:53DD — save the window rows 9C00-9D3F to 9900, window off. */
function* saveWindow(g: Game): Co {
  yield* r00_00AC(g, 0x9c00, 0x9900, 0x140);
  yield* vsync(g);
  g.m.wr(0xff40, 0xc3);
}

/** 0D:53EF — window on over the whole screen (WY saved in D97B, WY = 0). */
function* windowFull(g: Game): Co {
  const m = g.m;
  yield* vsync(g);
  m.wr(0xff40, 0xe3);
  m.wr(0xd97b, m.rd(0xff4a));
  m.wr(0xff4a, 0);
}

/** 0D:53FD — restore the window rows from 9900, window on at the saved WY, clear 9900-9A3F
 *  and 9D40-9DBF. */
function* restoreWindow(g: Game): Co {
  const m = g.m;
  yield* r00_00AC(g, 0x9900, 0x9c00, 0x140);
  yield* vsync(g);
  m.wr(0xff40, 0xe3);
  m.wr(0xff4a, m.rd(0xd97b));
  yield* r00_009C(g, 0x9900, 0x140, 0xff);
  yield* r00_009C(g, 0x9d40, 0x80, 0xff);
}

/** 0D:5378 — effect 0x01: the message box moves to the window bottom half, the screen
 *  darkens (0D:5446), the enemies are erased (9800-98FF) behind a full-screen window, and the
 *  window is restored. The enemy area stays dark (D97A = 1) until 0D:5399. */
function* darkRedraw(g: Game): Co {
  const m = g.m;
  yield* saveWindow(g);
  yield* r00_0094(g, 0x9c00, 0, 0xff);
  yield* r00_00AC(g, 0x9900, 0x9d00, 0x140);
  yield* darken(g);
  yield* windowFull(g);
  yield* r00_0094(g, 0x9800, 0, 0xff);
  yield* vsync(g);
  m.wr(0xff40, 0xc3);
  yield* restoreWindow(g);
}

/** 0D:5399 (entry 0D:5003) — after the dark effect: the screen is copied to the window
 *  (shown full screen), the enemies are redrawn underneath (0F:6086), the window is turned off
 *  and the enemy area lightens from black (0D:542A); then the window rows are restored and,
 *  in battles of kind 2 (D98B), the backdrop pattern redrawn (0F:608F). */
export function* restoreEnemies(e: Engine): Co {
  const g = e.g, m = g.m;
  yield* saveWindow(g);
  yield* r00_00AC(g, 0x9800, 0x9c00, 0x240);
  yield* windowFull(g);
  yield* farcall(m, 0x0f, 0x6086, 0, () => drawEnemies(g));
  yield* vsync(g);
  m.wr(0xff40, 0xc3);
  paletteBand(g, 0);
  yield* lighten(g);
  yield* restoreWindow(g);
  if (m.rd(0xd98b) !== 2) return;
  yield* farcall(m, 0x0f, 0x608f, 2, () => patternRows(g, 0x9900, 5));
}

/** 0D:547A — effect 0x12: horizontal wobble (SCX +n, 0, -n per frame, n rising to 8 and
 *  back), twice (0D:5483). */
function* waveX(g: Game): Co {
  const m = g.m;
  m.hram[H90] = 0;
  m.hram[H91] = 0;
  for (let r = 0; r < 2; r++) {
    m.hram[H92] = 0;
    for (;;) {
      yield* vsync(g);
      m.wr(0xff43, m.hram[H90]!);
      yield* vsync(g);
      m.wr(0xff43, 0);
      yield* vsync(g);
      m.wr(0xff43, -m.hram[H90]! & 0xff);
      if (m.hram[H92]) break;
      if (!m.hram[H91]) {
        let a: number = m.hram[H90]! + 1;
        if (a >= 8) { m.hram[H91] = 1; a = 8; }
        m.hram[H90] = a;
      } else {
        let a: number = m.hram[H90]! - 1;
        if (a < 0) { m.hram[H92] = 0xff; m.hram[H91] = 0; a = 0; }
        m.hram[H90] = a;
      }
    }
  }
}

/** 0D:569C — effect 0x09: a black band at lines 0x2F-0x30 for 15 frames (palettes 0 at LY
 *  0x2F, back to D2/D2/16 at LY 0x31, polled). */
function* bandFlash(g: Game): Co {
  const m = g.m;
  yield* vsync(g);
  let n = 15;
  g.lineHook = (ly) => {
    if (ly === 0x2f) setPal(m, 0);
    else if (ly === 0x31) {
      m.wr(0xff47, 0xd2); m.wr(0xff48, 0xd2); m.wr(0xff49, 0x16);
      if (!--n) g.lineHook = null;
    }
  };
  for (let i = 0; i < 14; i++) yield;
}

// ---------------------------------------------------------------- enemy image effects

/** Groups an enemy-image effect applies to: CFF5 = 9 all present groups (FF90 = k), else
 *  group CFF5 - 5. */
function* eachTarget(m: Memory, f: () => Co): Co {
  const t = m.rd(0xcff5);
  if (t === 9) {
    for (let k = 0; k < 3; k++) {
      m.hram[H90] = k;
      if (nonEmpty(m, k)) yield* f();
    }
  } else {
    m.hram[H90] = (t - 5) & 0xff;
    yield* f();
  }
}

/** 0D:5513 — effect 0x06: the target enemies rise out of view (0D:5533); 0F:6083 later slides
 *  them back in (D986 = 1). */
function* liftEnemies(e: Engine): Co {
  yield* eachTarget(e.g.m, () => liftGroup(e));
}

const ptr = (m: Memory, a: number) => m.rd(a) | (m.rd(a + 1) << 8);
const setPtr = (m: Memory, a: number, v: number) => { m.wr(a, v & 0xff); m.wr(a + 1, (v >> 8) & 0xff); };

/** 0D:5533 — group FF90 moves up 7 rows (redrawn a row higher per step, 0F:6089) while its
 *  rows are blanked from the bottom; D986 + k = 1. */
function* liftGroup(e: Engine): Co {
  const g = e.g, m = g.m;
  const k = m.hram[H90]!;
  let hl = farcallSync(m, 0x0f, 0x6095, k, () => groupMapAddr(m, k));
  hl = (hl - 0x20) & 0xffff;
  setPtr(m, 0xd975, hl);
  const w = m.rd(0xd927 + ((2 * k) & 0xff)), h = m.rd(0xd928 + ((2 * k) & 0xff));
  setPtr(m, 0xd977, (hl + h * 32) & 0xffff);
  m.hram[H91] = 7;
  m.hram[H92] = 8;
  do {
    if (m.hram[H91]) {
      const t = farcallSync(m, 0x0f, 0x608c, m.hram[H91]!, () => groupTiles(m));
      const p = ptr(m, 0xd975);
      yield* farcall(m, 0x0f, 0x6089, p & 0xff, () => drawTiles(g, p, t.d, t.c, t.b));
      setPtr(m, 0xd975, (ptr(m, 0xd975) - 0x20) & 0xffff);
      m.hram[H91] = (m.hram[H91]! - 1) & 0xff;
    }
    if (m.hram[H91]! < 5 && m.hram[H92]) {
      const p = ptr(m, 0xd977);
      yield* vsync(g);
      fill(m, p, loop8(w), 0xff);
      setPtr(m, 0xd977, (ptr(m, 0xd977) - 0x20) & 0xffff);
      m.hram[H92] = (m.hram[H92]! - 1) & 0xff;
    }
  } while (m.hram[H91] || m.hram[H92]);
  m.wr(0xd986 + m.hram[H90]!, 1);
}

/** 0D:55DC — effect 0x07: the target enemy images roll up through themselves three times
 *  (map rows buffered at C800 + 0x100 k, 0D:5655/561B/563C). */
function* rollEnemies(e: Engine): Co {
  yield* eachTarget(e.g.m, () => rollGroup(e));
}

/** 0D:567C — width b, height c of group FF90. */
function groupWH(m: Memory): { b: number; c: number } {
  const k = m.hram[H90]!;
  return { b: m.rd(0xd927 + ((2 * k) & 0xff)), c: m.rd(0xd928 + ((2 * k) & 0xff)) };
}

/** 0D:566B — map address of group FF90 (0F:6095) and its buffer C800 + 0x100 k. */
function rollSetup(m: Memory): { hl: number; de: number; b: number; c: number } {
  const { b, c } = groupWH(m);
  const k = m.hram[H90]!;
  const hl = farcallSync(m, 0x0f, 0x6095, k, () => groupMapAddr(m, k));
  return { hl, de: ((0xc8 + k) & 0xff) << 8, b, c };
}

function* rollGroup(e: Engine): Co {
  const g = e.g, m = g.m;
  // 0D:5655: save the image rows into the buffer
  {
    const s = rollSetup(m);
    yield* vramBegin(g);
    let hl = s.hl, de = s.de, c = loop8(s.c);
    do {
      copy(m, hl, de, loop8(s.b));
      de = (de + loop8(s.b)) & 0xffff;
      hl = (hl + 0x20) & 0xffff;
    } while (--c);
    yield* vramEnd(g);
  }
  for (let r = 0; r < 3; r++) {
    let c = loop8(groupWH(m).c);
    do {
      // 0D:561B: rotate the buffer up one row
      const { b: w } = groupWH(m);
      const k = m.hram[H90]!;
      const n = m.rd(0xd92e + ((2 * k) & 0xff));
      m.hram[H91] = n;
      const buf = ((0xc8 + k) & 0xff) << 8;
      copy(m, buf, buf | n, loop8(w));
      copy(m, buf | w, buf, loop8(n));
      // 0D:563C: show it
      const s = rollSetup(m);
      yield* vramBegin(g);
      let hl = s.hl, de = s.de, rows = loop8(s.c);
      do {
        copy(m, de, hl, loop8(s.b));
        de = (de + loop8(s.b)) & 0xffff;
        hl = (hl + 0x20) & 0xffff;
      } while (--rows);
      yield* vramEnd(g);
    } while (--c);
  }
}

/** 0D:5687 — effect 0x08: the target group is removed (D001 + 0x100 CFF5 = 0, i.e. its
 *  count) and the enemy display updated (0F:6083: vanish animation). */
function* killTarget(e: Engine): Co {
  const m = e.g.m;
  const t = m.rd(0xcff5);
  if (t === 9) return;
  const h = (0xd0 + t) & 0xff;
  m.wr((h << 8) | 0x01, 0);
  yield* farcall(m, 0x0f, 0x6083, h, () => updateEnemies(e, h));
}

// ---------------------------------------------------------------- particle effects

/** 0D:603E — clear the particle slots C800-C93F, offsets C940-C98F = 0x80 (none). */
function clearParticles(m: Memory): void {
  fill(m, 0xc800, 0x140, 0);
  fill(m, 0xc940, 0x50, 0x80);
}

/** 0D:6031 — clear, then delays C800-C809 from hl (bank 0D). */
function particleDelays(m: Memory, hl: number): void {
  clearParticles(m);
  for (let i = 0; i < 10; i++) m.wr(0xc800 + i, m.romAt(0x0d, hl + i));
}

/** 0D:5E89 — b random delays C800+ (stream 0x32, range e..d). */
function randomDelays(m: Memory, b: number, d: number, e: number): void {
  for (let i = 0; i < b; i++) m.wr(0xc800 + i, rand(m, 0x32, e, d));
}

/** 0D:604E — particle FF90 is done. */
function particleDone(m: Memory): void {
  m.wr(0xc828 + m.hram[H90]!, 0xff);
}

/** 0D:5FBC — the particle engine: each frame (sprite page rebuilt from CC00) every live slot
 *  k < C994 whose delay C800 has run out is drawn (sprite C8C8 at C850 + C940 - 0x80) and
 *  moved by handler C992; then handler C993 runs (frame waits), until every slot is done
 *  (C828 = FF). */
function* particles(e: Engine): Co {
  const g = e.g, m = g.m;
  for (;;) {
    clearSprites(m);
    setPointer(m, 0xcc00);
    let k = 0;
    do {
      m.hram[H90] = k;
      if (!m.rd(0xc800 + k) && !m.rd(0xc828 + k)) {
        let c = m.rd(0xc850 + 2 * k), b = m.rd(0xc851 + 2 * k);
        c = (m.rd(0xc940 + 2 * k) - 0x80 + c) & 0xff;
        b = (m.rd(0xc941 + 2 * k) - 0x80 + b) & 0xff;
        composeAtPointer(m, m.rd(0xc8c8 + k), b, c);
        yield* particleHandler(e, m.rd(0xc992));
      }
      k = m.hram[H90]!;
      if (m.rd(0xc800 + k)) m.wr(0xc800 + k, m.rd(0xc800 + k) - 1);
      k = (k + 1) & 0xff;
    } while (k < m.rd(0xc994));
    yield* particleHandler(e, m.rd(0xc993));
    if (particlesDone(m) === 0) return yield* hideSprites(g);
  }
}

/** 0D:6057 — AND of the done flags C828 + k (k < C994), plus 1: 0 (Z) when every slot is done. */
export function particlesDone(m: Memory): number {
  let c = 0xff, n = loop8(m.rd(0xc994));
  for (let i = 0; i < n; i++) c &= m.rd(0xc828 + i);
  return (c + 1) & 0xff;
}

/** 0D:6028 — particle handlers (table 0D:5E96). */
function* particleHandler(e: Engine, a: number): Co {
  const g = e.g, m = g.m;
  switch (a) {
    case 0x00: return; // 0D:5EB4
    case 0x01: return riseSwing(m);
    case 0x02: return yield* blinkTiles(g);
    case 0x03: return slideSwing(m);
    case 0x04: return yield* countdownAll(g);
    case 0x05: return yield* sparkle(g, m.hram[H92]!, 3, 0x10, 4, false);
    case 0x06: return fall(m);
    case 0x07: return yield* respawnFall(g);
    case 0x08: return yield* sparkle(g, 4, 2, 0x12, 6, true);
    case 0x09: return rise(m);
    case 0x0a: return yield* spriteFrames(g, 2);
    case 0x0b: return yield* bubbles(g);
    case 0x0c: return orbit(m);
    case 0x0d: return yield* orbitTimer(g);
    case 0x0e: return yield* spiral(g);
  }
  throw new Error(`particle handler ${a}`);
}

/** 0D:5852 — y -= 4 (done at the top); x offset swings between 0x78 and 0x88 by 2. */
function riseSwing(m: Memory): void {
  const k = m.hram[H90]!;
  const y = m.rd(0xc851 + 2 * k) - 4;
  if (y < 0) return particleDone(m);
  m.wr(0xc851 + 2 * k, y);
  const o = 0xc940 + 2 * k;
  if (!m.rd(0xc8a0 + k)) {
    const v = (m.rd(o) + 2) & 0xff;
    m.wr(o, v);
    if (v < 0x89) return;
    m.wr(o, 0x88);
    m.wr(0xc8a0 + k, 1);
  } else {
    const v = (m.rd(o) - 2) & 0xff;
    m.wr(o, v);
    if (v >= 0x78) return;
    m.wr(o, 0x78);
    m.wr(0xc8a0 + k, 0);
  }
}

/** 0D:58AA — 2 frames; every other 4 frames the 10 sprites C8C8 alternate between 3 and 4. */
function* blinkTiles(g: Game): Co {
  const m = g.m;
  yield* spriteFrames(g, 2);
  m.hram[H91] = (m.hram[H91]! + 1) & 0xff;
  if (m.hram[H91]! & 4) return;
  for (let i = 0; i < 10; i++) m.wr(0xc8c8 + i, m.rd(0xc8c8 + i) >= 4 ? 3 : 4);
}

/** 0D:5919 — x += 6 (done past 0x90); y offset swings between 0x78 and 0x88 by 1. */
function slideSwing(m: Memory): void {
  const k = m.hram[H90]!;
  const x = (m.rd(0xc850 + 2 * k) + 6) & 0xff;
  m.wr(0xc850 + 2 * k, x);
  if (x >= 0x91) return particleDone(m);
  const o = 0xc941 + 2 * k;
  if (!m.rd(0xc8a0 + k)) {
    const v = (m.rd(o) + 1) & 0xff;
    m.wr(o, v);
    if (v < 0x88) return;
    m.wr(o, 0x88);
    m.wr(0xc8a0 + k, 1);
  } else {
    const v = (m.rd(o) - 1) & 0xff;
    m.wr(o, v);
    if (v >= 0x78) return;
    m.wr(o, 0x78);
    m.wr(0xc8a0 + k, 0);
  }
}

/** 0D:5961 — 2 frames; after C995 of them all slots are done. */
function* countdownAll(g: Game): Co {
  const m = g.m;
  yield* spriteFrames(g, 2);
  const n = (m.rd(0xc995) - 1) & 0xff;
  m.wr(0xc995, n);
  if (n) return;
  fill(m, 0xc828, 0x28, 0xff);
}

/** 0D:5A52 (frames FF92, phases 3, x 0..0x10, y 0..4, sprite = phase) and 0D:5BBF (4 frames,
 *  phases 2, x 0..0x12, y 0..6, sprite = phase + 0x0A): sparkles at random places; C995 counts
 *  the bursts left. */
function* sparkle(g: Game, frames: number, phases: number, xr: number, yr: number, plus10: boolean): Co {
  const m = g.m;
  yield* spriteFrames(g, frames);
  let k = 0;
  do {
    m.hram[H91] = k;
    if (!m.rd(0xc800 + k)) {
      const p = (m.rd(0xc8a0 + k) + 1) & 0xff;
      m.wr(0xc8a0 + k, p);
      if (p >= phases) {
        m.wr(0xc8a0 + k, 0xff);
        m.wr(0xc800 + k, 1);
        const n = m.rd(0xc995);
        let done = true;
        if (n) {
          m.wr(0xc995, n - 1);
          if (n - 1) done = false;
        }
        if (done) m.wr(0xc828 + k, 0xff);
      } else {
        if (!p) {
          const x = (rand(m, 0x30, 0, xr) * 8) & 0xff;
          const y = (rand(m, 0x31, 0, yr) * 8) & 0xff;
          m.wr(0xc850 + 2 * k, x);
          m.wr(0xc851 + 2 * k, y);
        }
        const c = m.rd(0xc8a0 + k);
        m.wr(0xc8c8 + k, plus10 ? c + 0x0a : c);
      }
    }
    k = (m.hram[H91]! + 1) & 0xff;
  } while (k < m.rd(0xc994));
}

/** 0D:56FB — y += 12; past 0x38 the slot waits again (C800 = 1, phase FF) while C995 bursts
 *  remain, else it is done. */
function fall(m: Memory): void {
  const k = m.hram[H90]!;
  const y = (m.rd(0xc851 + 2 * k) + 0x0c) & 0xff;
  if (y < 0x39) {
    m.wr(0xc851 + 2 * k, y);
    return;
  }
  const n = m.rd(0xc995);
  if (!n) return particleDone(m);
  m.wr(0xc995, n - 1);
  m.wr(0xc800 + k, 1);
  m.wr(0xc8a0 + k, 0xff);
}

/** 0D:5723 — one frame; waiting slots restart at a random x (stream 0x33, 0..0x13) from the
 *  top; then a frame wait. */
function* respawnFall(g: Game): Co {
  const m = g.m;
  yield* spriteFrames(g, 1);
  let k = 0;
  do {
    m.hram[H91] = k;
    if (!m.rd(0xc800 + k)) {
      const p = (m.rd(0xc8a0 + k) + 1) & 0xff;
      m.wr(0xc8a0 + k, p);
      if (!p) {
        m.wr(0xc850 + 2 * k, (rand(m, 0x33, 0, 0x13) * 8) & 0xff);
        m.wr(0xc851 + 2 * k, 0);
      }
    }
    k = (m.hram[H91]! + 1) & 0xff;
  } while (k < m.rd(0xc994));
  yield* vsync(g);
}

/** 0D:57B5 — y offset -= 3; done below 0x70. */
function rise(m: Memory): void {
  const k = m.hram[H90]!;
  const o = 0xc941 + 2 * k;
  const v = (m.rd(o) - 3) & 0xff;
  if (v < 0x70) return particleDone(m);
  m.wr(o, v);
}

/** 0D:59AE — 4 frames; bubbles at random x (stream 0x30, 0..4, x 32) for C995 bursts. */
function* bubbles(g: Game): Co {
  const m = g.m;
  yield* spriteFrames(g, 4);
  let k = 0;
  do {
    m.hram[H91] = k;
    if (!m.rd(0xc800 + k)) {
      const p = (m.rd(0xc8a0 + k) + 1) & 0xff;
      m.wr(0xc8a0 + k, p);
      if (p) {
        m.wr(0xc8a0 + k, 0xff);
        m.wr(0xc800 + k, 1);
        const n = m.rd(0xc995);
        let done = true;
        if (n) {
          m.wr(0xc995, n - 1);
          if (n - 1) done = false;
        }
        if (done) m.wr(0xc828 + k, 0xff);
      } else {
        const x = (rand(m, 0x30, 0, 4) * 32) & 0xff; // 00:004C: five add a
        m.wr(0xc850 + 2 * k, x);
        m.wr(0xc851 + 2 * k, 0);
        m.wr(0xc8c8 + k, 6);
      }
    }
    k = (m.hram[H91]! + 1) & 0xff;
  } while (k < m.rd(0xc994));
}

/** 0D:5DD3 — orbit: angle C8A0 (+0x10 per frame), radius FF91, around (0x44, 0x14);
 *  sprite 0x13/0x14 alternating. */
function orbit(m: Memory): void {
  const k = m.hram[H90]!;
  const p = polar(m, m.rd(0xc8a0 + k), m.hram[H91]!, 0x14, 0x44);
  m.wr(0xc8a0 + k, m.rd(0xc8a0 + k) + 0x10);
  m.wr(0xc850 + 2 * k, p.c);
  m.wr(0xc851 + 2 * k, p.b);
  m.wr(0xc8c8 + k, m.rd(0xc8c8 + k) === 0x13 ? 0x14 : 0x13);
}

/** 0D:5E08 — 2 frames; the radius FF91 grows to 0x28, then all 4 slots are done. */
function* orbitTimer(g: Game): Co {
  const m = g.m;
  yield* spriteFrames(g, 2);
  const r = (m.hram[H91]! + 1) & 0xff;
  m.hram[H91] = r;
  if (r < 0x28) return;
  fill(m, 0xc828, 4, 0xff);
}

/** 0D:5AFB — spiral: one frame; new particles get a random angle (stream 0x30) and radius
 *  0x10-0x40 (stream 0x31) around (0x4C, 0x1C); the radius shrinks by 8 per frame. */
function* spiral(g: Game): Co {
  const m = g.m;
  yield* vsync(g);
  m.wr(0xff46, 0xcc);
  let k = 0;
  do {
    m.hram[H91] = k;
    if (!m.rd(0xc800 + k)) {
      const p = (m.rd(0xc8a0 + k) + 1) & 0xff;
      m.wr(0xc8a0 + k, p);
      if (!p) {
        m.wr(0xc8f0 + k, rand(m, 0x30, 0, 0xff));
        m.wr(0xc918 + k, rand(m, 0x31, 0x10, 0x40));
      }
      const q = polar(m, m.rd(0xc8f0 + k), m.rd(0xc918 + k), 0x1c, 0x4c);
      m.wr(0xc850 + 2 * k, q.c);
      m.wr(0xc851 + 2 * k, q.b);
      m.wr(0xc8c8 + k, (m.rd(0xc8a0 + k) & 1) + 8);
      let r = m.rd(0xc918 + k) - 8;
      if (r < 0) {
        m.wr(0xc828 + k, 0xff);
        r = 0;
      }
      m.wr(0xc918 + k, r);
    }
    k = (m.hram[H91]! + 1) & 0xff;
  } while (k < m.rd(0xc994));
}

/** 0D:5F61 — polar to screen: c = c0 + d cos(e), b = b0 + d sin(e) (0D:5F78 with the sine
 *  table 0F:4100). */
export function polar(m: Memory, e: number, d: number, b0: number, c0: number): { b: number; c: number } {
  const c = (scaledSine(m, (e + 0x40) & 0xff, d) + c0) & 0xff;
  const b = (scaledSine(m, e, d) + b0) & 0xff;
  return { b, c };
}

/** 0D:5F78 — sine(a) (0F:4100, signed) x d / 0x7F, truncated toward zero (0D:5F9B). */
function scaledSine(m: Memory, a: number, d: number): number {
  const s = m.romAt(0x0f, 0x4100 + a);
  const mag = s & 0x80 ? (-s) & 0xff : s;
  const q = div16by8(mul8(d, mag), 0x7f).q;
  const l = q & 0xff;
  return s & 0x80 ? (-l) & 0xff : l;
}

/** 0D:5F9B — hl / a by restoring division with the quotient bits inverted (as the original). */
export function div16by8(hl: number, e: number): { q: number; r: number } {
  const d = (-e) & 0xff;
  let a = 0, h = (hl >> 8) & 0xff, l = hl & 0xff, cy = 0;
  for (let i = 0; i < 16; i++) {
    // sla l; rl h; rla
    let c1 = l >> 7; l = (l << 1) & 0xff;
    const c2 = h >> 7; h = ((h << 1) | c1) & 0xff;
    c1 = a >> 7; a = ((a << 1) | c2) & 0xff;
    void c1;
    const s = a + d;
    cy = s > 0xff ? 1 : 0;
    a = s & 0xff;
    if (!cy) {
      a = (a + e) & 0xff;
      l = (l + 1) & 0xff;
    }
  }
  return { q: (~((h << 8) | l)) & 0xffff, r: a };
}

/** 0D:56C1 — effect 0x0B: 20 drops (sprite 0x0C, tiles 04:7100) fall from random delays. */
function* fx56C1(e: Engine): Co {
  const m = e.g.m;
  yield* loadSpriteTiles(e.g, 0x7100, 0x10);
  clearParticles(m);
  fill(m, 0xc8c8, 0x28, 0x0c);
  fill(m, 0xc8a0, 0x28, 0xff);
  randomDelays(m, 0x14, 0x40, 0x01);
  m.wr(0xc992, 6); m.wr(0xc993, 7);
  m.wr(0xc994, 0x14); m.wr(0xc995, 0x28);
  yield* particles(e);
}

/** 0D:58CE — effect 0x21: 10 particles slide right in waves (tiles 04:6EA0). */
function* fx58CE(e: Engine): Co {
  const m = e.g.m;
  yield* loadSpriteTiles(e.g, 0x6ea0, 0x40);
  particleDelays(m, 0x5f27);
  for (let i = 0; i < 0x14; i++) m.wr(0xc850 + i, m.romAt(0x0d, 0x5f3b + i));
  for (let c = 0; c < 10; c++) m.wr(0xc8c8 + c, (c & 1) + 6);
  let a = 0;
  for (let i = 0; i < 10; i++) { a ^= 1; m.wr(0xc8a0 + i, a); }
  m.wr(0xc992, 3); m.wr(0xc993, 4);
  m.wr(0xc994, 0x0a); m.wr(0xc995, 0x14);
  yield* particles(e);
}

/** 0D:5760 — effect 0x0C: 0D:58CE, then a sprite rises from each enemy group (tiles 04:64E0,
 *  04:65F0). */
function* fx5760(e: Engine): Co {
  const g = e.g, m = g.m;
  yield* fx58CE(e);
  const r = yield* loadSpriteTiles(g, 0x64e0, 0x50);
  yield* loadSpriteTiles(g, 0x65f0, 0x10, r.de);
  clearParticles(m);
  // 0D:57CB: one slot per present group, at its centre column
  m.hram[H91] = 0;
  let a = 0;
  while (!nonEmpty(m, a)) a = (a + 1) & 0xff;
  for (;;) {
    m.hram[H90] = a;
    const c = m.rd(0xd933 + a);
    const p = 0xc850 + 2 * m.hram[H91]!;
    m.wr(p, ((c - 2) * 8) & 0xff);
    m.wr(p + 1, 0x10);
    m.hram[H91] = (m.hram[H91]! + 1) & 0xff;
    a = m.hram[H90]!;
    if (a >= 2) break;
    let found = false;
    for (;;) {
      a = (a + 1) & 0xff;
      if (nonEmpty(m, a)) { found = true; break; }
      if (a >= 2) break;
    }
    if (!found) break;
  }
  const c = m.hram[H91]!;
  if (c === 3) m.wr(0xc853, 0x20);
  for (let i = c; i !== 3; i = (i + 1) & 0xff) m.wr(0xc828 + i, 0xff);
  for (let i = 0; i < 3; i++) { m.wr(0xc8c8 + i, 5); m.wr(0xc800 + i, 0); }
  m.wr(0xc992, 9); m.wr(0xc993, 0x0a);
  m.wr(0xc994, 3);
  yield* particles(e);
}

/** 0D:5801 — effect 0x11: 0D:58CE, then 10 particles rise swinging (tiles 04:64B0). */
function* fx5801(e: Engine): Co {
  const g = e.g, m = g.m;
  yield* fx58CE(e);
  yield* loadSpriteTiles(g, 0x64b0, 0x30);
  particleDelays(m, 0x5f13);
  for (let i = 0; i < 10; i++) {
    m.wr(0xc850 + 2 * i, m.romAt(0x0d, 0x5f1d + i));
    m.wr(0xc851 + 2 * i, 0x30);
  }
  for (let c = 0; c < 10; c++) m.wr(0xc8c8 + c, (c & 1) + 3);
  let a = 0;
  for (let i = 0; i < 10; i++) { m.wr(0xc8a0 + i, a); a ^= 1; }
  m.hram[H91] = 0;
  m.wr(0xc992, 1); m.wr(0xc993, 2);
  m.wr(0xc994, 6);
  yield* particles(e);
}

/** 0D:5975 — effect 0x0D: bubbles (tiles 04:73A0). */
function* fx5975(e: Engine): Co {
  const m = e.g.m;
  yield* loadSpriteTiles(e.g, 0x73a0, 0x40);
  clearParticles(m);
  for (let i = 0; i < 10; i++) m.wr(0xc800 + i, rand(m, 0x32, 1, 5));
  fill(m, 0xc8a0, 0x28, 0xff);
  m.wr(0xc992, 0); m.wr(0xc993, 0x0b);
  m.wr(0xc994, 5); m.wr(0xc995, 0x0a);
  yield* particles(e);
}

/** 0D:5A1A (effect 0x0E: FF90 = 0x10 bursts, 2 frames) / 0D:5A10 (effect 0x13: 8 bursts,
 *  1 frame) — sparkles (tiles 04:6330 + 04:6440). */
function* fx5A1A(e: Engine, n: number, frames: number): Co {
  const m = e.g.m;
  m.hram[H90] = n;
  m.hram[H92] = frames;
  yield* sparkleTiles(e.g);
  clearParticles(m);
  for (let i = 0; i < 3; i++) m.wr(0xc800 + i, i + 1);
  fill(m, 0xc8a0, 0x28, 0xff);
  m.wr(0xc992, 0); m.wr(0xc993, 5);
  m.wr(0xc994, 3); m.wr(0xc995, m.hram[H90]!);
  yield* particles(e);
}

/** 0D:5CFE — tiles 04:6330 (0x90 bytes) and 04:6440 (0x60) to 8000. */
function* sparkleTiles(g: Game): Co {
  const r = yield* loadSpriteTiles(g, 0x6330, 0x90);
  yield* loadSpriteTiles(g, 0x6440, 0x60, r.de);
}

/** 0D:5ACE — 40 particles spiral inwards (tiles 04:7930), random delays 1-16. */
function* fx5ACE(e: Engine): Co {
  const m = e.g.m;
  yield* loadSpriteTiles(e.g, 0x7930, 0x20);
  clearParticles(m);
  fill(m, 0xc8a0, 0x28, 0xff);
  randomDelays(m, 0x28, 0x10, 0x01);
  m.wr(0xc992, 0); m.wr(0xc993, 0x0e);
  m.wr(0xc994, 0x28);
  yield* particles(e);
}

/** 0D:5B86 — effect 0x10: sparkles (tiles 04:6420). */
function* fx5B86(e: Engine): Co {
  const m = e.g.m;
  yield* loadSpriteTiles(e.g, 0x6420, 0x20);
  clearParticles(m);
  for (let i = 0; i < 10; i++) m.wr(0xc800 + i, rand(m, 0x32, 1, 4));
  fill(m, 0xc8a0, 0x28, 0xff);
  m.wr(0xc992, 0); m.wr(0xc993, 8);
  m.wr(0xc994, 0x0a); m.wr(0xc995, 0x0a);
  yield* particles(e);
}

/** 0D:5D87 — effect 0x1C: four sprites orbit a point with a growing radius (tiles 04:7C90),
 *  sound 0x26. */
function* fx5D87(e: Engine): Co {
  const m = e.g.m;
  yield* loadSpriteTiles(e.g, 0x7c90, 0x90);
  clearParticles(m);
  for (let i = 0; i < 4; i++) { m.wr(0xc850 + 2 * i, 0x44); m.wr(0xc851 + 2 * i, 0x14); }
  for (let c = 0; c < 4; c++) m.wr(0xc8c8 + c, (c & 1) + 0x13);
  for (let i = 0, a = 0; i < 4; i++, a += 0x40) m.wr(0xc8a0 + i, a);
  m.hram[H91] = 0;
  m.wr(0xc992, 0x0c); m.wr(0xc993, 0x0d);
  m.wr(0xc994, 4);
  m.hram[0x32] = 0x26; // FFB2: sound effect request
  yield* particles(e);
}

/** 0D:5D23 — sprite a at (FF91, FF90) for 4 frames, then cleared. */
function* flashSprite(g: Game, a: number): Co {
  const m = g.m;
  composeSprite(m, a, m.hram[H91]!, m.hram[H90]!, 0xcc00);
  yield* spriteFrames(g, 4);
  fill(m, 0xcc00, 0xa0, 0);
}

/** 0D:5D0E — sparkle tiles, then sprites 0x00, 0x15, 0x01 at (b, c) for 4 frames each. */
function* flashAt(g: Game, bc: number): Co {
  const m = g.m;
  m.hram[H90] = bc & 0xff;
  m.hram[H91] = bc >> 8;
  yield* sparkleTiles(g);
  yield* flashSprite(g, 0x00);
  yield* flashSprite(g, 0x15);
  yield* flashSprite(g, 0x01);
}

/** 0D:5C38/5C4E/5C65/5C7C (effects 0x15-0x18) — a flash at bc0, then a sprite (FF90) with a
 *  five-step diagonal trail (FF91, direction FF92) from bc (tiles 04:7F40), erased step by
 *  step (0D:5C91). */
function* fx5C91(e: Engine, bc0: number, bc: number, s0: number, s1: number, dir: number): Co {
  const g = e.g, m = g.m;
  yield* flashAt(g, bc0);
  m.hram[H90] = s0;
  m.hram[H91] = s1;
  m.hram[H92] = dir;
  let b = bc >> 8, c = bc & 0xff;
  yield* loadSpriteTiles(g, 0x7f40, 0x30);
  setPointer(m, composeSprite(m, m.hram[H90]!, b, c, 0xcc00));
  yield* spriteFrames(g, 1);
  for (let n = 0; n < 5; n++) {
    switch (m.hram[H92]) {
      case 0: c += 8; b += 8; break;
      case 1: c -= 8; b -= 8; break;
      case 2: c += 8; b -= 8; break;
      default: c -= 8; b += 8; break;
    }
    b &= 0xff; c &= 0xff;
    composeAtPointer(m, m.hram[H91]!, b, c);
    yield* spriteFrames(g, 1);
  }
  fill(m, 0xcc00, 4, 0);
  yield* spriteFrames(g, 1);
  let hl = 0xcc04;
  for (let n = 0; n < 5; n++) {
    fill(m, hl, 0x0c, 0);
    hl += 0x0c;
    yield* spriteFrames(g, 1);
  }
}

/** 0D:5E20 — replace the tiles 9300, 93E0, 94C0 (0x20 bytes each) from hl (bank 04 or WRAM)
 *  inside a VRAM window; returns hl + 0x60. */
function* swapTiles(g: Game, hl: number): Co<number> {
  yield* vramBegin(g);
  for (const de of [0x9300, 0x93e0, 0x94c0]) {
    r00_00B5(g.m, 0x04, hl, de, 0x20);
    hl = (hl + 0x20) & 0xffff;
  }
  yield* vramEnd(g);
  return hl;
}

/** 0D:5D3C — effect 0x19: the tiles 9300/93E0/94C0 are saved to D98C and animated through
 *  04:7D20-7E7F (15 frames each), three flashes of sprite 0x12 (tiles 04:7EA0), then the orbit
 *  effect 0x1C (0D:5D87). */
function* fx5D3C(e: Engine): Co {
  const g = e.g, m = g.m;
  yield* vramBegin(g);
  let hl = 0x9300, de = 0xd98c;
  for (let i = 0; i < 3; i++) {
    copy(m, hl, de, 0x20);
    de += 0x20;
    hl = (hl + 0x20 + 0xc0) & 0xffff;
  }
  yield* vramEnd(g);
  hl = 0x7d20;
  for (let b = 0; b < 4; b++) {
    hl = yield* swapTiles(g, hl);
    yield* spriteFrames(g, 0x0f);
  }
  yield* loadSpriteTiles(g, 0x7ea0, 0x60);
  for (let b = 0; b < 3; b++) {
    composeSprite(m, 0x12, 0x18, 0x48, 0xcc00);
    yield* spriteFrames(g, 4);
    fill(m, 0xcc00, 0xa0, 0);
    yield* spriteFrames(g, 4);
  }
  yield* fx5D87(e);
}

/** 0D:5E53 — effect 0x1A: the tiles 9300/93E0/94C0 animate back (04:7DE0, 7D80, 7D20) and are
 *  restored from D98C (15 frames each). */
function* fx5E53(e: Engine): Co {
  const g = e.g, m = g.m;
  for (let c = 0; c < 4; c++) {
    const hl = m.romAt(0x0d, 0x5efb + 2 * c) | (m.romAt(0x0d, 0x5efc + 2 * c) << 8);
    yield* swapTiles(g, hl);
    yield* spriteFrames(g, 0x0f);
  }
}

// ---------------------------------------------------------------- entries

/** Install the 0D:5000 entry table into the engine (entry addresses as callers use them;
 *  each runs as the original far call: C0E5/C0E7/C0E8, bank 0D mapped, caller's bank restored).
 *  Registers out are written back into `regs` (see docs/BATTLE_ENGINE.md). */
export function installBattleAnim(e: Engine): void {
  const entry = (addr: number, f: (e: Engine, r: Regs) => Co<number | void>) =>
    e.extra.set(0xd0000 | addr, (e, r) => farcall(e.g.m, 0x0d, addr, r.a ?? e.g.m.rd(0xc0e5), () => f(e, r)));
  entry(0x5000, (e) => battleAnimation(e));
  entry(0x5003, (e) => restoreEnemies(e));
  entry(0x5006, function* (e, r) { yield* spriteFrames(e.g, r.b ?? 0); r.b = 0; r.a = 0; return 0; });
  entry(0x5009, function* (e, r) {
    const o = yield* loadSpriteTiles(e.g, r.hl ?? 0, r.b ?? 0);
    r.hl = o.hl; r.d = o.de >> 8; r.e = o.de & 0xff; r.b = 0; r.a = 0x04;
    return 0x04;
  });
  entry(0x500c, function* (e, r) { const o = readBank0F(e.g.m, r.hl ?? 0); r.a = o.a; r.hl = o.hl; return o.a; });
  entry(0x500f, function* (e, r) { r.hl = composeSprite(e.g.m, r.a ?? 0, r.b ?? 0, r.c ?? 0, r.hl ?? 0); return r.a; });
  entry(0x5012, function* (e, r) { r.a = enemyLayout(e.g.m); return r.a; });
  entry(0x5015, function* (e, r) { r.a = enemySizes(e.g.m); return r.a; });
  entry(0x5018, function* (e, r) {
    const o = enemyGraphicSource(e.g.m);
    r.a = o.a; r.hl = o.hl; r.b = o.bc >> 8; r.c = o.bc & 0xff; r.d = o.d;
    return o.a;
  });
}
