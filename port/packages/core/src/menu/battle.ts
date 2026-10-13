/** Bank-1 battle code (01:6AD1-6FCD): the battle screen setup, the FIGHT/RUN menu and each
 *  member's command and target selection, the meat prompt after a battle, the scripted monster
 *  appearance (text code 0x48) and the FFA5 tile-animation interrupt hooks. Entry points as the
 *  original's jump table 01:5000: 5015 (6AD1), 5018 (6AF9), 501B (6C71), 502A (6E27),
 *  502D (6DC5, vblank when FFA5 != 0), 5030 (6F74), 5033 (6DF1, frame tick when FFA5 != 0).
 *
 *  Battle state used here (per actor block D000 + 0x100 * member, member 4 = guest; addressed
 *  with 00:05D9 like the original):
 *    D012 + 3i  item slots 0-7: [id lo, id hi, uses]  (id lo = FF: empty)
 *    D040       status (bits 7/4/3/1/0 = 0x9B: cannot act; 0x90: cannot eat meat)
 *    D043/D044  chosen item id (lo/hi)          D046  chosen slot
 *    D045       target: 0-4 member, 5-7 enemy group 0-2, 8 all members, 9 all enemies
 *    D920 enemy group count, D933/D939 group cursor column (+2) / row, D501 + 0x100 g alive count.
 *  Results: FF8C (FF = Run / cancelled), C709 = member being commanded.
 *
 *  Calls into the battle display/animation banks (0D:5006-5018, 0F:608F/6092) go through `far`
 *  by original address. Routines with register outputs return A and write their other outputs
 *  (hl, b, c, d, e) back into the Regs object they were given, like the original's farcall
 *  (00:04BF), which passes all registers both ways. */
import type { Game, Co } from "../game.js";
import type { Engine } from "../engine.js";
import type { Memory } from "../memory.js";
import { vsync, joyFrame, waitRelease, fill, copy, copyBank, memberAddr, partySlot, varGet } from "../sys.js";
import { frameTick } from "../irq.js";
import type { TextEngine, Regs } from "../text/engine.js";
import { vramBegin, vramEnd } from "../field/sprites.js";
import type { Bank1 } from "./bank1.js";
import { beep, confirm, itemPos } from "./engine.js";

/** Call a routine by original address (Engine.far). */
export type FarCall = (addr: number, regs?: Regs) => Co<number | void>;

/** 00:0550 (via 01EF) — load the font/UI tiles 03:7F00 → 8700 (0x100 bytes, 00:00C3). */
export function* r00_0550(g: Game): Co {
  const m = g.m;
  const prev = m.selectBank(0x03);
  yield* vramBegin(g);
  copyBank(m, 0x03, 0x7f00, 0x8700, 0x100);
  yield* vramEnd(g);
  m.selectBank(prev);
}

/** 00:0546 (via 01B0) — all cursors off (FF97-FF9A = FF). */
export function r00_0546(m: Memory): void {
  fill(m, 0xff97, 4, 0xff);
}

/** 01:6D00 — flags byte 0 of item de (0C:6F80 + 8 * de; 16-bit wrap like add hl,hl). Bit 0:
 *  usable in battle; bit 5: enemy target (bit 4 with it: all enemies); bit 4 alone: all members;
 *  neither: one member. */
export function itemFlags(m: Memory, de: number): number {
  return m.romAt(0x0c, (de * 8 + 0x6f80) & 0xffff);
}

/** 01:6DA9 — enemy group a has members left ([D501 + 0x100 a] != 0). */
export function groupAlive(m: Memory, a: number): boolean {
  return m.rd((0xd501 + ((a & 0xff) << 8)) & 0xffff) !== 0;
}

/** 01:6DC5 (01:502D) — vblank part of the tile animation (FFA5 != 0): when in vblank, rotate
 *  the two bytes at [FFA7] right by one, feeding their low bits into the bytes at [FFA9]. */
