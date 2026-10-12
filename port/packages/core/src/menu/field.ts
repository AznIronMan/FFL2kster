/** Bank-1 field menus (01:5471-6332, 01:6A51): the Start menu (abilities, items, equipment,
 *  MAGI, memo, save), the Select menu (formation), using items/abilities/MAGI in the field
 *  (effects by the calc VM, 0C script 5), MAGI bookkeeping and the ending's tile animation.
 *  Shops, inns and recovery are in shop.ts. `installFieldMenus` registers the bank-1 entry
 *  points (jump table 01:5000) in Engine.extra under their original addresses.
 *
 *  Menu cursors are saved per menu at C340 + 2n (01:5271/527C/5287): 5 main, 6 member,
 *  7 list (bag / abilities / MAGI / memo), 8 member slots. Item use: CFF0/CFF1 = id
 *  (CFF1 = 1 for MAGI), CFF2 user, CFF3 target (8 = all), result kind CFF4; FF9D = slot,
 *  C709 = member (FF = bag). FF9E/FF9F: equipment flags / failure (01:5EFE sets FF9F). */
import type { Co } from "../game.js";
import type { Memory } from "../memory.js";
import type { Engine } from "../engine.js";
import type { Regs } from "../text/engine.js";
import { vsync, joyFrame, fill, copy, memberAddr, varGet, varSet, bit2Test } from "../sys.js";
import { CalcVm } from "../calcvm.js";
import { vramBegin, vramEnd } from "../field/sprites.js";
import { beep, confirm, itemPos, setCursor } from "./engine.js";
import { ShopMenus } from "./shop.js";

/** SP at 01:5471 when the Start menu is entered from the field (00:31E1 → 00:01A1 → farcall
 *  00:1884 → 01:5000); saved at C7D7 (01:547F) and restored by the exits through rst $20. */
const MENU_SP = 0xcef7;

/** 01:5C59 / 01:5CE0 — leave the Start menu for good: the original resets SP to C7D7 and jumps
 *  to rst $20 (script de), which returns to the field in place of 01:5000. */
class ScriptExit {
  constructor(readonly de: number) {}
}

/** 00:04BF — far call entry bookkeeping: the RAM trampoline C0E4 (`ld a,n; jp nnnn`) receives
 *  n = A and the target address, FF88 = the target bank. Returns the caller's bank, which the
 *  caller restores after the call. */
export function r00_04BF(m: Memory, bank: number, addr: number, a: number): number {
  m.wr(0xc0e5, a);
  m.wr(0xc0e7, addr & 0xff);
  m.wr(0xc0e8, addr >> 8);
  return m.selectBank(bank);
}

/** 00:3232 (00:190C) — the field item effect: calc VM script 5 (pointer 0C:468A) by far call
 *  to 0C:4000 (A = pointer high byte). Inputs CFF0-CFF3, result CFF4. */
export function r00_3232(m: Memory): void {
  const de = m.romAt(0x0c, 0x468a) | (m.romAt(0x0c, 0x468b) << 8);
  const prev = r00_04BF(m, 0x0c, 0x4000, de >> 8);
  try {
    new CalcVm(m, {
      native: (a) => {
        throw new Error(`field item effect: calc VM native ${a.toString(16)} not ported`);
      },
    }).run(de);
  } finally {
    m.selectBank(prev);
  }
}

export class FieldMenus {
  readonly shops: ShopMenus;
  constructor(readonly e: Engine) {
    this.shops = new ShopMenus(e);
  }

  get m(): Memory {
    return this.e.g.m;
  }

  private *msg(e: number, flags = 0): Co {
    yield* this.e.text.message(e, flags);
  }

  /** 00:0546 — both menu cursors off. */
  private cursorsOff(): void {
    fill(this.m, 0xff97, 4, 0xff);
  }

  // ------------------------------------------------------------ Start menu

  /** 01:5000 → 01:5471 — the Start menu (message 1: Abil, Item, Equip, MAGI, Memo, Save) over
   *  the GP (2), MAGI count (3) and party (4, guest 5) windows. Includes the far call of the
   *  field's stub 00:1884 (A = C305, just masked by 00:31E1). */
  *startMenu(): Co {
    const m = this.m;
    const prev = r00_04BF(m, 0x01, 0x5000, m.rd(0xc305));
    try {
      yield* this.mainMenu();
    } catch (x) {
      if (!(x instanceof ScriptExit)) throw x;
      yield* this.e.text.script(x.de);
    }
    m.selectBank(prev);
  }

  private *mainMenu(): Co {
    const m = this.m, b1 = this.e.bank1;
    yield* vsync(this.e.g);
    m.wr(0xff47, 0); m.wr(0xff48, 0); m.wr(0xff49, 0);
    yield* b1.saveFieldTiles();
    fill(m, 0xc34a, 0x0a, 0); // 01:5E5A
    m.wr(0xc7d7, MENU_SP & 0xff);
    m.wr(0xc7d8, MENU_SP >> 8);
    let redraw = true;
    for (;;) {
      if (redraw) {
        // 5482
        yield* b1.screenMenu();
        yield* this.msg(0x02);
        yield* this.msg(0x03);
        yield* this.shops.members65(0x0504);
      }
      redraw = true;
      // 548E
      b1.clearMenu(true);
      b1.loadCursor(5);
      yield* this.msg(0x01);
      const a = yield* b1.runMenu(0);
      b1.storeCursor(5);
      if (a === 0xff) {
        fill(m, 0xc700, 3, 0);
        yield* b1.backToField(true);
        return;
      }
      confirm(m);
      switch (a) {
        case 0: redraw = yield* this.abilities(); break;
        case 1: yield* this.items(); break;
        case 2: redraw = yield* this.equipment(); break;
        case 3: yield* this.magi(); break;
        case 4: yield* this.memo(); break;
        default: yield* this.save(); break;
      }
    }
  }

