/** Field main loop, player input/movement, triggers, encounters and the field event dispatcher
 *  (bank 0, 00:1A43-1A70, 00:26D5-2A5C, 00:2FBF-3248, 00:333C-3389, 00:36D6-3FF8).
 *
 *  Field events are (C443, C442) pairs: F0 dd = step in direction dd (dd >= 4: system actions),
 *  F1-F4 forced moves, F5/F6 object moves, F7 priority, F8-FF chained, 04 phrase, 05/06/0E
 *  warps, 07 sound, 09/0A/0B items, 0C/0D sub-maps, 00-03 scripts. FF FF = none. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { rand } from "../rng.js";
import { joyRepeat, varGet, varSet, flagTest, flagSet } from "../sys.js";
import { DIR_DX, DIR_DY, cellAddr, cellGet, cellMark, resolveMeta, attrOf, playerCell, offMap } from "./map.js";
import { fieldFrame, restoreStat, scrollStart, scrollFrame, waterAnim, drawView, fadeIn, fadeOut, scrollApply } from "./view.js";
import { drawPlayer, updateObjects, npcWander, objectAt, refreshObjects, redrawObject, clearObjectSprites,
  loadObjectTiles, loadPlayerTiles, playerSpriteSource, OBJ } from "./sprites.js";
import { changeMap, placeObjects, placeVehicles, playerCellState, loadLayout, readDestination, readHeader,
  clearNpcOam, loadAttributes, loadObjects, initPlayer, loadTileset } from "./load.js";
import { quake, flash, curtainClose, splitOpen, diamondClose, diamondOpen } from "./effects.js";
import { vramCopy } from "./sprites.js";

/** Calls from the field into other subsystems (script engine, menus). */
export interface FieldCalls {
  /** rst $20 — run script DE (00:0800). */
  script(g: Game, de: number): Co;
  /** 01:5000 main menu (Start), 01:5003 (Select). */
  startMenu(g: Game): Co;
  selectMenu(g: Game): Co;
  /** 00:14AC — event kind 04: phrase/scene DE via 01:5009. */
  event4(g: Game, de: number): Co;
}

export class FieldEngine {
  /** Times each event kind ran (F0 subcommands separately); a coverage aid for the sweeps. */
  readonly coverage: Record<string, number> = {};
  constructor(readonly g: Game, readonly rom: Uint8Array, readonly calls: FieldCalls) {}

  get m(): Memory {
    return this.g.m;
  }

  // ------------------------------------------------------------ main loop

  /** 00:1A43 — the field main loop (never returns). */
  *loop(): Co {
    const m = this.m;
    for (;;) {
      if (!m.rd(0xc43d)) {
        yield* this.stepCheck();
        const b = m.rd(0xc443);
        if (b === 0x0e || b === 5 || b === 6) {
          yield* changeMap(this.g, this.rom, true);
          m.wr(0xc442, 0xff);
          m.wr(0xc443, 0xff);
          continue;
        }
        yield* this.buttons();
        this.moveInput();
        this.forcedMove();
      }
      npcWander(m);
      updateObjects(m);
      yield* this.dispatch();
    }
  }

  /** 00:27C9 — once after arriving on a cell: trigger cells, layer changes (swirl redraw),
   *  conveyor tiles, damage floors, BG priority, random encounters. */
  *stepCheck(): Co {
    const m = this.m;
    if (m.rd(0xc438)) return;
    m.wr(0xc438, 1);
    const [x, y] = playerCell(m);
    const v = cellGet(m, x, y);
    if (v & 0x40) {
      this.trigger(v);
      return;
    }
    const meta = resolveMeta(m, v);
    if ((meta & 0x20) !== m.rd(0xc43c)) {
      m.wr(0xc43c, meta & 0x20);
      clearObjectSprites(m);
      const d = attrOf(m, meta);
      if ((d & 0xc0) !== 0xc0) {
        m.wr(0xc43b, d & 0x30);
        drawPlayer(m, m.rd(0xc436));
      }
      yield* fieldFrame(this.g);
      m.wr(0xc462, m.rd(0xc305));
      m.wr(0xc305, m.rd(0xc305) & 0x0f);
      restoreStat(m);
      yield* this.swirl();
      refreshObjects(m);
      m.wr(0xc305, m.rd(0xc462));
      yield* fieldFrame(this.g);
    }
    let a = attrOf(m, meta);
    let e: number;
    if (a & 0x80) {
      if (a & 0x40) {
        if (a & 0x20) return;
        this.trigger(a);
        return;
      }
      e = a;
      const n = ((a >> 2) & 3) + 1;
      const sp = 1 << (n - 1);
      m.wr(0xc43e, sp);
      m.wr(0xc437, sp);
      this.setEventIfNone(a & 3, 0xf0);
    } else {
      if (a & 0x40) yield* this.damageFloor();
      e = a;
      if (a & 0x04) {
        if (m.rd(0xc434) & 1) e = 0x30;
      } else {
        let s = a & 3;
        if (s) s ^= 3;
        m.wr(0xc434, s);
      }
    }
    m.wr(0xc43b, e & 0x30);
    if (!m.rd(0xc453)) return;
    if (rand(m, 9, 0, 0xff) < m.rd(0xc455)) yield* this.runScript(0x0002);
  }

