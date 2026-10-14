/** Legend III party sprites: the walking figures (00:21A9, timed by 00:2192 every 16 frames),
 *  the cursor step (00:2205) and the sprite tile loads of bank 0B (0B:7DCA). OAM is the buffer
 *  C000 (DMA'd every vblank). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, farSync, farcall, memberOffset, far0Sync, vramCopy } from "./sys.js";
import { battleFigures } from "./bfigures.js";
import { battleOam } from "./misc3.js";

/** 0B:6DC7 — a member's sprite code from its record at hl (C50D + offset): byte 0 & 7 = 2 adds
 *  the rotated high bits of byte 0 to byte 1; the code is 0B:748F[that]. */
export function spriteCode(m: Memory, hl: number): number {
  const b = m.rd(hl), c = m.rd(hl + 1);
  let a = c;
  if ((b & 7) === 2) {
    const sw = ((b << 4) | (b >> 4)) & 0xff;
    a = ((((sw << 1) | (sw >> 7)) & 0x0f) + c) & 0xff;
  }
  return m.romAt(0x0b, 0x748f + a);
}

/** 0B:6D12 — the member count limit + 1 (CD37: D203, else C683); z when 0. */
export function memberLimit(m: Memory): number {
  return ((m.rd(0xcd37) ? m.rd(0xd203) : m.rd(0xc683)) + 1) & 0xff;
}

/** 00:22E9 — the sprite type (0-3: code bits 7-6) of the member drawn at CD3F. */
function spriteType(g: Game): number {
  const m = g.m;
  const r = m.rd(0xcd3f);
  let a = ((r >> 2) | (r << 6)) & 0xff;
  if (a >= 5) a = (a - 5) & 0xff;
  const hl = (memberOffset(m, a) + 0xc50d) & 0xffff;
  pushBank(g, 0x0b);
  const code = spriteCode(m, hl);
  popBank(g);
  return code >> 6;
}

/** The four object entries at p (OAM buffer) of one member, frame A (00:2331/2345/236A) or B
 *  (00:237C/23A3/23CB/23E7) of sprite type t, tiles from CD3F. */
function drawMember(m: Memory, p: number, t: number, frameB: boolean): void {
  const T = m.rd(0xcd3f);
  const tile = (k: number, v: number, attr: number) => { m.wr(p + 4 * k + 2, v & 0xff); m.wr(p + 4 * k + 3, attr); };
  const xs = (k: number, set: boolean) => m.wr(p + 4 * k + 1, set ? m.rd(p + 4 * k + 1) | 1 : m.rd(p + 4 * k + 1) & 0xfe);
  const ys = (k: number, set: boolean) => m.wr(p + 4 * k, set ? m.rd(p + 4 * k) | 2 : m.rd(p + 4 * k) & 0xfd);
  if (!frameB) {
    if (t === 1) { // 00:2345
      for (let k = 0; k < 4; k++) ys(k, false);
      tile(0, T, 0); tile(1, T + 1, 0); tile(2, T, 0x20); tile(3, T + 1, 0x20);
    } else if (t === 2) { // 00:236A
      for (let k = 0; k < 4; k++) tile(k, T + k, 0);
    } else { // 00:2331
      for (let k = 0; k < 4; k++) { xs(k, false); tile(k, T + k, 0); }
    }
    return;
  }
  if (t === 0) { // 00:237C
    xs(0, true); tile(0, T, 0);
    xs(1, true); tile(1, T + 3, 0x20);
    xs(2, true); tile(2, T + 2, 0);
    xs(3, true); tile(3, T + 1, 0x20);
  } else if (t === 1) { // 00:23A3
    for (let k = 0; k < 4; k++) ys(k, true);
    tile(0, T + 2, 0x20); tile(1, T + 3, 0x20); tile(2, T + 2, 0); tile(3, T + 3, 0);
  } else if (t === 2) { // 00:23CB
    tile(0, T + 2, 0x20); tile(1, T + 3, 0x20); tile(2, T, 0x20); tile(3, T + 1, 0x20);
  } else { // 00:23E7
    xs(0, true); tile(0, T + 2, 0x20);
    xs(1, true); tile(1, T + 3, 0x20);
    xs(2, true); tile(2, T, 0x20);
    xs(3, true); tile(3, T + 1, 0x20);
  }
}

/** 00:21A9 — the party's walking figures with the frame counter b (bit 4: the second frame);
 *  members with status bits 6-7 (C501/C502) keep the first frame. CD3C = 1: 3 members from
 *  C050 / tile 14, else 5 from C000 / tile 0; CD3F / CD40 advance per member. */
export function partySprites(g: Game, b: number): void {
  const m = g.m;
  let c: number;
  if (m.rd(0xcd3c) === 1) {
    m.wr(0xcd3f, 0x14); m.wr(0xcd40, 0x50); m.wr(0xcd41, 0xc0); c = 3;
  } else {
    m.wr(0xcd3f, 0x00); m.wr(0xcd40, 0x00); m.wr(0xcd41, 0xc0); c = 5;
  }
  for (;;) {
    const a = ((m.rd(0xcd40) >= 0x50 ? 3 : 5) - c) & 0xff;
    const hl = (memberOffset(m, a) + 0xc501) & 0xffff;
    const still = !!((m.rd(hl) | m.rd(hl + 1)) & 0xc0) || !(b & 0x10);
    const t = spriteType(g);
    drawMember(m, m.rd16(0xcd40), t, !still);
    if (--c === 0) return;
    m.wr(0xcd3f, m.rd(0xcd3f) + 4);
    m.wr(0xcd40, m.rd(0xcd40) + 0x10);
  }
}