export function vblankFfa5(g: Game): void {
  const m = g.m;
  const hl = m.hram[0x27]! | (m.hram[0x28]! << 8);
  if (m.rd(0xff44) < 0x90) return;
  let c = m.rd(hl), b = m.rd((hl & 0xff00) | ((hl + 1) & 0xff));
  const p = m.hram[0x29]! | (m.hram[0x2a]! << 8);
  // a = c; rrca → carry = c bit 0; rr [p]; rr c
  let cy = c & 1;
  let v = m.rd(p);
  m.wr(p, (cy << 7) | (v >> 1));
  cy = v & 1;
  c = (cy << 7) | (c >> 1);
  const p1 = (p & 0xff00) | ((p + 1) & 0xff);
  cy = b & 1;
  v = m.rd(p1);
  m.wr(p1, (cy << 7) | (v >> 1));
  cy = v & 1;
  b = (cy << 7) | (b >> 1);
  m.wr(hl, c);
  m.wr((hl & 0xff00) | ((hl + 1) & 0xff), b);
}

/** 01:6DF1 (01:5033) — frame-tick part of the tile animation: counter FFA6 (0-15) selects the
 *  row pair: FFA7/FFA8 = 90E0 (91D0 from 8 on) + 2 (n & 7), FFA9/FFAA = 9000 (91C0) + 2 (n & 7). */
export function statFfa5(g: Game): void {
  const m = g.m;
  const b = m.hram[0x26]!;
  const c = b & 7;
  let hl = b & 8 ? 0x91d0 : 0x90e0;
  m.hram[0x27] = (2 * c + (hl & 0xff)) & 0xff;
  m.hram[0x28] = hl >> 8;
  hl = b & 8 ? 0x91c0 : 0x9000;
  m.hram[0x29] = (2 * c + (hl & 0xff)) & 0xff;
  m.hram[0x2a] = hl >> 8;
  m.hram[0x26] = (b + 1) & 0x0f;
}

/** 01:6F49 — one step of the wave table for the monster appearance: for each of the FF90
 *  lines (0 = 256), C800[i] moves by 2 toward d (rising, C900[i] = 0) or e (falling, C900[i] = 1),
 *  turning at the bounds. */
export function waveStep(m: Memory, d: number, e: number): void {
  let b = m.hram[0x10]!;
  let hl = 0xc800;
  do {
    let a: number;
    if (m.rd(hl + 0x100) === 0) {
      a = (m.rd(hl) + 2) & 0xff;
      if (!(a < d)) {
        a = d;
        m.wr(hl + 0x100, 1);
      }
    } else {
      const v = m.rd(hl) - 2;
      a = v & 0xff;
      if (v < 0 || a < e) {
        a = e;
        m.wr(hl + 0x100, 0);
      }
    }
    m.wr(hl, a);
    hl = (hl & 0xff00) | ((hl + 1) & 0xff);
    b = (b - 1) & 0xff;
  } while (b);
}

/** 00:04BF entry: C0E7/C0E8 = target address, C0E5 = A (when known). */
function farEnter(m: Memory, addr: number, a: number | undefined): void {
  m.wr(0xc0e7, addr & 0xff);
  m.wr(0xc0e8, (addr >> 8) & 0xff);
  if (a !== undefined) m.wr(0xc0e5, a);
}

export class BattleMenus {
  constructor(readonly g: Game, readonly text: TextEngine, readonly bank1: Bank1, readonly far: FarCall) {}

  get m(): Memory {
    return this.g.m;
  }

  // ------------------------------------------------------------ shared helpers

  /** farcall (00:04BF): the trampoline C0E4 gets the caller's A (C0E5) and the target
   *  (C0E7/C0E8); switch to the target's bank, call, restore the bank. */
  private *farcall(addr: number, regs: Regs): Co<number | void> {
    farEnter(this.m, addr, regs.a);
    const prev = this.m.selectBank(addr >> 16);
    const r = yield* this.far(addr, regs);
    this.m.selectBank(prev);
    return r;
  }

  /** rst $08 — window message e. */
  private *msg(e: number): Co {
    yield* this.text.message(e);
  }

  /** 01:5E35 — cursors and portrait sprites off, scroll offsets and menu list cleared. */
  private reset5E35(): void {
    this.bank1["reset5E35"]();
  }

