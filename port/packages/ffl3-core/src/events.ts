/** Legend III scene events (docs/ffl3/FINDINGS.md M3/M5): script references (00:2EF6/2EF8),
 *  the scene commands of the text engine (0B:6C35), and the event dispatcher 00:1236 (type =
 *  CA29 & 3F, parameter CA28) with its event bodies; the field motion they use (bank 01) is in
 *  events2.ts. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, far0, farcall, farSync, far0Sync, copy, copyB, fill, vramCopy, memberOffset, fadeIn, fadeOut,
  wait1 } from "./sys.js";
import { NotPorted } from "./irq.js";
import { loadMap, leaderLook, layout, mapPatches, patchAt, drawView } from "./mapload.js";
import { windowClose } from "./window.js";
import { printText } from "./text.js";
import { battleEvent } from "./battle.js";
import { tableWord, objectStep, objectSprite, drawObjects } from "./actors.js";
import { fget, fset, setSlot, testFlag, setFlag, clearFlag } from "./objects.js";
import { memberLimit } from "./sprites.js";
import { levelValues } from "./names.js";
import { entityOffset } from "./bstats.js";
import { normalHandlers, restoreHandlers, objectEvent, walkEvent, shiftEvent, objectsUpdate, spawnSequence,
  flashFrames, stepDown, stepUp, exitBack, fallStep, stackFromTable, followerAtLeader, followerPlace, mapText,
  tileMorph, freeSlotsOf, boardVehicle, highestItemFlag, leaveVehicleEvent, disembark } from "./events2.js";

/** 0B:6C4C — text codes handled as scene events: code -> event type. */
const SCENE_TYPE: Record<number, number> = { 0x32: 0x26, 0x3d: 0x28, 0x3b: 0x27, 0x13: 0x1d, 0x12: 0x1c, 0x3f: 0x1b,
  0x0a: 0x10, 0x0d: 0x0e, 0x38: 0x12 };

/** 0B:6C35 — a scene command of the text: the reference (op, type) through 00:2EF6. */
export function* sceneCode(g: Game, code: number, op: number): Co {
  const t = SCENE_TYPE[code];
  if (t === undefined) throw new Error(`no scene type for code ${code.toString(16)}`);
  yield* reference(g, 0x40, op, t);
}

/** 00:2EF8 — the 2-byte script reference at hl (lo, hi); returns hl after it. */
export function* scriptRef(g: Game, e: number, hl: number): Co<number> {
  const m = g.m;
  const lo = m.rd(hl), hi = m.rd(hl + 1);
  yield* reference(g, e, lo, hi);
  return (hl + 2) & 0xffff;
}

/** 00:2EF8 with the operands in hand: CA28 = lo; hi < 40 is a scene event (CA29 = hi, 0F:7DD4,
 *  00:1236); else a text in bank 09 (hi 40-7F), 0A (80-BF: | 40) or 03 (C0-FF: & 7F) drawn with
 *  mode e in the box (1,1) 18 x 6. */
export function* reference(g: Game, e: number, lo: number, hi: number): Co {
  const m = g.m;
  m.wr(0xca28, lo);
  if (hi < 0x40) {
    m.wr(0xca29, hi);
    yield* farcall(g, 0x0f, () => beforeEvent(g, hi));
    yield* g.point(0x2f0b); // at the original's time: a STAT frame work before it still sees CD3D
    yield* dispatch(g);
    return;
  }
  let h = hi, bank = 0x09;
  if (h & 0x80) {
    h &= 0x7f;
    if (!(h & 0x40)) { h |= 0x40; bank = 0x0a; } else bank = 0x03;
  }
  const addr = (h << 8) | lo;
  yield* far0(g, bank, () => printText(g, e, addr, 0x0101, 0x0612));
}

/** 0F:7DD4 — before an event: types below 10 and 11, 17, 1B, 1E, 1F, 27, 28 close the text
 *  window first (00:35D2). */
function* beforeEvent(g: Game, t: number): Co {
  if (t < 0x10 || [0x11, 0x17, 0x1b, 0x1e, 0x1f, 0x27, 0x28].includes(t)) yield* windowClose(g);
}

/** 00:1236 — the event CA29 & 3F (CD3D cleared meanwhile; the word table 00:124A), then 00:12CA:
 *  C2F0 C0-type cleared, CD3D back. 00:12CA is a sync point (as 00:2F0B before it in 00:2EF8): the
 *  events take CPU time, and a STAT frame work runs only while CD3D is set. */
