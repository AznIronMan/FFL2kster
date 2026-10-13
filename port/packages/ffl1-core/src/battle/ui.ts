/** Legend I battle screens (06:5E27-63F7) and pictures (bank 07, 07:6E00-7AB4): the battle
 *  intro (monster tiles, the sliding window), the fight / run and command menus, the status and
 *  message windows, the attack animations and the hit shake. The battle logic (06:4000-5E24)
 *  is battle/core.ts. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import type { TextEngine } from "../text.js";
import { frame, farcallRam, classTiles, newMember } from "../title.js";
import { frameTick } from "../irq.js";
import {
  oamClear, oamDma, bufferClear, fill, copy, copyBank16, vramFill, vramFill16, vramCopy, vramCopy16, vramCopyBank,
  vramCopyBank16, vramBegin, vramEnd, blitRows, loadSharedTiles, cursorSet, cursorMove, frameInput, waitRelease,
  waitLy90, readBank, mul8, rand, vsync, cursorDraw, spriteGroup,
} from "../sys.js";
import type { Battle } from "./core.js";

export class NotPortedBattle extends Error {}

export class BattleUi {
  readonly coverage: Record<string, number> = {};


  constructor(readonly g: Game, readonly text: TextEngine, readonly b: Battle) {}

  get m(): Memory {
    return this.g.m;
  }
  hr(a: number): number {
    return this.m.hram[a - 0xff80]!;
  }
  hw(a: number, v: number): void {
    this.m.hram[a - 0xff80] = v & 0xff;
  }
  rd(a: number): number {
    return this.m.rd(a);
  }
  wr(a: number, v: number): void {
    this.m.wr(a, v & 0xff);
  }
  private cov(k: string): void {
    this.coverage[k] = (this.coverage[k] ?? 0) + 1;
  }

  /** A far call into bank 07 (00:0483 + the C38A trampoline). */
  private *far<T>(target: number, body: () => Co<T>): Co<T> {
    const prev = farcallRam(this.g, target, 0x07);
    const v = yield* body();
    this.g.selectBank(prev);
    return v;
  }

  // ---------------------------------------------------------------- the 06:5E00 jump table

  /** 06:5E00 -> 07:6E00 (07:71AC) */
  *intro(): Co {
    yield* this.far(0x6e00, () => this.introBody());
  }
  /** 06:5E06 -> 07:6E03 (07:6E0F) — the attack animation a. */
  *effect(a: number): Co {
    yield* this.far(0x6e03, () => this.effectBody(a));
  }
  /** 06:5E1E -> 07:6E06 (07:776D) — the hit shake. */
  *hitEffect(): Co {
    yield* this.far(0x6e06, () => this.shake());
  }
  /** 06:5E21 -> 07:6E09 (07:779C) — the BG map 9800 back from DD00. */
  *restoreMap(): Co {
    yield* this.far(0x6e09, () => this.restoreBody());
  }
  /** 06:5E12 -> 07:6E0C (07:74DA) — the monster pictures updated. */
  *pictures(): Co {
    yield* this.far(0x6e0c, () => this.picturesBody());
  }
  /** 06:5E18 -> 06:602C — the message window. */
  *openMessage(): Co {
    const m = this.m;
    this.hw(0xffd8, 0x41); this.hw(0xffd9, 0x99);
    this.hw(0xffda, 0x41); this.hw(0xffdb, 0x99);
    oamClear(m);
    bufferClear(m);
    frame(this.g, 0xc600, 0x12, 0x08);
    yield* this.show();
  }
  /** 06:5E0F -> 06:6028 — battle message n (00:088A). */
  *message(n: number): Co {
    yield* this.text.battle(n);
  }
  /** 06:5E1B -> 06:6290 — game over: wait for a button, then the restart (00:0101). */
  *gameOver(): Co {
    yield* waitRelease(this.g);
    while (!this.m.hram[0x0d]) yield;
    throw new GameOver();
  }
  /** 06:5E15 -> 06:5F31 — a meat: eat it? (00:0D9C) */
  *meat(id: number): Co {
    yield* this.meatBody(id);
  }

  // ---------------------------------------------------------------- windows (06:5E4A-63ED)

  /** 06:5E4A — the party entities' status, HP and class into the records (CC00 copied to DF00
   *  first). */
  syncRecords(): void {
    const m = this.m;
    copy(m, 0xcc00, 0xdf00, 0x80);
    for (let c = 0; c < 4; c++) {
      const rec = 0xcc00 + ((c * 31) & 0xff);
      const ent = 0xd002 + c * 32;
      m.wr(rec, m.rd(ent));
      for (let i = 0; i < 4; i++) m.wr(rec + 6 + i, m.rd(ent + 1 + i));
      m.wr(rec + 5, m.rd((ent & 0xffe0) | 0x1f));
    }
  }
  /** 06:5E7F — CC00 -> DF00 (128 bytes). */
  copyRecords(): void {
    copy(this.m, 0xcc00, 0xdf00, 0x80);
  }
  /** 06:5E8A — D825-D827: the group counts (FF for none). */
  groupCounts(): void {
    for (let b = 0; b < 3; b++) {
      let a = this.rd(0xd3ea + 2 * b);
      if (a === 0 || a === 0xff) a = 0xff;
      this.wr(0xd825 + b, a);
    }
  }
  /** 06:5EAE — z (true) when member C3AC can act (record +00 & E3 = 0). */
  memberOk(): boolean {
    const hl = 0xcc00 + ((this.rd(0xc3ac) * 31) & 0xff);
    return (this.rd(hl) & 0xe3) === 0;
  }

  /** 06:63ED — the scratch buffer C700-C7FF blank (7F). */
  scratch(): void {
    let hl = 0xc700;
    for (let i = 0; i < 0x100; i++) this.m.wr(hl++, 0x7f);
  }
  /** 06:63CA / 63CD — a b x c block from hl (C700) into the window buffer at de (20 wide). */
  block(de: number, b: number, c: number, hl = 0xc700): void {
    const m = this.m;
    for (; c; c--) {
      for (let i = 0; i < b; i++) m.wr(de + i, m.rd(hl++));
      de = (de & 0xff00) | ((de + 0x14) & 0xff);
    }
  }
  /** 06:63DE — the window buffer C600 to 9900 (20 x 10), a frame, OAM DMA. */
  *show(): Co {
    yield* blitRows(this.g, 0xc600, 0x9900, 0x14, 0x0a);
    yield* vsync(this.g);
    oamDma(this.m);
  }

  /** 06:5ECD — fight / run; true for run. */
  *fightRun(): Co<boolean> {
    this.cov("5ecd");
    return yield* this.yesNo(0x0703, 0x09, 0x04, 0xc70a, 0xc66c, 0x0905);
  }
  /** 06:5ECD / 5F8D — a two-choice window: frame bc at C700, text e (a) at hl, copied to de
   *  (size wh); the cursor at (0E, 09) moves by 2 between rows 0E and 10; true for the second. */
  private *yesNo(bc: number, a: number, e: number, hl: number, de: number, wh: number, sprites = false): Co<boolean> {
    const m = this.m;
    this.scratch();
    if (sprites) this.spritesToShadow(); // 06:5F8D
    frame(this.g, 0xc700, bc >> 8, bc & 0xff);
    yield* this.text.ui(a, 0, 0, e, hl);
    this.block(de, wh >> 8, wh & 0xff);
    yield* loadSharedTiles(this.g);
    cursorSet(m, 0x0e, 0x09);
    yield* this.show();
    for (;;) {
      const k = yield* frameInput(this.g);
      if (k & 0x80) {
        let v = this.hr(0xff92) + 2;
        if (v >= 0x12) v = 0x0e;
        this.hw(0xff92, v);
      }
      if (k & 0x40) {
        let v = this.hr(0xff92) - 2;
        if (v !== 0x0e) v = 0x10;
        this.hw(0xff92, v);
      }
      if (k & 0x01) return this.hr(0xff92) !== 0x0e;
      cursorMove(m);
    }
  }

  /** 06:604B — the status window: the monster groups (06:629B) and the party (06:62F3). */
  *status(): Co {
    const m = this.m;
    this.cov("604b");
    oamClear(m);
    bufferClear(m);
    this.groupCounts();
    yield* this.groupWindow();
    this.block(0xc608, 0x0c, 0x08);
    this.hw(0xffd2, 1);
    yield* this.partyWindow();
    this.block(0xc600, 0x09, 0x0a);
    yield* this.show();
  }
  /** 06:629B — the monster group list in C700 (ids C3C8, counts C3AD; text 3). */
  *groupWindow(): Co {
    const m = this.m;
    this.scratch();
    frame(this.g, 0xc700, 0x0a, 0x06);
    fill(m, 0xc3c8, 8, 0xff);
    fill(m, 0xc3ad, 3, 0xff);
    this.groupList(0xc3c8, 0xe9);
    this.groupList(0xc3ad, 0xea);
    yield* this.text.ui(0x0c, 0, 3, 0x03, 0xc719);
  }
  /** 06:62D8 — for each group c (0-2) whose [D325 + c] is not FF: [de + c] = [D3 (FFD0 + 2c)]. */
  private groupList(de: number, lo: number): void {
    const m = this.m;
    this.hw(0xffd0, lo);
    for (let c = 0; c < 3; c++, de++) {
      if (m.rd(0xd325 + c) === 0xff) continue;
      m.wr(de, m.rd(0xd300 | ((lo + 2 * c) & 0xff)));
    }
  }
  /** 06:62F3 — the party window in C700 (records synced, text 2 with c = FFD2; the members'
   *  sprite tiles to 8000). */
  *partyWindow(): Co {
    const m = this.m;
    this.scratch();
    frame(this.g, 0xc700, 0x07, 0x08);
    this.syncRecords();
    yield* this.text.ui(0x09, 0x08, this.hr(0xffd2), 0x02, 0xc70a);
    let de = 0x8000;
    for (let c = 0; c < 4; c++) {
      const hl = 0xcc00 + ((c * 31) & 0xff);
      const st = m.rd(hl);
      if (st === 0xff) {
        de = yield* vramFill(this.g, de, 0x40, 0);
        continue;
      }
      const f = st === 0 ? 0 : 1;
      de = yield* classTiles(this.g, m.rd(hl + 5), f, de);
    }
    this.copyRecords();
  }
  /** 06:633F — the member window (text 6) into C600. */
  *memberWindow(): Co {
    this.scratch();
    frame(this.g, 0xc700, 0x07, 0x04);
    this.syncRecords();
    yield* this.text.ui(0x09, 0x0a, 0x01, 0x06, 0xc713);
    this.copyRecords();
    this.block(0xc600, 0x09, 0x06);
  }
  /** 06:6365 — choosing a member: the cursor at (09, 00), the party window, then the item
   *  window (06:637E). */
  *memberChoice(): Co {
    cursorSet(this.m, 0x09, 0x00);
    this.hw(0xffd2, 2);
    yield* this.partyWindow();
    this.block(0xc601, 0x09, 0x0a);
    yield* this.show();
    yield* this.itemWindow();
  }
  /** 06:637E — member C3AC's item window (lists C3D0/C3DA, text 5 in C700). */
  *itemWindow(): Co {
    this.scratch();
    frame(this.g, 0xc700, 0x0a, 0x08);
    this.block(0xc608, 0x0c, 0x0a);
    this.itemLists(this.rd(0xc3ac));
    this.scratch();
    yield* this.text.ui(0x09, 0, 0, 0x05, 0xc709);
  }
  /** 00:055D — member l's battle items: ids C3D0, uses C3DA (FF when unusable in battle or
   *  without uses). */
  itemLists(l: number): void {
    const m = this.m;
    let hl = 0xd00e + l * 32;
    for (let i = 0; i < 8; i++) m.wr(0xc3d0 + i, m.rd(hl + i));
    for (let i = 0; i < 8; i++) m.wr(0xc3da + i, m.rd(hl + 8 + i));
    for (let i = 0; i < 8; i++) {
      const id = m.rd(0xc3d0 + i);
      const f0 = readBank(this.g, 0x06, 0x7700 + id * 8);
      if (!(f0 & 1)) { m.wr(0xc3d0 + i, 0xff); m.wr(0xc3da + i, 0xff); }
      const u = m.rd(0xc3da + i);
      if (u === 0 || u === 0xff) { m.wr(0xc3d0 + i, 0xff); m.wr(0xc3da + i, 0xff); }
    }
  }
  /** 06:63A6 — the item list (4 rows from C700 + C424 * 18) into the window, shown. */
  *itemRows(): Co {
    const hl = 0xc700 + mul8(this.rd(0xc424), 0x12);
    this.block(0xc61e, 0x09, 0x08, hl);
    yield* this.show();
  }
  /** 06:63BF — "nothing" (text 8). */
  *nothingText(): Co {
    yield* this.text.ui(0x14, 0, 0, 0x08, 0xc631);
    yield* this.show();
  }

  // ---------------------------------------------------------------- commands (06:6073)

  /** 06:6073 — each able member chooses an item (06:618B) and its target; true (carry) when B
   *  backs out of the first member. */
  *commands(): Co<boolean> {
    const m = this.m;
    this.cov("6073");
    this.groupCounts();
    let hl = 0xd3ef;
    for (let b = 0; b < 4; b++) { m.wr(hl, 0xff); m.wr(hl + 1, 0xff); hl += 4; }
    m.wr(0xc3ac, 0xff);
    let next = true;
    for (;;) {
      if (next) {
        // 6089: the next able member
        let done = false;
        for (;;) {
          m.wr(0xc3ac, m.rd(0xc3ac) + 1);
          if (m.rd(0xc3ac) >= 4) { done = true; break; }
          if (this.memberOk()) break;
        }
        if (done) return false;
      }
      next = true;
      // 609B
      const sel = yield* this.chooseItem();
      if (sel === null) {
        // 6108: back to the previous able member
        let back = false;
        for (;;) {
          m.wr(0xc3ac, m.rd(0xc3ac) - 1);
          if (m.rd(0xc3ac) === 0xff) { back = true; break; }
          if (this.memberOk()) break;
        }
        if (back) return true;
        next = false;
        continue;
      }
      if (sel === 0xff) continue;
      if (m.rd(0xc3da + sel) === 0xff) continue;
      const id = m.rd(0xc3d0 + sel);
      const f1 = readBank(this.g, 0x06, 0x7700 + id * 8 + 1);
      if (f1 & 0x40) continue;
      if (f1 & 0x80) {
        if (!(yield* this.chooseGroup())) next = false;
        continue;
      }
      // 60C3: a member target
      yield* this.memberChoice();
      const t = yield* this.chooseMember();
      const de = 0xd3ef + ((m.rd(0xc3ac) * 4) & 0xff) + 1;
      m.wr(de, t.a);
      if (t.cancel) next = false;
    }
  }

  /** 06:618B — member C3AC's item: the slot, FF for "nothing", null for B. */
  *chooseItem(): Co<number | null> {
    const m = this.m;
    oamClear(m);
    bufferClear(m);
    yield* this.memberWindow();
    yield* this.itemWindow();
    let c = 0;
    for (let i = 0; i < 8; i++) if (m.rd(0xc3da + i) !== 0xff) c++;
    const mem = m.rd(0xc3ac);
    let slot: number;
    if (c === 0) {
      yield* this.nothingText();
      for (;;) {
        const k = yield* frameInput(this.g);
        if (k & 0x02) return null;
        if (k & 0x01) break;
      }
      slot = 0xff;
    } else {
      m.wr(0xc424, m.rd(0xd836 + mem));
      yield* this.itemRows();
      cursorSet(m, m.rd(0xd832 + mem), 0x08);
      for (;;) {
        const k = yield* frameInput(this.g);
        if (k & 0x80) {
          const v = this.hr(0xff92) + 2;
          if (v < 0x12) this.hw(0xff92, v);
          else if (m.rd(0xc424) !== 4) {
            m.wr(0xc424, m.rd(0xc424) + 1);
            yield* this.itemRows();
          }
          continue;
        }
        if (k & 0x40) {
          const v = this.hr(0xff92) - 2;
          if (v >= 0x0a) this.hw(0xff92, v);
          else if (m.rd(0xc424) !== 0) {
            m.wr(0xc424, m.rd(0xc424) - 1);
            yield* this.itemRows();
          }
          continue;
        }
        if (k & 0x02) return null;
        if (k & 0x01) {
          const s = (m.rd(0xc424) + ((this.hr(0xff92) - 0x0a) >> 1)) & 0xff;
          if (m.rd(0xc3da + s) === 0xff) continue;
          m.wr(0xd832 + mem, this.hr(0xff92));
          m.wr(0xd836 + mem, m.rd(0xc424));
          slot = s;
          break;
        }
        cursorMove(m);
      }
    }
    m.wr(0xd3ef + ((mem * 4) & 0xff), slot);
    return slot;
  }

  /** 06:6252 — the member cursor (rows 09-0F); {a: member, cancel: B}. */
  *chooseMember(): Co<{ a: number; cancel: boolean }> {
    for (;;) {
      const k = yield* frameInput(this.g);
      if (k & 0x80) {
        let v = this.hr(0xff92) + 2;
        if (v >= 0x11) v = 0x09;
        this.hw(0xff92, v);
        continue;
      }
      if (k & 0x40) {
        let v = this.hr(0xff92) - 2;
        if (v < 0x09) v = 0x0f;
        this.hw(0xff92, v);
        continue;
      }
      if (k & 0x02) return { a: k, cancel: true };
      if (k & 0x01) return { a: (this.hr(0xff92) - 9) >> 1, cancel: false };
      cursorMove(this.m);
    }
  }

  /** 06:60D7 — a monster group target (left / right over the living groups); false for B. */
  *chooseGroup(): Co<boolean> {
    const m = this.m;
    oamClear(m);
    this.hw(0xff92, 0x03);
    m.wr(0xd831, 0);
    while (m.rd(0xd825 + m.rd(0xd831)) === 0xff) m.wr(0xd831, m.rd(0xd831) + 1);
    this.hw(0xff93, m.rd(0xd82e + m.rd(0xd831)));
    // 019E with de = D3EF + 4 * member (left by 06:618B)
    cursorDraw(m, 0xd3, (0xef + 4 * m.rd(0xc3ac)) & 0xff);
    yield* this.groupWindow();
    this.block(0xc600, 0x0c, 0x08);
    yield* this.show();
    for (;;) {
      const k = yield* frameInput(this.g);
      if (k & 0x20) {
        do {
          let a = m.rd(0xd831);
          a = a ? a - 1 : 2;
          m.wr(0xd831, a);
        } while (m.rd(0xd825 + m.rd(0xd831)) === 0xff);
        this.hw(0xff93, m.rd(0xd82e + m.rd(0xd831)));
        continue;
      }
      if (k & 0x10) {
        do {
          let a = m.rd(0xd831);
          a = a === 2 ? 0 : a + 1;
          m.wr(0xd831, a);
        } while (m.rd(0xd825 + m.rd(0xd831)) === 0xff);
        this.hw(0xff93, m.rd(0xd82e + m.rd(0xd831)));
        continue;
      }
      if (k & 0x02) return false;
      if (k & 0x01) {
        m.wr(0xd3ef + ((m.rd(0xc3ac) * 4) & 0xff) + 1, m.rd(0xd831) + 4);
        return true;
      }
      cursorMove(m);
    }
  }

  // ---------------------------------------------------------------- meat (06:5F31)

  /** 06:5F31 — the meat sprite, message 2E; eat it? (06:5F8D) — which member (06:6252), then
   *  00:0D9C; message 22 or 2F. */
  *meatBody(id: number): Co {
    const m = this.m;
    this.cov("5f31");
    m.wr(0xc3c8, id);
    m.wr(0xff49, 0xe4);
    spriteGroup(m, 0xc100, 0x28, 0x48, 0xfa, 0x10);
    this.spritesToShadow();
    yield* vsync(this.g);
    oamDma(m);
    yield* this.text.battle(0x2e);
    yield* this.saveWindow();
    yield* waitRelease(this.g);
    for (;;) {
      this.restoreWindow();
      if (yield* this.yesNo(0x0804, 0x0a, 0x09, 0xc715, 0xc658, 0x0a06, true)) {
        this.restoreWindow();
        this.spritesToShadow();
        return yield* this.show();
      }
      yield* this.memberChoice();
      let cancel = false;
      for (;;) {
        const t = yield* this.chooseMember();
        if (t.cancel) { cancel = true; break; }
        m.wr(0xc3ac, t.a);
        if (this.memberOk()) break;
      }
      if (cancel) continue;
      const ok = yield* this.eatMeatBody();
      const e = ok ? 0x2f : 0x22;
      this.restoreWindow();
      this.spritesToShadow();
      yield* this.show();
      return yield* this.text.battle(e);
    }
  }
  /** 06:5FF4 — the window rows of 9900 (20 x 10) saved to DE00. */
  private *saveWindow(): Co {
    let hl = 0x9900, de = 0xde00;
    for (let c = 0x0a; c; c--) {
      [hl, de] = yield* vramCopy(this.g, hl, de, 0x14);
      hl = (hl + 0x0c) & 0xffff;
    }
  }
  /** 06:6008 — DE00 -> C600 (256 bytes). */
  private restoreWindow(): void {
    copy(this.m, 0xde00, 0xc600, 0);
  }
  /** 06:601A — OAM shadow cleared, C100 -> C080 (16 bytes). */
  private spritesToShadow(): void {
    oamClear(this.m);
    copy(this.m, 0xc100, 0xc080, 0x10);
  }

  // ---------------------------------------------------------------- bank 07: the battle screen

  /** 07:71AC — the battle screen: music, monster group layout (02:7900 tables), monster tiles
   *  (bank 04) to 8800, the picture map (D900 -> 9800), then the window sliding off line by
   *  line (07:743A). */
  *introBody(): Co {
    const m = this.m, g = this.g;
    this.cov("71ac");
    this.hw(0xffe4, 0x05);
    oamClear(m);
    yield* vsync(g);
    oamDma(m);
    m.wr(0xff40, 0x80);
    m.wr(0xff42, 0); m.wr(0xff43, 0);
    fill(m, 0xd832, 4, 0x0a);
    fill(m, 0xd836, 4, 0);
    fill(m, 0xdf80, 0x20, 0);
    this.hw(0xffd0, 0);
    let hl = 0xdf84, de = 0xd3ea;
    for (let c = 3; c; c--) {
      const a = m.rd(de);
      de += 2;
      if (a === 0xff) continue;
      hl = fill(m, hl, a, this.hr(0xffd0));
      this.hw(0xffd0, this.hr(0xffd0) + 1);
    }
    copy(m, 0xd3e9, 0xd800, 6);
    this.countGroups();
    const n = m.rd(0xd80c);
    for (let k = 0; k < n; k++) {
      const id = m.rd(0xd800 + 2 * k);
      const info = this.pictureInfo(id);
      m.wr(0xd806 + k, info.b);
      m.wr(0xd809 + k, info.c);
      m.wr(0xd83a + k, info.a);
    }
    this.hw(0xffe0, m.rd(0x74d7 + m.rd(0xd83a)));
    copyBank16(g, 0x02, 0x7900, 0xc600, 0x100);
    for (let k = 0; k < n; k++) {
      const w = m.rd(0xd806 + k);
      m.wr(0xd80d + k, m.rd(0xc6c8 + 2 * w));
      m.wr(0xd810 + k, m.rd(0xc6c9 + 2 * w));
    }
    for (let k = 0; k < n; k++) m.wr(0xd819 + k, m.rd(0xc6ea + m.rd(0xd806 + k)));
    let lay = this.layout();
    for (let k = 0; k < n; k++) m.wr(0xd813 + k, (m.rd(lay + k) - (m.rd(0xd80d + k) >> 1)) & 0xff);
    for (let k = 0; k < n; k++) m.wr(0xd816 + k, m.rd(0xc6e5 + m.rd(0xd806 + k)));
    m.wr(0xd81c, 0x80);
    for (let k = 1; k < n; k++) m.wr(0xd81c + k, (m.rd(0xc6ea + m.rd(0xd806 + k - 1)) + m.rd(0xd81b + k)) & 0xff);
    lay = this.layout();
    copy(m, lay, 0xd828, 3);
    copy(m, 0xd810, 0xd82b, 3);
    for (let k = 0; k < 3; k++) {
      const v = (m.rd(0xd82b + k) >> 1);
      m.wr(0xd82b + k, (m.rd(0xd816 + k) + v) & 0xff);
    }
    lay = this.layout();
    for (let k = 0; k < 3; k++) m.wr(0xd82e + k, (m.rd(lay + k) - 3) & 0xff);
    for (let k = 0; k < n; k++) {
      const w = m.rd(0xd806 + k);
      const base = m.rd(0xc6d2 + 2 * w) | (m.rd(0xc6d3 + 2 * w) << 8);
      const p = ((mul8(m.rd(0xd819 + k), m.rd(0xd809 + k)) << 4) + base) & 0xffff;
      m.wr(0xd81f + 2 * k, p & 0xff);
      m.wr(0xd820 + 2 * k, p >> 8);
    }
    fill(m, 0xd832, 4, 0x0a);
    fill(m, 0xd836, 4, 0);
    this.hw(0xffd0, 0);
    for (let d0 = 0; d0 < 4; d0++) {
      this.hw(0xffd0, d0);
      this.itemLists(d0);
      for (let c = 0; c < 8; c++) {
        if (m.rd(0xc3da + c) === 0xff) continue;
        m.wr(0xd832 + d0, ((c & 3) * 2 + 0x0a) & 0xff);
        m.wr(0xd836 + d0, c >= 4 ? 4 : 0);
        break;
      }
    }
    this.hw(0xffd0, 4);
    de = 0x8800;
    for (let c = 0; c < n; c++) {
      const tiles = m.rd(0xd819 + c);
      const src = m.rd(0xd81f + 2 * c) | (m.rd(0xd820 + 2 * c) << 8);
      yield* vsync(g);
      yield* vsync(g);
      [, de] = yield* vramCopyBank16(g, 0x04, src, de, (tiles << 4) & 0xffff);
    }
    yield* vramCopyBank(g, 0x02, 0x7f00, 0x8f00, 0);
    oamClear(m);
    bufferClear(m);
    fill(m, 0xd900, 0xa0, 0x7f);
    for (let e = n; e; e--) {
      const k = e - 1;
      let p = 0xd900 + ((m.rd(0xd813 + k) + mul8(0x14, m.rd(0xd816 + k))) & 0xff);
      const w = m.rd(0xd80d + k), h = m.rd(0xd810 + k);
      let t = m.rd(0xd81c + k);
      for (let b = h; b; b--) {
        for (let c = w; c; c--) m.wr(p++, t++);
        p = (p + ((0x14 - w) & 0xff)) & 0xffff;
      }
    }
    yield* vramFill16(g, 0x9800, 0x0800, 0x7f);
    yield* blitRows(g, 0xd900, 0x9800, 0x14, 0x08);
    m.wr(0xd877, 0x98);
    yield* vsync(g);
    oamDma(m);
    m.wr(0xff40, 0xe3);
    m.wr(0xff4b, 0x07);
    m.wr(0xff4a, 0);
    fill(m, 0xd900, 0x40, 0x07);
    for (let i = 0; i < 0x40; i++) m.wr(0xda00 + i, (rand(m, 0x7431, 0x07, 0x57) - 0x57) & 0xff);
    yield* this.diOn();
    // 743A: the sliding window, one polled frame per step (00:041B returns at once the first
    // time: the frame wait of 00:0424 has just ended at LY = 0x90)
    for (let first = true; ; first = false) {
      if (!first) yield* waitLy90(g);
      const wx = Array.from({ length: 0x40 }, (_, i) => m.rd(0xd900 + i));
      this.rasterWX(wx);
      m.wr(0xff4b, 0xa5);
      frameTick(g);
      for (let l = 0; l < 0x40; l++) {
        const o = m.rd(0xda00 + l);
        if (o === 0) {
          let a = m.rd(0xd900 + l) + 8;
          if (a >= 0xa6) a = 0xa5;
          m.wr(0xd900 + l, a);
        } else {
          const a = (o + 8) & 0xff;
          if (a >= 0xb0 || a < 0x07) m.wr(0xda00 + l, a);
          else { m.wr(0xd900 + l, a); m.wr(0xda00 + l, 0); }
        }
      }
      let c = 0;
      for (let i = 0; i < 0x40; i++) c |= (m.rd(0xd900 + i) - 0xa5) & 0xff;
      if (!c) break;
    }
    this.diOff();
    yield* vsync(g);
    m.wr(0xff40, 0xc3);
  }
  /** Lines 0-3F of the coming frame with WX from the polled loop (07:7440: each line's value is
   *  written as the previous line starts), WX = A5 from line 3F. */
  private rasterWX(wx: number[]): void {
    const m = this.m;
    this.g.lineHook = (ly) => {
      if (ly < 0x3f) m.io[0x4b] = wx[ly + 1]!;
      else if (ly === 0x3f) m.io[0x4b] = 0xa5;
      else this.g.lineHook = null;
    };
  }
  /** 00:0424 — a frame wait, interrupts off (IE saved in FF8F, IE = IF = 0). */
  private *diOn(): Co {
    yield* vsync(this.g);
    this.g.ime = false;
    this.hw(0xff8f, this.hr(0xffff));
    this.hw(0xff0f, 0);
    this.hw(0xffff, 0);
  }
  /** 00:0432 — IF = 0, IE back from FF8F, reti. */
  private diOff(): void {
    this.hw(0xff0f, 0);
    this.hw(0xffff, this.hr(0xff8f));
    this.g.ime = true;
  }
  /** 07:74BE — D80C = how many groups have monsters. */
  countGroups(): void {
    let c = 0;
    for (let b = 0; b < 3; b++) {
      const a = this.rd(0xd3ea + 2 * b);
      if (a !== 0 && a !== 0xff) c++;
    }
    this.wr(0xd80c, c);
  }
  /** 07:74AE — the layout row for D80C groups (C6DC + 3 * (n - 1)). */
  private layout(): number {
    return 0xc6dc + ((this.rd(0xd80c) - 1) * 3 & 0xff);
  }
  /** 00:05DB — monster id a's picture: b = width class, c = height, a = type (1 for the bosses
   *  27-31 and 40, 2 for 32); FF88 = the table byte. */
  pictureInfo(id: number): { a: number; b: number; c: number } {
    const g = this.g, m = this.m;
    const prev = g.selectBank(0x02);
    const v = m.rd((0x7900 + id) & 0xffff);
    g.selectBank(prev);
    m.hram[0x08] = v;
    const a = [0x27, 0x28, 0x29, 0x30, 0x31, 0x40].includes(v) ? 1 : v === 0x32 ? 2 : 0;
    return { a, b: (v >> 4) & 7, c: v & 0x0f };
  }

  /** 07:779C — 9800 back from DD00 (256 bytes) unless D877 is already 98. */
  *restoreBody(): Co {
    if (this.rd(0xd877) === 0x98) return;
    this.wr(0xd877, 0x98);
    yield* vramCopy(this.g, 0xdd00, 0x9800, 0);
  }

  /** 07:776D — the hit shake: the status area moved to the window (9C00) and shaken by WY
   *  (07:7AE7 offsets, 2 x 8 frames). */
  *shake(): Co {
    const m = this.m;
    this.cov("776d");
    yield* this.windowCopy();
    for (let b = 2; b; b--) {
      this.hw(0xffd2, 0x40);
      for (let i = 0; i < 8; i++) {
        yield* vsync(this.g);
        m.wr(0xff4a, (this.hr(0xffd2) + m.rd(0x7ae7 + i)) & 0xff);
      }
    }
    yield* this.windowBack();
  }
  /** 07:7A6D — 9900 (0x140) -> 9C00, the window at WY 40 over it, 9900 blanked. */
  private *windowCopy(): Co {
    const m = this.m;
    yield* vramCopy16(this.g, 0x9900, 0x9c00, 0x140);
    yield* vsync(this.g);
    m.wr(0xff4a, 0x40);
    m.wr(0xff4b, 0x07);
    m.wr(0xff40, m.rd(0xff40) | 0x60);
    yield* vramFill16(this.g, 0x9900, 0x140, 0x7f);
  }
  /** 07:7A93 — back: WY 40, scroll 0, 9C00 -> 9900, the window off. */
  private *windowBack(): Co {
    const m = this.m;
    yield* vsync(this.g);
    m.wr(0xff4a, 0x40);
    m.wr(0xff4b, 0x07);
    m.wr(0xff43, 0);
    m.wr(0xff42, 0);
    yield* vramCopy16(this.g, 0x9c00, 0x9900, 0x140);
    yield* vsync(this.g);
    m.wr(0xff40, m.rd(0xff40) & ~0x20);
  }

  /** 07:74DA — the pictures after a change: dead groups erased (07:770F); a boss's death
   *  effect; D800 = D3E9 (6 bytes). */
  *picturesBody(): Co {
    const m = this.m;
    if (m.rd(0xd877) === 0x98 && m.rd(0xd83a) !== 0) {
      const c = m.rd(0xd83a);
      if (m.rd(0xd3ea) === 0) {
        if (c === 1) yield* this.bossFall();
        else yield* this.bossFade();
      }
    } else yield* this.eraseDead();
    copy(m, 0xd3e9, 0xd800, 6);
  }
  /** 07:7510 — a boss's fall: per-line SCX (lines 0-3F) spreading from both ends (07:7595)
   *  every 4 polled frames until D91F = 70, then the top map blanked. */
  private *bossFall(): Co {
    const m = this.m, g = this.g;
    this.cov("7510");
    this.hw(0xffd2, 4);
    this.hw(0xffd1, 0);
    fill(m, 0xd900, 0, 0);
    yield* vramFill(g, 0x9c00, 0, 0x7f);
    yield* vramCopy16(g, 0x9900, 0x9d00, 0x140);
    yield* this.diOn();
    m.wr(0xff40, 0xc3);
    m.wr(0xff4b, 0x07);
    m.wr(0xff4a, 0);
    for (let first = true; ; first = false) {
      if (!first) yield* waitLy90(g);
      const t = Array.from({ length: 0x40 }, (_, i) => m.rd(0xd900 + i));
      this.raster([0x43], (ly) => [ly < 0x3f ? t[ly + 1] : ly === 0x3f ? 0 : undefined]);
      m.wr(0xff43, 0);
      frameTick(g);
      this.hw(0xffd2, this.hr(0xffd2) - 1);
      if (this.hr(0xffd2)) continue;
      this.hw(0xffd2, 4);
      let a = this.hr(0xffd1) + 1;
      if (a >= 0x20) a = 0x20;
      this.hw(0xffd1, a);
      this.spread();
      if (m.rd(0xd91f) === 0x70) break;
    }
    yield* waitLy90(g);
    m.wr(0xff40, 0xe3);
    this.diOff();
    yield* vramFill(g, 0x9800, 0, 0x7f);
    yield* vsync(g);
    m.wr(0xff40, 0xc3);
  }
  /** 07:75C6 — the other boss death: the picture copied to the window (8 rows of 10 tiles from
   *  980A to 9C00, a column of 10 from 9913 to 9D00), the window over lines 0-3F (WX = 57) while
   *  the map behind it is blanked 4 tiles a frame; then per line 0-3F, SCX = D900[l], WX = SCX + 57
   *  (at most A5) and BGP white where WX = A5. Every FFD0 frames (4, then 1 once FFD1 >= 20) the
   *  entries down to FFD1 fall by FFD3 (1, then 8 once D93F moves; at most 50) and the rest are
   *  cleared, until D93F = 50; then 9806 (8 rows of 4) set to tile C3. */
  private *bossFade(): Co {
    const m = this.m, g = this.g;
    this.cov("75c6");
    this.hw(0xffd0, 4);
    this.hw(0xffd2, 1);
    this.hw(0xffd3, 1);
    this.hw(0xffd1, 0);
    fill(m, 0xd900, 0, 0);
    yield* vramBegin(g);
    let hl = 0x980a, de = 0x9c00;
    for (let c = 8; c; c--) {
      [hl, de] = copy(m, hl, de, 10);
      hl = (hl + 0x16) & 0xffff;
      de = (de + 0x16) & 0xffff;
    }
    yield* vramEnd(g);
    hl = 0x9913;
    de = 0x9d00;
    yield* vramBegin(g);
    for (let c = 10; c; c--) {
      m.wr(de, m.rd(hl));
      hl = (hl + 0x20) & 0xffff;
      de = (de + 0x20) & 0xffff;
    }
    yield* vramEnd(g);
    yield* this.diOn();
    m.wr(0xff40, 0xe3);
    m.wr(0xff4a, 0);
    // 07:7627: WX = 57 from line 0 (polled LY = 0), 9F from line 40 (polled LY >= 40)
    const windowTop = () => {
      m.wr(0xff4b, 0x57);
      this.raster([0x4b], (ly) => [ly === 0x40 ? 0x9f : undefined]);
      frameTick(g);
    };
    hl = 0x980a;
    for (let c = 8; c; c--) {
      windowTop();
      yield* waitLy90(g);
      hl = (fill(m, hl, 4, 0x7f) + 0x1c) & 0xffff;
    }
    windowTop();
    for (;;) {
      m.wr(0xff47, m.rd(0xc3a6));
      yield* waitLy90(g); // 07:766B polls LY >= 98: the frame's vblank
      const d = m.rd(0xc3a6), fall = this.hr(0xffd2) === 1;
      const lines: number[][] = [];
      for (let l = 0; l < 0x40; l++) {
        const a = m.rd(0xd900 + l);
        let wx = (a + 0x57) & 0xff;
        if (wx >= 0xa5) wx = 0xa5;
        lines.push([a, wx, wx === 0xa5 ? 0 : d]);
        if (!fall) continue;
        let v = 0;
        if (this.hr(0xffd1) >= l) {
          v = (this.hr(0xffd3) + a) & 0xff;
          if (v >= 0x50) v = 0x50;
        }
        m.wr(0xd900 + l, v);
      }
      // each entry is written before its line is polled: line ly shows entry ly + 1
      this.raster([0x43, 0x4b, 0x47], (ly) =>
        ly < 0x3f ? lines[ly + 1]! : ly === 0x3f ? [0, 0x9f, d] : [undefined, undefined, undefined]);
      frameTick(g);
      this.hw(0xffd2, this.hr(0xffd2) - 1);
      if (this.hr(0xffd2)) continue;
      this.hw(0xffd2, this.hr(0xffd0));
      let a = this.hr(0xffd1) + 1;
      if (a >= 0x40) a = 0x40;
      this.hw(0xffd1, a);
      if (a >= 0x20) this.hw(0xffd0, 1);
      if (m.rd(0xd93f)) this.hw(0xffd3, 8);
      if (m.rd(0xd93f) === 0x50) break;
    }
    // 07:76EE: a = 7F for the fill is overwritten by the LCDC value: the 8 rows of 4 at 9806
    // take tile C3
    yield* waitLy90(g);
    m.wr(0xff40, 0xc3);
    hl = 0x9806;
    for (let c = 8; c; c--) hl = (fill(m, hl, 4, 0xc3) + 0x1c) & 0xffff;
    this.diOff();
  }
  /** 07:7595 — D900 from the top (FFD1 steps: 0 -> 1, else doubled up to 70) and from D93F
   *  down (0 -> FF, else doubled, at least 90). A zero entry is bumped without moving on. */
  private spread(): void {
    const m = this.m;
    let hl = 0xd900;
    for (let b = this.hr(0xffd1); b; b--) {
      const a = m.rd(hl);
      if (!a) { m.wr(hl, 1); continue; }
      let v = (a * 2) & 0xff;
      if (v >= 0x70) v = 0x70;
      m.wr(hl++, v);
    }
    hl = 0xd93f;
    for (let b = this.hr(0xffd1); b; b--) {
      const a = m.rd(hl);
      if (!a) { m.wr(hl, 0xff); continue; }
      let v = (a * 2) & 0xff;
      if (v < 0x90) v = 0x90;
      m.wr(hl--, v);
    }
  }

  /** 07:770F — each group now empty that was not: its picture erased (07:772D). */
  private *eraseDead(): Co {
    const m = this.m;
    for (let b = 0; b < 3; b++) {
      if (m.rd(0xd3ea + 2 * b) === 0 && m.rd(0xd801 + 2 * b) !== 0) yield* this.erase(b);
    }
  }
  /** 07:772D — group b's picture blanked on the current map (D877). */
  private *erase(b: number): Co {
    const m = this.m;
    this.hw(0xffd0, b);
    const w = m.rd(0xd80d + b), h = m.rd(0xd810 + b), x = m.rd(0xd813 + b), y = m.rd(0xd816 + b);
    let hl = mul8(0x20, y);
    hl = (hl + x) & 0xffff;
    hl = (((m.rd(0xd877) + (hl >> 8)) & 0xff) << 8) | (hl & 0xff);
    const skip = (0x20 - w) & 0xff;
    yield* vramBegin(this.g);
    for (let r = h; r; r--) {
      hl = fill(m, hl, w, 0x7f);
      hl = (hl + skip) & 0xffff;
    }
    yield* vramEnd(this.g);
  }

  // ---------------------------------------------------------------- bank 07: attack animations

  /** 07:6E0F — the attack animation of item FFB2 (FFD5 = its field 6): only for items with
   *  field 1 bit 7, on a monster target; bit 6 animates every group. High nibble: a screen
   *  effect script (07:77AF); low nibble: a sprite script (07:6E60). */
  *effectBody(a: number): Co {
    const m = this.m, g = this.g;
    this.hw(0xffd5, a);
    if (!a) return;
    this.countGroups();
    const f1 = readBank(g, 0x06, (this.hr(0xffb2) * 8 + 0x7701) & 0xffff) & 0xc0;
    if (!(f1 & 0x80)) return;
    const v = (f1 << 1) & 0xff;
    m.wr(0xd83c, v);
    m.wr(0xd83b, (v & 0x80) ? m.rd(0xd80c) : 1);
    if (this.hr(0xffb1) < 4) return;
    this.cov("6e0f");
    oamClear(m);
    yield* vramCopyBank16(g, 0x03, 0x7650, 0x8000, 0x400);
    const hi = this.hr(0xffd5) >> 4;
    if (hi) yield* this.screenScript(hi);
    yield* this.spriteScript();
    oamClear(m);
    yield* vsync(g);
    oamDma(m);
  }

  /** 07:77AF — screen effect script n (07:7BA0): effect numbers until 0. */
  private *screenScript(n: number): Co {
    const m = this.m;
    let p = m.rd(0x7ba0 + 2 * (n - 1)) | (m.rd(0x7ba1 + 2 * (n - 1)) << 8);
    this.hw(0xffd6, p & 0xff);
    this.hw(0xffd7, p >> 8);
    for (;;) {
      const a = m.rd(p);
      if (!a) return;
      p++;
      this.hw(0xffd6, p & 0xff);
      this.hw(0xffd7, p >> 8);
      yield* this.screenEffect(a);
    }
  }
  /** 07:6E60 — sprite script (FFD5 & 0F) of 07:7C00: blocks of (repeat << 4 | commands - 1). */
  private *spriteScript(): Co {
    const m = this.m;
    m.wr(0xc428, 0);
    const n = this.hr(0xffd5) & 0x0f;
    if (!n) return;
    let hl = m.rd(0x7c00 + 2 * (n - 1)) | (m.rd(0x7c01 + 2 * (n - 1)) << 8);
    for (;;) {
      const a = m.rd(hl);
      if (!a) return;
      m.wr(0xd83d, a >> 4);
      m.wr(0xd83e, (a & 0x0f) + 1);
      m.wr(0xd83f, (a & 0x0f) + 1);
      hl++;
      this.hw(0xfff0, hl & 0xff);
      this.hw(0xfff1, hl >> 8);
      this.blockEnd = -1;
      block: do {
        this.setScript(this.hr(0xfff0) | (this.hr(0xfff1) << 8));
        do {
          yield* this.scriptCommand();
          if (this.blockEnd >= 0) break block;
          m.wr(0xd83e, m.rd(0xd83e) - 1);
        } while (m.rd(0xd83e));
        m.wr(0xd83e, m.rd(0xd83f));
        m.wr(0xd83d, m.rd(0xd83d) - 1);
      } while (m.rd(0xd83d));
      hl = this.blockEnd >= 0 ? this.blockEnd : this.script();
    }
  }
  /** Set by 07:6F1E: the script position after the block it consumed. */
  private blockEnd = -1;
  /** 07:7197 / 71A0 — the script pointer FFF2/FFF3. */
  private setScript(hl: number): void {
    this.hw(0xfff2, hl & 0xff);
    this.hw(0xfff3, hl >> 8);
  }
  private script(): number {
    return this.hr(0xfff2) | (this.hr(0xfff3) << 8);
  }
  /** 07:6EA1 — the next script byte. */
  private next(): number {
    const hl = this.script();
    const a = this.m.rd(hl);
    this.setScript((hl + 1) & 0xffff);
    return a;
  }
  /** 07:6EA8 — one command: bits 6-7 the kind, bits 0-5 the frames (D840). */
  private *scriptCommand(): Co {
    const m = this.m;
    const c = this.next();
    m.wr(0xd840, c & 0x3f);
    const k = (c >> 6) & 3;
    if (k === 0) return yield* this.screenEffect(c);
    if (k === 1) return yield* this.atGroups();
    if (k === 2) {
      this.blockEnd = yield* this.paths();
      return;
    }
    // 6EC2: one frame drawn at (0, 0)
    this.hw(0xfff6, 1);
    this.drawFrame(0, 0, 0xc000);
    yield* this.showFrames();
    yield* vsync(this.g);
    oamDma(m);
  }
  /** 07:6ED5 — the frame drawn at each animated group (the target's group alone unless D83C). */
  private *atGroups(): Co {
    const m = this.m;
    let b = 3, c = 0;
    if (!m.rd(0xd83c)) {
      c = m.rd(0xdf80 + this.hr(0xffb1));
      b = 1;
    }
    let hl = this.script();
    for (; b; b--, c++) {
      this.setScript(hl);
      let a = m.rd(0xd3ea + 2 * c);
      if (a) a = (a + 1) & 0xff;
      this.hw(0xfff6, a);
      const e = (((m.rd(0xd828 + c) - 2) & 0xff) << 3) & 0xff;
      const oam = 0xc000 | m.rd(0x71a9 + c);
      this.drawFrame(0x18, e, oam);
    }
    yield* this.showFrames();
  }
  /** 07:711A — a sprite frame from the script at (d, e) into the OAM buffer at hl (drawn only
   *  when FFF6 is set; the script is read either way). */
  private drawFrame(d: number, e: number, hl: number): void {
    const m = this.m;
    this.hw(0xffd0, d);
    this.hw(0xffd1, e);
    this.hw(0xffd2, hl & 0xff);
    this.hw(0xffd3, hl >> 8);
    const n = this.next();
    this.hw(0xffd4, n);
    for (let b = n; b; b--) {
      const i = this.next();
      const p = 0x7c1e + ((2 * i) & 0xff);
      const y = (this.hr(0xffd0) + m.rd(p)) & 0xff;
      const x = (this.hr(0xffd1) + m.rd(p + 1)) & 0xff;
      const t = this.next();
      const attr = (t & 0xc0) >> 1;
      if (this.hr(0xfff6)) {
        let o = this.hr(0xffd2) | (this.hr(0xffd3) << 8);
        m.wr(o++, (y + 0x10) & 0xff);
        m.wr(o++, (x + 0x08) & 0xff);
        m.wr(o++, t & 0x3f);
        m.wr(o++, attr);
        this.hw(0xffd2, o & 0xff);
        this.hw(0xffd3, o >> 8);
      }
    }
  }
  /** 07:70DC — D840 frames of the OAM buffer (07:70EB), then the buffer cleared. */
  private *showFrames(): Co {
    for (let b = this.m.rd(0xd840) || 256; b; b--) yield* this.oamFrame();
    oamClear(this.m);
  }
  /** 07:70EB — C000 rotated into C100 by C428 (+ 0x28 each frame), a frame, DMA from C100. */
  private *oamFrame(): Co {
    const m = this.m;
    const e = m.rd(0xc428);
    let a = (e + 0x28) & 0xff;
    if (a === 0xa0) a = 0;
    m.wr(0xc428, a);
    if (e === 0) copy(m, 0xc000, 0xc100, 0xa0);
    else {
      copy(m, 0xc000, 0xc100 + e, 0xa0 - e);
      copy(m, 0xc000 + 0xa0 - e, 0xc100, e);
    }
    yield* vsync(this.g);
    m.wr(0xff46, 0xc1);
  }

  // ---------------------------------------------------------------- meat (00:0D9C)

  /** 00:0D9C — member C3AC (a monster: record +0A bit 6) eats the meat of monster C3C8: the
   *  new form from 02:6FD3 (by both pictures' classes, 00:0E02) and the higher level
   *  (02:7438 low nibble), 02:72A8; the record rebuilt (00:061F). False when it cannot. */
  *eatMeatBody(): Co<boolean> {
    const m = this.m, g = this.g;
    const rec = 0xcc00 | ((m.rd(0xc3ac) * 31) & 0xff);
    const f = m.rd(rec + 0x0a);
    if (!(f & 0x40)) return false;
    this.hw(0xff8a, f & 0x0f);
    const prev = g.selectBank(0x02);
    const cls = (id: number) => {
      const i = this.pictureInfo(id);
      return (m.rd(0x0e16 + i.b) + i.c) & 0xff;
    };
    const e = cls(m.rd(0xc3c8));
    const l = cls(m.rd(rec + 5));
    const a = m.rd((mul8(0x1d, l) + e + 0x6fd3) & 0xffff);
    if (a === 0xff) {
      g.selectBank(prev);
      return false;
    }
    const b = m.rd((0x7438 + m.rd(rec + 5)) & 0xffff) & 0x0f;
    let lv = m.rd((0x7438 + m.rd(0xc3c8)) & 0xffff) & 0x0f;
    if (lv < b) lv = b;
    m.wr(0xc3c8, m.rd(((a << 4) + lv + 0x72a8) & 0xffff));
    newMember(g);
    g.selectBank(prev);
    return true;
  }

  // ---------------------------------------------------------------- polled rasters

  /** The original's polled raster code for the coming frame: f(ly) gives the value register reg
   *  takes as line ly is drawn (undefined: unchanged). */
  private raster(regs: number[], f: (ly: number) => (number | undefined)[]): void {
    const io = this.m.io;
    this.g.lineHook = (ly) => {
      const v = f(ly);
      regs.forEach((r, i) => { if (v[i] !== undefined) io[r] = v[i]!; });
      if (ly === 143) this.g.lineHook = null;
    };
  }

  // ---------------------------------------------------------------- bank 07: screen effects

  /** 07:77D1 — screen effect a (table 07:7AD5). */
  private *screenEffect(a: number): Co {
    const addr = this.m.rd(0x7ad5 + 2 * (a - 1)) | (this.m.rd(0x7ad6 + 2 * (a - 1)) << 8);
    this.cov(addr.toString(16));
    switch (addr) {
      case 0x77db: return yield* this.flashTop();
      case 0x7843: return yield* this.shakeScroll();
      case 0x786b: return yield* this.lcdFlash();
      case 0x7895: return yield* this.stripes();
      case 0x78f9: return yield* this.wave();
      case 0x7969: return yield* this.wobble();
      case 0x798f: return yield* this.ripple();
      case 0x7a0e: throw new NotPortedBattle("07:7A0E (horizontal steps)");
      case 0x7a61: {
        yield* this.flashTop();
        for (let b = 0x3c; b; b--) yield* vsync(this.g);
        return yield* this.restoreBody();
      }
    }
    throw new NotPortedBattle(`screen effect 07:${addr.toString(16)}`);
  }

  /** 07:77DB — 9800 saved to DD00, the window copy at 9C00; 3 x 15 frames with the top 64
   *  lines' BGP shifted left by 2 each round; the top map blanked (D877 = DD). */
  private *flashTop(): Co {
    const m = this.m, g = this.g;
    yield* vramCopy(g, 0x9800, 0xdd00, 0);
    const hl = yield* vramFill(g, 0x9c00, 0, 0x7f);
    yield* vramCopy16(g, 0x9900, hl, 0x140);
    let e = m.rd(0xc3a6);
    for (let b = 3; b; b--) {
      e = (e << 2) & 0xff;
      for (let d = 0x0f; d; d--) {
        yield* vsync(g);
        m.wr(0xff47, e);
        const back = m.rd(0xc3a6);
        this.raster([0x47], (ly) => [ly === 0x40 ? back : undefined]);
      }
    }
    yield* vsync(g);
    m.wr(0xff4a, 0);
    m.wr(0xff4b, 0x07);
    m.wr(0xff40, m.rd(0xff40) | 0x60);
    yield* vramFill(g, 0x9800, 0, 0x7f);
    yield* vsync(g);
    m.wr(0xff40, m.rd(0xff40) & 0xdf);
    m.wr(0xd877, 0xdd);
  }

  /** 07:786B — 4 x: in vblank (LY 91) the LCD off for 32 DIV ticks, back on, 6 frames. */
  private *lcdFlash(): Co {
    const m = this.m;
    for (let b = 4; b; b--) {
      const v = m.rd(0xff40) & 0x7f;
      m.wr(0xff40, v);
      m.wr(0xff04, v);
      m.wr(0xff40, v | 0x80);
      for (let k = 6; k; k--) yield* vsync(this.g);
    }
  }

  /** 07:7843 — the status area to the window; 2 x (8 frames SCX, 8 frames SCY) from 07:7AE7. */
  private *shakeScroll(): Co {
    const m = this.m;
    yield* this.windowCopy();
    for (let b = 2; b; b--) {
      for (const reg of [0xff43, 0xff42]) {
        for (let i = 0; i < 8; i++) {
          yield* vsync(this.g);
          m.wr(reg, m.rd(0x7ae7 + i));
        }
      }
    }
    yield* this.windowBack();
  }

  /** 07:7895 — 16 x 4 polled frames of the top 64 lines' BGP inverted every 8 lines from line
   *  d3 (0, 2, 4, 6), the start value inverted every 4 frames. */
  private *stripes(): Co {
    const m = this.m, g = this.g;
    yield* this.diOn();
    let d4 = m.rd(0xc3a6);
    this.hw(0xffd4, d4);
    let first = true;
    for (let b = 0x10; b; b--) {
      for (let d3 = 0; d3 < 8; d3 += 2) {
        this.hw(0xffd3, d3);
        this.hw(0xffd2, 1);
        if (!first) yield* waitLy90(g);
        first = false;
        const start = this.hr(0xffd4), base = m.rd(0xc3a6);
        this.raster([0x47], (ly) => {
          if (ly > 0x40) return [undefined];
          if (ly === 0x40) return [base];
          if (ly < d3 || (ly - d3) % 8) return [undefined];
          const k = ((ly - d3) >> 3) + 1;
          return [k & 1 ? (~start & 0xff) : start];
        });
        // the last toggle value and the d0 / d1 scratch as the loop leaves them
        let n = 0;
        for (let a = d3; a < 0x40; a += 8) { n++; this.hw(0xffd0, a); }
        this.hw(0xffd1, n & 1 ? (~start & 0xff) : start);
        m.wr(0xff47, base);
        this.hw(0xffd1, this.hr(0xffd4));
        frameTick(g);
      }
      d4 = (~this.hr(0xffd4)) & 0xff;
      this.hw(0xffd3, 0);
      this.hw(0xffd4, d4);
    }
    this.diOff();
  }

  /** 07:78F9 — the wave: 16 x 4 polled frames of per-line SCX (lines 0-3F) from the 07:7B60
   *  table rotated by FFD0. */
  private *wave(): Co {
    const m = this.m, g = this.g;
    this.hw(0xffd0, 0);
    this.waveTable();
    this.hw(0xffd2, 4);
    yield* this.diOn();
    let first = true;
    for (let b = 0x10; b; b--) {
      do {
        if (!first) yield* waitLy90(g);
        first = false;
        const t = Array.from({ length: 0x40 }, (_, i) => m.rd(0xd900 + i));
        this.raster([0x43], (ly) => [ly < 0x3f ? t[ly + 1] : ly === 0x3f ? 0 : undefined]);
        m.wr(0xff43, 0);
        frameTick(g);
        this.hw(0xffd2, this.hr(0xffd2) - 1);
      } while (this.hr(0xffd2));
      this.hw(0xffd2, 4);
      let a = this.hr(0xffd0) + 1;
      if (a >= 0x40) a = 0;
      this.hw(0xffd0, a);
      this.waveTable();
    }
    this.diOff();
  }
  /** 07:7946 — DA00 = 07:7B60 (64 bytes); D900 = DA00 rotated by FFD0. */
  private waveTable(): void {
    const m = this.m;
    copy(m, 0x7b60, 0xda00, 0x40);
    let l = this.hr(0xffd0);
    for (let i = 0; i < 0x40; i++) {
      m.wr(0xd900 + i, m.rd(0xda00 + l));
      l++;
      if (l >= 0x40) l = 0;
    }
  }

  /** 07:7969 — 60 polled frames: SCX for the top 64 lines from 07:7B60, 0 below. */
  private *wobble(): Co {
    const m = this.m, g = this.g;
    yield* this.diOn();
    let hl = 0x7b60;
    for (let b = 0x3c; b; b--) {
      if (b !== 0x3c) yield* waitLy90(g);
      m.wr(0xff43, m.rd(hl++));
      this.raster([0x43], (ly) => [ly === 0x40 ? 0 : undefined]);
      frameTick(g);
    }
    m.wr(0xff43, 0);
    this.diOff();
  }

  /** 07:798F — the status area to the window; 3 x (07:79A5, 3 frames). */
  private *ripple(): Co {
    yield* this.windowCopy();
    for (let b = 3; b; b--) {
      yield* this.rippleOnce();
      for (let k = 3; k; k--) yield* vsync(this.g);
    }
    yield* this.windowBack();
  }
  /** 07:79A5 — 7 steps of 4 polled frames: per-line SCY (written in each line's hblank) from
   *  D900 (07:79F7: runs of FFD1 = 07:7ACE[step]) + 07:7AC7[step]. */
  private *rippleOnce(): Co {
    const m = this.m, g = this.g;
    yield* this.diOn();
    let e = 1, d = 0, prevLast = m.rd(0xff42);
    this.hw(0xffd0, 0xff);
    const step = (): boolean => {
      e--;
      if (e) return true;
      e = 4;
      const a = (this.hr(0xffd0) + 1) & 0xff;
      if (a >= 7) return false;
      this.hw(0xffd0, a);
      this.hw(0xffd1, m.rd(0x7ace + a));
      this.rippleFill();
      d = m.rd(0x7ac7 + a);
      return true;
    };
    if (!step()) { m.wr(0xff42, 0); return this.diOff(); }
    for (let first = true; ; first = false) {
      if (!first) yield* waitLy90(g);
      const t = Array.from({ length: 0x40 }, (_, i) => m.rd(0xd900 + i));
      const p = prevLast, dd = d;
      prevLast = (t[0x3f]! + dd) & 0xff;
      frameTick(g);
      const more = step();
      const exit = !more;
      this.raster([0x42], (ly) => {
        if (ly === 0) return [p];
        if (ly <= 0x40) return [(t[ly - 1]! + dd) & 0xff];
        if (exit && ly === 0x41) return [0];
        return [undefined];
      });
      if (exit) {
        m.wr(0xff42, 0);
        return this.diOff();
      }
      m.wr(0xff42, prevLast);
    }
  }
  /** 07:79F7 — D900 (64 entries): 0 x FFD1, 1 x FFD1, ... */
  private rippleFill(): void {
    const m = this.m;
    const e = this.hr(0xffd1);
    let a = 0, hl = 0xd900;
    for (let c = 0x40; ; ) {
      let b = e || 256;
      let done = false;
      while (b) {
        m.wr(hl++, a);
        c--;
        if (!c) { done = true; break; }
        b--;
      }
      if (done) break;
      a++;
    }
  }

  // ---------------------------------------------------------------- bank 07: moving sprites

  /** 07:6F1E — the rest of the block's commands as sprite paths started one per frame (D83D of
   *  them, cycling), each stepping through the commands (D871 frames each) at random points of
   *  the target groups (07:7004); ends with the block (add sp, 2; jp 6E70). Returns the script
   *  position after the block. */
  private *paths(): Co<number> {
    const m = this.m;
    this.cov("6f1e");
    let hl = (this.script() - 1) & 0xffff;
    let de = 0xd861, bc = 0xd871;
    const n = m.rd(0xd83e);
    this.hw(0xffd0, n);
    for (let k = n; k; k--) {
      m.wr(bc++, m.rd(hl++) & 0x3f);
      m.wr(de++, hl & 0xff);
      m.wr(de++, hl >> 8);
      const cnt = m.rd(hl++) || 256;
      hl = (hl + 2 * cnt) & 0xffff;
      this.hw(0xffd0, this.hr(0xffd0) - 1);
    }
    this.hw(0xfff0, hl & 0xff);
    this.hw(0xfff1, hl >> 8);
    m.wr(0xd876, m.rd(0xd83d));
    for (let i = 0; i < 4; i++) m.wr(0xd869 + i, 0);
    m.wr(0xd875, 0);
    for (let i = 0; i < 4; i++) m.wr(0xd86d + i, 0xff);
    for (;;) {
      oamClear(m);
      if (m.rd(0xd83d) && m.rd(0xd876)) {
        const c = m.rd(0xd875);
        if (m.rd(0xd86d + c) === 0xff) {
          m.wr(0xd86d + c, 0);
          this.pathStart(c);
          this.pathTimer(c, 0);
          m.wr(0xd876, m.rd(0xd876) - 1);
        }
      }
      this.drawPaths();
      yield* this.oamFrame();
      const e = m.rd(0xd83e);
      for (let c = 0; c < e; c++) {
        const t = m.rd(0xd869 + c);
        if (!t) continue;
        m.wr(0xd869 + c, t - 1);
        if (((t - 1) & 0xff) !== 0) continue;
        const f = (m.rd(0xd86d + c) + 1) & 0xff;
        m.wr(0xd86d + c, f);
        if (f === e) {
          // 6FAD: finished; while D83D lasts the slot restarts, its timer from D871 + D83D
          m.wr(0xd86d + c, 0xff);
          const old = m.rd(0xd83d);
          if (!old) continue;
          m.wr(0xd83d, old - 1);
          this.pathTimer(c, old);
        } else this.pathTimer(c, f);
        let a = m.rd(0xd875) + 1;
        if (a === e) a = 0;
        m.wr(0xd875, a);
      }
      let any = 0;
      for (let i = 0; i < m.rd(0xd83e); i++) any |= m.rd(0xd869 + i);
      if (any || m.rd(0xd83d)) continue;
      break;
    }
    oamClear(m);
    yield* vsync(this.g);
    oamDma(m);
    return this.hr(0xfff0) | (this.hr(0xfff1) << 8);
  }
  /** 07:6FEF — slot c's timer = the frames of command a (D871 + a). */
  private pathTimer(c: number, a: number): void {
    this.m.wr(0xd869 + c, this.m.rd((0xd871 + a) & 0xffff));
  }
  /** 07:7004 — slot c's random points in each animated group (x: D841 + 4c, y: D851 + 4c). */
  private pathStart(c: number): void {
    this.points(c, 0xd80d, 0xd841);
    this.points(c, 0xd810, 0xd851);
  }
  /** 07:701D / 7054 */
  private points(c: number, src: number, dst: number): void {
    const m = this.m;
    let de = dst + 4 * c;
    let b = 3, k = 0;
    if (!m.rd(0xd83c)) {
      k = m.rd(0xdf80 + this.hr(0xffb1));
      b = 1;
    }
    for (; b; b--, k++) {
      const a = m.rd(0xd3ea + 2 * k);
      if (a === 0 || a === 0xff) continue;
      const e = (m.rd(src + k) - 2) & 0xff;
      const d = m.rd(src + k + 6);
      const v = ((rand(m, 0x7062, 0, e) + d) << 3) & 0xff;
      m.wr(de++, v);
    }
  }
  /** 07:7069 — every active slot's current frame at its points, per animated group. */
  private drawPaths(): void {
    const m = this.m;
    this.hw(0xfff5, 0);
    this.hw(0xffdc, 0x00);
    this.hw(0xffdd, 0xc0);
    this.hw(0xffd2, 0x00);
    this.hw(0xffd3, 0xc0);
    for (let b = m.rd(0xd83b); b; b--) {
      this.hw(0xfff4, 0);
      for (let s = m.rd(0xd83e); s; s--) {
        const slot = this.hr(0xfff4);
        const f = m.rd(0xd86d + slot);
        if (f !== 0xff) {
          const p = (0xd861 + ((2 * f) & 0xff)) & 0xffff;
          this.setScript(m.rd(p) | (m.rd(p + 1) << 8));
          const o = (this.hr(0xfff4) * 4 + this.hr(0xfff5)) & 0xff;
          const e = m.rd(0xd841 + o), d = m.rd(0xd851 + o);
          this.hw(0xfff6, 1);
          this.drawFrame(d, e, this.hr(0xffd2) | (this.hr(0xffd3) << 8));
        }
        this.hw(0xfff4, this.hr(0xfff4) + 1);
      }
      const p = ((this.hr(0xffdc) | (this.hr(0xffdd) << 8)) + 0x34) & 0xffff;
      this.hw(0xffdc, p & 0xff);
      this.hw(0xffdd, p >> 8);
      this.hw(0xfff5, this.hr(0xfff5) + 1);
    }
  }

}

/** 06:6290 — the restart after a defeat (jp 00:0101). */
export class GameOver extends Error {
  constructor() { super("game over"); }
}
