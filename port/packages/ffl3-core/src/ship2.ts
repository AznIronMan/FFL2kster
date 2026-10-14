/** Legend III ship, the rest of event 23 and the vehicle on the field (bank 01): the console's
 *  departure (01:63E6: back to the place kept at C6E9, the vehicle state C6E3 by the story flags
 *  and C6FA, the map load) and its confirmed item (01:642E: the story flags 0E / 0F and the wave
 *  flash 0F:7DF2, or the lift-off 0F:7DEF, the key items given up and door 2F); map 01's push
 *  out of the vehicle (01:63AD: six flashes, three steps back against the facing); A on the
 *  return point (01:6313 / 01:632A). Every routine of bank 01 here runs with bank 01 selected by
 *  its caller (00:19B8 for event 23, the field loop for the others). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, copyB, far0, far0Sync, farcall, farSync, vramCopy, textBegin, textEnd, windowOff, bracketEnter,
  bracketLeave, fadeLevels, wait1 } from "./sys.js";
import { NotPorted } from "./irq.js";
import { testFlag, setFlag, clearFlag } from "./objects.js";
import { printText } from "./text.js";
import { loadMap, loadTiles } from "./mapload.js";
import { drawObjects } from "./actors.js";
import { mapAnimation } from "./window.js";
import { wornOutBack } from "./equip.js";
import { dispatch } from "./events.js";
import { companionFollow, layerSwitch, leaderStartDown, leaderStartUp, leaderStartRight, leaderStartLeft,
  leaderDown, leaderUp, leaderRight, leaderLeft } from "./events2.js";

// ---------------------------------------------------------------- bank-0 helpers

/** 00:1AF7 — one flash: BGP 0 for 4 frames (00:3A6D), then back for 4. */
function* flash1(g: Game): Co {
  const m = g.m;
  const bgp = m.rd(0xff47);
  m.wr(0xff47, 0);
  yield* g.wait(4);
  m.wr(0xff47, bgp);
  yield* g.wait(4);
}

/** 00:0150 — the map's tiles reloaded in the VRAM bracket (00:1D9E, 00:0427, 00:1DFD). */
function* reloadTiles(g: Game): Co {
  yield* bracketEnter(g);
  yield* loadTiles(g);
  yield* bracketLeave(g);
}

// ---------------------------------------------------------------- the leader's walk (bank 01)

/** 01:41AF — a frame of the leader's walk: the companion (01:4F24), the map animation (01:54A0),
 *  the objects drawn (00:01A0), a frame (00:3A6B); returns C6EF != 0 (still moving). */
function* walkFrame(g: Game): Co<boolean> {
  const m = g.m;
  companionFollow(m);
  mapAnimation(g);
  drawObjects(g);
  yield* wait1(g);
  return m.rd(0xc6ef) !== 0;
}

/** 01:686B (up, 01:44A8 / 01:44E9), 01:6884 (down: the layer switch 01:5CD3 first, 01:441D /
 *  01:445F), 01:68A0 (right, 01:4520 / 01:4562), 01:68B9 (left, 01:4599 / 01:45DB) — b steps of
 *  the leader: each a checked start, then (unless blocked, CA30) frames (01:41AF) until C6EF is 0,
 *  each followed by the step's frame. */
function* leaderWalk(g: Game, dir: number, b: number): Co {
  const m = g.m;
  do {
    if (dir === 0x80) yield* layerSwitch(g);
    const [start, frame] = dir === 0x00 ? [leaderStartUp, leaderUp] : dir === 0x80 ? [leaderStartDown, leaderDown]
      : dir === 0x40 ? [leaderStartRight, leaderRight] : [leaderStartLeft, leaderLeft];
    start(g);
    if (!m.rd(0xca30)) while (yield* walkFrame(g)) frame(m);
    b = (b - 1) & 0xff;
  } while (b);
}

// ---------------------------------------------------------------- map 01: pushed out (01:63AD)

/** 01:63AD — map 01, the vehicle pushed out (the end of 01:6374): sound 40 (FFBC), C6F2 = 1, six
 *  flashes (00:1AF7), C6F2 = 0; then three steps of the leader against its facing C6EE (rotated
 *  left twice, the jump table 01:63CA): 00 (up) -> down (01:6884), 40 (right) -> left (01:68B9),
 *  80 (down) -> up (01:686B), C0 (left) -> right (01:68A0). Returns to the field step (00:07D2). */
