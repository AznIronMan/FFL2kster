/** Legend III: Continue on the title and the rest of a saved game's start, with the event and map
 *  load pieces it reaches:
 *   - 09:4964, Continue: the three save slots shown (09:4494, as the save menu); none: back to
 *     the title's choice (a new game); else the slot choice (A loads the slot: 09:4E0C, B and the
 *     others buzz), then 01:7DC5 (the level values, the BG map blank, the bracket left);
 *   - 00:3D38, the STAT interrupt on (after the map load 00:027D of a saved game, 00:025C);
 *   - 00:1524 / 00:15F7, event 10 sub 7 (the map's objects again) / sub 8 (a member's status
 *     scene: the battle script 0C:5FC8 over the field);
 *   - 01:5F9D, the map load's fade in for CA6B = 2 (the wipe's start 01:6013, then a band
 *     opening line by line, LY polls);
 *   - 00:06D2, the follower object at C6E9-C6EC. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copyB, pushBank, popBank, farcall, farSync, fadeIn, fadeOut, windowOn, windowOff, soundBuzz, memberOffset,
  bracketEnter, bracketLeave, textEnd, fill } from "./sys.js";
import { menuInput } from "./title.js";
import { slotsShow, saveBoxes, slotCursor, slotsWrapped, loadSlot } from "./menuitems3.js";
import { oamClear, levelValues } from "./names.js";
import { windowClear } from "./newgame.js";
import { waitAB } from "./menuitems.js";
import { battleScript, battleStack } from "./bscript.js";
import { loadObjects, loadTiles, drawView, mapPatches } from "./mapload.js";
import { objectSprite } from "./actors.js";
import { fa, setSlot } from "./objects.js";
import { lastFreeSlot } from "./events2.js";
import { followerInit, relayout } from "./events.js";
import { wipeStart } from "./wipe.js";
import { soundMain } from "./battle.js";

// ---------------------------------------------------------------- Continue (09:4964)

/** 09:499C — A on the slot CD15: empty (C503 + its record (00:1FCD) FF): the buzzer (00:1E83,
 *  back to the input); else the game loaded from it (09:4E0C), fade out (00:39F3), CD3C = CD26 =
 *  0, the objects hidden (00:20CF), the menu left (00:1E79, z). */
function* continueA(g: Game): Co<boolean> {
  const m = g.m;
  const b = m.rd(0xcd15);
  const hl = (memberOffset(m, b) + 0xc503) & 0xffff;
  if (m.rd(hl) === 0xff) { yield* soundBuzz(g); return false; }
  loadSlot(m, b);
  yield* fadeOut(g);
  m.wr(0xcd3c, 0x00);
  m.wr(0xcd26, 0x00);
  oamClear(g);
  return true;
}

/** 09:4964 — Continue (bank 09 selected): the save slots shown as members 0-2 (09:4494); all
 *  empty: false (nz: `dec a` of 0). Else CD3C = 1, CD39 = 1, the cursor (48, 10), CD15 = 0, CD26
 *  = 2, the boxes (09:44E2 with a = 2: the text 09:71F6), fade in (00:3A0C), then the menu input
 *  (00:1E51): A 09:499C, B / Select / Start / Right / Left the buzzer (00:1E83), Up 09:4465
 *  (CD15 - 1; from 0: 09:495E and 2), Down 09:4484 (CD15 + 1; from 2: 09:495E and 0), both
 *  through 09:4473. Returns true (z) when a game was loaded (left by 00:1E79 after 00:20CF). */
export function* continueGame(g: Game): Co<boolean> {
  const m = g.m;
  if (yield* slotsShow(g)) return false;
  m.wr(0xcd3c, 0x01);
  m.wr(0xcd39, 0x01);
  m.wr(0xc080, 0x48);
  m.wr(0xc081, 0x10);
  m.wr(0xcd15, 0x00);
  m.wr(0xcd26, 0x02);
  yield* saveBoxes(g, 0x02);
  yield* fadeIn(g);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: return yield* continueA(g);
      case 6: { // 09:4465
        let a = m.rd(0xcd15);
        if (a) a = (a - 1) & 0xff;
        else {
          slotsWrapped(m);
          a = 0x02;
        }
        yield* slotCursor(g, a);
        return false;
      }
      case 7: { // 09:4484
        let a = m.rd(0xcd15);
        if (a !== 0x02) a = (a + 1) & 0xff;
        else {
          slotsWrapped(m);
          a = 0x00;
        }
        yield* slotCursor(g, a);
        return false;
      }
      default: yield* soundBuzz(g); return false; // 1-5: 00:1E83
    }
  });
  return true;
}

