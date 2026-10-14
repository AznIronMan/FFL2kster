/** Legend III scene events, part 3: the raster quake of event 2C (01:5B4D, with its own vblank
 *  00:11E4 and hblank STAT 00:121D handlers) and the ending of event 10 F (06:7F69: the credits
 *  0B:6C96 over battle scenes, then the last screen and a halt). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, farSync, far0, far0Sync, farcall, copy, fill, fillBC, vramCopy, decompress, bracketEnter,
  bracketLeave, fadeIn, fadeOut, wait1 } from "./sys.js";
import { oamDma, scroll, soundTick } from "./irq.js";
import { fa, fget, fset, setSlot, oamHideAll, drawObject, drawObject4, testFlag } from "./objects.js";
import { objectStep } from "./actors.js";
import { stepSpeed, companionFollow, leaderUp, leaderRight, leaderDown, leaderLeft, leaderShiftUp } from "./events2.js";
import { multiply } from "./math.js";
import { printText, textDelay } from "./text.js";
import { soundMain } from "./battle.js";
import { battleWipe } from "./wipe.js";
import { windowsAll } from "./bmenu.js";
import { formationLayout, monsterPictures, monsterMaps, FORMATION_LAYOUT_SP } from "./bpics.js";
import { battleEffectA } from "./banim.js";
import { windowTop } from "./title.js";
import { windowClear } from "./newgame.js";

// ================================================================ event 2C: the raster quake

// ---------------------------------------------------------------- the hblank STAT source

/** The STAT hblank source (STAT bit 3, mode 0) is not modelled by `Game.runFrame` (it raises
 *  STAT only at LYC): while a quake runs, a chain of timed line works (`Game.at`) requests the
 *  STAT interrupt (IF bit 1) at each visible line 0-8F whose STAT has bit 3 set (none on the
 *  LYC line when STAT bit 6 is set: the coincidence keeps the STAT line high through its hblank,
 *  so no new edge; `Game.runFrame` requests that one). The interrupt of line l's hblank is taken
 *  at the port's step l and its handler's register writes land at line l + 1 (`Game.later`), as
 *  the original's (taken at the start of mode 0, done within that hblank). The chain runs from
 *  01:5C97 to 01:5CB8 (by id, so a chain left from an aborted quake stops). */
const hblankChain = new WeakMap<Game, number>();

function hblankLine(g: Game, id: number): void {
  if (hblankChain.get(g) !== id) return;
  const io = g.m.io;
  const l = g.ly;
  if (l < 0x90 && io[0x40]! & 0x80 && io[0x41]! & 0x08 && !(io[0x41]! & 0x40 && io[0x45] === l))
    io[0x0f] = io[0x0f]! | 0x02;
  if (l < 0x8f) g.at(g.frame, l + 1, () => hblankLine(g, id));
  else g.at(g.frame + 1, 0, () => hblankLine(g, id));
}

/** STAT bit 3 just set (01:5C97): the hblank interrupts from the current line's (when still
 *  visible) or the next frame's line 0. */
function hblankStart(g: Game): void {
  const id = (hblankChain.get(g) ?? 0) + 1;
  hblankChain.set(g, id);
  if (g.ly < 0x90) hblankLine(g, id);
  else g.at(g.frame + 1, 0, () => hblankLine(g, id));
}

/** STAT bit 3 cleared for good (01:5CB8): the chain ends. */
function hblankStop(g: Game): void {
  hblankChain.set(g, (hblankChain.get(g) ?? 0) + 1);
}

// ---------------------------------------------------------------- the handlers

/** 00:11E4 — the quake's vblank handler: the OAM DMA (always, FF80), CA22 + CA24 -> CA22 (at 00
 *  or 90: CA25 = 1); while a frame wait counts (FF95), FF95 - 1 and the frame counter FF93/FF94
 *  + 1 (no tile list C100, no joypad); the scroll (00:3D2B), a sound tick (00:1F3A). */
