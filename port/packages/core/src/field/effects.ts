/** Field screen transitions and their raster (STAT) handlers (bank 0, 00:2B8A-2F7E,
 *  00:3CB4-3E06, 00:3F87). The handlers are registered by their original addresses and run per
 *  line from the frame clock; the transition loops poll for vblank and call the frame tick
 *  (00:16F9) themselves, as the original does.
 *  Timing note: the original writes VRAM a byte at a time during vblank (LY 0x90-0x96); the
 *  number of frames this takes is modelled with a cycle budget per vblank (VblankWriter). */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { vsync } from "../sys.js";
import { frameTick } from "../irq.js";
import { rand } from "../rng.js";
import { fieldFrame, restoreStat, fadeIn, scrollApply } from "./view.js";
import { clearOam } from "./load.js";
import { vramBegin, vramEnd } from "./sprites.js";

// ---------------------------------------------------------------- helpers

/** Frame boundary as polled by the transitions (wait LY < 0x90, then LY >= 0x90). */
const nextFrame = function* (): Co {
  yield;
};

/** Approximates the frames spent writing VRAM only during LY 0x90-0x96 (7 lines of 114 M-cycles). */
class VblankWriter {
  private budget = 0;
  constructor(private readonly cost: number) {}
  *write(): Co {
    if (this.budget < this.cost) {
      yield;
      this.budget = 7 * 114;
    }
    this.budget -= this.cost;
  }
}

function setPalettes(m: Memory, v: number): void {
  m.wr(0xff47, v);
  m.wr(0xff48, v);
  m.wr(0xff49, v);
}

/** 00:2E9C — install raster handler `addr`, saving the vector (C473-C475) and STAT (C476). */
function installRaster(m: Memory, addr: number): void {
  for (let i = 0; i < 3; i++) m.wr(0xc473 + i, m.rd(0xc706 + i));
  m.wr(0xc706, 0xc3);
  m.wr(0xc707, addr & 0xff);
  m.wr(0xc708, addr >> 8);
  m.wr(0xc476, m.rd(0xff41));
  m.wr(0xff41, 0xc0);
}

/** 00:2EEC — LYC 0, restore the saved vector and STAT. */
function removeRaster(m: Memory): void {
  m.io[0x45] = 0;
  for (let i = 0; i < 3; i++) m.wr(0xc706 + i, m.rd(0xc473 + i));
  m.wr(0xff41, m.rd(0xc476));
}

/** 00:2F03 — scroll back from C47A/C47D, BG only, window parked (WY 0x91). */
function screenBack(m: Memory): void {
  m.wr(0xff43, m.rd(0xc47a));
  m.wr(0xff42, m.rd(0xc47d));
  m.wr(0xff40, 0xc3);
  m.wr(0xff4a, 0x91);
}

/** 00:2EE5 */
function rasterDone(m: Memory): void {
  removeRaster(m);
  screenBack(m);
}

/** 00:1674 / 00:1691 around a VRAM fill: a frame wait before and after. */
function* fillWindowMap(g: Game): Co {
  const m = g.m;
  yield* vramBegin(g);
  for (let a = 0x9c00; a < 0xa000; a++) m.wr(a, 0xff);
  yield* vramEnd(g);
}

// ---------------------------------------------------------------- raster handlers

