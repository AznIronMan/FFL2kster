/** Legend I field use of items and abilities (00:36E1; effects by the tables 00:3739 for items
 *  00-17 and 00:3769 for abilities 80-86, item record 06:7700 + 8 id: byte 0 bit 1 = usable in the
 *  field) and equipping (00:35A8: class bits 06:7700 byte 0 & 3C; armour adds power to Def,
 *  byte 5 gives +10 Str/Agl/Mana). Items that start an event or a warp leave the menu (00:3B4E:
 *  the stack is reset to the field loop). */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { rand, mul8, div16, vsync } from "../sys.js";
import { frame } from "../title.js";
import { nibble, setNibble, windowOff, windowTop } from "./load.js";
import { cell } from "./map.js";
import type { MainMenu } from "./menumain.js";
import { recordOffset } from "./menumain.js";

/** Thrown to leave the menu for the field (00:3B4E); slot = the used item's slot address. */
export class LeaveMenu extends Error {
  constructor(readonly slot: number) {
    super("leave menu");
  }
}

export class FieldItems {
  menu!: MainMenu;
  constructor(readonly g: Game) {}

  get m(): Memory {
    return this.g.m;
  }

  /** 00:36E1 — use item a (slot address `slot` for 00:3B4E): 0 = used, FF = not. */
  *use(a: number, slot: number): Co<number> {
    const g = this.g, m = this.m;
    g.selectBank(0x06);
    const de = (a * 8 + 0x7700) & 0xffff;
    if (!(m.rd(de) & 0x02)) return yield* this.cannot();
    let idx: number, table: number;
    if (a >= 0x80) {
      idx = a & 0x7f;
      if (idx >= 7) return yield* this.cannot();
      table = 0x3769;
    } else {
      idx = a;
      if (a >= 0x18) return yield* this.cannot();
      table = 0x3739;
    }
    const fn = m.rd16(table + 2 * idx);
    switch (fn) {
      case 0x3881: return yield* this.heal(de);
      case 0x38cf: return yield* this.cure(de);
      case 0x3929: return yield* this.status(de, false);
      case 0x394a: return yield* this.status(de, true);
      case 0x3974: return yield* this.restore(de);
      case 0x39aa: return yield* this.selfHeal();
      case 0x39bd: return yield* this.heart();
      case 0x39d9: return yield* this.statUp(de, 0x0b);
      case 0x39e0: return yield* this.statUp(de, 0x0d);
      case 0x3a1b: return yield* this.hpUp(de);
      case 0x3802: return yield* this.recharge();
      case 0x3777: return yield* this.teleport(slot);
      case 0x3a75: return yield* this.combine(de, a, slot);
      case 0x3a9e: return yield* this.sphere(a, 4, 2, slot);
      case 0x3aaa: return yield* this.sphere(a, 3, 3, slot);
      case 0x3ab6: return yield* this.sphere(a, 2, 4, slot);
      case 0x3b32: this.event(0xe9); throw new LeaveMenu(slot);
      case 0x3b3d:
        if (m.rd(0xccc7) !== 0xc4) return yield* this.cannot();
        this.event(0x21);
        throw new LeaveMenu(slot);
      default: throw new Error(`field item handler ${fn.toString(16)}`);
    }
  }

  /** 00:3718 — "can't use" window, wait; FF. */
  private *cannot(): Co<number> {
    const mn = this.menu;
    yield* mn.ui(0x0c, 0x32, 0xc60d);
    frame(this.g, 0xc600, 0x0a, 0x01);
    yield* mn.blit(0x9de8, 0x0c, 0x03);
    yield* mn.waitKey();
    return 0xff;
  }

  /** 00:3B29 with a = 0: text C3AA as an event (C3AB = 1). */
  private event(text: number): void {
    const m = this.m;
    m.wr(0xc3aa, text);
    m.wr(0xc3a9, 0);
    m.wr(0xc3ab, 1);
  }

  /** 00:3878 — the party window at 9C8B (00:2E86 with b, c = 04, 0C). */
  private *party(): Co {
    const mn = this.menu;
    mn.box(0x07, 0x08);
    yield* mn.memberSprites();
    yield* mn.ui(0x09, 0x02, 0xc60a, 0x04, 0x0c);
    yield* mn.blit(0x9c8b, 0x09, 0x0a);
  }

