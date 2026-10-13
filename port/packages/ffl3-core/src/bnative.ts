/** Legend III battle script natives of bank 0C (script opcode 03, bank 0C selected): copies
 *  between the script variables (page C9) and the battle records, the slot record helpers of the
 *  battle work area D000 (0x80 bytes a slot), bit counts and the battle message (0B:6FA1).
 *  Each is registered in `nativeRoutines` by its address. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { NotPorted } from "./irq.js";
import { nativeRoutines } from "./bscript.js";
import { copy, copyB, fill, pushBank, popBank, far0, far0Sync, farcall, farSync, wait1 } from "./sys.js";
import { printText, lineReset } from "./text.js";
import { boxFrame } from "./window.js";

/** The word at C9C2 (a pointer the script sets). */
const scriptPointer = (m: Memory): number => m.rd16(0xc9c2);

/** 0C:4BE8 — the slot record of C9D6 plus de: D000 + 0x80 C9D6 + de (h = D0 + C9D6 / 2, l = the
 *  low bit of C9D6 in bit 7; no RAM). */
function slotAddr(m: Memory, de: number): number {
  const a = m.rd(0xc9d6);
  const h = ((a >> 1) + 0xd0) & 0xff;
  const l = (a & 1) << 7;
  return (((h << 8) | l) + de) & 0xffff;
}

// ---------------------------------------------------------------- copies and counts

/** 0C:445F — the bit counts of CC5E, CC5F, CC60 -> D87B, D87C, D87D (each byte rotated left 8
 *  times in place, `rlc [hl]`, so it ends as it was). */
export function countBits(g: Game): void {
  const m = g.m;
  let hl = 0xcc5e, de = 0xd87b;
  for (let c = 3; c; c--) {
    let a = 0;
    for (let b = 8; b; b--) {
      const v = m.rd(hl);
      const r = ((v << 1) | (v >> 7)) & 0xff;
      m.wr(hl, r);
      a = (a + (v >> 7)) & 0xff;
    }
    m.wr(de, a);
    hl++; de++;
  }
}

/** 0C:4490 — 6 bytes from the pointer C9C2 -> C90A (00:1F84). */
export function loadC90A(g: Game): void {
  const m = g.m;
  copy(m, scriptPointer(m), 0xc90a, 6);
}

/** 0C:44AC — 8 bytes from the pointer C9C2 -> D83E (00:1F7E). */
export function loadD83E(g: Game): void {
  const m = g.m;
  copy(m, scriptPointer(m), 0xd83e, 8);
}

/** 0C:4865 — 8 bytes D83E -> the pointer C9C2 (00:1F7E). */
export function storeD83E(g: Game): void {
  const m = g.m;
  copy(m, 0xd83e, scriptPointer(m), 8);
}

/** 0C:49DB — the list of the set bits of the slot's bit field (slot record + 6A, MSB first) with
 *  index c from CE92 to CE93: each one's code 0C:7F33 + c -> D846.. (D86A = the count, set to 0
 *  first). */
export function slotBitList(g: Game): void {
  const m = g.m;
  let de = slotAddr(m, 0x006a);
  let hl = 0xd846;
  m.wr(0xd86a, 0);
  let c = 0, b = 0;
  let a = m.rd(de);
  for (;;) {
    // 49F7: rlca
    const bit = a >> 7;
    a = ((a << 1) | bit) & 0xff;
    if (bit && c >= m.rd(0xce92)) {
      m.wr(hl, m.rd((0x7f33 + c) & 0xffff));
      hl = (hl + 1) & 0xffff;
      m.wr(0xd86a, m.rd(0xd86a) + 1);
    }
    c = (c + 1) & 0xff;
    if (m.rd(0xce93) < c) return;
    b = (b + 1) & 0xff;
    if (!(b & 0x07)) {
      b = 0;
      de = (de + 1) & 0xffff;
      a = m.rd(de);
    }
  }
}

/** 0C:4B9F — the slot records to C500: 0x59 bytes of each slot (D000 + 0x80 k) -> C500 + 0x60 k,
 *  for 5 slots, or 4 when D203 is FF. */