export function* dispatch(g: Game): Co {
  const m = g.m;
  const cd3d = m.rd(0xcd3d);
  m.wr(0xcd3d, 0);
  const t = m.rd(0xca29) & 0x3f;
  switch (t) {
    case 0x00: case 0x01: yield* exitByCell(g); break;
    case 0x02: case 0x03: yield* exitPush(g); break;
    case 0x04: case 0x05: yield* exitPop(g); break;
    case 0x08: case 0x09: yield* exitFall(g); break;
    case 0x0a: m.wr(0xc6e3, 0); yield* exitPush(g); break;
    case 0x0b: case 0x0c: m.wr(0xc6e3, 0x02); yield* exitPop(g); break;
    case 0x0d: m.wr(0xca59, 1); yield* door(g); break;
    case 0x0e: yield* door(g); break;
    case 0x0f: case 0x2f: case 0x3f: yield* mapTextEvent(g); break;
    case 0x10: yield* party(g); break;
    case 0x11: yield* screenEvent(g); break;
    case 0x12: yield* special(g); break;
    case 0x13: itemTaken(g); break;
    case 0x16: yield* textEvent(g); break;
    case 0x17: shopEvent(g); break;
    case 0x18: yield* itemEvent(g); break;
    case 0x1b: yield* battleEvent(g); break;
    case 0x1c: m.hram[0x3a] = m.rd(0xca28); break; // 00:1A28 — the music FFBA
    case 0x1d: m.hram[0x3c] = m.rd(0xca28); break; // 00:1A2E — a sound FFBC
    case 0x1e: yield* sceneEffect(g); break;
    case 0x1f: farSync(g, 0x0b, () => mapPatches(g)); break; // 00:137C
    case 0x20: yield* hurtAll(g); break;
    case 0x21: reviveAll(g); break;
    case 0x22: yield* rest(g); break;
    case 0x23: menuEvent(g); break;
    case 0x24: m.wr(0xca51, 1); yield* rest(g); break; // 00:1A7F
    case 0x25: yield* rockEvent(g); break;
    case 0x26: farSync(g, 0x01, () => objectEvent(m)); break; // 00:1B0A
    case 0x27: yield* walk(g, walkEvent); break;
    case 0x28: yield* walk(g, shiftEvent); break;
    case 0x29: yield* farcall(g, 0x01, () => tileMorph(g)); break; // 00:1BCF
    case 0x2a: yield* far0(g, 0x0a, () => printText(g, 0x00, 0x7a7d, 0x0101, 0x0612)); break; // 00:1BD7
    case 0x2b: yield* switchEvent(g); break;
    case 0x2c: yield* quakeEvent(g); break;
    default: break; // 00:12DB — 06, 07, 14, 15, 19, 1A, 2D-3E: nothing
  }
  yield* g.point(0x12ca); // at the original's time: a STAT frame work before it still sees CD3D 0
  if ((m.rd(0xc2f0) & 0xc0) === 0xc0) m.wr(0xc2f0, 0);
  m.wr(0xcd3d, cd3d);
}

// ---------------------------------------------------------------- map exits

/** 00:13F1 — event 00/01, the exit of the map C6E8 at the cell under the leader: C800-C803 = the
 *  view position + 50 (CA04 / CA05), the exits 06:6308[C6E8] (4 bytes: y << 4 | x cells, then
 *  the 3 bytes of a door) searched for the cell (bits 6-7 of the low bytes, the high bytes),
 *  then the door 00:1468. */
function* exitByCell(g: Game): Co {
  const m = g.m;
  let s = m.rd(0xc6e4) + 0x50;
  m.wr(0xc800, s & 0xff);
  m.wr(0xc801, ((m.rd(0xc6e5) + (s >> 8)) & 0xff) & m.rd(0xca04));
  s = m.rd(0xc6e6) + 0x50;
  m.wr(0xc802, s & 0xff);
  m.wr(0xc803, ((m.rd(0xc6e7) + (s >> 8)) & 0xff) & m.rd(0xca05));
  pushBank(g, 0x06);
  let hl = tableWord(m, 0x6308, m.rd(0xc6e8));
  for (let n = 0; ; n++) {
    if (n > 0x4000) throw new Error("00:1425: no exit for the cell (the original loops on)");
    const v = m.rd(hl);
    const y = (v & 0xf0) << 2, x = (v & 0x0f) << 6;
    if ((m.rd(0xc800) & 0xc0) === (y & 0xff) && m.rd(0xc801) === y >> 8
      && (m.rd(0xc802) & 0xc0) === (x & 0xff) && m.rd(0xc803) === x >> 8) break;
    hl = (hl + 4) & 0xffff;
  }
  hl = (hl + 1) & 0xffff;
  yield* exitTo(g, hl);
}

/** 00:1468 — the door at hl (bank 06 pushed by the caller): 00:1B64, C6E8 = the map, C6EE = the
 *  facing (bits 7 of the next two bytes), C6E4-C6E7 = the cell (y, x: low nibble x 16, bits 4-6
 *  the high byte); bank popped, the map load (00:027D). */
function* exitTo(g: Game, hl: number): Co {
  const m = g.m;
  returnPoint(g);
  m.wr(0xc6e8, m.rd(hl++));
  let b = 0;
  let v = m.rd(hl++);
  b = ((b >> 1) | (v & 0x80)) & 0xff;
  v = m.rd(hl--);
  b = ((b >> 1) | (v & 0x80)) & 0xff;
  m.wr(0xc6ee, b);
  v = m.rd(hl);
  m.wr(0xc6e4, (v << 4) & 0xf0);
  m.wr(0xc6e5, (v >> 4) & 0x07);
  hl++;
  v = m.rd(hl);
  m.wr(0xc6e6, (v << 4) & 0xf0);
  m.wr(0xc6e7, (v >> 4) & 0x07);
  popBank(g);
  yield* loadMap(g);
}

/** 00:13AC — event 02/03, an exit that can be come back to: the return stack level C7C8 gets the
 *  cell (C7A0 + C7C8: y, x), the masks (C7B0 + C7C8: CA04, CA05) and the map (C7C0 + C7C8 / 2);
 *  C7C8 + 2; then the exit 00:13F1. */
function* exitPush(g: Game): Co {
  const m = g.m;
  const sw = (v: number) => ((v << 4) | (v >> 4)) & 0xff;
  let hl = (0xc7a0 + m.rd(0xc7c8)) & 0xffff;
  m.wr(hl++, sw(m.rd(0xc6e4)) | sw(m.rd(0xc6e5)));
  m.wr(hl, sw(m.rd(0xc6e6)) | sw(m.rd(0xc6e7)));
  hl = (0xc7b0 + m.rd(0xc7c8)) & 0xffff;
  m.wr(hl++, m.rd(0xca04));
  m.wr(hl, m.rd(0xca05));
  hl = (0xc7c0 + (m.rd(0xc7c8) >> 1)) & 0xffff;
  m.wr(hl, m.rd(0xc6e8));
  m.wr(0xc7c8, m.rd(0xc7c8) + 2);
  yield* exitByCell(g);
}

/** 00:14AA — event 04/05, back by the return stack (01:6578, bank 01). */
function* exitPop(g: Game): Co {
  yield* farcall(g, 0x01, () => exitBack(g));
}

/** 00:14B2 — event 08/09, a hole: sound 3F, the fall (01:661C, bank 01), then the exit 00:13F1. */
function* exitFall(g: Game): Co {
  g.m.hram[0x3c] = 0x3f;
  yield* farcall(g, 0x01, () => fallStep(g));
  yield* exitByCell(g);
}

