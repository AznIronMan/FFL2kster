/** Legend I field main loop (00:1212-2A5C): map changes, the player's step and scroll, objects'
 *  random walk, tile animation, step checks (triggers, encounters, damage floors), buttons and the
 *  event executor 00:16E0 (C3AB pending, C3A9 command, C3AA parameter). */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { vsync, joyRepeat, rand, sub16 } from "../sys.js";
import { cell, cellAttr, passable } from "./map.js";
import { drawLayout } from "./map.js";
import { palettesOff, palettesOn, setSpeed, loadTileset, loadAttributes, loadSpriteSet, loadPlayerTiles, clearObjects,
  placeObjects, fieldScreen, objectTable, objectSprites, playerTiles, priority, screenOrigin, animSprites } from "./load.js";

/** Calls from the field into other subsystems. */
export interface FieldCalls {
  /** 00:16E0 event commands not handled here (by C3A9 & 0F). */
  event(g: Game, cmd: number): Co;
  /** 00:269D main menu (Start). */
  startMenu(g: Game): Co;
  /** 00:3BAD party order (Select). */
  selectMenu(g: Game): Co;
}

export class FieldEngine {
  readonly coverage: Record<string, number> = {};
  constructor(readonly g: Game, readonly calls: FieldCalls) {}

  get m(): Memory {
    return this.g.m;
  }

  /** 00:1212 — new game: warp 0 (02:52D0), then the loop. */
  *newGame(): Co {
    const m = this.m;
    m.wr(0xc5bf, 0xd0);
    m.wr(0xc5c0, 0x52);
    this.resetState();
    yield* this.warp();
    yield* this.loop();
  }

  /** 00:1224 — continue: the saved map CCC7 at the saved position, then the loop. */
  *continueGame(): Co {
    this.resetState();
    yield* this.loadMap(this.m.rd(0xccc7));
    yield* this.loop();
  }

  /** 00:125A */
  private resetState(): void {
    const m = this.m;
    m.wr(0xc5b7, 0);
    m.wr(0xc5cb, 0);
    m.wr(0xc5ba, 0);
  }

  /** 00:1243 — the field loop (never returns). */
  *loop(): Co {
    for (;;) {
      this.g.ui.fieldFrame = this.g.frame;
      yield* this.step();
      this.npcWalk();
      this.input();
      this.stepCheck();
      yield* this.buttons();
      yield* this.events();
      yield* this.warp();
    }
  }

  // ------------------------------------------------------------ map changes

  /** 00:22BC — load map a (02:58D0 record) at the current position. */
  *loadMap(a: number): Co {
    const m = this.m;
    this.g.selectBank(0x02);
    const hl = m.rd16(0x58d0 + ((a << 1) & 0x1ff));
    yield* this.mapInit(hl);
  }

  /** 00:22CC — take the warp at C5BF/C5C0 (02:52D0 + 3n: map, column, row), if any. */
  *warp(): Co {
    const m = this.m;
    let hl = m.rd(0xc5bf) | (m.rd(0xc5c0) << 8);
    if (!hl) return;
    m.wr(0xccc2, m.rd(0xccc7));
    m.wr(0xccc4, m.rd(0xccc9));
    m.wr(0xccc3, m.rd(0xccc8));
    this.g.selectBank(0x02);
    let a = m.rd(hl++);
    if (a !== 0 && a < 0x18) {
      m.wr(0xccc6, a);
      if (m.rd(0xccc5) < a) m.wr(0xccc5, a);
    }
    m.wr(0xccc7, a);
    const rec = m.rd16(0x58d0 + ((a << 1) & 0x1ff));
    m.wr(0xccc9, m.rd(hl++));
    m.wr(0xccc8, m.rd(hl));
    yield* this.mapInit(rec);
  }