  /** 00:298A — queue the trigger event of trigger index a & 1F (table C457, bank 7). */
  private trigger(a: number): void {
    const m = this.m;
    m.selectBank(0x07);
    const p = (m.rd(0xc457) | (m.rd(0xc458) << 8)) + 2 * (a & 0x1f);
    this.setEventIfNone(m.romAt(0x07, p), m.romAt(0x07, p + 1));
  }

  /** 00:29CF — set the pending event (C442 = l, C443 = h) unless one is pending. */
  setEventIfNone(l: number, h: number): void {
    const m = this.m;
    if (m.rd(0xc443) !== 0xff || m.rd(0xc442) !== 0xff) return;
    m.wr(0xc442, l);
    m.wr(0xc443, h);
  }

  private setEvent(l: number, h: number): void {
    this.m.wr(0xc442, l);
    this.m.wr(0xc443, h);
  }

  /** 00:3CAB */
  private clearEvent(): void {
    this.setEvent(0xff, 0xff);
  }

  /** 00:2952 — damage floor: every member's HP -1 (minimum 1), sprite palette flash, sound 0x36. */
  private *damageFloor(): Co {
    const m = this.m;
    for (let k = 0, a = 0xc207; k < 5; k++, a = (a & 0xff00) | ((a + 0x20) & 0xff)) {
      let v = (m.rd(a) | (m.rd(a + 1) << 8)) - 1;
      if ((v & 0xffff) === 0) v = 1;
      m.wr(a, v & 0xff);
      m.wr(a + 1, (v >> 8) & 0xff);
    }
    m.wr(0xff48, 0x2d);
    m.hram[0x32] = 0x36;
    for (let i = 0; i < 3; i++) yield* fieldFrame(this.g);
    m.wr(0xff48, 0xd2);
  }

  /** 00:1B66 — run script DE from the field, keeping the screen-effect nibble of C305 unless
   *  the script set mode 3 (then cleared) or another mode. */
  *runScript(de: number): Co {
    const m = this.m;
    m.wr(0xc461, m.rd(0xc305));
    m.wr(0xc305, m.rd(0xc305) & 0x0f);
    restoreStat(m);
    yield* this.calls.script(this.g, de);
    const a = m.rd(0xc305) & 0xf0;
    if (a === 0x30) {
      m.wr(0xc305, m.rd(0xc305) & 0x0f);
      return;
    }
    if (a) return;
    m.wr(0xc305, (m.rd(0xc305) & 0x0f) | (m.rd(0xc461) & 0xf0));
  }

  // ------------------------------------------------------------ input

  /** 00:3039 — Select/Start menus, B (script 0x58), A: talk, open, search, dismount. */
  private *buttons(): Co {
    const m = this.m;
    const a = joyRepeat(m);
    if (a & 0x04) return yield* this.menu(false);
    if (a & 0x08) return yield* this.menu(true);
    if (a & 0x02) return yield* this.runScript(0x0058);
    if (!(a & 0x01)) return;
    if (varGet(m, 0x1f)) {
      // 00:3162 — riding: A dismounts if the cell allows it
      const [x, y] = playerCell(m);
      const v = cellGet(m, x, y);
      if (v & 0x40) return;
      if (attrOf(m, resolveMeta(m, v)) >= 0xc0) return;
      this.setEventIfNone(0x05, 0xf0);
      return;
    }
    const d = m.rd(0xc436) & 3;
    const [x, y] = playerCell(m, DIR_DX[d], DIR_DY[d]);
    if (offMap(x, y)) return;
    const v = cellGet(m, x, y);
    if (!(v & 0x80)) {
      if (v & 0x40) return;
      const attr = attrOf(m, resolveMeta(m, v));
      if (attr < 0xe0) return;
      this.trigger(attr);
      return;
    }
    const s = objectAt(m, x, y);
    if (!s) return;
    const layer = m.rd(s + 0x0b) & 3, mine = m.rd(0xc434) & 3;
    if (layer && mine && !(mine & m.rd(s + 0x0b))) return;
    const c = m.rd(s + 9), b = m.rd(s + 0x0a);
    if (b === 9 || b === 0x0a) {
      // 00:3104 — treasure: open (sprite), then item/MAGI unless already taken
      m.wr(s + 5, (m.rd(s + 5) & 0x0f) | 0x10);
      yield* redrawObject(this.g, s);
      const f = m.rd(s + 0x0c);
      if (flagTest(m, f)) {
        yield* this.runScript(0x0103);
        return;
      }
      if (b === 0x0a) {
        yield* this.magiPickup(c);
        flagSet(m, f);
        return;
      }
      if (c === 0xff) {
        flagSet(m, f);
        yield* this.runScript(0x0103);
        return;
      }
      if (yield* this.giveItem(c)) return;
      flagSet(m, f);
      return;
    }
    if (b === 4) {
      this.setEvent(c, b);
      return;
    }
    if (b === 0xf0 && (c & 0xf8) === 0x08) {
      // vehicle: board
      m.wr(0xc442, m.rd(0xc436));
      m.wr(0xc443, 0xf8);
      m.wr(0xc444, c);
      m.wr(0xc445, b);
      m.wr(0xc446, s & 0xff);
      return;
    }
    this.setEvent(c, b);
    const f = m.rd(s + 5);
    if ((f & 0x0f) === 3) return;
    const t = m.rd(0xc436) ^ 1;
    m.wr(s + 5, ((t << 4) | (t << 6) | (f & 0x0f)) & 0xff);
  }