export function quakeVblank(g: Game): void {
  const m = g.m;
  oamDma(m);
  const a = (m.rd(0xca22) + m.rd(0xca24)) & 0xff;
  m.wr(0xca22, a);
  if (a === 0x00 || a === 0x90) m.wr(0xca25, 0x01);
  if (m.hram[0x15]) {
    m.hram[0x15] = (m.hram[0x15]! - 1) & 0xff;
    m.hram[0x13] = (m.hram[0x13]! + 1) & 0xff;
    if (!m.hram[0x13]) m.hram[0x14] = (m.hram[0x14]! + 1) & 0xff;
  }
  scroll(m);
  soundTick(g);
}

/** 00:121D — the quake's STAT handler (every hblank, STAT bit 3): CA23 + CA22 -> CA23, on a
 *  carry SCY - 1 (the lines below are pulled up a line: the picture is squashed by CA22 / 256).
 *  The SCY write is done in the hblank: it shows from the next line (`Game.later`; on line 99,
 *  a late interrupt, at once). */
export function quakeRaster(g: Game): void {
  const m = g.m;
  const s = m.rd(0xca23) + m.rd(0xca22);
  m.wr(0xca23, s & 0xff);
  if (s > 0xff) {
    const y = (m.rd(0xff42) - 1) & 0xff;
    if (g.ly < 153) g.later(1, () => m.wr(0xff42, y));
    else m.wr(0xff42, y);
  }
}

// ---------------------------------------------------------------- the quake

/** 00:3D46 (di ... ei around it) — the vblank vector C0B9 = jp hl (C0BA/C0BB = hl, C0B9 = C3). */
function* vblankVector(g: Game, hl: number): Co {
  const m = g.m;
  g.ime = false;
  m.wr(0xc0ba, hl & 0xff);
  m.wr(0xc0bb, hl >> 8);
  m.wr(0xc0b9, 0xc3);
  yield* g.reti(); // ei
}

/** 01:5C97 — the hblank raster on: di; the STAT vector kept (C0BD/C0BE -> CA1F/CA20), CA21 =
 *  STAT & F8, STAT bit 3 (hblank interrupt) set, STAT -> 00:121D (00:3D5A); reti. */
function* rasterOn(g: Game): Co {
  const m = g.m;
  g.ime = false;
  m.wr(0xca1f, m.rd(0xc0bd));
  m.wr(0xca20, m.rd(0xc0be));
  m.wr(0xca21, m.rd(0xff41) & 0xf8);
  m.wr(0xff41, m.rd(0xff41) | 0x08);
  hblankStart(g);
  m.wr(0xc0bd, 0x1d);
  m.wr(0xc0be, 0x12);
  m.wr(0xc0bc, 0xc3);
  yield* g.reti();
}

/** 01:5CB8 — the hblank raster off: di; the STAT vector back from CA1F/CA20, STAT | (CA21 & F0)
 *  with bit 3 cleared; reti. */
function* rasterOff(g: Game): Co {
  const m = g.m;
  g.ime = false;
  m.wr(0xc0bd, m.rd(0xca1f));
  m.wr(0xc0be, m.rd(0xca20));
  const b = m.rd(0xca21) & 0xf0;
  m.wr(0xff41, (m.rd(0xff41) | b) & 0xf7);
  hblankStop(g);
  yield* g.reti();
}

/** 01:5C85 — frames (00:3A6B) until the vblank handler 00:11E4 sets CA25 (CA22 reached 00 or 90),
 *  then CA24 = -CA24. */
function* quakeSwing(g: Game): Co {
  const m = g.m;
  do yield* wait1(g); while (!m.rd(0xca25));
  m.wr(0xca24, (-m.rd(0xca24)) & 0xff);
}

/** 01:53F6 (as actors.ts) — on a 9x cell (C2F0 & F0 = 90) the walking frame. */
function stepCell(m: Memory): void {
  if ((fget(m, "c2f0") & 0xf0) === 0x90) objectStep(m);
}

