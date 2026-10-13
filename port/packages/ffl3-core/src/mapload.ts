/** Legend III map load 00:027D (docs/ffl3/FINDINGS.md M5/M6): the header (06:6C58), the layout
 *  (00:1756 -> 00:0F42) and its flag patches (0B:78F5), the tiles (00:0427), the objects
 *  (00:054D / 00:05BF), the background (00:0E34) and the fades by CA6B. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, far0Sync, fillBC, decompress, vramCopy, fadeIn, fadeOut, windowOff,
  bracketEnter, bracketLeave } from "./sys.js";
import { scroll } from "./irq.js";
import { waveFadeOut, waveFadeIn } from "./wave.js";
import { NotPorted } from "./irq.js";
import { fa, fget, fset, slot, setSlot, testFlag, clearFlag, copySlotUp, testFlag2 } from "./objects.js";
import { tableWord, cellArgs, leaderInit, objectSprite, blocked, cellByte, cellLook, drawObjects } from "./actors.js";

// ---------------------------------------------------------------- layout

/** 00:0E1C — the layout data pointer of CA15 in the bank selected (07: n - 1, 08: n - 10). */
function layoutPointer(m: Memory): number {
  const n = m.rd(0xc0b1) === 0x08 ? (m.rd(0xca15) - 0x10) & 0xff : (m.rd(0xca15) - 1) & 0xff;
  return tableWord(m, 0x4000, n);
}

/** 00:0F42 — the layout of CA15 into the tile buffer D000: C100-C4FF parked in VRAM 9C00 (the
 *  window map takes the old C100 bytes), the data decompressed to C100, expanded by the metatiles
 *  (B:4022) into rows of CA07 tiles, C100 back from 9C00. CA07 = width (07:7EA0), CA06 = (tile
 *  count (07:7EC0) - 1) >> 8. */
function loadLayout(g: Game): void {
  const m = g.m;
  far0Sync(g, 0, () => vramCopy(m, 0xc100, 0x9c00, 0x0400));
  pushBank(g, 0x07);
  m.wr(0xca07, m.rd(0x7ea0 + m.rd(0xca15)));
  popBank(g);
  m.wr(0xca15, m.rd(0xca15) + 1);
  const end = layoutPointer(m);
  m.wr(0xca15, m.rd(0xca15) - 1);
  const start = layoutPointer(m);
  decompress(m, start, end, 0xc100);
  pushBank(g, 0x07);
  let bc = m.rd16(0x7ec0 + 2 * m.rd(0xca15)) - 1;
  m.wr(0xca06, (bc >> 8) & 0xff);
  popBank(g);
  bc = ((bc + 1) & 0xffff) >> 2;
  let de = 0xd000, hl = 0xc100;
  const w = m.rd(0xca07);
  do {
    const n = m.rd(0xc0b1) === 0x08 ? (m.rd(0xca15) - 0x10) & 0xff : (m.rd(0xca15) - 1) & 0xff;
    const meta = tableWord(m, 0x4022, n);
    const t = (meta + 4 * m.rd(hl)) & 0xffff;
    m.wr(de, m.rd(t));
    m.wr(de + 1, m.rd(t + 2));
    const d2 = (de + w) & 0xffff;
    m.wr(d2 + 1, m.rd(t + 3));
    m.wr(d2, m.rd(t + 1));
    hl = (hl + 1) & 0xffff;
    de = (de + 2) & 0xffff;
    if (!(de & 0xff & ((w - 1) & 0xff))) de = (de + w) & 0xffff;
    bc = (bc - 1) & 0xffff;
  } while (bc);
  far0Sync(g, 0, () => vramCopy(m, 0x9c00, 0xc100, 0x0400));
}

/** 00:1756 — the layout from bank 07 (CA15 < 10) or 08. */
export function layout(g: Game): void {
  pushBank(g, g.m.rd(0xca15) < 0x10 ? 0x07 : 0x08);
  loadLayout(g);
  popBank(g);
}

