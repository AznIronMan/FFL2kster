/** Bank-1 shops and inns (01:628A-6690) and the party recovery routines they share with the
 *  Start menu and scripts (01:6332 full recovery, 01:6448 heal by BC), plus the bank-0
 *  arithmetic they use (00:03DC 24x8 multiply, 00:040B 24/8 divide). State lives at the
 *  original addresses: shop stock C71D (8 x id, uses), prices C745 (8 x 3 bytes), bought item
 *  C73B/C73C, sale price C760, GP C2A2, bag C2B9 (16 x id, uses). */
import type { Co } from "../game.js";
import type { Memory } from "../memory.js";
import type { Engine } from "../engine.js";
import { vsync, joyFrame, waitRelease, fill, copy, memberAddr, varGet, lt24, sub24, add24 } from "../sys.js";
import { beep, confirm } from "./engine.js";

// ---------------------------------------------------------------- bank-0 routines

/** 00:0608 — the guest (party slot 4) is present: progress variable 0 != 0. */
export function r00_0608(m: Memory): boolean {
  return varGet(m, 0) !== 0;
}

/** 00:03DC — [de] (24 bits) times a, as the original's shift-add loop: the 32-bit product is
 *  written to de..de+3. */
export function r00_03DC(m: Memory, de: number, a: number): void {
  let e = m.rd(de), d = m.rd(de + 1), l = m.rd(de + 2), acc = 0, cy = 0;
  const h = a & 0xff;
  const rr = (v: number): number => {
    const n = (v >> 1) | (cy << 7);
    cy = v & 1;
    return n;
  };
  for (let b = 0; b < 24; b++) {
    l = rr(l); d = rr(d); e = rr(e);
    if (cy) {
      acc += h;
      cy = acc > 0xff ? 1 : 0;
      acc &= 0xff;
    }
    acc = rr(acc);
  }
  l = rr(l); d = rr(d); e = rr(e);
  m.wr(de, e); m.wr(de + 1, d); m.wr(de + 2, l); m.wr(de + 3, acc);
}

/** 00:040B — [de] (24 bits) divided by a (restoring division with an 8-bit remainder, as the
 *  original); the quotient replaces [de], the remainder is returned. */
export function r00_040B(m: Memory, de: number, a: number): number {
  const h = a & 0xff, b = (-a) & 0xff;
  let e = m.rd(de), d = m.rd(de + 1), c = m.rd(de + 2), acc = 0;
  for (let l = 0; l < 24; l++) {
    let cy = e >> 7; e = (e << 1) & 0xff;
    let n = (d << 1) | cy; cy = n >> 8; d = n & 0xff;
    n = (c << 1) | cy; cy = n >> 8; c = n & 0xff;
    acc = ((acc << 1) | cy) & 0xff;
    acc += b;
    if (acc > 0xff) { acc &= 0xff; continue; }
    acc = (acc + h) & 0xff;
    e = (e + 1) & 0xff;
  }
  m.wr(de, ~e & 0xff); m.wr(de + 1, ~d & 0xff); m.wr(de + 2, ~c & 0xff);
  return acc;
}

// ---------------------------------------------------------------- shops, inns, recovery

export class ShopMenus {
  constructor(readonly e: Engine) {}

  get m(): Memory {
    return this.e.g.m;
  }

  /** 01:664D — wait for the buttons to be released, then for a new press. */
  *waitPress(): Co {
    yield* waitRelease(this.e.g);
    while (!(yield* joyFrame(this.e.g)));
  }

  /** 01:5E6C — menu list cleared (00:0536), message e, then message d when the guest is
   *  present (00:0608). */
  *members6C(de: number): Co {
    this.e.bank1.clearMenu(false);
    yield* this.e.text.message(de & 0xff);
    if (!r00_0608(this.m)) return;
    yield* this.e.text.message(de >> 8);
  }

  /** 01:5E65 — FF9B = C796 = 0, then 01:5E6C. */
  *members65(de: number): Co {
    this.m.hram[0x1b] = 0;
    this.m.wr(0xc796, 0);
    yield* this.members6C(de);
  }