  /** "rst $10; ld a,$cc; rst $18" — a frame, then DMA the CC page. */
  private *frameCC(): Co {
    yield* this.bank1["frameCC"]();
  }

  /** 01B9 → 00:18C3 — the menu engine with C7CD = 2 * C79A | 0; returns FF8C. */
  private *menu(): Co<number> {
    return yield* this.bank1.runMenu(0);
  }

  /** 01:6DBD — wait (DMA frames) for A or B; returns FF8A & 3 (bit 0 = A). */
  private *waitAB(): Co<number> {
    for (;;) {
      const a = (yield* joyFrame(this.g)) & 3;
      if (a) return a;
    }
  }

  /** 01:6CF8 — status byte D040 of member a. */
  private status(a: number): number {
    return this.m.rd(memberAddr(this.m, a, 0xd040));
  }

  /** 01:6CEF — member C709 cannot act (status & 0x9B). */
  private cannotAct(): boolean {
    return (this.status(this.m.rd(0xc709)) & 0x9b) !== 0;
  }

  /** 01:6C62 — confirm sound; D045 of member C709 = target a. */
  private setTarget(a: number): void {
    const m = this.m;
    confirm(m);
    m.wr(memberAddr(m, m.rd(0xc709), 0xd045), a);
  }

  // ------------------------------------------------------------ screens

  /** 01:6D12 — clear the window map (9C00, 0x140 bytes of tile 75), palettes D2 D2 81 (registers
   *  only), FF96 = 3. */
  private *blank(): Co {
    const m = this.m;
    m.hram[0x16] = 0;
    m.wr(0xc764, 0);
    this.reset5E35();
    yield* this.frameCC();
    yield* this.bank1["vramFill"](0x9c00, 0x140, 0x75);
    yield* vsync(this.g);
    m.wr(0xff47, 0xd2);
    m.wr(0xff48, 0xd2);
    m.wr(0xff49, 0x81);
    m.hram[0x16] = 3;
  }

  /** 01:6AE9 — the enemy window (message 0x32) and the party window (0x30; the guest's 0x31 when
   *  progress variable 0 is set), via 01:5E65 (FF9B = 0, C796 = 0, menu list cleared). */
  private *windows(): Co {
    const m = this.m;
    yield* this.msg(0x32);
    m.hram[0x1b] = 0;
    m.wr(0xc796, 0);
    this.bank1["clearMenu"](false);
    yield* this.msg(0x30);
    if (varGet(m, 0) !== 0) yield* this.msg(0x31);
  }

  /** 01:6AD1 (01:5015) — battle screen: UI tiles, blank window, the D98B = 2 background
   *  (0F:608F), then the enemy and party windows. */
  *init(): Co {
    yield* r00_0550(this.g);
    yield* this.blank();
    if (this.m.rd(0xd98b) === 2) yield* this.farcall(0xf608f, { a: 2 });
    yield* this.windows();
  }

  /** 01:6D3C — leave the menus: sprites and cursors off, window off (LCDC &= C3), battle tiles
   *  04:6000 → 8200 (0x600 bytes). */
  private *leave(): Co {
    const m = this.m;
    m.hram[0x16] = 0;
    this.reset5E35();
    r00_0546(m);
    yield* this.frameCC();
    m.wr(0xff40, m.rd(0xff40) & 0xc3);
    yield* this.bank1["vramFromRom"](0x04, 0x6000, 0x8200, 0x600);
  }

  /** 01:6AF9 (01:5018) — FIGHT/RUN (message 0x33; B is ignored). RUN: FF8C = FF. FIGHT: a
   *  command for each member 0-3 able to act (C709), then the guest (member 4) when progress
   *  variable 0 is set; B on a member's list goes back to the previous member able to act, or
   *  from the first one back to the battle screen and FIGHT/RUN. Returns FF8C (FF, or the member
   *  count 4/5 when all commands are chosen). */
  *commands(): Co<number> {
    this.g.ui.battleCommand = true; // hint for the player's auto-battle (P5); no game effect
    try {
      return yield* this.commandsInner();
    } finally {
      this.g.ui.battleCommand = false;
    }
  }