  /** 00:231B — set up the map whose record is at bank 02:hl. */
  private *mapInit(hl: number): Co {
    const g = this.g, m = g.m;
    setSpeed(m);
    m.hram[0x78] = m.rd(hl++);
    m.hram[0x79] = m.rd(hl++);
    palettesOff(m);
    m.wr(0xc5b9, m.rd(hl++));
    yield* loadTileset(g, m.rd(0xc5b9));
    m.wr(0xc5c9, m.rd(hl++));
    const layout = m.rd16(hl);
    hl++;
    drawLayout(g, layout);
    g.selectBank(0x02);
    loadAttributes(g, m.rd(0xc5c9));
    hl++;
    let b = m.rd(hl++);
    m.wr(0xc5e2, b);
    m.hram[0x60] = m.rd(hl++);
    clearObjects(m);
    const rlc = () => { const c = b >> 7; b = ((b << 1) | c) & 0xff; return c !== 0; };
    if (!rlc()) {
      const s = m.rd(hl++);
      m.hram[0x7a] = s;
      yield* loadSpriteSet(g, s);
      g.selectBank(0x02);
      m.hram[0x7b] = m.rd(hl++);
      m.hram[0x7c] = m.rd(hl);
      placeObjects(g);
      hl++;
    }
    g.selectBank(0x02);
    for (let k = 0; k < 3; k++) m.wr(0xc5c3 + k, rlc() ? 0xff : m.rd(hl++));
    b = ((b << 4) | (b >> 4)) & 0xff;
    m.wr(0xc5bb, b & 3);
    m.wr(0xc5bc, 0);
    yield* loadPlayerTiles(g);
    yield* fieldScreen(g);
    m.wr(0xff40, 0xe3); // 00:23FE (after waiting for LY 0x91)
    objectTable(m);
    objectSprites(m);
    yield* vsync(g);
    m.wr(0xff46, 0xc0);
    palettesOn(m);
    m.wr(0xc5b1, !(m.rd(0xc3a9) & 1) && m.rd(0xc3aa) === 0xff ? 0x80 : 0);
    for (const a of [0xc5ca, 0xc5b0, 0xc5b6, 0xc3ab, 0xc5bf, 0xc5c0]) m.wr(a, 0);
    m.hram[0x7e] = 0;
    m.hram[0x7d] = 0;
    m.wr(0xc5ba, 1);
    m.wr(0xc5c1, 0x21);
    m.wr(0xc5c2, 0x9c);
    const [e, d] = cellAttr(m, m.rd(0xccc8), m.rd(0xccc9));
    priority(m, e, d);
    m.wr(0xc5cc, 7);
  }

  // ------------------------------------------------------------ frames, scrolling

  /** 00:1265 — object step animation, a frame, OAM DMA of page C0/C1 (alternating every 16
   *  frames by C5B6). */
  *frame(): Co {
    const m = this.m;
    this.npcStep();
    yield* vsync(this.g);
    const c = (m.rd(0xc5b6) + 1) & 0xff;
    m.wr(0xc5b6, c);
    m.wr(0xff46, 0xc0 | ((c & 0x10) >> 4));
  }

  /** 00:127D — the player's step: a new row/column of metatiles, then the scroll until done. */
  *step(): Co {
    const m = this.m;
    const dir = m.rd(0xc5b1) & 0xf0;
    if (!dir) {
      yield* this.frame();
      this.tileAnim();
      return;
    }
    this.edge(dir);
    objectTable(m);
    m.wr(0xc5ba, 0);
    const fe = m.hram[0x7e]!;
    if (fe) {
      m.hram[0x7e] = fe - 1;
      m.hram[0x7d] = 0;
      m.wr(0xc5cc, 0);
    }
    yield* this.drawEdge();
    for (;;) {
      this.tileAnim();
      this.scroll();
      if (!m.rd(0xc5b1)) break;
      yield* this.frame();
    }
    objectSprites(m);
  }

  /** 00:12F8 — prepare the metatiles entering the screen (C500) and move the player's cell. */
  private edge(a: number): void {
    const m = this.m;
    const scx = m.rd(0xff43), scy = m.rd(0xff42);
    if (a & 0x80) {
      screenOrigin(m, (scy + 0x90) & 0xff, (scx - 8) & 0xff);
      this.rowBuffer((m.rd(0xccc8) + 5) & 0xff);
      m.wr(0xccc8, m.rd(0xccc8) + 1);
    } else if (a & 0x40) {
      screenOrigin(m, (scy - 0x10) & 0xff, (scx - 8) & 0xff);
      this.rowBuffer((m.rd(0xccc8) - 5) & 0xff);
      m.wr(0xccc8, m.rd(0xccc8) - 1);
    } else if (a & 0x20) {
      screenOrigin(m, scy, (scx - 0x18) & 0xff);
      this.colBuffer((m.rd(0xccc9) - 6) & 0xff);
      m.wr(0xccc9, m.rd(0xccc9) - 1);
    } else {
      screenOrigin(m, scy, (scx + 0xa8) & 0xff);
      this.colBuffer((m.rd(0xccc9) + 6) & 0xff);
      m.wr(0xccc9, m.rd(0xccc9) + 1);
    }
  }

