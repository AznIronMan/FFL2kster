/** Legend III field loop (00:0265): the field step 00:07BB (the leader's step going on, the
 *  layer switch, the map's triggers, then the buttons: a step on the D-pad, A, B, Start, Select),
 *  the companion (01:4F24), the objects (01:4F66, 00:01A0), a frame, the map animation (01:54A0).
 *  Runs with bank 01 selected. */
import type { Game, Co } from "./game.js";
import { wait1, far0, pushBank, popBank } from "./sys.js";
import { NotPorted } from "./irq.js";
import { fget, fset, setSlot, testFlag } from "./objects.js";
import { drawObjects, objectSprite, tableWord } from "./actors.js";
import { mapAnimation, windowClose } from "./window.js";
import { printText } from "./text.js";
import { dispatch } from "./events.js";
import { companionFollow, objectsUpdate, layerSwitch, leaderStartDown, leaderStartUp, leaderStartRight,
  leaderStartLeft, leaderDown, leaderUp, leaderRight, leaderLeft, leaderNext } from "./events2.js";

/** 00:08F3 — the map's pending events: CA52 -> event 2B; else with CA56 (a step was made) and
 *  the leader on foot (C6E3 0 or 2, or 3+ on cell EA) a C0-type cell C2F0 -> its event (C2F0 &
 *  3F, after the companion 01:4F24). */
function* pendingEvents(g: Game): Co {
  const m = g.m;
  if (m.rd(0xca52)) { m.wr(0xca29, 0x2b); yield* dispatch(g); return; }
  if (!m.rd(0xca56)) return;
  const v = m.rd(0xc6e3);
  if (v !== 0x02) {
    if (v >= 0x03) { if (m.rd(0xc2f0) !== 0xea) return; }
    else if (v) return;
  }
  if ((m.rd(0xc2f0) & 0xc0) !== 0xc0) return;
  m.wr(0xca13, 0);
  companionFollow(m);
  m.wr(0xca29, m.rd(0xc2f0) & 0x3f);
  yield* dispatch(g);
}

/** 01:6374 — on map 01 in a vehicle (C6E3), flags E8 and CF clear, inside C290 60-1AF and C2B0
 *  200-37F: the vehicle is pushed out (not ported). */
function map01Push(g: Game): void {
  const m = g.m;
  if (!m.rd(0xc6e3) || m.rd(0xc6e8) !== 0x01) return;
  if (testFlag(m, 0xe8) || testFlag(m, 0xcf)) return;
  const y = fget(m, "c290") | (fget(m, "c290", 1) << 8);
  const x = fget(m, "c2b0") | (fget(m, "c2b0", 1) << 8);
  if (y < 0x60 || y >= 0x1b0 || x < 0x200 || x >= 0x380) return;
  throw new NotPorted("01:63AD (map 01: the vehicle pushed out)");
}

/** 01:4BF6 — the leader on a moving cell (C2F0 8x): carried (not ported); else on. */
function movingCell(g: Game): void {
  const m = g.m;
  if ((fget(m, "c2f0") & 0xc0) === 0x80) throw new NotPorted("01:4BFF (a moving cell)");
}

/** 01:4395 — an object (slots 2-F, C200 set) on the cell C800-C803, on C804's layer (C2E0 & 3;
 *  3 on either side meets any), not moving (C2D0 & 3F = 0): true, FF96 left at it (else 10). */
function objectFacing(g: Game): boolean {
  const m = g.m;
  for (let s = 2; s < 0x10; s++) {
    setSlot(m, s);
    if (!fget(m, "c200")) continue;
    if (fget(m, "c290") !== m.rd(0xc800) || fget(m, "c290", 1) !== m.rd(0xc801)) continue;
    if (fget(m, "c2b0") !== m.rd(0xc802) || fget(m, "c2b0", 1) !== m.rd(0xc803)) continue;
    const a = m.rd(0xc804) & 3, b = fget(m, "c2e0") & 3;
    if (a !== 3 && b !== 3 && a !== b) continue;
    if (fget(m, "c2d0") & 0x3f) continue;
    return true;
  }
  setSlot(m, 0x10);
  return false;
}

/** 01:431E — the object the leader faces (its next cell by C6EE, 01:4736-4793; C804 its C2E0,
 *  01:438D; 01:4395): a person (C350 0, C200 below E0) turns to the leader (C2D0, 01:5272). */
