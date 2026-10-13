/** Legend III interrupt handlers (docs/ffl3/ROM_MAP.md): the normal vblank 00:11A2 and STAT
 *  00:11E3, and the VRAM bracket's vblank 00:1EFA and STAT 00:1F27 (installed by 00:1D9E). */
import type { Game } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, copyB } from "./sys.js";

export class NotPorted extends Error {
  constructor(what: string) {
    super(`not ported yet: ${what}`);
  }
}

/** FF80 (copied from 00:3730) — OAM DMA from C000. */
export function oamDma(m: Memory): void {
  m.wr(0xff46, 0xc0);
}

/** 00:36F1 — joypad (unless CDC2): FF8B = newly pressed, FF8A = held (A, B, Select, Start low;
 *  Right, Left, Up, Down high), P1 = 30. */
export function joypad(g: Game): void {
  const m = g.m;
  if (m.rd(0xcdc2)) return;
  const c = g.buttons & 0xff;
  m.hram[0x0b] = (m.hram[0x0a]! ^ c) & c;
  m.hram[0x0a] = c;
  m.io[0x00] = 0x30;
}

/** 00:1F3A — the sound driver (0F:4006) with bank 0F pushed. */
export function soundTick(g: Game): void {
  pushBank(g, 0x0f);
  g.hooks.soundTick?.(g);
  popBank(g);
}

/** 00:3757 — the tile write list at hl (normal vblank, while a frame wait counts): entries VRAM
 *  address (hi, lo), count | 0x80 for a column, the tiles. Rows wrap within the 32-tile line,
 *  columns within the map (98xx-9Bxx). */
export function tileList(m: Memory, hl: number): void {
  for (;;) {
    const hi = m.rd(hl++);
    if (!hi) return;
    let d = hi, e = m.rd(hl++);
    let b = m.rd(hl) & 0x3f;
    const col = m.rd(hl++) & 0x80;
    do {
      m.wr((d << 8) | e, m.rd(hl++));
      if (col) {
        const s = e + 0x20;
        e = s & 0xff;
        d = (((d + (s >> 8)) & 0x03) | 0x98) & 0xff;
      } else e = (e & 0xe0) | ((e + 1) & 0x1f);
      b = (b - 1) & 0xff;
    } while (b);
  }
}

/** 00:3D2B — scroll registers from FF91 / FF92. */
export function scroll(m: Memory): void {
  m.wr(0xff43, m.hram[0x11]! + 8);
  m.wr(0xff42, m.hram[0x12]! + 0x10);
}

/** 00:108F — screen shake (C6F2): every other frame the scroll moves by 00:10BE / 00:10BA. */
export function shake(m: Memory): void {
  if (!m.rd(0xc6f2)) return;
  const f = m.hram[0x13]!;
  if (f & 1) return;
  const b = (f >> 1) & 3;
  m.wr(0xff42, m.hram[0x12]! + 0x10 + m.rd(0x10be + b));
  m.wr(0xff43, m.hram[0x11]! + 8 + m.rd(0x10ba + b));
}

/** 00:3E26 — the sprite flip animation (CBFF set): every 16 frames DC80 wraps and the pairs of
 *  object entries at DC85 named by the bits of DC81 (DC82 pairs) swap tiles and flip; then DC82
 *  x 8 bytes from DC83 are copied to C078. */
export function spriteFlip(m: Memory): void {
  if (!m.rd(0xcbff)) return;
  const a = (m.rd(0xdc80) + 1) & 0x0f;
  m.wr(0xdc80, a);
  if (!a) {
    let c = m.rd(0xdc81), b = m.rd(0xdc82), hl = 0xdc85;
    do {
      const bit = c & 1;
      c >>= 1;
      if (bit) hl += 8;
      else {
        const t = m.rd(hl + 4);
        m.wr(hl + 4, m.rd(hl));
        m.wr(hl, t);
        const f = m.rd(hl + 5) ^ 0x20;
        m.wr(hl + 5, f);
        m.wr(hl + 1, f);
        hl += 8;
      }
      b = (b - 1) & 0xff;
    } while (b);
  }
  copyB(m, 0xdc83, 0xc078, (m.rd(0xdc82) * 8) & 0xff);
}

/** 00:3549 — while CD3D is set (text, fades): once (CDC5 guards re-entry) 00:3557. The work's
 *  VRAM copies are hblank-paced (00:20FF): with `Game.onWork` the original's end is kept, CDC5
 *  staying set until then (a STAT taken meanwhile, when the work had enabled the interrupts
 *  (01:5730's reti), only ticks the sound). */
export function statWork(g: Game, frameWork: (g: Game) => void): void {
  const m = g.m;
  const n = m.rd(0xcdc5);
  m.wr(0xcdc5, n + 1);
  const dec = () => m.wr(0xcdc5, m.rd(0xcdc5) - 1);
  if (n === 0) {
    const ime = g.ime;
    g.ime = false;
    frameWork(g);
    const end = g.onWork?.();
    const enabled = g.ime;
    g.ime = ime;
    if (end && !g.reachedAt(end)) { g.handlerBusy(end, !enabled, dec); return; }
  }
  dec();
}

export function installInterrupts(g: Game, frameWork: (g: Game) => void): void {
  g.hooks.statWork = (g) => statWork(g, frameWork);
  // 00:11A2 — normal vblank
  g.handlers.set(0x11a2, (g) => {
    const m = g.m;
    if (!m.rd(0xcd39)) oamDma(m);
    joypad(g);
    if (!(m.hram[0x0a]! & 0xf0)) m.wr(0xca26, 0);
    if (m.hram[0x15]) {
      m.hram[0x15]--;
      tileList(m, 0xc100);
      m.wr(0xc100, 0);
      m.hram[0x13] = (m.hram[0x13]! + 1) & 0xff;
      if (!m.hram[0x13]) m.hram[0x14] = (m.hram[0x14]! + 1) & 0xff;
    }
    scroll(m);
    shake(m);
    soundTick(g);
  });
  // 00:11E3 — reti
  g.handlers.set(0x11e3, () => {});
  // 00:1EFA — bracket vblank
  g.handlers.set(0x1efa, (g) => {
    const m = g.m;
    spriteFlip(m);
    if (!m.rd(0xcd39)) oamDma(m);
    joypad(g);
    m.wr(0xcdaf, m.rd(0xcdaf) | m.hram[0x0b]!);
    m.hram[0x13] = (m.hram[0x13]! + 1) & 0xff;
    if (!m.hram[0x13]) m.hram[0x14] = (m.hram[0x14]! + 1) & 0xff;
    if (m.hram[0x15]) m.hram[0x15]--;
  });
  // 00:1F27 — bracket STAT (LYC 3): sound, then 00:3549 while CD3D is set
  g.handlers.set(0x1f27, (g) => {
    soundTick(g);
    if (g.m.rd(0xcd3d)) g.hooks.statWork?.(g);
  });
}