  /** 00:1368 — a row of 11 metatiles at row e: top tiles C500.., bottom tiles C516... */
  private rowBuffer(e: number): void {
    const m = this.m;
    let d = (m.rd(0xccc9) - 5) & 0xff, hl = 0xc500;
    for (let b = 0x0b; b; b--) {
      const a = (cell(m, e, d)[1] * 4 + 0x80) & 0xff;
      m.wr(hl, a);
      m.wr(hl + 1, a + 1);
      m.wr(hl + 0x16, a + 2);
      m.wr(hl + 0x17, a + 3);
      hl += 2;
      d = (d + 1) & 0xff;
    }
  }

  /** 00:1390 — a column of 9 metatiles at column d (4 tiles each). */
  private colBuffer(d: number): void {
    const m = this.m;
    let e = (m.rd(0xccc8) - 4) & 0xff, hl = 0xc500;
    for (let b = 9; b; b--) {
      const a = (cell(m, e, d)[1] * 4 + 0x80) & 0xff;
      for (let k = 0; k < 4; k++) m.wr(hl++, (a + k) & 0xff);
      e = (e + 1) & 0xff;
    }
  }

  /** 00:141D — after a frame, copy C500 to the BG map at C5B4/C5B5 (a row or a column). */
  private *drawEdge(): Co {
    const m = this.m;
    let hl = m.rd(0xc5b4) | (m.rd(0xc5b5) << 8);
    yield* vsync(this.g);
    let de = 0xc500;
    if (!(m.rd(0xc5b1) & 0xc0)) {
      for (let b = 0x12; b; b--) {
        m.wr(hl, m.rd(de++));
        hl = (hl + 1) & 0xffff;
        m.wr(hl, m.rd(de++));
        hl = ((hl + 0x1f) & 0xffff) & ~0x0400;
      }
      return;
    }
    const top = hl;
    for (let b = 0x0b; b; b--) {
      m.wr(hl, m.rd(de++)); hl = (hl + 1) & 0xffff;
      m.wr(hl, m.rd(de++)); hl = (hl + 1) & 0xffff;
      hl = (hl & ~0xff) | ((hl & 0xff) & ~0x20);
    }
    hl = (top & ~0xff) | ((top & 0xff) | 0x20);
    for (let b = 0x0b; b; b--) {
      m.wr(hl, m.rd(de++)); hl = (hl + 1) & 0xffff;
      m.wr(hl, m.rd(de++));
      let l = (hl & 0xff) & ~0x20;
      l = (l + 1) & 0xff;
      l |= 0x20;
      hl = (hl & ~0xff) | l;
    }
  }

  /** 00:12B4 — one scroll step of C5B2 pixels (objects' sprites move the other way). */
  private scroll(): void {
    const m = this.m;
    const b = m.rd(0xc5b2), dir = m.rd(0xc5b1);
    let v: number;
    if (dir & 0x80) {
      this.moveSprites(0xc010, -b, true);
      v = (m.rd(0xff42) + b) & 0xff;
      m.wr(0xff42, v);
    } else if (dir & 0x40) {
      this.moveSprites(0xc010, b, true);
      v = (m.rd(0xff42) - b) & 0xff;
      m.wr(0xff42, v);
    } else if (dir & 0x20) {
      this.moveSprites(0xc011, b, false);
      const s = (m.rd(0xff43) - b) & 0xff;
      m.wr(0xff43, s);
      v = (s + 8) & 0xff;
    } else {
      this.moveSprites(0xc011, -b, false);
      const s = (m.rd(0xff43) + b) & 0xff;
      m.wr(0xff43, s);
      v = (s + 8) & 0xff;
    }
    if (!(v & 0x0f)) m.wr(0xc5b1, 0);
  }

  /** 00:1C38-1C7F — 32 sprites from de: coordinate += delta on both pages (from the C0 value);
   *  Y moves (00:1C58/1C6C) skip hidden sprites (Y >= B0). */
  private moveSprites(de: number, delta: number, skipHidden: boolean): void {
    const m = this.m;
    for (let k = 0; k < 0x20; k++, de += 4) {
      const a = m.rd(de);
      if (skipHidden && a >= 0xb0) continue;
      const v = (a + delta) & 0xff;
      m.wr(de, v);
      m.wr(de | 0x100, v);
    }
  }