  /** 01:5BAD — choose a member (party window, cursor 6); FF8C (FF = cancelled). */
  private *chooseMember(): Co<number> {
    const m = this.m, b1 = this.e.bank1;
    b1.loadCursor(6);
    m.wr(0xc796, 0); // 01:5E68
    yield* this.shops.members6C(0x0504);
    const a = yield* b1.runMenu(0);
    b1.storeCursor(6);
    return a;
  }

  /** 01:5B9D — redraw the Start menu windows (GP, MAGI, party, menu). */
  private *redrawMain(): Co {
    yield* this.msg(0x02);
    yield* this.msg(0x03);
    yield* this.shops.members65(0x0504);
    this.e.bank1.clearMenu(true);
    yield* this.msg(0x01);
  }

  /** 01:54C8 — Save: choose a slot (01:668C), confirm (message 0x19), write it (01:67BC). */
  private *save(): Co {
    const m = this.m, b1 = this.e.bank1;
    for (;;) {
      yield* b1.screenNew();
      yield* b1.chooseSlot();
      if (m.hram[0x0c] === 0xff) return;
      b1.clearMenu(true);
      m.wr(0xc70d, m.hram[0x0c]!);
      yield* this.msg(0x19);
      const a = yield* b1.runMenu(0);
      if (a === 0xff) continue;
      confirm(m);
      if (a !== 0) continue;
      b1.saveSlot(m.rd(0xc70d));
      return;
    }
  }

  /** 01:54F8 — Abil: a member's 8 slots (message 8) with stats (7) and header (6); a two-step
   *  selection of two slots swaps them (01:58CD), the same slot twice uses it (01:5BC6).
   *  Returns false when the member choice is cancelled (back to 01:548E without a redraw). */
  private *abilities(): Co<boolean> {
    const m = this.m, b1 = this.e.bank1;
    for (;;) {
      const a = yield* this.chooseMember();
      if (a === 0xff) return false;
      confirm(m);
      m.wr(0xc709, a);
      yield* b1.screenMenu();
      b1.clearCursor(7);
      for (;;) {
        // 550B
        b1.reset5E25();
        yield* this.msg(0x07);
        yield* this.msg(0x06);
        b1.loadCursor(7);
        yield* this.msg(0x08);
        const x = yield* b1.runMenu(1);
        b1.storeCursor(7);
        if (x === 0xff) break;
        const y = m.hram[0x0d]!;
        if (x !== y) {
          confirm(m);
          const de = this.memberSlot(x), hl = this.memberSlot(y);
          m.hram[0x1e] = 0;
          m.hram[0x1f] = 0;
          this.exchange(de, hl);
          continue;
        }
        // 5548
        m.hram[0x1d] = x;
        const id = m.rd(this.memberSlot(x));
        if (id === 0xff) {
          beep(m);
          break;
        }
        m.wr(0xcff0, id);
        m.wr(0xcff1, 0);
        yield* this.useChecked();
        yield* b1.screenMenu();
      }
      // 556B
      yield* b1.screenMenu();
      yield* this.redrawMain();
    }
  }

  /** 01:5573 — Item: the bag (message 9, 16 slots + the trash entry 0x10). Two-step: two slots
   *  swap, a slot and the trash drop the item, the same slot twice uses it. */
  private *items(): Co {
    const m = this.m, b1 = this.e.bank1;
    b1.clearCursor(7);
    let redraw = true;
    for (;;) {
      if (redraw) yield* b1.screenMenu(); // 5578
      redraw = false;
      // 557B
      b1.reset5E2B();
      b1.loadCursor(7);
      yield* this.msg(0x09);
      const x = yield* b1.runMenu(1);
      b1.storeCursor(7);
      if (x === 0xff) return;
      const y = m.hram[0x0d]!;
      if (x === y) {
        // 55D6
        m.hram[0x1d] = x;
        const id = m.rd(bagSlot(x));
        if (id === 0xff) {
          beep(m);
          continue;
        }
        m.wr(0xcff0, id);
        m.wr(0xcff1, 0);
        m.wr(0xc709, 0xff);
        this.cursorsOff();
        yield* this.useChecked();
        if (m.hram[0x0c] !== 0xff) redraw = true;
        continue;
      }
      confirm(m);
      if (x === 0x10 || y === 0x10) {
        const hl = bagSlot(x === 0x10 ? y : x);
        m.wr(hl, 0xff);
        m.wr(hl + 1, 0xff);
        continue;
      }
      const p = bagSlot(x), q = bagSlot(y);
      const e = m.rd(p), d = m.rd(p + 1);
      m.wr(p, m.rd(q));
      m.wr(p + 1, m.rd(q + 1));
      m.wr(q, e);
      m.wr(q + 1, d);
    }
  }