/** 0B:7926 / 0B:792D — one patch at hl (bank 0B pushed): x, y, then w << 4 | h and the rows,
 *  written into D000 rows of CA07 (rows after y = 0 go on from a stale C801/C802; rows past the
 *  map land in the RAM after it, as the original writes them). */
export function patchAt(g: Game, hl: number): void {
  const m = g.m;
  pushBank(g, 0x0b);
  const c = m.rd(hl++), b = m.rd(hl++);
  let de = 0xd000 | c;
  if (b) {
    for (let k = 0; k < b; k++) de = (de + m.rd(0xca07)) & 0xffff;
    m.wr(0xc801, de & 0xff);
    m.wr(0xc802, de >> 8);
  }
  const wh = m.rd(hl);
  if (wh) {
    m.wr(0xc800, wh >> 4);
    hl++;
    for (let r = wh & 0x0f; r; r--) {
      for (let i = m.rd(0xc800); i; i--) m.wr(de++, m.rd(hl++));
      const lo = m.rd(0xc801) + m.rd(0xca07);
      m.wr(0xc801, lo & 0xff);
      m.wr(0xc802, (m.rd(0xc802) + (lo >> 8)) & 0xff);
      de = (m.rd(0xc802) << 8) | m.rd(0xc801);
    }
  }
  popBank(g);
}

/** 0B:78F5 — the flag patches of map C6E8 (0B:7982 maps, 0B:79B1 flags or FF, 0B:79E0
 *  pointers). */
export function mapPatches(g: Game): void {
  const m = g.m;
  const map = m.rd(0xc6e8);
  for (let e = 0; e < 0x2f; e++) {
    if (m.rd(0x7982 + e) !== map) continue;
    const f = m.rd(0x79b1 + e);
    if (f !== 0xff && !testFlag(m, f)) continue;
    patchAt(g, tableWord(m, 0x79e0, e));
  }
}

// ---------------------------------------------------------------- tiles

/** 07:7F00 — the shared object tiles (bank 04 7D00, 7C00, 7E00 x 2; bank 03 5100, 5800, 4E00,
 *  5380, 5440) from 8100, and 03:5430 -> 87E0. */
function sharedTiles(g: Game): void {
  const m = g.m;
  let de = 0x8100;
  const cp = (bank: number, hl: number, n: number) => { [, de] = far0Sync(g, bank, () => vramCopy(m, hl, de, n)); };
  cp(4, 0x7d00, 0x100); cp(4, 0x7c00, 0x100); cp(4, 0x7e00, 0x200);
  cp(3, 0x5100, 0x100); cp(3, 0x5800, 0x100); cp(3, 0x4e00, 0x40); cp(3, 0x5380, 0x80); cp(3, 0x5440, 0x40);
  de = 0x87e0;
  cp(3, 0x5430, 0x10);
}

/** 00:04C6 — the leader's sprite code: member C6F3 bits 6-7 (record C500 + 60 k + 0D: byte 0 &
 *  7 = 2 -> F0 + (byte 0 >> 3 & 0F), else byte 1), then 00:04F7. */
function* leaderCode(g: Game): Co<number> {
  const m = g.m;
  pushBank(g, 0x0b);
  const k = m.rd(0xc6f3) >> 6;
  const hl = 0xc500 + 0x60 * k + 0x0d;
  const a = (m.rd(hl) & 7) === 2 ? (((m.rd(hl) >> 3) & 0x0f) + 0xf0) & 0xff : m.rd(hl + 1);
  return yield* spriteType(g, a);
}

/** 00:04F7 — (flag 0A: the vehicle sprite FA, or FB with flag 8D) the type 0B:748F[a] >> 6 to
 *  the leader's C320 / C340, 00:08AD; returns 0B:748F[a] & 3F (bank 0B popped). */
