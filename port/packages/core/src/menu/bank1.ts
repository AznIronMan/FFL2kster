/** Bank-1 screens (01:5000-6FCD): title, new game, party creation, save slots, formation, inn,
 *  shop and the main menu, plus their shared screen helpers. Entry points as the original's
 *  jump table 01:5000. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { vsync, frameDma, joyFrame, waitRelease, fill, copy, copyBank, memberAddr, partySlot, varGet } from "../sys.js";
import { frameTick } from "../irq.js";
import type { TextEngine } from "../text/engine.js";
import { vramBegin, vramEnd } from "../field/sprites.js";
import { MenuEngine, beep, confirm, itemPos, setCursor } from "./engine.js";

/** Calls from bank 1 to the rest of the game. */
export interface Bank1Calls {
  /** 00:1912 — remember the field position (before saving). */
  saveFieldPosition(g: Game): void;
}

export class Bank1 {
  readonly menu: MenuEngine;
  constructor(readonly g: Game, readonly text: TextEngine, readonly calls: Bank1Calls) {
    this.menu = new MenuEngine(g, { redraw: () => text.blitWindow() });
  }

  get m(): Memory {
    return this.g.m;
  }

  // ------------------------------------------------------------ shared helpers

  /** rst $18 with page CC after a frame (the "rst $10; ld a,$cc; rst $18" idiom). */
  *frameCC(): Co {
    yield* vsync(this.g);
    this.m.wr(0xff46, 0xcc);
  }

  /** 00:009C — fill VRAM inside an access window. */
  private *vramFill(hl: number, n: number, v: number): Co {
    yield* vramBegin(this.g);
    fill(this.m, hl, n, v);
    yield* vramEnd(this.g);
  }

  /** 00:00CA — copy n bytes from ROM bank b to VRAM inside an access window. */
  *vramFromRom(bank: number, hl: number, de: number, n: number): Co {
    const prev = this.m.selectBank(bank);
    yield* vramBegin(this.g);
    copyBank(this.m, bank, hl, de, n);
    yield* vramEnd(this.g);
    this.m.selectBank(prev);
  }

  /** 00:00AC — VRAM/RAM copy inside an access window. */
  private *vramCopy(hl: number, de: number, n: number): Co {
    yield* vramBegin(this.g);
    copy(this.m, hl, de, n);
    yield* vramEnd(this.g);
  }

  /** 01:5E43 — clear the portrait entries and the CC sprite page; C796 = C7DA = 0. */
  clearSprites(): void {
    const m = this.m;
    fill(m, 0xc7a6, 0x20, 0);
    fill(m, 0xcc00, 0xa0, 0);
    m.wr(0xc796, 0);
    m.wr(0xc7da, 0);
  }

  /** 01:5E40 — cursors off (00:0546), then 5E43. */
  resetSprites(): void {
    fill(this.m, 0xff97, 4, 0xff);
    this.clearSprites();
  }

  /** 00:0533 / 00:0536 — menu item list cleared (FF9B = 0 for 0533). */
  clearMenu(resetCursor = true): void {
    const m = this.m;
    if (resetCursor) m.hram[0x1b] = 0;
    m.wr(0xc7ca, 0);
    m.wr(0xc7cf, 0);
    fill(m, 0xc380, 0x80, 0xff);
  }

  /** 01:5E25 */
  reset5E25(): void {
    this.resetSprites();
    this.clearMenu(true);
  }

  /** 01:5E2B */
  reset5E2B(): void {
    this.resetSprites();
    this.clearMenu(false);
  }

  /** 01:5E35 — also the scroll offsets C797/C798. */
  reset5E35(): void {
    this.resetSprites();
    this.m.wr(0xc797, 0);
    this.m.wr(0xc798, 0);
    this.clearMenu(true);
  }

  /** 01:5E31 */
  reset5E31(): void {
    this.m.wr(0xc798, 0);
    this.reset5E35();
  }