/** 01:53A9 (as actors.ts, not exported there) — the leader (slot 0): C250 bit 0 = FF93 bit 4;
 *  (on a 49-type C2E0 not on a C0 cell: still, C250 = bit 0 | 6); the step frame; drawn with
 *  00:3A7F (vehicle states, C360 bit 2) or 00:3B3F. */
function drawLeader(m: Memory): void {
  setSlot(m, 0);
  const a = fa(m, "c250");
  m.wr(a, (m.rd(a) & 0xfe) | ((m.hram[0x13]! >> 4) & 1));
  if ((fget(m, "c2e0") & 0xcb) === 0x49 && (fget(m, "c2f0") & 0xc0) !== 0xc0)
    fset(m, "c250", (fget(m, "c250") & 0x01) | 0x06);
  stepCell(m);
  const s = m.rd(0xc6e3);
  if (s === 0x01 || s >= 0x03 || fget(m, "c360") & 0x04) drawObject(m);
  else drawObject4(m);
}

/** 01:541E (as actors.ts, not exported there) — slot 1: C250 = 1 while CA13 & 1F is 08-17,
 *  drawn (00:3A7F). */
function drawSlot1(m: Memory): void {
  setSlot(m, 1);
  const v = m.rd(0xca13) & 0x1f;
  fset(m, "c250", v >= 0x08 && v < 0x18 ? 1 : 0);
  drawObject(m);
}

/** 01:5BCF — the leader pushed up b - 1 cells at speed c: CA25 = b, C6F0 = c (00:0165); each
 *  frame: a step going on (01:43F9: its frame by C6EE), else CA25 - 1 (0: done) and a forced step
 *  up (FF96 = 0, 01:5C02); then the companion (01:4F24), a frame (00:3A6B), the objects hidden
 *  (00:3A24), FF97 = 0, the leader and slot 1 drawn (01:53A9, 01:541E). */
function* quakeWalk(g: Game, b: number, c: number): Co {
  const m = g.m;
  m.wr(0xca25, b);
  m.wr(0xc6f0, c);
  stepSpeed(m);
  for (;;) {
    if (m.rd(0xc6ef)) {
      [leaderUp, leaderRight, leaderDown, leaderLeft][(m.rd(0xc6ee) >> 6) & 0x03]!(m);
    } else {
      const n = (m.rd(0xca25) - 1) & 0xff;
      m.wr(0xca25, n);
      if (!n) return;
      setSlot(m, 0); // 00:01D7
      leaderShiftUp(m);
    }
    companionFollow(m);
    yield* wait1(g);
    oamHideAll(m);
    m.hram[0x17] = 0;
    drawLeader(m);
    drawSlot1(m);
  }
}

/** 01:5B4D — the raster quake (event 2C, bank 01 selected): LYC 0, CA23 = CA22 = CA25 = 0, CA24 =
 *  2; a frame; the vblank handler 00:11E4 and the hblank raster 00:121D on (01:5C97); the swing
 *  (01:5C85: CA22 up by 2 a frame to 90, CA24 -> FE); a frame; the normal vblank 00:11A2; the
 *  leader pushed up (01:5BCF: 1 cell at speed 0, 2 at 1, 10 at 2, 2 at 1, 1 at 0; C6F0 kept,
 *  00:0165); LYC 0, CA25 = 0, a frame; 00:11E4 again and the swing back (CA22 down to 0); a frame;
 *  00:11A2; the raster off (01:5CB8). */
