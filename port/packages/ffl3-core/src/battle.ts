/** Legend III battles: the event (00:19D0, event type 1B), the battle set-up (00:1126, 00:1D62,
 *  0B:6CEE, 0B:4000) and its screens. The battle itself runs as a script of bank 0B read by the
 *  interpreter 0C:4000; effects go through 02:4394. */
import type { Game, Co } from "./game.js";
import { pushBank, popBank, farSync, farcall, fill, fillBC, copyB, vramCopy, bracketEnter, bracketLeave, fadeIn } from "./sys.js";
import { NotPorted, scroll } from "./irq.js";
import type { Memory } from "./memory.js";
import { random, multiply } from "./math.js";
import { layout, mapPatches, loadTiles, drawView } from "./mapload.js";
import { drawObjects } from "./actors.js";
import { battleWipe } from "./wipe.js";
import { mul16, levelValues } from "./names.js";
import { div32 } from "./equip.js";
import { oamHideAll, testFlag } from "./objects.js";
import { battleEntities } from "./benemy.js";
import { formationLayout, monsterPictures, monsterMaps, FORMATION_LAYOUT_SP } from "./bpics.js";
import { battleEffect } from "./banim.js";
import { memberTiles } from "./sprites.js";
import { battleScript, nativeRoutines, battleStack } from "./bscript.js";
import { windowsAll } from "./bmenu.js";

// ---------------------------------------------------------------- small helpers

/** 00:3A60 — a sound tick from the code: bank 0F (rst $20, its reti turns the interrupts on), di,
 *  0F:4006, bank back (rst $28). */
export function* soundMain(g: Game): Co {
  yield* g.sfxWritten();
  pushBank(g, 0x0f);
  yield* g.reti();
  g.ime = false;
  g.hooks.soundTick?.(g);
  popBank(g);
  yield* g.reti();
}

/** rst $30 (00:38D4) — a far call through the trampoline C0B2 (jp C0B4:C0B3, written by the
 *  caller) with bank `bank`. */
export function* rst30<T>(g: Game, bank: number, addr: number, fn: () => Co<T>): Co<T> {
  const m = g.m;
  m.wr(0xc0b3, addr & 0xff);
  m.wr(0xc0b4, addr >> 8);
  pushBank(g, bank);
  m.wr(0xc0b2, 0xc3);
  const r = yield* fn();
  popBank(g);
  return r;
}

/** 0B:4049 — battle effect a (DE00) through 02:4394. */
function* effect(g: Game, a: number): Co {
  g.m.wr(0xde00, a);
  yield* rst30(g, 0x02, 0x4394, () => battleEffect(g));
}

// ---------------------------------------------------------------- the event

/** 00:10D7 — before a battle: the music kept (FFA0 = FFBA, FFBA = 0), a sound tick; 00:10E1:
 *  sound effect 36, a sound tick (story flag 31: the battle wipe 01:5EB8). */
function* battleSounds(g: Game): Co {
  const m = g.m;
  yield* g.point(0x10dc); // (the code before takes CPU time; the tick right after must see it)
  m.hram[0x20] = m.hram[0x3a]!;
  m.hram[0x3a] = 0;
  yield* soundMain(g);
  pushBank(g, 0x01);
  g.sfx(0x36);
  yield* soundMain(g);
  if (testFlag(m, 0x31)) yield* battleWipe(g);
  popBank(g);
}

/** 00:19D0 — event 1B: a battle with formation CA28 (FF: from the zone, 00:10F5); objects hidden,
 *  a frame, bank 01, the sounds, the battle (00:1126); after it (story flag 31) the map back. */
export function* battleEvent(g: Game): Co {
  const m = g.m;
  oamHideAll(m);
  yield* g.wait(1);
  pushBank(g, 0x01);
  yield* battleSounds(g);
  const f = m.rd(0xca28);
  if (f === 0xff) { // 00:19EE
    m.wr(0xca2d, 0);
    yield* battle(g, zoneFormation(g, 0));
  } else {
    m.hram[0x4a] = f | 0x80;
    yield* battle(g, f | 0x80);
  }
  if (testFlag(m, 0x31)) yield* afterBattle(g);
  popBank(g);
}

