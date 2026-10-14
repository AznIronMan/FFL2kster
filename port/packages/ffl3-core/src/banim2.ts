/** Legend III battle effects, continued: monster effect 12 variant 2 (02:50ED, with its callees
 *  03:7E74 and 0E:7D63 reached by `rst $30` through 00:3740) and the stray tables of the ability
 *  record reader 09:5466 (high nibble of C99B 6-F, where the jump 09:5479 + 3 k lands inside the
 *  code of the table entries). Helpers of banim.ts that are not exported are re-written here
 *  (02:4FC5, 02:51E0, 0E:7D6C / 0E:7DAD, 09:551E-55B5). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { NotPorted } from "./irq.js";
import { pushBank, popBank, farSync, fill, fillBC, vramCopy } from "./sys.js";
import { rst30 } from "./battle.js";

const BGP = 0xff47, OBP1 = 0xff49, SCY = 0xff42, SCX = 0xff43;

/** rst $00 — hl += a. */
const add8 = (hl: number, a: number): number => (hl + (a & 0xff)) & 0xffff;

// ---------------------------------------------------------------- 02:50ED and bank 03

/** 00:218F — farcall 0F:792C: fill bc bytes of VRAM at hl with a (hblank-paced; CPU time);
 *  returns hl after. */
function vramFill(g: Game, hl: number, bc: number, a: number): number {
  return farSync(g, 0x0f, () => fill(g.m, hl, bc, a));
}

/** 03:7EED — the tile of the map byte DF00 + a to de (16 bytes, 00:20FF from 9000 + 16 t), or
 *  16 zero bytes for FF (00:218F); returns de after. */
function mapTileOut(g: Game, a: number, de: number): number {
  const m = g.m;
  const t = m.rd(add8(0xdf00, a));
  if (t === 0xff) return vramFill(g, de, 0x0010, 0x00);
  const hl = (0x9000 + (t << 4)) & 0xffff;
  [, de] = vramCopy(m, hl, de, 0x0010);
  return de;
}

/** 03:7EE4 — the 8x16 object cell of map column b + c: the tile at DF00 + b + c, then the one a
 *  row below (+ 20) (03:7EED); returns de after. */
function mapCellOut(g: Game, b: number, c: number, de: number): number {
  const a = (b + c) & 0xff;
  de = mapTileOut(g, a, de);
  return mapTileOut(g, (a + 0x20) & 0xff, de);
}

/** 03:7EAA — the map rows 0..7 (in pairs: c = 0, 40, 80, C0), columns 7..C, as 8x16 object
 *  tiles to 8000.. (03:7EE4); then the OAM buffer C000.. = 4 rows of 6 objects: y 10, 20, 30,
 *  40, x 40..68 step 8, tiles 0, 2, .. 2E, attributes 10. */
function mapToObjects(g: Game): void {
  const m = g.m;
  let de = 0x8000;
  let c = 0x00;
  do {
    for (let b = 0x07; b < 0x0d; b++) de = mapCellOut(g, b, c, de);
    c = (c + 0x40) & 0xff;
  } while (c);
  let hl = 0xc000;
  let e = 0;
  let a = 0;
  do {
    a = (a + 0x10) & 0xff;
    c = a;
    let b = 0x40;
    do {
      m.wr(hl++, c);
      m.wr(hl++, b);
      b = (b + 0x08) & 0xff;
      m.wr(hl++, (e * 2) & 0xff);
      e = (e + 1) & 0xff;
      m.wr(hl++, 0x10);
    } while (b < 0x70);
    a = c;
  } while (a !== 0x40);
}

/** 03:7E74 (bank 03, through 00:3740) — the monster as objects: the map 9800-98FF -> DF00
 *  (00:20FF), its cells as object tiles and objects (03:7EAA); the tiles 8000-82FF -> D300
 *  (00:20FF), each tile line's low plane = ~low ^ high (0x180 lines), D300 -> 8000 (00:20FF). */
function monsterToObjects(g: Game): void {
  const m = g.m;
  vramCopy(m, 0x9800, 0xdf00, 0x0100);
  mapToObjects(g);
  vramCopy(m, 0x8000, 0xd300, 0x0300);
  let hl = 0xd300;
  for (let n = 0x180; n; n--) {
    const a = (~m.rd(hl) & 0xff) ^ m.rd(hl + 1);
    m.wr(hl, a);
    hl += 2;
  }
  vramCopy(m, 0xd300, 0x8000, 0x0300);
}

// ---------------------------------------------------------------- bank 0E

/** 0E:7DAD — the 8 bits of the mask byte at de (MSB first): each set bit stores tile c at hl
 *  (c + 1); hl + 1 a bit. Returns [hl, de, c]. */
function maskByte(m: Memory, hl: number, de: number, c: number): [number, number, number] {
  let a = m.rd(de);
  de = (de + 1) & 0xffff;
  for (let b = 8; b; b--) {
    const bit = a & 0x80;
    a = (a << 1) & 0xff;
    if (bit) { m.wr(hl, c); c = (c + 1) & 0xff; }
    hl = (hl + 1) & 0xffff;
  }
  return [hl, de, c];
}

