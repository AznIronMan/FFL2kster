/** Legend I main menu (Start, 00:269D): member abilities/items (00:271E), the bag (00:2799),
 *  equipment (00:28F5), save (00:26FE); the party order (Select, 00:3BAD). */
import type { Game, Co } from "../game.js";
import { vsync, oamDma, joyRepeat, copy, vramCopy } from "../sys.js";
import { classTiles } from "../title.js";
import { writeSave } from "../save.js";
import { Menus } from "./menu.js";
import type { FieldEngine } from "./loop.js";
import { palettesOff, palettesOn, loadSpriteSet, loadPlayerTiles, loadTileset, loadAttributes, objectTable, objectSprites,
  windowOff, windowTop, playerSprites, nibble, setNibble, placeObjects } from "./load.js";
import { drawLayout } from "./map.js";
import { LeaveMenu } from "./items.js";

export interface MainMenuCalls {
  /** 00:36E1 — use item/ability a (slot address hl) in the field (0 = used, FF = not). */
  useItem(g: Game, a: number, slot: number): Co<number>;
  /** 00:35A8 — equip the selected item (C5CD/C5CE). */
  equip(g: Game): void;
  quake(g: Game): Co;
  shake(g: Game): Co;
}

export class MainMenu extends Menus {
  constructor(g: Game, text: import("../text.js").TextEngine, readonly field: FieldEngine, readonly calls: MainMenuCalls) {
    super(g, text);
  }

  /** 00:269D — Start. An item that starts an event or a warp leaves through 00:3B4E. */
  *open(): Co {
    yield* this.clearWindow();
    windowTop(this.m);
    yield* this.menuTiles();
    yield* this.hideSprites();
    try {
      yield* this.main();
    } catch (e) {
      if (!(e instanceof LeaveMenu)) throw e;
      yield* this.leave(e.slot);
    }
  }

  /** 00:3B4E — one use of the item in slot hl is spent (FE+ unlimited; items below 80 vanish
   *  at 0), the stack is reset to the field loop and the menu closed (00:26CE). */
  *leave(slot: number): Co {
    const m = this.m;
    const u = (slot & ~0xff) | ((slot + 1) & 0xff);
    const v = m.rd(u);
    if (v < 0xfe) {
      m.wr(u, v - 1);
      if (v - 1 === 0 && m.rd(slot) < 0x80) m.wr(u, 0xff);
    }
    yield* this.close();
  }

  /** 00:26A9 — the main menu loop; returns (to the field) via 00:26CE. */
  private *main(): Co {
    const m = this.m;
    for (;;) {
      yield* this.clearWindow();
      windowTop(m);
      yield* this.hideSprites();
      yield* this.summary();
      yield* this.hideSprites(0xc070, 4);
      const a = yield* this.menu(0x3f12, 0);
      if (a === 0) yield* this.abilities();
      else if (a === 1) yield* this.bag();
      else if (a === 2) yield* this.equipment();
      else if (a === 3) yield* this.save();
      else return yield* this.close();
    }
  }

  /** 00:26CE — back to the field: tiles, sprites and the map buffer reloaded. */
  *close(): Co {
    const g = this.g, m = this.m;
    palettesOff(m);
    yield* this.hideSprites();
    yield* loadSpriteSet(g, m.hram[0x7a]!);
    yield* loadPlayerTiles(g);
    yield* loadTileset(g, m.rd(0xc5b9));
    // 00:3D9E: the layout again (the tileset staging used D000), attributes twice
    g.selectBank(0x02);
    const rec = m.rd16((m.rd(0xccc7) * 2 + 0x58d0) & 0xffff);
    drawLayout(g, m.rd16(rec + 4));
    loadAttributes(g, m.rd(0xc5c9));
    loadAttributes(g, m.rd(0xc5c9));
    objectTable(m);
    objectSprites(m);
    // parity: the original's layout and attributes take frames of CPU time; the window goes off
    // and the palettes on at the line it reached 00:26F1 (yf06)
    yield* g.untilPoint(g.pointTime(0x26f1));
    windowOff(m);
    playerSprites(g);
    m.wr(0xc5bc, 0);
    palettesOn(m);
  }