  /** 01:5F0E — frame, then palettes D2 D2 81 (also kept in C700-C702). */
  *palettes(): Co {
    const m = this.m;
    yield* vsync(this.g);
    m.wr(0xff47, 0xd2); m.wr(0xc700, 0xd2);
    m.wr(0xff48, 0xd2); m.wr(0xc701, 0xd2);
    m.wr(0xff49, 0x81); m.wr(0xc702, 0x81);
  }

  /** 01:5F22 — frame, palettes 0. */
  *black(): Co {
    yield* vsync(this.g);
    this.m.wr(0xff47, 0);
    this.m.wr(0xff48, 0);
    this.m.wr(0xff49, 0);
  }

  /** 01:5F44 — frame, window on at the top-left (WY 0, WX 7, LCDC E3). */
  *windowOn(): Co {
    yield* vsync(this.g);
    this.m.wr(0xff4a, 0);
    this.m.wr(0xff4b, 7);
    this.m.wr(0xff40, 0xe3);
  }

  /** 01:5F2B — fill the window map rows with tile 0x75 (18 rows of 20). */
  *blankWindow(): Co {
    const m = this.m;
    yield* vramBegin(this.g);
    for (let r = 0, hl = 0x9c00; r < 0x12; r++, hl += 0x20) fill(m, hl, 0x14, 0x75);
    yield* vramEnd(this.g);
  }

  /** 01:5DF8 — full-screen menu: sprites off, black, cleared, window on, FF96 = 3. */
  *screenNew(): Co {
    const m = this.m;
    m.hram[0x16] = 0;
    yield* this.black();
    this.reset5E31();
    yield* this.frameCC();
    yield* this.windowOn();
    m.hram[0x16] = 3;
  }

  /** 01:5E0D — like 5DF8 with a blank window and normal palettes. */
  *screenMenu(): Co {
    const m = this.m;
    m.hram[0x16] = 0;
    this.reset5E31();
    yield* this.frameCC();
    yield* this.blankWindow();
    yield* this.windowOn();
    yield* this.palettes();
    m.hram[0x16] = 3;
  }

  /** 01:5E77 — before a menu over the field: save BG tiles 9600-97BF to 9E40 and 97C0-97FF
   *  into the unused columns of the window map (9C14, 8 rows of 8); then (in battle only this)
   *  load the UI tiles 04:4700 → 9700. */
  *saveFieldTiles(): Co {
    const m = this.m;
    if (!m.hram[0x0b]) {
      yield* this.vramCopy(0x9600, 0x9e40, 0x1c0);
      yield* vramBegin(this.g);
      for (let r = 0; r < 8; r++) copy(m, 0x97c0 + 8 * r, 0x9c14 + 0x20 * r, 8);
      yield* vramEnd(this.g);
    }
    yield* this.vramFromRom(0x04, 0x4700, 0x9700, 0x100);
  }

  /** 01:5EDC — restore what 5E77 saved. */
  private *restoreFieldTiles(): Co {
    const m = this.m;
    yield* this.vramCopy(0x9e40, 0x9600, 0x1c0);
    yield* vramBegin(this.g);
    for (let r = 0; r < 8; r++) copy(m, 0x9c14 + 0x20 * r, 0x97c0 + 8 * r, 8);
    yield* vramEnd(this.g);
  }

  /** 01:5EB1 (after a button release) / 01:5EB4 — back to the field: palettes 0, tiles
   *  restored, sprites cleared, window off, palettes from C700-C702. */
  *backToField(waitRelease_ = true): Co {
    const m = this.m;
    if (waitRelease_) yield* waitRelease(this.g);
    yield* vsync(this.g);
    m.wr(0xff46, 0xc0);
    m.wr(0xff47, 0);
    m.wr(0xff48, 0);
    m.wr(0xff49, 0);
    yield* this.restoreFieldTiles();
    m.hram[0x16] = 0;
    this.reset5E35();
    yield* vsync(this.g);
    m.wr(0xff40, m.rd(0xff40) & 0xdf);
    m.wr(0xff47, m.rd(0xc700));
    m.wr(0xff48, m.rd(0xc701));
    m.wr(0xff49, m.rd(0xc702));
  }