/** 0E:7D6C — bc picture bytes hl -> 9000 (00:20FF); DF00-DFFF = FF (00:3921); the map from the
 *  mask de (8 rows of 2 bytes, 0E:7DAA twice a row, rows 20 apart from DF02): set bits get tiles
 *  0, 1, ..; DF00-DFFF -> 9800 (00:20FF). */
function pictureFromMask(m: Memory, hl: number, de: number, bc: number): void {
  vramCopy(m, hl, 0x9000, bc);
  fillBC(m, 0xdf00, 0x0100, 0xff);
  hl = 0xdf02;
  let c = 0;
  for (let b = 8; b; b--) {
    [hl, de, c] = maskByte(m, hl, de, c);
    [hl, de, c] = maskByte(m, hl, de, c);
    hl = (hl + 0x10) & 0xffff;
  }
  vramCopy(m, 0xdf00, 0x9800, 0x0100);
}

/** 0E:7D63 (bank 0E, through 00:3740) — the new picture: 5A0 bytes of 0E:6735 with the mask
 *  0E:7D9A (0E:7D6C). */
function newMonsterPicture(g: Game): void {
  pictureFromMask(g.m, 0x6735, 0x7d9a, 0x05a0);
}

// ---------------------------------------------------------------- 02:50ED

/** 02:4FC5 — the OAM buffer C000-C077 cleared (30 objects). */
function clearOamBuffer(g: Game): void {
  fill(g.m, 0xc000, 0x78, 0x00);
}

/** 02:51E0 — b = [hl + DE11 - 1]; c times: a frame, BGP = b down to line 5A, then D2. */
function* flashBand(g: Game, hl: number, c: number): Co {
  const m = g.m;
  const b = m.rd(add8(hl, (m.rd(0xde11) - 1) & 0xff));
  do {
    yield* g.wait(1);
    m.wr(BGP, b);
    yield* g.untilLine(0x5a);
    m.wr(BGP, 0xd2);
    c = (c - 1) & 0xff;
  } while (c);
}

/** 02:50ED — effect 12, CC5C & 3 = 2 (the monster changes): the old monster as objects
 *  (02:4192: rst $30 to 03:7E74), a frame, SCY 40, OBP1 D8, the new picture in the background
 *  (02:41A3: rst $30 to 0E:7D63); then 7F frames (d = 7F..1): SCY from 02:51CC + (d >> 1 & 3)
 *  (sound 1C when that is 0), SCX = d (-d for odd d), BGP from 02:4430 + (d >> 5 & 3), down to
 *  line 48, then SCX = SCY = 0 (02:51C4), BGP D2; sound 1C, the OAM buffer cleared (02:4FC5),
 *  0x30 one-frame flashes from 02:51CA (02:51E0, DE11 30..1), D300-D5FF = FF (00:3921).
 *  Bank 02 selected. */
export function* monsterTransform(g: Game): Co {
  const m = g.m;
  yield* rst30(g, 0x03, 0x3740, function* () { monsterToObjects(g); });
  yield* g.wait(1);
  m.wr(SCY, 0x40);
  m.wr(OBP1, 0xd8);
  yield* rst30(g, 0x0e, 0x3740, function* () { newMonsterPicture(g); });
  let d = 0x7f;
  do {
    yield* g.wait(1);
    const k = (d >> 1) & 0x03;
    if (!k) g.sfx(0x1c);
    m.wr(SCY, m.rd(add8(0x51cc, k)));
    m.wr(SCX, d & 0x01 ? (-d) & 0xff : d);
    m.wr(BGP, m.rd(add8(0x4430, (d >> 5) & 0x03)));
    yield* g.untilLine(0x48);
    m.wr(SCX, 0);
    m.wr(SCY, 0);
    m.wr(BGP, 0xd2);
    d = (d - 1) & 0xff;
  } while (d);
  g.sfx(0x1c);
  clearOamBuffer(g);
  m.wr(0xde11, 0x30);
  do {
    yield* flashBand(g, 0x51ca, 0x01);
    m.wr(0xde11, (m.rd(0xde11) - 1) & 0xff);
  } while (m.rd(0xde11));
  fillBC(m, 0xd300, 0x0300, 0xff);
}

// ---------------------------------------------------------------- 09:5466, tables 6-F

/** 00:391B — the byte at hl in bank a (rst $20 / rst $28 around it). */
function byteOfBank(g: Game, a: number, hl: number): number {
  pushBank(g, a);
  const v = g.m.rd(hl);
  popBank(g);
  return v;
}

/** 09:551E — byte 0: C9AD = 0B:7104[high nibble]; C9AF = C9B2 = low nibble, C9AE =
 *  0B:7114[low nibble]; C9AF = 0, then C9AE when the low nibble was 1 or 2. Returns hl + 1. */