  /** 00:2AF0 — floor and money windows. */
  private *summary(): Co {
    const m = this.m;
    this.box(0x10, 0x04);
    m.wr(0xc3da, m.rd(0xccc6));
    m.wr(0xc3db, m.rd(0xccc5));
    yield* this.ui(0x12, 0x31, 0xc625);
    yield* this.blit(0x9c61, 0x12, 0x06);
    this.box(0x10, 0x04);
    this.money();
    yield* this.ui(0x12, 0x0d, 0xc626);
    yield* this.blit(0x9d81, 0x12, 0x06);
  }

  /** 00:32C3 — money CC8D-CC8F to C400 (text code 36/3A value 0). 00:32C6 from hl. */
  money(hl = 0xcc8d): void {
    copy(this.m, hl, 0xc400, 3);
  }

  /** 00:26FE — save (yes/no). */
  private *save(): Co {
    const m = this.m;
    this.box(0x10, 0x04);
    yield* this.ui(0x12, 0x0f, 0xc626);
    yield* this.blit(0x9d81, 0x12, 0x06);
    const a = yield* this.menu(0x3f1c, 0);
    if (a !== 0) return;
    m.hram[0x64] = 0x15;
    writeSave(this.g);
  }

  // ------------------------------------------------------------ member choice

  /** 00:2C6D — the party window (members' sprites, names, HP). */
  private *partyWindow(): Co {
    this.box(0x12, 0x0b);
    yield* this.memberSprites();
    yield* this.ui(0x14, 0x0e, 0xc62a, 0x01, 0x02);
    yield* this.blit(0x9c00, 0x14, 0x0d);
  }

  /** 00:3D66 — the four members' class sprites (8000..; empty slots from 01:7F80). */
  *memberSprites(): Co {
    const g = this.g, m = this.m;
    this.b = 0; this.de = 0x8100;
    let de = 0x8000;
    for (let k = 0; k < 4; k++) {
      const hl = 0xcc00 + 31 * k;
      const a = m.rd(hl);
      if (a === 0xff) {
        g.selectBank(0x01);
        [, de] = yield* vramCopy(g, 0x7f80, de, 0x40);
      } else {
        de = yield* classTiles(g, m.rd(hl + 5), a ? 1 : 0, de);
      }
    }
  }

  /** 00:295F — choose a member (menu 3F21); FF when cancelled; FFCD = the record offset
   *  (00:3CEC), C3AC = the index. Returns the record's flags & A0, or FF. */
  private *chooseMember(): Co<number> {
    const m = this.m;
    for (;;) {
      const a = yield* this.menu(0x3f21, 0);
      if (a === 0xff) return 0xff;
      m.wr(0xc3ac, a);
      const off = recordOffset(a);
      m.hram[0x4d] = off;
      // bc = CC00 + the offset: an empty slot asks again with that bc (the page window, FFF6/7)
      this.b = 0xcc; this.c = off;
      if (m.rd(0xcc00 | off) === 0xff) continue;
      this.c = (off + 0x0a) & 0xff;
      return m.rd(0xcc00 | this.c) & 0xa0;
    }
  }

  // ------------------------------------------------------------ abilities (00:271E)