/** 00:13A0 — event 0F / 2F / 3F, the map's text (01:64B4, bank 01; the text in bank 0A, mode 0,
 *  box (1,1) 18 x 6). */
function* mapTextEvent(g: Game): Co {
  pushBank(g, 0x01);
  const hl = mapText(g.m);
  if (hl !== null) yield* far0(g, 0x0a, () => printText(g, 0x00, hl, 0x0101, 0x0612));
  popBank(g);
}

/** 00:1389 — door CA28 (06:6BA4 + 3 (n - 1): map, y, x with the high bits and the facing,
 *  00:1468) after 00:1B64 (the return point C7C9-C7CB for maps below 0A), then the map load. */
function* door(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x06);
  let hl = (0x6ba4 + 3 * ((m.rd(0xca28) - 1) & 0xff)) & 0xffff;
  returnPoint(g);
  m.wr(0xc6e8, m.rd(hl++));
  let b = 0;
  let v = m.rd(hl++);
  b = ((b >> 1) | (v & 0x80)) & 0xff;
  v = m.rd(hl--);
  b = ((b >> 1) | (v & 0x80)) & 0xff;
  m.wr(0xc6ee, b);
  v = m.rd(hl);
  m.wr(0xc6e4, (v << 4) & 0xf0);
  m.wr(0xc6e5, (v >> 4) & 0x07);
  hl++;
  v = m.rd(hl);
  m.wr(0xc6e6, (v << 4) & 0xf0);
  m.wr(0xc6e7, (v >> 4) & 0x07);
  popBank(g);
  yield* loadMap(g);
}

/** 00:1B64 — leaving a map below 0A: C7CB = map, C6F7 = facing + 80, C7C9 / C7CA = the cell
 *  (y, x), one step back against the facing. */
function returnPoint(g: Game): void {
  const m = g.m;
  const map = m.rd(0xc6e8);
  if (map >= 0x0a) return;
  m.wr(0xc7cb, map);
  m.wr(0xc6f7, m.rd(0xc6ee) + 0x80);
  const sw = (v: number) => ((v << 4) | (v >> 4)) & 0xff;
  m.wr(0xc7c9, sw(m.rd(0xc6e4)) | sw(m.rd(0xc6e5)));
  m.wr(0xc7ca, sw(m.rd(0xc6e6)) | sw(m.rd(0xc6e7)));
  const f = m.rd(0xc6f7);
  if (f === 0x00) m.wr(0xc7c9, (m.rd(0xc7c9) - 1) & 0x3f);
  else if (f === 0x40) m.wr(0xc7ca, (m.rd(0xc7ca) + 1) & 0x3f);
  else if (f === 0x80) m.wr(0xc7c9, (m.rd(0xc7c9) + 1) & 0x3f);
  else m.wr(0xc7ca, (m.rd(0xc7ca) - 1) & 0x3f);
}

/** 00:16B9 — event type 12, special CA28: 00 CA00 = 1 (the leader starts hidden), 01 walking
 *  again (C6E3 = 0, 00:08AD), 02 nothing, 03 four flashes (00:1AEA), 04 the layout reloaded
 *  (00:174D), 05 / 06 / 0A slots 4 with 5 or 6 walked pixel by pixel (00:17E2 / 182B / 1769), 07
 *  64 frames of the objects' behaviour (00:18FB), 08 / 09 the leader's step frames for 160
 *  frames (00:190D with a rise and fall, 00:1950), 0B door 37 / 0C exit 02 with CA6B = 1
 *  (00:1711 / 1728), 0D boarding (01:4049), 0E off the vehicle (00:0861), 0F a spawn sequence
 *  (01:614A), 10 the leader's look set (00:16EB), 11 C6FB (01:610D). */
function* special(g: Game): Co {
  const m = g.m;
  const k = m.rd(0xca28);
  if (k === 0x00) { m.wr(0xca00, 1); return; }
  if (k === 0x01) { m.wr(0xc6e3, 0); yield* leaderLook(g); return; }
  if (k === 0x02) return;
  switch (k) {
    case 0x03: yield* flash4(g); return;
    case 0x04: yield* relayout(g); return;
    case 0x05: yield* puppetsRight(g); return;
    case 0x06: yield* puppetsShort(g); return;
    case 0x07: yield* objectsFrames(g); return;
    case 0x08: yield* leaderBob(g); return;
    case 0x09: yield* leaderSteps(g); return;
    case 0x0a: yield* puppetsLong(g); return;
    case 0x0b: yield* scriptedExit(g, 0x37, 0x0e); return; // 00:1711
    case 0x0c: yield* scriptedExit(g, 0x02, 0x0d); return; // 00:1728
    case 0x0d: yield* farcall(g, 0x01, () => boardVehicle(g)); return; // 00:1709
    case 0x0e: yield* farcall(g, 0x01, () => leaveVehicleEvent(g)); return; // 00:16F9
    case 0x0f: yield* farcall(g, 0x01, () => spawnSequence(g, 0x624b)); return; // 00:1701
    case 0x10: leaderLookSet(m); return;
    case 0x11: farSync(g, 0x01, () => highestItemFlag(m)); return; // 00:16E3
  }
  throw new NotPorted(`event 12 special ${k.toString(16).padStart(2, "0")} (00:16BC: past the table)`);
}

/** 00:1711 / 00:1728 — CA6B = 1 (the load's other fades), CA28 = n, CA29 = t, the dispatcher
 *  (00:1236), CA6B = 0. */
function* scriptedExit(g: Game, n: number, t: number): Co {
  const m = g.m;
  m.wr(0xca6b, 1);
  m.wr(0xca28, n);
  m.wr(0xca29, t);
  yield* dispatch(g);
  m.wr(0xca6b, 0);
}

