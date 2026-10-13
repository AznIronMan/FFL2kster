/** Legend I facilities (00:300E, event command 4 by C3AA): inn F0 (00:2EA2), house of life F1
 *  (00:2DAD), guild F2+ (00:2D26, class list C3AA - F2), shops 00-EF (00:3023, shop C3AA: 10
 *  items at 05:7D10 + 10 shop, prices 05:7E10 + 3 id BCD); and command A, an item for the bag
 *  (00:1A2E). Money: CC8D-CC8F BCD (4-byte add from CC8D..CC90). */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { div16, sub16 } from "../sys.js";
import { adcDaa, sbcDaa } from "../bcd.js";
import { MainMenu, recordOffset } from "./menumain.js";
import { frame } from "../title.js";
import { rechargeAbilities } from "./items.js";
import { windowTop } from "./load.js";
import type { Title } from "../title.js";
import type { Dialogue } from "./dialogue.js";

export class Facilities {
  constructor(readonly g: Game, readonly mm: MainMenu, readonly title: Title, readonly dialogue: Dialogue) {}

  get m(): Memory {
    return this.g.m;
  }

  /** 00:300E */
  *run(): Co {
    const mm = this.mm;
    yield* mm.clearWindow();
    windowTop(this.m);
    yield* mm.hideSprites();
    yield* mm.menuTiles();
    const a = this.m.rd(0xc3aa);
    if (a === 0xf0) return yield* this.inn();
    if (a === 0xf1) return yield* this.houseOfLife();
    if (a >= 0xf2) return yield* this.guild();
    return yield* this.shop();
  }

  /** 00:2D3A — leave: no pending event, back to the field screen (00:26CE). */
  private *leave(): Co {
    this.m.wr(0xc3ab, 0);
    yield* this.mm.close();
  }

  /** 00:2E36 — a message (UI string e) in the 9 x 4 window at 9D4A. */
  private *message(e: number): Co {
    const mm = this.mm;
    mm.box(0x09, 0x04);
    yield* mm.blit(0x9d29, 0x0b, 0x06);
    mm.clear();
    yield* mm.ui(0x09, e, 0xc600);
    yield* mm.blit(0x9d4a, 0x09, 0x04);
  }

  /** 00:2F29 — a message in the 11 x 8 window at 9CE9. */
  private *message2(e: number): Co {
    const mm = this.mm;
    mm.box(0x09, 0x06);
    yield* mm.ui(0x0b, e, 0xc617);
    yield* mm.blit(0x9ce9, 0x0b, 0x08);
  }

  /** 00:2E80 — the party window at 9CE1 (b, c = 7, 2). */
  private *party(): Co {
    const mm = this.mm;
    mm.box(0x07, 0x08);
    yield* mm.memberSprites();
    yield* mm.ui(0x09, 0x02, 0xc60a, 0x07, 0x02);
    yield* mm.blit(0x9ce1, 0x09, 0x0a);
  }

  /** 00:2FB8 — the money window at de. */
  private *moneyWindow(de: number): Co {
    const mm = this.mm;
    mm.box(0x08, 0x02);
    mm.money();
    yield* mm.ui(0x0a, 0x1c, 0xc615);
    yield* mm.blit(de, 0x0a, 0x04);
  }

  // ------------------------------------------------------------ guild

  private *guild(): Co {
    const m = this.m, mm = this.mm;
    for (;;) {
      yield* mm.clearWindow();
      yield* mm.hideSprites();
      // 00:2D89
      yield* mm.clearWindow();
      mm.box(0x0c, 0x02);
      yield* mm.ui(0x0e, 0x29, 0xc61d);
      yield* mm.blit(0x9c03, 0x0e, 0x04);
      yield* this.party();
      yield* this.message(0x2b);
      const a = yield* mm.menu(0x3f08, 0);
      if (a === 0xff) return yield* this.leave();
      if (a === m.rd(0xcc8c)) {
        yield* this.message(0x2a);
        yield* mm.waitKey();
        continue;
      }
      const rec = 0xcc00 | recordOffset(a);
      if (!(m.rd(rec) & 1)) {
        yield* this.message(0x2d);
        yield* mm.waitKey();
        continue;
      }
      yield* this.message2(0x2c);
      if ((yield* mm.menu(0x3f02, 0)) !== 0) continue;
      yield* this.title.create(a, (m.rd(0xc3aa) - 0xf2) & 0xff);
    }
  }

  // ------------------------------------------------------------ house of life