  private *commandsInner(): Co<number> {
    const m = this.m;
    top: for (;;) {
      this.bank1["clearMenu"](true);
      yield* this.msg(0x33);
      let a: number;
      do a = yield* this.menu();
      while (a === 0xff);
      if (a !== 0) {
        m.hram[0x0c] = 0xff;
        yield* this.leave();
        return 0xff;
      }
      confirm(m);
      let n = 0;
      for (;;) {
        m.wr(0xc709, n);
        // 01:6B1A
        for (;;) {
          if (this.cannotAct()) break;
          yield* this.command();
          if (m.hram[0x0c] !== 0xff) break;
          // 01:6B28 — back to the previous member able to act
          for (;;) {
            const c = m.rd(0xc709);
            if (c === 0) {
              yield* this.init();
              continue top;
            }
            m.wr(0xc709, c - 1);
            if (!this.cannotAct()) break;
          }
        }
        // 01:6B3C
        n = m.rd(0xc709) + 1;
        if (n < 4) continue;
        if (n < 5 && varGet(m, 0) !== 0) continue;
        m.hram[0x0c] = n;
        yield* this.leave();
        return n;
      }
    }
  }

  /** 01:6B52 — command of member C709: its item/ability list (message 0x35, cursor kept per
   *  formation slot in C340), then the target. With no usable entry (battle flag, uses left):
   *  message 0x39, a beep, and A (FF8C = 0, the member does nothing) or B (FF8C = FF). B in the
   *  list: FF8C = FF. */
  *command(): Co {
    const m = this.m;
    for (;;) {
      yield* this.blank();
      yield* this.msg(0x34);
      const member = m.rd(0xc709);
      let hl = memberAddr(m, member, 0xd012);
      let c = 0;
      for (let b = 0; b < 8; b++, hl += 3) {
        if (m.rd(hl) === 0xff) continue;
        const de = m.rd(hl) | (m.rd(hl + 1) << 8);
        if (!(itemFlags(m, de) & 1)) continue;
        if (m.rd(hl + 2)) c = 1;
      }
      if (!c) {
        yield* this.msg(0x39);
        beep(m);
        const a = yield* this.waitAB();
        m.hram[0x0c] = a & 1 ? 0 : 0xff;
        return;
      }
      // 01:6B98
      this.bank1["loadCursor"](partySlot(m, m.rd(0xc709)));
      yield* this.msg(0x35);
      let flags: number;
      for (;;) {
        const v = yield* this.menu();
        this.bank1["storeCursor"](partySlot(m, m.rd(0xc709)));
        if (m.hram[0x0c] === 0xff) return;
        const e0 = memberAddr(m, m.rd(0xc709), 0xd012) + 3 * v;
        const lo = m.rd(e0);
        if (lo === 0xff) { beep(m); continue; }
        const hi = m.rd(e0 + 1);
        if (!m.rd(e0 + 2)) { beep(m); continue; }
        const d = memberAddr(m, m.rd(0xc709), 0xd046);
        m.wr(d, v);
        m.wr(d - 2, hi);
        m.wr(d - 3, lo);
        flags = itemFlags(m, lo | (hi << 8));
        m.hram[0x12] = flags; // FF92
        if (!(flags & 1)) { beep(m); continue; }
        break;
      }
      if (flags & 0x20) {
        // 01:6C0C — enemies
        this.reset5E35();
        yield* this.msg(0x36);
        if (m.hram[0x12]! & 0x10) {
          yield* this.msg(0x38);
          const a = yield* this.waitAB();
          if (!(a & 1)) continue;
          confirm(m);
          this.setTarget(9);
          return;
        }
        if (!(yield* this.chooseGroup())) continue;
        this.setTarget((m.hram[0x0c]! + 5) & 0xff);
        return;
      }
      if (flags & 0x10) {
        this.setTarget(8);
        return;
      }
      // 01:6C00 → 01:6AF2 — one member
      yield* this.chooseMember();
      if (m.hram[0x0c] === 0xff) continue;
      this.setTarget(m.hram[0x0c]!);
      return;
    }
  }