  /** 01:55FD — Equip: a member's slots (message 8, cursor 8) against the bag (message 9,
   *  cursor 7); exchange through 01:5685. Returns false when the member choice is cancelled. */
  private *equipment(): Co<boolean> {
    const m = this.m, b1 = this.e.bank1;
    for (;;) {
      const a = yield* this.chooseMember();
      if (a === 0xff) return false;
      confirm(m);
      m.wr(0xc709, a);
      yield* b1.screenMenu();
      b1.clearCursor(7);
      b1.clearCursor(8);
      let done = false;
      while (!done) {
        // 5616
        b1.reset5E25();
        yield* this.msg(0x07);
        yield* this.msg(0x06);
        b1.loadCursor(7);
        yield* this.msg(0x09);
        for (;;) {
          // 5627
          b1.clearMenu(true);
          b1.loadCursor(8);
          yield* this.msg(0x08);
          const s = yield* b1.runMenu(0);
          b1.storeCursor(8);
          if (s === 0xff) {
            m.hram[0x1e] = 0;
            m.hram[0x1f] = 0;
            yield* b1.screenMenu();
            yield* this.msg(0x01);
            yield* this.msg(0x02);
            yield* this.msg(0x03);
            done = true;
            break;
          }
          // 5654
          confirm(m);
          copy(m, 0xff97, 0xff99, 2);
          b1.clearMenu(true);
          b1.loadCursor(7);
          yield* this.msg(0x09);
          const t = yield* b1.runMenu(0);
          b1.storeCursor(7);
          if (t === 0xff) {
            m.hram[0x19] = 0xff;
            m.hram[0x1a] = 0xff;
            continue;
          }
          this.equipExchange();
          break;
        }
      }
    }
  }

  /** 01:5D6D — address of slot a of member C709 (C20F + 2a). */
  private memberSlot(a: number): number {
    const m = this.m;
    return memberAddr(m, m.rd(0xc709), (0xc20f + ((2 * a) & 0xff)) & 0xffff);
  }

  /** 01:5D67 — the member slot under cursor 8 (C350). */
  private slot5D67(): number {
    return this.memberSlot(this.m.rd(0xc350));
  }

  /** 01:5DB0 — copy the 8-byte item record 0C:6F80 + 8a to de. */
  private record(a: number, de: number): void {
    const m = this.m;
    for (let i = 0; i < 8; i++) m.wr(de + i, m.romAt(0x0c, (0x6f80 + 8 * a + i) & 0xffff));
  }

  /** 01:5685 — exchange the member slot (cursor 8, item FF90, record C785) with the bag slot
   *  (cursor 7, item FF91, record C78D); the trash entry (0x10) drops the member's item. */
  private equipExchange(): void {
    const m = this.m;
    m.hram[0x1e] = 0;
    m.hram[0x1f] = 0;
    const old = m.rd(this.slot5D67());
    m.hram[0x10] = old;
    this.record(old, 0xc785);
    const nw = m.rd(bagSlot(m.rd(0xc34e)));
    m.hram[0x11] = nw;
    this.record(nw, 0xc78d);
    if (m.rd(0xc34e) >= 0x10) {
      if (old !== 0xff) return this.unequip();
      confirm(m);
      return;
    }
    if (nw === 0xff) {
      if (old === 0xff) return;
      return this.unequip();
    }
    if (old === 0xff) {
      // 5725
      this.equipAdd();
      this.equipSwap();
      return;
    }
    const me = m.rd(0xc709);
    if (m.rd(0xc785) & 0x04 || me === 4) {
      beep(m);
      return;
    }
    if (m.rd(memberAddr(m, me, 0xc205)) !== 3) {
      this.take();
      const busy = this.slotTaken();
      this.put();
      if (busy) {
        beep(m);
        return;
      }
    }
    // 56ED
    this.equipRemove();
    this.take();
    this.equipAdd();
    this.put();
    this.equipSwap();
  }

  /** 01:57DC — move the member's item to the bag slot / trash (not for the guest or items
   *  with record bit 2). */
  private unequip(): void {
    const m = this.m;
    if (m.rd(0xc709) === 4 || m.rd(0xc785) & 0x04) {
      beep(m);
      return;
    }
    this.equipRemove();
    this.equipSwap();
  }

  /** 01:5705 — park the member slot in C7DB/C7DC (slot emptied). */
  private take(): void {
    const m = this.m, hl = this.slot5D67();
    m.wr(0xc7db, m.rd(hl)); m.wr(hl, 0xff);
    m.wr(0xc7dc, m.rd(hl + 1)); m.wr(hl + 1, 0xff);
  }

  /** 01:5716 — put the parked slot back. */
  private put(): void {
    const m = this.m, hl = this.slot5D67();
    m.wr(hl, m.rd(0xc7db));
    m.wr(hl + 1, m.rd(0xc7dc));
  }

  /** 01:5DC0 — the new item (C78F slot nibble) is an armour piece whose slot is already
   *  covered by one of member C709's items (carry). */
  private slotTaken(): boolean {
    const m = this.m;
    const c = m.rd(0xc78f) & 0x0f;
    if (!c) return false;
    let hl = memberAddr(m, m.rd(0xc709), 0xc20f), n = 0;
    for (let k = 0; k < 8; k++, hl += 2) {
      const id = m.rd(hl);
      if (id === 0xff) continue;
      if (m.romAt(0x0c, (0x6f82 + 8 * id) & 0xffff) & c) n++;
    }
    return n !== 0;
  }