export function installRasterHandlers(g: Game): void {
  const inc = (m: Memory) => { m.io[0x45] = (m.io[0x45]! + 1) & 0xff; };
  // 00:2C27 — closing curtain (event F0 14)
  g.statHandlers.set(0x2c27, (g, ly) => {
    const m = g.m;
    if (ly < 0x48) {
      if (m.rd(0xc479) >= ly) m.wr(0xff4b, 0x07);
      else {
        const c = m.rd(0xc47c);
        m.wr(0xff42, ly < c ? m.rd(0xc47d) : (m.rd(0xc47d) + c - ly) & 0xff);
        m.wr(0xc47c, c + m.rd(0xc47b));
        m.wr(0xff4b, 0xa7);
      }
    } else {
      const l = (0x90 - ly) & 0xff;
      if (m.rd(0xc479) >= l) m.wr(0xff4b, 0x07);
      else {
        const c = m.rd(0xc47c);
        m.wr(0xff42, c >= l ? m.rd(0xc47d) : (m.rd(0xc47d) + 0x90 - c - ly) & 0xff);
        const n = c - m.rd(0xc47b);
        if (n >= 0) m.wr(0xc47c, n);
        m.wr(0xff4b, 0xa7);
      }
    }
    inc(m);
  });
  // 00:2C95 — ripple (screen mode 2): one line moves up, another down, sliding with C464
  g.statHandlers.set(0x2c95, (g, ly) => {
    const m = g.m;
    if (ly < 0x90) {
      const l = ly & 0x1f, p = m.rd(0xc464);
      if (p === l) m.wr(0xff42, m.rd(0xff42) - 1);
      else if (((p + 0x0a) & 0x1f) === l) m.wr(0xff42, m.rd(0xff42) + 1);
    }
    inc(m);
  });
  // 00:2F16 — split opening (event F0 13)
  g.statHandlers.set(0x2f16, (g, ly) => {
    const m = g.m;
    const l0 = ly < 0x48 ? ly : (0x90 - ly) & 0xff;
    const l = (m.rd(0xc479) + l0) & 0xff;
    if (l < 0x51) {
      m.wr(0xff43, m.rd(0xc47a) + l);
      let wx = (0x57 + l) & 0xff;
      if (wx === 0xa6) wx++;
      m.wr(0xff4b, wx);
    }
    inc(m);
  });
  // 00:2F43 — diamond split (events F0 10/11, fade-in mode 1)
  g.statHandlers.set(0x2f43, (g, ly) => {
    const m = g.m;
    const l0 = ly < 0x48 ? ly : (0x90 - ly) & 0xff;
    const c = m.rd(0xc479);
    if (c >= l0) {
      const l = (0x48 - c) & 0xff;
      m.wr(0xff43, m.rd(0xc47a) + l);
      let wx = (0x57 + l) & 0xff;
      if (wx === 0xa6) wx++;
      m.wr(0xff4b, wx);
    } else {
      m.wr(0xff43, m.rd(0xc47a) + 0x50);
      m.wr(0xff4b, 0xa7);
    }
    inc(m);
  });
  // 00:3D7B — wavy fade-in: SCX per line from C540+
  g.statHandlers.set(0x3d7b, (g, ly) => {
    const m = g.m;
    if (ly < 0x90) {
      const i = m.rd(0xc477);
      m.wr(0xff43, m.rd(0xc500 | i));
      m.wr(0xc477, i + 1);
    }
    inc(m);
  });
}

// ---------------------------------------------------------------- transitions

/** 00:2BEE — set up the curtain: window map blank, window on at the right edge. */
function* curtainSetup(g: Game): Co {
  const m = g.m;
  m.wr(0xc462, m.rd(0xc305));
  m.wr(0xc305, m.rd(0xc305) & 0x0f);
  restoreStat(m);
  yield* fillWindowMap(g);
  m.wr(0xff40, 0xe3);
  m.wr(0xff4a, 0);
  m.wr(0xff4b, 0xa7);
  const scy = m.hram[0x41]!, scx = m.hram[0x42]!;
  m.wr(0xff42, scy);
  m.wr(0xc47d, scy);
  m.wr(0xff43, scx);
  m.wr(0xc47a, scx);
}

/** 00:2B8A — closing curtain (event F0 14), about two seconds. */
export function* curtainClose(g: Game): Co {
  const m = g.m;
  clearOam(m);
  yield* curtainSetup(g);
  m.wr(0xc479, 0);
  m.wr(0xc47c, 0);
  m.wr(0xc47b, 2);
  yield* vsync(g);
  scrollApply(m);
  installRaster(m, 0x2c27);
  let d = 0x24;
  for (;;) {
    yield* nextFrame();
    frameTick(g);
    m.wr(0xc47c, 0);
    const n = (m.rd(0xc479) + 1) & 0xff;
    m.wr(0xc479, n);
    if (n !== d) continue;
    d = (d + (d >> 1)) & 0xff;
    const s = (m.rd(0xc47b) << 1) & 0xff;
    m.wr(0xc47b, s);
    if (s === 0x10) break;
  }
  setPalettes(m, 0);
  rasterDone(m);
  m.wr(0xc305, m.rd(0xc462));
}