/** 00:16EB — the leader is member 0 with the look 02 E0: C6F3 = 1B, C50D = 02, C50E = E0. */
function leaderLookSet(m: Memory): void {
  m.wr(0xc6f3, 0x1b);
  m.wr(0xc50d, 0x02);
  m.wr(0xc50e, 0xe0);
}

/** 00:1AEA — sound 3E, four flashes (00:1AF7: BGP 0 for 4 frames, back for 4). */
function* flash4(g: Game): Co {
  const m = g.m;
  m.hram[0x3c] = 0x3e;
  for (let b = 4; b; b--) {
    const bgp = m.rd(0xff47);
    m.wr(0xff47, 0);
    yield* g.wait(4);
    m.wr(0xff47, bgp);
    yield* g.wait(4);
  }
}

/** 00:174D — the layout reloaded (00:1756) with the normal handlers (00:1B2D / 00:1B50). */
function* relayout(g: Game): Co {
  yield* normalHandlers(g);
  layout(g);
  yield* restoreHandlers(g);
}

/** 00:18F5 — the objects drawn (00:01A0), a frame. */
function* drawFrame(g: Game): Co {
  drawObjects(g);
  yield* wait1(g);
}

/** A 16-bit field of the slot +- 1, the high byte masked by [mask] (00:18CB / 00:18DE). */
function nudge(m: Memory, f: "c210" | "c230" | "c290" | "c2b0", d: number, mask: number): void {
  const s = fget(m, f) + d;
  fset(m, f, s & 0xff);
  fset(m, f, ((fget(m, f, 1) + (s > 0xff ? 1 : s < 0 ? -1 : 0)) & 0xff) & m.rd(mask), 1);
}

/** 00:1874 / 00:1888 / 00:189B / 00:18AF — the slot faces d (C2D0, the sprite 01:5272) and moves a
 *  pixel: 40 right (C2B0 / C230 + 1, & CA05), 00 up (C290 / C210 - 1), 80 down (+ 1), C0 left
 *  (C2B0 / C230 - 1; these three & CA04). */
function puppetMove(g: Game, d: number): void {
  const m = g.m;
  fset(m, "c2d0", d);
  farSync(g, 0x01, () => objectSprite(m, d));
  if (d === 0x40) { nudge(m, "c2b0", 1, 0xca05); nudge(m, "c230", 1, 0xca05); }
  else if (d === 0x00) { nudge(m, "c290", -1, 0xca04); nudge(m, "c210", -1, 0xca04); }
  else if (d === 0x80) { nudge(m, "c290", 1, 0xca04); nudge(m, "c210", 1, 0xca04); }
  else { nudge(m, "c2b0", -1, 0xca04); nudge(m, "c230", -1, 0xca04); }
}

/** The legs of 00:1769 / 00:17E2 / 00:182B: [frames, slot 4's move, the other slot's move]; each
 *  frame both slots move (00:1874 ...) and 00:18F5. */
function* puppetLegs(g: Game, other: number, legs: [number, number, number][]): Co {
  const m = g.m;
  for (const [n, d4, dx] of legs) {
    for (let b = n; b; b--) {
      setSlot(m, 4);
      puppetMove(g, d4);
      setSlot(m, other);
      puppetMove(g, dx);
      yield* drawFrame(g);
    }
  }
}

/** 00:1769 — slots 4 and 5: 20 frames down, 10 (4 left, 5 down), 60 left, 10 (4 up, 5 left),
 *  40 up. */
function* puppetsLong(g: Game): Co {
  yield* puppetLegs(g, 5, [[0x20, 0x80, 0x80], [0x10, 0xc0, 0x80], [0x60, 0xc0, 0xc0], [0x10, 0x00, 0xc0],
    [0x40, 0x00, 0x00]]);
}

/** 00:17E2 — slots 4 and 6: 40 frames right, 10 (4 up, 6 right), 40 up. */
function* puppetsRight(g: Game): Co {
  yield* puppetLegs(g, 6, [[0x40, 0x40, 0x40], [0x10, 0x00, 0x40], [0x40, 0x00, 0x00]]);
}

/** 00:182B — slots 4 and 5: 30 frames down, 10 (4 left, 5 down), 30 left. */
function* puppetsShort(g: Game): Co {
  yield* puppetLegs(g, 5, [[0x30, 0x80, 0x80], [0x10, 0xc0, 0x80], [0x30, 0xc0, 0xc0]]);
}

/** 00:18FB — 40 frames of the objects' behaviour (01:4F66, bank 01) and 00:18F5. */
function* objectsFrames(g: Game): Co {
  for (let b = 0x40; b; b--) {
    farSync(g, 0x01, () => objectsUpdate(g));
    yield* drawFrame(g);
  }
}

/** 00:1934 — the leader's C210 - 2 while CA6A < 50, else + 2 (16-bit, unmasked). */
function bob(m: Memory): void {
  const s = fget(m, "c210") + (m.rd(0xca6a) < 0x50 ? -2 : 2);
  fset(m, "c210", s & 0xff);
  fset(m, "c210", (fget(m, "c210", 1) + (s > 0xff ? 1 : s < 0 ? -1 : 0)) & 0xff, 1);
}

/** 00:190D — sound 3F, CA6A = 0, A0 frames of the leader's step frame (01:53FF) rising 2 px a
 *  frame for 50 frames then falling (00:1934), CA6A + 1, 00:18F5. */
function* leaderBob(g: Game): Co {
  const m = g.m;
  m.hram[0x3c] = 0x3f;
  m.wr(0xca6a, 0);
  for (let b = 0xa0; b; b--) {
    setSlot(m, 0);
    farSync(g, 0x01, () => objectStep(m));
    bob(m);
    m.wr(0xca6a, m.rd(0xca6a) + 1);
    yield* drawFrame(g);
  }
}

/** 00:1950 — sound 1F, A0 frames of the leader's step frame (01:53FF) and 00:18F5. */
function* leaderSteps(g: Game): Co {
  const m = g.m;
  m.hram[0x3c] = 0x1f;
  for (let b = 0xa0; b; b--) {
    setSlot(m, 0);
    farSync(g, 0x01, () => objectStep(m));
    yield* drawFrame(g);
  }
}

