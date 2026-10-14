/** Legend III battle wipe (01:5EB8, before a battle once story flag 31 is set): with the vblank
 *  and STAT vectors turned into `ret` (the interrupts go off at the first one), the view is drawn
 *  into the window map 9C00, the window shown at WX 57 and blanked tile by tile (one tile per
 *  hblank, 01:6013); then every line's hblank sets WX and SCX from a table C800 (lines 48-8F
 *  mirror 47-00) whose rows grow by 4 from the bottom up, the window sliding off sideways
 *  (01:5ECC); the BG map 9800 blanked, the window off, the vectors back. All of it polls STAT /
 *  LY (no frame waits). */
import type { Game, Co } from "./game.js";
import { fill, windowOn, windowOff } from "./sys.js";
import { oamHideAll } from "./objects.js";
import { drawView, bgAddr } from "./mapload.js";
import { soundMain } from "./battle.js";

/** 00:3A78 (after a wait for mode 2/3, or the hblank of the line after): in line x, the writes
 *  `fn` makes in its hblank showing from the line after (`Game.later`). */
function* inHblank(g: Game, x: number, fn: () => void): Co {
  yield* g.untilLine(x);
  g.later(1, fn);
}

/** 01:6013 — the wipe's start: objects hidden (00:3A24); di, the vblank / STAT vectors `ret`
 *  (00:3D54 / 00:3D68), ei; the view at scroll (A8, F0) drawn into 9C00 (CA2A = 4, 00:0E34),
 *  WX 57, WY 0, window on (00:3A44), the scroll back; then rows C800 = F8, F0+8 .. (C801 = 58):
 *  22 tiles from the map address of (C801, C800) (00:0DE4) set FF, each in the next hblank (a
 *  row start sometimes takes a line more in the original; the replay does not tell). */
export function* wipeStart(g: Game): Co {
  const m = g.m;
  oamHideAll(m);
  g.ime = false;
  m.wr(0xc0b9, 0xc9);
  m.wr(0xc0bc, 0xc9);
  yield* g.reti(); // ei
  const sy = m.hram[0x12]!, sx = m.hram[0x11]!;
  m.hram[0x12] = 0xf0;
  m.hram[0x11] = 0xa8;
  m.wr(0xca2a, 0x04);
  yield* drawView(g);
  m.wr(0xff4b, 0x57);
  m.wr(0xff4a, 0);
  windowOn(m);
  m.hram[0x11] = sx;
  m.hram[0x12] = sy;
  m.wr(0xc800, 0xf8);
  m.wr(0xc801, 0x58);
  do {
    let hl = bgAddr(m, m.rd(0xc801), m.rd(0xc800));
    let x = g.ly;
    for (let b = 0x16; b; b--) {
      x = x >= 0x8f ? 0 : x + 1; // the next line with an hblank
      const a = hl;
      yield* inHblank(g, x, () => m.wr(a, 0xff));
      hl = (hl & 0xff00) | (hl & 0xe0) | ((hl + 1) & 0x1f);
    }
    m.wr(0xc800, (m.rd(0xc800) + 0x08) & 0xff);
  } while (m.rd(0xc800) !== 0xf8);
}

/** 01:5EB8 — the battle wipe: the start (01:6013); C800-C847 = 0, c = SCX, b = WX, d = 48; each
 *  frame (from LY 0): every line's hblank C848 = LY, the row r = LY (48 and above: 8F - LY), WX
 *  = min(C800[r] + b, A5), SCX = C800[r] + c; lines below 48 from d down: C800[r] + 4 while below
 *  54; after line 8F a sound tick (00:3A60), d - 4 (to 0); until C800 reaches 50. Then the BG map
 *  9800 blanked (0F:792C), window off, di, the vectors back (00:3D4E / 00:3D62), ei, a frame. */
export function* battleWipe(g: Game): Co {
  const m = g.m;
  yield* wipeStart(g);
  fill(m, 0xc800, 0x48, 0);
  const c = m.rd(0xff43), b = m.rd(0xff4b);
  let d = 0x48;
  do {
    yield* g.untilLine(0);
    for (let l = 0; l < 0x90; l++) {
      yield* g.untilLine(l);
      m.wr(0xc848, l);
      const r = l < 0x48 ? l : (0x47 - (l - 0x48)) & 0xff;
      const hl = (0xc800 + r) & 0xffff;
      let a = (m.rd(hl) + b) & 0xff;
      if (a >= 0xa6) a = 0xa5;
      const sx = (m.rd(hl) + c) & 0xff;
      g.later(1, () => { m.wr(0xff4b, a); m.wr(0xff43, sx); });
      if (l < 0x48 && l >= d) {
        const v = (m.rd(hl) + 4) & 0xff;
        if (v < 0x54) m.wr(hl, v);
      }
    }
    yield* g.untilLine(0x90); // STAT mode 1
    yield* soundMain(g);
    if (d) d = (d - 4) & 0xff;
  } while (m.rd(0xc800) < 0x50);
  fill(m, 0x9800, 0x0400, 0xff);
  yield* g.point(0x015f2b); // the fill is hblank-paced (14 bytes a line): its end, CPU time
  windowOff(m);
  g.ime = false;
  m.wr(0xc0b9, 0xc3);
  m.wr(0xc0bc, 0xc3);
  yield* g.reti(); // ei
  yield* g.wait(1);
}