export function* quake(g: Game): Co {
  const m = g.m;
  m.wr(0xff45, 0x00);
  m.wr(0xca23, 0x00);
  m.wr(0xca22, 0x00);
  m.wr(0xca25, 0x00);
  m.wr(0xca24, 0x02);
  yield* g.wait(1);
  yield* vblankVector(g, 0x11e4);
  yield* rasterOn(g);
  yield* quakeSwing(g);
  yield* g.wait(1);
  yield* vblankVector(g, 0x11a2);
  const speed = m.rd(0xc6f0);
  yield* quakeWalk(g, 0x02, 0x00);
  yield* quakeWalk(g, 0x03, 0x01);
  yield* quakeWalk(g, 0x0b, 0x02);
  yield* quakeWalk(g, 0x03, 0x01);
  yield* quakeWalk(g, 0x02, 0x00);
  m.wr(0xc6f0, speed);
  stepSpeed(m);
  m.wr(0xff45, 0x00);
  m.wr(0xca25, 0x00);
  yield* g.wait(1);
  yield* vblankVector(g, 0x11e4);
  yield* quakeSwing(g);
  yield* g.wait(1);
  yield* vblankVector(g, 0x11a2);
  yield* rasterOff(g);
}

// ================================================================ event 10 F: the ending

/** 00:10E1 — bank 01, sound effect 36 (FFBC), a sound tick (00:3A60); story flag 31: the battle
 *  wipe (01:5EB8); bank back. */
function* endingSound(g: Game): Co {
  pushBank(g, 0x01);
  g.sfx(0x36);
  yield* soundMain(g);
  if (testFlag(g.m, 0x31)) yield* battleWipe(g);
  popBank(g);
}

/** 0B:6CEE (as battle.ts, not exported there) — the bracket, CE88 = 0, the windows (0B:5BDF),
 *  the background blank (0B:6C76), objects hidden (00:3A24), SCX 0, SCY 40. */
function* battleScreen(g: Game): Co {
  const m = g.m;
  yield* bracketEnter(g);
  m.wr(0xce88, 0);
  yield* farcall(g, 0x0b, () => windowsAll(g));
  farSync(g, 0x0b, () => farSync(g, 0x0f, () => { fill(m, 0x9800, 0x0800, 0xff); }));
  oamHideAll(m);
  m.wr(0xff43, 0);
  m.wr(0xff42, 0x40);
}

/** 0B:405A (as battle.ts, not exported there) — 9800 blank (0x400, 00:218F: 0F:792C), the
 *  bracket (not left), the formation (0B:5A18; FFCA bit 7 here: no divide, so the stack depth it
 *  keeps for 00:1C9C does not matter), the monster pictures (0B:40BF), D800 -> 9000 (0x7C0), D000
 *  blank (0x400), the group maps (0B:4205), D000 -> 9800 (0x400). */
function* backdrop(g: Game): Co {
  const m = g.m;
  farSync(g, 0x0f, () => { fill(m, 0x9800, 0x0400, 0xff); });
  yield* bracketEnter(g);
  formationLayout(g, FORMATION_LAYOUT_SP);
  monsterPictures(g);
  vramCopy(m, 0xd800, 0x9000, 0x07c0);
  fillBC(m, 0xd000, 0x0400, 0xff);
  monsterMaps(g);
  far0Sync(g, 0, () => vramCopy(m, 0xd000, 0x9800, 0x0400));
}

// ---- the opening slide 0B:780A (as battle.ts, not exported there)

/** 0B:782B — the scroll table DE40: 0x40 pairs (SCY 40, SCX 0). */
function slideTable(g: Game): void {
  for (let k = 0; k < 0x40; k++) { g.m.wr(0xde40 + 2 * k, 0x40); g.m.wr(0xde41 + 2 * k, 0x00); }
}

/** 0B:783B — DEC0/DEC1 = 0, a frame, then with the interrupts off lines 0-40: each line's SCY /
 *  SCX from DE40.. as LY reaches it. */
function* slideLines(g: Game): Co {
  const m = g.m;
  m.wr(0xdec0, 0);
  m.wr(0xdec1, 0);
  yield* g.wait(1);
  g.ime = false;
  let hl = 0xde40;
  for (let d = 0; d < 0x41; d++) {
    yield* g.untilLine(d);
    m.wr(0xff42, m.rd(hl++));
    m.wr(0xff43, m.rd(hl++));
  }
  yield* g.reti(); // ei
}