  /** 00:31C5 (Select) / 00:31E1 (Start): menu, then reload sprites and palettes. */
  private *menu(start: boolean): Co {
    const m = this.m;
    if (start) restoreStat(m);
    m.wr(0xc460, m.rd(0xc305));
    m.wr(0xc305, m.rd(0xc305) & 0x0f);
    if (!start) {
      restoreStat(m);
      yield* this.calls.selectMenu(this.g);
      playerSpriteSource(m);
    } else yield* this.calls.startMenu(this.g);
    if (m.rd(0xc452)) yield* loadObjectTiles(this.g);
    yield* loadPlayerTiles(this.g);
    m.wr(0xff47, 0xd2);
    m.wr(0xff48, 0xd2);
    m.wr(0xff49, 0xd2);
    const a = m.rd(0xc305) & 0xf0;
    if (a === 0x30) {
      m.wr(0xc305, m.rd(0xc305) & 0x0f);
      return;
    }
    if (a) return;
    m.wr(0xc305, (m.rd(0xc305) & 0x0f) | (m.rd(0xc460) & 0xf0));
  }

  /** 00:26D5 — directional input: face, then request a step (event F0 dir) if the target cell
   *  is free and walkable; walking into an object with +D set raises its event. Holding the
   *  same direction while a step is pending doubles the speed; the opposite one brakes. */
  moveInput(): void {
    const m = this.m;
    if (m.rd(0xc435)) {
      drawPlayer(m, m.rd(0xc436));
      return;
    }
    const inp = inputDir(m.hram[0x09]!);
    if (!inp) {
      drawPlayer(m, m.rd(0xc436));
      return;
    }
    const d = inp - 1;
    if (m.rd(0xc436) !== d) m.wr(0xc436, d);
    m.wr(0xc437, 0);
    drawPlayer(m, d);
    const [x, y] = playerCell(m, DIR_DX[d], DIR_DY[d]);
    if (offMap(x, y)) return;
    const v = cellGet(m, x, y);
    if (v & 0x80) {
      const s = objectAt(m, x, y);
      if (!s || !m.rd(s + 0x0d)) return;
      this.setEventIfNone(m.rd(s + 9), m.rd(s + 0x0a));
      return;
    }
    const attr = attrOf(m, resolveMeta(m, v));
    if (!(attr & 0x80)) {
      if (!(m.rd(0xc305) & 0x0f)) {
        if ((attr & 3) === 3) return;
        if (m.rd(0xc434) & attr) return;
      } else if (attr & 0x08) return;
    }
    // 00:2763
    const pl = m.rd(0xc442), ph = m.rd(0xc443);
    if (pl === 0xff && ph === 0xff) {
      m.wr(0xc43e, m.rd(0xc43f));
      this.setEvent(d, 0xf0);
      return;
    }
    if (ph !== 0xf0 || pl >= 4) return;
    const rel = (pl ^ d) & 3;
    if (rel === 0) {
      m.wr(0xc43e, m.rd(0xc43e) << 1);
      return;
    }
    if (rel !== 1) {
      m.wr(0xc43e, m.rd(0xc43f));
      this.setEvent(d, 0xf0);
      return;
    }
    const e = m.rd(0xc43f), cur = m.rd(0xc43e);
    if (cur < e) {
      m.wr(0xc43e, e >> 1 || 1);
      this.setEvent(d, 0xf0);
    } else if (cur === e) {
      this.setEvent(0xff, 0xff);
      m.wr(0xc43e, e);
    } else if (cur >> 1) m.wr(0xc43e, cur >> 1);
  }

