/** Legend III B on foot (01:47B2, called by the field step 00:07FC on maps C6E8 >= 0C with bank
 *  01 selected): the leader jumps in its facing C6EE. The cells ahead decide (01:4A7F): a hop in
 *  place (01:495E), a jump one cell on (01:47F1 ...), two cells on (01:4805 ...), or no jump at
 *  all (01:48FF: the screen shakes and a text is shown). Each jump frame (01:49BD) moves the
 *  leader's C210 by the arc 01:4A2F and the companion (its shadow, slot 1) by 01:4A3F with the
 *  arc counter CA13. Returned booleans stand for the Z flag the original routines return
 *  (true = nz). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy } from "./sys.js";
import { fa, fget, fset, slot, setSlot } from "./objects.js";
import { cellCheck, blocked, cellByte, cellLook, drawObjects } from "./actors.js";
import { companionFollow, leaderUp, leaderDown, leaderRight, leaderLeft, leaderNext } from "./events2.js";
import { mapAnimation, windowClose } from "./window.js";
import { printText } from "./text.js";

type Pair = "c210" | "c290" | "c2b0";

/** A 16-bit field of the slot plus the word w (add / adc, no mask). */
function addWord(m: Memory, a: number, w: number): void {
  const s = m.rd(a) + (w & 0xff);
  m.wr(a, s & 0xff);
  m.wr(a + 1, (m.rd(a + 1) + (w >> 8) + (s >> 8)) & 0xff);
}

/** A 16-bit field of the slot plus d (+-10), the borrow / carry into the high byte, which is
 *  masked by [mask] (CA04 / CA05). */
function addCell(m: Memory, f: Pair, d: number, mask: number): void {
  const a = fa(m, f);
  const s = m.rd(a) + d;
  m.wr(a, s & 0xff);
  const c = s > 0xff || s < 0 ? 1 : 0;
  m.wr(a + 1, ((m.rd(a + 1) + (d > 0 ? c : -c)) & 0xff) & m.rd(mask));
}

// ---------------------------------------------------------------- cells (bank 0 / bank 01)

/** 00:1060 — the cell C800-C803 read (00:0187: C806, C805) and the move mask C804 (01:4EE1);
 *  returns a: C0 or 80 for those kinds of cell (C805 & C0), else C805. */
function cellTest(g: Game): number {
  cellCheck(g);
  const c805 = g.m.rd(0xc805);
  if ((c805 & 0xc0) === 0xc0) return 0xc0;
  if ((c805 & 0xc0) === 0x80) return 0x80;
  return c805;
}

/** 01:471E — C804 = the slot's C2E0, the next cell C800-C803 by C6EE (01:4755 up, 4793 right,
 *  4774 down, 4736 left). */
function leaderTarget(m: Memory): void {
  m.wr(0xc804, fget(m, "c2e0"));
  const d = m.rd(0xc6ee);
  leaderNext(m, d === 0x00 || d === 0x40 || d === 0x80 ? d : 0xc0);
}

/** 01:5312 — C804 = the slot's C2E0, C800-C803 = its next cell by C2D0 (00 up, 40 right, 80
 *  down, C0 left). */