/** 0B:786F — the bend table 0B:78D5 from entry a until its 00: SCX of lines 0, 1, .. (DE41 + 2 k)
 *  = -v, SCY of lines 3F, 3E, .. (DEBF - 2 k) = v. */
function slideBend(g: Game, a: number): void {
  const m = g.m;
  let hl = (0x78d5 + a) & 0xffff, bc = 0xde41, de = 0xdebf;
  for (;;) {
    const v = m.rd(hl++);
    m.wr(de, v);
    de -= 2;
    const w = (-v) & 0xff;
    m.wr(bc, w);
    bc += 2;
    if (!w) return;
  }
}

/** 0B:785C — a step: DE40 = DE0F - 1, DEBE = -(DE0F - 1), the bend from entry 20 - DE0F. */
function slideStep(g: Game): void {
  const m = g.m;
  const a = (m.rd(0xde0f) - 1) & 0xff;
  m.wr(0xde40, a);
  m.wr(0xdebe, (-a) & 0xff);
  slideBend(g, (-((m.rd(0xde0f) - 0x20) & 0xff)) & 0xff);
}

/** 0B:7886 — (DE40 set) the upper half moves down a line, the lower half up (toward 40); DE40 =
 *  DEBE = 40; then the bend again from the first SCY 0 (when found). */
function slideMove(g: Game): void {
  const m = g.m;
  if (!m.rd(0xde40)) return;
  const c = 0x40;
  let hl = 0xde7e;
  for (let b = 0x1f; b; b--) {
    const a = m.rd(hl);
    if (!a) { m.wr(hl, 0); m.wr(hl - 1, 0); hl -= 2; continue; }
    let v = m.rd(hl - 2);
    if (v !== c) v = (v - 1) & 0xff;
    m.wr(hl, v);
    hl -= 2;
  }
  m.wr(hl, c);
  hl = 0xde80;
  for (let b = 0x1f; b; b--) {
    const a = m.rd(hl);
    if (!a) { m.wr(hl, 0); m.wr(hl + 1, 0); hl += 2; continue; }
    let v = m.rd(hl + 2);
    if (v !== c) v = (v + 1) & 0xff;
    m.wr(hl, v);
    hl += 2;
  }
  m.wr(hl, c);
  hl = 0xde40;
  let b = 0x20;
  for (;;) {
    const a = m.rd(hl);
    hl += 2;
    if (!a) break;
    b--;
    if (!b) break;
  }
  if (b < 0x20) slideBend(g, b);
}

/** 0B:780A — the opening slide: the table (0B:782B), 32 steps (DE0F): a step, then shown line by
 *  line (0B:783B) and moved (0B:7886) in turn. */