function recordKind(g: Game, hl: number): number {
  const m = g.m;
  let a = (m.rd(hl) >> 4) & 0x0f;
  m.wr(0xc9ad, byteOfBank(g, 0x0b, add8(0x7104, a)));
  a = m.rd(hl) & 0x0f;
  hl = (hl + 1) & 0xffff;
  m.wr(0xc9af, a);
  m.wr(0xc9b2, a);
  m.wr(0xc9ae, byteOfBank(g, 0x0b, add8(0x7114, a)));
  const v = m.rd(0xc9af);
  m.wr(0xc9af, 0);
  if (((v - 1) & 0xff) < 0x02) m.wr(0xc9af, m.rd(0xc9ae));
  return hl;
}

/** The field readers 09:5557-5592 of table 0 from reader `from` (0..5: 5557 C9B6, 555C C9B3 /
 *  C9BC (C9AF = 0 for 0A-0C), 5575 C9BD, 557A C9BB / C9BE, 558D C9BA, 5592 C9B0 / C9B1), each
 *  reading [hl+]. */
function table0Fields(g: Game, hl: number, from: number): void {
  const m = g.m;
  const steps: Array<() => void> = [
    () => { m.wr(0xc9b6, m.rd(hl)); hl = (hl + 1) & 0xffff; }, // 09:5557
    () => { // 09:555C
      m.wr(0xc9b3, (m.rd(hl) >> 6) & 0x03);
      const a = m.rd(hl) & 0x3f;
      hl = (hl + 1) & 0xffff;
      m.wr(0xc9bc, a);
      if (a >= 0x0a && a < 0x0d) m.wr(0xc9af, 0);
    },
    () => { m.wr(0xc9bd, m.rd(hl)); hl = (hl + 1) & 0xffff; }, // 09:5575
    () => { // 09:557A
      m.wr(0xc9bb, (m.rd(hl) >> 6) & 0x03);
      m.wr(0xc9be, m.rd(hl) & 0x3f);
      hl = (hl + 1) & 0xffff;
    },
    () => { m.wr(0xc9ba, m.rd(hl)); hl = (hl + 1) & 0xffff; }, // 09:558D
    () => { // 09:5592
      m.wr(0xc9b0, (m.rd(hl) >> 4) & 0x0f);
      m.wr(0xc9b1, m.rd(hl) & 0x0f);
      hl = (hl + 1) & 0xffff;
    },
  ];
  for (let i = from; i < steps.length; i++) steps[i]!();
}

/** 09:5466, table k = 6..F (C99B high nibble): `jp hl` with hl = 09:5479 + 3 k and a = 3 k
 *  lands inside the code of table 0 (09:5488-54A8), all of whose paths end at 09:54A8 (jp 5478,
 *  a ret):
 *  6 (548B): table 0 with the base 09:548B instead of 09:55C4 (hl = 548B + 3 (2 (D0 + c)) +
 *    (D0 + c), 8-bit steps; 09:551E then all six readers);
 *  7 (548E): hl = 548E + 15 + 3 x 2A = 5521, 09:551E, the six readers;
 *  8 (5491): hl = 5491 + 2 x 18 = 54C1, 09:551E, the six readers;
 *  9 (5494, `ld e,55`): hl = 5494, the readers from 09:5557 (no 09:551E);
 *  A (5497, `ld d,a / ld d,l`): from 09:555C; B (549A, `ld e,h / ld d,l`): from 09:5575;
 *  C (549D, `ld [hl],l / ld d,l`): the ROM write 549D = 9D (an MBC register write: RAM bank /
 *    upper ROM bits, without effect for this 512 KiB cartridge), from 09:557A;
 *  D (54A0, `ld a,d / ld d,l`): from 09:558D; E (54A3, `adc a,l / ld d,l`): 09:5592 only;
 *  F (54A6, `sub d / ld d,l`): nothing (jp 5478).
 *  The readers read [hl+] of bank 09 (selected). c = C99D. */
export function abilityRecordStray(g: Game, k: number, c: number): void {
  const m = g.m;
  switch (k) {
    case 0x6: {
      const a1 = (0xd0 + c) & 0xff;
      const a2 = (a1 * 2) & 0xff;
      const hl = add8(add8(add8(add8(0x548b, a1), a2), a2), a2);
      table0Fields(g, recordKind(g, hl), 0);
      return;
    }
    case 0x7: table0Fields(g, recordKind(g, 0x5521), 0); return;
    case 0x8: table0Fields(g, recordKind(g, 0x54c1), 0); return;
    case 0x9: table0Fields(g, 0x5494, 0); return;
    case 0xa: table0Fields(g, 0x5497, 1); return;
    case 0xb: table0Fields(g, 0x549a, 2); return;
    case 0xc:
      m.wr(0x549d, 0x9d); // ld [hl],l
      table0Fields(g, 0x549d, 3);
      return;
    case 0xd: table0Fields(g, 0x54a0, 4); return;
    case 0xe: table0Fields(g, 0x54a3, 5); return;
    case 0xf: return;
    default:
      throw new NotPorted(`09:5466 stray table ${k} (tables 0-5 are in banim.ts)`);
  }
}