// ---------------------------------------------------------------- event 10: the party

/** 00:246B — hl x a (8-bit a, shift and add). */
const mulA = (hl: number, a: number): number => (hl * (a & 0xff)) & 0xffff;

/** 0B:6E33 — member slot a removed: C503 + 0x60 a = FF. */
function memberRemoved(m: Memory, a: number): void {
  m.wr((mulA(0x60, a) + 0xc503) & 0xffff, 0xff);
}

/** 0B:6DE4 — member slot a from table entry b: CE00 + 4 a cleared (00:2437, 00:1F55); a = 3 with
 *  b = 6 (0B:6E15): the record of slot 4 copied to slot 3 (C680 -> C620), C623 = 07:7BA4, the
 *  level values (0F:79D4); else the starting record 07:7A81 + 0x60 x 0B:7573[b] -> C500 + 0x60 a. */
function memberSlot(g: Game, a: number, b: number): void {
  const m = g.m;
  fill(m, (0xce00 + 4 * a) & 0xffff, 4, 0);
  if (a === 0x03 && b === 0x06) {
    far0Sync(g, 0, () => copyB(m, 0xc680, 0xc620, 0x60));
    far0Sync(g, 0x07, () => copyB(m, 0x7ba4, 0xc623, 0x01));
    farSync(g, 0x0f, () => levelValues(g));
    return;
  }
  const de = (mulA(0x60, a) + 0xc500) & 0xffff;
  const n = m.rd((0x7573 + b) & 0xffff);
  const hl = (mulA(0x60, n) + 0x7a81) & 0xffff;
  far0Sync(g, 0x07, () => copyB(m, hl, de, 0x60));
}

/** 00:1552 — the follower in slot FF96: C200 = C370 = FF, frame 0, tile base 10, kind 1A, C360
 *  44, facing C6EE (the sprite 01:5272). */
function followerInit(g: Game): void {
  const m = g.m;
  fset(m, "c200", 0xff);
  fset(m, "c370", 0xff);
  fset(m, "c250", 0x00);
  fset(m, "c280", 0x10);
  fset(m, "c330", 0x10);
  fset(m, "c320", 0x1a);
  fset(m, "c340", 0x1a);
  fset(m, "c360", 0x44);
  const b = m.rd(0xc6ee);
  fset(m, "c2d0", b);
  farSync(g, 0x01, () => objectSprite(m, b));
}

/** 00:1534 — event 10 5, the follower joins: (CA14 set) the old follower freed (00:1586 b = FF),
 *  a slot at the leader (01:6A23), C6E4-C6E8 kept at C6E9 (00:1F87), 00:1552. */
function followerJoins(g: Game): void {
  const m = g.m;
  m.wr(0xca14, 1);
  freeSlotsOf(m, 0xff);
  m.wr(0xca14, 0);
  farSync(g, 0x01, () => followerAtLeader(m));
  copy(m, 0xc6e4, 0xc6e9, 5);
  followerInit(g);
}

/** 00:15B3 — event 10 6: story flags 0C / 0D = bits 7 / 6 of the facing C6EE. */
function facingFlags(m: Memory): void {
  clearFlag(m, 0x0c);
  clearFlag(m, 0x0d);
  if (m.rd(0xc6ee) & 0x80) setFlag(m, 0x0c);
  if (m.rd(0xc6ee) & 0x40) setFlag(m, 0x0d);
}

/** 00:15A7 — back to the place kept at C6E9 (C6E4-C6E8, 00:1F87), the map load. */
function* placeBack(g: Game): Co {
  copy(g.m, 0xc6e9, 0xc6e4, 5);
  yield* loadMap(g);
}

/** 00:14C0 — event 10, the party by CA28 >> 4 (n = CA28 & 0F): 0 member 4 removed (0B:6E33), 1 /
 *  2 member 4 / 3 from the table 00:151D / 00:1523 [n - 1] (0B:6DE4), 3 / 9 nothing, 4 the
 *  follower's place (01:6A74), 5 the follower joins (00:1534), 6 flags 0C / 0D (00:15B3), 7 the
 *  map's objects again (00:1524), 8 a member's status scene (00:15F7), A a return stack
 *  (01:664B), B unless flag 04 / E back to C6E9 (00:15A7), C off the vehicle (CA59 = 1,
 *  01:4250), D the place kept (C6E4 -> C6E9), F 06:7F69. */
function* party(g: Game): Co {
  const m = g.m;
  const n = m.rd(0xca28);
  const k = ((n & 0x0f) - 1) & 0xff;
  switch (n >> 4) {
    case 0x0: farSync(g, 0x0b, () => memberRemoved(m, 0x04)); return; // 00:1518
    case 0x1: { const b = m.rd(0x151d + k); farSync(g, 0x0b, () => memberSlot(g, 0x04, b)); return; } // 00:14F8
    case 0x2: { const b = m.rd(0x1523 + k); farSync(g, 0x0b, () => memberSlot(g, 0x03, b)); return; } // 00:1508
    case 0x3: case 0x9: return; // 00:14EA
    case 0x4: farSync(g, 0x01, () => followerPlace(m)); return; // 00:15DE
    case 0x5: followerJoins(g); return;
    case 0x6: facingFlags(m); return;
    case 0x7: throw new NotPorted("00:1524 (the map's objects again: 00:05BF, mapload.ts loadObjects not exported)");
    case 0x8: throw new NotPorted("00:15F7 (a member's status scene: 01:7DFD, 0C:4000 script 5FC8, 0F:7A2C)");
    case 0xa: farSync(g, 0x01, () => stackFromTable(m)); return; // 00:152C
    case 0xb: if (testFlag(m, 0x04)) return; yield* placeBack(g); return; // 00:15A1
    case 0xc: m.wr(0xca59, 1); yield* farcall(g, 0x01, () => disembark(g)); return; // 00:14EB
    case 0xd: copy(m, 0xc6e4, 0xc6e9, 5); return; // 00:15E6
    case 0xe: yield* placeBack(g); return;
    default: throw new NotPorted("06:7F69 (event 10 F)");
  }
}