  /** 00:2FBF — forced movement C435 (low 3 bits: direction + 1, bit 3: as a step event, high
   *  nibble: cells left): moves the player sprite by the speed, re-marks cells on arrival. */
  forcedMove(): void {
    const m = this.m;
    const c = m.rd(0xc435);
    const dir = c & 7;
    if (!dir) return;
    if (c & 0x08) {
      m.wr(0xc442, dir - 1);
      m.wr(0xc443, 0xf0);
      this.forcedArrive();
      return;
    }
    let dx = DIR_DX[(dir - 1) & 3]! & 0xff, dy = DIR_DY[(dir - 1) & 3]! & 0xff;
    for (let s = m.rd(0xc43e); !(s & 1) && s; s >>= 1) {
      dx = (dx << 1) & 0xff;
      dy = (dy << 1) & 0xff;
    }
    const nx = (m.rd(0xc42e) + dx) & 0xff, ny = (m.rd(0xc42f) + dy) & 0xff;
    m.wr(0xc42e, nx);
    m.wr(0xc42f, ny);
    if ((nx | ny) & 0x0f) return;
    const back = (dir - 1) ^ 1;
    const [ox, oy] = playerCell(m, DIR_DX[back & 3], DIR_DY[back & 3]);
    cellMark(m, ox, oy, false);
    const [px, py] = playerCell(m);
    cellMark(m, px, py, true);
    this.forcedArrive();
  }

  /** 00:3016 */
  private forcedArrive(): void {
    const m = this.m;
    m.wr(0xc438, 0);
    const v = (m.rd(0xc435) - 0x10) & 0xff;
    m.wr(0xc435, v >> 4 ? v : 0);
  }

  // ------------------------------------------------------------ events

  /** 00:391D — per-iteration event step: continue a scroll, or run the pending event. */
  *dispatch(): Co {
    const m = this.m;
    if (m.rd(0xc43d)) {
      yield* scrollFrame(this.g);
      if (m.rd(0xc443) === 0xf0 && m.rd(0xc442) < 4) this.clearEvent();
      return;
    }
    const b = m.rd(0xc443), c = m.rd(0xc442);
    if (c === 0xff && b === 0xff) return yield* this.idle();
    yield* this.event(b, c);
  }

  /** 00:3C93 — field frame, water animation, clear the event. */
  private *idle(): Co {
    yield* fieldFrame(this.g);
    waterAnim(this.m);
    this.clearEvent();
  }

  /** 00:3934 — run event (b, c). */
  *event(b: number, c: number): Co {
    const m = this.m, g = this.g;
    const key = b >= 0xf0 ? (b === 0xf0 ? `F0 ${c.toString(16).padStart(2, "0")}` : b.toString(16)) : b.toString(16).padStart(2, "0");
    this.coverage[key] = (this.coverage[key] ?? 0) + 1;
    switch (b) {
      case 0x04:
        yield* this.calls.event4(g, (b << 8) | c);
        return yield* this.idle();
      case 0x05: case 0x06: case 0x0e:
        yield* changeMap(g, this.rom, true);
        return yield* this.idle();
      case 0x07:
        if (c & 0x80) m.hram[0x32] = c - 0x80;
        else if (c & 0x40) m.hram[0x31] = c - 0x40;
        else {
          m.hram[0x30] = c;
          m.wr(0xc31a, c);
        }
        return yield* this.idle();
      case 0x08: return yield* this.idle();
      case 0x09: yield* this.giveItem(c); return;
      case 0x0a: yield* this.magiPickup(c); return;
      case 0x0b: yield* this.discardAndGive(c); return;
      case 0x0c: case 0x0d:
        this.saveReturnPoint();
        yield* changeMap(g, this.rom, false);
        return yield* this.idle();
    }
    if ((b & 0xf0) !== 0xf0) {
      if (b >= 4) return yield* this.idle();
      // 00:3A60 — script (b, c)
      m.wr(0xc465, m.rd(0xc305));
      m.wr(0xc305, m.rd(0xc305) & 0x0f);
      restoreStat(m);
      yield* this.calls.script(g, (b << 8) | c);
      const a = m.rd(0xc305) & 0xf0;
      if (a === 0x30) m.wr(0xc305, m.rd(0xc305) & 0x0f);
      else if (!a) m.wr(0xc305, (m.rd(0xc305) & 0x0f) | (m.rd(0xc465) & 0xf0));
      return yield* this.idle();
    }
    if (b & 0x08) {
      // 00:3B5B — chained: run (b & F7, c), then the stored next event C444/C445
      yield* this.event(b & 0xf7, c);
      m.wr(0xc442, m.rd(0xc444));
      m.wr(0xc443, m.rd(0xc445));
      return;
    }
    switch (b & 0x0f) {
      case 0: return yield* this.system(c);
      case 1: case 2: case 3: case 4: {
        if (m.rd(0xc435)) {
          yield* fieldFrame(g);
          return;
        }
        let e = 0;
        if (b === 0xf1 || b === 0xf2) e = 8;
        if (b === 0xf1 || b === 0xf3) m.wr(0xc436, c & 3);
        drawPlayer(m, m.rd(0xc436));
        yield* fieldFrame(g);
        const f = c & 0xf0;
        if (!f) return yield* this.idle();
        m.wr(0xc435, f | ((c & 3) + 1) | e);
        this.clearEvent();
        return;
      }
      case 5: case 6: {
        const s = OBJ + ((m.rd(0xc444) << 4) & 0xff);
        if (b === 0xf6) {
          const f = m.rd(s + 5);
          if ((f & 0x0f) !== 3) m.wr(s + 5, (f & 0xcf) | ((c & 3) << 4));
        }
        m.wr(s + 4, c >> 4);
        m.wr(s + 5, (m.rd(s + 5) & 0x3f) | ((c & 3) << 6));
        return yield* this.idle();
      }
      case 7:
        m.wr(0xc43b, c & 0x30);
        drawPlayer(m, m.rd(0xc436));
        yield* fieldFrame(g);
        return yield* this.idle();
      default:
        return yield* this.idle();
    }
  }