/** 00:2DDC — copy the right half of the view to the window, blank it in the BG. */
function* splitSetup(g: Game): Co {
  const m = g.m;
  m.wr(0xff42, m.hram[0x41]!);
  m.wr(0xff43, m.hram[0x42]!);
  m.wr(0xc462, m.rd(0xc305));
  m.wr(0xc305, m.rd(0xc305) & 0x0f);
  restoreStat(m);
  yield* fillWindowMap(g);
  const w = new VblankWriter(36);
  const p = m.rd(0xc449);
  let hl = (m.rd(0xc44a) << 8) | (p & 0xe0) | ((p + 0x0b) & 0x1f);
  let de = 0x9c00;
  for (let row = 0; row < 0x12; row++) {
    let h = hl;
    for (let i = 0; i < 0x0b; i++) {
      yield* w.write();
      m.wr(de++, m.rd(h));
      h = (h & 0xffe0) | ((h + 1) & 0x1f);
    }
    de += 0x15;
    hl = ((hl + 0x20) & 0xffff);
    hl = (((hl >> 8) & 0x9b) << 8) | (hl & 0xff);
  }
  m.wr(0xff40, 0xe3);
  m.wr(0xff4a, 0);
  m.wr(0xff4b, 0x57);
  hl = 0x9800 | ((p + 0x0b) & 0x1f);
  for (let row = 0; row < 0x20; row++) {
    let h = hl;
    for (let i = 0; i < 0x15; i++) {
      yield* w.write();
      m.wr(h, 0xff);
      h = (h & 0xffe0) | ((h + 1) & 0x1f);
    }
    hl = (hl + 0x20) & 0xffff;
  }
  const scx = m.hram[0x42]!, scy = m.hram[0x41]!;
  m.wr(0xff43, scx);
  m.wr(0xc47a, scx);
  m.wr(0xff42, scy);
  m.wr(0xc47d, scy);
}

/** 00:2D8F — copy the window half back to the BG view. */
function* splitRestore(g: Game): Co {
  const m = g.m;
  const w = new VblankWriter(36);
  const p = m.rd(0xc449);
  let hl = (m.rd(0xc44a) << 8) | (p & 0xe0) | ((p + 0x0b) & 0x1f);
  let de = 0x9c00;
  for (let row = 0; row < 0x12; row++) {
    let h = hl;
    for (let i = 0; i < 0x0b; i++) {
      yield* w.write();
      m.wr(h, m.rd(de++));
      h = (h & 0xffe0) | ((h + 1) & 0x1f);
    }
    hl = (hl + 0x20) & 0xffff;
    hl = (((hl >> 8) & 0x9b) << 8) | (hl & 0xff);
    de += 0x15;
  }
}

/** 00:2CBE — split opening (event F0 13). */
export function* splitOpen(g: Game): Co {
  const m = g.m;
  clearOam(m);
  yield* splitSetup(g);
  m.wr(0xc479, 0xb0);
  yield* vsync(g);
  scrollApply(m);
  installRaster(m, 0x2f16);
  do {
    yield* nextFrame();
    frameTick(g);
    m.wr(0xc479, m.rd(0xc479) + 8);
  } while (m.rd(0xc479) !== 0x50);
  setPalettes(m, 0);
  rasterDone(m);
  m.wr(0xc305, m.rd(0xc462));
}

/** 00:2D00 — diamond close (event F0 10, after FFC0 = 1). */
export function* diamondClose(g: Game): Co {
  const m = g.m;
  clearOam(m);
  yield* splitSetup(g);
  m.wr(0xc479, 0x48);
  yield* vsync(g);
  scrollApply(m);
  installRaster(m, 0x2f43);
  do {
    yield* nextFrame();
    frameTick(g);
    m.wr(0xc479, m.rd(0xc479) - 1);
  } while (m.rd(0xc479) !== 0xff);
  m.wr(0xff48, 0);
  m.wr(0xff49, 0);
  m.wr(0xff47, 0);
  rasterDone(m);
  m.wr(0xc305, m.rd(0xc462));
}