  private *houseOfLife(): Co {
    const m = this.m, mm = this.mm;
    yield* mm.clearWindow();
    yield* mm.hideSprites();
    for (;;) {
      yield* this.lifeWindow();
      const a = yield* mm.menu(0x3f08, 0);
      if (a === 0xff) return yield* this.leave();
      const rec = 0xcc00 | recordOffset(a);
      const st = m.rd(rec);
      if (st === 0xff) continue;
      if (!(st & 1)) { yield* this.message(0x28); yield* mm.waitKey(); continue; }
      const h = rec + 0x0a;
      if (!(m.rd(h) & 0x0f)) { yield* this.message(0x24); yield* mm.waitKey(); continue; }
      m.wr(0xc400, 0); m.wr(0xc401, 1); m.wr(0xc402, 0);
      if (this.pay()) { yield* this.message(0x25); yield* mm.waitKey(); continue; }
      m.wr(h, m.rd(h) - 1);
      m.wr(rec, m.rd(rec) & 0xfe);
      m.wr(rec + 6, 1);
      m.wr(rec + 7, 0);
      yield* this.lifeWindow();
      yield* this.message(0x26);
      yield* mm.waitKey();
    }
  }

  /** 00:2E59 */
  private *lifeWindow(): Co {
    const mm = this.mm;
    mm.box(0x10, 0x04);
    yield* mm.ui(0x12, 0x23, 0xc625);
    yield* mm.blit(0x9c01, 0x12, 0x06);
    yield* this.moneyWindow(0x9dca);
    yield* this.party();
    yield* this.message(0x27);
  }

  /** 00:32ED with C402 / CC8F / FFC2 — money - price (C400-C402); true (carry) if short,
   *  else the money is updated. */
  private pay(): boolean {
    return bcdSub3(this.m, 0xcc8f, 0xc402, 0xffc2);
  }

  // ------------------------------------------------------------ inn

  private *inn(): Co {
    const m = this.m, mm = this.mm;
    yield* mm.clearWindow();
    yield* mm.hideSprites();
    for (;;) {
      yield* this.innWindow();
      if ((yield* mm.menu(0x3f02, 0)) !== 0) return yield* this.leave();
      if (this.pay()) {
        yield* mm.hideSprites(0xc090, 4);
        yield* this.message2(0x25);
        yield* mm.waitKey();
        continue;
      }
      for (let k = 0; k < 4; k++) {
        const rec = 0xcc00 + 31 * k;
        if (m.rd(rec) & 3) continue;
        m.wr(rec + 6, m.rd(rec + 8));
        m.wr(rec + 7, m.rd(rec + 9));
      }
      for (let k = 0; k < 4; k++) {
        const rec = 0xcc00 + 31 * k;
        if (m.rd(rec) & 3) continue;
        rechargeAbilities(this.g, rec + 0x0f);
      }
      rechargeAbilities(this.g, 0xcc7c);
      yield* mm.hideSprites(0xc090, 4);
      yield* this.innWindow();
      m.hram[0x64] = 0x15;
      yield* this.message2(0x2e);
      yield* mm.waitKey();
      return yield* this.leave();
    }
  }

  /** 00:2F40 — the inn window; the price C400-C402 = the party's missing HP (BCD). */
  private *innWindow(): Co {
    const m = this.m, mm = this.mm;
    mm.box(0x0e, 0x04);
    yield* mm.ui(0x10, 0x21, 0xc622);
    yield* mm.blit(0x9c01, 0x10, 0x06);
    yield* this.moneyWindow(0x9dca);
    yield* this.party();
    let bc = 0;
    for (let k = 0; k < 4; k++) {
      const rec = 0xcc00 + 31 * k;
      if (m.rd(rec) & 3) continue;
      bc = (bc + ((m.rd16(rec + 8) - m.rd16(rec + 6)) & 0xffff)) & 0xffff;
    }
    // to BCD: 00:2FDF / 00:2FD2 (07B5 leaves each count in FF88)
    let hl = bc, p = 0xc400;
    m.wr(p, 0);
    const digits = (de: number): number => {
      let a = 0xff;
      for (;;) {
        a = (a + 1) & 0xff;
        const r = sub16(m, a, hl, de);
        hl = r.hl;
        if (r.carry) break;
      }
      hl = (hl + de) & 0xffff;
      return a;
    };
    m.wr(p, m.rd(p) | digits(10000)); p++;
    m.wr(p, (digits(1000) << 4) & 0xff);
    m.wr(p, m.rd(p) | digits(100)); p++;
    m.wr(p, (digits(10) << 4) & 0xff);
    m.wr(p, m.rd(p) | (hl & 0xff));
    yield* this.message2(0x22);
  }