  /** 01:6669 — price of item a (0F:7860 + 3a, 3 bytes) to de; item FF → FF FF FF. */
  price(a: number, de: number): void {
    const m = this.m;
    if (a === 0xff) {
      fill(m, de, 3, 0xff);
      return;
    }
    for (let i = 0; i < 3; i++) m.wr(de + i, m.romAt(0x0f, (3 * a + 0x7860 + i) & 0xffff));
  }

  /** 01:6657 — first free bag slot (C2B9 + 2k), or -1 (carry) when the bag is full. */
  freeSlot(): number {
    for (let k = 0, hl = 0xc2b9; k < 0x10; k++, hl += 2) if (this.m.rd(hl) === 0xff) return hl;
    return -1;
  }

  /** 01:643A — default uses of item a (0C:7E80 + a). */
  uses(a: number): number {
    return this.m.romAt(0x0c, 0x7e80 + (a & 0xff));
  }

  /** 01:590C — item a has bit 7 of record byte 2 (0C:6F82 + 8a) set. */
  flag590C(a: number): boolean {
    return (this.m.romAt(0x0c, (0x6f82 + 8 * a) & 0xffff) & 0x80) !== 0;
  }

  /** 01:647A (entry 01:5009) — event kind 4, scene e: shop e (stock 0F:79E0 + 8e, prices
   *  0F:7860), or the inn (01:628A) for e = FF. Called with bank 1 mapped (00:14AC). */
  *shop(e: number): Co {
    const m = this.m, b1 = this.e.bank1, t = this.e.text;
    if (e === 0xff) return yield* this.inn();
    for (let i = 0; i < 8; i++) m.wr(0xc785 + i, m.romAt(0x0f, (0x79e0 + ((8 * e) & 0xff) + i) & 0xffff));
    for (let i = 0; i < 8; i++) {
      const id = m.rd(0xc785 + i);
      m.wr(0xc71d + 2 * i, id);
      m.wr(0xc71e + 2 * i, this.uses(id));
    }
    for (let i = 0; i < 8; i++) this.price(m.rd(0xc71d + 2 * i), 0xc745 + 3 * i);
    yield* vsync(this.e.g);
    m.wr(0xff47, 0); m.wr(0xff48, 0); m.wr(0xff49, 0);
    yield* b1.saveFieldTiles();
    fill(m, 0xc34a, 0x0a, 0);
    m.hram[0x1b] = 0;
    m.wr(0xc798, 1);
    b1.storeCursor(5);
    let redraw = true;
    for (;;) {
      if (redraw) yield* b1.screenMenu(); // 64D7
      redraw = false;
      // 64DA
      b1.reset5E35();
      yield* t.message(0x21);
      yield* t.message(0x22);
      yield* t.message(0x20);
      const a = yield* b1.runMenu(0);
      if (a === 0xff) break;
      confirm(m);
      if (a === 0) {
        yield* this.buy();
        continue;
      }
      if (a !== 1) break;
      yield* this.sell();
      redraw = true;
    }
    yield* b1.backToField(true); // 664A
  }

  /** 01:64FD — buy one item: stock list (message 0x23; only stocked entries are menu items),
   *  bag space, price check; back to the shop menu (01:64DA) in every case. */
  private *buy(): Co {
    const m = this.m, b1 = this.e.bank1, t = this.e.text;
    b1.reset5E35();
    b1.loadCursor(5);
    yield* t.message(0x23);
    let c = 0, hl = 0xc380;
    for (let i = 0; i < 8; i++) {
      if (m.rd(0xc71d + 2 * i) === 0xff) {
        for (let k = i; k < 8; k++, hl += 2) { m.wr(hl, 0xff); m.wr(hl + 1, 0xff); }
        break;
      }
      hl += 2;
      c++;
    }
    m.wr(0xc7ca, c);
    const a = yield* b1.runMenu(0);
    b1.storeCursor(5);
    if (a === 0xff) return;
    const p = 0xc71e + ((2 * a) & 0xff);
    m.wr(0xc73c, m.rd(p));
    m.wr(0xc73b, m.rd(p - 1));
    const id = m.rd(0xc73b);
    if (this.freeSlot() < 0) {
      beep(m); // 657D
      b1.reset5E35();
      yield* t.message(0x2b);
      yield* this.waitPress();
      return;
    }
    this.price(id, 0xc70a);
    if (lt24(m, 0xc2a2, 0xc70a)) {
      beep(m); // 658C
      copy(m, 0xc70a, 0xc760, 3);
      b1.reset5E35();
      yield* t.message(0x25);
      yield* this.waitPress();
      return;
    }
    sub24(m, 0xc2a2, 0xc70a);
    const s = this.freeSlot();
    m.wr(s, m.rd(0xc73b));
    m.wr(s + 1, m.rd(0xc73c));
    m.hram[0x32] = 0x22;
    b1.reset5E35();
    yield* t.message(0x24);
    yield* t.message(0x21);
    yield* this.waitPress();
  }