  /** 01:6AF2 — party window again (5E35, 6AE9) and the menu over it; FF8C = member or FF. */
  private *chooseMember(): Co<number> {
    this.reset5E35();
    yield* this.windows();
    return yield* this.bank1.runMenu(0);
  }

  /** 01:6C29 — enemy group cursor list at C380 (row D939 + g, column D933 + g - 2), start at the
   *  first group with members left; then 01:6D5D. False when cancelled. */
  private *chooseGroup(): Co<boolean> {
    const m = this.m;
    const n = m.rd(0xd920);
    let b = n, hl = 0xc380, de = 0xd939;
    do { m.wr(hl, m.rd(de++)); hl += 2; b = (b - 1) & 0xff; } while (b);
    b = n; hl = 0xc381; de = 0xd933;
    do { m.wr(hl, (m.rd(de++) - 2) & 0xff); hl += 2; b = (b - 1) & 0xff; } while (b);
    let a = 0;
    while (!groupAlive(m, a)) a = (a + 1) & 0xff;
    m.hram[0x1b] = a;
    yield* this.groupCursor();
    return m.hram[0x0c] !== 0xff;
  }

  /** 01:6D5D — move the cursor over the groups with members left (down/right: next, up/left:
   *  previous, wrapping over 3); A: FF8C = FF9B, B: FF8C = FF. */
  private *groupCursor(): Co {
    const m = this.m;
    for (;;) {
      // 01:6DB3
      const [b, c] = itemPos(m);
      m.hram[0x17] = b;
      m.hram[0x18] = c;
      const a = yield* joyFrame(this.g);
      const next = a & 0x80 ? 1 : a & 0x40 ? -1 : a & 0x20 ? -1 : a & 0x10 ? 1 : 0;
      if (next > 0) {
        let i = m.hram[0x1b]!;
        do { i++; if (i >= 3) i = 0; } while (!groupAlive(m, i));
        m.hram[0x1b] = i;
        continue;
      }
      if (next < 0) {
        let i = m.hram[0x1b]!;
        do { if (!i) i = 3; i--; } while (!groupAlive(m, i));
        m.hram[0x1b] = i;
        continue;
      }
      if (a & 0x02) { m.hram[0x0c] = 0xff; return; }
      if (a & 0x01) { m.hram[0x0c] = m.hram[0x1b]!; return; }
    }
  }

  // ------------------------------------------------------------ after the battle

  /** 01:6C71 (01:501B) — meat prompt: the meat sprite (6F74), message 0x37 (eat?); on the first
   *  choice the party window (0x30) and a member whose status has neither bit 7 nor 4 (others
   *  beep); B in the party list goes back to the question. The window rows 9C00-9D3F are saved
   *  to 9D40 and restored; the text context is pushed and popped. Returns FF8C (member or FF). */
  *meat(a0 = this.m.rd(0xc0e5)): Co<number> {
    const m = this.m;
    yield* this.meatSprite(a0);
    this.text.pushContext();
    yield* r00_0550(this.g);
    yield* this.bank1["vramCopy"](0x9c00, 0x9d40, 0x140);
    yield* waitRelease(this.g);
    outer: for (;;) {
      m.hram[0x16] = 0;
      m.wr(0xc764, 0);
      this.reset5E35();
      m.hram[0x16] = 3;
      yield* this.msg(0x37);
      const a = yield* this.menu();
      if (a === 0xff) { m.hram[0x0c] = 0xff; break; }
      confirm(m);
      if (a !== 0) { m.hram[0x0c] = 0xff; break; }
      this.reset5E35();
      yield* this.msg(0x30);
      for (;;) {
        const v = yield* this.menu();
        if (v === 0xff) {
          yield* this.restoreRows();
          continue outer;
        }
        if (this.status(v) & 0x90) { beep(m); continue; }
        confirm(m);
        break outer;
      }
    }
    // 01:6CD3
    m.hram[0x16] = 0;
    this.reset5E35();
    yield* this.frameCC();
    yield* this.restoreRows();
    this.text.popContext();
    return m.hram[0x0c]!;
  }

