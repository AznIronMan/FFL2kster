/** Legend I field event commands (00:16E0 dispatch, C3A9 & 0F): 0-2 dialogue (00:1B35), 3 chest
 *  (00:1996), 4 facility (00:1992), 5/6 warp (00:1AF8), 7 music/sound (00:1AC7), 8 battle
 *  (00:1BBE), 9 (00:1752), A (00:1A2E), B (00:1B7C), C vehicle (00:17F0), D (00:1AE6), E object
 *  moves (00:18AE), F special (00:1726). */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import type { FieldEngine } from "./loop.js";
import type { Dialogue } from "./dialogue.js";
import { objectTable, objectSprites, flagBit, setFlagBit, loadAttributes, drawScreen, loadPlayerTiles, playerSprites,
  playerTiles, setSpeed, palettesOff, palettesOn } from "./load.js";
import { cell, attrOf } from "./map.js";
import { vsync, oamDma, rand, copy } from "../sys.js";

export class NotPortedEvent extends Error {
  constructor(what: string) {
    super(`not ported yet: ${what}`);
  }
}

export interface EventCalls {
  /** 00:1BBE battle with area C3AA. */
  battle(g: Game): Co;
  /** 00:300E facility C3AA (inn, house of life, guild, shops). */
  facility(g: Game): Co;
  /** 00:1A2E — an item C3AA for the bag (a full bag asks what to drop). */
  giveItem(g: Game): Co;
}

export class Events {
  readonly coverage: Record<string, number> = {};
  constructor(readonly g: Game, readonly field: FieldEngine, readonly dialogue: Dialogue, readonly calls: EventCalls) {}

  get m(): Memory {
    return this.g.m;
  }

  /** 00:16E0 — the pending event (C3AB set), then 00:1AB8. */
  *run(): Co {
    const m = this.m;
    if (!m.rd(0xc3ab)) return;
    m.wr(0xc5d0, m.hram[0x0b]!);
    m.wr(0xc5b1, 0);
    const cmd = m.rd(0xc3a9) & 0x0f;
    const k = cmd.toString(16);
    this.coverage[k] = (this.coverage[k] ?? 0) + 1;
    this.keep = false;
    yield* this.command(cmd);
    if (!this.keep) this.field.eventEnd();
  }

  private *command(cmd: number): Co {
    const m = this.m;
    switch (cmd) {
      case 0: case 1: case 2: return yield* this.talk();
      case 3: return yield* this.chest();
      case 4: // 00:1992 — call 300E; ret (no 1AB8: C5BD/C5BE and the bank stay)
        this.keep = true;
        return yield* this.calls.facility(this.g);
      case 5: case 6: return yield* this.warp();
      case 7: return this.sound();
      case 8: return yield* this.calls.battle(this.g);
      case 9: return yield* this.say();
      case 0x0a: return yield* this.calls.giveItem(this.g);
      case 0x0b: return yield* this.park();
      case 0x0c: return yield* this.vehicle();
      case 0x0d: return yield* this.warpRelative();
      case 0x0e: return yield* this.moves();
      case 0x0f: return yield* this.special();
      default: throw new NotPortedEvent(`event command ${cmd.toString(16)} (C3AA ${m.rd(0xc3aa).toString(16)})`);
    }
  }

  /** 00:1B35 — face the object, open the window, text C3A9 * 256 + C3AA, wait, close. */
  private *talk(): Co {
    const m = this.m;
    this.face();
    yield* this.dialogue.open();
    yield* this.dialogue.text((m.rd(0xc3a9) << 8) | m.rd(0xc3aa));
    yield* this.dialogue.waitKey();
    this.dialogue.close();
  }

  /** 00:1752 — command 9: turn the object (hiding sprites if the window is open), text C3AA. */
  private *say(): Co {
    const m = this.m;
    if (this.face() && m.rd(0xc5ca)) this.dialogue.hideSprites();
    yield* this.dialogue.text(m.rd(0xc3aa));
  }

  /** 00:1996 — command 3: chest (event bit C3AB) with item C3AA, into a free bag slot. */
  private *chest(): Co {
    const g = this.g, m = this.m, dl = this.dialogue;
    if (flagBit(m, m.rd(0xc3ab))) return;
    yield* dl.open();
    let bc = 0xcc7d;
    for (let e = 8; e; e--, bc += 2) {
      if (m.rd(bc) !== 0xff) continue;
      m.hram[0x64] = 0x17;
      const hl = (m.rd(0xc5bd) + 4) & 0xff | (m.rd(0xc5be) << 8);
      const a = m.rd(hl);
      const sw = ((a << 4) | (a >> 4)) & 0xfc | 1;
      m.wr(hl, ((sw << 4) | (sw >> 4)) & 0xff);
      objectTable(m);
      objectSprites(m);
      dl.hideSprites();
      yield* vsync(g);
      oamDma(m);
      const id = m.rd(0xc3aa);
      m.wr(bc - 1, id);
      g.selectBank(0x05);
      m.wr(bc, m.rd((id * 8 + 0x4640 + 7) & 0xffff));
      yield* dl.show(0x1c11);
      g.selectBank(0x05);
      let de = 0xc700, src = (id * 8 + 0x4640) & 0xffff;
      m.wr(de++, 0x0c);
      let k = 7;
      for (; k; k--) {
        const c = m.rd(src++);
        m.wr(de, c);
        if (!c) break;
        de++;
      }
      if (!k) m.wr(de, 0);
      yield* dl.showWait(0xc700);
      dl.close();
      setFlagBit(m, m.rd(0xc3ab), 1);
      return;
    }
    yield* dl.showWait(0x1c22);
    dl.close();
  }