  /** 01:65A3 — sell: bag list (message 0x26); the price is half the item's, scaled by the uses
   *  left (current / default), at least 1 GP. */
  private *sell(): Co {
    const m = this.m, b1 = this.e.bank1, t = this.e.text;
    for (;;) {
      b1.reset5E35();
      yield* t.message(0x27);
      b1.loadCursor(6);
      yield* t.message(0x26);
      let a: number;
      for (;;) {
        // 65B1
        b1.loadCursor(6);
        a = yield* b1.runMenu(0);
        b1.storeCursor(6);
        if (a === 0xff) return;
        m.wr(0xc70d, a);
        if (m.rd(0xc2b9 + ((2 * a) & 0xff)) !== 0xff) break;
        beep(m);
      }
      confirm(m);
      const hl = 0xc2b9 + ((2 * a) & 0xff);
      m.wr(0xc73c, m.rd(hl + 1));
      m.wr(0xc73b, m.rd(hl));
      this.price(m.rd(hl), 0xc760);
      const max = this.uses(m.rd(0xc73b));
      m.hram[0x12] = max;
      if (m.rd(0xc73c) !== max) {
        r00_040B(m, 0xc760, max);
        r00_03DC(m, 0xc760, m.rd(0xc73c));
      }
      r00_040B(m, 0xc760, 2);
      if (!(m.rd(0xc760) | m.rd(0xc761) | m.rd(0xc762))) m.wr(0xc760, 1);
      b1.reset5E35();
      yield* t.message(0x28);
      const y = yield* b1.runMenu(0);
      if (y === 0xff) continue;
      confirm(m);
      if (y !== 0) continue;
      add24(m, 0xc2a2, 0xc760);
      const s = 0xc2b9 + ((2 * m.rd(0xc70d)) & 0xff);
      m.wr(s, 0xff);
      m.wr(s + 1, 0xff);
    }
  }

  /** 01:628A (entry 01:5012, and 01:647A with e = FF) — the inn: 1 GP per missing HP of the
   *  members that are not dead or stone (C206 & 0x90), then full recovery (01:6332). */
  *inn(): Co {
    const m = this.m, b1 = this.e.bank1, t = this.e.text;
    yield* vsync(this.e.g);
    m.wr(0xff47, 0); m.wr(0xff48, 0); m.wr(0xff49, 0);
    yield* b1.saveFieldTiles();
    yield* b1.screenMenu();
    yield* this.members65(0x1c1b);
    yield* t.message(0x1a);
    yield* t.message(0x1d);
    fill(m, 0xc745, 3, 0);
    for (let k = 0, hl = 0xc207; k < 4; k++, hl += 0x20) this.innCost(hl);
    if (r00_0608(m)) this.innCost(0xc287);
    yield* t.message(0x1e);
    const a = yield* b1.runMenu(0);
    let e = 0x2a;
    if (a !== 0xff) {
      if (a) confirm(m);
      else if (lt24(m, 0xc2a2, 0xc745)) {
        beep(m);
        e = 0x1f;
      } else {
        sub24(m, 0xc2a2, 0xc745);
        m.hram[0x32] = 0x33;
        this.restoreAll();
        b1.reset5E35();
        yield* this.members65(0x1c1b);
        yield* t.message(0x1d);
        e = 0x29;
      }
    }
    fill(m, 0xff97, 4, 0xff);
    yield* t.message(e);
    yield* waitRelease(this.e.g);
    while (!(yield* joyFrame(this.e.g)));
    yield* b1.backToField(true);
  }

