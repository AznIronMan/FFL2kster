/** Legend III map object logic of bank 01 and its bank-0 helpers (docs/ffl3/ROM_MAP.md): the
 *  map cell under an object (00:0181/0187, 01:4DFF, 01:4EE1), passability (00:0FFD, 00:1024),
 *  the leader set-up (01:4000), object sprites (01:5272, 01:53FF) and the per-frame drawing
 *  (00:01A0: 01:53A9, 01:543C, 01:541E). Returned booleans stand for the Z flag the original
 *  routines return (true = nz). */
import type { Game } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank } from "./sys.js";
import { fa, fget, fset, slot, setSlot, oamHideAll, drawObject, drawObject4 } from "./objects.js";

/** 00:3741 — hl = the word at hl + 2a (16-bit add). */
export const tableWord = (m: Memory, hl: number, a: number): number => m.rd16((hl + 2 * a) & 0xffff);

/** 01:4700 — the slot's C2E0 -> C804, target C290 -> C800/C801, C2B0 -> C802/C803. */
export function cellArgs(m: Memory): void {
  m.wr(0xc804, fget(m, "c2e0"));
  m.wr(0xc800, fget(m, "c290")); m.wr(0xc801, fget(m, "c290", 1));
  m.wr(0xc802, fget(m, "c2b0")); m.wr(0xc803, fget(m, "c2b0", 1));
}

/** 01:4DFF — de = the D000 buffer address of the cell at (C800/C801, C802/C803): row
 *  (C800 >> 4 | swap C801) x CA07, column (C802/C803 >> 4) & (CA07 - 1); wrapped by CA06. */
export function cellAddr(m: Memory): number {
  let e = m.rd(0xc802), d = m.rd(0xc803);
  const b = m.rd(0xc801);
  const c0 = (m.rd(0xc800) >> 4) & 0x0f;
  let c = (c0 | ((b << 4) | (b >> 4))) & 0xff;
  let de = ((d << 8) | e) >> 4;
  e = de & 0xff & ((m.rd(0xca07) - 1) & 0xff);
  let hl = 0xd000 + e;
  const w = m.rd(0xca07);
  for (; c; c--) hl = (hl + w) & 0xffff;
  d = ((hl >> 8) & m.rd(0xca06)) | 0xd0;
  return (d << 8) | (hl & 0xff);
}

/** 00:0187 — the cell's layout byte -> C806, its attribute (06:5ACC table by CA17) -> C805. */
export function cellRead(g: Game): void {
  const m = g.m;
  const de = cellAddr(m);
  const v = m.rd(de);
  m.wr(0xc806, v);
  pushBank(g, 0x06);
  const t = tableWord(m, 0x5acc, m.rd(0xca17));
  m.wr(0xc805, m.rd((t + (v & 0x3f)) & 0xffff));
  popBank(g);
}

/** 01:4EE1 — the move mask C804 from the slot's C2E0 and the cell attribute C805. */
function moveMask(m: Memory): void {
  m.wr(0xc804, fget(m, "c2e0"));
  const b = m.rd(0xc805);
  if (!(b & 0x4b)) m.wr(0xc804, m.rd(0xc804) | 0x03);
  if ((m.rd(0xc804) & 0x03) === 0x03) {
    const lo = b & 0x03;
    if (lo && lo !== 0x03) m.wr(0xc804, (m.rd(0xc804) & 0xfc) | (lo ^ 0x03));
  }
  m.wr(0xc804, (m.rd(0xc804) & 0xf7) | (b & 0x08));
}

/** 00:0181 — 00:0187, then 01:4EE1. */
export function cellCheck(g: Game): void {
  cellRead(g);
  moveMask(g.m);
}

/** 00:0FFD — passable for an object? (nz = blocked). */
export function blocked(g: Game): boolean {
  cellCheck(g);
  const m = g.m, c805 = m.rd(0xc805);
  if (c805 === 0xeb) return false;
  if ((c805 & 0xc0) === 0xc0) return true;
  if ((c805 & 0xc0) === 0x80) return false;
  return !!(m.rd(0xc804) & 0x47 & c805);
}

/** 00:1024 — passable for the leader? (nz = blocked). */
export function blockedLeader(g: Game): boolean {
  cellCheck(g);
  const m = g.m, c805 = m.rd(0xc805);
  if (c805 === 0xeb) return true;
  if ((c805 & 0xc0) === 0xc0) return false;
  if ((c805 & 0xc0) === 0x80) return false;
  if (m.rd(0xc6e8) < 0x06 && m.rd(0xc6e3) === 0x02) return !(c805 & 0x40);
  return !!(m.rd(0xc804) & 0x47 & c805 & m.rd(0xca0f));
}

/** 01:463D — the slot's C300 = C806 (the layout byte under it). */
export function cellByte(m: Memory): void {
  fset(m, "c300", m.rd(0xc806));
}

/** 01:4E48 — the slot's C2F0 = C805 and its C250 frame bits from the cell (water, stairs, ...),
 *  and C2E0 = C804 (47 on a C0/80 cell). */
export function cellLook(m: Memory): void {
  const a2f0 = fa(m, "c2f0");
  m.wr(a2f0, m.rd(0xc805));
  const c250 = fa(m, "c250");
  const set = (or: number) => m.wr(c250, (m.rd(c250) & 0xf1) | or);
  const c6e3 = m.rd(0xc6e3);
  if (c6e3 && c6e3 !== 0x02) set(0);
  else {
    const v = m.rd(a2f0);
    if ([0xc1, 0xc3, 0xc5, 0xcc, 0xe4].includes(v)) set(0x06);
    else if (v === 0xe0 || v === 0xe1) set(0x02);
    else if ((v & 0xc0) !== 0xc0) set((m.rd(0xc805) & 0x30) >> 3);
  }
  if ((fget(m, "c300") & 0x40) !== m.rd(0xca12)) set(0x06);
  const t = m.rd(0xc805) & 0xc0;
  fset(m, "c2e0", t === 0xc0 || t === 0x80 ? 0x47 : m.rd(0xc804));
}