  private *abilities(): Co {
    const m = this.m;
    for (;;) {
      this.copyCursor(0xc070);
      yield* this.partyWindow();
      if ((yield* this.chooseMember()) === 0xff) return;
      m.wr(0xc5c8, m.hram[0x4d]!);
      for (;;) {
        yield* this.clearWindow();
        yield* this.memberItems();
        this.copyCursor(0xc070, 0xc000, 0);
        const a = yield* this.menu(0x3f29, 0);
        if (a === 0xff) { yield* this.hideSprites(); break; }
        const i2 = (a * 2) & 0xff;
        this.copyCursor(0xc080);
        let k: number;
        do { yield* vsync(this.g); oamDma(m); k = joyRepeat(m); } while (!k);
        if (k !== 1) continue;
        const cd = m.hram[0x4d]!;
        let hl = 0xcc00 | ((cd + 0x10 + i2) & 0xff);
        if (m.rd(0xcc00 | cd) & 3) continue;
        const uses = m.rd(hl);
        hl--;
        if (uses === 0 || uses === 0xff) continue;
        const r = yield* this.calls.useItem(this.g, m.rd(hl), hl);
        if (r === 0) {
          const u = hl + 1;
          if (m.rd(u) !== 0xfe) {
            m.wr(u, m.rd(u) - 1);
            if (m.rd(u) === 0 && !(m.rd(hl) & 0x80)) m.wr(u, 0xff);
          }
        }
        m.hram[0x4d] = cd;
      }
    }
  }

  /** 00:2981 — a member's window: HP, stats, the 8 items with uses. */
  private *memberItems(): Co {
    const m = this.m;
    yield* this.hideSprites();
    this.box(0x06, 0x0d);
    const cd = m.hram[0x4d]!;
    m.wr(0xffb4, m.rd(0xcc00 | ((cd + 8) & 0xff)));
    m.wr(0xffb5, m.rd(0xcc00 | ((cd + 9) & 0xff)));
    copy(m, 0xcc00 | ((cd + 0x0b) & 0xff), 0xc3da, 4);
    yield* this.ui(0x08, 0x14, 0xc611, 0x02, 0x01);
    yield* this.blit(0x9c20, 0x08, 0x0f);
    yield* this.listWindow(0x9c07);
    this.clear();
    yield* this.itemList(0xcc00 | ((cd + 0x0f) & 0xff));
    yield* this.blit(0x9c29, 0x09, 0x10);
  }

  /** 00:29D9 — an empty list frame (10 x 16) at de (12 x 18). */
  private *listWindow(de: number): Co {
    this.box(0x0a, 0x10);
    yield* this.blit(de, 0x0c, 0x12);
  }

  /** 00:29E7 — 8 items (id, uses) from hl into C3D0/C3DA (FF uses for an empty slot), drawn by
   *  UI string 5 at C609. Leaves bc = C3E2 (as the copy loop does). */
  *itemList(hl: number, dest = 0xc609, width = 0x09): Co {
    const m = this.m;
    let de = 0xc3d0, bc = 0xc3da;
    for (let k = 0; k < 8; k++) {
      const id = m.rd(hl++);
      m.wr(de++, id);
      let a: number;
      if (id === 0xff) { a = 0xff; hl++; }
      else a = m.rd(hl++);
      m.wr(bc++, a);
    }
    this.b = bc >> 8; this.c = bc & 0xff;
    yield* this.ui(width, 0x05, dest);
  }

  // ------------------------------------------------------------ the bag (00:2799)