  /** 01:630B — add the missing HP (max - current) of the member whose current HP is at hl to
   *  the 16-bit cost C745/C746, unless dead or stone. Slots are taken in memory order. */
  private innCost(hl: number): void {
    const m = this.m;
    if (m.rd(hl - 1) & 0x90) return;
    const cur = m.rd(hl) | (m.rd(hl + 1) << 8);
    const max = m.rd(hl + 2) | (m.rd(hl + 3) << 8);
    const v = (max - cur + (m.rd(0xc745) | (m.rd(0xc746) << 8))) & 0xffff;
    m.wr(0xc745, v & 0xff);
    m.wr(0xc746, v >> 8);
  }

  /** 01:6332 (entry 01:501E) — full recovery: HP of members 0-3 (and the guest) to max, uses
   *  of abilities / monster abilities / robot items restored (01:636C), MAGI uses from 0C:7F80. */
  restoreAll(): void {
    const m = this.m;
    const save = m.rd(0xc709);
    for (let a = 0; a < 4; a++) this.restoreMember(a);
    if (r00_0608(m)) this.restoreMember(4);
    for (let c = 0, hl = 0xc2da; c < 0x0e; c++, hl += 2) {
      if (m.rd(hl) & 0x0f) m.wr(hl + 1, m.romAt(0x0c, 0x7f80 + c));
    }
    m.wr(0xc709, save);
  }

  /** 01:636C — recover member a (C709 = a) unless dead or stone: HP = max; by type C205:
   *  0 human nothing, 1 mutant ability uses (ids >= 0x80), 2 monster the record's ability
   *  uses (0D:6F80 + 10 id), else (robot) items without flag bit 7 get half their uses. */
  private restoreMember(a: number): void {
    const m = this.m;
    m.wr(0xc709, a);
    const st = memberAddr(m, a, 0xc206);
    if (m.rd(st) & 0x90) return;
    m.wr(st + 2, m.rd(st + 4));
    m.wr(st + 1, m.rd(st + 3));
    const type = m.rd(st - 1);
    let hl = st - 1 + 0x0a;
    if (type === 0) return;
    if (type === 1) {
      for (let k = 0; k < 8; k++, hl += 2) {
        const id = m.rd(hl);
        if (id !== 0xff && id >= 0x80) m.wr(hl + 1, this.uses(id));
      }
      return;
    }
    if (type === 2) {
      fill(m, 0xc785, 0x10, 0xff);
      const n = m.rd(memberAddr(m, a, 0xc204));
      const rec = (n * 10 + 0x6f80) & 0xffff;
      const c = m.romAt(0x0d, rec);
      const lst = m.romAt(0x0d, rec + 8) | (m.romAt(0x0d, rec + 9) << 8);
      const cnt = (c & 7) + 1;
      m.hram[0x11] = cnt;
      for (let i = 0; i < cnt; i++) m.wr(0xc785 + i, m.romAt(0x0d, lst + i));
      for (let i = 0; i < cnt; i++) {
        const id = m.rd(0xc785 + i);
        let p = memberAddr(m, m.rd(0xc709), 0xc20f);
        let k = 8;
        for (; k; k--, p += 2) if (m.rd(p) === id) break;
        m.wr(p + 1, this.uses(id));
      }
      return;
    }
    for (let k = 0; k < 8; k++, hl += 2) {
      const id = m.rd(hl);
      if (id === 0xff || this.flag590C(id)) continue;
      m.wr(hl + 1, this.uses(id) >> 1);
    }
  }

  /** 01:6448 (entry 01:5027) — heal members 0-3 (and the guest) not dead or stone by bc HP,
   *  up to their max. */
  healAll(bc: number): void {
    for (let a = 0; a < 4; a++) this.heal(a, bc);
    if (r00_0608(this.m)) this.heal(4, bc);
  }

  /** 01:6455 */
  private heal(a: number, bc: number): void {
    const m = this.m;
    const st = memberAddr(m, a, 0xc206);
    if (m.rd(st) & 0x90) return;
    const max = m.rd(st + 3) | (m.rd(st + 4) << 8);
    let v = ((m.rd(st + 1) | (m.rd(st + 2) << 8)) + bc) & 0xffff;
    if (!(v < max)) v = max;
    m.wr(st + 1, v & 0xff);
    m.wr(st + 2, v >> 8);
  }
}