export function slotsToC500(g: Game): void {
  const m = g.m;
  let hl = 0xd000, de = 0xc500;
  let c = m.rd(0xd203) === 0xff ? 4 : 5;
  for (; c; c--) {
    [hl, de] = copyB(m, hl, de, 0x59);
    hl = (hl + 0x27) & 0xffff;
    de = (de + 7) & 0xffff;
  }
}

/** 0C:4BF6 — unless the slot's byte +03 is FF: the 8 bytes at slot + 46..4D compared with the 8
 *  codes of 0C:4C23, a bit per match (c: set bit 0 on a match, then rotate right; 64 times) ->
 *  C997. */
export function slotCodeMatches(g: Game): void {
  const m = g.m;
  let hl = slotAddr(m, 0x0003);
  if (m.rd(hl) === 0xff) return;
  hl = (hl + 0x45) & 0xffff;
  let c = 0;
  for (let k = 8; k; k--) {
    hl = (hl + 1) & 0xffff;
    for (let i = 0; i < 8; i++) {
      if (m.rd(0x4c23 + i) === m.rd(hl)) c |= 0x01;
      c = ((c >> 1) | ((c & 1) << 7)) & 0xff;
    }
  }
  m.wr(0xc997, c);
}

/** 0C:4D41 — for 5 records of 4 bytes from CE00: bytes 0, 2, 3 -> D062 + 0x80 k (3 bytes; byte 1
 *  skipped). */
export function ce00ToSlots(g: Game): void {
  const m = g.m;
  let hl = 0xce00, de = 0xd062;
  for (let b = 5; b; b--) {
    m.wr(de, m.rd(hl));
    hl = (hl + 2) & 0xffff;
    de = (de + 1) & 0xffff;
    [hl, de] = copy(m, hl, de, 2);
    de = (de + 0x7d) & 0xffff;
  }
}

/** 0C:5DB6 — 7 bytes C9A5 -> the member record of C9D6 (table 0C:5DC7: C559, C5B9, C619, C679). */
export function storeC9A5(g: Game): void {
  const m = g.m;
  const hl = (0x5dc7 + ((m.rd(0xc9d6) * 2) & 0xff)) & 0xffff;
  copy(m, 0xc9a5, m.rd16(hl), 7);
}

/** 00:391B — the byte at hl in bank a (rst $20 / rst $28 around it). */
function bankByte(g: Game, a: number, hl: number): number {
  pushBank(g, a);
  const v = g.m.rd(hl);
  popBank(g);
  return v;
}

/** 0C:5F9D — the message pointer CE8D/CE8E = the word of entry C9BF of the table 09:78FE. */
export function messagePointer(g: Game): void {
  const m = g.m;
  const a = m.rd(0xc9bf);
  let hl = (0x78fe + a + a) & 0xffff;
  m.wr(0xce8d, bankByte(g, 0x09, hl));
  hl = (hl + 1) & 0xffff;
  m.wr(0xce8e, bankByte(g, 0x09, hl));
}

/** 0C:5FCC — D83E-D845 = FF (00:1F51). */
export function clearD83E(g: Game): void {
  fill(g.m, 0xd83e, 8, 0xff);
}

/** 0C:5FD3 — D86B-D872 = 19 (00:1F51). */
export function fillD86B(g: Game): void {
  fill(g.m, 0xd86b, 8, 0x19);
}

/** 0C:5FDB — 7 bytes of 07:7ADA + 0x60 (C9D6 + 1) -> C9A5 (00:1F97 with bank 7). */
export function loadC9A5(g: Game): void {
  const m = g.m;
  let hl = 0x7ada;
  let a = (m.rd(0xc9d6) + 1) & 0xff;
  do {
    hl = (hl + 0x60) & 0xffff;
    a = (a - 1) & 0xff;
  } while (a);
  far0Sync(g, 0x07, () => copyB(m, hl, 0xc9a5, 7));
}

/** 0C:5FF1 — D822-D82E and D82F-D83B = 80 (13 bytes each, 00:1F4C). */
export function fillD822(g: Game): void {
  const m = g.m;
  fill(m, 0xd822, 13, 0x80);
  fill(m, 0xd82f, 13, 0x80);
}