  /** 01:572E — bonuses of the new item (record C78D): monsters can't equip (beep); armour adds
   *  its power to DEF; record byte 2 bit 6: byte 5 = stat bits (STR AGL MANA DEF) + amount. */
  private equipAdd(): void {
    const m = this.m, me = m.rd(0xc709);
    const type = m.rd(memberAddr(m, me, 0xc205));
    if (type === 2) return beep(m);
    if (type === 3) return this.robotAdd();
    if (m.rd(0xc78f) & 0x0f) {
      if (this.slotTaken()) return beep(m);
      const hl = memberAddr(m, me, 0xc20e);
      m.wr(hl, m.rd(hl) + m.rd(0xc791));
    }
    this.statBits(memberAddr(m, me, 0xc20b), m.rd(0xc792), m.rd(0xc78f), 1);
  }

  /** 01:57F8 — remove the old item's bonuses (record C785), as 01:572E in reverse. */
  private equipRemove(): void {
    const m = this.m, me = m.rd(0xc709);
    if (m.rd(memberAddr(m, me, 0xc205)) === 3) return this.robotRemove();
    if (m.rd(0xc787) & 0x0f) {
      const hl = memberAddr(m, me, 0xc20e);
      m.wr(hl, m.rd(hl) - m.rd(0xc789));
    }
    this.statBits(memberAddr(m, me, 0xc20b), m.rd(0xc78a), m.rd(0xc787), -1);
  }

  /** 01:575C / 01:581D — when flags bit 6: add (sign) b & 0F to the stats at hl selected by
   *  bits 7-4 of b (STR, AGL, MANA, DEF). */
  private statBits(hl: number, b: number, flags: number, sign: number): void {
    const m = this.m;
    if (!(flags & 0x40)) return;
    const c = b & 0x0f;
    for (let i = 0; i < 4; i++, hl++) if (b & (0x80 >> i)) m.wr(hl, m.rd(hl) + sign * c);
  }

  /** 01:5781 — a robot equips item FF91: growth byte 0C:7B40 + id: HP and max HP + 9(n+1),
   *  STR/AGL/DEF (bits 7/6/4) + 2(n+1), n = low nibble; FF9E bit 0. */
  private robotAdd(): void {
    const m = this.m;
    const f = m.romAt(0x0c, 0x7b40 + m.hram[0x11]!);
    m.hram[0x12] = f;
    const n = (f & 0x0f) + 1;
    const de = 9 * n;
    let hl = memberAddr(m, m.rd(0xc709), 0xc207);
    for (let k = 0; k < 2; k++, hl += 2) {
      const v = ((m.rd(hl) | (m.rd(hl + 1) << 8)) + de) & 0xffff;
      m.wr(hl, v & 0xff);
      m.wr(hl + 1, v >> 8);
    }
    this.robotStats(hl, f, 1);
    m.hram[0x1e] = m.hram[0x1e]! | 1;
  }

  /** 01:5842 — a robot removes item FF90: max HP - 9(n+1) (current HP clamped to it), stats
   *  - 2(n+1); FF9E bit 1. */
  private robotRemove(): void {
    const m = this.m;
    const f = m.romAt(0x0c, 0x7b40 + m.hram[0x10]!);
    m.hram[0x12] = f;
    const de = 9 * ((f & 0x0f) + 1);
    const hl = memberAddr(m, m.rd(0xc709), 0xc207);
    const max = ((m.rd(hl + 2) | (m.rd(hl + 3) << 8)) - de) & 0xffff;
    m.wr(hl + 3, max >> 8);
    m.wr(hl + 2, max & 0xff);
    let cur = m.rd(hl) | (m.rd(hl + 1) << 8);
    if (max < cur) cur = max;
    m.wr(hl, cur & 0xff);
    m.wr(hl + 1, cur >> 8);
    this.robotStats(hl + 4, f, -1);
    m.hram[0x1e] = m.hram[0x1e]! | 2;
  }

  /** 01:57B6 / 01:5886 — robot stats STR (bit 7), AGL (6), DEF (4) at hl..hl+3 ± 2(n+1). */
  private robotStats(hl: number, f: number, sign: number): void {
    const m = this.m;
    const c = ((f & 0x0f) + 1) * 2;
    for (const [bit, o] of [[0x80, 0], [0x40, 1], [0x10, 3]] as const) {
      if (f & bit) m.wr(hl + o, m.rd(hl + o) + sign * c);
    }
  }

  /** 01:58AC — unless the exchange failed (FF9F), swap the member slot with the bag slot
   *  (trash: the member's item is dropped). */
  private equipSwap(): void {
    const m = this.m;
    if (m.hram[0x1f]) return;
    confirm(m);
    const de = this.slot5D67();
    const i = m.rd(0xc34e);
    if (i >= 0x10) {
      m.wr(de, 0xff);
      m.wr(de + 1, 0xff);
      return;
    }
    this.exchange(de, bagSlot(i));
  }

