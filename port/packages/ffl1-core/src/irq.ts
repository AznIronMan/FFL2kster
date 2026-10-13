/** Legend I interrupt work: the frame tick 00:06DB (sound driver, joypad, soft reset) and the
 *  two STAT handlers the code installs at C39D. */
import type { Game } from "./game.js";

export class SoftReset extends Error {
  constructor() {
    super("soft reset");
  }
}

/** 00:06DB — once per frame: sound driver (07:4003, the bank switched there and back), joypad.
 *  Joypad (00:06E8): C3A0-C3A3 shift (the overlapping forward copy leaves C3A1..C3A3 = the
 *  previous sample), C3A0 = buttons held now (directions in the high nibble), FF8D =
 *  (C3A3 | C3A2) & C3A1 & C3A0, i.e. held in this and the previous sample. A+B+Select+Start
 *  restarts the game (00:0224). */
export function frameTick(g: Game): void {
  const m = g.m;
  const prev = g.selectBank(0x07);
  g.hooks.soundTick?.(g);
  g.selectBank(prev);
  const old = m.rd(0xc3a0);
  m.wr(0xc3a1, old);
  m.wr(0xc3a2, old);
  m.wr(0xc3a3, old);
  m.wr(0xc3a0, g.buttons & 0xff);
  const v = (m.rd(0xc3a3) | m.rd(0xc3a2)) & m.rd(0xc3a1) & m.rd(0xc3a0);
  m.hram[0x0d] = v;
  m.io[0x00] = 0x30;
  if ((v & 0x0f) === 0x0f) {
    if (g.hooks.softReset) g.hooks.softReset(g);
    else throw new SoftReset();
  }
}

export function installInterrupts(g: Game): void {
  // 00:06D0 — normal: at LY = LYC (0) the frame tick, then LYC = 0, IF = 0 (00:06D3)
  g.statHandlers.set(0x06d0, (g) => {
    frameTick(g);
    g.m.io[0x45] = 0;
    g.m.io[0x0f] = 0;
  });
  // 00:3E8D — the wave (00:3DF5): per line SCX from C600 + FFCB, then LYC + 1, STAT = C0
  g.statHandlers.set(0x3e8d, (g, ly) => {
    const m = g.m;
    if (ly < 0x90) {
      m.io[0x43] = m.rd(0xc600 + m.hram[0x4b]!);
      m.hram[0x4b] = (m.hram[0x4b]! + 1) & 0xff;
    }
    m.io[0x45] = (m.io[0x45]! + 1) & 0xff;
    m.io[0x41] = 0xc0;
  });
  // 00:069F — VRAM access: the frame tick at line 0, LYC = LY + 1 (every line), wait for hblank
  g.statHandlers.set(0x069f, (g, ly) => {
    if (ly === 0) frameTick(g);
    g.m.io[0x45] = (ly + 1) & 0xff;
  });
}