  private *bag(): Co {
    const m = this.m;
    m.wr(0xc5c8, 0xff);
    yield* this.bagWindow();
    yield* this.hideSprites(0xc080, 4);
    let a = yield* this.menu(0x3f63, 3, 0x9c23, 0x09, 0x10);
    for (;;) {
      if (a === 0xff) return;
      if (a === 0x09) {
        a = yield* this.spheres();
        if (a === -1) return yield* this.bag();
        continue;
      }
      m.wr(0xc5c6, (a * 2) & 0xff);
      this.copyCursor(0xc080);
      let b: number;
      for (;;) {
        b = yield* this.menuResume();
        if (b !== 0x09) break;
      }
      if (b === 0xff) { a = yield* this.bagRedraw(); continue; }
      const bi = (b * 2) & 0xff;
      let hl = 0xcc7c + bi;
      const sel = m.rd(0xc5c6);
      if (((sel + bi) & 0xff) === 0x20) { a = yield* this.bagRedraw(); continue; }
      if (sel === 0x10) {
        m.wr(hl, 0xff); m.wr(hl + 1, 0xff);
      } else if (sel === bi) {
        // 00:28AC: use the bag item
        const p = 0xcc7c + sel;
        m.wr(0xc5c6, p & 0xff);
        const u = m.rd(p + 1);
        if (u !== 0 && u !== 0xff) {
          const r = yield* this.calls.useItem(this.g, m.rd(p), p);
          if (r === 0 && m.rd(p + 1) !== 0xfe) {
            m.wr(p + 1, m.rd(p + 1) - 1);
            if (m.rd(p + 1) === 0 && !(m.rd(p) & 0x80)) m.wr(p + 1, 0xff);
          }
          yield* this.bag();
          return;
        }
      } else if (bi === 0x10) {
        hl = 0xcc7c + sel;
        m.wr(hl, 0xff); m.wr(hl + 1, 0xff);
      } else {
        // 00:28DF: swap the two slots
        const de = 0xcc7c + sel;
        for (let k = 0; k < 2; k++) {
          const c = m.rd(hl + k);
          m.wr(hl + k, m.rd(de + k));
          m.wr(de + k, c);
        }
      }
      a = yield* this.bagRedraw();
    }
  }

  /** 00:2B4E entered again (the menu state in HRAM). */
  private *menuResume(): Co<number> {
    return yield* this.menuLoop(false);
  }

  /** 00:27B4 — redraw the bag list and resume the menu at its page. */
  private *bagRedraw(): Co<number> {
    yield* this.bagList();
    yield* this.hideSprites(0xc080, 4);
    yield* this.redrawPage(this.m.hram[0x72]!, 0);
    return yield* this.menuResume();
  }

  /** 00:2A87 — the bag window. */
  private *bagWindow(): Co {
    yield* this.clearWindow();
    yield* this.hideSprites();
    yield* this.listWindow(0x9c01);
    yield* this.bagList();
    yield* this.blit(0x9c23, 0x09, 0x10);
  }
  /** 00:2AA2 — the bag list (8 items + 2 more rows: 00:2A73, 00:2A7D) into the buffer. */
  private *bagList(): Co {
    this.clear();
    yield* this.itemList(0xcc7c);
    yield* this.ui(0x09, 0x11, 0xc692);
    yield* this.ui(0x09, 0x12, 0xc6ab);
  }

  /** 00:2810 — the spheres (progress nibble 0A): returns -1 to go back to the bag. */
  private *spheres(): Co<number> {
    const g = this.g, m = this.m;
    if (nibble(m, 0x0a) === 5) return yield* this.bagRedraw();
    yield* this.sphereWindow(nibble(m, 0x0a));
    this.copyCursor(0xc070);
    for (;;) {
      const a = yield* this.menu(0x3f79, 0);
      if (a === 0xff) return -1;
      if (a >= nibble(m, 0x0a)) continue;
      if (nibble(m, 0) === 2) {
        if (m.rd(0xccc7) !== 1) return -1;
        m.wr(0xff40, 0xeb);
        m.hram[0x47] = m.rd(0xff42);
        m.hram[0x48] = m.rd(0xff43);
        m.wr(0xff43, 0);
        m.wr(0xff42, 0);
        m.hram[0x60] = 0;
        windowOff(m);
        for (let b = nibble(m, 0x0a); b; b--) {
          yield* this.sphereWindow(b);
          m.hram[0x64] = 0x0c;
          yield* this.calls.shake(g);
        }
        setNibble(m, 0x0a, 5);
        windowTop(m);
        m.wr(0xff40, 0xe3);
        m.hram[0x60] = 1;
        m.wr(0xff42, m.hram[0x47]!);
        m.wr(0xff43, m.hram[0x48]!);
        return -1;
      }
      setNibble(m, 4, a + 5);
      // de: e = a + 5 (00:2844), then the object list's end (the next menu's page window)
      this.de = (this.de & 0xff00) | ((a + 5) & 0xff);
      if (!(m.rd(0xc5e2) & 0x80)) this.de = placeObjects(g);
      m.hram[0x64] = 0x0c;
      yield* this.calls.quake(g);
    }
  }