  /** 01:5271 / 01:527C / 01:5287 — saved cursor/scroll of menu a (C340 + 2a). */
  loadCursor(a: number): void {
    const m = this.m, hl = 0xc340 + 2 * a;
    m.hram[0x1b] = m.rd(hl);
    m.wr(0xc798, m.rd(hl + 1));
  }
  storeCursor(a: number): void {
    const m = this.m, hl = 0xc340 + 2 * a;
    m.wr(hl, m.hram[0x1b]!);
    m.wr(hl + 1, m.rd(0xc798));
  }
  clearCursor(a: number): void {
    const m = this.m, hl = 0xc340 + 2 * a;
    m.wr(hl, 0);
    m.wr(hl + 1, 0);
  }

  /** 00:18C3 — the menu engine with C7CD = 2 * C79A | a; result FF8C. */
  *runMenu(a: number): Co<number> {
    const m = this.m;
    m.wr(0xc7cd, ((m.rd(0xc79a) * 2) | a) & 0xff);
    const prev = m.selectBank(0x01);
    yield* this.menu.run();
    m.selectBank(prev);
    return m.hram[0x0c]!;
  }

  // ------------------------------------------------------------ save data

  /** 01:6807 — battery RAM address of slot a (A000 + 0x180 a); enables the RAM. */
  private slotAddr(a: number): number {
    this.m.wr(0x0000, 0x0a);
    return 0xa000 + ((a * 16) & 0xff) * 0x18;
  }

  /** 01:6820 — 16-bit sum of C200-C37D. */
  private checksum(): number {
    let s = 0;
    for (let i = 0; i < 0x17e; i++) s = (s + this.m.rd(0xc200 + i)) & 0xffff;
    return s;
  }

  /** 01:675F — load slot a into C200-C37F; true when its magic (1B E4 at C37C) and checksum
   *  (C37E) are valid, else the party is reset (01:678D). */
  loadSlot(a: number): boolean {
    const m = this.m;
    const src = this.slotAddr(a);
    copy(m, src, 0xc200, 0x180);
    m.wr(0x0000, 0);
    if (m.rd(0xc37c) === 0x1b && m.rd(0xc37d) === 0xe4) {
      const sum = m.rd(0xc37e) | (m.rd(0xc37f) << 8);
      if (sum === this.checksum()) return true;
    }
    this.newParty();
    return false;
  }

  /** 01:67BC — save the game to slot a. */
  saveSlot(a: number): void {
    const m = this.m;
    this.calls.saveFieldPosition(this.g);
    m.wr(0x0000, 0x0a);
    let n = m.rd(0xa780);
    m.wr(0xc31c, n);
    n = (n + 1) & 0xff;
    m.wr(0xa780, n < 0x64 ? n : 1);
    m.wr(0xa781, 0x1b);
    m.wr(0xa782, 0xe4);
    m.wr(0x0000, 0);
    m.wr(0xc31a, m.hram[0x30]!);
    m.wr(0xc37c, 0x1b);
    m.wr(0xc37d, 0xe4);
    const sum = this.checksum();
    m.wr(0xc37e, sum & 0xff);
    m.wr(0xc37f, sum >> 8);
    const dst = this.slotAddr(a);
    copy(m, 0xc200, dst, 0x180);
    m.wr(0x0000, 0);
  }

  /** 01:6A21 — battery RAM has been written by the game (A781/A782 = 1B E4). */
  hasSaves(): boolean {
    const m = this.m;
    m.wr(0x0000, 0x0a);
    const ok = m.rd(0xa781) === 0x1b && m.rd(0xa782) === 0xe4;
    m.wr(0x0000, 0);
    return ok;
  }

  /** 01:678D — empty party: C200-C37B cleared, bag FF, message speed 6, formation E4, names FF. */
  newParty(): void {
    const m = this.m;
    fill(m, 0xc200, 0x17c, 0);
    fill(m, 0xc2b9, 0x20, 0xff);
    m.wr(0xc31b, 6);
    m.wr(0xc2a0, 0xe4);
    for (let k = 0, hl = 0xc200; k < 5; k++, hl += 0x20) fill(m, hl, 4, 0xff);
  }