  /** 00:1466 — tile animation (C5BB rotations of tiles 80/81, 82/83 rows, C5BC position). */
  tileAnim(): void {
    const m = this.m;
    const n = m.rd(0xc5bb);
    if (!n) return;
    let l = m.rd(0xc5bc);
    for (let k = 0; k < 2; k++) {
      const hl = 0x8800 | l;
      // rra / rr c / rr b: c:b rotated right as one 16-bit value per step
      let c = m.rd(hl), b = m.rd(hl | 0x10);
      for (let i = n; i; i--) {
        const nc = ((b & 1) << 7) | (c >> 1);
        b = ((c & 1) << 7) | (b >> 1);
        c = nc;
      }
      m.wr(hl | 0x10, b);
      m.wr(hl, c);
      l = (l + 1) & 0xff;
    }
    let p = (m.rd(0xc5bc) + 2) & 0xff;
    if (p === 0x10) p = 0x20;
    else if (p === 0x30) p = 0;
    m.wr(0xc5bc, p);
  }

  // ------------------------------------------------------------ objects

  /** 00:1F33 — the moving object's sprites one pixel on (C5AE) for C5B0 frames; at the end the
   *  object sprites are rebuilt (unless the player is moving). */
  private npcStep(): void {
    const m = this.m;
    if (!m.rd(0xc5b0)) return;
    const c = m.rd(0xc5ae);
    let hl = 0xc000 | m.rd(0xc5af);
    for (let b = 4; b; b--) {
      const a = (m.rd(hl) + c) & 0xff;
      m.wr(hl, a);
      m.wr(hl | 0x100, a);
      hl += 4;
    }
    const n = (m.rd(0xc5b0) - 1) & 0xff;
    m.wr(0xc5b0, n);
    if (n || m.rd(0xc5b1)) return;
    objectTable(m);
    objectSprites(m);
  }

  /** 00:1F67 — the object at (row e, column d): its record address, or null. */
  objectAt(e: number, d: number): number | null {
    const m = this.m;
    for (let k = 0, hl = 0xc55c; k < 16; k++, hl += 5) if (m.rd(hl) === e && m.rd(hl + 1) === d) return hl;
    return null;
  }

  /** 00:1E26 — a random visible object may take a random step. */
  private npcWalk(): void {
    const m = this.m;
    if (m.rd(0xc5b0)) return;
    const l0 = rand(m, 0x1e31, 0, 7);
    const b = 8 - l0;
    const ent = 0xc500 | ((l0 * 6 + 0x2c) & 0xff);
    if (m.rd(ent) === 0xff) return;
    if (rand(m, 0x1e4b, 0, m.rd(0xc5cc))) return;
    m.wr(0xc5cc, 7);
    m.wr(0xc5ac, ent & 0xff);
    const idx = m.rd(ent);
    const hl = (0xc55c + ((idx * 5) & 0xff)) & 0xffff;
    if (m.rd(hl + 4) & 0x80) return;
    const dir = rand(m, 0x1e6f, 0, 3);
    this.npcMove(hl, dir, b);
  }

  /** 00:1E72 — object at hl steps in direction dir (0 down, 1 up, 2 left, 3 right) if the cell
   *  is free, on screen and not the player's; b = 8 - its C52C entry. */
  npcMove(hl: number, dir: number, b: number): void {
    const m = this.m;
    let e = m.rd(hl), d = m.rd(hl + 1);
    if (dir === 0) e = (e + 1) & 0xff;
    else if (dir === 1) e = (e - 1) & 0xff;
    else if (dir === 2) d = (d - 1) & 0xff;
    else d = (d + 1) & 0xff;
    if (d >= 0x40 || e >= 0x3e) return;
    const py = m.rd(0xccc8), px = m.rd(0xccc9);
    if (py === e) {
      if (px === d) return;
    } else if (((e - py + 5) & 0xff) >= 0x0b) return;
    if (((d - px + 5) & 0xff) >= 0x0b) return;
    if (this.objectAt(e, d) !== null) return;
    const [ae, ad] = cellAttr(m, e, d);
    if (ae & 0x40) return;
    if (!(ae & 0xb0) && (ad & 1)) return;
    m.wr(hl + 1, d);
    m.wr(hl, e);
    m.wr(0xc5ad, dir);
    m.wr(hl + 4, (m.rd(hl + 4) & 0xcf) | (dir << 4));
    const ptr = 0x204d + dir * 10;
    const ent = 0xc500 | ((m.rd(0xc5ac) + 3) & 0xff);
    const c = m.rd(ent);
    m.wr(ent + 1, ptr & 0xff);
    m.wr(ent + 2, ptr >> 8);
    let s = 0xc000 | (((9 - b) * 16) & 0xff);
    animSprites(m, (s + 2) | 0x100, animSprites(m, s + 2, ptr, c), c);
    if (dir >= 2) s++;
    m.wr(0xc5ae, ((dir - 1) & 0xff) < 2 ? 0xff : 1);
    m.wr(0xc5af, s & 0xff);
    m.wr(0xc5b0, 0x10);
  }