  /** 00:2AB6 — sphere counts C3E4-C3E7 (a, a-1, ...) and their window. */
  private *sphereWindow(a: number): Co {
    const m = this.m;
    let c = a;
    for (let k = 0; k < 4; k++) { m.wr(0xc3e4 + k, c); if (c) c--; }
    this.box(0x07, 0x07);
    yield* this.ui(0x09, 0x13, 0xc614);
    yield* this.blit(0x9ca7, 0x09, 0x09);
  }

  // ------------------------------------------------------------ equipment (00:28F5)

  private *equipment(): Co {
    const m = this.m;
    for (;;) {
      this.copyCursor(0xc070);
      yield* this.partyWindow();
      if ((yield* this.chooseMember()) === 0xff) return;
      for (;;) {
        yield* this.equipWindow();
        const a = yield* this.menu(0x3f3b, 0);
        if (a === 0xff) { yield* this.hideSprites(); break; }
        const sel = (m.hram[0x4d]! + 0x0f + a * 2) & 0xff;
        m.wr(0xc5c6, sel);
        if (((m.rd(0xcc00 | sel) + 1) & 0xff) >= 0x81) continue;
        yield* this.equipBagWindow();
        const b = yield* this.menu(0x3f4d, 2, 0x9c2a, 0x09, 0x10);
        if (b === 0xff) continue;
        if (b === 0x08) {
          m.wr(0xccfe, 0xff);
          m.wr(0xccff, 0xff);
          m.wr(0xc5cd, 0xfe);
        } else m.wr(0xc5cd, (b * 2 + 0x7c) & 0xff);
        m.wr(0xc5ce, m.rd(0xc5c6));
        this.calls.equip(this.g);
      }
    }
  }

  /** 00:2A0F — the member's equipment window. */
  private *equipWindow(): Co {
    const m = this.m;
    yield* this.clearWindow();
    yield* this.hideSprites();
    this.box(0x0e, 0x10);
    copy(m, 0xcc00 | ((m.hram[0x4d]! + 0x0b) & 0xff), 0xc3da, 4);
    yield* this.ui(0x10, 0x10, 0xc621, 0x02, 0x01);
    yield* this.blit(0x9c00, 0x10, 0x12);
    this.clear();
    yield* this.itemList(0xcc00 | ((m.hram[0x4d]! + 0x0f) & 0xff));
    yield* this.blit(0x9c26, 0x09, 0x10);
  }

  /** 00:2A55 — the bag next to it. */
  private *equipBagWindow(): Co {
    this.copyCursor(0xc070);
    yield* this.listWindow(0x9c08);
    this.clear();
    yield* this.itemList(0xcc7c);
    yield* this.ui(0x09, 0x11, 0xc692);
    yield* this.blit(0x9c2a, 0x09, 0x10);
  }

  // ------------------------------------------------------------ party order (Select, 00:3BAD)

  /** 00:3BAD — the order screen (also changes the text speed). */
  *order(): Co {
    yield* this.clearWindow();
    windowTop(this.m);
    yield* this.hideSprites();
    yield* this.menuTiles();
    yield* this.orderLoop();
  }