  /** 01:668C — choose a save slot (three summaries, up/down, A/B); FF8C = slot or FF. */
  *chooseSlot(): Co {
    const m = this.m;
    m.wr(0x0000, 0x0a);
    copy(m, 0xc200, 0xa600, 0x180);
    m.wr(0x0000, 0);
    m.hram[0x16] = 0;
    this.reset5E35();
    for (let a = 0; a < 3; a = m.rd(0xc70e) + 1) yield* this.slotSummary(a);
    this.reset5E35();
    m.hram[0x16] = 3;
    yield* this.frameCC();
    yield* this.palettes();
    for (;;) {
      const i = m.hram[0x1b]!;
      setCursor(m, m.rd(0x6832 + 2 * i), m.rd(0x6833 + 2 * i));
      yield* this.slotSummary(i);
      for (;;) {
        const a = yield* joyFrame(this.g);
        if (a & 0x80) { m.hram[0x1b] = (i + 1) % 3; break; }
        if (a & 0x40) { m.hram[0x1b] = (i ? i : 3) - 1; break; }
        if (a & 0x02) { this.restoreParty(); m.hram[0x0c] = 0xff; return; }
        if (a & 0x01) { this.restoreParty(); m.hram[0x0c] = i; confirm(m); return; }
      }
    }
  }

  /** 01:674D */
  private restoreParty(): void {
    const m = this.m;
    m.wr(0x0000, 0x0a);
    copy(m, 0xa600, 0xc200, 0x180);
    m.wr(0x0000, 0);
  }

  /** 01:6711 — draw slot a's summary (message 0x16 + a) or an empty frame. */
  private *slotSummary(a: number): Co {
    const m = this.m;
    this.clearSprites();
    m.wr(0xc70e, a);
    if (this.loadSlot(a)) {
      m.wr(0xc70d, m.rd(0xc31c));
      yield* this.text.message((0x16 + a) & 0xff);
      return;
    }
    this.text.drawFrame(0x14, 0x06);
    const de = 0x9c00 + ((a * 0xc0) & 0xffff);
    m.wr(0xc7a5, 0);
    yield* this.text.blit(de, 0x14, 0x06);
  }

  // ------------------------------------------------------------ title and new game

  /** 01:500F (01:6838) — title screen; returns true to continue a saved game (then the field
   *  starts at 00:1903), false for a new game (00:1900). */
  *title(): Co<boolean> {
    const m = this.m, g = this.g;
    m.hram[0x30] = 0x05;
    yield* this.vramFromRom(0x04, 0x5000, 0x9000, 0x800);
    for (;;) {
      yield* this.vramFill(0x9800, 0x800, 0xff);
      // logo (0F:77C0, 8 rows of 16) at 9842
      yield* vramBegin(g);
      for (let r = 0; r < 8; r++) copyBank(m, 0x0f, 0x77c0 + 16 * r, 0x9842 + 0x20 * r, 0x10);
      yield* vramEnd(g);
      this.reset5E35();
      yield* this.text.message(0x14, 3);
      const de = (0x9800 + m.rd(0xc79c) * 32 + m.rd(0xc79b)) & 0xffff;
      yield* this.text.copyRect(0xc800, de, m.rd(0xc79d), m.rd(0xc79e));
      yield* this.frameCC();
      m.wr(0xff40, 0xc3);
      yield* this.palettes();
      m.hram[0x1b] = this.hasSaves() ? 1 : 0;
      m.hram[0x16] = 2;
      let choice: number;
      for (;;) {
        choice = yield* this.runMenu(0);
        if (choice !== 0xff) break;
        if ((m.hram[0x09]! & 0x0c) === 0x0c) {
          yield* this.soundTest();
        }
      }
      if (choice !== 0) {
        if (this.hasSaves()) {
          yield* this.chooseSlot();
          const slot = m.hram[0x0c]!;
          if (slot === 0xff) continue;
          if (this.loadSlot(slot)) {
            yield* this.leaveTitle();
            m.hram[0x30] = m.rd(0xc31a);
            return true;
          }
        }
      }
      // new game (01:68C1)
      yield* this.black();
      yield* vsync(g);
      m.wr(0xff40, 0xc3);
      m.hram[0x16] = 0;
      this.reset5E25();
      yield* this.frameCC();
      yield* this.text.script(0x0070);
      m.wr(0xff43, 0);
      m.wr(0xff42, 0x99);
      yield* this.text.copyRect(0xc800, 0x9800, 0x14, 0x20);
      yield* this.intro();
      this.newParty();
      yield* this.vramFill(0x9800, 0x800, 0xff);
      yield* this.palettes();
      m.wr(0xff42, 0);
      m.wr(0xc709, 0);
      let back = false;
      for (;;) {
        if (!(yield* this.chooseClass())) { back = true; break; }
        if (yield* this.enterName()) break;
      }
      if (back) continue;
      yield* this.leaveTitle();
      return false;
    }
  }