function* spriteType(g: Game, a: number): Co<number> {
  const m = g.m;
  if (testFlag(m, 0x0a)) a = testFlag(m, 0x8d) ? 0xfb : 0xfa;
  const t = m.rd((0x748f + a) & 0xffff) >> 6;
  setSlot(m, 0);
  fset(m, "c320", t);
  fset(m, "c340", t);
  yield* leaderLook(g);
  const r = m.rd((0x748f + a) & 0xffff) & 0x3f;
  popBank(g);
  return r;
}

/** 00:04B1 — the leader's 4 sprite tiles (bank 04, page 40 + code) -> 8000. */
function* leaderTiles(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x04);
  const a = yield* leaderCode(g);
  far0Sync(g, 0, () => vramCopy(m, ((a + 0x40) & 0xff) << 8, 0x8000, 0x100));
  popBank(g);
}

/** 00:0438 — the object tiles: 07:7F00, then the map's sprite set (03:751C by CA1E): a bit mask
 *  for the pages 80-87 (each set bit: one 256-byte page from bank 04 page 40 + n, or bank 03
 *  page 49 + n - 40), then 64-byte sprites from 03:4900 + 40 n to 8600 until FF; then the
 *  leader (00:04B1). */
function* objectTiles(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x07);
  sharedTiles(g);
  popBank(g);
  let hl = tableWord(m, 0x751c, m.rd(0xca1e));
  m.wr(0xc800, m.rd(hl++));
  let d = 0x80;
  while (d !== 0x88) {
    const bit = m.rd(0xc800) & 0x80;
    m.wr(0xc800, (m.rd(0xc800) << 1) & 0xff);
    if (!bit) { d++; continue; }
    let a = m.rd(hl++);
    let h: number;
    if (a < 0x40) { pushBank(g, 0x04); h = 0x40; } else { a -= 0x40; pushBank(g, 0x03); h = 0x49; }
    const page = d;
    far0Sync(g, 0, () => vramCopy(m, ((a + h) & 0xff) << 8, page << 8, 0x100));
    popBank(g);
    d++;
  }
  let de = 0x8600;
  for (;;) {
    const a = m.rd(hl++);
    if (a === 0xff) break;
    pushBank(g, 0x03);
    const src = (((a & 0x7f) * 0x40) + 0x4900) & 0xffff;
    [, de] = far0Sync(g, 0, () => vramCopy(m, src, de, 0x40));
    popBank(g);
  }
  yield* leaderTiles(g);
}

/** 07:7F5B — the four tileset blocks CA19-CA1C (bank 05 pages, 0x200 each) -> 9000; map 01
 *  copies tiles within VRAM (CA17 = 11: 94C0/95C0, else 9080/9180 -> 9200/9300). */
function tilesets(g: Game): void {
  const m = g.m;
  let de = 0x9000;
  for (const r of [0xca19, 0xca1a, 0xca1b, 0xca1c]) {
    const a = m.rd(r);
    [, de] = far0Sync(g, 0x05, () => vramCopy(m, a << 8, de, 0x200));
  }
  if (m.rd(0xc6e8) !== 0x01) return;
  const [s1, s2] = m.rd(0xca17) === 0x11 ? [0x94c0, 0x95c0] : [0x9080, 0x9180];
  far0Sync(g, 0, () => vramCopy(m, s1, 0x9200, 0x20));
  far0Sync(g, 0, () => vramCopy(m, s2, 0x9300, 0x20));
}

/** 07:7FBC — map 5D: four extra tiles from bank 05. */
function tilesMap5d(g: Game): void {
  const m = g.m;
  if (m.rd(0xc6e8) !== 0x5d) return;
  for (const [s, d] of [[0x44c0, 0x92a0], [0x45c0, 0x93a0], [0x44e0, 0x92e0], [0x45e0, 0x93e0]] as const) {
    far0Sync(g, 0x05, () => vramCopy(m, s, d, 0x20));
  }
}

/** 01:418A — map C6E8 is 02-05 (z). */
export function isTown(m: Memory): boolean {
  const v = m.rd(0xc6e8);
  return v >= 0x02 && v <= 0x05;
}