export function* vehiclePushedOut(g: Game): Co {
  const m = g.m;
  g.sfx(0x40);
  m.wr(0xc6f2, 0x01);
  for (let b = 6; b; b--) yield* flash1(g);
  m.wr(0xc6f2, 0x00);
  const f = m.rd(0xc6ee);
  const k = ((f << 2) | (f >> 6)) & 0xff;
  switch (k) {
    case 0: yield* leaderWalk(g, 0x80, 0x03); break; // 01:63D2 -> 01:6884
    case 1: yield* leaderWalk(g, 0xc0, 0x03); break; // 01:63D7 -> 01:68B9
    case 2: yield* leaderWalk(g, 0x00, 0x03); break; // 01:63DC -> 01:686B
    case 3: yield* leaderWalk(g, 0x40, 0x03); break; // 01:63E1 -> 01:68A0
    default: throw new NotPorted(`01:63C7 (jump table 01:63CA past its end: C6EE ${f.toString(16)})`);
  }
}

// ---------------------------------------------------------------- A on the return point (01:6313)

/** 01:634F — map 10 at (C6E4 = x set by the caller; C6E5 0, C6E6 B0, C6E7 0), facing up (C6EE 0),
 *  C6E8 = 10, the map load (00:027D). */
function* map10(g: Game): Co {
  const m = g.m;
  m.wr(0xc6e5, 0x00);
  m.wr(0xc6e6, 0xb0);
  m.wr(0xc6e7, 0x00);
  m.wr(0xc6ee, 0x00);
  m.wr(0xc6e8, 0x10);
  yield* loadMap(g);
}

/** 01:632A — A on the return point (on foot, C6E4-C6E8 = C6E9-C6ED): story flag 09 set (00:3CA0);
 *  flag 82 clear: nothing (z, from 00:3CB2); flag 8F set: the text 0A:6A0A (mode 08, box (1,1)
 *  18 x 6; z when CD3D is 0 after it, the `dec [hl]` of 00:1DF3 kept through the far return
 *  00:37FE); else C6E4 = 20 and map 10 (01:634F), z. Returns the z flag 00:0948 tests (z: A is
 *  done, the field step returns). */
export function* returnPointA(g: Game): Co<boolean> {
  const m = g.m;
  setFlag(m, 0x09);
  if (!testFlag(m, 0x82)) return true;
  if (testFlag(m, 0x8f)) {
    yield* far0(g, 0x0a, () => printText(g, 0x08, 0x6a0a, 0x0101, 0x0612));
    return m.rd(0xcd3d) === 0;
  }
  m.wr(0xc6e4, 0x20);
  yield* map10(g);
  return true; // 01:636A xor a ; and a
}

/** 01:6313 — A in the field (00:0945): in a vehicle (C6E3 set) or away from the return point
 *  (C6E4-C6E8 != C6E9-C6ED): nothing (nz); else 01:632A. Returns the z flag of 00:0948. */
export function* returnPointCheck(g: Game): Co<boolean> {
  const m = g.m;
  if (m.rd(0xc6e3)) return false;
  for (let k = 0; k < 5; k++) if (m.rd(0xc6e4 + k) !== m.rd(0xc6e9 + k)) return false;
  return yield* returnPointA(g);
}

// ---------------------------------------------------------------- event 23: departing (01:63E6)

/** 01:63E6 — event 23, the console's Depart (CA57 = 1): back to the place kept at C6E9 (00:1F87
 *  -> C6E4-C6E8); the vehicle state C6E3 by the story flags (00:3CB2) and C6FA: flag 3A: C6FA E0
 *  -> 8, DF -> 7, else 6; else flag 39: C6FA DF -> 5, else 4; else 3. Then the map load (jp
 *  00:027D), which returns to 00:19CE (the bank popped). */
export function* departShip(g: Game): Co {
  const m = g.m;
  copy(m, 0xc6e9, 0xc6e4, 5);
  let a: number;
  if (testFlag(m, 0x3a)) {
    const c = m.rd(0xc6fa);
    a = c === 0xe0 ? 0x08 : c === 0xdf ? 0x07 : 0x06;
  } else if (testFlag(m, 0x39)) {
    a = m.rd(0xc6fa) === 0xdf ? 0x05 : 0x04;
  } else a = 0x03;
  m.wr(0xc6e3, a);
  yield* loadMap(g);
}

// ---------------------------------------------------------------- bank 0F: the wave flash (0F:7DF2)

/** 0F:7E18 — the wave set-up: CDB2 = 0, CDB3 = 8F, WY = 50, the VRAM bracket (00:1D9E), the fade
 *  levels (farcall 0F:79AE), the table 0F:7E54 twice at C880-C8BF (00:1F97); di, CDB0 = SCX,
 *  CDB1 = 0F, LYC = CDB2, STAT -> 0F:7EC2 (C0BD / C0BE), reti. */