function* openingSlide(g: Game): Co {
  const m = g.m;
  slideTable(g);
  m.wr(0xde0f, 0x20);
  do {
    slideStep(g);
    yield* slideLines(g);
    slideMove(g);
    yield* slideLines(g);
    slideMove(g);
    yield* slideLines(g);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
}

// ---- the credits

/** 0B:4094 — a credits scene: the formation 0B:758B + 5 a (5 bytes) -> CC59, FFCA = 80 (fixed
 *  counts), SCY 40, the backdrop (0B:405A), the opening slide (0B:780A). */
function* creditScene(g: Game, a: number): Co {
  const m = g.m;
  const de = multiply(a, 0x0005).de;
  copy(m, (0x758b + de) & 0xffff, 0xcc59, 5); // 00:1F87
  m.hram[0x4a] = 0x80;
  m.wr(0xff42, 0x40);
  yield* backdrop(g);
  yield* openingSlide(g);
}

/** 0B:40B5 — the scene's end: CC5C = 1, battle effect 12 (0B:4049: DE00, rst $30 02:4394). */
function* creditEnd(g: Game): Co {
  g.m.wr(0xcc5c, 0x01);
  yield* battleEffectA(g, 0x12);
}

/** 0B:6CC5 — CDC2 - 1 text delays (00:3593). */
function* creditDelays(g: Game): Co {
  let a = g.m.rd(0xcdc2);
  for (;;) {
    a = (a - 1) & 0xff;
    if (!a) return;
    yield* textDelay(g);
  }
}

/** 0B:6CAF — the credits text at the word at hl (bank 0E, 00:3211 mode 24 in the box (1,1)
 *  18 x 6), F4 frames, then (falling into 0B:6CC5) the delays; returns hl after the word. */
function* creditText(g: Game, hl: number): Co<number> {
  const m = g.m;
  const lo = m.rd(hl++);
  const hi = m.rd(hl++);
  const at = (hi << 8) | lo;
  yield* far0(g, 0x0e, () => printText(g, 0x24, at, 0x0101, 0x0612));
  yield* g.wait(0xf4);
  yield* creditDelays(g);
  return hl & 0xffff;
}

/** 0B:6C96 — the credits: the table 0B:6CCF (formation, two text words; 00 ends): the scene
 *  (0B:4094), the first text (0B:6CAF), the delays (0B:6CC5), the second text, the scene's end
 *  (0B:40B5). */
function* credits(g: Game): Co {
  const m = g.m;
  let hl = 0x6ccf;
  for (;;) {
    const a = m.rd(hl++);
    if (!a) return;
    yield* farcall(g, 0x0b, () => creditScene(g, a));
    hl = yield* creditText(g, hl);
    yield* creditDelays(g);
    hl = yield* creditText(g, hl);
    yield* farcall(g, 0x0b, () => creditEnd(g));
  }
}

/** 06:7F69 — the ending (event 10 F, bank 06 selected): CDCE = 1 and the bracket left (00:1DFD:
 *  every level at once), the battle sound and wipe (00:10E1), the bracket again; CDC2 (the joypad
 *  off, and the delay count) = 1 + the bytes C507.. before the first FF (6 at most) counted from 6
 *  down; the battle screen (0B:6CEE), WY 4F, the credits (0B:6C96); fade out (00:39F3); the title
 *  picture (00:1D7F: 03:5C00 -> D000), D800 -> 8E00 (0x80), the window at the top (0B:6D04)
 *  blanked (01:7DFD), the tiles E0-E3 / E4-E7 (06:7FCA) at 9CC8 / 9CE8, the text 0E:7C94 (mode 4
 *  at (0, 0C), 20 x 6), fade in (00:3A0C); then the game stays in a loop (`jr $7fc8`, the
 *  interrupts running). */
export function* ending(g: Game): Co {
  const m = g.m;
  m.wr(0xcdce, 0x01);
  yield* bracketLeave(g);
  yield* endingSound(g);
  yield* bracketEnter(g);
  let hl = 0xc507, b = 0x06;
  for (;;) {
    const a = m.rd(hl++);
    if (((a + 1) & 0xff) === 0) break;
    b = (b - 1) & 0xff;
    if (!b) break;
  }
  m.wr(0xcdc2, (b + 1) & 0xff);
  yield* farcall(g, 0x0b, () => battleScreen(g));
  m.wr(0xff4a, 0x4f);
  yield* farcall(g, 0x0b, () => credits(g));
  yield* fadeOut(g);
  // 00:1D7F
  pushBank(g, 0x03);
  decompress(m, 0x5c00, 0x6287, 0xd000);
  popBank(g);
  far0Sync(g, 0, () => vramCopy(m, 0xd800, 0x8e00, 0x0080));
  farSync(g, 0x0b, () => windowTop(g));
  farSync(g, 0x01, () => windowClear(g));
  const [next] = far0Sync(g, 0, () => vramCopy(m, 0x7fca, 0x9cc8, 0x0004));
  far0Sync(g, 0, () => vramCopy(m, next, 0x9ce8, 0x0004));
  yield* far0(g, 0x0e, () => printText(g, 0x04, 0x7c94, 0x0c00, 0x0614));
  yield* fadeIn(g);
  yield* g.until(() => false); // 06:7FC8 — jr $7fc8
}
