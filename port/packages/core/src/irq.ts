/** The original's interrupt work: the per-frame tick (00:16F9) and the STAT handlers the code
 *  installs at C706. Registered on a Game by `installInterrupts`. */
import type { Game } from "./game.js";
import { sampleJoypad } from "./sys.js";

export class SoftReset extends Error {
  constructor() {
    super("soft reset");
  }
}

/** 00:16F9 — once per frame: sound driver, FFA5 hook, joypad sampling, soft reset check,
 *  FF96 menu-sprite animation. Re-entry is blocked by FF9C. */
export function frameTick(g: Game): void {
  const m = g.m;
  if (m.hram[0x1c]) return;
  m.hram[0x1c] = 1;
  g.hooks.soundTick?.(g);
  if (m.hram[0x25]) g.hooks.statFfa5?.(g);
  if (sampleJoypad(m, g.buttons)) {
    m.hram[0x1c] = 0;
    if (g.hooks.softReset) g.hooks.softReset(g);
    else throw new SoftReset();
    return;
  }
  if (m.hram[0x16]) g.hooks.spriteTickFf96?.(g);
  m.hram[0x1c] = 0;
}

export function installInterrupts(g: Game): void {
  // 00:16D9 — default: frame tick at LY = LYC = 0
  g.statHandlers.set(0x16d9, (g) => {
    frameTick(g);
    g.m.io[0x45] = 0;
    g.m.io[0x0f] = 0;
  });
  // 00:16A8 — installed by 00:1674 while VRAM is accessed: tick at line 0, then every line
  g.statHandlers.set(0x16a8, (g, ly) => {
    if (ly === 0) frameTick(g);
    g.m.io[0x45] = (ly + 1) & 0xff;
  });
}
