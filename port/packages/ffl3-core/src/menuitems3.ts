/** Legend III field menu items 3, 5 and 6 (09:4377 / 09:43B1 / 09:43F0, from the item table
 *  09:4034), run with bank 09 selected from 09:401F:
 *   - item 3, a member's status: the member choice 09:413F, the box 09:4396 (text 09:6F67) drawn
 *     (09:4FEF) until A or B (0F:7A2C), again until the choice is cancelled;
 *   - item 5, the auto-battle mark: a member chosen (09:4160; not the leader, CD35 = 1) has its
 *     C500 bit 7 toggled (unless a status 1-2, 00:29EF) and its status word set again (09:4593);
 *   - item 6, the save: the game kept in SRAM slot 3 (09:4DE8), the three save slots' leaders
 *     loaded into members 0-2 (09:4494) for the boxes 09:44E2, then the slot choice: A saves
 *     (asking first over a used slot), B leaves; the game is taken back from slot 3 (09:4E0C).
 *  SRAM: 4 slots of 2D8 bytes at A000 + 2D8 k (the magic C6 62 83 (09:4DE5), the checksum of the
 *  2D2 bytes C500-C7D1 (09:4EFA: the 8-bit sum, then the 16-bit count of its carries), then those
 *  bytes), each kept twice (the copy at + B60); BFFA-BFFC count the repairs. The SRAM is enabled
 *  by 09:4ECE (6000 = 1, 4000 = 0, 0000 = 0A) and disabled by 09:4EDF (6000 = 1, 0000 = 0). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, copyB, copyBC, fill, farcall, farSync, soundBuzz, memberOffset } from "./sys.js";
import { NotPorted } from "./irq.js";
import { menuInput } from "./title.js";
import { drawMenu } from "./menu.js";
import { entityOffset } from "./bstats.js";
import { memberTiles, partySprites } from "./sprites.js";
import { chooseMember, chooseTarget, oamHold, waitAB } from "./menuitems.js";
import { statusIndex, recordBit7, statusWordSet } from "./fieldmenu.js";

// ---------------------------------------------------------------- item 3: the status

/** 09:4377 — menu item 3, a member's status: a member chosen (09:413F; cancelled: CD15 = 3), the
 *  objects hidden (0F:7D97), the box 09:4396 (9 bytes: (1,1) 18 x 16, text 09:6F67, and the end)
 *  -> C8B0 (00:1F7B), drawn (09:4FEF), A or B (0F:7A2C); again. */
export function* menuItem3(g: Game): Co {
  const m = g.m;
  for (;;) {
    const a = yield* chooseMember(g);
    if (a === 0xff) break;
    farSync(g, 0x0f, () => oamHold(g));
    copy(m, 0x4396, 0xc8b0, 9);
    yield* drawMenu(g);
    yield* farcall(g, 0x0f, () => waitAB(g));
  }
  m.wr(0xcd15, 0x03);
}

// ---------------------------------------------------------------- item 5: the auto-battle mark

/** 09:43B1 — menu item 5: CD35 = CD15 = 1 (the leader cannot be chosen), CD36 = FE, the cursor
 *  (38, 10); then a member chosen (09:4160) until cancelled: its status index (00:29EF) none or
 *  3 and above: C500 + its record (0F:7DB4) bit 7 toggled; its status word (09:4593); CD36 = FE.
 *  Cancelled: CD35 = 0, CD15 = 5. */
export function* menuItem5(g: Game): Co {
  const m = g.m;
  m.wr(0xcd35, 0x01);
  m.wr(0xcd15, 0x01);
  m.wr(0xcd36, 0xfe);
  m.wr(0xc080, 0x38);
  m.wr(0xc081, 0x10);
  for (;;) {
    const a = yield* chooseTarget(g);
    if (a === 0xff) break;
    const [e] = statusIndex(m, a);
    if (!e || e >= 0x03) {
      // 0F:7DB4 leaves hl = C500 + the record of CD36 (00:1FC4)
      const hl = farSync(g, 0x0f, () => {
        recordBit7(m);
        return (entityOffset(m) + 0xc500) & 0xffff;
      });
      m.wr(hl, m.rd(hl) ^ 0x80);
    }
    statusWordSet(g);
    m.wr(0xcd36, 0xfe);
  }
  m.wr(0xcd35, 0);
  m.wr(0xcd15, 0x05);
}