  /** 00:3AA1 — F0 subcommands. */
  private *system(c: number): Co {
    const m = this.m, g = this.g;
    if (c < 4) {
      // 00:3B2E — start a step
      m.wr(0xc438, 0);
      const [x, y] = playerCell(m);
      cellMark(m, x, y, false);
      m.wr(0xc43d, (c & 3) + 1);
      yield* scrollStart(g, c & 3);
      const [nx, ny] = playerCell(m);
      cellMark(m, nx, ny, true);
      this.clearEvent();
      return;
    }
    switch (c) {
      case 0x04: this.clearEvent(); return;
      case 0x05: return yield* this.dismount();
      case 0x0c: yield* quake(g); this.clearEvent(); return;
      case 0x0d:
        loadLayout(m, this.rom);
        playerCellState(m);
        yield* drawView(g);
        refreshObjects(m);
        break;
      case 0x0e: yield* fadeOut(g); break;
      case 0x0f: yield* fadeIn(g); break;
      case 0x10: m.hram[0x40] = 1; yield* diamondClose(g); break;
      case 0x11: yield* diamondOpen(g); break;
      case 0x12: yield* flash(g); break;
      case 0x13: yield* splitOpen(g); break;
      case 0x14: yield* curtainClose(g); break;
      case 0x15: m.wr(0xc45b, 1); drawPlayer(m, m.rd(0xc436)); break;
      case 0x16: m.wr(0xc45b, 0); drawPlayer(m, m.rd(0xc436)); break;
      case 0x17:
        for (let i = 0; i < 0x1c; i++) m.wr(0xc2da + i, 0);
        m.wr(0xc2d9, 0);
        break;
      case 0x18: {
        m.selectBank(0x0c);
        let de = 0x7f80, hl = 0xc2da;
        for (let i = 0; i < 8; i++, hl += 2) { m.wr(hl, m.rd(hl) | 0x09); m.wr(hl + 1, m.romAt(0x0c, de++)); }
        for (let i = 0; i < 6; i++, hl += 2) { m.wr(hl, m.rd(hl) | 0x01); m.wr(hl + 1, m.romAt(0x0c, de++)); }
        m.wr(0xc2d9, 0x4e);
        break;
      }
      default:
        if (c >= 8 && c < 0x0c) this.board(c);
        break;
    }
    yield* this.idle();
  }

  /** 00:3C3F — board vehicle c & 3. */
  private board(c: number): void {
    const m = this.m;
    const s = m.rd(0xc446);
    if (s) m.wr(0xc600 | s, m.rd(0xc600 | s) | 0x80);
    m.wr(0xc446, 0);
    m.wr(0xc430, 1);
    const v = c & 3;
    varSet(m, 0x1f, v + 1);
    const sp = 1 << (3 - v);
    m.wr(0xc43e, sp);
    m.wr(0xc43f, sp);
    m.wr(0xc431, 1);
    m.wr(0xc432, 0x80);
    m.wr(0xc433, 0x40);
  }