/** 00:0535 — tilesets (07:7F5B, 07:7FBC), then the bank-01 extras (01:5501 maps 0A/0B,
 *  01:6092 map B4, 01:6082 maps 02-05: 05:7B90 -> 9600). */
function mapTiles(g: Game): void {
  const m = g.m;
  pushBank(g, 0x07);
  tilesets(g);
  tilesMap5d(g);
  popBank(g);
  pushBank(g, 0x01);
  const map = m.rd(0xc6e8);
  if (map === 0x0a || map === 0x0b) throw new NotPorted("01:550D (the tiles of maps 0A/0B)");
  if (map === 0xb4) throw new NotPorted("01:6098 (the tiles of map B4)");
  if (isTown(m)) far0Sync(g, 0x05, () => vramCopy(m, 0x7b90, 0x9600, 0x20));
  popBank(g);
}

/** 00:0427 — the font (07:7F4F: 03:4000 -> 8800), the object tiles (00:0438, bank 03), the map
 *  tiles (00:0535). */
function* loadTiles(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x07);
  far0Sync(g, 0x03, () => vramCopy(m, 0x4000, 0x8800, 0x800));
  popBank(g);
  pushBank(g, 0x03);
  yield* objectTiles(g);
  popBank(g);
  mapTiles(g);
}

// ---------------------------------------------------------------- objects

/** 00:08AD — the leader's look for the vehicle state C6E3 (00:087A: CA0F, C6F1; 00:088C: the
 *  vehicle's kind and tile base, else from C340 / C330), the sprite list by C6EE (01:5272),
 *  a frame. */
export function* leaderLook(g: Game): Co {
  vehicleLook(g);
  yield* g.wait(1);
}

/** 00:08AD without its frame wait (00:3A6B), for callers that are not coroutines; the wait is
 *  taken by `leaderLook`. */
function vehicleLook(g: Game): void {
  const m = g.m;
  const s = m.rd(0xc6e3);
  m.wr(0xca0f, m.rd(0x087a + 2 * s));
  m.wr(0xc6f1, m.rd(0x087a + 2 * s + 1));
  setSlot(m, 0);
  if (s) {
    fset(m, "c320", m.rd(0x088c + 2 * s));
    fset(m, "c280", m.rd(0x088c + 2 * s + 1));
  } else {
    fset(m, "c320", fget(m, "c340"));
    fset(m, "c280", fget(m, "c330"));
  }
  farSync1(g, () => objectSprite(m, m.rd(0xc6ee)));
}
function farSync1(g: Game, fn: () => void): void {
  pushBank(g, 0x01);
  fn();
  popBank(g);
}

/** 00:0715 — a talking object (C350 = 1) whose script flag (C200 - 1 in C780) is set takes
 *  tile base 78. */
function objectTalked(m: Memory): void {
  if (fget(m, "c350") !== 0x01) return;
  if (!testFlag2(m, (fget(m, "c200") - 1) & 0xff)) return;
  fset(m, "c280", 0x78);
  fset(m, "c330", 0x78);
}

/** 00:0730 — a shop object (C350 = 2) or a script DF+ object (C370 >= DF) gets a second slot:
 *  copied up (00:004B), one cell further in its facing. */
function objectPair(m: Memory): void {
  const t = fget(m, "c350");
  if (t !== 0x02) {
    if (t) return;
    if (fget(m, "c370") < 0xdf) return;
  }
  copySlotUp(m);
  const dir = fget(m, "c2d0");
  setSlot(m, slot(m) + 1);
  const move = (f: "c210" | "c230", d: number, mask: number, tf: "c290" | "c2b0") => {
    const a = fa(m, f);
    const lo = m.rd(a) + d;
    m.wr(a, lo & 0xff);
    const carry = lo > 0xff ? 1 : lo < 0 ? -1 : 0;
    m.wr(a + 1, (m.rd(a + 1) + carry) & m.rd(mask));
    const t = fa(m, tf);
    m.wr(t, m.rd(a)); m.wr(t + 1, m.rd(a + 1));
  };
  if (dir === 0x00) move("c210", -0x10, 0xca04, "c290");
  else if (dir === 0x40) move("c230", 0x10, 0xca05, "c2b0");
  else if (dir === 0x80) move("c210", 0x10, 0xca04, "c290");
  else move("c230", -0x10, 0xca05, "c2b0");
  m.wr(fa(m, "c260") + 1, 0);
}