  // ------------------------------------------------------------ the player

  /** 00:209D — the first held direction (down, up, left, right; table 00:245E) tries a step. */
  private input(): void {
    const m = this.m;
    let hl = 0x245e, c = 0x80;
    for (let b = 4; b; b--) {
      if (m.hram[0x0d]! & c) return this.tryStep(hl, b, c);
      hl += 2;
      c >>= 1;
    }
  }

  /** 00:20B1 — step from table entry hl (direction 4 - b, bit c): bump into an object (its event
   *  when flagged), or start moving if the cell is passable. */
  tryStep(hl: number, b: number, c: number): void {
    const m = this.m;
    const e = (m.rd(0xccc8) + m.rd(hl)) & 0xff;
    const d = (m.rd(0xccc9) + m.rd(hl + 1)) & 0xff;
    if (e < 0x3e && d < 0x40) {
      const obj = this.objectAt(e, d);
      if (obj !== null) {
        m.wr(0xc5bd, obj & 0xff);
        m.wr(0xc5be, obj >> 8);
        if ((m.rd(obj + 4) & 0x40) && !m.rd(0xccc1)) {
          m.wr(0xc3aa, m.rd(obj + 3));
          const a = m.rd(obj + 2);
          m.wr(0xc3a9, a);
          if (a < 0x10) m.wr(0xc3ab, 1);
          else { m.wr(0xc3a9, 3); m.wr(0xc3ab, a - 0x10); }
        }
      } else {
        const p = passable(m, e, d);
        if (!p.nz && !(p.e & 0x40)) {
          priority(m, p.e, p.d);
          m.wr(0xc5b1, c);
        }
      }
    }
    m.wr(0xc5b7, 4 - b);
    playerTiles(m);
  }

  /** 00:2173 — after a step: speed reset, the cell's trigger (attribute e bit 7), encounter roll
   *  (d bits 6-7 = zone slot), forced moves (e bit 2) and damage floors (e bits 0-1). */
  private stepCheck(): void {
    const m = this.m;
    m.wr(0xc5b2, m.rd(0xc5b3));
    m.wr(0xc5b8, 0);
    const [e, d] = cellAttr(m, m.rd(0xccc8), m.rd(0xccc9));
    if (e & 0x80) {
      if (m.hram[0x7e]) return;
      m.hram[0x7e] = 1;
      m.wr(0xc3aa, d);
      m.wr(0xc3a9, e & 0x0f);
      m.wr(0xc3ab, 1);
      return;
    }
    if (e & 0x60) return;
    if (d & 0xc0) this.encounter(d);
    if (e & 0x04) return this.forced(e);
    const dmg = e & 3;
    if (!dmg || m.hram[0x7d]) return;
    m.hram[0x7d] = 1;
    for (let k = 0; k < 4; k++) {
      const rec = 0xcc00 + 31 * k;
      if (m.rd(rec) & 3) continue;
      const hp = m.rd16(rec + 6);
      const r = sub16(m, hp >> 8, hp, dmg);
      m.wr16(rec + 6, r.zero || r.carry ? 1 : r.hl);
    }
  }

  /** 00:2195 — forced move (conveyor) in direction e & 3. */
  private forced(e: number): void {
    const m = this.m;
    const n = e & 3;
    const c = 0x80 >> n;
    const hl = 0x245e + 2 * n;
    const cur = m.rd(0xc5b1);
    if (cur) {
      if (cur === c) { if (m.rd(0xc5b2) >= 2) return; }
      else {
        const o = cur | c;
        if (o !== 0xc0 && o !== 0x30) return;
        if (m.rd(0xc5b2) >= 3) return;
      }
    }
    m.wr(0xc5b7, n);
    const row = (m.rd(0xccc8) + m.rd(hl)) & 0xff;
    if (row >= 0x3e) return;
    const col = (m.rd(0xccc9) + m.rd(hl + 1)) & 0xff;
    if (col >= 0x40) return;
    const [ae, ad] = cellAttr(m, row, col);
    priority(m, ae, ad);
    m.wr(0xc5b1, c);
    m.wr(0xc5b8, c);
    m.wr(0xc5b2, 2);
    playerTiles(m);
  }