  private *orderLoop(): Co {
    const m = this.m;
    for (;;) {
      // 00:3BB0
      yield* this.hideSprites();
      yield* this.orderScreen();
      for (;;) {
        // 00:3BB6
        yield* this.hideSprites(0xc080, 4);
        const a = yield* this.menu(0x3eac, 0);
        if (a === 0xff) return yield* this.close();
        if (a >= 0x20) { m.wr(0xccca, a - 0x20); break; }
        m.hram[0x4d] = a >> 3;
        this.copyCursor(0xc080);
        const a2 = yield* this.menu(0x3eac, 0);
        if (a2 === 0xff) continue;
        if (a2 >= 0x20) { m.wr(0xccca, a2 - 0x20); break; }
        let b = a2 >> 3;
        let cd = m.hram[0x4d]!;
        if (cd === b) {
          // 00:3BEF: the member's status
          m.wr(0xc3ac, cd);
          m.hram[0x4d] = recordOffset(cd);
          yield* this.equipWindow();
          yield* this.waitKey();
          break;
        }
        if (cd < b) { const c = cd; cd = b; m.hram[0x4d] = cd; b = c; }
        if (m.rd(0xcc00 | recordOffset(cd)) & 3) continue;
        const lead = m.rd(0xcc8c);
        if (lead === cd) m.wr(0xcc8c, b);
        else if (lead === b) m.wr(0xcc8c, cd);
        const x = 0xcc00 | recordOffset(cd), y = 0xcc00 | recordOffset(b);
        for (let k = 0; k < 0x1f; k++) {
          const c = m.rd(x + k);
          m.wr(x + k, m.rd(y + k));
          m.wr(y + k, c);
        }
        yield* this.hideSprites(0xc080, 4);
        yield* this.hideSprites(0xc090, 4);
        const hl = yield* this.slide(0xc000 | (((b << 4) | (b >> 4)) & 0xff), 2, 0x10);
        yield* this.slide(hl, 0, ((cd - b) * 24) & 0xff);
        this.box(0x06, 0x02);
        yield* this.ui(0x08, 0x2f, 0xc611);
        yield* this.blit(0x9d0a, 0x08, 0x04);
        yield* this.waitKey();
        break;
      }
    }
  }

  /** 00:3C8C — move a member's sprites (c: 0 down, 1 up, 2 left, 3 right), b frames, the walk
   *  frame flipping every 8 (C5C7). */
  private *slide(hl: number, c: number, b: number): Co<number> {
    const m = this.m;
    for (let n = b || 256; n; n--) {
      yield* vsync(this.g);
      oamDma(m);
      let p = hl, e = 1;
      if (c === 0) e = 1;
      else if (c === 1) e = 0xff;
      else { p++; e = c === 2 ? 0xff : 1; }
      for (let d = 4; d; d--, p += 4) m.wr(p, (m.rd(p) + e) & 0xff);
      const t = (m.rd(0xc5c7) + 1) & 0xff;
      m.wr(0xc5c7, t);
      if (t & 0x08) {
        m.wr(0xc5c7, 0);
        let q = (hl & ~0x0f) + 2;
        for (let k = 0; k < 2; k++) {
          const r = q + 4;
          const tt = m.rd(q);
          m.wr(q, m.rd(r)); m.wr(r, tt);
          const f = m.rd(q + 1) ^ 0x20;
          m.wr(q + 1, f); m.wr(r + 1, f);
          q += 8;
        }
      }
      hl &= ~0x0f;
    }
    return hl;
  }

  /** 00:3D04 — the order screen: frame, sprites, names, status marks, text speed cursor. */
  private *orderScreen(): Co {
    const m = this.m;
    this.box(0x12, 0x10);
    yield* this.memberSprites();
    yield* this.ui(0x14, 0x1b, 0xc62b, 0x01, 0x03);
    let de = 0xc648;
    for (let k = 0; k < 4; k++) {
      const hl = 0xcc00 + 31 * k;
      if (m.rd(hl) !== 0xff) {
        const n = m.rd(hl + 0x0a) & 0x0f;
        for (let j = 0; j < n; j++) m.wr(de + j, 0xf2);
      }
      de += 0x3c;
    }
    yield* this.blit(0x9c00, 0x14, 0x12);
    const b = (((m.rd(0xccca) << 4) & 0xf0) + 0x10) & 0xff;
    this.cursorSprites(0x70, b, 0x90, 0x7c);
  }
}

/** 00:3CEC — record offset of member a: E1 + 31 (a + 1) (8-bit). */
export function recordOffset(a: number): number {
  return (0xe1 + 0x1f * (a + 1)) & 0xff;
}