  /** 01:68E9-695A — the intro text scrolls up one line every 10 frames (every frame while A is
   *  held) between palette bands at lines 0x24-0x6C, polled with interrupts off. */
  private *intro(): Co {
    const m = this.m, g = this.g;
    m.hram[0x10] = 0x0a;
    yield* vsync(g);
    g.ime = false;
    g.lineHook = (ly) => {
      const v = ly >= 0x6c ? 0 : ly >= 0x68 ? 0x40 : ly >= 0x64 ? 0x81 : ly >= 0x2c ? 0xd2 : ly >= 0x28 ? 0x81 : ly >= 0x24 ? 0x40 : -1;
      if (v >= 0) m.io[0x47] = v;
    };
    try {
      for (;;) {
        frameTick(g);
        if (m.hram[0x09]! & 1) m.hram[0x10] = 1;
        const n: number = (m.hram[0x10]! - 1) & 0xff;
        m.hram[0x10] = n;
        if (!n) {
          m.hram[0x10] = 0x0a;
          if (m.rd(0xff42) === 0x74) break;
          m.wr(0xff42, m.rd(0xff42) + 1);
        }
        yield;
      }
    } finally {
      g.lineHook = null;
      g.ime = true;
    }
  }

  /** 01:6A39 — leave the title: sprites off, UI tiles restored (04:4700 → 9700). */
  private *leaveTitle(): Co {
    this.reset5E25();
    this.m.hram[0x16] = 0;
    yield* this.frameCC();
    yield* this.vramFromRom(0x04, 0x4700, 0x9700, 0x100);
  }

  /** 01:699C — sound test (Select + Start on the title menu): music/effect numbers C70D/C70E,
   *  A plays them; it never returns (reset to leave). */
  private *soundTest(): Co {
    const m = this.m;
    for (;;) {
      yield* this.text.message(0x4c, 3);
      const de = (0x9800 + m.rd(0xc79c) * 32 + m.rd(0xc79b)) & 0xffff;
      yield* this.text.copyRect(0xc800, de, m.rd(0xc79d), m.rd(0xc79e));
      for (let redraw = false; !redraw; ) {
        const [b, c] = itemPos(m);
        setCursor(m, b, c);
        const a = yield* joyFrame(this.g);
        const i = m.hram[0x1b]!;
        if (a & 0xc0) m.hram[0x1b] = i ^ 1;
        else if (a & 0x30) {
          const max = i ? 0x13 : 0x39;
          const hl = 0xc70d + i;
          let v = m.rd(hl);
          if (a & 0x20) v = v + 1 < max ? v + 1 : 0;
          else v = v ? v - 1 : max;
          m.wr(hl, v);
          redraw = true;
        } else if (a & 0x01) {
          m.hram[0x32] = m.rd(0xc70d);
          m.hram[0x30] = m.rd(0xc70e);
        }
      }
    }
  }

  /** 01:611C — choose the class of member C709 (message 0x15); false when cancelled. */
  *chooseClass(): Co<boolean> {
    const m = this.m;
    yield* this.screenNew();
    fill(m, memberAddr(m, m.rd(0xc709), 0xc20f), 0x10, 0xff);
    for (let i = 0; i < 8; i++) m.wr(0xc73d + i, 0xf0 + i);
    yield* this.text.message(0x15);
    yield* this.palettes();
    const a = yield* this.runMenu(0);
    if (a === 0xff) return false;
    confirm(m);
    this.text.initMember(m.rd(0xc73d + a));
    return true;
  }