/** 01:7DC5 — a game loaded on the title (and the end of the names, 01:7DAE): the level values
 *  (00:1E46: 0F:79D4), the BG map 9800 blank (0B:6C76: 0F:792C, 0x800 bytes FF), window off
 *  (00:3A4B), WY 50, the objects hidden (00:20CF), the bracket left with CD3D (00:1DF3) and again
 *  (00:1DFD; its ret leaves the title). */
export function* gameLoaded(g: Game): Co {
  const m = g.m;
  farSync(g, 0x0f, () => levelValues(g));
  farSync(g, 0x0b, () => farSync(g, 0x0f, () => { fill(m, 0x9800, 0x0800, 0xff); }));
  yield* g.point(0x017dca); // after the 2 KiB fill (CPU time): WY 50 turns the frame work to the field
  windowOff(m);
  m.wr(0xff4a, 0x50);
  oamClear(g);
  yield* textEnd(g);
  yield* bracketLeave(g);
}

// ---------------------------------------------------------------- a saved game's start

/** 00:3D38 — the STAT interrupt enabled (IE | 02). */
export function statIrqOn(m: Memory): void {
  m.hram[0x7f] = m.hram[0x7f]! | 0x02;
}

// ---------------------------------------------------------------- event 10 sub 7 / sub 8

/** 00:1524 — event 10 7: the map's objects again (00:05BF with bank 06). */
export function objectsAgain(g: Game): void {
  pushBank(g, 0x06);
  loadObjects(g);
  popBank(g);
}

/** 00:16A4 (cd37 = 0) / 00:16A7 (cd37 = 1) — CD37 = cd37, C9D6 = the leader C6F3 >> 6; its record
 *  offset (00:1FCD: the field table, or the battle one with CD37 set). */
function leaderOffset(m: Memory, cd37: number): number {
  m.wr(0xcd37, cd37);
  const a = m.rd(0xc6f3) >> 6;
  m.wr(0xc9d6, a);
  return memberOffset(m, a);
}

/** 00:1691 — hl = C500 + the leader's field record (00:16A4), de = C500 + its battle record
 *  (00:16A7; CD37 left 1). */
function leaderRecords(m: Memory): [number, number] {
  const hl = (leaderOffset(m, 0x00) + 0xc500) & 0xffff;
  const de = (leaderOffset(m, 0x01) + 0xc500) & 0xffff;
  return [hl, de];
}

/** 00:0150 — the tiles (00:0427) in the bracket (00:1D9E / 00:1DFD). */
function* tilesBracketed(g: Game): Co {
  yield* bracketEnter(g);
  yield* loadTiles(g);
  yield* bracketLeave(g);
}

/** 00:15F7 — event 10 8, the leader's status scene: CDC4 = 1 (kept), sound 38, fade out, 16
 *  frames, fade in; the leader's record (0x60 bytes) copied to its battle record (00:1691,
 *  00:1F97); unless its kind (C50D + record, & 7) is 2: D881 = 2, D87E = its C503, D87F = its
 *  C50F, the window blank (01:7DFD), WY 8F, window on (00:3A44), CD37 = 1, the battle script
 *  0C:5FC8 (gosub 0C:59FF) with bank 0C (0C:4000); its battle record (0x59 bytes) back to the
 *  field record; with bank 01 the tiles (00:0150), slot 0 (00:01D7) facing C6EE = 80 (01:5272);
 *  CD3D = 1, A or B (0F:7A2C), window off, WY 50. Then CD37 = 0, the layout reloaded (00:174D),
 *  the flag patches (00:137C), CDC4 back. */
export function* statusScene(g: Game): Co {
  const m = g.m;
  const cdc4 = m.rd(0xcdc4);
  m.wr(0xcdc4, 0x01);
  m.hram[0x3c] = 0x38;
  yield* fadeOut(g);
  yield* g.wait(0x10);
  yield* fadeIn(g);
  let [hl, de] = leaderRecords(m);
  copyB(m, hl, de, 0x60);
  const off = leaderOffset(m, 0x00);
  if ((m.rd((0xc50d + off) & 0xffff) & 0x07) !== 0x02) {
    m.wr(0xd881, 0x02);
    m.wr(0xd87e, m.rd((0xc503 + leaderOffset(m, 0x00)) & 0xffff));
    m.wr(0xd87f, m.rd((0xc50f + leaderOffset(m, 0x00)) & 0xffff));
    farSync(g, 0x01, () => windowClear(g));
    m.wr(0xff4a, 0x8f);
    windowOn(m);
    m.wr(0xcd37, 0x01);
    pushBank(g, 0x0c);
    // the script runs 8 bytes shallower than in a battle from an event (00:19D0 -> 00:1126 ->
    // 00:1D62 -> 0B:4000 -> rst $30 -> C0B2: 12 bytes; here push af and the call: 4)
    battleStack.shallower = 0x08;
    try { yield* battleScript(g, 0x5fc8); } finally { battleStack.shallower = 0; }
    popBank(g);
    [hl, de] = leaderRecords(m);
    copyB(m, de, hl, 0x59);
    pushBank(g, 0x01);
    yield* tilesBracketed(g);
    setSlot(m, 0);
    m.wr(0xc6ee, 0x80);
    objectSprite(m, 0x80);
    popBank(g);
    m.wr(0xcd3d, 0x01);
    yield* farcall(g, 0x0f, () => waitAB(g));
    windowOff(m);
    m.wr(0xff4a, 0x50);
  }
  m.wr(0xcd37, 0x00);
  yield* relayout(g);
  farSync(g, 0x0b, () => mapPatches(g));
  m.wr(0xcdc4, cdc4);
}

