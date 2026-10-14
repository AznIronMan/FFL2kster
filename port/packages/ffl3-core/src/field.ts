/** Legend III field loop (00:0265): the field step 00:07BB (the leader's step going on, the
 *  layer switch, the map's triggers, then the buttons: a step on the D-pad, A, B, Start, Select),
 *  the companion (01:4F24), the objects (01:4F66, 00:01A0), a frame, the map animation (01:54A0).
 *  Runs with bank 01 selected. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { wait1, far0, farcall, farSync, pushBank, popBank } from "./sys.js";
import { NotPorted } from "./irq.js";
import { fget, fset, setSlot, testFlag, setFlag, testFlag2, setFlag2 } from "./objects.js";
import { drawObjects, objectSprite, tableWord } from "./actors.js";
import { mapAnimation, windowClose } from "./window.js";
import { printText } from "./text.js";
import { fieldMenu } from "./fieldmenu.js";
import { dispatch, itemGet } from "./events.js";
import { shopMenu } from "./shop.js";
import { jumpB } from "./jump.js";
import { loadMap, spriteType, leaderTiles } from "./mapload.js";
import { encounter } from "./battle.js";
import { companionFollow, objectsUpdate, layerSwitch, leaderStartDown, leaderStartUp, leaderStartRight,
  leaderStartLeft, leaderDown, leaderUp, leaderRight, leaderLeft, leaderNext, leaderFace, leaderStepOn,
  stepSpeed, leaveVehicleEvent } from "./events2.js";
import { vehiclePushedOut, returnPointA } from "./ship2.js";

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
function* map01Push(g: Game): Co {
  const m = g.m;
  if (!m.rd(0xc6e3) || m.rd(0xc6e8) !== 0x01) return;
  if (testFlag(m, 0xe8) || testFlag(m, 0xcf)) return;
  const y = fget(m, "c290") | (fget(m, "c290", 1) << 8);
  const x = fget(m, "c2b0") | (fget(m, "c2b0", 1) << 8);
  if (y < 0x60 || y >= 0x1b0 || x < 0x200 || x >= 0x380) return;
  yield* vehiclePushedOut(g);
}

/** 01:4D79 / 4D89 / 4D9C — the step speed C6F0 from the moving cell's C2F0 bits 3-2 (as it is,
 *  one faster up to 3, one slower down to 0), then C6F4 (00:0165). */
function cellSpeed(m: Memory, d: number): void {
  let a = (fget(m, "c2f0") & 0x0c) >> 2;
  a = Math.min(3, Math.max(0, a + d));
  m.wr(0xc6f0, a);
  stepSpeed(m);
}

/** 01:4BF6 — the leader on a moving cell (C2F0 bits 7-6 = 2): false (z, the field step ends
 *  there) after carrying it; else true. Map 01 with flag AD: true (00:101F). Map 50: C280 = 30,
 *  C320 = 1B. CA13 = 0; by C2F0 & 3 the cell carries the leader up (01:4C3D), right (01:4D2A),
 *  down (01:4C8C) or left (01:4CDB): the button held the other way faces it that way and slows
 *  the step (01:4D9C), with the carrying way speeds it (01:4D89); across, a step of its own
 *  (01:441D / 44A8 / 4520 / 4599) and, when none starts, the face that way and the carried step;
 *  else the carried step facing that way (01:442F / 44BA / 4532 / 45AB). */