  /** 00:3B6F — leave the vehicle onto the faced cell and park it there. */
  private *dismount(): Co {
    const m = this.m;
    const v = varGet(m, 0x1f);
    if (!v) return yield* this.idle();
    const d = m.rd(0xc436) & 3;
    const [x, y] = playerCell(m, DIR_DX[d], DIR_DY[d]);
    if (offMap(x, y)) return yield* this.idle();
    const cell = cellGet(m, x, y);
    if (cell & 0x80) return yield* this.idle();
    const attr = attrOf(m, resolveMeta(m, cell));
    if (attr & 0x80) {
      if (attr & 0x40 && attr & 0x20) return yield* this.idle();
    } else {
      if (m.rd(0xc434) & attr) return yield* this.idle();
      if ((attr & 3) === 3) return yield* this.idle();
    }
    const hl = 0xc2a9 + (((v - 1) & 0x0f) << 2);
    m.wr(hl, m.rd(0xc44b));
    let sp = m.rd(0xc43f), k = 0;
    while (!(sp & 1) && k < 8) { sp >>= 1; k++; }
    m.wr(hl + 1, m.rd(0xc44c) | ((k & 3) << 6));
    m.wr(hl + 2, ((m.rd(0xc436) & 3) << 6) | ((m.rd(0xc42c) + (m.rd(0xc42e) >> 4)) & 0xff));
    const kind = m.rd(0xc431);
    m.wr(hl + 3, ((((kind >> 2) | (kind << 6)) & 0xff) | ((m.rd(0xc42d) + (m.rd(0xc42f) >> 4)) & 0xff)) & 0xff);
    m.wr(0xc43e, 1);
    m.wr(0xc43f, 1);
    m.wr(0xc430, 0);
    varSet(m, 0x1f, 0);
    playerSpriteSource(m);
    drawPlayer(m, m.rd(0xc436));
    m.wr(0xc442, m.rd(0xc436));
    m.wr(0xc443, 0xf0);
    yield* this.event(0xf0, m.rd(0xc436));
    placeVehicles(m);
    refreshObjects(m);
  }

  /** 00:1D0D — remember where to come back from a sub-map (C45C-C45F, CFE6-CFE8). */
  private saveReturnPoint(): void {
    const m = this.m;
    if (m.rd(0xc45c) | m.rd(0xc45d)) return;
    m.wr(0xcfe6, m.rd(0xc434));
    m.wr(0xcfe7, m.rd(0xc43a));
    m.wr(0xcfe8, m.rd(0xc43b));
    m.wr(0xc45c, m.rd(0xc2a5));
    m.wr(0xc45d, m.rd(0xc2a6));
    m.wr(0xc45e, (((m.rd(0xc436) & 3) << 6) | ((m.rd(0xc42c) + (m.rd(0xc42e) >> 4)) & 0xff)) & 0xff);
    m.wr(0xc45f, (m.rd(0xc42d) + (m.rd(0xc42f) >> 4)) & 0xff);
  }

  // ------------------------------------------------------------ items

  /** 00:3F78 — first free inventory slot (C2B9, 16 x [id, uses]) or 0. */
  private freeSlot(): number {
    for (let i = 0; i < 16; i++) if (this.m.rd(0xc2b9 + 2 * i) === 0xff) return 0xc2b9 + 2 * i;
    return 0;
  }

  /** 00:3EDF — give item c (chest); returns true when nothing was given. */
  private *giveItem(c: number): Co<boolean> {
    const hl = this.freeSlot();
    if (!hl) {
      yield* this.runScript(0x0104);
      yield* this.runScript(0x0105);
      this.clearEvent();
      return true;
    }
    return yield* this.putItem(hl, c);
  }

  /** 00:3EF6 */
  private *putItem(hl: number, c: number): Co<boolean> {
    const m = this.m;
    if (c === 0xff) {
      yield* this.runScript(0x0103);
      this.clearEvent();
      return true;
    }
    m.wr(hl, c);
    m.wr(0xc71d, c);
    m.wr(hl + 1, m.romAt(0x0c, 0x7e80 + c));
    yield* this.runScript(0x0107);
    this.clearEvent();
    return false;
  }

  /** 00:3F28 — give item c, asking which item to drop when the bag is full. */
  private *discardAndGive(c: number): Co {
    const m = this.m;
    let hl = this.freeSlot();
    if (!hl) {
      yield* this.runScript(0x0104);
      do yield* this.runScript(0x0106);
      while (m.hram[0x0c] === 0xff);
      hl = 0xc2b9 + 2 * m.hram[0x0c]!;
      m.wr(hl, 0xff);
      m.wr(hl + 1, 0xff);
    }
    yield* this.putItem(hl, c);
  }

  /** 00:3F4E — MAGI c found. */
  private *magiPickup(c: number): Co {
    const m = this.m;
    // 8-bit address arithmetic as in 00:3F4E: 7F00 | (80 + c) and C2DA + (2c & FF)
    const b = m.romAt(0x0c, 0x7f00 | ((0x80 + c) & 0xff));
    const hl = 0xc2da + ((2 * c) & 0xff);
    m.wr(hl, m.rd(hl) + 1);
    m.wr(hl + 1, b);
    m.wr(0xc2d9, m.rd(0xc2d9) + 1);
    m.wr(0xc71d, c);
    yield* this.runScript(0x0102);
    this.clearEvent();
  }

  // ------------------------------------------------------------ layer swirl