  // ------------------------------------------------------------ shops

  private *shop(): Co {
    const m = this.m, mm = this.mm;
    for (;;) {
      yield* mm.clearWindow();
      yield* mm.hideSprites();
      yield* this.shopWindow();
      const a = yield* mm.menu(0x3edb, 0);
      if (a === 0) yield* this.buy();
      else if (a === 1) yield* this.sell();
      else return yield* this.leave();
    }
  }

  /** 00:3296 */
  private *shopWindow(): Co {
    const mm = this.mm;
    mm.box(0x05, 0x06);
    yield* mm.ui(0x07, 0x15, 0xc610);
    yield* mm.blit(0x9c01, 0x07, 0x08);
    yield* this.moneyWindow(0x9c07);
    yield* this.bottom(0x16);
  }

  /** 00:2D0C + rst $08 (e at C62A, width 20) + 00:2CE9 (blit to 9D40). */
  private *bottom(e: number, b?: number, c?: number): Co {
    const mm = this.mm;
    mm.box(0x12, 0x06);
    yield* mm.ui(0x14, e, 0xc62a, b, c);
    yield* mm.blit(0x9d40, 0x14, 0x08);
  }

  /** 00:303E — sell. */
  private *sell(): Co {
    const m = this.m, mm = this.mm;
    mm.copyCursor(0xc070);
    for (;;) {
      yield* mm.hideSprites(0xc080, 4);
      yield* this.sellWindow();
      const a = yield* mm.menu(0x3eef, 5, 0x9c2a, 0x09, 0x08);
      if (a === 0xff) return;
      m.wr(0xc5c6, a);
      mm.copyCursor(0xc080);
      if (yield* this.sellPrice()) {
        yield* this.bottom(0x1d);
        yield* mm.hideSprites();
        yield* mm.waitKey();
        continue;
      }
      if ((yield* mm.menu(0x3efd, 0)) !== 0) continue;
      const hl = 0xcc7c + ((m.rd(0xc5c6) * 2) & 0xff);
      m.wr(hl + 1, 0xff);
      bcdAdd4(m, 0xc53d, 0xcc90);
      m.hram[0x64] = 0x17;
    }
  }

  /** 00:30FC */
  private *sellWindow(): Co {
    const mm = this.mm;
    yield* this.bottom(0x1e);
    mm.box(0x0a, 0x08);
    yield* mm.blit(0x9c08, 0x0c, 0x0a);
    mm.clear();
    yield* mm.itemList(0xcc7c);
    yield* mm.blit(0x9c2a, 0x09, 0x08);
  }

  /** 00:30A9 — the sale price of bag slot C5C6 (half the price, scaled by uses left) to
   *  C53A-C53C and the message; true (z) when the slot is empty. */
  private *sellPrice(): Co<boolean> {
    const g = this.g, m = this.m;
    const de = 0xcc7d + ((m.rd(0xc5c6) * 2) & 0xff);
    if (m.rd(de) === 0xff) return true;
    const id = m.rd(de - 1), c = m.rd(de);
    g.selectBank(0x05);
    copyN(m, (id * 3 + 0x7e10) & 0xffff, 0xc53a, 3);
    g.selectBank(0x05);
    const b = m.rd((id * 8 + 0x4647) & 0xffff);
    salePrice(m, 0xc53a, b, c);
    this.mm.money(0xc53a);
    yield* this.bottom(0x19);
    return false;
  }

  /** 00:312C — buy. */
  private *buy(): Co {
    const g = this.g, m = this.m, mm = this.mm;
    mm.copyCursor(0xc070);
    yield* this.shopList();
    const d = yield* mm.menu(0x3ee3, (m.rd(0xc5c7) + 1) & 0xff, 0x9d62, 0x11, 0x06);
    if (d === 0xff) return;
    yield* mm.hideSprites();
    const e = (m.rd(0xc3aa) * 10 + d) & 0xff;
    g.selectBank(0x05);
    const src = 0x7d10 + e;
    if (m.rd(src) === 0xff) {
      yield* this.bottom(0x1d);
      yield* mm.hideSprites();
      yield* mm.waitKey();
      return;
    }
    let hl = 0xcc7d;
    for (let b = 8; b; b--, hl += 2) {
      if (m.rd(hl) !== 0xff) continue;
      hl--;
      const id = m.rd(src);
      m.wr(hl, id);
      g.selectBank(0x05);
      const short = bcdSub3(m, 0xcc8f, (id * 3 + 0x7e12) & 0xffff, 0xffc2);
      if (short) {
        m.wr(hl, 0xff);
        yield* this.bottom(0x1a);
        yield* mm.waitKey();
        return;
      }
      g.selectBank(0x05);
      m.wr(hl + 1, m.rd((m.rd(hl) * 8 + 0x4647) & 0xffff));
      m.wr(0xffb2, m.rd(hl));
      yield* this.bottom(0x18, 0xff, m.rd(hl));
      m.hram[0x64] = 0x17;
      yield* mm.waitKey();
      return;
    }
    yield* this.bottom(0x20);
    yield* mm.waitKey();
  }