  /** 01:58CD — exchange the (id, uses) slots de and hl. Uses moving from de: an item with
   *  record bit 7 and 0 uses, or (FF9E bit 1, robot unequip) halved to 0, is dropped; uses
   *  moving from hl are halved when FF9E bit 0 (robot equip) for items without bit 7. */
  private exchange(de: number, hl: number): void {
    const m = this.m;
    const s = this.shops;
    let b = m.hram[0x1e]!;
    const c = m.rd(hl + 1);
    let a = m.rd(de + 1);
    if (s.flag590C(m.rd(de))) {
      if (!a) { b |= 4; a = 0xff; }
    } else if (b & 2) {
      a >>= 1;
      if (!a) { b |= 4; a = 0xff; }
    }
    m.wr(hl + 1, a);
    let u = c;
    if (!s.flag590C(m.rd(hl)) && b & 1) u >>= 1;
    m.wr(de + 1, u);
    const mid = m.rd(de), bid = m.rd(hl);
    m.wr(hl, b & 4 ? 0xff : mid);
    m.wr(de, bid);
  }

  // ------------------------------------------------------------ using items

  /** 01:5D4C — uses byte of slot FF9D: the bag (C709 = FF) or member C709. */
  private usesAddr(): number {
    const m = this.m, me = m.rd(0xc709);
    const hl = me === 0xff ? 0xc2ba : memberAddr(m, me, 0xc210);
    return (hl + ((2 * m.hram[0x1d]!) & 0xff)) & 0xffff;
  }

  /** 01:5BC6 — use the item in slot FF9D, unless it has no uses left. */
  private *useChecked(): Co {
    if (this.m.rd(this.usesAddr()) === 0) return beep(this.m);
    yield* this.use();
  }

  /** 01:5BCD — use item CFF0/CFF1 (record byte 0 bit 1: usable in the field; bit 4: all
   *  members) on a member chosen in the party window; the calc VM (00:190C) leaves the outcome
   *  in CFF4. */
  private *use(): Co {
    const m = this.m, b1 = this.e.bank1;
    const me = m.rd(0xc709);
    if (me !== 0xff && m.rd(memberAddr(m, me, 0xc206)) & 0x10) return beep(m);
    const id = m.rd(0xcff0) | (m.rd(0xcff1) << 8);
    const u = m.romAt(0x0c, (0x6f80 + 8 * id) & 0xffff);
    if (!(u & 0x02)) return beep(m);
    confirm(m);
    let a = 8;
    if (!(u & 0x10)) {
      m.hram[0x1b] = 0;
      yield* this.shops.members6C(0x0504);
      a = yield* b1.runMenu(0);
      if (a === 0xff) return;
    }
    // 5C13
    m.wr(0xcff3, a);
    m.wr(0xcff2, me === 0xff ? a : me);
    r00_3232(m);
    const k = m.rd(0xcff4);
    switch (k) {
      case 0: {
        // 5C74
        this.consume();
        const v = m.rd(0xc796) - 4;
        m.wr(0xc796, v < 0 ? 0 : v);
        yield* this.shops.members6C(0x0504);
        return yield* this.shops.waitPress();
      }
      case 1:
        yield* this.msg(0x0a);
        return yield* this.shops.waitPress();
      case 2: return yield* this.warp();
      case 3:
        this.consume();
        return this.shops.restoreAll();
      case 4: return yield* this.magiLeft();
      case 5: case 6: case 7: case 8:
        // 5C6D: Strength Up (3D), Agility Up (3C), Mana Up (3B), HP Max (3A)
        yield* this.msg(0x3d - (k - 5));
        this.consume();
        return yield* this.shops.waitPress();
    }
    // 5C44
    fill(m, 0xc700, 3, 0);
    yield* b1.backToField(true);
    throw new ScriptExit(0x0255);
  }

  /** 01:5D1D — spend one use of the item (not MAGI, not unlimited FE); at 0 the slot empties
   *  for the bag and humans, and for mutants' items (ids < 0x80). */
  private consume(): void {
    const m = this.m;
    if (m.rd(0xcff1)) return;
    const hl = this.usesAddr();
    if (m.rd(hl) === 0xfe) return;
    const v = (m.rd(hl) - 1) & 0xff;
    m.wr(hl, v);
    if (v) return;
    const me = m.rd(0xc709);
    if (me !== 0xff) {
      const type = m.rd(memberAddr(m, me, 0xc205));
      if (type === 1) {
        if (m.rd(hl - 1) >= 0x80) return;
      } else if (type !== 0) return;
    }
    m.wr(hl, 0xff);
    m.wr(hl - 1, 0xff);
  }

  /** 01:5C96 — teleport (CFF4 = 2): not when C354 is set; choose a destination (message 0x2F,
   *  known ones by progress variable 0x18), clear variables 1D/1E, back to the field and run
   *  script 0x60 + choice. */
  private *warp(): Co {
    const m = this.m, b1 = this.e.bank1;
    if (m.rd(0xc354)) return beep(m);
    yield* b1.screenMenu();
    yield* this.msg(0x2e);
    yield* this.msg(0x2f);
    const a = yield* b1.runMenu(0);
    if (a === 0xff) return;
    this.consume();
    varSet(m, 0x1d, 0);
    varSet(m, 0x1e, 0);
    const de = (a + 0x60) & 0xff;
    fill(m, 0xc700, 3, 0xd2);
    yield* b1.black();
    const prev = r00_04BF(m, 0x01, 0x191b, 0);
    yield* this.e.far(0x191b);
    m.selectBank(prev);
    yield* b1.backToField(true);
    throw new ScriptExit(de);
  }

