/** Legend I field menus (bank 0, 00:269D-2D30, 00:3BAD-3D9D): the grid menu engine 00:2B2E
 *  (definition: rows, columns + 1, then per row Y and the X of each column; FF = no item, FE /
 *  FD = next / previous page), window helpers, the main menu (items, equipment, status, save) and
 *  the party order (Select). Registers that reach the text engine (b, c -> FF96-FF98 through
 *  00:08D4) are tracked as the original leaves them. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import type { TextEngine } from "../text.js";
import { vsync, oamDma, joyRepeat, vramBegin, vramEnd, bufferClear, blitRows, vramCopyBank16, fill, copy } from "../sys.js";
import { frame } from "../title.js";
import { classTiles } from "../title.js";
import { writeSave } from "../save.js";
import { palettesOff, palettesOn, loadSpriteSet, loadPlayerTiles, loadTileset, loadAttributes, objectTable, objectSprites,
  windowOff, windowTop, playerSprites } from "./load.js";
import { drawLayout } from "./map.js";

export class Menus {
  /** b, c, de as the original leaves them (they reach FF96-FF98 through 00:08D4 and FFF4-FFF7
   *  through 00:2B2E when a caller does not set them). */
  b = 0;
  c = 0;
  de = 0;
  constructor(readonly g: Game, readonly text: TextEngine) {}

  get m(): Memory {
    return this.g.m;
  }

  // ------------------------------------------------------------ helpers

  /** rst $08 with the tracked b, c (de = the string index after). */
  *ui(a: number, e: number, hl: number, b = this.b, c = this.c): Co {
    this.b = b; this.c = c;
    yield* this.text.ui(a, b, c, e, hl);
    this.de = e;
  }

  /** 00:2CF2 — the window map 9C00 (20 x 18) cleared to FF. */
  *clearWindow(): Co {
    const m = this.m;
    yield* vramBegin(this.g);
    let hl = 0x9c00;
    for (let c = 0x12; c; c--) {
      hl = fill(m, hl, 0x14, 0xff) + 0x0c;
    }
    yield* vramEnd(this.g);
    this.b = 0; this.c = 0;
  }

  /** 00:2CB8 — all sprites hidden (Y = FA), a frame with OAM DMA. 00:2CA3/2CAA/2CB1: the
   *  group C070/C080/C090 only. */
  *hideSprites(hl = 0xc000, n = 0x28): Co {
    for (let k = 0; k < n; k++) this.m.wr(hl + 4 * k, 0xfa);
    this.b = 0;
    yield* vsync(this.g);
    oamDma(this.m);
  }

  /** 00:01A7 — the window buffer cleared (bc = 0 after, as 00:0082 leaves it). */
  clear(): void {
    bufferClear(this.m);
    this.b = 0; this.c = 0;
  }

  /** 00:2D0F — the buffer cleared and a frame of (b + 2) x (c + 2) at C600 (b = c = 0 after). */
  box(b: number, c: number): void {
    bufferClear(this.m);
    frame(this.g, 0xc600, b, c);
    this.b = 0; this.c = 0;
  }

  /** 00:2A9C — buffer C600 to the window map at de, b x c. */
  *blit(de: number, b: number, c: number, hl = 0xc600): Co {
    yield* blitRows(this.g, hl, de, b, c);
    this.b = b; this.c = 0;
    this.de = (de + 0x20 * (c || 256)) & 0xffff;
  }

  /** 00:3DC1 — menu tiles 02:7E00 -> 8E00 (512 bytes). */
  *menuTiles(): Co {
    yield* vramCopyBank16(this.g, 0x02, 0x7e00, 0x8e00, 0x0200);
  }

  /** 00:2C48 — 2 x 2 cursor sprites from hl (C0xx) at (X b, Y c), tiles e.. */
  cursorSprites(l: number, b: number, c: number, e: number): void {
    const m = this.m;
    this.b = b; this.c = (c + 16) & 0xff; this.de = (e + 4) & 0xff;
    for (let h = 2; h; h--) {
      let x = b, hl = 0xc000 | l;
      for (let d = 2; d; d--) {
        m.wr(hl, c); m.wr(hl + 1, x); m.wr(hl + 2, e); m.wr(hl + 3, 0);
        hl += 4;
        x = (x + 8) & 0xff;
        e = (e + 1) & 0xff;
      }
      l = (l + 8) & 0xff;
      c = (c + 8) & 0xff;
    }
  }

  /** 00:2CD6 — copy the 4 cursor sprites at hl to de, X + c. 00:2CC9: C090 -> C070 (+4);
   *  00:2CCE: C090 -> C080 (+4). */
  copyCursor(de: number, hl = 0xc090, c = 4): void {
    const m = this.m;
    this.de = (de + 16) & 0xffff; this.b = 0; this.c = c;
    for (let b = 4; b; b--) {
      m.wr(de++, m.rd(hl++));
      m.wr(de++, (m.rd(hl++) + c) & 0xff);
      m.wr(de++, m.rd(hl++));
      m.wr(de++, m.rd(hl++));
    }
  }

  // ------------------------------------------------------------ the menu engine

  /** 00:2B2E — run a menu: definition hl, page count a, page window (de, b x c). Returns the
   *  item index (page rows included) or FF (B). */
  *menu(hl: number, a: number, de = this.de, b = this.b, c = this.c): Co<number> {
    const H = this.m.hram;
    H[0x73] = a;
    H[0x4f] = 0; H[0x4e] = 0; H[0x72] = 0;
    H[0x74] = de & 0xff; H[0x75] = de >> 8;
    H[0x76] = b; H[0x77] = c;
    H[0x70] = hl & 0xff; H[0x71] = hl >> 8;
    return yield* this.menuLoop(true);
  }

  /** 00:2B4E (00:2B82 first when `move`) — the menu loop on the state in HRAM: FFCF/FFCE row and
   *  column, FFF0/FFF1 definition, FFF2 page, FFF3 pages, FFF4-FFF7 page window. */
  *menuLoop(move = false): Co<number> {
    const m = this.m, H = m.hram;
    let e = move ? 0 : H[0x4f]!, d = move ? 0 : H[0x4e]!;
    for (;;) {
      const hl = H[0x70]! | (H[0x71]! << 8);
      if (!move) {
        e = H[0x4f]!; d = H[0x4e]!;
        yield* vsync(this.g);
        oamDma(m);
        const k = joyRepeat(m);
        if (!k) continue;
        this.c = m.hram[0x0d]!;
        if (k & 0x01) {
          // 00:2BCA
          e = (H[0x72]! + e) & 0xff;
          let n = (m.rd(hl + 1) - 1) & 0xff, r = 0;
          do { r = (r + e) & 0xff; n = (n - 1) & 0xff; } while (n);
          this.b = 0;
          this.de = (d << 8) | e;
          return (r + d) & 0xff;
        }
        if (k & 0x02) { this.de = (d << 8) | e; return 0xff; }
        if (k & 0x80) e = (e + 1) & 0xff;
        else if (k & 0x40) e = (e - 1) & 0xff;
        else if (k & 0x20) d = (d - 1) & 0xff;
        else if (k & 0x10) d = (d + 1) & 0xff;
        else continue;
      }
      move = false;
      // 00:2B82
      const rows = m.rd(hl);
      if (e >= rows) e = (e >= 0xf0 ? e + rows : e - rows) & 0xff;
      const cols = (m.rd(hl + 1) - 1) & 0xff;
      if (d >= cols) d = (d >= 0xf0 ? d + cols : d - cols) & 0xff;
      let n = (cols + 1) & 0xff, off = 0;
      do { off = (off + e) & 0xff; n = (n - 1) & 0xff; } while (n);
      const p = (hl + 2 + off) & 0xffff;
      const y = m.rd(p);
      const x = m.rd((p + d + 1) & 0xffff);
      this.b = x; this.c = y;
      if (x === 0xff) continue;
      if (x === 0xfe) { yield* this.page(1); continue; }
      if (x === 0xfd) { yield* this.page(-1); continue; }
      H[0x4f] = e; H[0x4e] = d;
      this.cursorSprites(0x90, x, y, 0x7c);
    }
  }

  /** 00:3CF7 — a frame, all buttons released, then a new press. */
  *waitKey(): Co {
    const g = this.g, m = g.m;
    yield* vsync(g);
    oamDma(m);
    do yield* vsync(g);
    while (m.hram[0x0d]);
    do yield* vsync(g);
    while (!joyRepeat(m));
  }

  /** 00:2BD8 / 00:2C35 — next / previous page: redraw (00:2BE6) and move the C080 marker. */
  private *page(dir: number): Co {
    const H = this.m.hram;
    if (dir > 0) {
      const a = (H[0x72]! + 1) & 0xff;
      if (a >= H[0x73]!) return;
      H[0x72] = a;
      yield* this.redrawPage(a, 0xf0);
    } else {
      const a = H[0x72]!;
      if (!a) return;
      H[0x72] = a - 1;
      yield* this.redrawPage(a - 1, 0x10);
    }
  }

  /** 00:2BE6 — page a of the list buffer (C600 + a * 2 * FFF6) to the window; the marker at
   *  C080 moves by c (hidden behind the frame outside Y 20-97). */
  *redrawPage(a: number, c: number): Co {
    const m = this.m, H = m.hram;
    let hl = 0xc600;
    if (a) {
      const s = (H[0x76]! * 2) & 0xff;
      for (let b = a; b; b--) hl = (hl + s) & 0xffff;
    }
    yield* blitRows(this.g, hl, H[0x74]! | (H[0x75]! << 8), H[0x76]!, H[0x77]!);
    if (m.rd(0xc5cb)) return;
    if (m.rd(0xc080) === 0xfa) return;
    const y = (m.rd(0xc080) + c) & 0xff;
    const e = y < 0x20 || y >= 0x98 ? 0x90 : 0x00;
    for (let k = 0, p = 0xc080; k < 4; k++, p += 4) {
      m.wr(p, (m.rd(p) + c) & 0xff);
      m.wr(p + 3, e);
    }
  }
}