// ---------------------------------------------------------------- screen, items, texts

/** 00:1969 — event 11 by CA28: 0 / 5 nothing, 1 / 4 fade out, 20 frames, fade in, 2 / 3 the shake
 *  C6F2 on / off. */
function* screenEvent(g: Game): Co {
  const m = g.m;
  const k = m.rd(0xca28);
  if (k === 0x00 || k === 0x05) return;
  if (k === 0x01 || k === 0x04) {
    yield* fadeOut(g);
    yield* g.wait(0x20);
    yield* fadeIn(g);
  } else if (k === 0x02) m.wr(0xc6f2, 1);
  else if (k === 0x03) m.wr(0xc6f2, 0);
  else throw new NotPorted(`event 11 ${k.toString(16)} (00:196C: past the table)`);
}

/** 0B:706C — one of item CE91 taken from the bag C6FF (0x18 pairs id, count): not found or a
 *  count of 0: CE91 = FF. */
function bagTake(m: Memory): void {
  const id = m.rd(0xce91);
  let hl = 0xc6ff;
  for (let b = 0x18; b; b--) {
    if (m.rd(hl) === id) {
      hl++;
      const n = m.rd(hl);
      if (!n) break;
      m.wr(hl, n - 1);
      return;
    }
    hl += 2;
  }
  m.wr(0xce91, 0xff);
}

/** 0B:6683 — for members 0-4 (CD36, kept) with no record kind (C500 & 0F) and a temporary item at
 *  C540: C540 = FF and the item taken back (CE26, CE25 = 1, 0B:7124); then the bag C6FF: a count
 *  of 0 makes both bytes FF. */
function tempItemsBack(m: Memory): void {
  const saved = m.rd(0xcd36);
  m.wr(0xcd36, 0);
  do {
    const hl = (entityOffset(m) + 0xc540) & 0xffff;
    if (!(m.rd((hl - 0x40) & 0xffff) & 0x0f)) {
      const a = m.rd(hl);
      if (a !== 0xff) {
        m.wr(hl, 0xff);
        m.wr(0xce26, a);
        m.wr(0xce25, 1);
        throw new NotPorted("0B:7124 (a temporary item taken back)");
      }
    }
    m.wr(0xcd36, m.rd(0xcd36) + 1);
  } while (m.rd(0xcd36) < 5);
  m.wr(0xcd36, saved);
  for (let hl = 0xc700, b = 0; b < 0x18; b++, hl += 2) {
    if (m.rd(hl) === 0) { m.wr(hl, 0xff); m.wr(hl - 1, 0xff); }
  }
}

/** 00:15D3 — event 13, item CA28 used up: CE91 = CA28, one taken from the bag (0B:706C), the
 *  temporary items back (0B:6683). */
function itemTaken(g: Game): void {
  const m = g.m;
  m.wr(0xce91, m.rd(0xca28));
  farSync(g, 0x0b, () => bagTake(m));
  farSync(g, 0x0b, () => tempItemsBack(m));
}

/** 00:1993 — event 16, text CA28 - 1 of the table 0A:4004 (mode 8: the window opened, box (1,1)
 *  18 x 6), then the window closed (00:35D2). */
function* textEvent(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x0a);
  const hl = tableWord(m, 0x4004, (m.rd(0xca28) - 1) & 0xff);
  popBank(g);
  yield* far0(g, 0x0a, () => printText(g, 0x08, hl, 0x0101, 0x0612));
  yield* windowClose(g);
}

/** 00:19AE — event 17, a shop or inn (CA2F = CA28 - 1, 01:6FD4). */
function shopEvent(g: Game): void {
  const m = g.m;
  m.wr(0xca2f, m.rd(0xca28) - 1);
  throw new NotPorted("01:6FD4 (the shop / inn menus, event 17)");
}

/** 0B:7037 — item CE94 into the bag C6FF: its pair counts one more (9 or more: CE94 = FF), else
 *  the first free pair (FF) = CE94, 1; none: CE94 = FF. Returns [hl, b] as left. */
function bagPut(m: Memory): [number, number] {
  const id = m.rd(0xce94);
  let hl = 0xc6ff, b = 0x18;
  for (; b; b--, hl += 2) {
    if (m.rd(hl) !== id) continue;
    hl++;
    const n = m.rd(hl);
    if (n >= 0x09) { m.wr(0xce94, 0xff); return [hl, b]; }
    m.wr(hl, n + 1);
    return [hl, b];
  }
  hl = 0xc6ff;
  for (b = 0x18; b; b--, hl += 2) {
    if (m.rd(hl) !== 0xff) continue;
    m.wr(hl++, m.rd(0xce94));
    m.wr(hl, 0x01);
    return [hl, b];
  }
  m.wr(0xce94, 0xff);
  return [hl, b];
}

/** 0B:6D63 — item CE94 received: into the bag (0B:7037), CE7C-CE7E = its count; taken: sound 3D
 *  (items D8-E9) or 35 and the text 09:724E; else (CE94 back) sound 3B and the text 09:731A (9
 *  already) or 09:7260 (no room); mode 40 with the window on, else 08 and the window closed
 *  after (00:35D2). */
function* itemGet(g: Game): Co {
  const m = g.m;
  const d = m.rd(0xce94);
  const [p, b] = farSync(g, 0x0b, () => bagPut(m));
  m.wr(0xce7c, m.rd(p));
  m.wr(0xce7d, 0);
  m.wr(0xce7e, 0);
  let hl: number, a: number;
  if (m.rd(0xce94) === d) {
    hl = 0x724e;
    a = d >= 0xd8 && d < 0xea ? 0x3d : 0x35;
  } else {
    m.wr(0xce94, d);
    hl = b ? 0x731a : 0x7260;
    a = 0x3b;
  }
  m.hram[0x3c] = a;
  const on = !!(m.rd(0xff40) & 0x20);
  yield* far0(g, 0x09, () => printText(g, on ? 0x40 : 0x08, hl, 0x0101, 0x0612));
  if (!on) yield* windowClose(g);
}

