/** Legend III wave fades of the map load (CA6B = 1: 00:03CD out, 00:03E9 in; bank 0F 7E18-7F07):
 *  a STAT raster at every line (0F:7EC2) shifts each line's SCX by a sine table rolled by the frame
 *  counter, its amplitude growing as CDB1 counts down (out) or shrinking as it counts up (in), the
 *  palettes stepped every 6 frames; the frames are counted by polling LY for line 0 (no frame
 *  wait). */
import type { Game, Co } from "./game.js";
import { pushBank, popBank, copy, copyB, bracketEnter, bracketLeave, fadeLevels } from "./sys.js";

/** 0F:7EC2 — the wave's STAT handler (LYC = each line up to CDB3, then CDB2): t = C880[(LY + FF93)
 *  & 1F] (signed), moved toward 0 by CDB1 (|t| < CDB1: 0); SCX = CDB0 + t; LYC + 1. The write
 *  lands near the end of the line's drawing: mostly after it (the value shows from the next line),
 *  before it on lines whose drawing objects lengthen, depending on the handler's path and the
 *  code it interrupted (CPU cycles the port does not count); the port writes it after the line
 *  and records the other outcome (`Game.scxAlt`). */
export function waveRaster(g: Game): void {
  const m = g.m;
  const t = m.rd(0xc880 + ((g.ly + m.hram[0x13]!) & 0x1f));
  const h = m.rd(0xcdb1);
  let e = 0;
  if (t & 0x80) {
    if (((-t) & 0xff) >= h) e = (h + t) & 0xff;
  } else if (t >= h) e = (t - h) & 0xff;
  const x = (m.rd(0xcdb0) + e) & 0xff;
  if (x !== m.rd(0xff43) && g.ly < 144) g.scxAlt[g.ly] = x;
  g.later(1, () => m.wr(0xff43, x));
  const l = (m.rd(0xff45) + 1) & 0xff;
  m.wr(0xff45, m.rd(0xcdb3) < l ? m.rd(0xcdb2) : l);
}

/** 0F:7E18 — the set-up: CDB2 = 0, CDB3 = 8F, WY = 50, the VRAM bracket (00:1D9E), the fade levels
 *  (0F:79AE), the table 0F:7E54 twice at C880-C8BF; di, CDB0 = SCX, CDB1 = 0F, LYC = CDB2, STAT ->
 *  0F:7EC2, reti. */
function* waveBegin(g: Game): Co {
  const m = g.m;
  m.wr(0xcdb2, 0);
  m.wr(0xcdb3, 0x8f);
  m.wr(0xff4a, 0x50);
  yield* bracketEnter(g);
  fadeLevels(m);
  const [, de] = copyB(m, 0x7e54, 0xc880, 0x20);
  copyB(m, 0x7e54, de, 0x20);
  g.ime = false;
  m.wr(0xcdb0, m.rd(0xff43));
  m.wr(0xcdb1, 0x0f);
  m.wr(0xff45, m.rd(0xcdb2));
  m.wr(0xc0bd, 0xc2);
  m.wr(0xc0be, 0x7e);
  yield* g.reti();
}

/** 0F:7E74 — the end: di, LYC 3, STAT -> 00:1F27 (00:1E40), ei, leave the bracket (00:1DFD). */
function* waveEnd(g: Game): Co {
  const m = g.m;
  yield* g.point(0x0f7e74); // after the last sound tick (CPU time): the raster runs until here
  g.ime = false;
  m.wr(0xff45, 0x03);
  copy(m, 0x1e40, 0xc0bc, 3);
  g.ime = true;
  yield* bracketLeave(g);
}

/** 0F:7EAD — poll LY for line 0, then the palettes from CDB4 + 3 e (level e) and a sound tick
 *  (0F:4006). The STAT handler runs at every line, so the code is slow: a long sound tick ends past
 *  the next line 0 and the poll waits a frame more, and the 3-byte palette copy takes lines (the
 *  trace marks its end, 0F:7EBF). With a trace (`Game.onPoint`) the poll ends where the
 *  original's did (sync point 0F:7EB9); in play, at the next line 0. */
function* waveFrame(g: Game, e: number): Co {
  const m = g.m;
  if (g.onPoint) yield* g.point(0x0f7eb9);
  else {
    if (g.ly === 0) yield* g.untilLine(1);
    yield* g.untilLine(0);
  }
  copy(m, (0xcdb4 + 3 * e) & 0xffff, 0xff47, 3);
  g.hooks.soundTick?.(g);
}

/** 0F:7E9D — six frames at palette level e. */
function* waveFrames(g: Game, e: number): Co {
  for (let b = 0; b < 6; b++) yield* waveFrame(g, e);
}

/** 00:03CD — the wave fade out: 0F:7E18; CDB1 down from 0F to 0, six frames each (0F:7E86, level
 *  0); levels 1, 2, 3 six frames each; 0F:7E74. */
export function* waveFadeOut(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x0f);
  yield* g.reti(); // rst $20
  yield* waveBegin(g);
  do {
    yield* waveFrames(g, 0);
    yield* g.point(0x0f7e89); // after the sixth sound tick (CPU time): the lines before keep CDB1
    m.wr(0xcdb1, (m.rd(0xcdb1) - 1) & 0xff);
  } while (m.rd(0xcdb1));
  for (let e = 1; e <= 3; e++) yield* waveFrames(g, e);
  yield* waveEnd(g);
  popBank(g);
  yield* g.reti(); // rst $28
}

/** 00:03E9 — the wave fade in: 0F:7E18, CDB1 = 0; levels 2, 1, 0 six frames each; CDB1 up to 0F,
 *  six frames each (0F:7E8D, level 0); 0F:7E74. */
export function* waveFadeIn(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x0f);
  yield* g.reti(); // rst $20
  yield* waveBegin(g);
  m.wr(0xcdb1, 0);
  for (let e = 2; e >= 0; e--) yield* waveFrames(g, e);
  for (let c = 0; c < 15; c++) {
    yield* g.point(0x0f7e8f); // after the previous sound tick (CPU time)
    m.wr(0xcdb1, (m.rd(0xcdb1) + 1) & 0xff);
    yield* waveFrames(g, 0);
  }
  yield* waveEnd(g);
  popBank(g);
  yield* g.reti(); // rst $28
}