  /** 01:5CE6 — the MAGI left in this world (CFF4 = 4): 0F:6600 + var 0E minus C2D9, counted up
   *  in C70D (message 0x40 redrawn in place). */
  private *magiLeft(): Co {
    const m = this.m;
    yield* this.e.bank1.screenMenu();
    yield* this.msg(0x3f);
    yield* this.msg(0x3e);
    let a = m.romAt(0x0f, 0x6600 + varGet(m, 0x0e)) - m.rd(0xc2d9);
    if (a < 0) a = 0;
    m.wr(0xc70d, 0);
    m.wr(0xc70e, a);
    for (;;) {
      yield* this.msg(0x40, 2);
      if (m.rd(0xc70d) === m.rd(0xc70e)) return yield* this.shops.waitPress();
      m.wr(0xc70d, m.rd(0xc70d) + 1);
    }
  }

  // ------------------------------------------------------------ MAGI

  /** 01:5919 — MAGI (message 0x0B: Equip / Use) for member C709, list C7E0 (01:5B56). */
  private *magi(): Co {
    const m = this.m, b1 = this.e.bank1;
    yield* b1.screenMenu();
    this.magiList();
    m.wr(0xc709, 0);
    b1.clearCursor(7);
    b1.clearCursor(8);
    top: for (;;) {
      // 592D
      yield* this.magiScreen();
      const a = yield* b1.runMenu(0);
      if (a === 0xff) {
        this.magiStore(false);
        return;
      }
      confirm(m);
      if (a !== 0) {
        // 5946 — Use
        for (;;) {
          yield* this.magiListWindow();
          const x = yield* b1.runMenu(0);
          b1.storeCursor(7);
          if (x === 0xff) continue top;
          const id = m.rd(0xc7e0 + x);
          if (id === 0xff) {
            beep(m);
            continue;
          }
          confirm(m);
          m.wr(0xcff0, id);
          m.wr(0xcff1, 1);
          yield* this.use();
          yield* b1.screenMenu();
          yield* this.magiScreen();
        }
      }
      // 5976 — Equip
      for (;;) {
        yield* this.magiMembers();
        yield* this.chooseMagiMember();
        b1.storeCursor(8);
        if (m.hram[0x0c] === 0xff) continue top;
        for (;;) {
          // 5987
          yield* this.magiHeader();
          yield* this.magiListWindow();
          const x = yield* b1.runMenu(0);
          b1.storeCursor(7);
          if (x === 0xff) break;
          confirm(m);
          const li = 0xc7e0 + x;
          const ms = this.magiSlot(m.rd(0xc709));
          if (m.rd(li) === 0xff) {
            // 59CD
            const v = m.rd(ms);
            if (v === 0xff) {
              beep(m);
              continue;
            }
            m.wr(ms, 0xff);
            m.wr(li, v);
          } else if (m.rd(ms) === 0xff) {
            m.wr(ms, m.rd(li));
            m.wr(li, 0xff);
          } else {
            const v = m.rd(ms);
            m.wr(ms, m.rd(li));
            m.wr(li, v);
          }
        }
      }
    }
  }

  /** 01:5B95 — MAGI slot of member a: C21F + 32a (raw slot order). */
  private magiSlot(a: number): number {
    return 0xc21f + ((a * 32) & 0xff);
  }

  /** 01:5B56 — members' MAGI slots from the owner nibbles of C2DA (2 bytes per MAGI: owner
   *  member + 1 << 4 | count); unowned MAGI with a count are listed at C7E0 (14, FF-filled). */
  private magiList(): void {
    const m = this.m;
    for (let b = 0; b < 4; b++) m.wr(this.magiSlot(b), 0xff);
    fill(m, 0xc7e0, 0x0e, 0xff);
    let de = 0xc7e0;
    for (let c = 0, hl = 0xc2da; c < 0x0e; c++, hl += 2) {
      const v = m.rd(hl);
      if (!(v & 0x0f)) continue;
      if (v & 0xf0) m.wr(this.magiSlot((v >> 4) - 1), c);
      else m.wr(de++, c);
    }
  }

  /** 01:5B26 (01:607A with `formation`: slots by 00:05D9) — owner nibbles of C2DA from the
   *  members' MAGI slots. */
  private magiStore(formation: boolean): void {
    const m = this.m;
    for (let k = 0, hl = 0xc2da; k < 0x0e; k++, hl += 2) m.wr(hl, m.rd(hl) & 0x0f);
    for (let c = 0; c < 4; c++) {
      const s = formation ? memberAddr(m, c, 0xc21f) : this.magiSlot(c);
      const id = m.rd(s);
      if (id === 0xff) continue;
      const hl = 0xc2da + ((2 * id) & 0xff);
      m.wr(hl, (m.rd(hl) & 0x0f) | ((c + 1) << 4));
    }
  }

  /** 01:60AA (entry 01:5021) — as 01:5B56 with formation slots (00:05D9); C7E0 keeps one entry
   *  per MAGI (FF when owned or absent). */
  magiSlots(): void {
    const m = this.m;
    for (let b = 0; b < 4; b++) m.wr(memberAddr(m, b, 0xc21f), 0xff);
    for (let c = 0, hl = 0xc2da, de = 0xc7e0; c < 0x0e; c++, hl += 2, de++) {
      const v = m.rd(hl);
      let a = 0xff;
      if (v & 0x0f) {
        if (!(v & 0xf0)) a = c;
        else m.wr(memberAddr(m, (v >> 4) - 1, 0xc21f), c);
      }
      m.wr(de, a);
    }
  }