function objectTarget(m: Memory): void {
  m.wr(0xc804, fget(m, "c2e0"));
  let yl = fget(m, "c290"), yh = fget(m, "c290", 1), xl = fget(m, "c2b0"), xh = fget(m, "c2b0", 1);
  const d = fget(m, "c2d0") & 0xc0;
  if (d === 0x00) { const s = yl - 0x10; yl = s & 0xff; yh = ((yh - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca04); }
  else if (d === 0x40) { const s = xl + 0x10; xl = s & 0xff; xh = ((xh + (s >> 8)) & 0xff) & m.rd(0xca05); }
  else if (d === 0x80) { const s = yl + 0x10; yl = s & 0xff; yh = ((yh + (s >> 8)) & 0xff) & m.rd(0xca04); }
  else { const s = xl - 0x10; xl = s & 0xff; xh = ((xh - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca05); }
  m.wr(0xc800, yl); m.wr(0xc801, yh); m.wr(0xc802, xl); m.wr(0xc803, xh);
}

/** 01:52AE — another shown slot (any but FF96, kept in FF97) on the cell C800-C803 (C2E0 bit 3:
 *  the same C2E0 as C804)? FF96 back after. */
function objectAt(m: Memory): boolean {
  m.hram[0x17] = slot(m);
  let found = false;
  for (setSlot(m, 0); slot(m) !== 0x10; setSlot(m, slot(m) + 1)) {
    if (!fget(m, "c200")) continue;
    if (slot(m) === m.hram[0x17]) continue;
    if (fget(m, "c290") !== m.rd(0xc800) || fget(m, "c290", 1) !== m.rd(0xc801)) continue;
    if (fget(m, "c2b0") !== m.rd(0xc802) || fget(m, "c2b0", 1) !== m.rd(0xc803)) continue;
    if (fget(m, "c2e0") & 0x08 && fget(m, "c2e0") !== m.rd(0xc804)) continue;
    found = true;
    break;
  }
  setSlot(m, m.hram[0x17]!);
  return found;
}

/** 01:46C5 — the leader pushes against a pushable object (kind 0B): 8 tries (CA26), then the
 *  object turns to C6EE and its next cell is checked (00:0FFD, 01:52AE; C800-C806 kept through
 *  C810, 00:1F81); true (nz) until then or when that cell is taken. */
function pushObject(g: Game): boolean {
  const m = g.m;
  const n = (m.rd(0xca26) + 1) & 0xff;
  m.wr(0xca26, n);
  if (n !== 0x08) return true;
  m.wr(0xca26, 0);
  fset(m, "c2d0", m.rd(0xc6ee));
  copy(m, 0xc800, 0xc810, 7);
  objectTarget(m);
  let r = blocked(g);
  if (!r) r = objectAt(m);
  copy(m, 0xc810, 0xc800, 7);
  return r;
}

/** 01:465F — an object (slots 2-F, shown, C360 bit 6 clear) on the cell C800-C803 (and with C2E0
 *  bit 3: the same C2E0 as C804): true (nz) unless it is a pushable object (kind 0B) that gives
 *  way (01:46C5). FF96 is left at the object (10 when none). */
function objectAhead(g: Game): boolean {
  const m = g.m;
  for (setSlot(m, 2); slot(m) !== 0x10; setSlot(m, slot(m) + 1)) {
    if (!fget(m, "c200")) continue;
    if (fget(m, "c360") & 0x40) continue;
    if (fget(m, "c290") !== m.rd(0xc800) || fget(m, "c290", 1) !== m.rd(0xc801)) continue;
    if (fget(m, "c2b0") !== m.rd(0xc802) || fget(m, "c2b0", 1) !== m.rd(0xc803)) continue;
    if (fget(m, "c2e0") & 0x08 && fget(m, "c2e0") !== m.rd(0xc804)) continue;
    if (fget(m, "c320") !== 0x0b) return true;
    if (pushObject(g)) return true;
  }
  return false;
}

/** 01:464F — the objects on the cell (01:465F; true = nz, taken); free: the leader (slot 0)
 *  takes the cell byte and look (01:463D, 01:4E48). */
function landingFree(g: Game): boolean {
  const m = g.m;
  if (objectAhead(g)) return true;
  setSlot(m, 0);
  cellByte(m);
  cellLook(m);
  return false;
}

/** 01:4AC7 — the cell two ahead of the leader (slot 0) in C6EE: C804 = its C2E0, C800-C803 its
 *  target C290 / C2B0 20 up (4B01), right (4B3F), down (4B20) or left (4AE2); the high byte that
 *  moves masked by CA04 / CA05. */
function cellTwoAhead(m: Memory): void {
  setSlot(m, 0);
  m.wr(0xc804, fget(m, "c2e0"));
  const d = m.rd(0xc6ee);
  const yl = fget(m, "c290"), yh = fget(m, "c290", 1), xl = fget(m, "c2b0"), xh = fget(m, "c2b0", 1);
  if (d === 0x00) {
    const s = yl - 0x20;
    m.wr(0xc800, s & 0xff);
    m.wr(0xc801, ((yh - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca04));
    m.wr(0xc802, xl); m.wr(0xc803, xh);
  } else if (d === 0x40) {
    m.wr(0xc800, yl); m.wr(0xc801, yh);
    const s = xl + 0x20;
    m.wr(0xc802, s & 0xff);
    m.wr(0xc803, ((xh + (s >> 8)) & 0xff) & m.rd(0xca05));
  } else if (d === 0x80) {
    const s = yl + 0x20;
    m.wr(0xc800, s & 0xff);
    m.wr(0xc801, ((yh + (s >> 8)) & 0xff) & m.rd(0xca04));
    m.wr(0xc802, xl); m.wr(0xc803, xh);
  } else {
    m.wr(0xc800, yl); m.wr(0xc801, yh);
    const s = xl - 0x20;
    m.wr(0xc802, s & 0xff);
    m.wr(0xc803, ((xh - (s < 0 ? 1 : 0)) & 0xff) & m.rd(0xca05));
  }
}

/** The cell kinds a jump never lands on or passes (01:4B75 / 01:4BBE): another layer (C806 bit 6
 *  against CA12), attribute EB, C1, C3, C5, CC, E4, or (C805 & 70) = 30. */
function cellBarred(m: Memory): boolean {
  if ((m.rd(0xc806) & 0x40) !== m.rd(0xca12)) return true;
  const v = m.rd(0xc805);
  if (v === 0xeb || v === 0xc1 || v === 0xc3 || v === 0xc5 || v === 0xcc || v === 0xe4) return true;
  return (v & 0x70) === 0x30;
}

/** 01:4B5E — the cell ahead too high to jump on? false (z) when the cell (00:1060) has both
 *  move bits 0-1 set and is not barred; true (nz) when barred, or C805 bit 3 with
 *  (C804 & CB) = 09, or not both bits. */
function cellWall(g: Game): boolean {
  const m = g.m;
  const a = cellTest(g);
  if (a & 0x08 && (m.rd(0xc804) & 0xcb) === 0x09) return true;
  if (cellBarred(m)) return true;
  return (a & 0x03) !== 0x03;
}

/** 01:4BA7 — can the leader land on the cell C800-C803? (true = nz, not): the cell (00:1060),
 *  bit 3 with (C804 & 0B) = 09, barred kinds, the move mask (C804 & 07 & a), then the objects
 *  (01:464F, which on a free cell gives the leader its byte and look). */
function cellLanding(g: Game): boolean {
  const m = g.m;
  const a = cellTest(g);
  if (a & 0x08 && (m.rd(0xc804) & 0x0b) === 0x09) return true;
  if (cellBarred(m)) return true;
  if (m.rd(0xc804) & 0x07 & a) return true;
  return landingFree(g);
}

/** 01:4A7F — the kind of jump: 0 none (CA51 set, C2F0 & F0 = 30, or (C2E0 & 8B) = 09); the cell
 *  ahead (01:471E) a wall (01:4B5E): 1 (a hop in place); else by the cells ahead and two ahead
 *  (01:4AC7) that can be landed on (01:4BA7): two ahead free 3, else ahead free 2, else 1. */
function jumpKind(g: Game): number {
  const m = g.m;
  if (m.rd(0xca51)) return 0;
  if ((fget(m, "c2f0") & 0xf0) === 0x30) return 0;
  if ((fget(m, "c2e0") & 0x8b) === 0x09) return 0;
  leaderTarget(m);
  if (!cellWall(g)) return 1;
  if (!cellLanding(g)) {
    cellTwoAhead(m);
    return cellLanding(g) ? 2 : 3;
  }
  cellTwoAhead(m);
  return cellLanding(g) ? 1 : 3;
}

// ---------------------------------------------------------------- the jump frames (bank 01)

/** 01:49DE — the arc step: the slot's (the leader's) C210 + the word 01:4A2F[(CA13 >> 2)]
 *  (-2, -1, +1, +2), the companion (01:4F24) and its C210 + 01:4A3F[CA13 & 3F] (its shadow
 *  under the arc), FF96 = 0, CA13 bits 0-6 - 1 (bit 7 kept). */
function jumpArc(m: Memory): void {
  addWord(m, fa(m, "c210"), m.rd16(0x4a2f + ((m.rd(0xca13) >> 1) & 0x3e)));
  companionFollow(m);
  addWord(m, fa(m, "c210"), m.rd16(0x4a3f + ((m.rd(0xca13) & 0x3f) << 1)));
  setSlot(m, 0);
  const v = m.rd(0xca13);
  m.wr(0xca13, (((v & 0x7f) - 1) & 0xff) | (v & 0x80));
}

/** 01:49BD — a jump frame: the leader's C250 kept and cleared, the arc (01:49DE), the objects
 *  drawn (00:01A0), a frame, the map animation (01:54A0), the leader's C250 back. */
function* jumpFrame(g: Game): Co {
  const m = g.m;
  setSlot(m, 0);
  const e = fget(m, "c250");
  fset(m, "c250", 0);
  jumpArc(m);
  // CPU time as in the field loop (00:0272 / 00:0275 / 00:027B): the objects drawn from 01:49CA, the
  // OAM buffer complete at 01:49CD; the map animation's copies done at 01:49D5
  yield* g.point(0x0149ca);
  const drawn = g.pointTime(0x0149cd);
  g.vramUntil(drawn, () => drawObjects(g), true, true);
  yield* g.untilTime(drawn);
  yield* g.wait(1);
  const end = g.pointTime(0x0149d5);
  const t = g.vramUntil(end, () => mapAnimation(g));
  yield* g.untilTime(t);
  setSlot(m, 0);
  fset(m, "c250", e);
}

/** 01:4965 — b jump frames in place (FF96 = 0, 01:49BD). */
function* hopFrames(g: Game, b: number): Co {
  do {
    setSlot(g.m, 0);
    yield* jumpFrame(g);
    b = (b - 1) & 0xff;
  } while (b);
}

/** 01:495E — a hop in place: CA13 = 9F, 20 jump frames (01:4965). */
function* hopInPlace(g: Game): Co {
  g.m.wr(0xca13, 0x9f);
  yield* hopFrames(g, 0x20);
}

/** The jump over b cells (01:4811 up / 486B down / 48C5 right / 4991 left): for each, C6EF = 10,
 *  the leader's target (C290 / C2B0) one cell on (the high byte masked by CA04 / CA05), then 10
 *  frames of the step (01:44E9 / 445F / 4562 / 45DB) each with a jump frame (01:49BD). */
function* jumpCells(g: Game, b: number, f: Pair, d: number, mask: number, step: (m: Memory) => void): Co {
  const m = g.m;
  do {
    m.wr(0xc6ef, 0x10);
    setSlot(m, 0);
    addCell(m, f, d, mask);
    for (let k = 0x10; k; k--) {
      step(m);
      yield* jumpFrame(g);
    }
    b = (b - 1) & 0xff;
  } while (b);
}

/** 01:4811 — the jump over b cells up (C290 - 10, 01:44E9). */
function* cellsUp(g: Game, b: number): Co { yield* jumpCells(g, b, "c290", -0x10, 0xca04, leaderUp); }
/** 01:486B — the jump over b cells down (C290 + 10, 01:445F). */
function* cellsDown(g: Game, b: number): Co { yield* jumpCells(g, b, "c290", 0x10, 0xca04, leaderDown); }
/** 01:48C5 — the jump over b cells right (C2B0 + 10, 01:4562). */
function* cellsRight(g: Game, b: number): Co { yield* jumpCells(g, b, "c2b0", 0x10, 0xca05, leaderRight); }
/** 01:4991 — the jump over b cells left (C2B0 - 10, 01:45DB). */
function* cellsLeft(g: Game, b: number): Co { yield* jumpCells(g, b, "c2b0", -0x10, 0xca05, leaderLeft); }

type Cells = (g: Game, b: number) => Co;

/** 01:47F1 / 01:484B / 01:48A5 / 01:4971 — the jump one cell on: CA56 = 1, CA13 = 1F, one cell
 *  (01:4811 / 486B / 48C5 / 4991), then 10 jump frames in place (01:4965). */
function* jumpOne(g: Game, cells: Cells): Co {
  const m = g.m;
  m.wr(0xca56, 0x01);
  m.wr(0xca13, 0x1f);
  yield* cells(g, 1);
  yield* hopFrames(g, 0x10);
}

/** 01:4805 / 01:485F / 01:48B9 / 01:4985 — the jump two cells on: CA56 = 1, CA13 = 9F, two
 *  cells (01:4811 / 486B / 48C5 / 4991). */
function* jumpTwo(g: Game, cells: Cells): Co {
  const m = g.m;
  m.wr(0xca56, 0x01);
  m.wr(0xca13, 0x9f);
  yield* cells(g, 2);
}

/** 01:48FF — no jump: sound 10 (FFBC), the screen shaken 0F frames (FF92 / CA03 + the words
 *  01:4936[0F..01], no mask), the text 01:4956 (00:3211 mode 0C at (1, 1), 12 x 6), the window
 *  closed (00:35D2). */
function* jumpRefused(g: Game): Co {
  const m = g.m;
  g.sfx(0x10);
  let c = 0x0f;
  do {
    const de = m.rd16(0x4936 + 2 * c);
    const s = m.hram[0x12]! + (de & 0xff);
    m.hram[0x12] = s & 0xff;
    m.wr(0xca03, (m.rd(0xca03) + (de >> 8) + (s >> 8)) & 0xff);
    yield* g.wait(1);
    c = (c - 1) & 0xff;
  } while (c);
  yield* printText(g, 0x0c, 0x4956, 0x0101, 0x0612);
  yield* windowClose(g);
}

/** The facing branches (01:47E3 up, 01:483D down, 01:4897 right, 01:48F1 left): the jump kind
 *  (01:4A7F) through 00:373A: 0 01:48FF, 1 01:495E, 2 one cell, 3 two cells. */
function* jumpFacing(g: Game, cells: Cells): Co {
  switch (jumpKind(g)) {
    case 0: yield* jumpRefused(g); break;
    case 1: yield* hopInPlace(g); break;
    case 2: yield* jumpOne(g, cells); break;
    default: yield* jumpTwo(g, cells); break;
  }
}

/** 01:47E3 — B facing up (01:4811 cells). */
function* jumpUp(g: Game): Co { yield* jumpFacing(g, cellsUp); }
/** 01:4897 — B facing right (01:48C5 cells). */
function* jumpRight(g: Game): Co { yield* jumpFacing(g, cellsRight); }
/** 01:483D — B facing down (01:486B cells). */
function* jumpDown(g: Game): Co { yield* jumpFacing(g, cellsDown); }
/** 01:48F1 — B facing left (01:4991 cells). */
function* jumpLeft(g: Game): Co { yield* jumpFacing(g, cellsLeft); }

/** 01:47B2 — B on foot: not pressed (FF8B bit 1) -> false (z, the field step goes on); else
 *  sound 39 (FFBC), CA26 = 0, the step speed C6F4 = 1, the jump in the facing C6EE (00 up 01:47E3,
 *  40 right 01:4897, 80 down 01:483D, C0 left 01:48F1 through 00:373A), every branch returning
 *  into 01:47DE: true (a = FF, nz: the field step ends there). */
export function* jumpB(g: Game): Co<boolean> {
  const m = g.m;
  if (!(m.hram[0x0b]! & 0x02)) return false;
  g.sfx(0x39);
  m.wr(0xca26, 0);
  m.wr(0xc6f4, 0x01);
  let a = m.rd(0xc6ee);
  a = ((a << 4) | (a >> 4)) & 0xff;
  a = (a >> 1) | (a & 0x80);
  a = (a >> 1) | (a & 0x80);
  switch (a & 0x03) {
    case 0: yield* jumpUp(g); break;
    case 1: yield* jumpRight(g); break;
    case 2: yield* jumpDown(g); break;
    default: yield* jumpLeft(g); break;
  }
  return true;
}