/** 00:10C2 — a random encounter (CA2C set by a step): bank 01, the sounds (00:10D7), the
 *  formation of zone CA2D (00:10F5), the battle (00:1126), the map back (00:1151). */
export function* encounter(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x01);
  yield* battleSounds(g);
  const l = zoneFormation(g, m.rd(0xca2d));
  battleStack.shallower = 0x1e;
  try { yield* battle(g, l); } finally { battleStack.shallower = 0; }
  yield* afterBattle(g);
  popBank(g);
}

/** 00:1186 — the zone row: e + 1 in vehicle 1 or 4 and above, + 2 in vehicle 2. */
function zoneRow(m: Memory, e: number): number {
  const v = m.rd(0xc6e3);
  if (v === 0x01 || v >= 0x04) return (e + 1) & 0xff;
  if (v === 0x02) return (e + 2) & 0xff;
  return e;
}

/** 00:10F5 — the formation of zone a (bank 03): its row (00:1186) of 7 formations at 03:76C2,
 *  the column the first of the 6 thresholds 03:76BC a random byte (00:39D5) is not below (6: none
 *  is); FFCA = the formation, returned (l). */
function zoneFormation(g: Game, a: number): number {
  const m = g.m;
  pushBank(g, 0x03);
  const e = zoneRow(m, a);
  const hl = (0x76c2 + multiply(0x0007, e).de) & 0xffff;
  const r = random(m);
  let c = 0;
  for (let p = 0x76bc, b = 6; b; b--, p++, c++) if (r >= m.rd(p)) break;
  const l = m.rd((hl + c) & 0xffff);
  m.hram[0x4a] = l;
  popBank(g);
  return l;
}

/** 00:1151 — the map back after a battle: FFBA = 0, CA2C = 0, the layout (bank 07 / 08 by CA15,
 *  00:0F42), the flag patches (0B:78F5), the music FFBA = FFA0, the tiles (00:0150), the view
 *  (00:0E34), the objects (00:01A0), the scroll (00:3D2B), fade in (00:3A0C). */
function* afterBattle(g: Game): Co {
  const m = g.m;
  g.atPoint(0x1152, () => { m.hram[0x3a] = 0; });
  m.wr(0xca2c, 0);
  layout(g);
  farSync(g, 0x0b, () => mapPatches(g));
  const mu = m.hram[0x20]!;
  g.atPoint(0x1175, () => { m.hram[0x3a] = mu; });
  yield* bracketEnter(g);
  yield* loadTiles(g);
  yield* bracketLeave(g);
  yield* drawView(g);
  drawObjects(g);
  scroll(m);
  yield* fadeIn(g);
}

/** 00:1126 — battle l (formation l & 7F: 0B:758B + 5 l -> CC59), CA14 set meanwhile; again with
 *  FFCA while CEDA = FF. */
export function* battle(g: Game, l: number): Co {
  const m = g.m;
  for (;;) {
    m.wr(0xca14, 1);
    const k = l & 0x7f;
    pushBank(g, 0x0b);
    copyB(m, (0x758b + 5 * k) & 0xffff, 0xcc59, 5);
    popBank(g);
    yield* battleRun(g);
    l = m.hram[0x4a]!;
    if (m.rd(0xceda) !== 0xff) break;
  }
  m.wr(0xca14, 0);
}

/** 00:1D62 — the screen (0B:6CEE), the battle (0B:4000), the bracket left. */
function* battleRun(g: Game): Co {
  yield* farcall(g, 0x0b, () => battleScreen(g));
  yield* farcall(g, 0x0b, () => battleMain(g));
  yield* bracketLeave(g);
}

// ---------------------------------------------------------------- the screen

/** 0B:6CEE — the bracket, CE88 = 0, the windows (0B:5BDF, bmenu.ts), the background blank (0B:6C76),
 *  objects hidden, SCX 0, SCY 40. */
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

// ---------------------------------------------------------------- the battle

/** 0B:4000 — the battle: music (CC5C bits 4-5) + 1, the screen (0B:405A), the entities
 *  (0B:4444), the map state C6E0 -> DD00 (0F:7DBE), the bracket left, DDFF = 4 (D203 = FF) or 5,
 *  the members' battle figures (0C:6001), effect 15, the opening slide (0B:780A), the battle
 *  script 0B:4A2D (0C:4000), effect 16. */