/** 00:2205 — the cursor step (CD15 bit 7): C080 8 -> 50, 68 -> 88 or 20 (no member slot left,
 *  0B:6D12), above 68 -> 20, else + 18; with CD45 a cursor at 50 goes back to 8. */
function cursorStep(g: Game): void {
  const m = g.m;
  if (!(m.rd(0xcd15) & 0x80)) return;
  let a = m.rd(0xc080);
  if (a === 0x08) a = 0x50;
  if (a === 0x68) {
    pushBank(g, 0x0b);
    const z = memberLimit(m) === 0;
    popBank(g);
    a = z ? 0x20 : 0x88;
  } else if (a > 0x68) a = 0x20;
  else a = (a + 0x18) & 0xff;
  m.wr(0xc080, a);
  if (!m.rd(0xcd45)) return;
  if (m.rd(0xc080) === 0x50) m.wr(0xc080, 0x08);
}

/** 00:2192 — the frame work of 00:3557 outside the field: (battle: 00:2247), the cursor step,
 *  and every 16 frames the walking figures. */
export function frameSprites(g: Game): void {
  const m = g.m;
  if (m.rd(0xcd37)) {
    if (m.rd(0xcbff)) return;
    battleFigures(g);
  }
  cursorStep(g);
  const b = m.hram[0x13]!;
  if (b & 0x0f) return;
  partySprites(g, b);
}

/** 0B:7E17 — the 4 sprite tiles of the member record at hl (C50D + offset) to de: from bank 04
 *  at (code & 3F | 40) << 8, + 40 for a member with status (C501 & FC | C502 & E0), mirrored then
 *  (each plane pair: low plane shifted out, high plane rotated, 0B:7E5F); CD4D = a (2: + 40).
 *  Returns de after. */
export function* memberTiles(g: Game, a: number, hl: number, de: number): Co<number> {
  const m = g.m;
  yield* g.point(0x0b7e17); // (each member's raw copy before is hblank-paced: CPU time)
  m.wr(0xcd4d, a);
  const st = (m.rd(hl - 12) & 0xfc) | (m.rd(hl - 11) & 0xe0);
  let e = st ? 0x40 : 0;
  if (m.rd(0xcd4d) === 2) e = 0x40;
  const code = farSync(g, 0x0b, () => spriteCode(m, hl));
  const src = (((code & 0x3f) | 0x40) << 8) | e;
  // the raw copy shows over the lines it takes (00:20FF: 5 bytes a line); the read back (with
  // status) sees it whole
  const [, de2] = g.vramPaced(() => {
    const r = far0Sync(g, 0x04, () => vramCopy(m, src, de, 0x40));
    if (st) far0Sync(g, 0, () => vramCopy(m, de, 0xc880, 0x40));
    return r;
  }, de, 0x40);
  yield* g.pacedDone(); // (the copy loop's own time)
  if (!st) return de2;
  for (let p = 0xc880; p < 0xc8c0; p += 2) {
    let lo = m.rd(p), hi = m.rd(p + 1);
    for (let i = 0; i < 8; i++) {
      lo = (lo << 1) & 0xff;
      const c = hi & 0x80;
      hi = (hi << 1) & 0xff;
      if (c) hi |= 1;
    }
    m.wr(p, lo);
    m.wr(p + 1, hi);
  }
  // the copies before are hblank-paced and the plane loop is long: the raw tiles show until the
  // copy back starts (CPU time; sync point 0B:7E7A)
  yield* g.point(0x0b7e7a);
  // the copy back shows over the lines it takes (00:20FF: 5 bytes a line)
  g.vramPaced(() => far0Sync(g, 0, () => vramCopy(m, 0xc880, de, 0x40)), de, 0x40);
  yield* g.pacedDone();
  return de2;
}

/** 0B:7DCA — a = 0: the five members' sprite tiles from 8000, then the shared sprite tiles of
 *  bank 03 (5700 x 40, 5740 x 40, 5780 x 10 twice, 5790, 57A0, 57B0 x 10) from 8180. */
export function* loadSpriteTiles(g: Game, a: number, hlIn = 0, deIn = 0): Co {
  if (a) { yield* memberTiles(g, a, hlIn, deIn); return; } // jp nz,$7E17
  const m = g.m;
  let de = 0x8000;
  for (let k = 0; k < 5; k++) {
    const hl = (memberOffset(m, k) + 0xc50d) & 0xffff;
    de = yield* memberTiles(g, 0, hl, de);
  }
  de = (de + 0x40) & 0xffff;
  for (const [src, n] of [[0x5700, 0x40], [0x5740, 0x40], [0x5780, 0x10], [0x5780, 0x10], [0x5790, 0x10], [0x57a0, 0x10], [0x57b0, 0x10]] as const) {
    [, de] = far0Sync(g, 0x03, () => vramCopy(m, src, de, n));
  }
}

/** 09:40E8 — sprites reset: the sprite tiles (0B:7DCA), the OAM buffer C000 (36 entries at 0, 0
 *  with tiles 0-35; then 4 more with y 0), then (09:4127) the walking figures. */
export function* resetSprites(g: Game): Co {
  const m = g.m;
  yield* farcall(g, 0x0b, () => loadSpriteTiles(g, 0));
  g.ime = false;
  let hl = 0xc000;
  for (let c = 0; c < 0x24; c++) {
    m.wr(hl++, 0); m.wr(hl++, 0); m.wr(hl++, c); m.wr(hl++, 0);
  }
  for (let k = 0; k < 4; k++) { m.wr(hl, 0); hl += 4; }
  if (m.rd(0xcd37)) battleOam(g); // 09:410C
  g.ime = false;
  partySprites(g, m.hram[0x13]!);
  yield* g.reti();
}