  /** 00:36D6 — redraw the view in a square spiral from the player outwards when the layer
   *  changes: first the cells of the new layer, then the other layer's placeholder metatile.
   *  Each tile is written during vblank (LY 0x90-0x97). */
  private *swirl(): Co {
    const m = this.m;
    const w = new SwirlWriter();
    let h = ((m.rd(0xc44a) + 1) & 0xfb) & 0xff;
    let l = m.rd(0xc449);
    l = (l & 0xe0) | ((l + 0x0a) & 0x1f);
    let d = 0, b = 8, c = 0x0a;
    const put = function* (self: FieldEngine, second: boolean): Co {
      yield* w.tile(self.m, (h << 8) | l, d, b, c, second);
    };
    const colInc = () => { l = (l & 0xe0) | ((l + 1) & 0x1f); };
    const colDec = () => { l = (l & 0xe0) | ((l - 1) & 0x1f); };
    const rowInc = () => { const v = l + 0x20; l = v & 0xff; h = ((h + (v >> 8)) & 0xfb); };
    const rowDec = () => { const v = l - 0x20; l = v & 0xff; h = (((h - (v < 0 ? 1 : 0)) & 0xfb) | 0x08); };
    yield* put(this, false);
    let a = 1;
    for (;;) {
      for (let e = a; e; e--) { d ^= 1; colInc(); c = (c + 1) & 0xff; yield* put(this, false); }
      for (let e = a; e; e--) { d ^= 2; rowInc(); b = (b + 1) & 0xff; yield* put(this, false); }
      if (++a === 0x17) break;
      for (let e = a; e; e--) { d ^= 1; colDec(); c = (c - 1) & 0xff; yield* put(this, false); }
      for (let e = a; e; e--) { d ^= 2; rowDec(); b = (b - 1) & 0xff; yield* put(this, false); }
      if (++a === 0x17) break;
    }
    // second pass (00:376A)
    const p = m.rd(0xc449);
    const lo = ((p & 0xe0) | ((p - 1) & 0x1f)) - 0x40;
    l = lo & 0xff;
    h = ((((m.rd(0xc44a) - (lo < 0 ? 1 : 0)) & 0xfb) | 0x08) & 0xff);
    d = 1; b = 0xfe; c = 0xff;
    a = 0x16;
    for (;;) {
      for (let e = a; e; e--) { d ^= 1; colInc(); c = (c + 1) & 0xff; yield* put(this, true); }
      if (--a === 0) return;
      for (let e = a; e; e--) { d ^= 2; rowInc(); b = (b + 1) & 0xff; yield* put(this, true); }
      for (let e = a; e; e--) { d ^= 1; colDec(); c = (c - 1) & 0xff; yield* put(this, true); }
      if (--a === 0) return;
      for (let e = a; e; e--) { d ^= 2; rowDec(); b = (b - 1) & 0xff; yield* put(this, true); }
    }
  }

  // ------------------------------------------------------------ sequences

  /** 00:388C (00:1906) — run an inline event sequence at hl (bank FF88 at entry): pairs
   *  [b, c] (F5/F6 take an object byte) until FF (then wait for all movement to end) or an
   *  event that is not a movement. Returns the pointer after the sequence. */
  *sequence(hl: number): Co<number> {
    const m = this.m, g = this.g;
    const sp = m.rd(0xc468);
    m.wr(0xc400 | sp, m.hram[0x08]!);
    m.wr(0xc468, sp + 1);
    for (;;) {
      const bank = m.rd(0xc400 | ((m.rd(0xc468) - 1) & 0xff));
      m.selectBank(bank);
      const b = m.rd(hl++);
      m.wr(0xc443, b);
      if (b === 0xff) {
        yield* this.waitMovement();
        break;
      }
      const c = m.rd(hl++);
      m.wr(0xc442, c);
      if (b === 0xf5 || b === 0xf6) m.wr(0xc444, m.rd(hl++));
      yield* this.event(b, c);
      if (b < 0xf0 || b >= 0xf7) break;
      if (b === 0xf0 && c >= 4) break;
    }
    const n = (m.rd(0xc468) - 1) & 0xff;
    m.wr(0xc468, n);
    m.selectBank(m.rd(0xc400 | n));
    return hl;
  }

  /** 00:38DA — run movement until the player and every object stand still. */
  private *waitMovement(): Co {
    const m = this.m;
    for (;;) {
      if (!m.rd(0xc43d)) {
        this.forcedMove();
        drawPlayer(m, m.rd(0xc436));
      }
      updateObjects(m);
      yield* this.dispatch();
      if (m.rd(0xc435) & 7 || m.rd(0xc43d)) continue;
      m.wr(0xff42, m.hram[0x41]!);
      m.wr(0xff43, m.hram[0x42]!);
      if (m.rd(0xc440)) continue;
      break;
    }
    updateObjects(m);
  }