// ---------------------------------------------------------------- SRAM

/** 09:4ECE — SRAM on: 6000 = 1, 4000 = 0 (RAM bank 0), 0000 = 0A. */
function sramOn(m: Memory): void {
  m.wr(0x6000, 0x01);
  m.wr(0x4000, 0x00);
  m.wr(0x0000, 0x0a);
}

/** 09:4EDF — SRAM off: 6000 = 1, 0000 = 0. */
function sramOff(m: Memory): void {
  m.wr(0x6000, 0x01);
  m.wr(0x0000, 0x00);
}

/** 09:4EC1 — hl = the SRAM slot a: A000 + 2D8 a. */
const slotAt = (a: number): number => (0xa000 + 0x02d8 * a) & 0xffff;

/** 09:4FE2 — bc bytes at de and hl the same? (z) */
function same(m: Memory, de: number, hl: number, bc: number): boolean {
  for (let i = 0; i < bc; i++) {
    if (m.rd((de + i) & 0xffff) !== m.rd((hl + i) & 0xffff)) return false;
  }
  return true;
}

/** 09:4EFA — the checksum of the 2D2 bytes at hl: C880 = their sum (8 bits), C881/C882 = the
 *  count of its carries (16 bits). */
function checksum(m: Memory, hl: number): void {
  let a = 0, de = 0;
  for (let i = 0; i < 0x02d2; i++) {
    a += m.rd((hl + i) & 0xffff);
    if (a > 0xff) {
      a &= 0xff;
      de = (de + 1) & 0xffff;
    }
  }
  m.wr(0xc880, a);
  m.wr(0xc881, de & 0xff);
  m.wr(0xc882, de >> 8);
}

/** 09:4EEC — the checksum (09:4EFA) of hl: in page C5 as it is, else with the SRAM on (09:4ECE /
 *  09:4EDF). */
function checksumAt(m: Memory, hl: number): void {
  if (hl >> 8 === 0xc5) { checksum(m, hl); return; }
  sramOn(m);
  checksum(m, hl);
  sramOff(m);
}

/** 09:4E91 — the slot copy at hl valid? (z): the magic 09:4DE5 (3 bytes), then the checksum of
 *  hl + 6 (09:4EEC -> C880) equal to the 3 bytes at hl + 3. */
function slotValid(m: Memory, hl: number): boolean {
  sramOn(m);
  const ok = same(m, 0x4de5, hl, 3);
  sramOff(m);
  if (!ok) return false;
  checksumAt(m, (hl + 6) & 0xffff);
  sramOn(m);
  const r = same(m, 0xc880, (hl + 3) & 0xffff, 3);
  sramOff(m);
  return r;
}

/** 09:4E3B — a repair counted: BFFA, BFFB, BFFC + 1 (SRAM on / off). */
function repairCount(m: Memory): void {
  sramOn(m);
  for (let p = 0xbffa; p <= 0xbffc; p++) m.wr(p, m.rd(p) + 1);
  sramOff(m);
}

/** 09:4F70 — the slot copy hl the same as de (one of them in page C5: the slot's magic, its
 *  checksum against that of C500 (09:4EEC) and the 2D2 bytes C500..; neither: the 2D8 bytes, SRAM
 *  on)? (z) */
function slotSame(m: Memory, hl: number, de: number): boolean {
  if (de >> 8 !== 0xc5) {
    [hl, de] = [de, hl];
    if (de >> 8 !== 0xc5) {
      sramOn(m);
      const r = same(m, de, hl, 0x02d8);
      sramOff(m);
      return r;
    }
  }
  // 09:4F88 (hl the slot)
  sramOn(m);
  const ok = same(m, 0x4de5, hl, 3);
  sramOff(m);
  if (!ok) return false;
  hl = (hl + 3) & 0xffff;
  checksumAt(m, 0xc500);
  sramOn(m);
  if (!same(m, 0xc880, hl, 3)) { sramOff(m); return false; }
  const r = same(m, 0xc500, (hl + 3) & 0xffff, 0x02d2);
  sramOff(m);
  return r;
}