// ---------------------------------------------------------------- the load's fade in (CA6B = 2)

/** 00:3A59 — the background off (LCDC bit 0). */
function bgOff(m: Memory): void {
  m.wr(0xff40, m.rd(0xff40) & 0xfe);
}
/** 00:3A52 — the background on (LCDC bit 0). */
function bgOn(m: Memory): void {
  m.wr(0xff40, m.rd(0xff40) | 0x01);
}

/** 01:5F9D — the map load's fade in for CA6B = 2 (from 00:03C5, bank 01): WY kept; the wipe's
 *  start (01:6013: the vectors `ret`, the view in the window map 9C00 shown at WX 57, blanked
 *  tile by tile); WX A2, SCX = FF91 + 54; b = 0, c = 8F, d = 4C; each frame from LY 0: WX - 1,
 *  SCX - 1, d - 1 (d 44 and below: b + 1, c - 1); at LY b (b = 46: done) window off, BGP 0, the
 *  background off; at LY c window on, the background on, the palettes CDB4-CDB6, a sound tick
 *  (00:3A60); until d is 0. Then the vectors back (00:3D4E / 00:3D62, no di/ei), the view
 *  (00:0E34), WY back, window off, WX 07. All of it polls LY (no frame waits). */
export function* loadFadeIn(g: Game): Co {
  const m = g.m;
  const wy = m.rd(0xff4a);
  yield* wipeStart(g);
  m.wr(0xff4b, 0xa2);
  m.wr(0xff43, (m.hram[0x11]! + 0x54) & 0xff);
  let b = 0x00, c = 0x8f, d = 0x4c;
  for (;;) {
    yield* g.untilLine(0);
    m.wr(0xff4b, (m.rd(0xff4b) - 1) & 0xff);
    m.wr(0xff43, (m.rd(0xff43) - 1) & 0xff);
    d = (d - 1) & 0xff;
    if (d <= 0x44) { b = (b + 1) & 0xff; c = (c - 1) & 0xff; }
    yield* g.untilLine(b);
    if (b === 0x46) break;
    windowOff(m);
    m.wr(0xff47, 0x00);
    bgOff(m);
    yield* g.untilLine(c);
    windowOn(m);
    bgOn(m);
    m.wr(0xff47, m.rd(0xcdb4));
    m.wr(0xff48, m.rd(0xcdb5));
    m.wr(0xff49, m.rd(0xcdb6));
    yield* soundMain(g);
    if (!d) break;
  }
  m.wr(0xc0b9, 0xc3);
  m.wr(0xc0bc, 0xc3);
  yield* drawView(g);
  m.wr(0xff4a, wy);
  windowOff(m);
  m.wr(0xff4b, 0x07);
}

// ---------------------------------------------------------------- the follower (00:06D2)

/** 00:06D2 — the follower object (from 00:06BE: walking, flag 82, on its map C6ED): the highest
 *  free slot (00:01DB) made the follower (00:1552), its target C290 = C6E9/C6EA + 50 (high byte
 *  & CA04) and position C210 the same, its target C2B0 = C6EB/C6EC + 50 (& CA05) and position
 *  C230 the same. */
export function followerObject(g: Game): void {
  const m = g.m;
  lastFreeSlot(m);
  followerInit(g);
  let s = m.rd(0xc6e9) + 0x50;
  const ty = fa(m, "c290");
  m.wr(ty, s & 0xff);
  m.wr(ty + 1, (m.rd(0xc6ea) + (s >> 8)) & m.rd(0xca04));
  const y = fa(m, "c210");
  m.wr(y, m.rd(ty));
  m.wr(y + 1, m.rd(ty + 1));
  s = m.rd(0xc6eb) + 0x50;
  const tx = fa(m, "c2b0");
  m.wr(tx, s & 0xff);
  m.wr(tx + 1, (m.rd(0xc6ec) + (s >> 8)) & m.rd(0xca05));
  const x = fa(m, "c230");
  m.wr(x, m.rd(tx));
  m.wr(x + 1, m.rd(tx + 1));
}