/** 00:05BF — the map's objects (header + 6, 6 bytes each until FF) into slots 2..: shown unless
 *  their story flag is clear; script, facing, kind, positions (x16, high bits), tile base, type,
 *  sprite; then the cell look and pairs; then the follower (00:06BE). */
function loadObjects(g: Game): void {
  const m = g.m;
  setSlot(m, 2);
  let hl = (tableWord(m, 0x6c58, m.rd(0xc6e8)) + 6) & 0xffff;
  for (;;) {
    const flag = m.rd(hl++);
    if (flag === 0xff) break;
    let de = hl;
    if (flag && !testFlag(m, flag)) fset(m, "c200", 0);
    else fset(m, "c200", m.rd(de));
    fset(m, "c370", m.rd(de)); de++;
    // facing from b4 bit 7 and b3 bit 7 (rr twice), b4 bit 6 -> C360
    const a2d0 = fa(m, "c2d0");
    m.wr(a2d0, 0);
    de++;
    let v = m.rd(de);
    m.wr(a2d0, ((m.rd(a2d0) >> 1) | (v & 0x80)) & 0xff);
    const b = ((((v << 4) | (v >> 4)) & 0xff) & 0x04);
    de--;
    v = m.rd(de);
    m.wr(a2d0, ((m.rd(a2d0) >> 1) | (v & 0x80)) & 0xff);
    fset(m, "c360", (v & 0x40) | b);
    // y (b2 low nibble x 16, bits 4-5 high byte) -> C210 and C290
    v = m.rd(de);
    let lo = ((v & 0x0f) << 4) & 0xff, hi = ((v & 0x30) >> 4) & 0xff;
    fset(m, "c210", lo); fset(m, "c210", hi, 1);
    fset(m, "c290", lo); fset(m, "c290", hi, 1);
    de++;
    v = m.rd(de);
    lo = ((v & 0x0f) << 4) & 0xff; hi = ((v & 0x30) >> 4) & 0xff;
    fset(m, "c230", lo); fset(m, "c230", hi, 1);
    fset(m, "c2b0", lo); fset(m, "c2b0", hi, 1);
    de++;
    v = m.rd(de);
    fset(m, "c320", v & 0x1f);
    fset(m, "c340", v & 0x1f);
    fset(m, "c350", (v & 0xc0) >> 6);
    de++;
    v = m.rd(de);
    const tb = v & 0xc0 ? ((v & 0x3f) + 0x60) & 0xff : ((v & 0x07) << 4) & 0xff;
    fset(m, "c280", tb);
    fset(m, "c330", tb);
    objectTalked(m);
    pushBank(g, 0x01);
    objectSprite(m, fget(m, "c2d0"));
    fset(m, "c2e0", 0x47);
    fset(m, "c310", 0x01);
    cellArgs(m);
    blocked(g);
    cellByte(m);
    cellLook(m);
    if (fget(m, "c2f0") === 0x08) {
      fset(m, "c2e0", fget(m, "c2e0") & 0xfd);
      fset(m, "c250", fget(m, "c250") | 0x06);
    }
    popBank(g);
    objectPair(m);
    hl = (de + 1) & 0xffff;
    setSlot(m, slot(m) + 1);
  }
  follower(g);
}

/** 00:06BE — the follower: in a walking state (C6E3 < 3), with flag 82 set, on its map C6ED,
 *  the highest free slot (00:01DB) gets it (00:1552) at C6E9-C6EC (+ 50). */