function* battleMain(g: Game): Co {
  const m = g.m;
  const mu = ((m.rd(0xcc5c) >> 4) & 0x03) + 1;
  g.atPoint(0x0b4008, () => { m.hram[0x3a] = mu; });
  yield* battleBackdrop(g);
  battleEntities(g);
  farSync(g, 0x0f, () => copyB(m, 0xc6e0, 0xdd00, 0x60));
  yield* bracketLeave(g);
  m.wr(0xddff, m.rd(0xd203) === 0xff ? 4 : 5);
  yield* rst30(g, 0x0c, 0x6001, function* () { yield* figures(g); });
  yield* effect(g, 0x15);
  yield* openingSlide(g);
  yield* rst30(g, 0x0c, 0x4000, () => battleScript(g, 0x4a2d));
  yield* effect(g, 0x16);
}

/** 0B:405A — 9800 blank (0x400, 0F:792C), the bracket, the formation (0B:5A18), the monster
 *  pictures (0B:40BF), D800 -> 9000 (0x7C0), D000 blank (0x400), the group maps (0B:4205), D000 ->
 *  9800 (0x400). */
function* battleBackdrop(g: Game): Co {
  const m = g.m;
  farSync(g, 0x0f, () => { fill(m, 0x9800, 0x0400, 0xff); });
  yield* bracketEnter(g);
  formationLayout(g, FORMATION_LAYOUT_SP + battleStack.shallower);
  monsterPictures(g);
  vramCopy(m, 0xd800, 0x9000, 0x07c0);
  fillBC(m, 0xd000, 0x0400, 0xff);
  monsterMaps(g);
  vramCopy(m, 0xd000, 0x9800, 0x0400);
}

/** 0C:6001 — the members' battle figures: 4 (D203 bit 7) or 5 records (D00D + 0x80 k), their
 *  tiles (0B:7DCA with a = 2) to 86C0 + 0x40 k; then effect 17 (0C:6B6E). */
function* figures(g: Game): Co {
  const m = g.m;
  const n = m.rd(0xd203) & 0x80 ? 4 : 5;
  let hl = 0xd00d, de = 0x86c0;
  for (let k = 0; k < n; k++) {
    const h = hl, d = de;
    yield* farcall(g, 0x0b, () => memberTiles(g, 2, h, d));
    de = (de + 0x40) & 0xffff;
    hl = (hl + 0x80) & 0xffff;
  }
  m.wr(0xde00, 0x17);
  yield* rst30(g, 0x02, 0x4394, () => battleEffect(g));
}

// ---------------------------------------------------------------- the opening slide

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

/** 0B:7886 — (DE40 set) the upper half moves down a line (SCY of lines 1F..1 from the line above,
 *  pulled toward 40; a 0 clears the pair below it), the lower half up (lines 20..3E from below,
 *  toward 40); DE40 = DEBE = 40; then the bend again from the first SCY 0 (when found). */
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


nativeRoutines.set(0x6001, (g) => figures(g));

// small bank-0C natives (0C:6B3E-6B6A)
/** 0C:6B67 — nothing (ret). */
nativeRoutines.set(0x6b67, function* () { /* ret */ });
/** 0C:6B68 — battle effect 11 (0C:6B6E). */
nativeRoutines.set(0x6b68, function* (g) { g.m.wr(0xde00, 0x11); yield* rst30(g, 0x02, 0x4394, () => battleEffect(g)); });
/** 0C:6B3E — farcall 0B:6ED9 (as 00:1D74). */
nativeRoutines.set(0x6b3e, (g) => nativeRoutines.get(0x1d74)!(g));

/** 00:2499 as a battle script native (opcode 03): CD46-CD49 = CD48/CD49 x CD46/CD47. */
nativeRoutines.set(0x2499, function* (g) { mul16(g); });
/** 00:24C7 as a battle script native: CD46-CD49 / CD4A-CD4B (quotient CD46-CD49, remainder
 *  CD4A-CD4B). */
nativeRoutines.set(0x24c7, function* (g) { div32(g.m); });
/** 00:1E46 as a battle script native: the members' level values (farcall 0F:79D4). */
nativeRoutines.set(0x1e46, function* (g) { farSync(g, 0x0f, () => levelValues(g)); });