  /** 00:3843 — choose the target member (menu 3F81): FF or the record's flags & A0; FFCD =
   *  record offset; bank 06 selected. */
  private *target(): Co<number> {
    const m = this.m;
    yield* this.party();
    for (;;) {
      const a = yield* this.menu.menu(0x3f81, 0);
      if (a === 0xff) return 0xff;
      const off = recordOffset(a);
      m.hram[0x4d] = off;
      if (m.rd(0xcc00 | off) === 0xff) continue;
      const r = m.rd(0xcc00 | ((off + 0x0a) & 0xff)) & 0xa0;
      this.g.selectBank(0x06);
      return r;
    }
  }

  /** 00:386A — success sound, the party window again, wait; 0. */
  private *done(): Co<number> {
    this.m.hram[0x64] = 0x11;
    yield* this.party();
    yield* this.menu.waitKey();
    return 0;
  }

  /** 00:38B7 — HP of record hl = min(bc, max HP), then 00:386A. */
  private *setHp(hl: number, bc: number): Co<number> {
    const m = this.m;
    const max = m.rd16(hl + 8);
    m.wr16(hl + 6, max < bc ? max : bc);
    return yield* this.done();
  }

  /** 00:3881 — HP + power + rand(0..param). */
  private *heal(de: number): Co<number> {
    const m = this.m;
    if ((yield* this.target()) === 0xff) return 0xff;
    const hl = 0xcc00 | m.hram[0x4d]!;
    if (m.rd(hl) & 3) return yield* this.cannot();
    const r = rand(m, 0x38a0, 0, m.rd(de + 5));
    const bc = (m.rd(de + 4) + m.rd16(hl + 6) + r) & 0xffff;
    return yield* this.setHp(hl, bc);
  }

  /** 00:38CF — HP + rand(0..(power * mana)/4) + caster's mana + target's mana. */
  private *cure(de: number): Co<number> {
    const m = this.m;
    if ((yield* this.target()) === 0xff) return 0xff;
    const hl = 0xcc00 | m.hram[0x4d]!;
    if (m.rd(hl) & 3) return yield* this.cannot();
    const e = m.rd(de + 4);
    const c = m.rd(hl + 0x0e);
    const caster = m.rd(0xc5c8);
    const b = caster === 0xff ? c : m.rd(0xcc00 | ((caster + 0x0e) & 0xff));
    const [q] = div16(m, mul8(b, e), 4);
    const r = rand(m, 0x390e, 0, q & 0xff);
    let bc = (r + (q & 0xff) + b + c) & 0xffff;
    bc = (m.rd16(hl + 6) + bc) & 0xffff;
    return yield* this.setHp(hl, bc);
  }

  /** 00:3929 (cure: not for the dead) / 00:394A (revive: only the dead, HP 1): status &= power. */
  private *status(de: number, revive: boolean): Co<number> {
    const m = this.m;
    if ((yield* this.target()) === 0xff) return 0xff;
    const hl = 0xcc00 | m.hram[0x4d]!;
    const dead = (m.rd(hl) & 1) !== 0;
    if (dead !== revive) return yield* this.cannot();
    m.wr(hl, m.rd(de + 4) & m.rd(hl));
    if (revive) m.wr16(hl + 6, 1);
    return yield* this.done();
  }

  /** 00:3974 — status &= power, HP = max, abilities' uses restored (00:2FEE). */
  private *restore(de: number): Co<number> {
    const m = this.m;
    if ((yield* this.target()) === 0xff) return 0xff;
    const hl = 0xcc00 | m.hram[0x4d]!;
    if (m.rd(hl) & 1) return yield* this.cannot();
    m.wr(hl, m.rd(de + 4) & m.rd(hl));
    m.wr16(hl + 6, m.rd16(hl + 8));
    rechargeAbilities(this.g, hl + 0x0f);
    return yield* this.done();
  }

