/** Legend III battle effects of bank 02 (02:4394, reached by `rst $30` from 0B:4058 / 0C:6B7D
 *  with bank 02): the dispatcher on DE00 & 3F through the word table 02:4364 (0x00-0x17).
 *  Effects 15-17 are the party figures (02:4109 shown with their flip animation on, 02:4142
 *  cleared, 02:4167 the animation mask DC81; the animation itself is the vblank's 00:3E26,
 *  `spriteFlip`, while CBFF is set). The others are palette flashes, scroll waves written line
 *  by line with the interrupts off, VRAM tile copies and the object system of DF00 (30 slots of
 *  8 bytes: counter, life, motion pointer lo/hi, y, x, tile, attributes; FF = free) drawn to the
 *  OAM buffer C000 every frame (02:4ED5).
 *  Also the battle script natives of bank 0C at 0C:6B25-6B71 (wrappers of bank 0B / 09 routines
 *  and of this dispatcher).
 *  Line timing: a register written after an LY poll is written at that line (`untilLine`); one
 *  written after a further wait for the hblank (STAT mode 0) of line d takes effect from line
 *  d + 1 (`hblankOf`). Writes made twice in one line (02:47F5) or in the middle of a line cannot be
 *  shown at a finer grain than the line. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { NotPorted } from "./irq.js";
import { pushBank, popBank, farSync, far0Sync, copy, copyB, fill, vramCopy } from "./sys.js";
import { randomBelow } from "./math.js";
import { rst30 } from "./battle.js";
import { nativeRoutines } from "./bscript.js";
import { enemyRecordC91B, clearEnemyRecord, enemyBaseRecord } from "./benemy.js";
import { entityResist, entityStats, entityOffset } from "./bstats.js";
import { itemLoad } from "./bitems.js";
import { monsterTransform, abilityRecordStray } from "./banim2.js";
import "./misc4.js"; // the battle script natives 0C:499B, 6B4F, 6B55, 7E35 (registered at load)

// ---------------------------------------------------------------- tables of bank 02

/** 02:4430 — palettes: D2 81 40 00 40 81 D2 (flashes read from 4431 / 4434 on). */
const PAL_DARK = 0x4430;
/** 02:4433 — palettes from the middle of 02:4430 (00 40 81 D2). */
const PAL_LIGHT = 0x4433;
/** 02:463B — the motion "1 frame, no move" (01 00 00). */
const MOTION_STILL = 0x463b;

const BGP = 0xff47, OBP0 = 0xff48, SCY = 0xff42, SCX = 0xff43, WY = 0xff4a, WX = 0xff4b, LCDC = 0xff40;

// ---------------------------------------------------------------- the dispatcher

/** 02:4394 — battle effect DE00 & 3F: jump to the word at 02:4364 + 2 (DE00 & 3F) (00:373B).
 *  Bank 02 is selected by the caller. */
export function* battleEffect(g: Game): Co {
  yield* effectDispatch(g, g.m.rd(0xde00));
}

/** 02:4397 — battle effect a & 3F through the word table 02:4364 (00:373B); also called from
 *  02:4000 / 02:420B with a from the action data. */
function* effectDispatch(g: Game, a: number): Co {
  a &= 0x3f;
  switch (a) {
    case 0x00: return; // 02:43B1 (ret)
    case 0x01: yield* flashAndScroll(g); return;
    case 0x02: yield* flashTwice(g); return;
    case 0x03: yield* shake(g); return;
    case 0x04: yield* lcdBlinks(g); return;
    case 0x05: yield* convergeEffect(g); return;
    case 0x06: yield* waveEffect(g); return;
    case 0x07: yield* crossEffect(g); return;
    case 0x08: yield* burstEffect(g); return;
    case 0x09: yield* driftEffect(g); return;
    case 0x0a: yield* quakeEffect(g); return;
    case 0x0b: yield* windowWarpEffect(g); return;
    case 0x0c: yield* sparkleEffectC(g); return;
    case 0x0d: yield* sparkleEffectD(g); return;
    case 0x0e: yield* blinkTop(g); return;
    case 0x0f: tilePatches(g); return;
    case 0x10: yield* numbersFromD822(g); return;
    case 0x11: yield* numbersMark(g); return;
    case 0x12: yield* monsterEffect(g); return;
    case 0x13: yield* monsterSwap(g); return;
    case 0x14: yield* rst30(g, 0x0e, 0x3740, () => bigMonsterEffect(g)); return; // 02:41A0
    case 0x15: yield* figuresOn(g); return;
    case 0x16: yield* figuresOff(g); return;
    case 0x17: yield* figureMask(g); return;
    default:
      throw new NotPorted(`02:4397 effect ${a.toString(16).toUpperCase().padStart(2, "0")} (past the table 02:4364)`);
  }
}

// ---------------------------------------------------------------- line timing helpers

/** `ldh a,[$44] / cp d / jr nz` then `ldh a,[$41] / and 3 / jr nz`: LY = d, then its hblank; the
 *  registers written next take effect from line d + 1. */
function* hblankOf(g: Game, d: number): Co {
  yield* g.untilLine(d);
  yield* g.untilLine(d + 1);
}

/** 02:4FC5 — the OAM buffer C000-C077 cleared (30 objects). */
function clearOamBuffer(g: Game): void {
  fill(g.m, 0xc000, 0x78, 0x00);
}

/** 00:218F — farcall 0F:792C: fill bc bytes of VRAM at hl with a (hblank-paced; CPU time). */
function vramFill(g: Game, hl: number, bc: number, a: number): void {
  farSync(g, 0x0f, () => { fill(g.m, hl, bc, a); });
}

/** rst $00 — hl += a. */
const add8 = (hl: number, a: number): number => (hl + (a & 0xff)) & 0xffff;

// ---------------------------------------------------------------- 01, 02: palette flashes

/** 02:441A — a frame, BGP = OBP0 = [hl] down to line 40, then D2 again. */
function* flashTop(g: Game, hl: number): Co {
  const m = g.m;
  yield* g.wait(1);
  const a = m.rd(hl);
  m.wr(BGP, a);
  m.wr(OBP0, a);
  yield* g.untilLine(0x40);
  m.wr(BGP, 0xd2);
  m.wr(OBP0, 0xd2);
}

/** 02:440B — three palettes from hl + 1, 7 flashes (02:441A) each. */
function* flashes(g: Game, hl: number): Co {
  for (let d = 3; d; d--) {
    hl = (hl + 1) & 0xffff;
    for (let e = 7; e; e--) yield* flashTop(g, hl);
  }
}

/** 02:43EA — effect 01: flashes darker (02:4408: 02:4431-4433), the OAM buffer cleared, a frame,
 *  SCY = 40. */
function* flashAndScroll(g: Game): Co {
  yield* flashes(g, PAL_DARK);
  clearOamBuffer(g);
  yield* g.wait(1);
  g.m.wr(SCY, 0x40);
}

/** 02:43F8 — effect 02: effect 01, 15 frames, SCY = 0, flashes lighter (02:4434-4436). */
function* flashTwice(g: Game): Co {
  yield* flashAndScroll(g);
  yield* g.wait(0x0f);
  g.m.wr(SCY, 0x00);
  yield* flashes(g, PAL_LIGHT);
}

// ---------------------------------------------------------------- 03, 04, 0E

/** 02:43B2 — register FF00 + c = the 8 values of 02:43C0, one a frame. */
function* shakeSteps(g: Game, c: number): Co {
  let hl = 0x43c0;
  for (let d = 8; d; d--) {
    yield* g.wait(1);
    g.m.wr(0xff00 | c, g.m.rd(hl++));
  }
}

/** 02:439F — effect 03: twice SCX then SCY through 02:43C0 (02:43B2), then SCX = SCY = 0. */
function* shake(g: Game): Co {
  let c = 0x43;
  for (let b = 2; b; b--) {
    yield* shakeSteps(g, c);
    c--;
    yield* shakeSteps(g, c);
    c++;
  }
  g.m.wr(0xff00 | c, 0);
  c--;
  g.m.wr(0xff00 | c, 0);
}

/** 02:43C8 — effect 04: twice: from line 91 on, the LCD off (LCDC bit 7), DIV reset, the LCD on
 *  again when DIV bit 2 is set (~1024 cycles), 5 frames. The switch ends PyBoy's frame: the trace
 *  counts a frame with no lines in between (`Game.lcdRestart`; otherwise one STAT sound tick and
 *  one vblank too many, zw00). */
function* lcdBlinks(g: Game): Co {
  const m = g.m;
  // sync point 02:43C8: the effect starts after the action's CPU time (the line poll below would
  // otherwise come a frame early; zw00 frame 4052)
  yield* g.point(0x0243c8);
  for (let b = 2; b; b--) {
    if (g.ly < 0x91) yield* g.untilLine(0x91);
    let a = m.rd(LCDC) & 0x7f;
    m.wr(LCDC, a);
    m.wr(0xff04, a); // DIV reset (any write)
    a = m.rd(LCDC) | 0x80;
    m.wr(LCDC, a);
    yield* g.lcdRestart();
    yield* g.wait(5);
  }
}

/** 02:4BA9 — effect 0E: 0x30 frames, BGP from 02:4BC9 + (e & 0C) / 4 down to line 40, then D2. */
function* blinkTop(g: Game): Co {
  const m = g.m;
  for (let e = 0x30; e; e--) {
    yield* g.wait(1);
    m.wr(BGP, m.rd(0x4bc9 + ((e & 0x0c) >> 2)));
    yield* g.untilLine(0x40);
    m.wr(BGP, 0xd2);
  }
}

// ---------------------------------------------------------------- 0F

/** 02:4BCD — effect 0F: 10 tiles of 02:4C05.. (0x20 bytes each) to the VRAM addresses of the
 *  word table 02:4BF1 (00:20FF); DE0F counts 0A..1. */
function tilePatches(g: Game): void {
  const m = g.m;
  let hl = 0x4c05, bc = 0x4bf1, a = 0x0a;
  do {
    m.wr(0xde0f, a);
    const de = m.rd16(bc);
    bc += 2;
    [hl] = vramCopy(m, hl, de, 0x0020);
    a = (m.rd(0xde0f) - 1) & 0xff;
  } while (a);
}

// ---------------------------------------------------------------- the line tables (06, 0A, 12)

/** 02:4498 — DE40.. = 4 times the 8 pairs (v, -v) of 02:44B0. */
function waveTable(g: Game): void {
  const m = g.m;
  let hl = 0xde40;
  for (let c = 4; c; c--) {
    let de = 0x44b0;
    for (let b = 8; b; b--) {
      const a = m.rd(de++);
      m.wr(hl++, a);
      m.wr(hl++, (-a) & 0xff);
    }
  }
}

/** 02:4466 — DE40-DE7E = DE41-DE7F (the table rotated); returns c = the old DE40. */
function waveShift(g: Game): number {
  const m = g.m;
  const c = m.rd(0xde40);
  for (let k = 0; k < 0x3f; k++) m.wr(0xde40 + k, m.rd(0xde41 + k));
  return c;
}

/** 02:447F — a frame, then with the interrupts off register FF00 + c of lines 0-40 from
 *  DE40-DE80 as LY reaches each; then the register 0. */
function* lineTable(g: Game, c: number): Co {
  const m = g.m;
  let hl = 0xde40;
  yield* g.wait(1);
  g.ime = false;
  let d = 0;
  for (let e = 0x41; e; e--) {
    yield* g.untilLine(d);
    m.wr(0xff00 | c, m.rd(hl++));
    d++;
  }
  m.wr(0xff00 | c, 0);
  yield* g.reti(); // ei
}