  /** 00:2266 — encounter roll on zone slot d >> 6 (C5C3-C5C5): rand(0 .. (C5B3-1)*8 + rate) = 0,
   *  then the area slot by rand(0..255) against 00:22B5. Leaves bank 06 selected. */
  private encounter(d: number): void {
    const m = this.m;
    const slot = d >> 6;
    if (m.hram[0x7e]) return;
    m.hram[0x7e] = 1;
    const z = m.rd(0xc5c2 + slot);
    if (z === 0xff) return;
    let hl = (z * 8) & 0xffff;
    this.g.selectBank(0x06);
    hl = (hl + 0x6400) & 0xffff;
    let e = (((m.rd(0xc5b3) - 1) * 8) & 0xff) + m.rd(hl);
    if (e > 0xff) e = 0xff;
    if (rand(m, 0x2299, 0, e)) return;
    const a = rand(m, 0x22a1, 0, 0xff);
    let t = 0x22b4, de = hl;
    do { t++; de++; } while (a < m.rd(t));
    m.wr(0xc3aa, m.rd(de));
    m.wr(0xc3a9, 8);
    m.wr(0xc3ab, 1);
  }

  /** 00:3B68 — the cell in front of the player: [row, column]. */
  front(): [number, number] {
    const m = this.m;
    let e = m.rd(0xccc8), d = m.rd(0xccc9);
    const dir = m.rd(0xc5b7);
    if (dir === 0) e = (e + 1) & 0xff;
    else if (dir === 1) e = (e - 1) & 0xff;
    else if (dir === 2) d = (d - 1) & 0xff;
    else d = (d + 1) & 0xff;
    return [e, d];
  }

  /** 00:2466 — A (talk/examine or leave the vehicle), Start (menu), Select (party order). */
  private *buttons(): Co {
    const m = this.m;
    if (m.rd(0xc3ab)) return;
    const a = joyRepeat(m) & 0x0d;
    if (!a) return;
    m.wr(0xc5b1, 0);
    if (a & 0x08) return yield* this.calls.startMenu(this.g);
    if (a & 0x04) return yield* this.calls.selectMenu(this.g);
    if (m.rd(0xccc1)) {
      m.wr(0xc3a9, 0x0c);
      m.wr(0xc3ab, 0x0c);
      m.wr(0xc3aa, 0);
      return;
    }
    const [e, d] = this.front();
    const obj = this.objectAt(e, d);
    if (obj !== null) {
      m.wr(0xc5bd, obj & 0xff);
      m.wr(0xc5be, obj >> 8);
      m.wr(0xc3aa, m.rd(obj + 3));
      const c = m.rd(obj + 2);
      if (c >= 0x10) { m.wr(0xc3ab, c - 0x10); m.wr(0xc3a9, 3); return; }
      m.wr(0xc3a9, c);
      m.wr(0xc3ab, 1);
      return;
    }
    const [ae, ad] = cellAttr(m, e, d);
    if (ae & 0x90) return;
    if (!(ae & 0x60)) return;
    m.wr(0xc3a9, ae & 0x0f);
    m.wr(0xc3aa, ad);
    m.wr(0xc3ab, 1);
  }

  /** 00:16E0 — run the pending event (C3AB) and restore the bank (00:1AB8). */
  private *events(): Co {
    const m = this.m;
    if (!m.rd(0xc3ab)) return;
    m.wr(0xc5d0, m.hram[0x0b]!);
    m.wr(0xc5b1, 0);
    const cmd = m.rd(0xc3a9) & 0x0f;
    const k = cmd.toString(16);
    this.coverage[k] = (this.coverage[k] ?? 0) + 1;
    yield* this.calls.event(this.g, cmd);
    this.eventEnd();
  }

  /** 00:1AB8 */
  eventEnd(): void {
    const m = this.m;
    m.wr(0xc5bd, 0);
    m.wr(0xc5be, 0);
    m.wr(0xc3ab, 0);
    this.g.selectBank(m.rd(0xc5d0));
  }

  /** 00:224A — warp n (C3AA, plus 256 for command 5) as the next map change (C5BF/C5C0). */
  setWarp(e: number, d: number): void {
    const m = this.m;
    if (m.rd(0xc5ba)) return;
    const n = ((e & 1) << 8) | d;
    const hl = 0x52d0 + n * 3;
    m.wr(0xc5bf, hl & 0xff);
    m.wr(0xc5c0, hl >> 8);
  }
}