/** 0C:602B — C9D8 = the first slot whose byte +01 has neither bit 7 nor bit 6 set. */
export function firstClearSlot(g: Game): void {
  const m = g.m;
  let hl = 0xd001, a = 0;
  while (m.rd(hl) & 0xc0) {
    hl = (hl + 0x80) & 0xffff;
    a = (a + 1) & 0xff;
  }
  m.wr(0xc9d8, a);
}

/** 0C:6042 — C97E = how many of the DDFF slots (0 = 256) have bits 7-6 of byte +01 clear. */
export function countClearSlots(g: Game): void {
  const m = g.m;
  let b = m.rd(0xddff);
  let c = 0, hl = 0xd001;
  do {
    if (!(m.rd(hl) & 0xc0)) c = (c + 1) & 0xff;
    hl = (hl + 0x80) & 0xffff;
    b = (b - 1) & 0xff;
  } while (b);
  m.wr(0xc97e, c);
}

/** 0B:6EB6 — the bit range of [hl]: CE8F = 5 + its lowest set bit, CE90 = 5 + its highest (the
 *  original loops forever on 0). */
function bitRange(g: Game, hl: number): void {
  const m = g.m;
  let c = m.rd(hl);
  if (!c) throw new NotPorted("0B:6EB6 with a 0 byte (the original loops forever)");
  let a = 0xff;
  for (;;) {
    a = (a + 1) & 0xff;
    const bit = c & 1;
    c = ((c >> 1) | (bit << 7)) & 0xff;
    if (bit) break;
  }
  m.wr(0xce8f, (a + 5) & 0xff);
  c = m.rd(hl);
  a = 8;
  for (;;) {
    a = (a - 1) & 0xff;
    const bit = c >> 7;
    c = ((c << 1) | bit) & 0xff;
    if (bit) break;
  }
  m.wr(0xce90, (a + 5) & 0xff);
}

/** 0C:605D — CE84 = CC5E | CC5F | CC60, then its bit range CE8F/CE90 (0B:6EB6). */
export function targetRange(g: Game): void {
  const m = g.m;
  const a = m.rd(0xcc5e) | m.rd(0xcc5f) | m.rd(0xcc60);
  m.wr(0xce84, a);
  farSync(g, 0x0b, () => bitRange(g, 0xce84));
}

/** 0C:606D — when C919 & 7 is 4: 3 bytes D6BD -> the slot record + 3D (00:1F8D). */
export function storeD6BD(g: Game): void {
  const m = g.m;
  const hl = slotAddr(m, 0x003d);
  if ((m.rd(0xc919) & 0x07) !== 0x04) return;
  copy(m, 0xd6bd, hl, 3);
}

/** 0C:6083 — C940-C943 each at most 99 (0x63). */
export function clampC940(g: Game): void {
  const m = g.m;
  let hl = 0xc940;
  for (let b = 4; b; b--) {
    const a = m.rd(hl);
    m.wr(hl, a < 0x64 ? a : 0x63);
    hl++;
  }
}

/** 0C:6851 — entry C9FD of the 5-byte table 0C:681F: bytes 0-1 -> C97B/C97C, byte 2 -> C9FF,
 *  bytes 2-4 -> CE91-CE93 (the index scaled as (a + (4 a & FF))). */
export function loadC9FDEntry(g: Game): void {
  const m = g.m;
  const a = m.rd(0xc9fd);
  let hl = (0x681f + a) & 0xffff;
  hl = (hl + ((a * 4) & 0xff)) & 0xffff;
  [hl] = copy(m, hl, 0xc97b, 2);
  m.wr(0xc9ff, m.rd(hl));
  copy(m, hl, 0xce91, 3);
}

// ---------------------------------------------------------------- the battle message

/** 00:276D — up to c frames (0 = 256), cut short by A (FF8B): returns whether A ended it. */
function* framesOrA(g: Game, c: number): Co<boolean> {
  for (;;) {
    yield* wait1(g);
    if (g.m.hram[0x0b]! & 0x01) return true;
    c = (c - 1) & 0xff;
    if (!c) return false;
  }
}

/** 00:2766 — a pause of [hl] frames, then [hl] more, cut short by A. */
function* pauseAt(g: Game, hl: number): Co {
  const n = g.m.rd(hl);
  if (!(yield* framesOrA(g, n))) yield* framesOrA(g, n);
}