  /** 01:5006 (01:60E8) — choose the three companions (members 1-3): class and name each;
   *  cancelling a class goes back to the previous member's name. */
  *companions(): Co {
    const m = this.m;
    yield* this.black();
    yield* this.saveFieldTiles();
    let a = 1;
    m.wr(0xc709, a);
    for (;;) {
      if (!(yield* this.chooseClass())) {
        const c = m.rd(0xc709);
        if (c < 2) continue;
        m.wr(0xc709, c - 1);
      }
      if (!(yield* this.enterName())) continue;
      a = m.rd(0xc709) + 1;
      if (a >= 4) break;
      m.wr(0xc709, a);
    }
    m.wr(0xc700, 0);
    m.wr(0xc701, 0);
    m.wr(0xc702, 0);
    yield* this.backToField(false);
  }

  /** 01:6157 — name entry for member C709 (4 characters; grid menu 01:518F). True when done,
   *  false when cancelled with B at the first position (the old name is restored). */
  *enterName(): Co<boolean> {
    const m = this.m;
    const name = memberAddr(m, m.rd(0xc709), 0xc200);
    copy(m, name, 0xc7ee, 4);
    yield* this.screenNew();
    yield* this.text.message(0x2c);
    yield* this.text.message(0x2d, 2);
    fill(m, 0xd400, 0x100, 0);
    m.wr(0xc7d6, 0);
    fill(m, 0xd500, 0x170, 0xff);
    yield* this.vramFill(0x8080, 0x40, 0);
    yield* this.vramCopy(0x627a, 0x80a0, 0x10);
    m.wr(0xc7aa, 0xa1);
    m.wr(0xc7ab, 0);
    m.wr(0xc7ac, 0x08);
    m.wr(0xc7ad, 0x68);
    yield* this.text.message(0x00);
    m.wr(0xc7d6, 0);
    yield* this.palettes();
    for (;;) {
      const pos = m.rd(0xc7d6);
      if (pos < 4) {
        m.wr(0xc7aa, m.rd(0xc7aa) | 0x80);
        m.wr(0xc7ad, ((pos + 0x0d) * 8) & 0xff);
      } else m.wr(0xc7aa, m.rd(0xc7aa) & 0x7f);
      const a = yield* this.gridMenu();
      if (a === 0xfe) {
        if (yield* this.nameDone(name)) return true;
        continue;
      }
      if (a === 0xfd) {
        if (pos === 4) {
          if (yield* this.nameDone(name)) return true;
          continue;
        }
        m.wr(0xc7d6, pos + 1);
        continue;
      }
      if (a === 0xff) {
        if (pos) {
          m.wr(0xc7d6, pos - 1);
          continue;
        }
        copy(m, 0xc7ee, name, 4);
        return false;
      }
      const ch = m.rd(0xd400 + a);
      if (pos === 4) {
        if (yield* this.nameDone(name)) return true;
        continue;
      }
      m.wr(0xc7d6, pos + 1);
      m.wr(memberAddr(m, m.rd(0xc709), 0xc200 + pos), ch);
      // redraw the name line (message 0x2D) keeping the text state (D670 / D674)
      for (let i = 0; i < 4; i++) m.wr(0xd670 + i, m.hram[0x20 + i]!);
      copy(m, 0xc779, 0xd674, 0x8c);
      m.wr(0xc797, 0);
      m.wr(0xc798, 0);
      yield* this.text.message(0x2d, 2);
      for (let i = 0; i < 4; i++) m.hram[0x20 + i] = m.rd(0xd670 + i);
      copy(m, 0xd674, 0xc779, 0x8c);
    }
  }

  /** 01:625E — a name must not be all blanks. */
  private *nameDone(name: number): Co<boolean> {
    const m = this.m;
    if ((m.rd(name) & m.rd(name + 1) & m.rd(name + 2) & m.rd(name + 3)) !== 0xff) return true;
    beep(m);
    return false;
  }