  /** 00:1B7C — command B: vehicle slot C3AA >> 6 parked at warp 0x50 + (C3A9 >> 4)'s place
   *  (CC99 + 4 (slot - 1): map, row, column, C3AA & 1F); attributes and screen redone. */
  private *park(): Co {
    const g = this.g, m = this.m;
    const de = 0xcc99 + ((((m.rd(0xc3aa) >> 6) - 1) * 4) & 0xff);
    const n = (m.rd(0xc3a9) >> 4) + 0x50;
    const hl = 0x52d0 + n * 3;
    g.selectBank(0x02);
    m.wr(de, m.rd(hl));
    m.wr(de + 1, m.rd(hl + 2));
    m.wr(de + 2, m.rd(hl + 1));
    m.wr(de + 3, m.rd(0xc3aa) & 0x1f);
    loadAttributes(g, m.rd(0xc5c9));
    yield* drawScreen(g);
  }

  /** 00:17F0 — command C: board vehicle C3AA >> 6 (the cell gets C3AA & 1F back) or, with 0,
   *  leave it in front of the player (it is parked on the player's cell, 1F, which then steps). */
  private *vehicle(): Co {
    const g = this.g, m = this.m, f = this.field;
    const p = m.rd(0xc3aa);
    if (p & 0xc0) {
      const [addr] = cell(m, m.rd(0xccc8), m.rd(0xccc9));
      if (addr !== null) m.wr(addr, p & 0x1f);
      m.wr(0xccc1, p >> 6);
      setSpeed(m);
      yield* drawScreen(g);
      yield* loadPlayerTiles(g);
      playerSprites(g);
      return;
    }
    const [e, d] = f.front();
    if (f.objectAt(e, d) !== null) return;
    if (e >= 0x3e || d >= 0x40) return;
    const [ae, ad] = attrOf(m, cell(m, e, d)[1]);
    if (ae & 0xe0) return;
    if (ad & 1) return;
    const mode = m.rd(0xccc1);
    let hl = 0xcc00 | ((((mode - 1) * 4) + 0x99) & 0xff);
    m.wr(hl++, m.rd(0xccc7));
    m.wr(hl++, m.rd(0xccc8));
    m.wr(hl++, m.rd(0xccc9));
    const [addr, v] = cell(m, m.rd(0xccc8), m.rd(0xccc9));
    m.wr(hl, v);
    m.wr(0xdfbf, (addr !== null ? m.rd(addr) : v) | (((mode << 6) | (mode >> 2)) & 0xff));
    m.wr(0xdfbe, 0x8c);
    if (addr !== null) m.wr(addr, 0x1f);
    m.wr(0xccc1, 0);
    setSpeed(m);
    const dir = m.rd(0xc5b7);
    yield* drawScreen(g);
    yield* loadPlayerTiles(g);
    playerSprites(g);
    let t = 0x245e, c = 0x80, b = 4;
    for (let a = dir; a; a--) { t += 2; b--; c >>= 1; }
    f.tryStep(t, b, c);
    yield* f.step();
  }

  /** 00:1AE6 — command D: warp FFF8/FFF9 + C3AA (the map's own warp base). */
  private *warpRelative(): Co {
    const m = this.m, f = this.field;
    const hl = ((m.hram[0x79]! << 8) | m.hram[0x78]!) + m.rd(0xc3aa);
    f.setWarp((hl >> 8) & 0xff, hl & 0xff);
    yield* f.warp();
  }

  /** 00:18AE — command E: object C3A9 >> 4 (F: the player) turns to C3AA bits 6-7 (00:1C34)
   *  and walks C3AA & 0F steps. Waits (event kept) while the object is not on screen. */
  private *moves(): Co {
    const g = this.g, m = this.m, f = this.field;
    const c = m.rd(0xc3a9) >> 4;
    const p = m.rd(0xc3aa);
    const dir = m.rd(0x1c34 + (p >> 6));
    if (c === 0x0f) {
      const n = p & 0x0f;
      if (!n) {
        m.wr(0xc5b7, dir);
        playerTiles(m);
        yield* vsync(g);
        oamDma(m);
        return;
      }
      let t = 0x1978 + ((p >> 6) << 2);
      for (let k = n; k; k--) {
        f.tryStep(m.rd16(t + 2), m.rd(t + 1), m.rd(t));
        yield* f.step();
      }
      return;
    }
    if (m.rd(0xc5b0)) yield* this.npcSettle();
    let ent = 0xc52c, b = 8;
    for (; b; b--, ent += 6) if (m.rd(ent) === c) break;
    if (!b) { this.keep = true; return; }
    m.wr(0xc5ac, ent & 0xff);
    const n = p & 0x0f;
    const obj = (0xc55c + ((m.rd(ent) * 5) & 0xff)) & 0xffff;
    if (!n) {
      const hl = obj + 4;
      const a = m.rd(hl);
      const sw = ((a << 4) | (a >> 4)) & 0xfc | dir;
      m.wr(hl, ((sw << 4) | (sw >> 4)) & 0xff);
      objectTable(m);
      objectSprites(m);
      yield* vsync(g);
      oamDma(m);
      return;
    }
    for (let k = n; k; k--) {
      f.npcMove(obj, dir, b);
      yield* this.npcSettle();
    }
  }
  /** Set by 00:18D4: the event stays pending (no 00:1AB8). */
  keep = false;