  /** 00:31FE — the shop's items (C3D0/C3DA, C5C7 = pages) and prices (C400 + 3k). */
  private *shopList(): Co {
    const g = this.g, m = this.m, mm = this.mm;
    mm.clear();
    mm.box(0x12, 0x06);
    yield* mm.blit(0x9d40, 0x14, 0x08);
    const shop = (0x7d10 + ((m.rd(0xc3aa) * 10) & 0xff)) & 0xffff;
    let hl = shop, de = 0xc3d0, bc = 0xc3da;
    let pages = 7;
    for (let a = 0x0a; a; a--) {
      g.selectBank(0x05);
      const id = m.rd(hl++);
      if (id === 0xff) { pages = 7 - a < 0 ? 0 : 7 - a; break; }
      m.wr(de++, id);
      g.selectBank(0x05);
      m.wr(bc++, m.rd((id * 8 + 0x4647) & 0xffff));
    }
    m.wr(0xc5c7, pages);
    g.selectBank(0x05);
    hl = shop;
    de = 0xc400;
    for (let a = 0x0a; a; a--) {
      const id = m.rd(hl++);
      copyN(m, (id * 3 + 0x7e10) & 0xffff, de, 3);
      de += 3;
    }
    mm.clear();
    mm.b = 0x7e; mm.c = 0x10;
    yield* mm.ui(0x11, 0x05, 0xc611);
    yield* mm.ui(0x11, 0x1f, 0xc721);
    yield* mm.ui(0x11, 0x17, 0xc61a);
    yield* mm.blit(0x9d62, 0x11, 0x06);
  }

  // ------------------------------------------------------------ an item for the bag

  /** 00:1A2E — event A: item C3AA into a free bag slot; a full bag asks which item to drop
   *  (menu 3F8B), then tries again. */
  *giveItem(): Co {
    const g = this.g, m = this.m, mm = this.mm, dl = this.dialogue;
    for (;;) {
      let bc = 0xcc7d;
      for (let e = 8; e; e--, bc += 2) {
        if (m.rd(bc) !== 0xff) continue;
        const id = m.rd(0xc3aa);
        m.wr(bc - 1, id);
        g.selectBank(0x05);
        m.wr(bc, m.rd((id * 8 + 0x4647) & 0xffff));
        dl.close();
        return;
      }
      yield* dl.open();
      yield* dl.show(0x1c22);
      yield* dl.showWait(0x1c17);
      mm.clear();
      frame(g, 0xc600, 0x0a, 0x06);
      yield* mm.blit(0x9c08, 0x0c, 0x08);
      mm.clear();
      yield* mm.itemList(0xcc7c);
      let a: number;
      do {
        yield* mm.blit(0x9c2a, 0x09, 0x06);
        m.wr(0xc5cb, 1);
        a = yield* mm.menu(0x3f8b, 6, 0x9c2a, 0x09, 0x06);
      } while (a === 0xff);
      m.wr(0xcc7d + ((a * 2) & 0xff), 0xff);
      yield* mm.hideSprites(0xc090, 4);
      yield* dl.open();
      m.wr(0xc5cb, 0);
    }
  }
}


function copyN(m: Memory, hl: number, de: number, n: number): void {
  for (let k = 0; k < n; k++) m.wr(de + k, m.rd(hl + k));
}

/** 00:32ED — 3-byte BCD [de] - [hl] (pointers at the last byte) into bc..; on no borrow copied
 *  back to de. Returns true on borrow. */
export function bcdSub3(m: Memory, de: number, hl: number, bc: number): boolean {
  let c = 0;
  for (let k = 0; k < 3; k++) {
    let r: number;
    [r, c] = sbcDaa(m.rd(de - k), m.rd(hl - k), c);
    m.wr(bc - k, r);
  }
  if (c) return true;
  for (let k = 0; k < 3; k++) m.wr(de - 2 + k, m.rd(bc - 2 + k));
  return false;
}