function follower(g: Game): void {
  const m = g.m;
  if (m.rd(0xc6e3) >= 0x03) return;
  if (!testFlag(m, 0x82)) return;
  if (m.rd(0xc6ed) !== m.rd(0xc6e8)) return;
  throw new NotPorted("00:06D2 (the follower object)");
}

/** 00:054D — the leader into slot 0 at the screen centre (50, 50) + C6E4/C6E6 (also the
 *  targets), facing 80, state 1 unless CA00; its cell (01:4000), look (00:08AD), slot 1
 *  (01:4F2B); then the map's objects (00:05BF). */
function* loadLeader(g: Game): Co {
  const m = g.m;
  setSlot(m, 0);
  if (!m.rd(0xca00)) fset(m, "c200", 0x01);
  m.wr(0xca00, 0);
  fset(m, "c370", 0x01);
  fset(m, "c210", 0x50);
  fset(m, "c230", 0x50);
  fset(m, "c2d0", 0x80);
  const add = (f: "c210" | "c230", t: "c290" | "c2b0", lo: number, hi: number, mask: number) => {
    const s = m.rd(fa(m, f)) + m.rd(lo);
    const a = s & 0xff;
    fset(m, t, a); fset(m, f, a);
    const h = (m.rd(fa(m, f) + 1) + m.rd(hi) + (s >> 8)) & 0xff & m.rd(mask);
    fset(m, t, h, 1); fset(m, f, h, 1);
  };
  add("c210", "c290", 0xc6e4, 0xc6e5, 0xca04);
  add("c230", "c2b0", 0xc6e6, 0xc6e7, 0xca05);
  pushBank(g, 0x01);
  leaderInit(g);
  yield* leaderLook(g);
  slot1Init(g);
  popBank(g);
  loadObjects(g);
}

/** 01:4F2B — slot 1 (the companion object): sprite list xx44 (high byte 6E with CA13, else 00;
 *  in a vehicle state C6E3 01:4F5D[C6E3]), tile base 70, state 2. */
function slot1Init(g: Game): void {
  const m = g.m;
  setSlot(m, 1);
  const a = fa(m, "c260");
  m.wr(a, 0x44);
  m.wr(a + 1, m.rd(0xca13) ? 0x6e : 0x00);
  const s = m.rd(0xc6e3);
  if (s) m.wr(a + 1, m.rd(0x4f5d + s));
  fset(m, "c280", 0x70);
  fset(m, "c200", 0x02);
}

// ---------------------------------------------------------------- background

/** 00:0D14 — C801/C802 = the D000 address of the cell 16 px up-left of the view (C6E4.., C6E6..). */
function viewCell(m: Memory): void {
  const e0 = (m.rd(0xc6e6) - 0x10) & 0xff;
  const borrowX = m.rd(0xc6e6) < 0x10 ? 1 : 0;
  const d0 = (m.rd(0xc6e7) - borrowX) & 0xff;
  const c0 = (m.rd(0xc6e4) - 0x10) & 0xff;
  const borrowY = m.rd(0xc6e4) < 0x10 ? 1 : 0;
  const b0 = ((m.rd(0xc6e5) - borrowY) & 0xff) & m.rd(0xca04);
  let c = (c0 >> 4) & 0x0f;
  c = (c | (((b0 << 4) | (b0 >> 4)) & 0xff)) & 0xff;
  cellPointer(m, d0, e0, c);
}

/** 00:0DB3 — C801/C802 = D000 + ((de >> 4) & (CA07 - 1)) + c rows of CA07 (wrapped by CA06). */
function cellPointer(m: Memory, d: number, e: number, c: number): void {
  let de = ((d << 8) | e) >> 4;
  const mask = (m.rd(0xca07) - 1) & 0xff;
  let hl = 0xd000 + (de & 0xff & mask);
  const w = m.rd(0xca07);
  for (; c; c--) hl = (hl + w) & 0xffff;
  m.wr(0xc801, hl & 0xff);
  m.wr(0xc802, ((hl >> 8) & m.rd(0xca06)) | 0xd0);
}