  /** 00:39AA — meant as "the user's HP = its max HP", but h is never loaded: it is still 0x39
   *  from the dispatch (jp hl to 39AA), so it reads two bytes of ROM page 0x39 and writes them to
   *  0x39xx, which on the MBC2 (address bit 8 set) are two ROM bank selects. Faithful: the party
   *  is unchanged and the bank is left switched (FF8B not updated). */
  private *selfHeal(): Co<number> {
    const m = this.m;
    let l = (m.rd(0xc5c8) + 8) & 0xff;
    const e = m.rd(0x3900 | l);
    l = (l + 1) & 0xff;
    const d = m.rd(0x3900 | l);
    l = (l - 3) & 0xff;
    m.wr(0x3900 | l, e);
    l = (l + 1) & 0xff;
    m.wr(0x3900 | l, d);
    return yield* this.done();
  }

  /** 00:39BD — record +0A low nibble + 1 (up to 7). */
  private *heart(): Co<number> {
    const m = this.m;
    if ((yield* this.target()) === 0xff) return 0xff;
    const hl = 0xcc00 | ((m.hram[0x4d]! + 0x0a) & 0xff);
    if ((m.rd(hl) & 0x0f) < 7) m.wr(hl, m.rd(hl) + 1);
    return yield* this.done();
  }

  /** 00:39E5 — stat (record + o) += power + rand(0..param) / stat (humans only). */
  private *statUp(de: number, o: number): Co<number> {
    const m = this.m;
    m.wr(0xc5ac, o);
    const r = yield* this.target();
    if (r === 0xff) return 0xff;
    if (!(r & 0x80)) return yield* this.cannot();
    const rec = 0xcc00 | m.hram[0x4d]!;
    if (m.rd(rec) & 3) return 0xff;
    const hl = 0xcc00 | ((m.hram[0x4d]! + o) & 0xff);
    const c = m.rd(hl);
    const b = rand(m, 0x3a0d, 0, m.rd(de + 5));
    const q = c ? Math.floor(b / c) & 0xff : 0;
    m.wr(hl, (q + m.rd(de + 4) + m.rd(hl)) & 0xff);
    return yield* this.done();
  }

  /** 00:3A1B — max HP + rand(0..param) + 5 below power * 10, else + 1 (humans only). */
  private *hpUp(de: number): Co<number> {
    const m = this.m;
    const r = yield* this.target();
    if (r === 0xff) return 0xff;
    if (!(r & 0x80)) return yield* this.cannot();
    const rec = 0xcc00 | m.hram[0x4d]!;
    if (m.rd(rec) & 3) return 0xff;
    const bc = mul8(m.rd(de + 4), 0x0a);
    const max = m.rd16(rec + 8);
    if (max < bc) {
      const add = (rand(m, 0x3a61, 0, m.rd(de + 5)) + 5) & 0xff;
      m.wr16(rec + 8, (max + add) & 0xffff);
    } else m.wr16(rec + 8, (max + 1) & 0xffff);
    return yield* this.done();
  }

  /** 00:3802 — a bag item's uses back to its default. */
  private *recharge(): Co<number> {
    const g = this.g, m = this.m, mn = this.menu;
    mn.box(0x0a, 0x10);
    yield* mn.itemList(0xcc7c, 0xc61a, 0x0c);
    yield* mn.blit(0x9c07, 0x0c, 0x12);
    const a = yield* mn.menu(0x3f29, 0);
    if (a === 0xff) return 0xff;
    const hl = 0xcc7c + ((a * 2) & 0xff);
    if (m.rd(hl + 1) === 0xff) return 0xff;
    g.selectBank(0x05);
    m.wr(hl + 1, m.rd((m.rd(hl) * 8 + 0x4647) & 0xffff));
    return 0;
  }