  /** 00:1988 — frames until the moving object has finished its step. */
  private *npcSettle(): Co {
    do yield* this.field.frame();
    while (this.m.rd(0xc5b0));
  }

  /** 00:1726 — command F: 0 quake, 1 shake, 3 cells D947/D987 = 1D, 4 C5BA = 0, 5 text speed 0A,
   *  6 the end (hangs). */
  private *special(): Co {
    const g = this.g, m = this.m;
    switch (m.rd(0xc3aa)) {
      case 0: return yield* this.quake();
      case 1: return yield* this.shake();
      case 3:
        m.wr(0xd947, 0x1d);
        m.wr(0xd987, 0x1d);
        return yield* drawScreen(g);
      case 4: m.wr(0xc5ba, 0); return;
      case 5: m.wr(0xccca, 0x0a); return;
      case 6: for (;;) yield* vsync(g);
      default: return;
    }
  }

  /** 00:31BA — b frames with OAM DMA. */
  private *frames(b: number): Co {
    for (let k = b || 256; k; k--) { yield* vsync(this.g); oamDma(this.m); }
  }

  /** 00:1779 — four flashes (palettes off 5 frames, on 2). */
  *quake(): Co {
    for (let a = 4; a; a--) {
      palettesOff(this.m);
      yield* this.frames(5);
      palettesOn(this.m);
      yield* this.frames(2);
    }
  }

  /** 00:1793 — the screen shakes by the offsets at 00:17E7 (random signs), 3 frames each. */
  *shake(): Co {
    const m = this.m;
    m.hram[0x4e] = m.rd(0xff43);
    m.hram[0x4f] = m.rd(0xff42);
    for (let hl = 0x17e7; ; hl++) {
      let a = m.rd(hl);
      if (!a) break;
      const v = a;
      let c = rand(m, 0x17ab, 0, 1) === 1 ? v : v ^ 0xff;
      let b = rand(m, 0x17ba, 0, 1) === 1 ? c : c ^ 0xff;
      m.wr(0xff42, (m.hram[0x4f]! + c) & 0xff);
      m.wr(0xff43, (m.hram[0x4e]! + b) & 0xff);
      yield* this.frames(3);
    }
    m.wr(0xff43, m.hram[0x4e]!);
    m.wr(0xff42, m.hram[0x4f]!);
  }

  /** 00:1B4F — turn the object at C5BD/C5BE toward the player (direction from 00:1C30 by
   *  C5B7) unless its flags have bit 3; returns true when turned. (With no object the address is
   *  0004, as the original reads it.) */
  face(): boolean {
    const m = this.m;
    const e = m.rd(0x1c30 + m.rd(0xc5b7));
    const l = (m.rd(0xc5bd) + 4) & 0xff, h = m.rd(0xc5be);
    if (!(h | l)) return false;
    const hl = (h << 8) | l;
    const a = m.rd(hl);
    if (a & 0x08) return false;
    const s = ((a << 4) | (a >> 4)) & 0xfc | e;
    m.wr(hl, ((s << 4) | (s >> 4)) & 0xff);
    objectTable(m);
    objectSprites(m);
    return true;
  }

  /** 00:1AF8 — warp C3AA (command 5) or 256 + C3AA (6); 6 with FF returns to the previous map
   *  and position. Ignored right after a map change (C5BA). */
  private *warp(): Co {
    const m = this.m, f = this.field;
    if (m.rd(0xc5ba)) return;
    const e = (m.rd(0xc3a9) & 1) ^ 1;
    const d = m.rd(0xc3aa);
    if (d === 0xff && e === 1) {
      m.wr(0xc5b7, 0);
      m.wr(0xccc9, m.rd(0xccc4));
      m.wr(0xccc8, m.rd(0xccc3));
      m.wr(0xccc7, m.rd(0xccc2));
      yield* f.loadMap(m.rd(0xccc2));
      return;
    }
    f.setWarp(e, d);
    yield* f.warp();
  }

  /** 00:1AC7 — C3AA: music (FFE0), 40+: FFE2, 80+: sound effect (FFE4). */
  private sound(): void {
    const m = this.m;
    const a = m.rd(0xc3aa);
    if (a & 0x80) m.hram[0x64] = a - 0x80;
    else if (a & 0x40) m.hram[0x62] = a - 0x40;
    else m.hram[0x60] = a;
  }
}