/** 00:0DE4 — the BG map address (98xx | CA2A) of the screen cell (c, b) with the scroll. */
function bgAddr(m: Memory, c: number, b: number): number {
  const e = m.rd(0xca2a);
  const l = ((((m.hram[0x11]! & 0xf8) + c) & 0xff) >> 3) & 0xff;
  const h = 0x98 | e;
  let a = ((m.hram[0x12]! & 0xf8) + b) & 0xff;
  const de = (a << 2) & 0x3ff;
  return (((h << 8) | l) + de) & 0xffff;
}

/** 00:0E34 — the whole view (11 rows of 12 metatiles from 16 px up-left) drawn into the BG map:
 *  each layout byte through the map's block table (06:4000 by CA17; CA2E clear: byte x 4 with
 *  01:5EA6 hiding blocks by bit 6 and CA12), 2 x 2 tiles, written row by row in the bracket. */
export function* drawView(g: Game): Co {
  const m = g.m;
  yield* bracketEnter(g);
  m.wr(0xc803, 0xf0);
  m.wr(0xc804, 0xf0);
  viewCell(m);
  m.wr(0xc805, 0);
  m.wr(0xc806, m.rd(0xc801));
  m.wr(0xc807, m.rd(0xc802));
  do {
    m.wr(0xc800, 0);
    m.wr(0xc801, m.rd(0xc806));
    m.wr(0xc802, m.rd(0xc807));
    do {
      const hl = (m.rd(0xc802) << 8) | m.rd(0xc801);
      let e: number;
      if (!m.rd(0xca2e)) {
        const v = m.rd(hl);
        e = (v << 2) & 0xff;
        const carry = !!(v & 0x40);
        if (m.rd(0xca12) & 0x40) { if (!carry) e = 0; } else if (carry) e = 4;
      } else e = ((m.rd(hl) & 0x3f) * 4) & 0xff;
      pushBank(g, 0x06);
      const de = (tableWord(m, 0x4000, m.rd(0xca17)) + e) & 0xffff;
      const p = 0xc880 + m.rd(0xc800);
      m.wr(p, m.rd(de));
      m.wr(p + 1, m.rd(de + 2));
      m.wr(p + 0x18, m.rd(de + 1));
      m.wr(p + 0x19, m.rd(de + 3));
      popBank(g);
      const w1 = (m.rd(0xca07) - 1) & 0xff;
      const x = m.rd(0xc801);
      m.wr(0xc801, (x & (w1 ^ 0xff)) | ((x + 1) & w1));
      m.wr(0xc800, m.rd(0xc800) + 2);
    } while (m.rd(0xc800) !== 0x18);
    let src = 0xc880;
    do {
      let hl = bgAddr(m, m.rd(0xc803), m.rd(0xc804));
      for (let b = 0x18; b; b--) {
        m.wr(hl, m.rd(src++));
        hl = (hl & 0xffe0) | ((hl + 1) & 0x1f);
      }
      m.wr(0xc804, m.rd(0xc804) + 8);
    } while (m.rd(0xc804) & 0x0f);
    const s = m.rd(0xc806) + m.rd(0xca07);
    m.wr(0xc806, s & 0xff);
    m.wr(0xc807, (((m.rd(0xc807) + (s >> 8)) & 0xff) & m.rd(0xca06)) | 0xd0);
    m.wr(0xc805, m.rd(0xc805) + 1);
  } while (m.rd(0xc805) !== 0x0b);
  m.wr(0xca2a, 0);
  m.wr(0xca2e, 0);
  yield* bracketLeave(g);
}

// ---------------------------------------------------------------- the load

/** 00:0409 — the encounter zone: 0 before flag 31; on map 01 with flag CE, zone 43. */
function zoneOverride(m: Memory): void {
  if (!testFlag(m, 0x31)) { m.wr(0xca2d, 0); return; }
  if (m.rd(0xc6e8) !== 0x01) return;
  if (testFlag(m, 0xce)) m.wr(0xca2d, 0x43);
}