/** 00:1A02 — event 18, item 03:762A[CA28 - 1] received (CE94; CD3D = 1, 0B:6D63); unless story
 *  flag 01, a CA28 of 61 or more sets the flag 0F:7C7E[CA28 - 61] (0F:7C74). */
function* itemEvent(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x03);
  m.wr(0xce94, m.rd((0x762a + ((m.rd(0xca28) - 1) & 0xff)) & 0xffff));
  popBank(g);
  m.wr(0xcd3d, 1);
  yield* farcall(g, 0x0b, () => itemGet(g));
  if (testFlag(m, 0x01)) return;
  const a = m.rd(0xca28);
  if (a < 0x61) return;
  farSync(g, 0x0f, () => setFlag(m, m.rd((0x7c7e + ((a - 0x61) & 0xff)) & 0xffff)));
}

/** 00:19B8 — event 23 (01:7972, a menu; then 01:63E6 / 01:642E by CA57). */
function menuEvent(g: Game): void {
  pushBank(g, 0x01);
  throw new NotPorted("01:7972 (event 23's menu)");
}

// ---------------------------------------------------------------- scene effects

/** 00:1329 — event 1E 24: 30 frames, then 4 steps (20 frames each) masking the 256 bytes of
 *  tiles at 8400 (through C800) with the plane masks 00:1372 / 00:1377 [4 .. 1]. */
function* tilesFade(g: Game): Co {
  const m = g.m;
  yield* g.wait(0x30);
  for (let e = 4; e; e--) {
    far0Sync(g, 0, () => vramCopy(m, 0x8400, 0xc800, 0x100));
    const b = m.rd(0x1372 + e), c = m.rd(0x1377 + e);
    let hl = 0xc800;
    for (let d = 0x40; d; d--) {
      m.wr(hl, m.rd(hl) & b); hl++;
      m.wr(hl, m.rd(hl) & b); hl++;
      m.wr(hl, m.rd(hl) & c); hl++;
      m.wr(hl, m.rd(hl) & c); hl++;
    }
    far0Sync(g, 0, () => vramCopy(m, 0xc800, 0x8400, 0x100));
    yield* g.wait(0x20);
  }
}

/** 00:12DC — event 1E, a scene effect by CA28 after the map's flag patches (00:137C), bank 01: 02
 *  / 19 / 1C spawn sequences (01:614F / 6154 / 6145), 1A a fade then one (01:6159), 1B one then a
 *  fade (01:6169), then the view redrawn (00:0E34); 1D the flashes (01:6125) and 24 the tiles
 *  fade (00:1329) without the redraw. */
function* sceneEffect(g: Game): Co {
  const m = g.m;
  farSync(g, 0x0b, () => mapPatches(g));
  pushBank(g, 0x01);
  const k = m.rd(0xca28);
  if (k === 0x1d) { yield* flashFrames(g); popBank(g); return; }
  if (k === 0x24) { yield* tilesFade(g); popBank(g); return; }
  if (k === 0x02) yield* spawnSequence(g, 0x6254);
  else if (k === 0x19) yield* spawnSequence(g, 0x626b);
  else if (k === 0x1a) {
    yield* fadeOut(g);
    yield* g.wait(0x10);
    yield* fadeIn(g);
    yield* spawnSequence(g, 0x628b);
  } else if (k === 0x1b) {
    yield* spawnSequence(g, 0x62c3);
    yield* fadeOut(g);
    yield* g.wait(0x20);
    yield* fadeIn(g);
  } else if (k === 0x1c) yield* spawnSequence(g, 0x6240);
  yield* drawView(g);
  popBank(g);
}

/** 00:1A34 — event 20, a hurt: the words C510 of members 0-4 - 2 (at least 1), sound 07, the
 *  background black for 2 frames. */
function* hurtAll(g: Game): Co {
  const m = g.m;
  for (let b = 0; b < 5; b++) {
    const hl = (memberOffset(m, b) + 0xc510) & 0xffff;
    const s = m.rd(hl) - 2;
    m.wr(hl, s & 0xff);
    const h = m.rd(hl + 1) - (s < 0 ? 1 : 0);
    m.wr(hl + 1, h & 0xff);
    if (h < 0 || (!(h & 0xff) && !m.rd(hl))) {
      m.wr(hl, 0x01);
      m.wr(hl + 1, 0x00);
    }
  }
  m.hram[0x3c] = 0x07;
  const bgp = m.rd(0xff47);
  m.wr(0xff47, 0);
  yield* g.wait(2);
  m.wr(0xff47, bgp);
}

/** 09:53D1 — entity CD36 revived: sound 18, its status C501 = 0 (00:1FC4). */
function revive(m: Memory): void {
  m.hram[0x3c] = 0x18;
  m.wr((entityOffset(m) + 0xc501) & 0xffff, 0);
}

/** 00:1A6D — event 21, members 0-4 revived (CD36 = 0..5, 09:53D1). */
function reviveAll(g: Game): void {
  const m = g.m;
  m.wr(0xcd36, 0);
  do {
    farSync(g, 0x09, () => revive(m));
    m.wr(0xcd36, m.rd(0xcd36) + 1);
  } while (m.rd(0xcd36) < 5);
}

/** 01:7726 — the word at hl + de moved to the word 2 bytes below it. */
function wordDown(m: Memory, hl: number, de: number): void {
  let p = (hl + de) & 0xffff;
  const d = m.rd(p); p = (p - 1) & 0xffff;
  const e = m.rd(p); p = (p - 1) & 0xffff;
  m.wr(p, d); p = (p - 1) & 0xffff;
  m.wr(p, e);
}