  /** 00:3777 — choose a floor (1 .. CCC5) and warp there (00:52D0 + 3 (floor - 1)) with the wave. */
  private *teleport(slot: number): Co<number> {
    const g = this.g, m = this.m, mn = this.menu;
    mn.box(0x08, 0x04);
    m.wr(0xc3da, 1);
    for (;;) {
      yield* mn.ui(0x0a, 0x30, 0xc615, 0x04, 0x0b);
      yield* mn.blit(0x9c8a, 0x0a, 0x06);
      for (;;) {
        let k: number;
        do { yield* vsync(g); m.wr(0xff46, 0xc0); k = this.joy(); } while (!k);
        if (k & 0x01) {
          if (m.rd(0xccc1)) return yield* this.cannot();
          const hl = 0x52d0 + (m.rd(0xc3da) - 1) * 3;
          m.wr(0xc5bf, hl & 0xff);
          m.wr(0xc5c0, hl >> 8);
          m.hram[0x64] = 0x15;
          m.wr(0xff40, 0xeb);
          windowOff(m);
          m.wr(0xff43, 0);
          m.wr(0xff42, 0);
          yield* this.wave();
          windowTop(m);
          m.wr(0xff40, 0xe3);
          throw new LeaveMenu(slot);
        }
        if (k & 0x02 || k === 0xff) return 0xff;
        if (k & 0x80) { const a = m.rd(0xc3da); if (a === 1) continue; m.wr(0xc3da, a - 1); break; }
        if (k & 0x40) { const a = m.rd(0xc3da); if (a === m.rd(0xccc5)) continue; m.wr(0xc3da, a + 1); break; }
      }
    }
  }
  private joy(): number {
    const { joyRepeat } = sysFns;
    return joyRepeat(this.m);
  }

  /** 00:3DF5 — the wave: 60 frames of per-line SCX offsets (table 00:122F.., 80 = wrap) through
   *  the STAT handler 00:3E8D (C39D), the frame tick called directly (00:0171). */
  *wave(): Co {
    const g = this.g, m = this.m;
    for (let k = 0; k < 0x90; k++) m.wr(0xc600 + k, 0);
    m.hram[0x4a] = 0x2f;
    m.hram[0x49] = m.rd(0xff43);
    g.ime = false;
    m.hram[0x47] = m.rd(0xc39e);
    m.wr(0xc39e, 0x8d);
    m.hram[0x48] = m.rd(0xc39f);
    m.wr(0xc39f, 0x3e);
    m.hram[0x46] = m.rd(0xff41);
    m.wr(0xff41, 0xc0);
    m.wr(0xff45, 0);
    g.ime = true;
    // parity: each round's start (00:3E35: FFCB = 0, the new table) and the end (00:3E7B) at the
    // original's times: its rounds take the CPU a frame or more (the table, the frame tick)
    const starts = g.onPointTimes?.(0x3e35), ends = g.onPointTimes?.(0x3e7b);
    if (starts && ends && g.traceFrame && g.lineTime) return yield* this.waveTimed(starts, ends);
    for (let a = 0x3c; a; a--) {
      m.hram[0x4c] = a >> 4;
      m.hram[0x4b] = 0;
      let l: number = m.hram[0x4a]!;
      for (let k = 0; k < 0x90; k++) {
        let c = m.rd(0x1200 | l);
        for (let s = m.hram[0x4c]!; s; s--) c = (c >> 1) | (c & 0x80);
        m.wr(0xc600 + k, (m.hram[0x49]! + c) & 0xff);
        l = (l + 1) & 0xff;
        if (m.rd(0x1200 | l) === 0x80) l = 0x2f;
      }
      sysFns.frameTick(g);
      yield; // LY polling until 0x90 (not a rst $10 wait)
      l = (m.hram[0x4a]! + 1) & 0xff;
      if (m.rd(0x1200 | l) === 0x80) l = 0x2f;
      m.hram[0x4a] = l;
    }
    g.ime = false;
    m.wr(0xc39e, m.hram[0x47]!);
    m.wr(0xc39f, m.hram[0x48]!);
    m.wr(0xff41, m.hram[0x46]!);
    g.ime = true;
  }