/** 00:039B — before the load, by CA6B: fade out / 00:03CD (the wave fade) / nothing. */
function* beforeLoad(g: Game): Co {
  const k = g.m.rd(0xca6b);
  if (k === 0) yield* fadeOut(g);
  else if (k === 1) yield* waveFadeOut(g);
}

/** 00:03A8 — after the load, by CA6B: fade in (CD3D = FF meanwhile) / 00:03E9 / 01:5F9D. */
function* afterLoad(g: Game): Co {
  const m = g.m;
  const k = m.rd(0xca6b);
  if (k === 0) {
    const s = m.rd(0xcd3d);
    m.wr(0xcd3d, 0xff);
    yield* fadeIn(g);
    m.wr(0xcd3d, s);
  } else if (k === 1) yield* waveFadeIn(g);
  else throw new NotPorted("01:5F9D (the load's fade in, CA6B = 2)");
}

/** 00:027D — load map C6E8 at C6E4-C6E7 facing C6EE. */
export function* loadMap(g: Game): Co {
  const m = g.m;
  m.wr(0xca14, 1);
  yield* beforeLoad(g);
  windowOff(m);
  m.hram[0x0b] = 0; m.hram[0x0a] = 0;
  m.wr(0xca01, 0);
  fillBC(m, 0xc200, 0x0180, 0);
  if (m.rd(0xc6e8) < 0x0a) clearFlag(m, 0x0a);
  pushBank(g, 0x01);
  pushBank(g, 0x06);
  let hl = tableWord(m, 0x6c58, m.rd(0xc6e8));
  m.wr(0xca15, m.rd(hl) & 0x7f);
  m.wr(0xca6c, m.rd(hl++) & 0x80);
  m.wr(0xca1d, m.rd(hl++));
  m.wr(0xca1e, m.rd(hl++));
  m.wr(0xca18, m.rd(hl++));
  if (!m.rd(0xca6e)) m.hram[0x3a] = m.rd(0xc7cc);
  else if (!m.rd(0xca59)) {
    const mu = m.rd(hl) & 0x1f;
    if (mu !== 0x1f) m.hram[0x3a] = mu;
  }
  m.wr(0xca59, 0);
  const b4 = m.rd(hl++);
  const rate = ((((b4 << 4) | (b4 >> 4)) & 0xff) >> 1) & 0x07;
  m.wr(0xca2b, m.rd(0x119a + rate));
  m.wr(0xca2d, m.rd(hl));
  zoneOverride(m);
  popBank(g);
  pushBank(g, 0x03);
  hl = tableWord(m, 0x731c, m.rd(0xca1d));
  m.wr(0xca05, ((m.rd(hl) & 0x0f) - 1) & 0xff);
  m.wr(0xca04, ((m.rd(hl++) >> 4) - 1) & 0xff);
  for (const r of [0xca19, 0xca1a, 0xca1b, 0xca1c]) m.wr(r, m.rd(hl++));
  m.wr(0xca17, m.rd(hl));
  if (m.rd(0xc6e8) === 0x01 && testFlag(m, 0xec)) m.wr(0xca17, 0x11);
  popBank(g);
  m.hram[0x12] = m.rd(0xc6e4);
  m.wr(0xca03, m.rd(0xc6e5) & m.rd(0xca04));
  m.hram[0x11] = m.rd(0xc6e6);
  m.wr(0xca02, m.rd(0xc6e7) & m.rd(0xca05));
  scroll(m);
  layout(g);
  pushBank(g, 0x0b);
  mapPatches(g);
  popBank(g);
  yield* bracketEnter(g);
  yield* loadTiles(g);
  yield* bracketLeave(g);
  pushBank(g, 0x06);
  yield* loadLeader(g);
  popBank(g);
  m.wr(0xca14, 0);
  drawObjects(g);
  yield* drawView(g);
  yield* g.wait(1);
  yield* afterLoad(g);
  popBank(g);
  m.wr(0xca6e, 1);
  yield* g.wait(1);
}