  /** 00:333C (00:1909) — re-place the map's objects (after flags changed) and redraw them. */
  *refreshNpcs(): Co {
    const m = this.m;
    m.wr(0xc467, m.hram[0x08]!);
    for (let a = 0xd000; a < 0xe000; a++) m.wr(a, m.rd(a) & 0x7f);
    let hl = m.rd(0xc459) | (m.rd(0xc45a) << 8);
    for (let d = 0x81; ; d++) {
      m.selectBank(0x07);
      if (d === 0x87) break;
      if (m.romAt(0x07, hl++) === 0xff) break;
    }
    const de = placeObjects(m, hl);
    for (let a = de; a < 0xc700; a += 0x10) m.wr(a, 0x80);
    refreshObjects(m);
    updateObjects(m);
    yield* fieldFrame(this.g);
    const [x, y] = playerCell(m);
    cellMark(m, x, y, true);
    m.selectBank(m.rd(0xc467));
  }

  /** 00:28A8 (00:1915) — rebuild the field after a battle or a full-screen menu. */
  *restoreField(): Co {
    const m = this.m, g = this.g;
    if (m.rd(0xc45c) | m.rd(0xc45d)) {
      readDestination(m, 0, 0xc45c, true);
      readHeader(m);
      m.wr(0xc45c, 0);
      m.wr(0xc45d, 0);
      clearNpcOam(m);
      loadAttributes(m, m.rd(0xc450));
      loadLayout(m, this.rom);
      yield* loadPlayerTiles(g);
      yield* loadObjects(g);
      placeVehicles(m);
      initPlayer(m);
      m.wr(0xc434, m.rd(0xcfe6));
      m.wr(0xc43a, m.rd(0xcfe7));
      m.wr(0xc43b, m.rd(0xcfe8));
      playerSpriteSource(m);
      if (m.rd(0xc452)) yield* loadObjectTiles(g);
      yield* loadPlayerTiles(g);
    } else {
      playerSpriteSource(m);
      if (m.rd(0xc452)) yield* loadObjectTiles(g);
      yield* loadPlayerTiles(g);
      loadLayout(m, this.rom);
    }
    m.wr(0xff47, 0);
    m.wr(0xff48, 0);
    m.wr(0xff49, 0);
    loadTileset(m, m.rd(0xc450));
    yield* drawView(g);
    refreshObjects(m);
    updateObjects(m);
    drawPlayer(m, m.rd(0xc436));
    const [x, y] = playerCell(m);
    cellMark(m, x, y, true);
    m.selectBank(0x03);
    yield* vramCopy(g, 0x03, 0x7f00, 0x8700, 0x100);
    yield* fadeIn(g);
  }
}

/** 00:29A3 — direction from FF89: 1 down, 2 up, 3 left, 4 right (first set from bit 7), 0 none. */
export function inputDir(ff89: number): number {
  for (let b = 4, a = ff89; b > 0; b--) {
    if (a & 0x80) return 5 - b;
    a = (a << 1) & 0xff;
  }
  return 0;
}

/** 00:3846 / 00:37F6 — one swirl tile, written during vblank (cost model as VblankWriter). */
/** Pacing of 00:3846 (one tile of the swirl): the tile is written only while LY is 0x90-0x97
 *  (the poll at 00:387C), so the spiral advances a few tiles per frame. Time is counted in
 *  T-cycles from the start of that window; an iteration that writes costs SWIRL_WRITE, one that
 *  skips the cell (other layer) SWIRL_SKIP — measured against PyBoy (about 7 writes per window;
 *  skipped cells about one per line, the VRAM-access STAT handler 16A8 firing on every line).
 *  The swirl starts a few lines into vblank, after the step that changed the layer. */
const SWIRL_WINDOW = 8 * 456, SWIRL_FRAME = 154 * 456, SWIRL_WRITE = 532, SWIRL_SKIP = 456;
class SwirlWriter {
  private t = 4 * 456;
  *tile(m: Memory, hl: number, d: number, b: number, c: number, second: boolean): Co {
    const x = (m.rd(0xc42c) + ((c << 24) >> 25)) & 0xff;
    const y = (m.rd(0xc42d) + ((b << 24) >> 25)) & 0xff;
    let v = offMap(x, y) ? 0 : cellGet(m, x, y);
    v &= 0x7f;
    if (v >= 0x40) v = m.rd(0xc500 + (v & 0x1f));
    const k = (m.rd(0xc43c) ^ v) & 0xff;
    let t: number;
    if (!second) {
      if (k >= 0x20) return yield* this.spend(SWIRL_SKIP);
      t = (k * 4 + d) & 0xff;
    } else {
      if (k < 0x20) return yield* this.spend(SWIRL_SKIP);
      const layer = m.rd(0xc43c);
      const s = ((((layer >> 4) | (layer << 4)) & 0xff) - 1) & 0xff;
      t = ((s === 1 ? 1 : 2) * 4 + d) & 0xff;
    }
    if (this.t >= SWIRL_WINDOW) {
      // wait for the next window
      yield;
      this.t = 0;
    }
    m.wr(hl, t);
    yield* this.spend(SWIRL_WRITE);
  }
  private *spend(n: number): Co {
    this.t += n;
    while (this.t >= SWIRL_FRAME) {
      yield;
      this.t -= SWIRL_FRAME;
    }
  }
}