  /** The wave's rounds at the recorded times (parity): each round's FFCC, FFCB = 0 and its 144
   *  table bytes land on the line of its start (00:3E35; the STAT handler 00:3E8D reads them from
   *  there), the frame tick once a round, and the handlers back at the recorded end. */
  private *waveTimed(starts: [number, number][], ends: [number, number][]): Co {
    const g = this.g, m = this.m;
    const t = (p: [number, number]) => p[0] * 154 + p[1];
    const now = g.lineTime!(0) - 10; // the code runs in the vblank before this frame
    let i = starts.findIndex((p) => t(p) >= now);
    if (i < 0) i = starts.length;
    for (let a = 0x3c; a; a--, i++) {
      const p = starts[i] ?? [g.traceFrame!(), 0];
      const shift = a >> 4;
      let l: number = m.hram[0x4a]!;
      g.schedule(t(p), 0xffcc, shift);
      g.schedule(t(p), 0xffcb, 0);
      // a round whose stores came on drawn lines (its start ran past the poll's vblank) races
      // the beam: the STAT handler reads each line's byte; each store at its recorded line, the
      // rest at the vblank
      const race = g.onWaveStores?.(p[0], p[1]);
      for (let k = 0; k < 0x90; k++) {
        let c = m.rd(0x1200 | l);
        for (let s = shift; s; s--) c = (c >> 1) | (c & 0x80);
        const at = !race ? t(p) : race.f * 154 + (race.ly[k] ?? 0x8f) + 0.5;
        g.schedule(at, 0xc600 + k, (m.hram[0x49]! + c) & 0xff);
        l = (l + 1) & 0xff;
        if (m.rd(0x1200 | l) === 0x80) l = 0x2f;
      }
      sysFns.frameTick(g);
      while (g.traceFrame!() <= p[0]) yield; // LY polling until 0x90 (not a rst $10 wait)
      l = (m.hram[0x4a]! + 1) & 0xff;
      if (m.rd(0x1200 | l) === 0x80) l = 0x2f;
      m.hram[0x4a] = l;
    }
    const last = starts[i - 1] ?? [0, 0];
    const e = ends.find((p) => t(p) > t(last)) ?? [g.traceFrame!(), 0];
    g.schedule(t(e), 0xc39e, m.hram[0x47]!);
    g.schedule(t(e), 0xc39f, m.hram[0x48]!);
    g.schedule(t(e), 0xff41, m.hram[0x46]!);
    while (g.traceFrame!() <= e[0]) yield;
  }

  /** 00:3A75 — needs item `power` (removed, and once more); progress A = 2, 5 = 6; event 1F. */
  private *combine(de: number, id: number, slot: number): Co<number> {
    const m = this.m;
    const c = m.rd(de + 4);
    let hl = findItem(m, c);
    if (hl.nz) return yield* this.cannot();
    m.wr(hl.hl, 0xff); m.wr(hl.hl + 1, 0xff);
    hl = findItem(m, id);
    m.wr(hl.hl, 0xff); m.wr(hl.hl + 1, 0xff);
    setNibble(m, 0x0a, 2);
    setNibble(m, 0x05, 6);
    this.event(0x1f);
    throw new LeaveMenu(slot);
  }

  /** 00:3AC0 — on map 4F facing cell 7: progress C5AC = C5AD, the item removed (or unequipped);
   *  progress 1 + 1; at 3: progress A = 1 and event 1F. */
  private *sphere(id: number, n: number, v: number, slot: number): Co<number> {
    const m = this.m, f = this.menu.field;
    m.wr(0xc5ac, n);
    m.wr(0xc5ad, v);
    if (m.rd(0xccc7) !== 0x4f) return yield* this.cannot();
    const [e, d] = f.front();
    if (cell(m, e, d)[1] !== 7) return yield* this.cannot();
    setNibble(m, n, v);
    const hl = findItem(m, id).hl;
    const user = m.rd(0xc5c8);
    if (user === 0xff) { m.wr(hl, 0xff); m.wr(hl + 1, 0xff); }
    else {
      m.hram[0x4d] = user;
      m.wr(0xc5ce, hl & 0xff);
      m.wr(0xcccb, 0xff);
      m.wr(0xcccc, 0xff);
      m.wr(0xc5cd, 0xcb);
      equip(this.g);
    }
    const k = nibble(m, 1);
    if (k === 3) return 0xff;
    setNibble(m, 1, k + 1);
    if (k + 1 !== 3) return 0xff;
    setNibble(m, 0x0a, 1);
    this.event(0x1f);
    throw new LeaveMenu(slot);
  }
}

/** 00:36BA — item c in the bag, then the members' items: { hl, nz: not found }. */
export function findItem(m: Memory, c: number): { hl: number; nz: boolean } {
  let hl = 0xcc7c;
  for (let b = 8; b; b--, hl += 2) if (m.rd(hl) === c) return { hl, nz: false };
  hl = 0xcc0f;
  for (let e = 4; e; e--) {
    for (let b = 8; b; b--, hl += 2) if (m.rd(hl) === c) return { hl, nz: false };
    hl = 0xcc00 | ((hl + 0x0f) & 0xff);
  }
  return { hl, nz: true };
}