/** 01:548D — the leader's C250 / C2F0 / C2E0 back from C7CD-C7CF. */
export function leaderRestore(m: Memory): void {
  m.wr(0xc250, m.rd(0xc7cd));
  m.wr(0xc2f0, m.rd(0xc7ce));
  m.wr(0xc2e0, m.rd(0xc7cf));
}

/** 01:4000 — the leader (slot 0): CA56 = 0, C2E0 = 47, its cell (C300, CA12 = cell bit 6),
 *  passability, the cell look; on the first map load (CA6E = 0) the saved look (01:548D). */
export function leaderInit(g: Game): void {
  const m = g.m;
  setSlot(m, 0);
  m.wr(0xca56, 0);
  fset(m, "c2e0", 0x47);
  cellArgs(m);
  const de = cellAddr(m);
  const v = m.rd(de);
  fset(m, "c300", v);
  m.wr(0xca12, v & 0x40);
  blockedLeader(g);
  cellByte(m);
  cellLook(m);
  if (!m.rd(0xca6e)) leaderRestore(m);
}

/** 01:5272 — the slot's sprite list C260: 01:5292 by the facing a (bits 6-7), then by the kind
 *  C320. */
export function objectSprite(m: Memory, a: number): void {
  const dir = (((a << 4) | (a >> 4)) & 0xff) >> 2 & 0x03;
  const hl = tableWord(m, 0x5292, dir);
  const de = tableWord(m, hl, fget(m, "c320"));
  fset(m, "c260", de & 0xff);
  fset(m, "c260", de >> 8, 1);
}

/** 01:53FF — the walking frame of an object on a C2F0 9x cell: list by FF93 bits 5-6. */
export function objectStep(m: Memory): void {
  const f = m.hram[0x13]!;
  const r = ((f << 1) | (f >> 7)) & 0xff;
  const dir = (((r << 4) | (r >> 4)) & 0xff) & 0x03;
  const hl = tableWord(m, 0x5292, dir);
  const de = tableWord(m, hl, fget(m, "c320"));
  fset(m, "c260", de & 0xff);
  fset(m, "c260", de >> 8, 1);
}

/** 01:53EC — C250 = (C250 & 1) | 6. */
function frameStill(m: Memory): void {
  fset(m, "c250", (fget(m, "c250") & 0x01) | 0x06);
}

/** 01:53F6 — on a 9x cell (C2F0 & F0 = 90) the walking frame. */
function stepCell(m: Memory): void {
  if ((fget(m, "c2f0") & 0xf0) === 0x90) objectStep(m);
}

/** 01:53A9 — the leader (slot 0): C250 bit 0 = FF93 bit 4; (on a 49-type C2E0 not on a C0 cell:
 *  still); the step frame; drawn with 00:3A7F (vehicle states, C360 bit 2) or 00:3B3F. */
function drawLeader(m: Memory): void {
  setSlot(m, 0);
  const a = fa(m, "c250");
  m.wr(a, (m.rd(a) & 0xfe) | ((m.hram[0x13]! >> 4) & 1));
  if ((fget(m, "c2e0") & 0xcb) === 0x49 && (fget(m, "c2f0") & 0xc0) !== 0xc0) frameStill(m);
  stepCell(m);
  const s = m.rd(0xc6e3);
  if (s === 0x01 || s >= 0x03 || fget(m, "c360") & 0x04) drawObject(m);
  else drawObject4(m);
}

/** 01:541E — slot 1 (the cursor or companion): C250 = 1 while CA13 & 1F is 08-17. */
function drawSlot1(m: Memory): void {
  setSlot(m, 1);
  const v = m.rd(0xca13) & 0x1f;
  fset(m, "c250", v >= 0x08 && v < 0x18 ? 1 : 0);
  drawObject(m);
}

/** 01:543C — slots 2-F: frame bit 0 from FF93 bit 4 (rotated through), still on 09-type C2E0,
 *  the step frame, drawn by C360 bit 2 (00:3A7F) or 00:3B3F. */
function drawOthers(m: Memory): void {
  for (let i = 2; i < 0x10; i++) {
    setSlot(m, i);
    if (!fget(m, "c200")) continue;
    const a = fa(m, "c250");
    const f = (m.hram[0x13]! >> 4) & 1;
    m.wr(a, (m.rd(a) & 0xfe) | f);
    if ((fget(m, "c2e0") & 0x0b) === 0x09) frameStill(m);
    stepCell(m);
    if (fget(m, "c360") & 0x04) drawObject(m);
    else drawObject4(m);
  }
}

/** 00:01A0 — draw every object into the OAM buffer (once: CA14), with the DMA held (CD39 = 1). */
export function drawObjects(g: Game): void {
  const m = g.m;
  if (m.rd(0xca14)) return;
  m.wr(0xca14, 1);
  const cd39 = m.rd(0xcd39);
  m.wr(0xcd39, 1);
  const s = slot(m);
  pushBank(g, 0x01);
  oamHideAll(m);
  m.hram[0x17] = 0;
  drawLeader(m);
  drawOthers(m);
  drawSlot1(m);
  popBank(g);
  m.wr(0xcd39, cd39);
  setSlot(m, s);
  m.wr(0xca14, 0);
}