  /** 01:607A (entry 01:5024) */
  magiSlotsStore(): void {
    this.magiStore(true);
  }

  /** 01:5A3C — MAGI screen: header, members, list, menu (message 0x0B). */
  private *magiScreen(): Co {
    const m = this.m, b1 = this.e.bank1;
    this.cursorsOff();
    yield* this.magiHeader();
    yield* this.magiMembers();
    yield* this.magiListWindow();
    m.wr(0xc798, 0);
    b1.clearMenu(true);
    yield* this.msg(0x0b);
  }

  /** 01:5A53 — the unowned MAGI list (message 0x0E, cursor 7). */
  private *magiListWindow(): Co {
    this.e.bank1.clearMenu(true);
    this.e.bank1.loadCursor(7);
    yield* this.msg(0x0e);
  }

  /** 01:5A5F — member C709 with its MAGI (message 0x0C; portrait slot 4). */
  private *magiHeader(): Co {
    this.m.wr(0xc796, 4);
    this.m.wr(0xc798, 0);
    yield* this.msg(0x0c);
  }

  /** 01:5A6C — the four members (message 0x0D, cursor 8). */
  private *magiMembers(): Co {
    const m = this.m;
    this.e.bank1.clearMenu(true);
    m.wr(0xc796, 0);
    m.wr(0xc798, 0);
    this.e.bank1.loadCursor(8);
    yield* this.msg(0x0d);
  }

  /** 01:59E6 — pick the member whose MAGI to change: up/left previous, down/right next (the
   *  header follows), A: FF8C = FF9B, B: FF8C = FF. */
  private *chooseMagiMember(): Co {
    const m = this.m;
    for (;;) {
      yield* this.magiHeader();
      m.wr(0xc7cd, 0);
      const [b, c] = itemPos(m);
      setCursor(m, b, c);
      for (;;) {
        const a = yield* joyFrame(this.e.g);
        let d = 0;
        if (a & 0x80) d = 1;
        else if (a & 0x40) d = -1;
        else if (a & 0x20) d = -1;
        else if (a & 0x10) d = 1;
        else if (a & 0x02) {
          m.hram[0x0c] = 0xff;
          return;
        } else if (a & 0x01) {
          m.hram[0x0c] = m.hram[0x1b]!;
          confirm(m);
          return;
        }
        if (!d) continue;
        let v = m.rd(0xc709) + d;
        if (v >= 4) v = 0;
        if (v < 0) v = 3;
        m.wr(0xc709, v);
        m.hram[0x1b] = v;
        break;
      }
    }
  }

  // ------------------------------------------------------------ Memo

  /** 01:5A89 — Memo: topics (message 0x42, lists C71D), then the known phrases of a topic
   *  (message 0x44) stepped with the d-pad; A or B back to the topics. */
  private *memo(): Co {
    const m = this.m, b1 = this.e.bank1;
    b1.clearCursor(7);
    yield* b1.screenMenu();
    yield* this.msg(0x41);
    for (;;) {
      // 5A94
      b1.clearMenu(false);
      m.wr(0xc7da, 0);
      b1.loadCursor(7);
      yield* this.msg(0x42);
      const a = yield* b1.runMenu(0);
      b1.storeCursor(7);
      if (a === 0xff) return;
      confirm(m);
      const d = m.rd(0xc71d + a);
      m.wr(0xc7d9, d);
      m.wr(0xc798, 0);
      let e = 0xff;
      do e = e + 1 >= 0x10 ? 0 : e + 1;
      while (!bit2Test(m, d, e));
      for (;;) {
        m.wr(0xc7f2, e);
        yield* this.msg(0x44);
        let k: number;
        do k = yield* joyFrame(this.e.g);
        while (!(k & 0xf3));
        if (k & 0x80 || (!(k & 0x60) && k & 0x10)) {
          e = m.rd(0xc7f2);
          do e = e + 1 >= 0x10 ? 0 : e + 1;
          while (!bit2Test(m, d, e));
        } else if (k & 0x60) {
          e = m.rd(0xc7f2);
          do e = e ? e - 1 : 0x0f;
          while (!bit2Test(m, d, e));
        } else break;
      }
    }
  }

  // ------------------------------------------------------------ Select menu