/** 00:2D41 — diamond open (fade-in mode 1, event F0 11). */
export function* diamondOpen(g: Game): Co {
  const m = g.m;
  m.hram[0x40] = 0;
  yield* splitSetup(g);
  m.wr(0xc479, 0);
  yield* vsync(g);
  scrollApply(m);
  installRaster(m, 0x2f43);
  do {
    yield* nextFrame();
    m.wr(0xff47, 0xd2);
    frameTick(g);
    m.wr(0xc479, m.rd(0xc479) + 1);
  } while (m.rd(0xc479) !== 0x48);
  m.io[0x45] = 0;
  removeRaster(m);
  yield* splitRestore(g);
  screenBack(m);
  m.wr(0xc305, m.rd(0xc462));
  m.wr(0xff48, 0xd2);
  m.wr(0xff49, 0xd2);
}

/** 00:3CB4 — wavy fade-in (FFC0 other than 0/1): 60 frames of per-line SCX offsets from the
 *  sine table 00:1937 (shrinking), palettes 40 → 81 → D2. */
export function* waveIn(g: Game): Co {
  const m = g.m;
  m.hram[0x40] = 0;
  m.wr(0xc479, 0x37);
  const scx = m.hram[0x42]!;
  m.wr(0xff43, scx);
  m.wr(0xc47a, scx);
  yield* vsync(g);
  scrollApply(m);
  installRaster(m, 0x3d7b);
  for (let a = 0x3c; a > 0; a--) {
    const k = (3 - (a >> 4)) & 0xff;
    m.wr(0xc478, k);
    setPalettes(m, k === 3 ? 0xd2 : k === 1 || k === 2 ? 0x81 : 0x40);
    m.wr(0xc477, 0x40);
    let l = m.rd(0xc479);
    for (let i = 0; i < 0x90; i++) {
      let c = m.rd(0x1900 | l);
      c = ((c << 24) >> 24) >> k; // sra k times
      m.wr(0xc540 + i, m.rd(0xc47a) + c);
      l = (l + 1) & 0xff;
      if (m.rd(0x1900 | l) === 0x80) l = 0x37;
    }
    frameTick(g);
    yield* nextFrame();
    l = (m.rd(0xc479) + 1) & 0xff;
    if (m.rd(0x1900 | l) === 0x80) l = 0x37;
    m.wr(0xc479, l);
  }
  for (let i = 0; i < 3; i++) m.wr(0xc706 + i, m.rd(0xc473 + i));
  m.wr(0xff41, m.rd(0xc476));
}

/** 00:3E4C — map fade-in by FFC0: 1 → diamond open, other nonzero → wave, 0 → plain fade. */
export function* fadeInFor(g: Game): Co {
  const v = g.m.hram[0x40]!;
  if (v === 1) yield* diamondOpen(g);
  else if (v) yield* waveIn(g);
  else yield* fadeIn(g);
}

/** 00:3D98 — earthquake (event F0 0C): random +-offsets from 00:3E07, 3 frames each. */
export function* quake(g: Game): Co {
  const m = g.m;
  m.hram[0x32] = 0x27;
  m.wr(0xff43, m.hram[0x42]!);
  m.wr(0xc473, m.hram[0x42]!);
  m.wr(0xff42, m.hram[0x41]!);
  m.wr(0xc474, m.hram[0x41]!);
  for (let p = 0x3e07; m.rd(p); p++) {
    const v = m.rd(p);
    const c = rand(m, 0x0c, 0, 1) === 1 ? v : -v & 0xff;
    const b = rand(m, 0x0d, 0, 1) === 1 ? v : -v & 0xff;
    m.wr(0xff42, m.rd(0xc474) + c);
    m.wr(0xff43, m.rd(0xc473) + b);
    for (let i = 0; i < 3; i++) yield* fieldFrame(g);
  }
  m.wr(0xff43, m.rd(0xc473));
  m.wr(0xff42, m.rd(0xc474));
}

/** 00:3F87 — flash (event F0 12): invert the palettes 3 times (4 frames inverted, 6 normal). */
export function* flash(g: Game): Co {
  const m = g.m;
  m.hram[0x32] = 0x18;
  for (let b = 0; b < 3; b++) {
    setPalettes(m, m.rd(0xff47) ^ 0xff);
    for (let i = 0; i < 4; i++) yield* fieldFrame(g);
    setPalettes(m, m.rd(0xff47) ^ 0xff);
    for (let i = 0; i < 6; i++) yield* fieldFrame(g);
  }
}