/** 01:7713 — member a, unless dead (C501 bit 6): C516 -> C514, C512 -> C510 (full points). */
function healMember(m: Memory, a: number): void {
  const hl = (memberOffset(m, a & 0x7f) + 0xc501) & 0xffff;
  if (m.rd(hl) & 0x40) return;
  wordDown(m, hl, 0x16);
  wordDown(m, hl, 0x12);
}

/** 01:7701 — every member (4; 5 with a member limit, 0B:6D12) healed (01:7713), last first. (The
 *  same routine as textcodes.ts's, which is not exported.) */
function healAll(g: Game): void {
  const m = g.m;
  const z = farSync(g, 0x0b, () => memberLimit(m)) === 0;
  for (let b = z ? 4 : 5; b; b--) healMember(m, b - 1);
}

/** 00:1A84 — event 22 (24: CA51 = 1 first), a rest: sound 17, the party healed (01:7701), fade
 *  out, 10 frames, fade in. */
function* rest(g: Game): Co {
  const m = g.m;
  m.hram[0x3c] = 0x17;
  farSync(g, 0x01, () => healAll(g));
  yield* fadeOut(g);
  yield* g.wait(0x10);
  yield* fadeIn(g);
}

/** 00:1A95 — event 25, CA58 + 1: even, a step down (00:1AC3; up when C6EE = 0, 00:1ADE); odd,
 *  bank 0B: four flashes (00:1AEA) and the patch 0B:79E0[4] (down) / [5] (up) (0B:7926), then the
 *  step. */
function* rockEvent(g: Game): Co {
  const m = g.m;
  const n = (m.rd(0xca58) + 1) & 0xff;
  m.wr(0xca58, n);
  const up = !m.rd(0xc6ee);
  if (n & 1) {
    pushBank(g, 0x0b);
    yield* flash4(g);
    patchAt(g, tableWord(m, 0x79e0, up ? 5 : 4));
    popBank(g);
  }
  if (up) yield* stepUp(g);
  else yield* stepDown(g);
}

/** 00:1B12 / 00:1B1E — events 27 / 28: CA2C = 0 (00:1B28), the walk (01:67F5 / 01:691E, bank
 *  01), CA2C = 0. */
function* walk(g: Game, fn: (g: Game) => Co): Co {
  const m = g.m;
  m.wr(0xca2c, 0);
  yield* farcall(g, 0x01, () => fn(g));
  m.wr(0xca2c, 0);
}

/** 0B:792D — a patch at hl into the layout D000 at the cell (c, b) (rows of CA07; C800-C802 its
 *  width and row pointer), then the bank popped (the caller pushed 0B). */
function patchCell(g: Game, hl: number, b: number, c: number): void {
  const m = g.m;
  let de = 0xd000 | c;
  if (b) {
    for (; b; b--) de = (de + m.rd(0xca07)) & 0xffff;
    m.wr(0xc801, de & 0xff);
    m.wr(0xc802, de >> 8);
  }
  const wh = m.rd(hl);
  if (wh) {
    m.wr(0xc800, wh >> 4);
    hl++;
    for (let r = wh & 0x0f; r; r--) {
      for (let i = m.rd(0xc800) || 256; i; i--) m.wr(de++, m.rd(hl++));
      const lo = m.rd(0xc801) + m.rd(0xca07);
      m.wr(0xc801, lo & 0xff);
      m.wr(0xc802, (m.rd(0xc802) + (lo >> 8)) & 0xff);
      de = (m.rd(0xc802) << 8) | m.rd(0xc801);
    }
  }
  popBank(g);
}

/** 00:1C51 — (bank 0B) the patch 0B:7CC7 at the cell of slot CA6D's target (C290 / C2B0, FF96
 *  kept). */
function switchPatch(g: Game): void {
  const m = g.m;
  pushBank(g, 0x0b);
  const s = m.hram[0x16]!;
  setSlot(m, m.rd(0xca6d));
  const sw = (v: number) => ((v << 4) | (v >> 4)) & 0xff;
  const b = sw(fget(m, "c290")) | sw(fget(m, "c290", 1));
  const c = sw(fget(m, "c2b0")) | sw(fget(m, "c2b0", 1));
  patchCell(g, 0x7cc7, b, c);
  setSlot(m, s);
}

/** 00:1BE4 — event 2B, a switch pressed: sound 1C, the shake for 8 frames, the patch (00:1C51),
 *  the view redrawn (00:0E34, bank 01); C6F2, CA52, CA6D = 0, CA01 + 1; at 4: story flag E4 (map
 *  7C), E5 (7D) or E6, and with all three the text 0A:7CF1. */
function* switchEvent(g: Game): Co {
  const m = g.m;
  m.hram[0x3c] = 0x1c;
  m.wr(0xc6f2, 1);
  yield* g.wait(8);
  pushBank(g, 0x0b);
  switchPatch(g);
  popBank(g);
  yield* farcall(g, 0x01, () => drawView(g));
  m.wr(0xc6f2, 0);
  m.wr(0xca52, 0);
  m.wr(0xca6d, 0);
  const n = (m.rd(0xca01) + 1) & 0xff;
  m.wr(0xca01, n);
  if (n !== 0x04) return;
  const map = m.rd(0xc6e8);
  setFlag(m, map === 0x7c ? 0xe4 : map === 0x7d ? 0xe5 : 0xe6);
  if (!testFlag(m, 0xe4) || !testFlag(m, 0xe5) || !testFlag(m, 0xe6)) return;
  yield* far0(g, 0x0a, () => printText(g, 0x00, 0x7cf1, 0x0101, 0x0612));
}

/** 00:1BC1 — event 2C: four flashes (00:1AEA), bank 01, a frame, 01:5B4D (a raster quake). */
function* quakeEvent(g: Game): Co {
  yield* flash4(g);
  pushBank(g, 0x01);
  yield* wait1(g);
  throw new NotPorted("01:5B4D (event 2C: the raster quake, vblank 00:11E4 / STAT 00:121D)");
}