  /** 01:6CE3 — window rows back from 9D40. */
  private *restoreRows(): Co {
    yield* this.bank1["vramCopy"](0x9d40, 0x9c00, 0x140);
  }

  /** 01:6F74 (01:5030) — the meat: tiles 04:7C50 → 8000 (0D:5009), ten steps of its sprite
   *  (positions from 0F:7B00 via 0D:500C, sprite 6 built at CC00 by 0D:500F, two DMA frames by
   *  0D:5006), then its four tiles copied to 9000 and placed at 98C9/98E9 in the BG map. */
  *meatSprite(a0 = this.m.rd(0xc0e5)): Co {
    const m = this.m;
    yield* this.farcall(0xd5009, { a: a0, hl: 0x7c50, b: 0x40 });
    for (let i = 0; i < 10; i++) {
      m.hram[0x12] = i; // FF92
      const r: Regs = { hl: 0x7b00 + 2 * i, a: 2 * i };
      const c = (yield* this.farcall(0xd500c, r)) as number;
      r.a = c;
      r.c = c;
      const b = (yield* this.farcall(0xd500c, r)) as number;
      yield* this.farcall(0xd500f, { a: 6, hl: 0xcc00, b, c });
      yield* this.farcall(0xd5006, { a: 6, b: 2 });
    }
    yield* vramBegin(this.g);
    copy(m, 0x8000, 0x9000, 0x40);
    m.wr(0x98c9, 0);
    m.wr(0x98ca, 1);
    m.wr(0x98e9, 2);
    m.wr(0x98ea, 3);
    yield* vramEnd(this.g);
  }

  // ------------------------------------------------------------ scripted monster appearance

  /** 01:6E27 (01:502A; text code 0x48 c b) — show monster c (D921 = c >> 4, D922 = c & 15) through
   *  0F:6092; its tiles (bank, address and size from 0D:5018) go to 9000: copied directly when
   *  b != 0, else with interrupts off while the picture waves in (01:6F49 / 01:6EE7): lines
   *  grow from 1 to 0x3F, the tiles stream in 0x20 bytes per frame, and the wave shrinks back. */
  *appear(b: number, c: number): Co {
    const m = this.m, g = this.g;
    m.hram[0x11] = b;
    m.wr(0xd921, c >> 4);
    m.wr(0xd922, c & 0x0f);
    yield* this.farcall(0xf6092, { a: c & 0x0f, b, c });
    m.hram[0x10] = 0;
    const r: Regs = { a: 0 };
    const bank = ((yield* this.farcall(0xd5018, r)) as number) & 0xff;
    const hl = (r.hl ?? 0) & 0xffff, bc = (((r.b ?? 0) << 8) | (r.c ?? 0)) & 0xffff;
    m.hram[0x10] = bank;
    if (m.hram[0x11]) {
      yield* this.bank1["vramFromRom"](bank, hl, 0x9000, bc);
      return;
    }
    m.wr(0xd97e, bank);
    m.wr(0xd97f, hl & 0xff);
    m.wr(0xd980, hl >> 8);
    m.wr(0xd981, 0x00);
    m.wr(0xd982, 0x90);
    m.wr(0xd983, ((bc >> 4) & 0xff) >> 1);
    m.wr(0xd984, 0);
    m.wr(0xd985, 0);
    fill(m, 0xc800, 0x40, 0x09);
    fill(m, 0xc900, 0x40, 0x00);
    m.wr(0xd97d, 2);
    g.ime = false;
    m.io[0x0f] = 0;
    m.hram[0x7f] = 0;
    try {
      for (let a = 1; a < 0x40; a++) {
        m.hram[0x10] = a;
        waveStep(m, 0x11, 0x01);
        yield* this.wave();
      }
      m.wr(0xd984, 1);
      for (let a = 0x60; ; ) {
        m.hram[0x11] = a;
        waveStep(m, 0x11, 0x01);
        yield* this.wave();
        if (m.rd(0xd985)) break;
        a = (m.hram[0x11]! - 1) & 0xff;
        if (!a) break;
      }
      for (let a = 0x40; ; ) {
        m.hram[0x10] = a;
        waveStep(m, 0x11, 0x01);
        yield* this.wave();
        a = (m.hram[0x10]! - 1) & 0xff;
        if (a === 0xff) break;
      }
    } finally {
      g.lineHook = null;
      m.io[0x0f] = 0;
      m.hram[0x7f] = 0x03;
      g.ime = true;
    }
  }