/** 09:4F58 — 09:4F70 tried up to 2 times until it holds once (bc = 0201); z when it did. */
function verify(m: Memory, hl: number, de: number): boolean {
  let b = 0x02, c = 0x01;
  for (;;) {
    if (slotSame(m, hl, de)) {
      c--;
      if (!c) return true;
    } else {
      b--;
      if (!b) return false;
    }
  }
}

/** 09:4FD3 — the 60 bytes at hl + 6 the same as de (SRAM on / off)? (z) */
function leaderSame(m: Memory, hl: number, de: number): boolean {
  sramOn(m);
  const r = same(m, de, (hl + 6) & 0xffff, 0x60);
  sramOff(m);
  return r;
}

/** 09:4FBB — 09:4FD3 tried up to 2 times until it holds once; z when it did. */
function leaderVerify(m: Memory, hl: number, de: number): boolean {
  let b = 0x02, c = 0x01;
  for (;;) {
    if (leaderSame(m, hl, de)) {
      c--;
      if (!c) return true;
    } else {
      b--;
      if (!b) return false;
    }
  }
}

/** The original retries these loops until the check holds; the model's memory is deterministic,
 *  so a second failure means the original hangs there. */
function retry(at: string, n: number): void {
  if (n >= 2) throw new NotPorted(`${at} (the check never holds: the original loops forever)`);
}

/** 09:4F18 — the game written to the slot copy de (SRAM on): the magic 09:4DE5 (00:1F8D), the
 *  checksum of C500 (09:4EEC -> C880) and its 3 bytes, the 2D2 bytes C500.. (00:1FB1); SRAM off. */
function slotWrite(m: Memory, de: number): void {
  sramOn(m);
  [, de] = copy(m, 0x4de5, de, 3);
  checksumAt(m, 0xc500);
  [, de] = copy(m, 0xc880, de, 3);
  copyBC(m, 0xc500, de, 0x02d2);
  sramOff(m);
}

/** 09:4DFA — the game written to the slot copy hl (09:4F18) until it checks (09:4F58 with
 *  C500). */
function slotSave(m: Memory, hl: number): void {
  for (let n = 0; ; n++) {
    retry("09:4DFA", n);
    slotWrite(m, hl);
    if (verify(m, hl, 0xc500)) return;
  }
}

/** 09:4DE8 — the game saved to slot a: both copies (A000 + 2D8 a and + B60; 09:4DFA). */
function saveSlot(m: Memory, a: number): void {
  let hl = slotAt(a);
  for (let b = 0x02; b; b--) {
    slotSave(m, hl);
    hl = (hl + 0x0b60) & 0xffff;
  }
}

/** 09:4E4E — slot a checked (09:4E91): neither copy valid: false (nz); one copy valid, the other
 *  not: a repair counted (09:4E3B); the valid copy (the first when both are) copied over the other
 *  (2D8 bytes, SRAM on, 00:1FB1) until they match (09:4F58). Returns [z, hl] (hl the valid copy;
 *  the second copy when neither is). */
function slotCheck(m: Memory, a: number): [boolean, number] {
  let hl = slotAt(a);
  let de: number;
  if (slotValid(m, hl)) {
    if (!slotValid(m, (hl + 0x0b60) & 0xffff)) repairCount(m);
    de = 0x0b60;
  } else {
    hl = (hl + 0x0b60) & 0xffff;
    if (!slotValid(m, hl)) return [false, hl];
    repairCount(m);
    de = 0xf4a0;
  }
  de = (hl + de) & 0xffff;
  for (let n = 0; ; n++) {
    retry("09:4E77", n);
    sramOn(m);
    copyBC(m, hl, de, 0x02d8);
    sramOff(m);
    if (verify(m, hl, de)) return [true, hl];
  }
}

/** 09:4E0C — the game loaded from slot a: checked (09:4E4E, again while it fails), then its 2D2
 *  bytes -> C500 (09:4F39: hl + 6, SRAM on, 00:1FB1) until they check (09:4F58). */