function movingCell(g: Game): boolean {
  const m = g.m;
  if ((fget(m, "c2f0") & 0xc0) !== 0x80) return true;
  if (m.rd(0xc6e8) === 0x01 && testFlag(m, 0xad)) return true;
  if (m.rd(0xc6e8) === 0x50) {
    fset(m, "c280", 0x30);
    fset(m, "c320", 0x1b);
  }
  m.wr(0xca13, 0);
  const held = () => m.hram[0x0a]!;
  // [carried way, its back button, the two cross buttons with their step starts, its own button]
  const carry = [0x00, 0x40, 0x80, 0xc0][fget(m, "c2f0") & 0x03]!;
  const across = (start: (g: Game) => void, face: number): boolean => {
    start(g);
    if (m.rd(0xc6ef)) return false;
    cellSpeed(m, 0);
    leaderFace(m, face);
    leaderStepOn(g, carry);
    return false;
  };
  const h = held();
  if (carry === 0x00) { // 01:4C3D
    if (h & 0x80) { cellSpeed(m, -1); leaderFace(m, 0x80); leaderStepOn(g, 0x00); return false; }
    if (h & 0x20) return across(leaderStartLeft, 0xc0);
    if (held() & 0x10) return across(leaderStartRight, 0x40);
    if (held() & 0x40) cellSpeed(m, 1); else cellSpeed(m, 0);
    leaderFace(m, 0x00); leaderStepOn(g, 0x00);
  } else if (carry === 0x80) { // 01:4C8C
    if (h & 0x40) { cellSpeed(m, -1); leaderFace(m, 0x00); leaderStepOn(g, 0x80); return false; }
    if (h & 0x20) return across(leaderStartLeft, 0xc0);
    if (held() & 0x10) return across(leaderStartRight, 0x40);
    if (held() & 0x80) cellSpeed(m, 1); else cellSpeed(m, 0);
    leaderFace(m, 0x80); leaderStepOn(g, 0x80);
  } else if (carry === 0xc0) { // 01:4CDB
    if (h & 0x10) { cellSpeed(m, -1); leaderFace(m, 0x40); leaderStepOn(g, 0xc0); return false; }
    if (h & 0x40) return across(leaderStartUp, 0x00);
    if (held() & 0x80) return across(leaderStartDown, 0x40); // 01:4D12: the right-facing list
    if (held() & 0x20) cellSpeed(m, 1); else cellSpeed(m, 0);
    leaderFace(m, 0xc0); leaderStepOn(g, 0xc0);
  } else { // 01:4D2A
    if (h & 0x20) { cellSpeed(m, -1); leaderFace(m, 0xc0); leaderStepOn(g, 0x40); return false; }
    if (h & 0x40) return across(leaderStartUp, 0x00);
    if (held() & 0x80) return across(leaderStartDown, 0x80);
    if (held() & 0x10) cellSpeed(m, 1); else cellSpeed(m, 0);
    leaderFace(m, 0x40); leaderStepOn(g, 0x40);
  }
  return false;
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
    if (same && (yield* returnPointA(g))) return;
  }
  if (m.rd(0xc6e3) === 0x02) { // 00:0950 — in vehicle 2: the map C6E8 found in 00:0935 (8) -> 00:093D
    const b = m.rd(0xc6e8);
    for (let c = 0; c < 8; c++) {
      if (m.rd(0x0935 + c) !== b) continue;
      m.wr(0xc6e8, m.rd(0x093d + c));
      if (m.rd(0xc6e8) === 0x02 && testFlag(m, 0x0e)) m.wr(0xc6e8, 0x03);
      break;
    }
    yield* loadMap(g); // 00:097C jp 00:027D
    return;
  }
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
  } else if (t === 1) yield* chestOpened(g);
  else { // 00:0A2F — a shop: CA2F = C200 - 1, 01:6FD4 (bank 01 selected)
    m.wr(0xca2f, (id - 1) & 0xff);
    yield* shopMenu(g);
  }
}

/** 00:09D4 — A on a chest (object type 1): the item C200 - 1 below 80 and its second flag
 *  (C780) clear: item 03:762A[C200 - 1] received (CE94, FF96 kept; 0B:6D63); unless story flag 01:
 *  the chest shown open (C280 = C330 = 78, sprite 01:5272 facing 0), for C200 >= 61 the flag
 *  0F:7C7E[C200 - 61] (0F:7C74), its second flag set (00:3CB8). Else the text 01:611D (mode 0C)
 *  and the window closed. */