/** 00:32D2 — 4-byte BCD [hl] += [de] (pointers at the last byte); overflow -> 99999999. */
export function bcdAdd4(m: Memory, de: number, hl: number): void {
  let c = 0;
  for (let k = 0; k < 4; k++) {
    let r: number;
    [r, c] = adcDaa(m.rd(de - k), m.rd(hl - k), c);
    m.wr(hl - k, r);
  }
  if (!c) return;
  for (let k = 0; k < 4; k++) m.wr(hl - 3 + k, 0x99);
}

/** 00:330B — sale price of a 3-byte BCD price at hl: uses c of default b: price/2 when full,
 *  else price * (uses * 16 / b) / 32 (BCD, digits at C52D-C53C as the routine does). */
export function salePrice(m: Memory, hl: number, b: number, c: number): void {
  if (c === b) return bcdDiv(m, hl, 2);
  const de = ((c >> 4) << 8) | ((c << 4) & 0xf0);
  const [q] = div16(m, de, b);
  const ql = q & 0xff;
  bcdMulDigits(m, hl, ql % 10, 0xc532);
  pack6(m, 0xc52d);
  bcdMulDigits(m, hl, Math.floor(ql / 10), 0xc539);
  pack8(m, 0xc533);
  let cy = 0;
  const bc = hl + 2;
  for (let k = 0; k < 4; k++) {
    let r: number;
    [r, cy] = adcDaa(m.rd(0xc52f - k), m.rd(0xc536 - k), cy);
    m.wr(bc - k, r);
  }
  bcdDiv(m, hl, 0x20);
}

/** 00:3378 — 3-byte BCD at hl times digit e, 6 digits written down from bc (carries ahead). */
function bcdMulDigits(m: Memory, hl: number, e: number, bc: number): void {
  m.wr(bc, 0);
  const nib = [m.rd(hl + 2) & 15, m.rd(hl + 2) >> 4, m.rd(hl + 1) & 15, m.rd(hl + 1) >> 4, m.rd(hl) & 15, m.rd(hl) >> 4];
  for (const n of nib) {
    // 00:33FF: n * e by daa additions
    let p = 0;
    if (n) { for (let d = n; d; d--) [p] = adcDaa(p, e, 0); }
    const [s] = adcDaa(m.rd(bc), p, 0);
    m.wr(bc, s & 15);
    bc--;
    m.wr(bc, s >> 4);
  }
}
/** 00:33AD — 6 digits at bc packed into 3 bytes at bc. */
function pack6(m: Memory, bc: number): void {
  const c = ((m.rd(bc) << 4) | m.rd(bc + 1)) & 0xff, b = ((m.rd(bc + 2) << 4) | m.rd(bc + 3)) & 0xff, a = ((m.rd(bc + 4) << 4) | m.rd(bc + 5)) & 0xff;
  m.wr(bc, c); m.wr(bc + 1, b); m.wr(bc + 2, a);
}
/** 00:33C9 — 8 digits at bc packed into 4 bytes at bc (the last without its low digit). */
function pack8(m: Memory, bc: number): void {
  const v = [((m.rd(bc) << 4) | m.rd(bc + 1)) & 0xff, ((m.rd(bc + 2) << 4) | m.rd(bc + 3)) & 0xff,
    ((m.rd(bc + 4) << 4) | m.rd(bc + 5)) & 0xff, (m.rd(bc + 6) << 4) & 0xff];
  v.forEach((x, k) => m.wr(bc + k, x));
}
/** 00:3409 — 3-byte BCD at hl divided by e, digit by digit (8-bit arithmetic as 00:3450). */
function bcdDiv(m: Memory, hl: number, e: number): void {
  // 00:3452: count subtractions of e from a (d continues), then a = remainder * 10 (8-bit)
  const loop = (d: number, a: number): [number, number] => {
    for (;;) {
      d = (d + 1) & 0xff;
      const borrow = a < e;
      a = (a - e) & 0xff;
      if (borrow) break;
    }
    a = (a + e) & 0xff;
    const c = (a * 2) & 0xff;
    a = (((((c * 2) & 0xff) * 2) & 0xff) + c) & 0xff;
    return [d, a];
  };
  let c = 0;
  for (let k = 0; k < 3; k++) {
    const v = m.rd(hl + k);
    let [d, a] = loop(0xff, ((v >> 4) + c) & 0xff);
    a = ((v & 0x0f) + a) & 0xff;
    d = ((((d << 4) | (d >> 4)) & 0xff) - 1) & 0xff;
    [d, a] = loop(d, a);
    m.wr(hl + k, d);
    c = a;
  }
}