  /** 01:5003 → 01:5F51 — the Select menu: formation (message 0x10, guest 0x11). Choosing two
   *  members (two-step) slides their portraits past each other and swaps their slots in C2A0;
   *  dead or stone members (C206 & 0x90) can't move. Includes the far call of the field's stub
   *  00:188B (A = 0 after 00:2ECE). */
  *selectMenu(): Co {
    const m = this.m, b1 = this.e.bank1;
    const prev = r00_04BF(m, 0x01, 0x5003, 0);
    yield* vsync(this.e.g);
    m.wr(0xff47, 0); m.wr(0xff48, 0); m.wr(0xff49, 0);
    yield* b1.saveFieldTiles();
    yield* b1.screenMenu();
    this.magiSlots();
    for (;;) {
      // 5F62
      b1.reset5E25();
      yield* this.shops.members65(0x1110);
      const a = yield* b1.runMenu(1);
      if (a === 0xff) break;
      const c = m.hram[0x0d]!;
      if (a === c) continue;
      if (a > c) {
        m.hram[0x0d] = a;
        m.hram[0x0c] = c;
      }
      const x = m.hram[0x0c]!, y = m.hram[0x0d]!;
      if (m.rd(memberAddr(m, x, 0xc206)) & 0x90) continue;
      if (m.rd(memberAddr(m, y, 0xc206)) & 0x90) {
        beep(m);
        continue;
      }
      confirm(m);
      const sx = 0xc7a8 + ((4 * x) & 0xff), sy = 0xc7a8 + ((4 * y) & 0xff);
      m.hram[0x10] = (m.rd(sy) - m.rd(sx)) & 0xff;
      this.cursorsOff();
      let e = 0x10;
      do {
        m.wr(sx + 1, m.rd(sx + 1) - 1);
        m.wr(sy + 1, m.rd(sy + 1) + 1);
        yield* b1.frameCC();
        e = (e - 1) & 0xff;
      } while (e);
      e = m.hram[0x10]!;
      do {
        m.wr(sx, m.rd(sx) + 1);
        m.wr(sy, m.rd(sy) - 1);
        yield* b1.frameCC();
        e = (e - 1) & 0xff;
      } while (e);
      e = 0x10;
      do {
        m.wr(sx + 1, m.rd(sx + 1) + 1);
        m.wr(sy + 1, m.rd(sy + 1) - 1);
        yield* b1.frameCC();
        e = (e - 1) & 0xff;
      } while (e);
      // swap the formation slots (01:602E / 01:603E)
      const f = m.rd(0xc2a0);
      const px = (f >> (2 * x)) & 3, py = (f >> (2 * y)) & 3;
      let v = (f & ~(3 << (2 * y))) | (px << (2 * y));
      v = (v & ~(3 << (2 * x))) | (py << (2 * x));
      m.wr(0xc2a0, v & 0xff);
    }
    this.magiStore(true);
    fill(m, 0xc700, 3, 0);
    yield* b1.backToField(true);
    m.selectBank(prev);
  }

  // ------------------------------------------------------------ ending

  /** 01:6A51 (entry 01:5036, from 00:0C0F) — the ending: tiles 04:5800 → 8800, 4 x 60 frames,
   *  then eight 2-column tile strips drawn outward from the centre of row 9880 every 4 frames
   *  (tile bases 01:6AC1 / 01:6AC9). Includes the far call of 00:0C0F (text code 0x4D: A = 0x9A,
   *  the doubled code left by the dispatcher 00:0719). */
  *ending(a = 0x9a): Co {
    const m = this.m, g = this.e.g;
    const prev = r00_04BF(m, 0x01, 0x5036, a);
    yield* this.e.bank1.vramFromRom(0x04, 0x5800, 0x8800, 0x800);
    for (let c = 0; c < 4; c++) for (let b = 0; b < 0x3c; b++) yield* vsync(g);
    for (let a = 0; a < 8; a++) {
      m.hram[0x10] = a;
      m.hram[0x11] = m.romAt(0x01, 0x6ac1 + a);
      m.hram[0x12] = m.romAt(0x01, 0x6ac9 + a);
      yield* vramBegin(g);
      for (let c = 0; c < 8; c++) {
        let hl = 0x9880 + ((10 - a) & 0xff) + c * 32;
        m.wr(hl, m.hram[0x11]!);
        m.hram[0x11] = (m.hram[0x11]! + 0x10) & 0xff;
        hl += (2 * a + 1) & 0xff;
        m.wr(hl, m.hram[0x12]!);
        m.hram[0x12] = (m.hram[0x12]! + 0x10) & 0xff;
      }
      yield* vramEnd(g);
      for (let b = 0; b < 4; b++) yield* vsync(g);
    }
    m.selectBank(prev);
  }
}

/** 01:55D0 — bag slot a (C2B9 + 2a). */
function bagSlot(a: number): number {
  return 0xc2b9 + ((2 * a) & 0xff);
}

/** Register the bank-1 field entries (jump table 01:5000) in Engine.extra. */
export function installFieldMenus(e: Engine): FieldMenus {
  const f = new FieldMenus(e);
  // entries reached by far calls from text control codes (00:0F58 code 0x3E, A = 0x7C;
  // 00:0F63 code 0x3F, A = B; 00:0C0F code 0x4D, A = 0x9A): the far call's bookkeeping here
  const far = (addr: number, a: number, fn: () => void) => function* (): Co<number | void> {
    const m = e.g.m;
    const prev = r00_04BF(m, 0x01, addr, a);
    fn();
    m.selectBank(prev);
  };
  e.extra.set(0x15000, () => f.startMenu());
  e.extra.set(0x15003, () => f.selectMenu());
  e.extra.set(0x15009, (_e: Engine, r: Regs) => f.shops.shop(r.e ?? 0));
  e.extra.set(0x15012, () => f.shops.inn());
  e.extra.set(0x1501e, (_e: Engine, r: Regs) => far(0x501e, r.a ?? 0x7c, () => f.shops.restoreAll())());
  e.extra.set(0x15021, function* () { f.magiSlots(); });
  e.extra.set(0x15024, function* () { f.magiSlotsStore(); });
  e.extra.set(0x15027, (_e: Engine, r: Regs) =>
    far(0x5027, r.a ?? r.b ?? 0, () => f.shops.healAll(((r.b ?? 0) << 8) | (r.c ?? 0)))());
  e.extra.set(0x15036, (_e: Engine, r: Regs) => f.ending(r.a ?? 0x9a));
  return f;
}