/** 00:2FEE — abilities (id >= 80) of 8 items at hl get their default uses (05:4647 + 8 id). */
export function rechargeAbilities(g: Game, hl: number): void {
  const m = g.m;
  for (let c = 8; c; c--, hl += 2) {
    const a = m.rd(hl);
    if (!(a & 0x80)) continue;
    if (m.rd(hl + 1) === 0xff) continue;
    g.selectBank(0x05);
    m.wr(hl + 1, m.rd((a * 8 + 0x4647) & 0xffff));
  }
}

/** 00:36A7 — class bits of item a (06:7700 + 8a, byte 0 & 3C); leaves bank 06. */
function classBits(g: Game, a: number): { hl: number; v: number } {
  g.selectBank(0x06);
  const hl = (a * 8 + 0x7700) & 0xffff;
  return { hl, v: g.m.rd(hl) & 0x3c };
}

/** 00:35A8 — swap slot C5CE (the member's) with C5CD (bag / FE: none), when the member (FFCD)
 *  can equip (flags & A0), the new item's class is not already worn; Def / stat bonuses moved. */
export function equip(g: Game): void {
  const m = g.m;
  const cd = m.hram[0x4d]!;
  if (!(m.rd(0xcc00 | ((cd + 0x0a) & 0xff)) & 0xa0)) return;
  const dst = 0xcc00 | m.rd(0xc5cd), src = 0xcc00 | m.rd(0xc5ce);
  check: if (m.rd(dst + 1) !== 0xff) {
    const c = classBits(g, m.rd(dst)).v;
    if (!c) break check;
    if (m.rd(src + 1) !== 0xff && classBits(g, m.rd(src)).v === c) break check;
    let hl = 0xcc00 | ((cd + 0x10) & 0xff);
    for (let b = 8; b; b--, hl += 2) {
      if (m.rd(hl) === 0xff) continue;
      const v = classBits(g, m.rd(hl - 1)).v;
      if (v && (v & c)) return;
    }
  }
  bonus(g, m.rd(0xc5ce), -1);
  bonus(g, m.rd(0xc5cd), 1);
  for (let k = 0; k < 2; k++) {
    const c = m.rd(src + k);
    m.wr(src + k, m.rd(dst + k));
    m.wr(dst + k, c);
  }
}

/** 00:35F3 / 00:3614 — the bonuses of the item in slot l (00:364C Def += power for classed
 *  items; 00:366C byte 5: 1 Str, 2 Agl, 3 Mana +10, 4+ Str and Agl +10; not with byte 0 bit 6). */
function bonus(g: Game, l: number, sign: number): void {
  const m = g.m;
  const cd = m.hram[0x4d]!;
  const slot = 0xcc00 | l;
  if (m.rd(slot + 1) === 0xff) return;
  const cb = classBits(g, m.rd(slot));
  if (!cb.v) return;
  const c = m.rd(cb.hl + 4);
  const def = 0xcc00 | ((cd + 0x0c) & 0xff);
  m.wr(def, (m.rd(def) + sign * c) & 0xff);
  if (!c) return;
  const it = classBits(g, m.rd(slot));
  if (m.rd(it.hl) & 0x40) return;
  const p = m.rd(it.hl + 5);
  let hl = 0xcc00 | ((cd + 0x0b) & 0xff), n = 0;
  if (p === 0) return;
  if (p === 1) n = 0x0a;
  else if (p === 2) { hl += 2; n = 0x0a; }
  else if (p === 3) { hl += 3; n = 0x0a; }
  else {
    m.wr(hl, (m.rd(hl) + sign * 0x0a) & 0xff);
    hl += 2;
    n = 0x0a;
  }
  m.wr(hl, (m.rd(hl) + sign * n) & 0xff);
}

import * as sysFns0 from "../sys.js";
import { frameTick } from "../irq.js";
const sysFns = { joyRepeat: sysFns0.joyRepeat, frameTick };