function talkTarget(g: Game): boolean {
  const m = g.m;
  setSlot(m, 0);
  const d = m.rd(0xc6ee);
  leaderNext(m, d);
  m.wr(0xc804, fget(m, "c2e0"));
  if (!objectFacing(g)) return false;
  const b = [0x80, 0xc0, 0x00, 0x40][d >> 6]!;
  if (!fget(m, "c350") && fget(m, "c200") < 0xe0) {
    fset(m, "c2d0", b);
    objectSprite(m, b);
  }
  return true;
}

/** 00:0945 — A in the field: on the return point (01:6313) or in vehicle 2, not ported; else the
 *  object faced (01:431E), a frame, then by its type C350: 0 its words (0A:4004[C200 - 1], text
 *  mode 08, then the window closed), 3 a sign (0A:791E[C200 - 1] for C200 below 9). */
function* fieldA(g: Game): Co {
  const m = g.m;
  if (!m.rd(0xc6e3)) {
    let same = true;
    for (let k = 0; k < 5; k++) if (m.rd(0xc6e4 + k) !== m.rd(0xc6e9 + k)) same = false;
    if (same) throw new NotPorted("01:632A (A on the return point)");
  }
  if (m.rd(0xc6e3) === 0x02) throw new NotPorted("00:0950 (A in vehicle 2)");
  if (!talkTarget(g)) return;
  yield* wait1(g);
  const t = fget(m, "c350"), id = fget(m, "c200");
  if (t === 0) {
    if (id === 0xff) return;
    pushBank(g, 0x0a);
    const hl = tableWord(m, 0x4004, (id - 1) & 0xff);
    popBank(g);
    yield* far0(g, 0x0a, () => printText(g, 0x08, hl, 0x0101, 0x0612));
    yield* windowClose(g);
  } else if (t === 3) {
    if (id >= 0x09) return;
    pushBank(g, 0x0a);
    const hl = tableWord(m, 0x791e, (id - 1) & 0xff);
    popBank(g);
    yield* far0(g, 0x0a, () => printText(g, 0x00, hl, 0x0101, 0x0612));
  } else throw new NotPorted(`00:098A (A: object type ${t})`);
}

/** 00:07BB — the field step. */
function* fieldStep(g: Game): Co {
  const m = g.m;
  // 01:43F9 — a step going on: its frame by the facing C6EE
  if (m.rd(0xc6ef)) {
    [leaderUp, leaderRight, leaderDown, leaderLeft][m.rd(0xc6ee) >> 6]!(m);
    return;
  }
  yield* layerSwitch(g);
  if (m.rd(0xca2c)) throw new NotPorted("00:10C2 (an encounter)");
  m.hram[0x16] = 0;
  yield* pendingEvents(g);
  map01Push(g);
  movingCell(g);
  if (!m.rd(0xc6e3)) {
    // 00:07DC — on foot: the leader's tile base and kind back from C330 / C340, its sprite
    setSlot(m, 0);
    fset(m, "c280", fget(m, "c330"));
    fset(m, "c320", fget(m, "c340"));
    objectSprite(m, m.rd(0xc6ee));
    if (m.rd(0xc6e8) >= 0x0c && m.hram[0x0b]! & 0x02) throw new NotPorted("01:47B2 (B on foot: a jump)");
  }
  m.wr(0xca13, 0);
  const held = m.hram[0x0a]!;
  if (held & 0x80) leaderStartDown(g);
  else if (held & 0x40) leaderStartUp(g);
  else {
    if (held & 0x10) leaderStartRight(g);
    if (m.hram[0x0a]! & 0x20) leaderStartLeft(g);
  }
  const pressed = () => m.hram[0x0b]!; // FF8B, read again at each test (the text waits frames)
  if (pressed() & 0x01) yield* fieldA(g);
  if (pressed() & 0x02 && m.rd(0xc6e3)) throw new NotPorted("00:0861 (B in a vehicle)");
  if (m.rd(0xc6ef)) return;
  if (pressed() & 0x08) throw new NotPorted("09:4000 (the menu)");
  if (pressed() & 0x04) throw new NotPorted("00:0851 (Select: the party order)");
}

/** 00:0265 — the field loop. */
export function* fieldLoop(g: Game): Co {
  const m = g.m;
  for (;;) {
    m.wr(0xca0e, 0);
    yield* fieldStep(g);
    companionFollow(m);
    objectsUpdate(g);
    drawObjects(g);
    yield* wait1(g);
    mapAnimation(g);
  }
}