  /** 01:518F — grid menu over D500 (scrolling both ways): returns the item, FE (Start),
   *  FD (Select) or FF (B). */
  private *gridMenu(): Co<number> {
    const m = this.m;
    m.wr(0xc7cd, 6);
    let hl = 0xd500;
    while (m.rd(hl++) !== 0xff);
    hl -= 2;
    m.wr(0xc7cc, m.rd(hl));
    m.wr(0xc7cb, m.rd(hl - 1));
    yield* this.gridPlace();
    for (;;) {
      const a = yield* joyFrame(this.g);
      let moved: boolean | null = null;
      if (a & 0x80) moved = this.gridMove(0);
      else if (a & 0x40) moved = this.gridMove(1);
      else if (a & 0x20) moved = this.gridMove(2);
      else if (a & 0x10) moved = this.gridMove(3);
      else if (a & 0x08) { confirm(m); m.hram[0x0c] = 0xfe; return 0xfe; }
      else if (a & 0x04) { confirm(m); m.hram[0x0c] = 0xfd; return 0xfd; }
      else if (a & 0x02) { m.hram[0x0c] = 0xff; return 0xff; }
      else if (a & 0x01) { confirm(m); const v = m.hram[0x1b]!; m.hram[0x0c] = v; return v; }
      if (moved === null) continue;
      if (moved) yield* this.gridPlace();
      else beep(m);
    }
  }

  /** 01:5327 / 53B1 / 53F4 / 536A in the grid: move; true when an item was found. */
  private gridMove(dir: number): boolean {
    const m = this.m;
    const [b, c] = itemPos(m);
    const L = 0xd500;
    let best = -1, bestKey = dir === 0 || dir === 3 ? 0xff : 0;
    for (let i = 0, hl = L; m.rd(hl) !== 0xff; i++, hl += 2) {
      const r = m.rd(hl), col = m.rd(hl + 1);
      if (dir < 2) {
        if (col !== c) continue;
        if (dir === 0 ? b < r && !(bestKey < r) : r < b && !(r < bestKey)) { bestKey = r; best = i; }
      } else {
        if (r !== b) continue;
        if (dir === 3 ? c < col && !(bestKey < col) : col < c && !(col < bestKey)) { bestKey = col; best = i; }
      }
    }
    if (best < 0) return false;
    m.hram[0x1b] = best;
    return true;
  }

  /** 01:51F8 — show the grid cursor, scrolling rows (5305) and columns (5242) as needed. */
  private *gridPlace(): Co {
    const m = this.m;
    let [b, c] = itemPos(m);
    let redraw = false;
    // rows: 01:52DC with C7CD bit 1 set and C7CF = 0
    {
      const rb = (b - m.rd(0xc798)) & 0xff, rc = (c - m.rd(0xc797)) & 0xff;
      b = rb; c = rc;
      const bottom = (m.rd(0xc7a0) - 1) & 0xff, top = (m.rd(0xc7d1) + 2) & 0xff;
      if (bottom < b || (top !== b && !(top < b))) {
        const d = m.rd(0xc798);
        if (top < b) { m.wr(0xc798, (b - bottom + d) & 0xff); b = bottom; }
        else { m.wr(0xc798, (d - (top - b)) & 0xff); b = top; }
        redraw = true;
      }
    }
    // columns: 01:5227 / 01:5242
    {
      const right = (m.rd(0xc79f) - 2) & 0xff, left = m.rd(0xc7d0);
      if (c & 0x80 || !(c < right) || c < left) {
        const d = m.rd(0xc797);
        if (c & 0x80) { m.wr(0xc797, (d + c) & 0xff); c = 0; }
        else if (c < left) { m.wr(0xc797, (d - (left - c)) & 0xff); c = left; }
        else { const e = (m.rd(0xc79f) - 3) & 0xff; m.wr(0xc797, (c - e + d) & 0xff); c = e; }
        redraw = true;
      }
    }
    if (redraw) yield* this.text.blitWindow();
    setCursor(m, b, c);
  }
}