/** 0B:6FF5 — the message box restarted: CD0A = 5 meanwhile, a pause of 3C frames (0B:700D,
 *  00:2766), the line state reset and the box frame (00:2745), the cursor CE95/CE96 = 1, 1
 *  (0B:6ED1), CD0A back. */
function* messageRestart(g: Game): Co {
  const m = g.m;
  const v = m.rd(0xcd0a);
  m.wr(0xcd0a, 0x05);
  yield* pauseAt(g, 0x700d);
  // 00:2745
  lineReset(m);
  farSync(g, 0x0f, () => boxFrame(g));
  // 0B:6ED1
  m.wr(0xce95, 0x01);
  m.wr(0xce96, 0x01);
  m.wr(0xcd0a, v);
}

/** 0B:6FA1 — the battle message CE8D/CE8E (bank 9) drawn in the 18 x 5 box at the cursor
 *  CE95/CE96 (00:3211 mode 1, + 4 (CE97) when C9BF is 1 or 2); the box opened first (mode 21 at
 *  1, 1, WY = 58 with CD37 = 1, else 40) when WY is not there yet; the cursor kept after it. C9BF
 *  = 3 with C981 = 2 restarts the box first, C9BF = 2 after (0B:6FF5). */
function* battleMessage(g: Game): Co {
  const m = g.m;
  const s = (m.rd(0xc9bf) - 1) & 0xff;
  let b: number;
  if (s < 2) b = 0x04;
  else {
    if (s === 2 && m.rd(0xc981) === 0x02) yield* messageRestart(g);
    b = 0x00;
  }
  m.wr(0xce97, b);
  let de = m.rd16(0xce95);
  const wy = m.rd(0xcd37) === 0x01 ? 0x58 : 0x40;
  let a: number;
  if (m.rd(0xff4a) === wy) a = 0x01;
  else {
    m.wr(0xff4a, wy);
    a = 0x21;
    de = 0x0101;
  }
  const hl = m.rd16(0xce8d);
  const mode = a | m.rd(0xce97);
  const r = yield* far0(g, 0x09, () => printText(g, mode, hl, de, 0x0512));
  m.wr(0xce95, r.de & 0xff);
  m.wr(0xce96, (r.de >> 8) & 0xff);
  if (m.rd(0xc9bf) !== 0x02) return;
  yield* messageRestart(g);
}

/** 0C:5FB7 — the battle message (0B:6FA1). */
export function* battleMessageFar(g: Game): Co {
  yield* farcall(g, 0x0b, () => battleMessage(g));
}

// ---------------------------------------------------------------- registration

nativeRoutines.set(0x445f, function* (g) { countBits(g); });
nativeRoutines.set(0x4490, function* (g) { loadC90A(g); });
nativeRoutines.set(0x44ac, function* (g) { loadD83E(g); });
nativeRoutines.set(0x4865, function* (g) { storeD83E(g); });
nativeRoutines.set(0x49db, function* (g) { slotBitList(g); });
nativeRoutines.set(0x4b9f, function* (g) { slotsToC500(g); });
nativeRoutines.set(0x4bf6, function* (g) { slotCodeMatches(g); });
nativeRoutines.set(0x4d41, function* (g) { ce00ToSlots(g); });
nativeRoutines.set(0x5db6, function* (g) { storeC9A5(g); });
nativeRoutines.set(0x5f9d, function* (g) { messagePointer(g); });
nativeRoutines.set(0x5fb7, (g) => battleMessageFar(g));
nativeRoutines.set(0x5fcc, function* (g) { clearD83E(g); });
nativeRoutines.set(0x5fd3, function* (g) { fillD86B(g); });
nativeRoutines.set(0x5fdb, function* (g) { loadC9A5(g); });
nativeRoutines.set(0x5ff1, function* (g) { fillD822(g); });
nativeRoutines.set(0x602b, function* (g) { firstClearSlot(g); });
nativeRoutines.set(0x6042, function* (g) { countClearSlots(g); });
nativeRoutines.set(0x605d, function* (g) { targetRange(g); });
nativeRoutines.set(0x606d, function* (g) { storeD6BD(g); });
nativeRoutines.set(0x6083, function* (g) { clampC940(g); });
nativeRoutines.set(0x6851, function* (g) { loadC9FDEntry(g); });