function loadSlot(m: Memory, a: number): void {
  const [z, hl] = slotCheck(m, a);
  if (!z) throw new NotPorted("09:4E0C (slot never valid: the original loops forever)");
  for (let n = 0; ; n++) {
    retry("09:4E14", n);
    sramOn(m);
    copyBC(m, (hl + 6) & 0xffff, 0xc500, 0x02d2);
    sramOff(m);
    if (verify(m, hl, 0xc500)) return;
  }
}

/** 09:4E24 — the leader of slot a (its first 60 bytes, 09:4F4B: hl + 6, SRAM on, 00:1F97) -> de
 *  until they match (09:4FBB); false (nz) when the slot is not valid (09:4E4E). */
function slotLeader(m: Memory, a: number, de: number): boolean {
  const [z, hl] = slotCheck(m, a);
  if (!z) return false;
  for (let n = 0; ; n++) {
    retry("09:4E2A", n);
    sramOn(m);
    copyB(m, (hl + 6) & 0xffff, de, 0x60);
    sramOff(m);
    if (leaderVerify(m, hl, de)) return true;
  }
}

// ---------------------------------------------------------------- item 6: the save

/** 09:4127 — di; the walking figures (00:21A9) with the frame counter FF93; reti. */
function* figures(g: Game): Co {
  g.ime = false;
  partySprites(g, g.m.hram[0x13]!);
  yield* g.reti();
}

/** 09:4494 — the three save slots k = 0-2 shown as members k: the slot's leader (09:4E24) ->
 *  C500 + the record of k (00:1FCD), its sprite tiles (0B:7DCA with a = 1: 0B:7E17, C50D + the
 *  record) -> 8140 + 40 k; an invalid slot: C503 + the record = FF. Then the walking figures
 *  (09:4127). Returns true (z) when all three are empty (C503 & C563 & C5C3 = FF). */
function* slotsShow(g: Game): Co<boolean> {
  const m = g.m;
  for (let b = 0x03; b; b--) {
    const k = (0x03 - b) & 0xff;
    const hl = (memberOffset(m, k) + 0xc500) & 0xffff;
    if (!slotLeader(m, k, hl)) {
      m.wr((hl + 0x03) & 0xffff, 0xff);
      continue;
    }
    const rec = (hl + 0x0d) & 0xffff;
    const de = (0x8140 + ((((k << 4) | (k >> 4)) & 0xff) << 2)) & 0xffff;
    yield* farcall(g, 0x0b, () => memberTiles(g, 0x01, rec, de));
  }
  yield* figures(g);
  return (((m.rd(0xc503) & m.rd(0xc563) & m.rd(0xc5c3)) + 1) & 0xff) === 0;
}

/** 09:495E — CD25 = 1 (the next 09:44E2 draws the slot boxes in the fixed order). */
function slotsWrapped(m: Memory): void {
  m.wr(0xcd25, 0x01);
}

/** 09:44E2 — the save boxes: the head box 09:4557 (7 bytes) -> C8B0 with the text 09:4551[a]
 *  (0: 09:6E09, 1: 09:6E74 (the slot is used), 2: 09:71F6); then the slot boxes 09:455E (slot 0,
 *  text 6E2F), 09:4565 (slot 1, 6E46), 09:456C (slot 2, 6E5D): CD25 set: CD25 - 1, the order
 *  4565, 455E, 456C; else by CD15: 0: 456C, 4565, 455E; 1: 456C, 455E, 4565 (00:1F6C, 14
 *  bytes); 2 and above: 455E, 4565, 456C (00:1F97, 21 bytes); the end (0, 0); drawn (09:4FEF). */