/** 02:4447 — DE0F = n, DE07/DE08 = the step (02:447A / 02:4474); n times: rotate (02:4466) and
 *  step (02:445E: jp [DE07] with a = the old DE40). */
function* waveRun(g: Game, n: number, step: number): Co {
  const m = g.m;
  m.wr(0xde0f, n);
  m.wr(0xde07, step & 0xff);
  m.wr(0xde08, step >> 8);
  do {
    let a = waveShift(g);
    if (step === 0x4474) a = (a << 1) & 0xff; // 02:4474: sla a, then 02:447A
    m.wr(0xde7f, a); // 02:447A
    yield* lineTable(g, 0x43);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
}

/** 02:4437 — effect 06: the SCX wave (02:4498), 0x40 frames rotating, 0x60 frames rotating
 *  with the wrapped value doubled. */
function* waveEffect(g: Game): Co {
  waveTable(g);
  yield* waveRun(g, 0x40, 0x447a);
  yield* waveRun(g, 0x60, 0x4474);
}

// ---------------------------------------------------------------- the objects of DF00

/** 02:4E7C — the objects reset: DEFC = a (frames between steps), DEFD-DEFF = 0, DF00-DFEF = FF. */
function objectsInit(g: Game, a: number): void {
  const m = g.m;
  m.wr(0xdefc, a);
  m.wr(0xdefd, 0);
  m.wr(0xdefe, 0);
  m.wr(0xdeff, 0);
  fill(m, 0xdf00, 0xf0, 0xff);
}

/** 02:4ED5 — the OAM buffer cleared, then every object of DF00: counter + 1 (FF when it reaches
 *  its life: freed after this frame), y / x moved by the pair at its motion pointer (the pointer
 *  advances by 2 unless DEFF is set) and copied with its tile / attributes to C000..; returns
 *  b = the objects still alive. */
function objectsStep(g: Game): number {
  const m = g.m;
  clearOamBuffer(g);
  let hl = 0xdf00, de = 0xc000, c = 0x1e, b = c;
  do {
    let a = (m.rd(hl) + 1) & 0xff;
    hl = (hl + 1) & 0xffff;
    if (!a) {
      b = (b - 1) & 0xff;
      hl = (hl + 7) & 0xffff;
    } else {
      const lt = a < m.rd(hl);
      hl = (hl - 1) & 0xffff;
      if (!lt) {
        a = 0xff;
        b = (b - 1) & 0xff;
      }
      m.wr(hl, a);
      hl = (hl + 2) & 0xffff;
      let p = m.rd(hl) | (m.rd(hl + 1) << 8);
      hl = (hl + 2) & 0xffff;
      let v = (m.rd(p) + m.rd(hl)) & 0xff;
      p = (p + 1) & 0xffff;
      m.wr(hl, v);
      hl = (hl + 1) & 0xffff;
      m.wr(de, v);
      de = (de + 1) & 0xffff;
      v = (m.rd(p) + m.rd(hl)) & 0xff;
      p = (p + 1) & 0xffff;
      m.wr(hl, v);
      hl = (hl - 1) & 0xffff;
      m.wr(de, v);
      de = (de + 1) & 0xffff;
      if (m.rd(0xdeff)) p = (p - 2) & 0xffff;
      hl = (hl - 1) & 0xffff;
      m.wr(hl, p >> 8);
      hl = (hl - 1) & 0xffff;
      m.wr(hl, p & 0xff);
      hl = (hl + 4) & 0xffff;
      m.wr(de, m.rd(hl));
      hl = (hl + 1) & 0xffff;
      de = (de + 1) & 0xffff;
      m.wr(de, m.rd(hl));
      hl = (hl + 1) & 0xffff;
      de = (de + 1) & 0xffff;
    }
    c = (c - 1) & 0xff;
  } while (c);
  return b;
}

/** 02:4EB9 — a frame (02:4ED2: 00:3A6B, then the step 02:4ED5), DEFD = the objects alive, DEFC
 *  frames; then DEFD set: DEFE = FE; else DEFE + 1 unless it is FF. Returns the zero flag: no
 *  object alive and DEFE already FF. */
function* objectsFrame(g: Game): Co<boolean> {
  const m = g.m;
  yield* g.wait(1);
  const b = objectsStep(g);
  m.wr(0xdefd, b);
  yield* g.wait(m.rd(0xdefc));
  if (m.rd(0xdefd)) {
    m.wr(0xdefe, 0xfe);
    return false;
  }
  const a = (m.rd(0xdefe) + 1) & 0xff;
  if (!a) return true;
  m.wr(0xdefe, a);
  return false;
}

/** 02:4EB0 / 02:4EB3 — n object frames (02:4EB9); returns the last one's zero flag. */
function* objectsFrames(g: Game, n: number): Co<boolean> {
  let z = false;
  for (let k = 0; k < n; k++) z = yield* objectsFrame(g);
  return z;
}

/** 02:45AE — the OAM buffer cleared, a frame. */
function* objectsEnd(g: Game): Co {
  clearOamBuffer(g);
  yield* g.wait(1);
}

/** 02:479C — whether a objects fit in the free slots of DF00 (a <= free; the carry flag). */
function objectsFit(g: Game, a: number): boolean {
  const m = g.m;
  let hl = 0xdf00, c = 0x1e;
  for (let b = 0x1e; b; b--) {
    if (m.rd(hl) !== 0xff) c = (c - 1) & 0xff;
    hl = (hl + 8) & 0xffff;
  }
  c = (c + 1) & 0xff;
  return a < c;
}

/** 02:4E8C — a new object in the first free slot of DF00: counter 0, life [bc], motion pointer
 *  bc + 1, y / x / tile / attributes from DE13-DE16. */
function objectNew(g: Game, bc: number): void {
  const m = g.m;
  let de = 0xde13, hl = 0xdf00;
  while (m.rd(hl) !== 0xff) hl = (hl + 8) & 0xffff;
  m.wr(hl, 0);
  hl = (hl + 1) & 0xffff;
  const life = m.rd(bc);
  const p = (bc + 1) & 0xffff;
  m.wr(hl, life);
  hl = (hl + 1) & 0xffff;
  m.wr(hl, p & 0xff);
  hl = (hl + 1) & 0xffff;
  m.wr(hl, p >> 8);
  hl = (hl + 1) & 0xffff;
  for (let b = 4; b; b--) {
    m.wr(hl, m.rd(de));
    de = (de + 1) & 0xffff;
    hl = (hl + 1) & 0xffff;
  }
}

/** 02:4757 — a group of objects at y c / x b with the motion hl, from the list at de: a count,
 *  then per object a byte (bits 7-5: y / 8, bits 4-0: x / 8) and a byte (low nibble: tile / 2,
 *  high nibble: attributes); nothing when they do not fit (02:479C). DE0C/DE0D = hl, DE0E = the
 *  count left, DE13-DE16 the object built. */
function objectGroup(g: Game, hl: number, de: number, b: number, c: number): void {
  const m = g.m;
  const n = m.rd(de);
  de = (de + 1) & 0xffff;
  if (!objectsFit(g, n)) return;
  m.wr(0xde0e, n);
  m.wr(0xde0c, hl & 0xff);
  m.wr(0xde0d, hl >> 8);
  do {
    let v = m.rd(de);
    m.wr(0xde13, ((((v >> 5) & 0x07) * 8) + c) & 0xff);
    v = m.rd(de);
    de = (de + 1) & 0xffff;
    m.wr(0xde14, (((v & 0x1f) * 8) + b) & 0xff);
    v = m.rd(de);
    m.wr(0xde15, ((v & 0x0f) * 2) & 0xff);
    v = m.rd(de);
    de = (de + 1) & 0xffff;
    m.wr(0xde16, v & 0xf0);
    objectNew(g, m.rd16(0xde0c));
    m.wr(0xde0e, (m.rd(0xde0e) - 1) & 0xff);
  } while (m.rd(0xde0e));
}

// ---------------------------------------------------------------- 05: converging sparks

/** 02:4568 — make room at DF00: free: true; else its object moved to the first free slot of
 *  DF08.. (29 checked): true; none free: false. */
function convergeRoom(g: Game): boolean {
  const m = g.m;
  if (m.rd(0xdf00) === 0xff) return true;
  let hl = 0xdf08;
  for (let b = 0x1d; ; ) {
    if (m.rd(hl) === 0xff) {
      copy(m, 0xdf00, hl, 8);
      return true;
    }
    b--;
    if (!b) return false;
    hl = (hl + 8) & 0xffff;
  }
}

/** 02:44D8 — a new spark at DF00 (when there is room, 02:4568): life 0A, motion 02:463C (still),
 *  y = 8 random(0A), x = 8 random(16) (02:44F8: 00:1D2E), tile / attributes 0. */
function convergeNew(g: Game): void {
  const m = g.m;
  if (!convergeRoom(g)) return;
  let hl = 0xdf00;
  m.wr(hl++, 0x00);
  m.wr(hl++, 0x0a);
  m.wr(hl++, 0x3c);
  m.wr(hl++, 0x46);
  m.wr(hl++, (randomBelow(m, 0x0a) * 8) & 0xff);
  m.wr(hl++, (randomBelow(m, 0x16) * 8) & 0xff);
  m.wr(hl++, 0);
  m.wr(hl++, 0);
}

/** 02:4527 — the object at hl a quarter of the way toward y 28 / x 54; returns the distance
 *  moved (both quarters added). */
function convergeMove(g: Game, hl: number): number {
  const m = g.m;
  hl = (hl + 4) & 0xffff;
  let c = m.rd(hl), d: number, a: number;
  if (c < 0x28) { d = (0x28 - c) >> 1 >> 1; a = (d + c) & 0xff; }
  else { d = ((c - 0x28) & 0xff) >> 2; a = (c - d) & 0xff; }
  m.wr(hl, a);
  hl = (hl + 1) & 0xffff;
  c = m.rd(hl);
  let b: number;
  if (c < 0x54) { b = (0x54 - c) >> 2; a = (b + c) & 0xff; }
  else { b = ((c - 0x54) & 0xff) >> 2; a = (c - b) & 0xff; }
  m.wr(hl, a);
  return (b + d) & 0xff;
}

/** 02:4500 — every spark moved (02:4527): moved less than 4: freed; else tile 2 (moved less
 *  than 8) or 0, attributes 0. */
function convergeStep(g: Game): void {
  const m = g.m;
  let hl = 0xdf00;
  for (let e = 0x1e; e; e--) {
    if (m.rd(hl) !== 0xff) {
      const a = convergeMove(g, hl);
      if (a < 4) {
        m.wr(hl, 0xff);
      } else {
        m.wr((hl + 6) & 0xffff, a < 8 ? 2 : 0);
        m.wr((hl + 7) & 0xffff, 0);
      }
    }
    hl = (hl + 8) & 0xffff;
  }
}

/** 02:44B8 — effect 05: objects every 3 frames, DEFF = DE0F = 0E (motion pointers kept); 14
 *  times: a spark (02:44D8), a step, all moved toward the centre (02:4500), a step. */
function* convergeEffect(g: Game): Co {
  const m = g.m;
  objectsInit(g, 0x03);
  m.wr(0xdeff, 0x0e);
  m.wr(0xde0f, 0x0e);
  do {
    convergeNew(g);
    yield* objectsFrame(g);
    convergeStep(g);
    yield* objectsFrame(g);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
}

// ---------------------------------------------------------------- 07, 08, 09, 0C, 0D

/** 02:472B — group de at y c, x = 02:465D + (a & 0F), still (02:463B). */
function crossGroup(g: Game, a: number, de: number, c: number): void {
  const b = g.m.rd(0x465d + (a & 0x0f));
  objectGroup(g, MOTION_STILL, de, b, c);
}

/** 02:4701 / 02:4716 — the two groups of the cross step DE0F - 1: de1 at y 08, de2 at y 28 (x
 *  index + 8). */
function crossPair(g: Game, de1: number, de2: number): void {
  const a = (g.m.rd(0xde0f) - 1) & 0xff;
  crossGroup(g, a, de1, 0x08);
  crossGroup(g, (a + 8) & 0xff, de2, 0x28);
}

/** 02:463E — effect 07: objects every 2 frames; 16 times: the groups 02:466D / 02:4682 (02:4701),
 *  a step, swapped (02:4716), a step; then the end (02:45AE). */
function* crossEffect(g: Game): Co {
  const m = g.m;
  objectsInit(g, 0x02);
  m.wr(0xde0f, 0x10);
  do {
    crossPair(g, 0x466d, 0x4682);
    yield* objectsFrame(g);
    crossPair(g, 0x4682, 0x466d);
    yield* objectsFrame(g);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  yield* objectsEnd(g);
}

/** 02:4697 — effect 08: objects every frame; while DEFC counts down to FF: the pair 02:46BB at y
 *  28 / x 50 with the motion 02:46C0 (02:46AF), steps until none is left. */
function* burstEffect(g: Game): Co {
  const m = g.m;
  objectsInit(g, 0x01);
  do {
    objectGroup(g, 0x46c0, 0x46bb, 0x50, 0x28);
    while (!(yield* objectsFrame(g)));
    m.wr(0xdefc, (m.rd(0xdefc) - 1) & 0xff);
  } while ((m.rd(0xdefc) + 1) & 0xff);
  yield* objectsEnd(g);
}

/** 02:458A — effect 09: objects every frame, motion pointers kept (DEFF = 10); 16 times: the
 *  group 02:45B7 at y 0 / x 02:47B6 + (DE0F & 0F) with the motion 02:45B4 (02:4749), 3 steps;
 *  then steps until none is left, the end. */
function* driftEffect(g: Game): Co {
  const m = g.m;
  objectsInit(g, 0x01);
  m.wr(0xdeff, 0x10);
  m.wr(0xde0f, 0x10);
  do {
    const b = m.rd(0x47b6 + (m.rd(0xde0f) & 0x0f));
    objectGroup(g, 0x45b4, 0x45b7, b, 0x00);
    yield* objectsFrames(g, 3);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  while (!(yield* objectsFrame(g)));
  yield* objectsEnd(g);
}

/** 02:4737 — group de at the position pair 02:45F9 + 2 (DE0F & 0F) (y, x), still. */
function sparkleGroup(g: Game, de: number): void {
  const m = g.m;
  const hl = 0x45f9 + 2 * (m.rd(0xde0f) & 0x0f);
  objectGroup(g, MOTION_STILL, de, m.rd(hl + 1), m.rd(hl));
}

/** 02:45DC — DE0F = n times: the group 02:4619 (02:4737), a step, the group 02:462A; then a step
 *  and the end (02:45AE). */
function* sparkles(g: Game, n: number): Co {
  const m = g.m;
  m.wr(0xde0f, n);
  do {
    sparkleGroup(g, 0x4619);
    yield* objectsFrame(g);
    sparkleGroup(g, 0x462a);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  yield* objectsFrame(g);
  yield* objectsEnd(g);
}

/** 02:45C9 — effect 0C: VRAM 82E0 -> 8000 (0x100, 00:20FF), objects every 3 frames, 0x18
 *  sparkles. */
function* sparkleEffectC(g: Game): Co {
  vramCopy(g.m, 0x82e0, 0x8000, 0x0100);
  objectsInit(g, 0x03);
  yield* sparkles(g, 0x18);
}

/** 02:45C0 — effect 0D: objects every 6 frames, 8 sparkles. */
function* sparkleEffectD(g: Game): Co {
  objectsInit(g, 0x06);
  yield* sparkles(g, 0x08);
}

// ---------------------------------------------------------------- 0A: quake

/** 02:4812 — a debris object at y 1C + 4 random(0C), x 20 + random(15) (00:1D2E), list 02:482D,
 *  motion 02:4830. */
function quakeDebris(g: Game): void {
  const m = g.m;
  const c = ((randomBelow(m, 0x0c) * 4) + 0x1c) & 0xff;
  const b = (randomBelow(m, 0x15) + 0x20) & 0xff;
  objectGroup(g, 0x4830, 0x482d, b, c);
}

/** 02:4872 — the SCY/SCX pairs DEBF downward (64 pairs: [DEBF - 2k] = byte 0, [DEBE - 2k] = byte
 *  1 of 02:488E + 2 ((DE0F + k) & 0F)). */
function quakeTable(g: Game): void {
  const m = g.m;
  let de = 0xdebf, c = m.rd(0xde0f);
  for (let b = 0x40; b; b--) {
    const hl = 0x488e + 2 * (c & 0x0f);
    c = (c + 1) & 0xff;
    m.wr(de--, m.rd(hl));
    m.wr(de--, m.rd(hl + 1));
  }
}

/** 02:47E9 — a frame, then with the interrupts off lines 0-40: SCX = [DE40 + 2k] as LY reaches
 *  line k and, a few cycles later in the same line, SCX = [DE41 + 2k] (only the second is seen at
 *  line grain); then SCX = 0. */
function* quakeLines(g: Game): Co {
  const m = g.m;
  let hl = 0xde40, d = 0;
  yield* g.wait(1);
  g.ime = false;
  for (let e = 0x41; e; e--) {
    yield* g.untilLine(d);
    m.wr(SCX, m.rd(hl++));
    // 02:480B: a short delay (CPU time)
    m.wr(SCX, m.rd(hl++));
    d++;
  }
  m.wr(SCX, 0);
  yield* g.reti(); // ei
}

/** 02:4869 — the table (02:4872), the lines (02:47E9), the objects stepped (02:4ED5). */
function* quakeWave(g: Game): Co {
  quakeTable(g);
  yield* quakeLines(g);
  objectsStep(g);
}

/** 02:4859 — a frame, SCY = 40 down to line 40, SCY = 0, the wave (02:4869). */
function* quakeJolt(g: Game): Co {
  const m = g.m;
  yield* g.wait(1);
  m.wr(SCY, 0x40);
  yield* g.untilLine(0x40);
  m.wr(SCY, 0);
  yield* quakeWave(g);
}

/** 02:47C6 — effect 0A: objects with no wait; 0x18 times: a frame, 2 debris (02:4812), the wave
 *  (02:4869), a debris, the jolt (02:4859). */
function* quakeEffect(g: Game): Co {
  const m = g.m;
  objectsInit(g, 0x00);
  m.wr(0xde0f, 0x18);
  do {
    yield* g.wait(1);
    quakeDebris(g);
    quakeDebris(g);
    yield* quakeWave(g);
    quakeDebris(g);
    yield* quakeJolt(g);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
}

// ---------------------------------------------------------------- 0B: the window warp

/** 02:4934 — VRAM 9BE0-9BF3 = a (00:218F). */
function warpRow(g: Game, a: number): void {
  vramFill(g, 0x9be0, 0x0014, a);
}

/** 02:48AE — VRAM 9C00 -> 9D60 (0x140, 00:20FF), then 9C00 blank (0x140 x FF). */
function warpSave(g: Game): void {
  vramCopy(g.m, 0x9c00, 0x9d60, 0x0140);
  vramFill(g, 0x9c00, 0x0140, 0xff);
}

/** 02:49DD — the group 02:49FD[(40 - DE0F) / 8 & 7] at y 0C / x 08, motion 02:4BA6. */
function warpGroup(g: Game): void {
  const m = g.m;
  let a = (0x40 - m.rd(0xde0f)) & 0xff;
  a = ((a << 24) >> 27) & 0x07; // sra x 3, and 7
  const de = m.rd16(0x49fd + 2 * a);
  objectGroup(g, 0x4ba6, de, 0x08, 0x0c);
}

/** 02:49C7 (after its hblank wait) — WX = 07, SCY = 0, BGP = OBP0 = D2, ei. */
function* warpRestore(g: Game): Co {
  const m = g.m;
  m.wr(WX, 0x07);
  m.wr(SCY, 0x00);
  m.wr(BGP, 0xd2);
  m.wr(OBP0, 0xd2);
  yield* g.reti(); // ei
}

/** 02:498C — DE10 + 1, d += DE10 & 3; a frame; with the interrupts off WY = SCY = 0, BGP = b,
 *  OBP0 = DE12; then e lines from d: in the hblank of line d, WX = [hl] + A5, SCY = F9 - d, SCX
 *  = [hl] - 1 (hl + 1); then WX 07, SCY 0, palettes D2 (02:49C7). */
function* warpLines(g: Game, hl: number, b: number, d: number, e: number): Co {
  const m = g.m;
  m.wr(0xde10, (m.rd(0xde10) + 1) & 0xff);
  d = ((m.rd(0xde10) & 0x03) + d) & 0xff;
  yield* g.wait(1);
  g.ime = false;
  m.wr(WY, 0);
  m.wr(SCY, 0);
  m.wr(BGP, b);
  m.wr(OBP0, m.rd(0xde12));
  do {
    yield* hblankOf(g, d);
    m.wr(WX, (m.rd(hl) + 0xa5) & 0xff);
    m.wr(SCY, (0xf9 - d) & 0xff);
    m.wr(SCX, (m.rd(hl) - 1) & 0xff);
    hl = (hl + 1) & 0xffff;
    d = (d + 1) & 0xff;
    e = (e - 1) & 0xff;
  } while (e);
  yield* warpRestore(g); // 02:49C7: still in the last line's hblank
}

/** 02:497F — the warp lines (02:498C) from line DE0F, 41 - DE0F of them, curve 02:4B47, BGP 03. */
function* warpCurve(g: Game): Co {
  const m = g.m;
  const d = m.rd(0xde0f);
  yield* warpLines(g, 0x4b47, 0x03, d, (0x41 - d) & 0xff);
}

/** 02:493D — the closing step DE0F: OBP0 level DE12 = 02:4433[(DE0F >> 3) & 3], the warp lines
 *  from line 1 (0x40, curve 02:4B47 + 20 - DE0F, BGP = that index); then a frame, with the
 *  interrupts off WY = SCY = SCX = 0, WX = A5, BGP = 02:4430[index] down to line 44, then 02:49C7
 *  in its hblank. */
function* warpClose(g: Game): Co {
  const m = g.m;
  const c = m.rd(0xde0f);
  const a = (((c << 1) & 0xff) >> 4) & 0x03; // sla, swap, and 3
  m.wr(0xde12, m.rd(PAL_LIGHT + a));
  yield* warpLines(g, add8(0x4b47, (0x20 - c) & 0xff), a, 0x01, 0x40);
  const b = m.rd(PAL_DARK + a);
  yield* g.wait(1);
  g.ime = false;
  m.wr(WY, 0);
  m.wr(SCY, 0);
  m.wr(SCX, 0);
  m.wr(WX, 0xa5);
  m.wr(BGP, b);
  yield* hblankOf(g, 0x44);
  yield* warpRestore(g);
}

/** 02:48C6 — effect 0B: 9BE0 row = FC (02:4934), objects with no wait and kept motion pointers
 *  (DEFF = 1), DE12 = D2, 9C00 saved to 9D60 (02:48AE); 0x40 times: a group (02:49DD), the warp
 *  (02:497F), the objects stepped, the warp; 0x1F closing steps (02:493D); the end (02:45AE);
 *  LCDC C7, 9D60 -> 9C00 back, a frame, LCDC E7, WY 58, WX 07, SCY = SCX = 0, 9D60 blank, the
 *  9BE0 row FF. */
function* windowWarpEffect(g: Game): Co {
  const m = g.m;
  warpRow(g, 0xfc);
  objectsInit(g, 0x00);
  m.wr(0xdeff, 0x01);
  m.wr(0xde12, 0xd2);
  warpSave(g);
  m.wr(0xde0f, 0x40);
  do {
    warpGroup(g);
    yield* warpCurve(g);
    objectsStep(g);
    yield* warpCurve(g);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  m.wr(0xde0f, 0x1f);
  do {
    yield* warpClose(g);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  yield* objectsEnd(g);
  m.wr(LCDC, 0xc7);
  vramCopy(m, 0x9d60, 0x9c00, 0x0140);
  yield* g.wait(1);
  m.wr(LCDC, 0xe7);
  m.wr(WY, 0x58);
  m.wr(WX, 0x07);
  m.wr(SCY, 0);
  m.wr(SCX, 0);
  vramFill(g, 0x9d60, 0x0140, 0xff);
  warpRow(g, 0xff);
}

// ---------------------------------------------------------------- 10, 11: the numbers

/** 03:78D6 (bank 03, through 00:3740) — the digit tiles: DE60.. = 13 times 16 zero bytes
 *  (00:1F49) and 16 bytes of 03:78F8.., then DE60 -> VRAM 8000 (0x1A0, 00:20FF). */
function digitTiles(g: Game): void {
  const m = g.m;
  let de = 0x78f8, hl = 0xde60;
  for (let c = 0x0d; c; c--) {
    hl = fill(m, hl, 16, 0x00);
    for (let b = 0x10; b; b--) m.wr(hl++, m.rd(de++));
  }
  vramCopy(m, 0xde60, 0x8000, 0x01a0);
}

/** 00:2009 with a = 2 (00:2042) — the word at hl in decimal: CD2B/CD2C = B0, CD2D-CD31 = the
 *  digits B0 + (10000s .. ones), then leading B0 (up to 6, from CD2B) -> FF. bc, de kept. */
function decimalWord(g: Game, hl: number): void {
  const m = g.m;
  let v = m.rd16(hl);
  m.wr(0xcd2b, 0xb0);
  m.wr(0xcd2c, 0xb0);
  let p = 0xcd2d;
  for (const div of [10000, 1000, 100]) {
    m.wr(p++, 0xb0 + Math.floor(v / div)); // 00:20AA
    v %= div;
  }
  m.wr(p++, 0xb0 + Math.floor(v / 10)); // 00:20BD
  m.wr(p, 0xb0 + (v % 10));
  p = 0xcd2b;
  for (let b = 6; b && m.rd(p) === 0xb0; b--) m.wr(p++, 0xff);
}

/** 02:42C0 — the screen position of entity DE01: enemy groups (5..): from CC51/CC41 (c, b =
 *  column, row; a = 0); members (0-4): c = DE01 x (4 or 5 with DDFF), b = 7, a = 0 or 4 (DDFF).
 *  Returns [a, b, c]. */
function entityPosition(g: Game): [number, number, number] {
  const m = g.m;
  let a = m.rd(0xde01);
  if (a >= 0x05) {
    a = (a - 0x05) & 0xff;
    const d = a;
    const v = m.rd(0xcc51 + a);
    let b = (((v & 0x0f) - 1) & 0xff) >> 1;
    let c = ((((((v >> 4) & 0x0f) - 1) & 0xff) >> 1) - 1) & 0xff;
    const hl = add8(0xcc41, (d * 2) & 0xff);
    c = (m.rd(hl) + c) & 0xff;
    b = (m.rd(hl + 1) + b) & 0xff;
    return [0, b, c];
  }
  const v = (((m.rd(0xddff) - 1) & 0x04) ^ 0x04) & 0xff;
  const c = ((v >> 2) + 4) & 0xff;
  return [v, 0x07, (c * a) & 0xff];
}

/** 02:4E20 — DE01 = DE09 - 1, its position (02:42C0) in pixels: b = 8 (row + 2), c = 8 (column
 *  + 4) + a, then 4 less per FF from CD2F on (the number centred). Returns [b, c]. */
function numberPosition(g: Game): [number, number] {
  const m = g.m;
  m.wr(0xde01, (m.rd(0xde09) - 1) & 0xff);
  let [a, b, c] = entityPosition(g);
  c = (a + ((c + 4) * 8)) & 0xff;
  b = ((b + 2) * 8) & 0xff;
  let hl = 0xcd2f;
  for (;;) {
    const v = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (v !== 0xff) break;
    c = (c - 4) & 0xff;
  }
  return [b, c];
}

/** 02:4DAE — the next entry of DE40 + 2 (DE09 .. DE0A - 1) that is not 80xx: DE09 = after it,
 *  DE0B + 1; 88xx: "MISS"-like tiles CD2E-CD31 = FF 0A 0B 0C; else its value (negated when bit
 *  15 is set) in decimal (DE0C/DE0D, 00:2009); then one object per digit from CD31 backward
 *  (right to left, 8 apart) at its position (02:4E20), motion 02:4E4B. */
function numberNext(g: Game): void {
  const m = g.m;
  let a = m.rd(0xde09);
  let b = m.rd(0xde0a);
  if (a >= b) return;
  let c = a;
  let hl = add8(0xde40, (a * 2) & 0xff);
  let d: number, e: number;
  for (;;) {
    c = (c + 1) & 0xff;
    e = m.rd(hl);
    d = m.rd(hl + 1);
    hl = (hl + 2) & 0xffff;
    if (d !== 0x80) break;
    if (c >= b) return;
  }
  m.wr(0xde09, c);
  m.wr(0xde0b, (m.rd(0xde0b) + 1) & 0xff);
  if (d & 0x80 && d === 0x88) {
    m.wr(0xcd31, 0x0c);
    m.wr(0xcd30, 0x0b);
    m.wr(0xcd2f, 0x0a);
    m.wr(0xcd2e, 0xff);
  } else {
    if (d & 0x80) {
      const v = (((~d & 0xff) << 8 | (~e & 0xff)) + 1) & 0xffff;
      d = v >> 8;
      e = v & 0xff;
    }
    m.wr(0xde0c, e);
    m.wr(0xde0d, d);
    decimalWord(g, 0xde0c);
  }
  [b, c] = numberPosition(g);
  let de = 0xcd31;
  for (;;) {
    m.wr(0xde13, b);
    m.wr(0xde14, c);
    c = (c - 8) & 0xff;
    const v = m.rd(de);
    de = (de - 1) & 0xffff;
    if (v === 0xff) return;
    m.wr(0xde15, ((v & 0x0f) * 2) & 0xff);
    m.wr(0xde16, 0x00);
    objectNew(g, 0x4e4b);
  }
}

/** 02:4D8D — the entries c .. b - 1 (DE09/DE0A, DE0B = 0): the next number (02:4DAE); none shown:
 *  done; else 16 object frames (4 x 02:4EB0) and again until the objects are gone. */
function* numbersRange(g: Game, c: number, b: number): Co {
  const m = g.m;
  m.wr(0xde09, c);
  m.wr(0xde0a, b);
  m.wr(0xde0b, 0);
  for (;;) {
    numberNext(g);
    if (!m.rd(0xde0b)) return;
    let z = false;
    for (let k = 0; k < 4; k++) z = yield* objectsFrames(g, 4);
    if (z) return;
  }
}

/** 02:4D70 — the digit tiles (02:418F: rst $30 to 03:78D6 through 00:3740), objects every frame;
 *  the members' numbers (entries 0-4, 02:4D82) and the enemies' (5-0C, 02:4D8A), the enemies'
 *  first when D873 >= 5. */
function* numbersShow(g: Game): Co {
  const m = g.m;
  yield* rst30(g, 0x03, 0x3740, function* () { digitTiles(g); });
  objectsInit(g, 0x01);
  if (m.rd(0xd873) >= 0x05) {
    yield* numbersRange(g, 0x05, 0x0d);
    yield* numbersRange(g, 0x00, 0x05);
  } else {
    yield* numbersRange(g, 0x00, 0x05);
    yield* numbersRange(g, 0x05, 0x0d);
  }
}

/** 02:4D65 — effect 10: D822-D83B -> DE40 (00:1F97), the numbers (02:4D70). */
function* numbersFromD822(g: Game): Co {
  copyB(g.m, 0xd822, 0xde40, 0x1a);
  yield* numbersShow(g);
}

/** 02:4D45 — effect 11: DE40-DE59 = 80 (none), the entry of C9F7 (FF: C9D8) = 8888 (the miss
 *  mark), the numbers (02:4D70). */
function* numbersMark(g: Game): Co {
  const m = g.m;
  fill(m, 0xde40, 0x1a, 0x80);
  let a = m.rd(0xc9f7);
  if (a === 0xff) a = m.rd(0xc9d8);
  const hl = add8(0xde40, (a * 2) & 0xff);
  m.wr(hl, 0x88);
  m.wr((hl + 1) & 0xffff, 0x88);
  yield* numbersShow(g);
}

// ---------------------------------------------------------------- 12, 13: the monster picture

/** 02:529F — monster group a: DE17 = width (CC51 + a high nibble + 1), DE18 = height (low nibble
 *  + 1), DE19/DE1A = its column / row (CC41 + 2a). */
function monsterBox(g: Game, a: number): void {
  const m = g.m;
  const v = m.rd(0xcc51 + a);
  m.wr(0xde17, (((v >> 4) & 0x0f) + 1) & 0xff);
  m.wr(0xde18, ((v & 0x0f) + 1) & 0xff);
  const hl = add8(0xcc41, (a * 2) & 0xff);
  m.wr(0xde19, m.rd(hl));
  m.wr(0xde1a, m.rd(hl + 1));
}

/** 02:52DD — the map address 9800 + [hl] + 0x20 [hl + 1]. */
function mapAddress(g: Game, hl: number): number {
  const m = g.m;
  return (0x9800 + m.rd(hl) + 0x20 * m.rd(hl + 1)) & 0xffff;
}

/** 02:4FD0 — a grid of objects over the box DE17-DE1A in C000..: DE18 / 2 rows (0 = 256) of DE17
 *  objects (0 = 256), 8 apart, rows 16 apart from y 8 (row + 2), x 8 (column + 1); tile 0,
 *  attributes 40 (y flip) on even row counts. */
function monsterGrid(g: Game): void {
  const m = g.m;
  const b0 = m.rd(0xde17);
  const h = m.rd(0xde18);
  let c = ((h >> 1) | (h & 0x80)) & 0xff;
  const d0 = ((m.rd(0xde19) + 1) * 8) & 0xff;
  let e = ((m.rd(0xde1a) + 2) * 8) & 0xff;
  let hl = 0xc000;
  do {
    let b = b0, d = d0;
    do {
      m.wr(hl++, e);
      m.wr(hl++, d);
      d = (d + 8) & 0xff;
      m.wr(hl++, 0);
      m.wr(hl++, (~c & 0x01) ? 0x40 : 0x00);
      hl &= 0xffff;
      b = (b - 1) & 0xff;
    } while (b);
    e = (e + 0x10) & 0xff;
    c = (c - 1) & 0xff;
  } while (c);
}

/** 02:5017 — 16 bytes at hl -> DE40 and again -> DE50 (02:5020), DE40 -> VRAM 8000 (0x20). */
function tile16Twice(g: Game, hl: number): void {
  const m = g.m;
  copy(m, hl, 0xde40, 16);
  tile16Out(g, hl, 0xde50);
}

/** 02:5020 — 16 bytes hl -> de, then DE40 -> VRAM 8000 (0x20, 00:20FF). */
function tile16Out(g: Game, hl: number, de: number): void {
  copy(g.m, hl, de, 16);
  vramCopy(g.m, 0xde40, 0x8000, 0x0020);
}

/** 02:500C — a frame, tile 0 from hl + 16 ((DE0F - 1) & 7) twice (02:5017). */
function* tileFrame(g: Game, hl: number): Co {
  yield* g.wait(1);
  const a = (((g.m.rd(0xde0f) - 1) & 0x07) << 4) & 0xff;
  tile16Twice(g, add8(hl, a));
}

/** 02:503E — a frame, DE40-DE4F = DE52-DE5F, DE50, DE51 (00:1F6C, 00:1F90), copied to DE50
 *  and shown (02:5020). */
function* tileRoll(g: Game): Co {
  const m = g.m;
  yield* g.wait(1);
  let de: number;
  [, de] = copy(m, 0xde52, 0xde40, 14);
  [, de] = copy(m, 0xde50, de, 2);
  tile16Out(g, 0xde40, de);
}

/** 02:52C1 — the box's map blank: DE18 rows of DE17 tiles FF (00:218F) from 9800 + DE19 + 0x20
 *  DE1A. */
function monsterErase(g: Game): void {
  const m = g.m;
  const c = m.rd(0xde17);
  let b = m.rd(0xde18);
  let hl = mapAddress(g, 0xde19);
  do {
    vramFill(g, hl, c, 0xff);
    hl = (hl + 0x20) & 0xffff;
    b = (b - 1) & 0xff;
  } while (b);
}

/** 02:4FA4 — CC5C & 3 = 0: tile 0 blank (8000, 0x20 x 0), the grid over the monster (02:4FD0); 8
 *  times: tile 0 from 02:52FE (02:5009) then rolled 3 times (02:502F); the monster's map blank
 *  (02:52C1), the OAM buffer cleared. */
function* monsterDissolve(g: Game): Co {
  const m = g.m;
  vramFill(g, 0x8000, 0x0020, 0x00);
  monsterGrid(g);
  m.wr(0xde0f, 0x08);
  do {
    yield* tileFrame(g, 0x52fe);
    m.wr(0xde10, 0x03);
    do {
      yield* tileRoll(g);
      m.wr(0xde10, (m.rd(0xde10) - 1) & 0xff);
    } while (m.rd(0xde10));
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  monsterErase(g);
  clearOamBuffer(g);
}

/** 02:50C4 — DE40-DE47 -> DE48 and DE40-DE4F -> DE60; DE50-DE57 -> DE58 and DE50-DE5F -> DE70. */
function blindsMirror(g: Game): void {
  const m = g.m;
  copy(m, 0xde40, 0xde48, 8);
  copy(m, 0xde40, 0xde60, 16);
  copy(m, 0xde50, 0xde58, 8);
  copy(m, 0xde50, 0xde70, 16);
}

/** 02:5077 — the SCY lines (02:50E8 = 02:447F with c = 42), then from the bits of 02:5098[DE0F -
 *  1] (low first) DE40-DE47 = 40 / 0 and DE57-DE50 the same; mirrored (02:50C4). */
function* blindsStep(g: Game): Co {
  const m = g.m;
  yield* lineTable(g, 0x42);
  let c = m.rd(0x5098 + ((m.rd(0xde0f) - 1) & 0xff));
  let hl = 0xde40, de = 0xde57;
  for (let b = 8; b; b--) {
    const a = c & 1 ? 0x40 : 0x00;
    c >>= 1;
    m.wr(hl++, a);
    m.wr(de--, a);
  }
  blindsMirror(g);
}

/** 02:50A6 — the SCY lines (02:50E8), DE40-DE47 = DE49-DE4F, DE48; DE50-DE57 = DE5F, DE58-DE5E;
 *  mirrored (02:50C4). */
function* blindsRoll(g: Game): Co {
  const m = g.m;
  yield* lineTable(g, 0x42);
  let [, de] = copy(m, 0xde49, 0xde40, 7);
  m.wr(de, m.rd(0xde48));
  m.wr(0xde50, m.rd(0xde5f));
  copy(m, 0xde58, 0xde51, 7);
  blindsMirror(g);
}

/** 02:51B6 — map 9800-98FF blank (00:218F), a frame, SCX = SCY = 0 (02:51C4). */
function* monsterEnd(g: Game): Co {
  vramFill(g, 0x9800, 0x0100, 0xff);
  yield* g.wait(1);
  g.m.wr(SCX, 0);
  g.m.wr(SCY, 0);
}

/** 02:5055 — CC5C & 3 = 1: DE40-DE7F = 0 (02:506D); 8 times: the blinds (02:5077) and 3 rolls
 *  (02:50A0); the end (02:51B6). */
function* monsterBlinds(g: Game): Co {
  const m = g.m;
  fill(m, 0xde40, 0x40, 0x00);
  m.wr(0xde0f, 0x08);
  do {
    yield* blindsStep(g);
    for (let k = 0; k < 3; k++) yield* blindsRoll(g);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  yield* monsterEnd(g);
}

/** 02:51E0 — b = [hl + DE11 - 1]; c times: a frame, BGP = b down to line 5A, then D2. */
function* flashBand(g: Game, hl: number, c: number): Co {
  const m = g.m;
  const b = m.rd(add8(hl, (m.rd(0xde11) - 1) & 0xff));
  do {
    yield* g.wait(1);
    m.wr(BGP, b);
    yield* g.untilLine(0x5a);
    m.wr(BGP, 0xd2);
    c = (c - 1) & 0xff;
  } while (c);
}

/** 02:51FD — the noise step DE0F (sound 36 on even steps from 6): a frame; for the 0x5A tiles
 *  from 9000: the tile -> DE80 (00:20FF), DE90/DE91 = noise (00:1D2E below FF; DE90 only on odd
 *  steps below 2E, else 0), DE92-DE9F = DE80-DE8D, DEA0 + k = ~[DE80 + 2k] | [DE81 + 2k], the
 *  noise masked in (plane 0 set, plane 1 cleared where the mask is 0); with DE10 clear and LY at
 *  48 or below, SCY toggles F8 / F7 (else DE10 = 0); the tile back to VRAM (00:20FF). */
function* noiseStep(g: Game): Co {
  const m = g.m;
  let a = m.rd(0xde0f);
  if (a >= 0x06 && !(a & 0x01)) g.sfx(0x36);
  yield* g.wait(1);
  m.wr(0xde11, 0x5a);
  let tile = 0x9000;
  do {
    let de: number;
    [, de] = vramCopy(m, tile, 0xde80, 0x0010);
    a = m.rd(0xde0f);
    if (a < 0x2e && (a & 0x01)) m.wr(de, randomBelow(m, 0xff));
    else m.wr(de, 0);
    de = (de + 1) & 0xffff;
    m.wr(de, randomBelow(m, 0xff));
    de = (de + 1) & 0xffff;
    [, de] = copy(m, 0xde80, de, 14);
    let hl = 0xde80;
    for (let b = 8; b; b--) {
      const v = ~m.rd(hl) & 0xff;
      hl++;
      m.wr(de++, v | m.rd(hl));
      hl++;
    }
    hl = 0xde90;
    de = 0xdea0;
    for (let b = 8; b; b--) {
      const c = m.rd(de++);
      m.wr(hl, ~(~m.rd(hl) & c) & 0xff);
      hl++;
      m.wr(hl, m.rd(hl) & c);
      hl++;
    }
    let shake = false;
    if (!m.rd(0xde10)) {
      // 02:5278 reads LY in the middle of CPU-timed work (the hblank-paced copies): a sync point
      yield* g.point(0x025278);
      shake = m.rd(0xff44) >= 0x48;
    }
    if (shake) {
      let s = m.rd(SCY);
      if (s !== 0xf8) s = 0xf9;
      m.wr(SCY, (s - 1) & 0xff);
    } else m.wr(0xde10, 0);
    [, tile] = vramCopy(m, 0xde90, tile, 0x0010);
    m.wr(0xde11, (m.rd(0xde11) - 1) & 0xff);
  } while (m.rd(0xde11));
}

/** 02:5167 — CC5C & 3 = 3: SCY bounces (02:51CA, sound 30, 2 frames a value) as it sinks to F8;
 *  12 band flashes from 02:51D1 (02:51DE: 8 frames each), 0x20 noise steps (02:51FD), 4 band
 *  flashes from 02:4433; the end (02:51B6). */
function* monsterShatter(g: Game): Co {
  const m = g.m;
  let b = 0x00;
  for (;;) {
    g.sfx(0x30);
    let a = 0;
    for (let c = 0x05; c; c--) {
      const hl = 0x51ca + c;
      yield* g.wait(2);
      a = (m.rd(hl) + b) & 0xff;
      m.wr(SCY, a);
    }
    b = (b - 1) & 0xff;
    if (a === 0xf8) break;
  }
  m.wr(0xde11, 0x0c);
  do {
    yield* flashBand(g, 0x51d1, 0x08);
    m.wr(0xde11, (m.rd(0xde11) - 1) & 0xff);
  } while (m.rd(0xde11));
  m.wr(0xde0f, 0x20);
  do {
    yield* noiseStep(g);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  m.wr(0xde11, 0x04);
  do {
    yield* flashBand(g, PAL_LIGHT, 0x08);
    m.wr(0xde11, (m.rd(0xde11) - 1) & 0xff);
  } while (m.rd(0xde11));
  yield* monsterEnd(g);
}

/** 02:4F20 — effect 12 (enemy C9D6 >= 5 only): DE01 = C9D6 - 5, its box (02:529F), then by CC5C
 *  & 3 (00:373A): 02:4FA4, 02:5055, 02:50ED, 02:5167. */
function* monsterEffect(g: Game): Co {
  const m = g.m;
  let a = m.rd(0xc9d6);
  if (a < 0x05) return;
  a = (a - 0x05) & 0xff;
  m.wr(0xde01, a);
  monsterBox(g, a);
  switch (m.rd(0xcc5c) & 0x03) {
    case 0: yield* monsterDissolve(g); return;
    case 1: yield* monsterBlinds(g); return;
    case 2: yield* monsterTransform(g); return; // 02:50ED
    default: yield* monsterShatter(g); return;
  }
}

/** 02:4F7B — the box DE19.. (DE1B x DE1C tiles) copied row by row (00:20FF) to the box DE1D... */
function monsterCopyMap(g: Game): void {
  const m = g.m;
  const c = m.rd(0xde1b);
  let b = m.rd(0xde1c);
  let de = mapAddress(g, 0xde1d);
  let hl = mapAddress(g, 0xde19);
  do {
    vramCopy(m, hl, de, c);
    de = (de + 0x20) & 0xffff;
    hl = (hl + 0x20) & 0xffff;
    b = (b - 1) & 0xff;
  } while (b);
}

/** 02:4F3E — effect 13: tile 0 from 02:533C (02:52FE + 3E: a is the low byte of the entry,
 *  00:373B), the grid over monster C985 (02:529F, 02:4FD0), its box -> DE1B (00:1F8A), the map
 *  of monster C9D6 copied over it (02:4F7B); 7 times: tile 0 from 02:537E (02:500C), 3 frames;
 *  the OAM buffer cleared. */
function* monsterSwap(g: Game): Co {
  const m = g.m;
  tile16Twice(g, add8(0x52fe, 0x3e));
  monsterBox(g, (m.rd(0xc985) - 0x05) & 0xff);
  monsterGrid(g);
  copy(m, 0xde17, 0xde1b, 4);
  monsterBox(g, (m.rd(0xc9d6) - 0x05) & 0xff);
  monsterCopyMap(g);
  m.wr(0xde0f, 0x07);
  do {
    yield* tileFrame(g, 0x537e);
    yield* g.wait(3);
    m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
  } while (m.rd(0xde0f));
  clearOamBuffer(g);
}

// ---------------------------------------------------------------- 15, 16, 17: the figures

/** 02:4109 — the party figures: wait a frame, LCDC = E7 (8x16 objects, window on), DC80 = 0,
 *  DC81 = 0, DC82 = DDFF (pairs); from DC83 one pair of objects per figure (02:4154) at the
 *  x positions of 02:4139 (DDFF even) / 02:413D (DDFF odd), tiles from 0x36 x 2; then the
 *  mask DC81 (02:4167), CBFF = 1 (animation on), wait a frame. */
function* figuresOn(g: Game): Co {
  yield* g.wait(1);
  g.m.wr(0xff40, 0xe7);
  yield* figuresBuild(g);
}

/** 02:4110 — the figure objects built (DC80-DC82 and the pairs from DC83, as 02:4109 without its
 *  frame and LCDC), the mask DC81 (02:4167), CBFF = 1, wait a frame. */
function* figuresBuild(g: Game): Co {
  const m = g.m;
  let b = m.rd(0xddff);
  let de = (0x4139 + (((b & 0x01) * 4) & 0xff)) & 0xffff;
  let hl = 0xdc80;
  m.wr(hl++, 0);
  m.wr(hl++, 0);
  m.wr(hl++, b);
  let c = 0x36;
  do {
    [hl, de, c] = figurePair(g, hl, de, c);
    b = (b - 1) & 0xff;
  } while (b);
  yield* figureMask(g);
  m.wr(0xcbff, 0x01);
  yield* g.wait(1);
}

/** 02:4142 — the figures cleared: DC83-DCAA = 0 (5 pairs), wait a frame, CBFF = 0 (animation
 *  off). */
function* figuresOff(g: Game): Co {
  const m = g.m;
  let hl = 0xdc83;
  for (let b = 0x28; b; b--) m.wr(hl++, 0);
  yield* g.wait(1);
  m.wr(0xcbff, 0);
}

/** 02:4154 — one figure: two objects (02:415C) at x = [de] and [de] + 8; de + 1. Returns
 *  [hl, de, c] after. */
function figurePair(g: Game, hl: number, de: number, c: number): [number, number, number] {
  const m = g.m;
  [hl, c] = figureObject(g, hl, m.rd(de), c);
  const x = (m.rd(de) + 0x08) & 0xff;
  de = (de + 1) & 0xffff;
  [hl, c] = figureObject(g, hl, x, c);
  return [hl, de, c];
}

/** 02:415C — one object entry at hl: y 58, x a, tile 2c, attributes 0; c + 1. Returns [hl, c]
 *  after. */
function figureObject(g: Game, hl: number, a: number, c: number): [number, number] {
  const m = g.m;
  m.wr(hl, 0x58);
  hl = (hl + 1) & 0xffff;
  m.wr(hl, a);
  hl = (hl + 1) & 0xffff;
  const t = (c * 2) & 0xff;
  c = (c + 1) & 0xff;
  m.wr(hl, t);
  hl = (hl + 1) & 0xffff;
  m.wr(hl, 0);
  hl = (hl + 1) & 0xffff;
  return [hl, c];
}

/** 02:4167 — DC81 = the frozen-figure mask (02:416E). Sync point 02:4167: the vblank's flips
 *  (00:3E26) read DC81, and the original's script reaches it after the frame's vblank when the
 *  port's would be before (zb02). */
function* figureMask(g: Game): Co {
  yield* g.point(0x024167);
  g.m.wr(0xdc81, frozenMask(g));
}

/** 02:416E (de = C0C0) / 02:4171 (de given) — bit k (k = 0..4) set when member k's status byte
 *  D001 + 0x80 k has a bit of e or D002 + 0x80 k a bit of d set (00:3E26 leaves those figures
 *  unflipped). No RAM writes. */
function frozenMask(g: Game, d = 0xc0, e = 0xc0): number {
  const m = g.m;
  let hl = 0xd001, c = 0x00, carry = 0;
  for (let b = 0x05; b; b--) {
    let a = e & m.rd(hl); // and [hl]: carry 0
    carry = 0;
    if (!a) {
      a = m.rd((hl + 1) & 0xffff) & d; // inc hl; ld a,[hl-]; and d
      carry = 0;
    }
    if (a) a = (a + 1) & 0xff; // 02:4180 inc a (z: skipped)
    // rra
    const ca = a & 1;
    a = ((a >> 1) | (carry << 7)) & 0xff;
    carry = ca;
    // rr c
    const cc = c & 1;
    c = ((c >> 1) | (carry << 7)) & 0xff;
    carry = cc;
    // ld a,$80 ; rst $00: hl += 0x80 (add hl,bc sets carry on overflow)
    const s = hl + 0x80;
    carry = s > 0xffff ? 1 : 0;
    hl = s & 0xffff;
  }
  let a = c;
  for (let k = 0; k < 3; k++) {
    const ca = a & 1;
    a = ((a >> 1) | (carry << 7)) & 0xff;
    carry = ca;
  }
  return a;
}

// ---------------------------------------------------------------- 02:4000: the battle action

/** 02:40E8 — the figure entry of member a: DC83 + 8a (8-bit). */
function figureEntry(a: number): number {
  return add8(0xdc83, (a * 8) & 0xff);
}

/** 02:40F0 — both objects of figure a at y = [de]. */
function figureY(g: Game, a: number, de: number): void {
  const m = g.m;
  const hl = figureEntry(a);
  const v = m.rd(de);
  m.wr(hl, v);
  m.wr((hl + 4) & 0xffff, v);
}

/** 02:40DB — figure a at x = c (its second object at c + 8). */
function figureX(g: Game, a: number, c: number): void {
  const m = g.m;
  const hl = (figureEntry(a) + 1) & 0xffff;
  m.wr(hl, c);
  m.wr((hl + 4) & 0xffff, (c + 8) & 0xff);
}

/** 02:40D6 — 3 frames. */
function* wait3(g: Game): Co {
  yield* g.wait(3);
}

/** 02:4023 — unless C9E6 is FF: the figure of target C9D6 (members only) hops through the 4 y
 *  values at de, 2 frames each. */
function* targetHop(g: Game, de: number): Co {
  const m = g.m;
  if (m.rd(0xc9e6) === 0xff) return;
  for (let b = 4; b; b--) {
    const a = m.rd(0xc9d6);
    if (a >= 0x05) return;
    figureY(g, a, de);
    yield* g.wait(2);
    de = (de + 1) & 0xffff;
  }
}

/** 02:40A7 — figures DE01 and DE10 trade places: c = 10 (F0 when DE01 < DE10); DE10 to x(DE01) -
 *  c, 3 frames, DE01 to x + c and DE10 to x, 3 frames twice (02:40D6 called, then fallen into). */
function* figureSwap(g: Game): Co {
  const m = g.m;
  const e = m.rd(0xde10);
  const d = m.rd(0xde01);
  const c = d < e ? 0xf0 : 0x10;
  const b = m.rd((figureEntry(d) + 1) & 0xffff);
  figureX(g, e, (b - c) & 0xff);
  yield* wait3(g);
  figureX(g, d, (c + b) & 0xff);
  figureX(g, e, b);
  yield* wait3(g);
  yield* wait3(g);
}

/** 02:403D — a member's action (DE10 = DE01; nothing unless CBFF and DE00 are set): C99C bit 7
 *  (all members): the unfrozen figures (02:4171 with de = 00C0) step through the 7 y values of
 *  02:40FA, 3 frames each; else (target C9F7 a member and C99C bit 6 clear: DE10 = C9F7, the swap
 *  02:40A7) figure DE01 steps through 02:40FA, and with a member target the figures are rebuilt
 *  (02:4110). */
function* memberAction(g: Game, a: number): Co {
  const m = g.m;
  m.wr(0xde10, a);
  if (!m.rd(0xcbff)) return;
  if (!m.rd(0xde00)) return;
  const b0 = m.rd(0xc99c);
  if (b0 & 0x80) {
    const c0 = frozenMask(g, 0x00, 0xc0);
    const n = m.rd(0xdc82);
    let de = 0x40fa;
    m.wr(0xde0f, 0x07);
    do {
      let c = c0, k = 0, b = n;
      do {
        const carry = c & 1;
        c >>= 1;
        if (!carry) figureY(g, k, de);
        k = (k + 1) & 0xff;
        b = (b - 1) & 0xff;
      } while (b);
      yield* wait3(g);
      de = (de + 1) & 0xffff;
      m.wr(0xde0f, (m.rd(0xde0f) - 1) & 0xff);
    } while (m.rd(0xde0f));
    return;
  }
  const t = m.rd(0xc9f7);
  const member = t < 0x05;
  if (member && !(b0 & 0x40)) {
    m.wr(0xde10, t);
    yield* figureSwap(g);
  }
  let de = 0x40fa;
  for (let b = 7; b; b--) {
    figureY(g, m.rd(0xde01), de);
    yield* wait3(g);
    de = (de + 1) & 0xffff;
  }
  if (member) yield* figuresBuild(g);
}

/** 02:430B — the 6 x 5 cell picture DE40 flipped vertically: rows 0/4 and 1/3 swapped, every
 *  cell's bit 6 (y flip) toggled. */
function cellsFlipY(g: Game): void {
  const m = g.m;
  let hl = 0xde40, de = 0xde58;
  for (let b = 2; b; b--) {
    for (let c = 6; c; c--) {
      const x = m.rd(hl);
      m.wr(hl++, m.rd(de) ^ 0x40);
      m.wr(de++, x ^ 0x40);
    }
    de = (de - 0x0c) & 0xffff;
  }
  for (let b = 6; b; b--) {
    m.wr(hl, m.rd(hl) ^ 0x40);
    hl++;
  }
}

/** 02:433B — the picture DE40 flipped horizontally: columns 0/5, 1/4, 2/3 of each row swapped, bit
 *  5 (x flip) toggled. */
function cellsFlipX(g: Game): void {
  const m = g.m;
  let hl = 0xde40, de = 0xde45;
  for (let b = 5; b; b--) {
    for (let c = 3; c; c--) {
      const x = m.rd(hl);
      m.wr(hl++, m.rd(de) ^ 0x20);
      m.wr(de--, x ^ 0x20);
    }
    de = (de + 9) & 0xffff;
    hl += 3;
  }
}

/** 02:4210 — an action frame: DE03 = 4 ((a & 7) + 1) frames, DE04 = (a << 1) & 70 (40 flip y, 20
 *  flip x, 10 object attribute bit 4); DE05 / DE06 = 8 x the column / row of entity DE01
 *  (02:42C0); picture e of 02:5A95 unpacked to the 30 cells DE40 (a byte below 80: a cell; 80 +
 *  n: n times the next byte; C0 + n: n empty cells 1F); flipped (02:430B, 02:433B); the OAM
 *  buffer cleared and one object per non-empty cell (5 rows of 6, 8 apart from DE06 / DE05; tile
 *  DE02 + cell & 1F, attributes cell & 60 | DE04 & 10; DE07/DE08 the position). */
function actionFrame(g: Game, a: number, e: number): void {
  const m = g.m;
  m.wr(0xde03, ((((a & 0x07) + 1) * 4)) & 0xff);
  m.wr(0xde04, (a << 1) & 0x70);
  const [, rb, rc] = entityPosition(g);
  m.wr(0xde05, (rc * 8) & 0xff);
  m.wr(0xde06, (rb * 8) & 0xff);
  let hl = m.rd16((0x5a95 + 2 * e) & 0xffff);
  let de = 0xde40, b = 0x1e;
  outer: for (;;) {
    let v = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (!(v & 0x80)) {
      m.wr(de++, v);
      b--;
      if (!b) break;
      continue;
    }
    let c = v & 0x1f;
    if (v & 0x40) v = 0x1f;
    else {
      v = m.rd(hl);
      hl = (hl + 1) & 0xffff;
    }
    for (;;) {
      m.wr(de++, v);
      b--;
      if (!b) break outer;
      c = (c - 1) & 0xff;
      if (!c) break;
    }
  }
  const f = m.rd(0xde04);
  if (f & 0x40) cellsFlipY(g);
  if (f & 0x20) cellsFlipX(g);
  clearOamBuffer(g);
  de = 0xde40;
  hl = 0xc000;
  let y = m.rd(0xde06);
  for (let row = 5; row; row--) {
    if (row !== 5) y = (m.rd(0xde08) + 8) & 0xff;
    m.wr(0xde08, y);
    m.wr(0xde07, m.rd(0xde05));
    for (let c = 6; c; c--) {
      const v = m.rd(de) & 0x1f;
      if (v !== 0x1f) {
        m.wr(hl++, m.rd(0xde08));
        m.wr(hl++, m.rd(0xde07));
        m.wr(hl++, (m.rd(0xde02) + v) & 0xff);
        m.wr(hl++, (m.rd(de) & 0x60) | (m.rd(0xde04) & 0x10));
      }
      de++;
      m.wr(0xde07, (m.rd(0xde07) + 8) & 0xff);
    }
  }
}

/** 02:41B1 — an enemy's action DE00: its 0x10 tiles 02:658C + 0x20 [02:651C + DE00] -> VRAM 8000
 *  (0x200, 00:20FF), the effect tiles 03:79D4 -> 8200 (0x4A0; 03:79C8 through rst $30 / 00:3740),
 *  DE02 = 0; then the action data at the word 02:53EE + 2 DE00: FF: the end (02:45AE); 80 + n:
 *  DE02 = 2n (tile base); 40 + k: battle effect k (02:4397); else a frame byte and a picture
 *  (02:4210), then DE03 frames. */
function* enemyAction(g: Game): Co {
  const m = g.m;
  const k = m.rd(add8(0x651c, m.rd(0xde00)));
  // (both copies are hblank-paced, 00:20FF: they show line by line and take the main code's time)
  g.vramPaced(() => vramCopy(m, (0x658c + k * 0x20) & 0xffff, 0x8000, 0x0200), 0x8000, 0x0200);
  yield* g.pacedDone();
  yield* rst30(g, 0x03, 0x3740, function* () {
    g.vramPaced(() => vramCopy(m, 0x79d4, 0x8200, 0x04a0), 0x8200, 0x04a0);
    yield* g.pacedDone();
  });
  m.wr(0xde02, 0);
  let p = m.rd16(add8(0x53ee, (m.rd(0xde00) * 2) & 0xff));
  for (;;) {
    const v = m.rd(p);
    p = (p + 1) & 0xffff;
    if (v === 0xff) {
      yield* objectsEnd(g);
      return;
    }
    if (v & 0x80) {
      m.wr(0xde02, (v * 2) & 0xff);
      continue;
    }
    if (v & 0x40) {
      yield* effectDispatch(g, v);
      continue;
    }
    const e = m.rd(p);
    p = (p + 1) & 0xffff;
    actionFrame(g, v, e);
    yield* g.wait(m.rd(0xde03));
  }
}

/** 02:4000 — the battle action display (bank 02): C9BD bit 7 clear: battle effect C9BD & 3F
 *  (02:4397); else DE00 = C9BD & 7F, DE01 = the actor C9D8: a member: 02:403D; an enemy: the
 *  target's hop (02:4023 with 02:4101), the action (02:41B1), the hop back (02:4105). */
export function* battleAction(g: Game): Co {
  const m = g.m;
  let a = m.rd(0xc9bd);
  if (!(a & 0x80)) {
    yield* effectDispatch(g, a);
    return;
  }
  m.wr(0xde00, a & 0x7f);
  a = m.rd(0xc9d8);
  m.wr(0xde01, a);
  if (a < 0x05) {
    yield* memberAction(g, a);
    return;
  }
  yield* targetHop(g, 0x4101);
  yield* enemyAction(g);
  yield* targetHop(g, 0x4105);
}

/** 0C:6B7F — the battle action: C0B3/C0B4 = 4000, bank 02, `rst $30` (02:4000). */
export function* battleActionCall(g: Game): Co {
  yield* rst30(g, 0x02, 0x4000, () => battleAction(g));
}

// ---------------------------------------------------------------- bank 0C natives (0C:6B25..)

/** 0C:6B6E — DE00 = a, then 0C:6B71: the effect through `rst $30` (C0B3/C0B4 = 02:4394, bank
 *  02). */
export function* battleEffectA(g: Game, a: number): Co {
  g.m.wr(0xde00, a);
  yield* battleEffectCall(g);
}

/** 0C:6B71 — battle effect DE00: C0B3/C0B4 = 4394, bank 02, `rst $30` (02:4394). */
export function* battleEffectCall(g: Game): Co {
  yield* rst30(g, 0x02, 0x4394, () => battleEffect(g));
}

/** 0C:6B6C — battle effect 10 (the numbers of D822, 0C:6B6E). */
export function* numbersEffect(g: Game): Co {
  yield* battleEffectA(g, 0x10);
}

/** 0B:4502 — monster C91B's base record only: CC70 = C91B, D690.. cleared (0B:451C), its record
 *  (0B:453A). Bank 0B selected. */
function enemyBaseC91B(g: Game): void {
  const m = g.m;
  m.wr(0xcc70, m.rd(0xc91b));
  clearEnemyRecord(m);
  enemyBaseRecord(g);
}

/** 0B:706C — one of item CE91 taken from the bag C6FF (0x18 pairs id, count): not found or a
 *  count of 0: CE91 = FF; else its count - 1. */
function bagTake(g: Game): void {
  const m = g.m;
  const a = m.rd(0xce91);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (a === m.rd(hl)) {
      hl = (hl + 1) & 0xffff;
      const n = m.rd(hl);
      if (!n) break;
      m.wr(hl, (n - 1) & 0xff);
      return;
    }
    hl = (hl + 2) & 0xffff;
  }
  m.wr(0xce91, 0xff);
}

/** 0C:6B2B — C9D6 below 5 (a member): one of item CE91 taken from the bag (0B:706C); else CE91 =
 *  FF. */
export function bagTakeNative(g: Game): void {
  const m = g.m;
  if (m.rd(0xc9d6) >= 0x05) {
    m.wr(0xce91, 0xff);
    return;
  }
  farSync(g, 0x0b, () => bagTake(g));
}

/** 0B:7037 — item CE94 put in the bag C6FF: its pair found: count + 1 (9 or more: CE94 = FF);
 *  else the first free pair (id FF) = CE94, 1; none: CE94 = FF. */
function bagPut(g: Game): void {
  const m = g.m;
  const id = m.rd(0xce94);
  const full = (): void => m.wr(0xce94, 0xff); // 0B:7057
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (id === m.rd(hl)) { // 0B:705D
      hl = (hl + 1) & 0xffff;
      const n = m.rd(hl);
      if (n >= 0x09) return full();
      m.wr(hl, (n + 1) & 0xff);
      return;
    }
    hl = (hl + 2) & 0xffff;
  }
  hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (m.rd(hl) === 0xff) { // 0B:7065
      m.wr(hl, m.rd(0xce94));
      m.wr((hl + 1) & 0xffff, 0x01);
      return;
    }
    hl = (hl + 2) & 0xffff;
  }
  full();
}

/** 00:1E8F — the name of id [hl]: below 30: 0E:6D9B + 6 id (c = 6); 30 and above: 0E:6EBB + 8
 *  (id - 30) (c = 8); FF: 00:3155 (c = 8). Returns [hl, c]. */
function nameSource(g: Game, hl: number): [number, number] {
  const a = g.m.rd(hl);
  if (a === 0xff) return [0x3155, 0x08];
  if (a < 0x30) return [(0x6d9b + a * 6) & 0xffff, 0x06];
  return [(0x6ebb + ((a - 0x30) & 0xff) * 8) & 0xffff, 0x08];
}

/** 0B:701A — unless CE8C is FF: its name (00:1E8F, bank 0E) -> CE3C (00:1F97), the trailing
 *  FF trimmed: FF written after it, then a 0 after its last non-FF byte. */
function nameToCE3C(g: Game): void {
  const m = g.m;
  if (m.rd(0xce8c) === 0xff) return;
  const [src, c] = nameSource(g, 0xce8c);
  let de: number;
  [, de] = far0Sync(g, 0x0e, () => copyB(m, src, 0xce3c, c));
  let hl = de;
  m.wr(hl, 0xff);
  let a: number;
  do {
    a = m.rd(hl);
    hl = (hl - 1) & 0xffff;
  } while (a === 0xff);
  hl = (hl + 2) & 0xffff;
  m.wr(hl, 0x00);
}

/** 00:391B — the byte at hl in bank a (rst $20 / rst $28 around it). */
function byteOfBank(g: Game, a: number, hl: number): number {
  pushBank(g, a);
  const v = g.m.rd(hl);
  popBank(g);
  return v;
}

/** 09:551E — byte 0: C9AD = 0B:7104[high nibble]; C9AF = C9B2 = low nibble, C9AE =
 *  0B:7114[low nibble]; C9AF = 0, then C9AE when the low nibble was 1 or 2. Returns hl + 1. */
function recordKind(g: Game, hl: number): number {
  const m = g.m;
  let a = (m.rd(hl) >> 4) & 0x0f;
  m.wr(0xc9ad, byteOfBank(g, 0x0b, 0x7104 + a));
  a = m.rd(hl) & 0x0f;
  hl = (hl + 1) & 0xffff;
  m.wr(0xc9af, a);
  m.wr(0xc9b2, a);
  m.wr(0xc9ae, byteOfBank(g, 0x0b, 0x7114 + a));
  const v = m.rd(0xc9af);
  m.wr(0xc9af, 0);
  if (((v - 1) & 0xff) < 0x02) m.wr(0xc9af, m.rd(0xc9ae));
  return hl;
}

/** 09:5466 — the record of C99B (high nibble: its table) / C99D (its index) to C9AD-C9BE: 0 (or
 *  5) 09:55C4, 1 09:57BC, 2 09:5A50, 3 09:5B70, 4 09:5BFC; fields by the per-table readers
 *  09:551E-55B5. Bank 09 selected. */
function abilityRecord(g: Game): void {
  const m = g.m;
  const k = (m.rd(0xc99b) >> 4) & 0x0f;
  let c = m.rd(0xc99d);
  let hl: number;
  const byte = (dst: number): void => { m.wr(dst, m.rd(hl)); hl = (hl + 1) & 0xffff; };
  const nibbles = (hi: number, lo: number): void => {
    m.wr(hi, (m.rd(hl) >> 4) & 0x0f);
    m.wr(lo, m.rd(hl) & 0x0f);
    hl = (hl + 1) & 0xffff;
  };
  const f5557 = (): void => byte(0xc9b6);
  const f555C = (): void => {
    m.wr(0xc9b3, (m.rd(hl) >> 6) & 0x03);
    const a = m.rd(hl) & 0x3f;
    hl = (hl + 1) & 0xffff;
    m.wr(0xc9bc, a);
    if (a >= 0x0a && a < 0x0d) m.wr(0xc9af, 0);
  };
  const f5575 = (): void => byte(0xc9bd);
  const f557A = (): void => {
    m.wr(0xc9bb, (m.rd(hl) >> 6) & 0x03);
    m.wr(0xc9be, m.rd(hl) & 0x3f);
    hl = (hl + 1) & 0xffff;
  };
  const f558D = (): void => byte(0xc9ba);
  const f5592 = (): void => nibbles(0xc9b0, 0xc9b1);
  const f55A1 = (): void => byte(0xc9b9);
  const f55A6 = (): void => nibbles(0xc9b4, 0xc9b5);
  const f55B5 = (): void => nibbles(0xc9b7, 0xc9b8);
  const x3 = (base: number, a: number): number => add8(add8(add8(base, a), a), a);
  switch (k) {
    case 0: case 5: { // 09:5488 (5: the jump lands on 5488 itself)
      const a1 = (0xd0 + c) & 0xff;
      hl = x3(add8(0x55c4, a1), (a1 * 2) & 0xff);
      hl = recordKind(g, hl);
      f5557(); f555C(); f5575(); f557A(); f558D(); f5592();
      return;
    }
    case 1: // 09:5501
      hl = x3(0x57bc, (c * 2) & 0xff);
      hl = recordKind(g, hl);
      f5557(); f555C(); f5575(); f557A(); f55A1();
      return;
    case 2: // 09:54C7
      hl = x3(0x5a50, (c * 2) & 0xff);
      hl = recordKind(g, hl);
      f5557(); f555C(); f5575(); f557A(); f55A1();
      return;
    case 3: { // 09:54E4
      c = (0x40 + c) & 0xff;
      const a = (((c * 4) & 0xff) + c) & 0xff;
      hl = add8(0x5b70, a);
      hl = recordKind(g, hl);
      f5557(); f555C(); f5575(); f557A();
      return;
    }
    case 4: { // 09:54AB
      const a1 = (0x88 + c) & 0xff;
      const a2 = (a1 * 2) & 0xff;
      hl = add8(add8(add8(0x5bfc, a1), a2), a2);
      hl = recordKind(g, hl);
      f55B5(); f55A6(); f558D(); f5592();
      return;
    }
    default:
      abilityRecordStray(g, k, c); // 09:5466: the jump 09:5479 + 3 k lands inside code
      return;
  }
}

/** 0B:6EB6 — CE8F = 5 + the lowest set bit of [hl], CE90 = 5 + the highest (the original loops
 *  forever on 0). */
function bitSpan(g: Game, hl: number): void {
  const m = g.m;
  const v = m.rd(hl);
  if (!v) throw new NotPorted("0B:6EB6 with a 0 byte (the original loops forever)");
  let a = 0;
  while (!((v >> a) & 1)) a++;
  m.wr(0xce8f, (a + 5) & 0xff);
  a = 7;
  while (!((v >> a) & 1)) a--;
  m.wr(0xce90, (a + 5) & 0xff);
}

/** 0B:6EAE — the bit span (0B:6EB6) of the group byte CC5E + CE84 - 1. */
function groupSpan(g: Game): void {
  bitSpan(g, add8(0xcc5e, (g.m.rd(0xce84) - 1) & 0xff));
}

/** 0B:7E89 — D888 = [the word C97B + C995 + 2 ((C96E - 1) & FE)] (8-bit offset). */
function tableByteD888(g: Game): void {
  const m = g.m;
  const hl = m.rd16(0xc97b);
  const c = m.rd(0xc995);
  let a = (((m.rd(0xc96e) - 1) & 0xfe) * 2) & 0xff;
  a = (a + c) & 0xff;
  m.wr(0xd888, m.rd(add8(hl, a)));
}

/** 0B:6947 — the group of enemy slot a (5..): the index of the first byte from CC5E with bit
 *  a - 5 set (00:1EF1). */
function groupOfSlot(g: Game, a: number): number {
  const m = g.m;
  const s = (a - 0x05) & 0xff;
  const b = s < 8 ? 1 << s : 0;
  if (!b) throw new NotPorted("0B:6947 with no bit (the original loops forever)");
  let hl = 0xcc5e, c = 0;
  while (!(b & m.rd(hl))) {
    hl = (hl + 1) & 0xffff;
    c = (c + 1) & 0xff;
  }
  return c;
}

/** 09:5D64 — the item of field 40 of entity CD36: CE25 = CE27 = 0, CE26 = C540 + offset; FF:
 *  CE28 = 81; else its record (09:5D7F). Bank 09 selected. */
function entityItemLoad(g: Game): void {
  const m = g.m;
  m.wr(0xce25, 0);
  m.wr(0xce27, 0);
  const hl = (entityOffset(m) + 0xc540) & 0xffff;
  const a = m.rd(hl);
  m.wr(0xce26, a);
  if (a === 0xff) {
    m.wr(0xce28, 0x81);
    return;
  }
  itemLoad(g);
}

/** 0C:6B25 — monster C91B's record (farcall 0B:44F0). */
export function monsterRecordNative(g: Game): void {
  farSync(g, 0x0b, () => enemyRecordC91B(g));
}
/** 0C:6B28 — monster C91B's base record (farcall 0B:4502). */
export function monsterBaseNative(g: Game): void {
  farSync(g, 0x0b, () => enemyBaseC91B(g));
}
/** 0C:6B3B — item CE94 put in the bag (farcall 0B:7037). */
export function bagPutNative(g: Game): void {
  farSync(g, 0x0b, () => bagPut(g));
}
/** 0C:6B41 — the name of CE8C to CE3C (farcall 0B:701A). */
export function nameNative(g: Game): void {
  farSync(g, 0x0b, () => nameToCE3C(g));
}
/** 0C:6B44 — entity CD36's resistances (farcall 0B:7349) and attributes (farcall 0B:728B). */
export function entityRefreshNative(g: Game): void {
  farSync(g, 0x0b, () => entityResist(g));
  farSync(g, 0x0b, () => entityStats(g));
}
/** 0C:6B49 — the record of C99B/C99D to C9AD.. (farcall 09:5466). */
export function abilityRecordNative(g: Game): void {
  farSync(g, 0x09, () => abilityRecord(g));
}
/** 0C:6B4C — the bit span of group CE84 (farcall 0B:6EAE). */
export function groupSpanNative(g: Game): void {
  farSync(g, 0x0b, () => groupSpan(g));
}
/** 0C:6B52 — D888 from the table C97B (farcall 0B:7E89). */
export function tableByteNative(g: Game): void {
  farSync(g, 0x0b, () => tableByteD888(g));
}
/** 0C:6B58 — D87A = the group of enemy slot D87A (farcall 0B:6947). */
export function groupOfSlotNative(g: Game): void {
  const m = g.m;
  const a = farSync(g, 0x0b, () => groupOfSlot(g, m.rd(0xd87a)));
  m.wr(0xd87a, a);
}
/** 0C:6B61 — the item of entity CD36 (farcall 09:5D64). */
export function entityItemNative(g: Game): void {
  farSync(g, 0x09, () => entityItemLoad(g));
}
/** 0C:6B64 — the record of item CE26 (farcall 09:5D7F). */
export function itemLoadNative(g: Game): void {
  farSync(g, 0x09, () => itemLoad(g));
}

nativeRoutines.set(0x6b25, function* (g) { monsterRecordNative(g); });
nativeRoutines.set(0x6b28, function* (g) { monsterBaseNative(g); });
nativeRoutines.set(0x6b2b, function* (g) { bagTakeNative(g); });
nativeRoutines.set(0x6b3b, function* (g) { bagPutNative(g); });
nativeRoutines.set(0x6b41, function* (g) { nameNative(g); });
nativeRoutines.set(0x6b44, function* (g) { entityRefreshNative(g); });
nativeRoutines.set(0x6b49, function* (g) { abilityRecordNative(g); });
nativeRoutines.set(0x6b4c, function* (g) { groupSpanNative(g); });
nativeRoutines.set(0x6b52, function* (g) { tableByteNative(g); });
nativeRoutines.set(0x6b58, function* (g) { groupOfSlotNative(g); });
nativeRoutines.set(0x6b61, function* (g) { entityItemNative(g); });
nativeRoutines.set(0x6b64, function* (g) { itemLoadNative(g); });
nativeRoutines.set(0x6b6c, (g) => numbersEffect(g));
nativeRoutines.set(0x6b71, (g) => battleEffectCall(g));
nativeRoutines.set(0x6b7f, (g) => battleActionCall(g));

// ---------------------------------------------------------------- effect 14 (bank 0E)

/** 0E:7DAD — the 8 bits of the mask byte at de (MSB first): each set bit stores tile c at hl
 *  (c + 1); hl + 1 a bit. Returns [hl, de, c]. */
function maskByte(m: Memory, hl: number, de: number, c: number): [number, number, number] {
  let a = m.rd(de);
  de = (de + 1) & 0xffff;
  for (let b = 8; b; b--) {
    const bit = a & 0x80;
    a = (a << 1) & 0xff;
    if (bit) { m.wr(hl, c); c = (c + 1) & 0xff; }
    hl = (hl + 1) & 0xffff;
  }
  return [hl, de, c];
}

/** 0E:7D6C — bc picture bytes hl -> 9000 (00:20FF); DF00-DFFF = FF (00:3921); the map from the
 *  mask de (8 rows of 2 bytes, 0E:7DAA twice a row, rows 20 apart from DF02): set bits get tiles
 *  0, 1, ..; DF00-DFFF -> 9800 (00:20FF). */
function pictureFromMask(m: Memory, hl: number, de: number, bc: number): void {
  vramCopy(m, hl, 0x9000, bc);
  fill(m, 0xdf00, 0x0100, 0xff);
  hl = 0xdf02;
  let c = 0;
  for (let b = 8; b; b--) {
    [hl, de, c] = maskByte(m, hl, de, c);
    [hl, de, c] = maskByte(m, hl, de, c);
    hl = (hl + 0x10) & 0xffff;
  }
  vramCopy(m, 0xdf00, 0x9800, 0x0100);
}

/** 0E:7DBF — battle effect 14 (bank 0E): the entity C91B below 78 with its slot shape CC51[C9D6 -
 *  5] & 57 = 57: SCY 40, the picture 0E:7E86 (E0 bytes, mask 0E:7E56, 0E:7D6C), then 16 steps of 3
 *  frames: SCY, WY from 0E:7E66 (sound 10 at the 11th); else a frame, SCY C0, SCX 28, the 4 tiles
 *  0E:6CCF (+ 40 for C91B below 77) -> 9000 (00:20FF), a frame, the map 9889/988A = 0/2,
 *  98A9/98AA = 1/3, then steps of 3 frames: SCY from 0E:7E1F, SCX - 4 until 0. */
function* bigMonsterEffect(g: Game): Co {
  const m = g.m;
  const e = m.rd(0xc91b);
  if (e < 0x78) {
    const s = m.rd((0xcc51 + ((m.rd(0xc9d6) - 5) & 0xff)) & 0xffff) & 0x57;
    if (s >= 0x57) { // 0E:7E29
      m.wr(0xff42, 0x40);
      pictureFromMask(m, 0x7e86, 0x7e56, 0x00e0);
      let hl = 0x7e66;
      for (let b = 0x10; b; b--) {
        yield* g.wait(3);
        m.wr(0xff42, m.rd(hl)); hl++;
        m.wr(0xff4a, m.rd(hl)); hl++;
        if (b === 0x06) g.sfx(0x10);
      }
      return;
    }
  }
  yield* g.wait(1); // 0E:7DD6
  m.wr(0xff42, 0xc0);
  m.wr(0xff43, 0x28);
  vramCopy(m, e < 0x77 ? 0x6d0f : 0x6ccf, 0x9000, 0x0040);
  yield* g.wait(1);
  m.wr(0x9889, 0x00);
  m.wr(0x988a, 0x02);
  m.wr(0x98a9, 0x01);
  m.wr(0x98aa, 0x03);
  let hl = 0x7e1f;
  do {
    yield* g.wait(3);
    m.wr(0xff42, m.rd(hl)); hl++;
    m.wr(0xff43, (m.rd(0xff43) - 4) & 0xff);
  } while (m.rd(0xff43));
}