function* waveBegin(g: Game): Co {
  const m = g.m;
  m.wr(0xcdb2, 0);
  m.wr(0xcdb3, 0x8f);
  m.wr(0xff4a, 0x50);
  yield* bracketEnter(g);
  farSync(g, 0x0f, () => fadeLevels(m));
  const [, de] = far0Sync(g, 0, () => copyB(m, 0x7e54, 0xc880, 0x20));
  far0Sync(g, 0, () => copyB(m, 0x7e54, de, 0x20));
  yield* g.point(0x0f7e3b); // (the fade levels and copies after the bracket take CPU time)
  g.ime = false;
  m.wr(0xcdb0, m.rd(0xff43));
  m.wr(0xcdb1, 0x0f);
  m.wr(0xff45, m.rd(0xcdb2));
  m.wr(0xc0bd, 0xc2);
  m.wr(0xc0be, 0x7e);
  yield* g.reti();
}

/** 0F:7E74 — the wave end: di, LYC 3, STAT -> 00:1F27 (00:1E40 -> C0BC), ei, leave the bracket
 *  (00:1DFD). */
function* waveEnd(g: Game): Co {
  const m = g.m;
  yield* g.point(0x0f7e74); // after the last sound tick (CPU time): the raster runs until here
  g.ime = false;
  g.lycStillNext();
  m.wr(0xff45, 0x03);
  copy(m, 0x1e40, 0xc0bc, 3);
  g.ime = true;
  yield* bracketLeave(g);
}

/** 0F:7EAD — poll LY for line 0, then the palettes from CDB4 + 3 e (00:1F8D -> FF47) and a sound
 *  tick (0F:4006); with a trace the poll ends where the original's did (sync point 0F:7EB9), in
 *  play at the next line 0 (as wave.ts). */
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

/** 0F:7E9D — six frames at palette level e (0F:7EAD); hl = CDB1 after. */
function* waveFrames(g: Game, e: number): Co {
  for (let b = 0; b < 6; b++) yield* waveFrame(g, e);
}

/** 0F:7DF2 — the wave flash: the set-up (0F:7E18); level 0 while CDB1 counts down from 0F to 0
 *  (0F:7E86); sound 1A (FFBC); levels 1, 2 (0F:7E9D), level 3 four times (0F:7E97 -> 0F:7E9A ->
 *  0F:7E9D falling through twice), levels 2, 1; level 0 while CDB1 counts back up to 0F
 *  (0F:7E8D: CDB1 + 1 before each); the end (jr 0F:7E74). */
function* waveFlash(g: Game): Co {
  const m = g.m;
  yield* waveBegin(g);
  // 0F:7E86
  do {
    yield* waveFrames(g, 0);
    yield* g.point(0x0f7e89); // after the sixth sound tick (CPU time): the lines before keep CDB1
    m.wr(0xcdb1, (m.rd(0xcdb1) - 1) & 0xff);
  } while (m.rd(0xcdb1));
  g.sfx(0x1a);
  yield* waveFrames(g, 1);
  yield* waveFrames(g, 2);
  for (let k = 0; k < 4; k++) yield* waveFrames(g, 3); // 0F:7E97
  yield* waveFrames(g, 2);
  yield* waveFrames(g, 1);
  // 0F:7E8D
  for (let c = 0; c < 15; c++) {
    yield* g.point(0x0f7e8f); // after the previous sound tick (CPU time)
    m.wr(0xcdb1, (m.rd(0xcdb1) + 1) & 0xff);
    yield* waveFrames(g, 0);
  }
  yield* waveEnd(g);
}

// ---------------------------------------------------------------- bank 0F: the lift-off (0F:7DEF)

/** 0F:7F6F — the 16-byte tile 9000 + 10 a (00:246B: hl = 10 x a) copied to 9380 at line 30 (LY
 *  polled; 00:20FF), then C880 + 2 frames (00:3A6D). */
function* tileAt(g: Game, a: number): Co {
  const m = g.m;
  const hl = ((0x10 * a) + 0x9000) & 0xffff;
  yield* g.untilLine(0x30);
  far0Sync(g, 0, () => vramCopy(m, hl, 0x9380, 0x0010));
  yield* g.wait((m.rd(0xc880) + 2) & 0xff);
}

/** 0F:7F5E — one blink: the sound C881 (FFBC), the tiles 37, 1D and 40 (the copy kept at 9400)
 *  into 9380 (0F:7F6F). */
function* blink(g: Game): Co {
  const m = g.m;
  g.sfx(m.rd(0xc881));
  yield* tileAt(g, 0x37);
  yield* tileAt(g, 0x1d);
  yield* tileAt(g, 0x40);
}

/** 0F:7F08 — the lift-off scene: WY = 50, the bracket with CD3D (00:1D98), the music off (FFBA
 *  = 0), 2 frames, sound 16, the text 09:727E (mode 08, box (1,1) 18 x 6), the window off
 *  (00:3A4B); C881 = 25 (the blink sound), the tile 9380 kept at 9400 (00:20FF); 13 blinks
 *  (0F:7F5E) as C880 counts down from 0D (C880 + 2 frames each), 15 more with C880 0; the bracket
 *  left (00:1DF3), the field restored (farcall 01:7E49). */