function* saveBoxes(g: Game, a: number): Co {
  const m = g.m;
  let [, de] = copy(m, 0x4557, 0xc8b0, 7);
  const p = (0x4551 + ((a * 2) & 0xff)) & 0xffff;
  m.wr(0xc8b4, m.rd(p));
  m.wr(0xc8b5, m.rd((p + 1) & 0xffff));
  const n = m.rd(0xcd25);
  if (n) {
    m.wr(0xcd25, (n - 1) & 0xff);
    [, de] = copy(m, 0x4565, de, 7);
    [, de] = copy(m, 0x455e, de, 7);
    [, de] = copy(m, 0x456c, de, 7);
  } else {
    const c = m.rd(0xcd15);
    if (c < 0x01) {
      [, de] = copy(m, 0x456c, de, 7);
      [, de] = copy(m, 0x4565, de, 7);
      [, de] = copy(m, 0x455e, de, 7);
    } else if (c === 0x01) {
      [, de] = copy(m, 0x456c, de, 7);
      [, de] = copy(m, 0x455e, de, 14);
    } else {
      [, de] = copyB(m, 0x455e, de, 0x15);
    }
  }
  m.wr(de, 0);
  m.wr((de + 1) & 0xffff, 0);
  yield* drawMenu(g);
}

/** 09:4473 — the slot cursor: CD15 = a, C080 = 48 + 20 a (swap a, add a, add 48), the boxes with
 *  CD26 (09:44E2). */
function* slotCursor(g: Game, a: number): Co {
  const m = g.m;
  m.wr(0xcd15, a);
  m.wr(0xc080, ((((a << 4) | (a >> 4)) & 0xff) * 2 + 0x48) & 0xff);
  yield* saveBoxes(g, m.rd(0xcd26));
}

/** 09:442F — CD15 = 6, the menu input left (00:1E79). (The slot loads and saves before it take
 *  frames of CPU time; the menu rows' sync points after it, 09:504F / 09:5044, re-time them.) */
function saveLeave(m: Memory): boolean {
  m.wr(0xcd15, 0x06);
  return true;
}

/** 09:4437 — A on the slot CD15: used (C503 + its record not FF): the boxes with the question
 *  (09:44E2, a = 1) and A or B (0F:7A2C): B: the boxes again (a = 0) and back to the input;
 *  then (09:4451) the game back from slot 3 (09:4E0C), saved to the slot CD15 (09:4DE8), left
 *  (09:442F). */
function* saveA(g: Game): Co<boolean> {
  const m = g.m;
  const rec = (memberOffset(m, m.rd(0xcd15)) + 0xc503) & 0xffff;
  if (m.rd(rec) !== 0xff) {
    yield* saveBoxes(g, 0x01);
    const a = yield* farcall(g, 0x0f, () => waitAB(g));
    if (!(a & 0x01)) {
      yield* saveBoxes(g, 0x00);
      return false;
    }
  }
  loadSlot(m, 0x03);
  saveSlot(m, m.rd(0xcd15));
  return saveLeave(m);
}

/** 09:43F0 — menu item 6, the save: CD3C = 1 (the slot boxes and figures), the game kept in slot
 *  3 (09:4DE8), the objects hidden (0F:7D97), the slots shown (09:4494); all empty: BFFA-BFFF
 *  cleared (SRAM on, 00:1F53, SRAM off). The cursor (48, 10), CD15 = 0, the boxes (09:44E2, a =
 *  0), then the menu input (00:1E51): A 09:4437, B 09:445E (the game back from slot 3, 09:4E0C;
 *  left, 09:442F), Select / Start / Right / Left the buzzer (00:1E83), Up 09:4465 (CD15 - 1; from
 *  0: 09:495E and 2), Down 09:4484 (CD15 + 1; from 2: 09:495E and 0), both through 09:4473. */
export function* menuItem6(g: Game): Co {
  const m = g.m;
  m.wr(0xcd3c, 0x01);
  saveSlot(m, 0x03);
  farSync(g, 0x0f, () => oamHold(g));
  if (yield* slotsShow(g)) {
    sramOn(m);
    fill(m, 0xbffa, 6, 0x00);
    sramOff(m);
  }
  m.wr(0xc080, 0x48);
  m.wr(0xc081, 0x10);
  m.wr(0xcd15, 0x00);
  yield* saveBoxes(g, 0x00);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: return yield* saveA(g);
      case 1: // 09:445E
        loadSlot(m, 0x03);
        return saveLeave(m);
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
      default: yield* soundBuzz(g); return false; // 2-5: 00:1E83
    }
  });
}