  /** 01:6EE7 — D97D (2) frames: in vblank, while D984 is set copy the next 0x20 tile bytes
   *  (bank D97E, D97F → D981; D983 chunks, then D984 = 0, D985 = 1); then lines 0 up to FF90
   *  (at most 0x3F) are scrolled by C800[line] - 9 (SCX), polled with interrupts off; then the
   *  frame tick (00:016E). */
  private *wave(): Co {
    const m = this.m, g = this.g;
    for (;;) {
      let hl = m.rd(0xd97f) | (m.rd(0xd980) << 8);
      let de = m.rd(0xd981) | (m.rd(0xd982) << 8);
      if (m.rd(0xd984)) {
        // 00:00B5 — copy 0x20 bytes from bank D97E
        const bank = m.rd(0xd97e);
        const prev = m.selectBank(bank);
        for (let i = 0; i < 0x20; i++) m.wr(de++, m.rd(hl++));
        m.selectBank(prev);
        m.wr(0xd97f, hl & 0xff);
        m.wr(0xd980, (hl >> 8) & 0xff);
        m.wr(0xd981, de & 0xff);
        m.wr(0xd982, (de >> 8) & 0xff);
        const n = (m.rd(0xd983) - 1) & 0xff;
        m.wr(0xd983, n);
        if (!n) {
          m.wr(0xd984, 0);
          m.wr(0xd985, 1);
        }
      }
      // 01:6F20 — per-line SCX while LY < FF90 and LY != 0x3F (probable timing: the value set
      // after line l is detected applies to that line)
      const e = m.hram[0x10]!;
      let l = 0, active = true;
      m.io[0x43] = (m.rd(0xc800) - 9) & 0xff;
      g.lineHook = (ly) => {
        if (!active || ly !== l) return;
        if (ly >= e || ly === 0x3f) {
          m.io[0x43] = 0;
          active = false;
          return;
        }
        l++;
        m.io[0x43] = (m.rd(0xc800 + l) - 9) & 0xff;
      };
      yield;
      g.lineHook = null;
      m.io[0x43] = 0;
      frameTick(g);
      const k = (m.rd(0xd97d) - 1) & 0xff;
      m.wr(0xd97d, k);
      if (k) continue;
      m.wr(0xd97d, 2);
      return;
    }
  }
}

/** Register the battle menus with an engine: the 01:5000 jump-table entries the battle code and
 *  the text engine call (each a farcall: bank 1 selected for the call, the caller's bank
 *  restored), and the FFA5 interrupt hooks. */
export function installBattleMenus(e: Engine): BattleMenus {
  const bm = new BattleMenus(e.g, e.text, e.bank1, (addr, regs) => e.far(addr, regs));
  const m = e.g.m;
  const entry = (addr: number, run: (regs: Regs) => Co<number | void>) => {
    e.extra.set(addr, function* (_e: Engine, regs: Regs) {
      farEnter(m, addr, regs.a);
      const prev = m.selectBank(0x01);
      const r = yield* run(regs);
      m.selectBank(prev);
      return r;
    });
  };
  entry(0x15015, () => bm.init());
  entry(0x15018, () => bm.commands());
  entry(0x1501b, (r) => bm.meat(r.a ?? m.rd(0xc0e5)));
  entry(0x1502a, (r) => bm.appear(r.b ?? 0, r.c ?? 0));
  entry(0x15030, (r) => bm.meatSprite(r.a ?? m.rd(0xc0e5)));
  e.g.hooks.vblankFfa5 = vblankFfa5;
  e.g.hooks.statFfa5 = statFfa5;
  return bm;
}