function* liftOffScene(g: Game): Co {
  const m = g.m;
  m.wr(0xff4a, 0x50);
  yield* textBegin(g);
  g.atPoint(0x0f7f10, () => { m.hram[0x3a] = 0x00; });
  yield* g.wait(2);
  g.sfx(0x16);
  yield* far0(g, 0x09, () => printText(g, 0x08, 0x727e, 0x0101, 0x0612));
  windowOff(m);
  m.wr(0xc881, 0x25); // 0F:7F32
  far0Sync(g, 0, () => vramCopy(m, 0x9380, 0x9400, 0x0010));
  m.wr(0xc880, 0x0d);
  do {
    yield* blink(g);
    m.wr(0xc880, (m.rd(0xc880) - 1) & 0xff);
  } while (m.rd(0xc880));
  for (let b = 0x0f; b; b--) yield* blink(g);
  yield* textEnd(g);
  yield* farcall(g, 0x01, () => fieldRestore(g));
}

/** 01:7E49 — the tiles reloaded (00:0150), the objects drawn (jp 00:01A0). */
function* fieldRestore(g: Game): Co {
  yield* reloadTiles(g);
  drawObjects(g);
}

/** 0F:7DEF — the lift-off (0F:7F08), then the wave flash (falling into 0F:7DF2). */
function* liftOff(g: Game): Co {
  yield* liftOffScene(g);
  yield* waveFlash(g);
}

/** 0F:7A1B — C6F8 bit 0 and C6F9 bit 4 cleared (key items DF and E4 given up). */
function keyItemsGone(m: Memory): void {
  m.wr(0xc6f8, m.rd(0xc6f8) & 0xfe);
  m.wr(0xc6f9, m.rd(0xc6f9) & 0xef);
}

// ---------------------------------------------------------------- event 23: an item chosen (01:642E)

/** 01:6460 — story flag 0E set; flag 0F = flag 56 (00:3CA0 / 00:3CA6). */
function stageOther(m: Memory): void {
  setFlag(m, 0x0e);
  if (testFlag(m, 0x56)) setFlag(m, 0x0f);
  else clearFlag(m, 0x0f);
}

/** 01:647B — CA50 = 2: story flags 05 and 8D set, the lift-off (farcall 0F:7DEF), the worn-out
 *  weapons and the empty bag pairs (farcall 0B:6683), the key items given up (farcall 0F:7A1B),
 *  flags 39 and 3D cleared, C6E3 = 3, door 2F (CA28 = 2F, CA29 = 0E, the event dispatcher
 *  00:1236), the text 0A:6D37 (mode 0, box (1,1) 18 x 6). */
function* takeOff(g: Game): Co {
  const m = g.m;
  setFlag(m, 0x05);
  setFlag(m, 0x8d);
  yield* farcall(g, 0x0f, () => liftOff(g));
  farSync(g, 0x0b, () => wornOutBack(g));
  farSync(g, 0x0f, () => keyItemsGone(m));
  clearFlag(m, 0x39);
  clearFlag(m, 0x3d);
  m.wr(0xc6e3, 0x03);
  m.wr(0xca28, 0x2f);
  m.wr(0xca29, 0x0e);
  yield* dispatch(g);
  yield* far0(g, 0x0a, () => printText(g, 0x00, 0x6d37, 0x0101, 0x0612));
}

/** 01:642E — event 23, a console item confirmed (CA57 = 2), by the choice CA50 (the jump table
 *  01:6434): 0 (01:643A) flag 0E set: flags 0E and 0F cleared, else 01:6460; 1 (01:644D) flag 0E
 *  set: flag 0E cleared and 0F set, else 01:6460; both then the wave flash (farcall 0F:7DF2);
 *  2: 01:647B. Returns to 00:19CE (the bank popped). */
export function* consoleItem(g: Game): Co {
  const m = g.m;
  const a = m.rd(0xca50);
  if (a === 0x00) {
    if (testFlag(m, 0x0e)) { clearFlag(m, 0x0e); clearFlag(m, 0x0f); } else stageOther(m);
  } else if (a === 0x01) {
    if (testFlag(m, 0x0e)) { clearFlag(m, 0x0e); setFlag(m, 0x0f); } else stageOther(m);
  } else if (a === 0x02) {
    yield* takeOff(g);
    return;
  } else throw new NotPorted(`01:6431 (jump table 01:6434 past its end: CA50 ${a.toString(16)})`);
  yield* farcall(g, 0x0f, () => waveFlash(g)); // 01:6478
}