function* chestOpened(g: Game): Co {
  const m = g.m;
  const b = (fget(m, "c200") - 1) & 0xff;
  if (b >= 0x80 || testFlag2(m, b)) {
    yield* far0(g, 0x01, () => printText(g, 0x0c, 0x611d, 0x0101, 0x0612));
    yield* windowClose(g);
    return;
  }
  pushBank(g, 0x03);
  const s = m.hram[0x16]!;
  m.wr(0xce94, m.rd((0x762a + b) & 0xffff));
  popBank(g);
  yield* farcall(g, 0x0b, () => itemGet(g));
  m.hram[0x16] = s;
  if (testFlag(m, 0x01)) return;
  fset(m, "c280", 0x78);
  fset(m, "c330", 0x78);
  objectSprite(m, 0);
  const a = fget(m, "c200");
  if (a >= 0x61) farSync(g, 0x0f, () => setFlag(m, m.rd((0x7c7e + ((a - 0x61) & 0xff)) & 0xffff)));
  setFlag2(m, (a - 1) & 0xff);
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
  if (m.rd(0xca2c)) yield* encounter(g);
  m.hram[0x16] = 0;
  yield* pendingEvents(g);
  yield* map01Push(g);
  if (!movingCell(g)) return;
  if (!m.rd(0xc6e3)) {
    // 00:07DC — on foot: the leader's tile base and kind back from C330 / C340, its sprite
    setSlot(m, 0);
    fset(m, "c280", fget(m, "c330"));
    fset(m, "c320", fget(m, "c340"));
    objectSprite(m, m.rd(0xc6ee));
    if (m.rd(0xc6e8) >= 0x0c && (yield* jumpB(g))) return; // 00:07FC — B: 01:47B2
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
  if (pressed() & 0x02) yield* leaveVehicleEvent(g); // 00:0861
  if (m.rd(0xc6ef)) return;
  if (pressed() & 0x08) yield* fieldMenu(g);
  if (pressed() & 0x04) yield* selectLeader(g);
}

/** 00:0851 — Select: sound 3C, the leader the next member (C6F3 turned left 2: the member order
 *  rotates), 00:01E7: in bank 0B the type of sprite 0B (00:04F7, with its 00:08AD frame), the
 *  leader's tiles (00:04B1), the sprite list by C6EE (01:5272), a frame (00:3A6B). */
function* selectLeader(g: Game): Co {
  const m = g.m;
  g.sfx(0x3c);
  const a = m.rd(0xc6f3);
  m.wr(0xc6f3, ((a << 2) | (a >> 6)) & 0xff);
  pushBank(g, 0x0b);
  yield* spriteType(g, 0x0b); // (pops the bank)
  yield* leaderTiles(g);
  objectSprite(m, m.rd(0xc6ee));
  yield* g.wait(1);
}

/** 00:0265 — the field loop. */
export function* fieldLoop(g: Game): Co {
  const m = g.m;
  for (;;) {
    m.wr(0xca0e, 0);
    yield* fieldStep(g);
    yield* g.point(0x026c); // the step's work (a new map row hblank-paced) takes CPU time
    companionFollow(m);
    objectsUpdate(g);
    // the objects' drawing (00:01A0) takes CPU time: it starts at 00:0272, its VRAM writes land on
    // the way and the OAM buffer is complete at its end (00:0275), which a vblank DMA may come before
    yield* g.point(0x0272);
    const drawn = g.pointTime(0x0275);
    g.vramUntil(drawn, () => drawObjects(g), true, true, () => g.objectsOam);
    yield* g.untilTime(drawn);
    yield* wait1(g);
    // the map animation's copies are hblank-paced (a strip scroll a byte an hblank, its own sync
    // point 01:5783): the loop goes on when the original's did (00:027B), the other VRAM writes
    // landing on the way
    const end = g.pointTime(0x027b);
    const t = g.vramUntil(end, () => mapAnimation(g));
    yield* g.untilTime(t);
  }
}
