/** Legend I battle (bank 06, 06:4000-5E24): the battle loop, the battle entities (31 records of
 *  32 bytes at D000: 0-3 party, 4-30 monsters), the action list D3EF (31 entries of 4 bytes:
 *  item/slot, target, target flags, actor), the effect handlers (table 06:403A, 49 entries),
 *  rewards and growth. Battle screens, menus and pictures (06:5E27-63F7 and bank 07) are in
 *  battle/ui.ts. Ported over a shared register set (battle/regs.ts): the original passes
 *  results in registers and flags between these routines throughout.
 *
 *  HRAM: FFB0 actor, FFB1 target, FFB2 action item, FFB3 the target's own action item, FFB4/5
 *  value (damage/heal), FFB6-FFBA scratch, FFBB hits counter, FFBC escape state, FFBD area,
 *  FFBE/FFBF the action entry being executed. */
import type { Game, Co } from "../game.js";
import type { Memory } from "../memory.js";
import { sub16, scaleRand, mul8, rand as rand16B } from "../sys.js";
import { adcDaa, sbcDaa } from "../bcd.js";
import { Regs } from "./regs.js";
import type { BattleUi } from "./ui.js";

/** 06:5CEB — the battle ends: SP from D4AB, back to 00:1BF4. */
export class BattleExit extends Error {
  constructor() { super("battle exit"); }
}

/** Effect handlers by table index (06:403A). */
const HANDLERS = [
  0x44b0, 0x44bc, 0x44e4, 0x450c, 0x451b, 0x453c, 0x4570, 0x4725, 0x476b, 0x477f, 0x4806, 0x486a,
  0x48cd, 0x4909, 0x4966, 0x49af, 0x49d2, 0x4a53, 0x4aa5, 0x4ab1, 0x4afc, 0x4b13, 0x4b1f, 0x4b43,
  0x4b66, 0x4b7e, 0x4be0, 0x4c41, 0x4c7e, 0x4cb3, 0x4d21, 0x4db9, 0x4e19, 0x4e5d, 0x4e69, 0x4eaa,
  0x4eed, 0x4f55, 0x4f69, 0x4f8e, 0x4fe7, 0x5001, 0x5017, 0x502a, 0x503b, 0x506a, 0x5077, 0x5098,
  0x50b7,
];

export class Battle {
  readonly r = new Regs();
  readonly coverage: Record<string, number> = {};
  ui!: BattleUi;

  constructor(readonly g: Game) {}

  get m(): Memory {
    return this.g.m;
  }
  /** HRAM FFxx. */
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
  rd16(a: number): number {
    return this.m.rd(a) | (this.m.rd(a + 1) << 8);
  }
  rom(a: number): number {
    return this.m.rd(a); // bank 06 is selected throughout the battle
  }

  // ---------------------------------------------------------------- the battle loop

  /** SP at 06:4009 (saved to D4AB/D4AC): CFFC from the field loop's event (00:16E0). */
  sp = 0xcffc;

  /** 06:4000 -> 4006 — the battle. */
  *run(): Co {
    const r = this.r;
    try {
      this.clearEntities();          // 565E
      // 4009 ld [d4ab],sp: the exit point (06:5CEB). The field loop (00:1243) -> 00:16E0 ->
      // 00:1BBE -> 06:4000 leaves SP at CFFC here; deeper when the battle comes from an event
      // inside a text (`sp`, set by the caller).
      this.wr(0xd4ab, this.sp & 0xff);
      this.wr(0xd4ac, this.sp >> 8);
      this.vectors();                // 5D90
      this.loadParty();              // 556A
      this.loadMonsters();           // 56AD
      this.groups();                 // 5513
      yield* this.ui.intro();        // 5E00
      for (;;) {
        this.groups();               // 401B
        do {
          yield* this.checkEnd();    // 5240
          yield* this.statusWindow(); // 5BD4
          yield* this.surprise();    // 5CF9
          yield* this.runAway();     // 5A8A
          yield* this.commands();    // 5ACC
        } while (r.cf);
        this.monsterActions();       // 582B
        this.turnOrder();            // 59AC
        yield* this.executeAll();    // 409C
      }
    } catch (e) {
      if (!(e instanceof BattleExit)) throw e;
    }
  }

  /** 06:409C — every action entry in turn order, then 06:50F1. */
  *executeAll(): Co {
    const r = this.r;
    let hl = 0xd3ef;
    for (let c = 0x1f; c; c--) {
      r.hl = hl;
      yield* this.execute();
      hl += 4;
    }
    yield* this.afterTurnCo();
  }

  // ---------------------------------------------------------------- small helpers (06:40B2-4316)

  /** 06:40B2 */
  *msgF10(): Co {
    yield* this.msg(0x0f);
    yield* this.msg(0x10);
  }
  /** 06:40BC — "miss". */
  *miss(): Co {
    yield* this.msg(0x0b);
  }
  /** 06:40C1 */
  *msg0C(): Co {
    yield* this.msg(0x0c);
  }
  /** 06:40C6 — a = target +0B (resistances). */
  targetResist(): number {
    return this.ent(this.hr(0xffb1), 0x0b);
  }
  /** 06:40CC — a = actor +0A. */
  actorDef(): number {
    return this.ent(this.hr(0xffb0), 0x0a);
  }
  /** 06:40D2 — swap actor and target (FFB0 <-> FFB1). */
  swapActor(): void {
    const a = this.hr(0xffb0);
    this.hw(0xffb0, this.hr(0xffb1));
    this.hw(0xffb1, a);
  }
  /** 06:40DF — a = field 4 of the action item FFB2 (power). */
  power(): number {
    this.r.a = this.item(this.hr(0xffb2), 4);
    return this.r.a;
  }
  /** 06:40E4 — a = field 5 of the action item FFB2 (parameter). */
  param(): number {
    this.r.a = this.item(this.hr(0xffb2), 5);
    return this.r.a;
  }
  /** 06:40EE — a = field 4 of item a. */
  itemPower(a: number): number {
    this.r.a = this.item(a, 4);
    return this.r.a;
  }
  /** 06:40F3 — a = field 5 of item a. */
  itemParam(a: number): number {
    this.r.a = this.item(a, 5);
    return this.r.a;
  }
  /** 06:40F8 — a = the target's status (+02); hl at it. */
  targetStatus(): number {
    return this.ent(this.hr(0xffb1), 2);
  }
  /** 06:40FC — a = the actor's status (+02); hl at it. */
  actorStatus(): number {
    return this.ent(this.hr(0xffb0), 2);
  }
  /** 06:4102 — z when FFBB = 0 (the first target of the action). */
  first(): boolean {
    this.r.a = this.hr(0xffbb);
    this.r.zf = this.r.a === 0;
    this.r.cf = false;
    return this.r.zf;
  }
  /** 06:4107 — the actor's uses left of the action item FFB2 (+07 after the slot), 0 when not
   *  carried. */
  usesOf(): number {
    const r = this.r;
    let hl = 0xd000 + this.hr(0xffb0) * 32 + 0x0e;
    const d = this.hr(0xffb2);
    for (let e = 8; e; e--) {
      const a = this.rd(hl++);
      if (a === d) {
        r.a = this.rd(hl + 7);
        return r.a;
      }
    }
    r.a = 0;
    return 0;
  }
  /** 06:412C — FFB4/5 = hl. */
  setValue(hl = this.r.hl): void {
    this.hw(0xffb4, hl & 0xff);
    this.hw(0xffb5, hl >> 8);
  }
  /** 06:4135 — de = FFB4/5. */
  getValue(): number {
    this.r.de = this.hr(0xffb4) | (this.hr(0xffb5) << 8);
    return this.r.de;
  }
  /** 06:413E — FFB4/5 = a. */
  setValueA(a = this.r.a): void {
    this.hw(0xffb4, a);
    this.hw(0xffb5, 0);
  }
  /** 06:4144 — FFB4/5 = hl, the damage message, then 06:414A. */
  *damage(): Co {
    this.setValue();
    yield* this.damageMsg();
    this.r.de = this.r.hl;
    yield* this.applyToTarget();
  }
  /** 06:414A — de = hl, then 06:4151. */
  *applyHl(): Co {
    this.r.de = this.r.hl;
    yield* this.applyToTarget();
  }
  /** 06:414E — de = FFB4/5, then 06:4151. */
  *applyValue(): Co {
    this.getValue();
    yield* this.applyToTarget();
  }
  /** 06:4151 — negate de and add it to the target's HP (06:416B). */
  *applyToTarget(): Co {
    this.neg();
    this.r.a = this.hr(0xffb1);
    yield* this.addHp();
  }
  /** 06:4159 — D4B3/4 = hl. */
  keepHl(): void {
    this.wr(0xd4b3, this.r.l);
    this.wr(0xd4b4, this.r.h);
  }
  /** 06:4162 — de = D4B3/4. */
  keptDe(): number {
    this.r.de = this.rd(0xd4b3) | (this.rd(0xd4b4) << 8);
    return this.r.de;
  }
  /** 06:416B — add de (signed) to the HP of entity a, within 0..max HP: D4AE/F = de; a party
   *  member's damage first triggers 06:42B9 (sound) and 06:5E1E (the hit effect). */
  *addHp(): Co {
    const r = this.r;
    const ent = r.a;
    this.wr(0xd4ae, r.e);
    this.wr(0xd4af, r.d);
    if (ent < 4 && (r.d & 0x80)) {
      this.hitSound();          // 42B9
      this.nextHit();           // 42A5
      yield* this.ui.hitEffect(); // 5E1E
    }
    const de = r.de, bc = r.bc;
    // 4184: hl at +03 (HP), bc = HP
    let hl = 0xd000 + ent * 32 + 3;
    r.a = this.rd(hl);
    let v = this.rd16(hl);
    this.wr(0xd4b0, v & 0xff);
    this.wr(0xd4b1, v >> 8);
    v = (v + de) & 0xffff;
    if (v & 0x8000) v = 0;
    else {
      r.a = this.rd(0xd4b1); // 41A8: a = the old HP's high byte (00:07B5 stores it in FF88)
      const max = this.rd16(hl + 2);
      // 41A8: 5DF3 = compare bc (new HP) with de (max): carry when HP < max (or max = 0)
      const cmp = this.cmpBcDe(v, max);
      if (!cmp) {
        // capped: D4AE/F = max - old HP (the amount actually added)
        const old = this.rd16(0xd4b0);
        const add = (max + ((0x10000 - old) & 0xffff)) & 0xffff;
        this.wr(0xd4ae, add & 0xff);
        this.wr(0xd4af, add >> 8);
        r.de = max;
        v = max;
      }
    }
    this.wr(hl, v & 0xff);
    this.wr(hl + 1, v >> 8);
    r.hl = hl;
    r.bc = bc;
    r.de = de;
  }
  /** 06:5DF3 — compare bc with de (00:0168 on hl = bc): carry when bc < de, or de = 0. */
  cmpBcDe(bc: number, de: number): boolean {
    const s = sub16(this.m, this.r.a, bc, de);
    this.r.cf = s.carry;
    this.r.zf = s.zero;
    return s.carry;
  }
  /** 06:41CB — FFB4/5 = D4AE/F (the amount applied). */
  appliedToValue(): void {
    this.hw(0xffb4, this.rd(0xd4ae));
    this.hw(0xffb5, this.rd(0xd4af));
  }
  /** 06:41D6 — after damage at hl (the HP word): HP 0 (or negative) makes the target dead: HP 0,
   *  status bit 0; a monster's death is counted (D4AA) with its "defeated" message; carry when
   *  it died. Then 06:4219 (redraw). */
  *checkDeath(): Co {
    const r = this.r;
    const hl = r.hl;
    const hi = this.rd(hl + 1);
    if (!(hi & 0x80) && (hi | this.rd(hl))) {
      r.cf = false;
      yield* this.redraw();
      return;
    }
    this.wr(hl, 0);
    this.wr(hl + 1, 0);
    const st = hl - 1;
    this.wr(st, this.rd(st) | 1);
    // 41EA: compare hl (status address) with D080: carry for a party member
    const s = sub16(this.m, 0, st, 0xd080);
    if (s.carry || (this.rd(0xd4b6) & 1)) {
      // 41F9: the entity number from the address, its "falls" message
      let a = ((st - 2) & 0x0fff) >> 5;
      const b0 = this.hr(0xffb0);
      this.hw(0xffb0, a & 0xff);
      yield* this.msg(0x11);
      this.hw(0xffb0, b0);
    }
    this.wr(0xd4aa, this.rd(0xd4aa) + 1);
    r.cf = true;
    r.hl = hl;
    yield* this.redraw();
    r.cf = true;
  }
  /** 06:4219 — 06:5BDB (groups + redraw) then 06:5BE8 (the HP window). */
  *redraw(): Co {
    const cf = this.r.cf;
    yield* this.redrawGroups();
    yield* this.hpWindow();
    this.r.cf = cf;
  }
  /** 06:421F — the actor's "attacks" messages (09, 0A) for the first target. */
  *attacks(): Co {
    const a = this.r.a;
    if (this.first()) {
      yield* this.msg(0x09);
      yield* this.msg(0x0a);
    }
    this.r.a = a;
  }
  /** 06:4231 — the damage message: "no damage" (0C) when FFB4/5 = 0, else 17 then 0D; the
   *  attack effect (rst $30) for the first target. */
  *damageMsg(): Co {
    const a = this.r.a, de = this.r.de;
    if ((this.hr(0xffb4) | this.hr(0xffb5)) === 0) yield* this.msg(0x0c);
    else {
      yield* this.msg(0x17);
      yield* this.msg0D();
    }
    if (this.first()) yield* this.effect();
    this.r.de = de;
    this.r.a = a;
  }
  /** 06:4255 */
  *msg0D(): Co {
    yield* this.msg(0x0d);
  }
  /** 06:425A */
  *msg01(): Co {
    yield* this.msg(0x01);
  }
  /** 06:425F — messages 09, 18 for the first target. */
  *uses(): Co {
    const a = this.r.a;
    if (this.first()) {
      yield* this.msg(0x09);
      yield* this.msg(0x18);
    }
    this.r.a = a;
  }
  /** 06:4271 — message 1D, the effect. */
  *msg1D(): Co {
    yield* this.msg(0x1d);
    yield* this.effect();
  }
  /** 06:4278 — messages 0F, 33, then 06:4282. */
  *msgF33(): Co {
    yield* this.msg(0x0f);
    yield* this.msg(0x33);
    yield* this.noEffect();
  }
  /** 06:4282 — "no effect" (22). */
  *noEffect(): Co {
    yield* this.msg(0x22);
  }
  /** 06:4287 — for the first target: next hit, then 06:428E. */
  *firstUses(): Co {
    if (!this.first()) return;
    this.nextHit();
    yield* this.usesItem();
  }
  /** 06:428E — message 01, then 19. */
  *usesItem(): Co {
    yield* this.msg01();
    yield* this.msg(0x19);
  }
  /** 06:4296 (rst $30) — the attack effect: for the first target the sound (42B9) and the
   *  picture effect (42D5); FFBB + 1. */
  *effect(): Co {
    const a = this.r.a;
    const z = this.first();
    if (z) {
      this.hitSound();
      // 42B9 leaves z (jp 7F7C restores af): 42D5 runs too
      yield* this.effectAnim();
    }
    this.nextHit();
    this.r.a = a;
  }
  /** 06:42A5 — FFBB + 1. */
  nextHit(): void {
    this.hw(0xffbb, this.hr(0xffbb) + 1);
  }
  /** 06:42AC — clear the per-action counters: D4AA, FFBB, D4B6, D4BE. */
  resetAction(): void {
    this.r.a = 0;
    this.wr(0xd4aa, 0);
    this.hw(0xffbb, 0);
    this.wr(0xd4b6, 0);
    this.wr(0xd4be, 0);
  }
  /** 06:42B9 — the action item's sound (field 7): bit 6 set -> FFE2 (sound effect, & 3F), else
   *  FFE4 (& 7F). */
  hitSound(): void {
    const s = this.r.save();
    let a = this.item(this.hr(0xffb2), 7) & 0x7f;
    if (a & 0x40) this.hw(0xffe2, a & 0x3f);
    else this.hw(0xffe4, a);
    this.r.restore(s);
  }
  /** 06:42D5 — the action item's picture effect (field 6) via 06:5E06 (07:6E03). */
  *effectAnim(): Co {
    const s = this.r.save();
    const a = this.item(this.hr(0xffb2), 6);
    yield* this.ui.effect(a);
    this.r.restore(s);
  }
  /** 06:42E6 — FFB3 = the target's own chosen action item (FF if it has no action entry). */
  targetAction(): void {
    const s = this.r.save();
    const t = this.hr(0xffb1);
    let hl = 0xd3f2, a = 0xff;
    let found = false;
    for (let c = 0x1f; c; c--) {
      if (this.rd(hl) === t) { found = true; break; }
      hl += 4;
    }
    if (found) {
      hl -= 3;
      const b = this.rd(hl);
      if (t < 4) a = this.ent(t, (b + 0x0e) & 0xff);
      else a = this.rd(hl);
    }
    this.hw(0xffb3, a);
    this.r.restore(s);
  }

  // ---------------------------------------------------------------- entity access

  /** rst $38 (06:7F80) — hl = D000 + a * 32 + l, a = [hl]. */
  ent(a: number, l: number): number {
    const r = this.r;
    r.hl = (0xd000 + (a & 0xff) * 32 + (l & 0xff)) & 0xffff;
    r.a = this.rd(r.hl);
    return r.a;
  }
  /** 06:5BF2 — field e of item a (8-byte records at 06:7700). */
  item(a: number, e: number): number {
    return this.rom(0x7700 + (a & 0xff) * 8 + (e & 0xff));
  }
  /** 06:5C61 — 06:5C63 for monster a (entity a + 4). */
  monster(a: number): boolean {
    return this.entity((a + 4) & 0xff);
  }
  /** 06:5C63 — hl = entity a; a = its status (+02); z when the slot is empty (FF). */
  entity(a: number): boolean {
    const r = this.r;
    this.ent(a, 0);
    r.a = this.rd(r.hl + 2);
    r.cp(0xff);
    return r.zf;
  }
  /** 06:7F72 — de = -de. */
  neg(): void {
    this.r.de = (0x10000 - this.r.de) & 0xffff;
  }
  /** 06:7F70 — signed compare hl with de: carry when hl < de. (Mixed signs: carry from the sign;
   *  for hl >= 0 > de, zero from a as `and a` leaves it.) */
  cmpSigned(): void {
    const r = this.r;
    const hn = r.h & 0x80, dn = r.d & 0x80;
    if (hn && !dn) { r.cf = true; r.zf = false; return; }
    if (!hn && dn) { r.cf = false; r.zf = r.a === 0; return; }
    const s = sub16(this.m, r.a, r.hl, r.de);
    r.cf = s.carry;
    r.zf = s.zero;
  }
  /** 06:7F74 — signed compare hl with 1 (carry: hl <= 0). */
  cmpOne(): void {
    this.r.de = 1;
    this.cmpSigned();
  }
  /** 06:5CE2 — random 0..100 (06:5E24). */
  rand100(): number {
    const de = this.r.de;
    this.r.e = 0x64;
    const a = this.rnd(0, 0x64);
    this.r.de = de;
    return a;
  }
  /** 06:5CF5 — random 0..e. */
  randE(e = this.r.e): number {
    return this.rnd(0, e);
  }
  /** 06:5E24 -> 5EB7 — the battle RNG: the counter at CA00 + FFB2 (the action item) indexes
   *  the table CB00; scaled to [a, e] (00:07EC). */
  rnd(lo: number, hi: number): number {
    const ix = 0xca00 + this.hr(0xffb2);
    const c = (this.rd(ix) + 1) & 0xff;
    this.wr(ix, c);
    const a = scaleRand(this.rd(0xcb00 + c), lo & 0xff, hi & 0xff);
    this.r.a = a;
    return a;
  }

  // ---------------------------------------------------------------- one action (06:4316)

  /** 06:4316 — execute the action entry at hl. */
  *execute(): Co {
    const r = this.r;
    const entry = r.hl;
    this.hw(0xffbe, entry & 0xff);
    this.hw(0xffbf, entry >> 8);
    const actor = this.rd(entry + 3);
    this.hw(0xffb0, actor);
    this.wr(0xd4b9, actor);
    if (this.entity(actor)) return;
    let st = r.a;
    if (st & 1 || st & 2) return;
    if (st & 0x80) return yield* this.wakeUp(actor, 0xfd, 0x05, 0x4d, 0x7f); // 44E4
    if (st & 0x40) return yield* this.wakeUp(actor, 0xfe, 0x03, 0x4c, 0xbf); // 44BC
    if (st & 0x20) {
      if (this.rand100() >= 0x0a) {
        yield* this.msg(0x47);
      } else {
        yield* this.msg(0x4a);
        this.actorStatus();
        this.wr(r.hl, this.rd(r.hl) & ~0x20);
        return;
      }
    }
    // 435F
    let hl = entry;
    if (actor >= 4) {
      if (this.hr(0xffbc) === 2) return;
      this.hw(0xffb2, this.rd(hl));
    } else {
      const slot = this.rd(hl);
      if (slot === 0xff) return yield* this.nothing();
      if (slot >= 0xfd) this.hw(0xffb2, slot);
      else {
        r.hl = hl;
        r.e = actor;
        if (this.retarget()) return; // 5B8F: carry -> no target left
        this.entity(actor);
        r.hl = (r.hl + slot + 0x0e) & 0xffff;
        const id = this.rd(r.hl);
        this.hw(0xffb2, id);
        const bc = r.hl;
        const u = bc + 8;
        const n = this.rd(u);
        if (n !== 0xfe) {
          this.wr(u, n - 1);
          if (((n - 1) & 0xff) === 0 && !(this.rd(bc) & 0x80)) this.wr(u, 0xff);
        }
      }
    }
    // 43AA
    hl = entry + 1;
    const flags = this.rd(entry + 2);
    if (flags & 0x06) return yield* this.allParty();  // 446B
    if (flags & 0x20) return yield* this.allMonsters(); // 4439
    if (flags & 0x40) return yield* this.group(hl);  // 43EF
    this.hw(0xffbb, 0);
    this.wr(0xd4b6, 1);
    const t = this.rd(hl);
    this.hw(0xffb1, t);
    if (this.targetStatus() & 3) return;
    r.a = t;
    yield* this.perform(false);
    yield* this.checkEnd();
  }

  /** 06:44BC / 06:44E4 — a paralysed (bit 6, message 03) / asleep (bit 7, message 05) actor:
   *  message 01, then the chance (item FE / FD power) to recover (4C / 4D). */
  *wakeUp(actor: number, it: number, stay: number, msgOk: number, mask: number): Co {
    const r = this.r;
    const k = it === 0xfd ? "44e4" : "44bc";
    this.coverage[k] = (this.coverage[k] ?? 0) + 1;
    this.hw(0xffb0, actor);
    yield* this.msg(0x01);
    const c = this.itemPower(it);
    if (this.rand100() >= c) return yield* this.msg(stay);
    yield* this.msg(msgOk);
    this.ent(actor, 2);
    this.wr(r.hl, r.a & mask);
  }

  /** 06:43EF — every monster of the target's group. */
  *group(hl: number): Co {
    const r = this.r;
    this.resetAction();
    const t = this.rd(hl);
    const d = this.ent(t, 0x1f);
    for (let a = 4; a !== 0x1f; a++) {
      this.hw(0xffb1, a);
      if (this.targetStatus() & 3) continue;
      if (this.ent(a, 0x1f) !== d) continue;
      r.a = a;
      if (yield* this.perform(true)) return yield* this.checkEndAfterAll();
      this.nextHit();
      yield* this.checkEnd();
    }
    yield* this.defeated();
    this.resetAction();
  }

  /** 06:4439 — every monster. */
  *allMonsters(): Co {
    const r = this.r;
    this.resetAction();
    for (let a = 4; a !== 0x1f; a++) {
      this.hw(0xffb1, a);
      if (this.targetStatus() & 3) continue;
      r.a = a;
      if (yield* this.perform(true)) return yield* this.checkEndAfterAll();
      this.nextHit();
    }
    yield* this.defeated();
    if (this.rd(0xd4be)) yield* this.msg(0x3f);
    this.resetAction();
    yield* this.checkEnd();
  }

  /** 06:446B — every party member. */
  *allParty(): Co {
    const r = this.r;
    this.resetAction();
    for (let a = 0; a !== 4; a++) {
      this.hw(0xffb1, a);
      if (this.targetStatus() & 3) continue;
      r.a = a;
      if (yield* this.perform(true)) return yield* this.checkEndAfterAll();
      this.nextHit();
      yield* this.checkEnd();
    }
    this.hw(0xffbb, 0);
  }

  /** 06:43E6 — an all-target handler (23, 27) met in a target loop: the loop is left, the
   *  handler runs once (06:449C), then 06:5240. */
  *checkEndAfterAll(): Co {
    yield* this.checkEnd();
  }

  /** 06:4423 — after an all/group action: the "defeated" count message (20). */
  *defeated(): Co {
    if (this.rd(0xd4b6) & 1) return;
    const n = this.rd(0xd4aa);
    if (n) {
      this.setValueA(n);
      yield* this.msg(0x20);
    }
  }

  /** 06:448F — target a: FFB3, then the handler of FFB2 (06:449C). In a target loop, handlers
   *  23 and 27 (06:43DD) leave the loop: returns true after running them once. */
  *perform(inLoop: boolean): Co<boolean> {
    const r = this.r;
    this.targetAction();
    const h = this.item(this.hr(0xffb2), 2);
    if (h === 0x27 || h === 0x23) {
      if (!inLoop) throw new Error(`06:43DD: handler ${h.toString(16)} outside a target loop`);
      yield* this.dispatch(h);
      return true;
    }
    yield* this.dispatch(h);
    return false;
  }

  /** 06:449C — the effect handler a (table 06:403A); FFB2 = FF -> 06:44B0. */
  *dispatch(h: number): Co {
    const r = this.r;
    const addr = HANDLERS[h];
    if (addr === undefined) throw new Error(`battle handler ${h.toString(16)}`);
    r.a = this.hr(0xffb2);
    if (r.a === 0xff) return yield* this.nothing();
    const k = addr.toString(16);
    this.coverage[k] = (this.coverage[k] ?? 0) + 1;
    yield* this.handler(addr);
  }

  /** 06:44B0 — "nothing happens" (14) for the first target. */
  *nothing(): Co {
    this.coverage["44b0"] = (this.coverage["44b0"] ?? 0) + 1;
    if (!this.first()) return;
    this.nextHit();
    yield* this.msg(0x14);
  }

  // ---------------------------------------------------------------- effect handlers

  /** The handler at addr (entered with jp hl: hl = de = addr, a = FFB2). */
  *handler(addr: number): Co {
    const r = this.r;
    r.hl = addr;
    r.de = addr;
    r.a = this.hr(0xffb2);
    switch (addr) {
      case 0x44b0: return yield* this.nothing();
      case 0x44bc: case 0x44e4: throw new Error(`handler ${addr.toString(16)} (status entry) as an action`);
      case 0x450c: // 03 — guard
        if (!this.first()) return;
        yield* this.msg(0x01);
        yield* this.effect();
        return yield* this.msg(0x06);
      case 0x451b: { // 04 — the target's resistances |= power
        const a = r.a;
        if (this.first()) {
          yield* this.msg(0x01);
          yield* this.msg(0x06);
          yield* this.msg(0x07);
          yield* this.effect();
        }
        r.c = this.itemPower(a);
        this.targetResist();
        this.wr(r.hl, r.logic(r.a | r.c));
        return;
      }
      case 0x453c: // 05
        if (!this.first()) return;
        yield* this.msg(0x01);
        return yield* this.msg(0x08);
      case 0x4570: // 06 — weapon attack
        yield* this.attacks();
        return yield* this.weapon();
      case 0x4725: // 07 — weapon with a chance to kill (param vs +0C)
        yield* this.attacks();
        if (this.paramVsArmor()) return yield* this.weapon();
        return yield* this.kill();
      case 0x476b: { // 08 — kill chance when param & target +01
        yield* this.attacks();
        const a = r.a;
        r.c = this.ent(this.hr(0xffb1), 1);
        this.itemParam(a);
        if (!(r.a & r.c)) return yield* this.weapon();
        return yield* this.kill();
      }
      case 0x477f: return yield* this.drain();
      case 0x4806: // 0A — heal
        yield* this.usesItem();
        this.healValue();
        r.a = this.hr(0xffb1);
        yield* this.addHp();
        this.appliedToValue();
        return yield* this.msg1D();
      case 0x486a: return yield* this.h486A();
      case 0x48cd: return yield* this.h48CD();
      case 0x4909: return yield* this.h4909();
      case 0x4966: return yield* this.h4966();
      case 0x49af: return yield* this.h49AF();
      case 0x49d2: return yield* this.h49D2();
      case 0x4a53: return yield* this.h4A53();
      case 0x4aa5: // 12
        if (yield* this.hitParam(r.a)) return;
        this.targetDef();
        if (yield* this.magic()) { /* 4A4A returned early */ }
        return yield* this.checkDeath();
      case 0x4ab1: return yield* this.h4AB1();
      case 0x4afc: return yield* this.h4AFC();
      case 0x4b13: // 15
        if (yield* this.hitParam(r.a)) return;
        this.powerValue();
        yield* this.damage();
        return yield* this.checkDeath();
      case 0x4b1f: return yield* this.h4B1F();
      case 0x4b43: return yield* this.h4B43();
      case 0x4b66: { // 18 — heal power + rand
        yield* this.usesItem();
        this.powerValue();
        r.de = r.hl;
        if (!(r.e | r.d)) return yield* this.noEffect();
        r.a = this.hr(0xffb1);
        yield* this.addHp();
        this.appliedToValue();
        return yield* this.msg1D();
      }
      case 0x4b7e: { // 19 — cure: status &= power
        yield* this.usesItem();
        r.c = this.power();
        r.a = this.hr(0xffb1);
        this.targetStatus();
        r.e = r.a;
        this.wr(r.hl, r.logic(r.a & r.c));
        yield* this.effect();
        return yield* this.statusChange();
      }
      case 0x4be0: return yield* this.h4BE0();
      case 0x4c41: return yield* this.h4C41();
      case 0x4c7e: return yield* this.h4C7E();
      case 0x4cb3: return yield* this.h4CB3();
      case 0x4d21: return yield* this.h4D21();
      case 0x4db9: return yield* this.h4DB9();
      case 0x4e19: return yield* this.h4E19();
      case 0x4e5d: // 21
        if (!this.first()) return;
        yield* this.msg01();
        return yield* this.msg(0x19);
      case 0x4e69: return yield* this.h4E69();
      case 0x4eaa: return yield* this.h4EAA();
      case 0x4eed: return yield* this.h4EED();
      case 0x4f55: { // 25 — the actor's HP = max HP
        const b = this.ent(this.hr(0xffb0), 5);
        const c = this.rd(r.hl + 1);
        this.wr(r.hl - 1, c);
        this.wr(r.hl - 2, b);
        r.b = b; r.c = c; r.hl = r.hl - 2;
        yield* this.msg(0x42);
        return yield* this.effect();
      }
      case 0x4f69: return yield* this.h4F69();
      case 0x4f8e: return yield* this.h4F8E();
      case 0x4fe7: { // 28 — target +08 += power
        yield* this.firstUses();
        this.powerAndDef();
        this.wr(r.hl, r.a = (r.a + r.b) & 0xff);
        yield* this.msg(0x28);
        yield* this.msg(0x2b);
        return yield* this.effect();
      }
      case 0x5001: { // 29 — the actor's +07 = power
        if (yield* this.selfOnly()) return;
        this.ent(this.hr(0xffb0), 7);
        const hl = r.hl;
        this.power();
        this.wr(hl, r.a);
        this.setValueA();
        yield* this.msg(0x25);
        yield* this.msg(0x2b);
        return yield* this.effect();
      }
      case 0x5017: { // 2A — the target's +08 = power
        if (yield* this.selfOnly()) return;
        this.powerAndDef();
        this.wr(r.hl, r.b);
        yield* this.msg(0x28);
        yield* this.msg(0x2b);
        return yield* this.effect();
      }
      case 0x502a: // 2B
        yield* this.effect();
        this.targetDef();
        this.powerParam();
        r.a = r.c;
        this.sub7F64(r.a);
        this.defending();
        return yield* this.applyIfPositive();
      case 0x503b: return yield* this.h503B();
      case 0x506a: // 2D
        if (!this.first()) return;
        yield* this.attacks();
        yield* this.effect();
        return yield* this.msg(0x22);
      case 0x5077: { // 2E — +09 += power (max 99)
        if (!this.first()) return;
        r.c = this.power();
        this.hw(0xffb1, this.hr(0xffb0));
        let a = this.ent(this.hr(0xffb0), 9) + r.c;
        if (a >= 0x63) a = 0x63;
        this.wr(r.hl, r.a = a & 0xff);
        yield* this.msg01();
        yield* this.msg(0x1b);
        return yield* this.effect();
      }
      case 0x5098: { // 2F — flee item
        r.c = 1;
        if (this.rd(0xd3e6) === 0) {
          r.c = 0xff;
          yield* this.msg(0x4f);
          yield* this.effect();
        } else yield* this.msg(0x11);
        this.ent(this.hr(0xffb0), 2);
        this.wr(r.hl, r.c);
        return;
      }
      case 0x50b7: return yield* this.h50B7();
    }
    throw new Error(`battle handler ${addr.toString(16)} not ported`);
  }

  /** 06:454A — entity a's +09 (agility), halved unless its status bit 3. */
  agility(a: number): number {
    const r = this.r;
    let v = this.ent(a, 9);
    r.hl = (r.hl - 7) & 0xffff;
    if (!(this.rd(r.hl) & 0x08)) v >>= 1;
    r.a = v;
    return v;
  }
  /** 06:4558 — carry when the target has its own action (FFB3 != FF); then a = that item's
   *  field 1 and z = !(bit 0). */
  targetAct(): boolean {
    const r = this.r;
    r.a = this.hr(0xffb3);
    if (r.a === 0xff) { r.cf = false; r.zf = false; return false; }
    r.a = this.item(r.a, 1);
    r.zf = !(r.a & 1);
    r.cf = true;
    return true;
  }
  /** 06:4569 — a = field 5 of FFB3. */
  targetActParam(): number {
    this.r.a = this.item(this.hr(0xffb3), 5);
    return this.r.a;
  }

  /** 06:4573 — a weapon attack on the target. */
  *weapon(): Co {
    const r = this.r;
    this.hw(0xffb6, this.agility(this.hr(0xffb1)));
    r.a = this.agility(this.hr(0xffb0));
    this.hw(0xffb7, r.a);
    r.c = r.a;
    if (this.targetAct() && !r.zf) {
      r.b = r.a;
      this.hw(0xffb6, this.hr(0xffb6) + r.b);
    }
    let a = this.hr(0xffb6) - r.c;
    if (a < 0) a = 0;
    this.hw(0xffb8, a);
    r.c = a & 0xff;
    if (this.rand100() < r.c) return yield* this.miss();
    this.targetDef();
    this.hw(0xffb6, r.c);
    this.strength();
    this.hw(0xffb7, r.c);
    r.l = r.c >> 2;
    r.h = this.power();
    r.hl = mul8(r.h, r.l);
    r.e = r.l >> 1;
    this.add7F62(this.hr(0xffb7));
    this.add7F62(this.randE());
    this.sub7F64(this.hr(0xffb6));
    if (this.targetAct() && !r.zf) this.halve();
    const hl = r.hl;
    this.targetResist();
    r.hl = hl;
    if (r.a & 0x40) this.halve();
    if ((r.h & 0x80) || !(r.h | r.l)) {
      yield* this.msg(0x0c);
      if (this.hr(0xffb3) === 0xff) return;
      return yield* this.counter();
    }
    yield* this.applyHlDamage();     // 505D
    yield* this.damageMsg();
    yield* this.checkDeath();
    if (r.cf) return;
    yield* this.reaction();
  }

  /** 06:45FC — the target's reaction by its action item (field 1 bits 1, 2, 4). */
  *reaction(): Co {
    const r = this.r;
    if (!this.targetAct()) return;
    if (r.a & 0x02) return yield* this.reflect();
    if (r.a & 0x04) return yield* this.inflict();
    if (r.a & 0x10) return yield* this.spikes();
  }

  /** 06:460E — damage doubled back at the actor. */
  *reflect(): Co {
    const r = this.r;
    const v = ((this.hr(0xffb4) | (this.hr(0xffb5) << 8)) << 1) & 0xffff;
    r.de = v;
    this.neg();
    yield* this.msgF10();
    r.hl = v;
    this.setValue();
    yield* this.msg01();
    yield* this.msg(0x15);
    this.swapActor();
    yield* this.effect();
    yield* this.applyValue();
    yield* this.checkDeath();
    this.swapActor();
  }

  /** 06:4636 — a counter when the attack did nothing. */
  *counter(): Co {
    const r = this.r;
    if (!this.targetAct()) return;
    if (!(r.a & 0x02)) return;
    this.entity(this.hr(0xffb1));
    r.c = r.a;
    r.hl = r.hl + 7;
    r.a = this.rd(r.hl);
    if (r.c & 0x04) r.a >>= 1;
    r.e = r.a; r.d = 0;
    this.setValueA();
    this.neg();
    r.a = this.hr(0xffb0);
    yield* this.addHp();
    yield* this.msgF10();
    yield* this.msg01();
    yield* this.msg(0x15);
    this.swapActor();
    yield* this.effect();
    this.swapActor();
    yield* this.checkDeath();
  }

  /** 06:4671 — the target's item inflicts a status on the actor. */
  *inflict(): Co {
    const r = this.r;
    r.c = this.targetActParam();
    if (this.ent(this.hr(0xffb0), 0x0b) & r.c) return yield* this.noEffect();
    if (this.ent(this.hr(0xffb0), 0x0c) & r.c) {
      this.actorDef();
      r.e = this.rd(r.hl); r.d = 0;
      const de = (0x32 + r.e) & 0xffff;
      r.a = (~this.ent(this.hr(0xffb1), 0x0a)) & 0xff;
      r.hl = (((0xff00 | r.a) + 1) + de) & 0xffff;
      r.de = de;
    } else r.hl = 0;
    r.e = this.rand100(); r.d = 0;
    this.cmpSigned();
    if (r.zf || !r.cf) return;
    this.actorStatus();
    r.e = r.a;
    const old = r.a;
    this.itemPower(this.hr(0xffb3));
    this.wr(r.hl, r.logic(r.a | old));
    yield* this.msg12_13();
    yield* this.statusMsgs();
    this.swapActor();
    yield* this.effect();
    this.swapActor();
  }
  /** 06:46C8 */
  *msg12_13(): Co {
    const a = this.r.a;
    yield* this.msg(0x12);
    yield* this.msg(0x13);
    this.r.a = a;
  }

  /** 06:46D5 — the target's item damages the actor. */
  *spikes(): Co {
    const r = this.r;
    r.d = this.hr(0xffb3);
    r.c = this.itemParam(r.d);
    if (this.ent(this.hr(0xffb0), 0x0b) & r.c) return yield* this.noEffect();
    r.d = this.itemPower(this.hr(0xffb3));
    if (this.ent(this.hr(0xffb0), 0x0c) & r.c) r.a = r.d;
    else { r.e = r.d; this.randE(); }
    r.e = r.a; r.d = 0;
    this.neg();
    this.setValueA();
    r.a = this.hr(0xffb0);
    yield* this.addHp();
    yield* this.msg12_13();
    yield* this.msg(0x15);
    yield* this.checkDeath();
    this.swapActor();
    yield* this.effect();
    this.swapActor();
  }

  /** 06:471A — z when the action's param & the target's +0C is 0. */
  paramVsArmor(): boolean {
    const r = this.r;
    r.c = this.param();
    r.a = this.ent(this.hr(0xffb1), 0x0c) & r.c;
    r.zf = r.a === 0;
    return r.zf;
  }

  /** 06:472E — instant kill (31%), else strength damage. */
  *kill(): Co {
    const r = this.r;
    if (this.rand100() < 0x1f) {
      this.targetStatus();
      this.wr(r.hl, this.rd(r.hl) | 1);
      yield* this.msg(0x16);
      yield* this.msg(0x0f);
      return yield* this.msg(0x34);
    }
    this.strength();
    r.b = r.c >> 2;
    r.h = this.power();
    r.l = r.b;
    r.hl = mul8(r.h, r.l);
    r.b = 0;
    r.e = r.l >> 1;
    r.hl = (r.hl + r.bc) & 0xffff;
    this.add7F62(this.randE());
    yield* this.damage();
    yield* this.checkDeath();
  }

  /** 06:477F — drain. */
  *drain(): Co {
    const r = this.r;
    yield* this.attacks();
    r.c = this.param();
    if (this.ent(this.hr(0xffb1), 1) & r.c) return yield* this.noEffect();
    if (yield* this.hitAgility()) return;
    r.c = this.actorDef();
    r.b = r.c >> 2;
    r.l = this.power();
    r.h = r.b;
    r.hl = mul8(r.h, r.l);
    const prod = r.hl;
    this.add7F62(r.c);
    r.de = prod;
    let a = this.randE();
    r.e = a >> 1; r.d = 0;
    r.hl = (r.hl + r.de) & 0xffff;
    r.de = r.hl;
    this.hw(0xffb4, r.e);
    this.hw(0xffb5, r.d);
    r.hl = 0xffb4;
    yield* this.msg(0x1c);
    yield* this.effect();
    r.a = this.hr(0xffb0);
    yield* this.addHp();
    yield* this.applyToTarget();
    yield* this.checkDeath();
    if (!r.cf) return;
    yield* this.reaction();
  }

  /** 06:47D2 — a heal value from the actor's and the target's +0A and the power: FFB4/5 and de. */
  healValue(): void {
    const r = this.r;
    this.ent(this.hr(0xffb1), 0x0a);
    r.c = this.rd(r.hl);
    this.actorDef();
    r.b = this.rd(r.hl);
    r.l = r.b >> 2;
    r.h = this.power();
    r.hl = mul8(r.h, r.l);
    r.e = r.l >> 1;
    this.randBC();
    this.add7F62(r.a);
    this.setValue();
    r.de = r.hl;
  }
  /** 06:47F7 — hl += random 0..e. */
  addRand(): void {
    this.add7F62(this.randE());
  }
  /** 06:47FD — hl += random 0..e, hl += b; a = c. */
  randBC(): void {
    this.addRand();
    this.add7F62(this.r.b);
    this.r.a = this.r.c;
  }

  /** 06:4814 — b = the target's agility (halved by its +01 bit 3), then 06:4823. */
  agilities(): void {
    const r = this.r;
    r.b = this.ent(this.hr(0xffb1), 9);
    r.hl = r.hl - 8;
    r.a = this.rd(r.hl);
    if (this.rd(r.hl) & 0x08) r.b >>= 1;
    this.actorAgility();
  }
  /** 06:4823 — c = the actor's agility (halved by its status bit 3). */
  actorAgility(): void {
    const r = this.r;
    r.c = this.ent(this.hr(0xffb0), 9);
    r.hl = r.hl - 7;
    r.a = this.rd(r.hl);
    if (this.rd(r.hl) & 0x08) r.c >>= 1;
  }
  /** 06:4835 — a = max(0, target agility (+ its action's param when field 1 bit 0) - actor
   *  agility). */
  evade(): number {
    const r = this.r;
    this.agilities();
    if (this.targetAct() && !r.zf) {
      r.b = (this.targetActParam() + r.b) & 0xff;
    }
    let a = r.b - r.c;
    r.cf = a < 0;
    r.a = a < 0 ? 0 : a;
    return r.a;
  }
  /** 06:4849 — the evade roll: true (the caller returns) after "miss". */
  *hitAgility(): Co<boolean> {
    const r = this.r;
    r.c = this.evade();
    if (this.rand100() >= r.c) return false;
    yield* this.miss();
    return true;
  }
  /** 06:4858 — c = the target's +08 (defence), halved by its status bit 2. */
  targetDef(): void {
    const r = this.r;
    r.c = this.ent(this.hr(0xffb1), 8);
    r.hl = r.hl - 6;
    r.a = this.rd(r.hl);
    if (this.rd(r.hl) & 0x04) r.c >>= 1;
  }

  /** 06:486A — 0B */
  *h486A(): Co {
    const r = this.r;
    yield* this.attacks();
    if (yield* this.hitAgility()) return;
    this.targetDef();
    r.b = this.ent(this.hr(0xffb0), 9);
    r.hl = r.hl - 7;
    r.a = this.rd(r.hl);
    if (r.a & 0x08) r.b >>= 1;
    r.l = r.b >> 2;
    r.h = this.power();
    r.hl = mul8(r.h, r.l);
    r.e = r.l >> 1;
    this.randBC();
    this.sub7F64(r.a);
    if (this.targetAct()) {
      if (!r.zf) this.halve();
      const hl = r.hl;
      this.targetResist();
      r.hl = hl;
      if (r.a & 0x40) this.halve();
    }
    this.setValue();
    this.cmpOne();
    if (r.cf) {
      yield* this.msg0C();
      return yield* this.counter();
    }
    yield* this.applyValue();
    yield* this.damageMsg();
    yield* this.checkDeath();
    yield* this.reaction();
  }

  /** 06:48C5 — halve hl when the target's own action has field 1 bit 0. */
  defending(): void {
    if (!this.targetAct()) return;
    if (!this.r.zf) this.halve();
  }

  /** 06:48CD — 0C */
  *h48CD(): Co {
    const r = this.r;
    yield* this.attacks();
    if (yield* this.hitAgility()) return;
    this.targetDef();
    this.actorDef();
    r.b = this.rd(r.hl);
    this.power();
    r.l = r.b >> 2;
    r.h = r.a;
    r.hl = mul8(r.h, r.l);
    r.e = r.l >> 1;
    this.randBC();
    this.setValue();
    this.sub7F64(r.a);
    this.defending();
    this.cmpOne();
    if (r.cf) {
      yield* this.msg0C();
      return yield* this.counter();
    }
    yield* this.damage();
    yield* this.checkDeath();
    yield* this.reaction();
  }

  /** 06:4909 — 0D */
  *h4909(): Co {
    const r = this.r;
    const a0 = r.a;
    yield* this.attacks();
    r.c = this.itemPower(r.a);
    this.itemParam(a0);
    r.e = r.a;
    r.b = this.randE();
    r.l = this.ent(this.hr(0xffb0), 7);
    r.h = 0;
    this.add7F62(r.b);
    this.add7F62(r.c);
    this.setValue();
    yield* this.damage();
    yield* this.msg(0x1e);
    yield* this.checkDeath();
  }

  /** 06:4938 — hl -= c, defending/resist halving; hl <= 0: "no damage" and true (the caller
   *  returns); else FFB4/5 = hl. */
  *subDefence(): Co<boolean> {
    const r = this.r;
    this.sub7F64(r.c);
    this.defending();
    const hl = r.hl;
    this.targetResist();
    r.hl = hl;
    if (r.a & 0x40) this.halve();
    this.cmpOne();
    if (r.cf) {
      yield* this.msg0C();
      return true;
    }
    this.setValue();
    return false;
  }
  /** 06:4956 — defending/resist halving, FFB4/5 = hl. */
  halving(): void {
    const r = this.r;
    this.defending();
    const hl = r.hl;
    this.targetResist();
    r.hl = hl;
    if (r.a & 0x40) this.halve();
    this.setValue();
  }

  /** 06:4966 — 0E: (target +07 - 5, the address's bit 2 halving) + power + random 0..power,
   *  less the defence. 497A loads l from the value before testing [hl - 5]: the bit tested is
   *  at (hl & FF00 | +07 value) - 5, faithfully. Later targets take the first one's value. */
  *h4966(): Co {
    const r = this.r;
    r.c = r.a;
    if (this.first()) {
      const it = r.c;
      yield* this.attacks();
      this.targetDef();
      this.ent(this.hr(0xffb1), 7);
      r.l = r.a;
      this.sub7F64(5);
      if (this.rd(r.hl) & 0x04) r.l >>= 1;
      r.h = 0;
      this.add7F62(this.itemPower(it));
      r.e = this.itemPower(it);
      this.addRand();
      this.setValue();
      if (yield* this.subDefence()) return;
      yield* this.damageMsg();
      this.keepHl();
    }
    this.keptDe();
    r.a = r.e | r.l;
    if (!r.a) return;
    yield* this.applyValue();
    yield* this.checkDeath();
  }

  /** 06:49AF — 0F */
  *h49AF(): Co {
    const r = this.r;
    r.c = this.power();
    r.e = this.param();
    r.c = (this.randE() + r.c) & 0xff;
    yield* this.attacks();
    const bc = r.bc;
    this.strength();
    r.e = r.c;
    r.bc = bc;
    r.l = r.e; r.h = 0;
    this.add7F62(r.c);
    yield* this.damage();
    yield* this.checkDeath();
  }

  /** 06:49D2 — 10 */
  *h49D2(): Co {
    const r = this.r;
    yield* this.attacks();
    r.b = this.ent(this.hr(0xffb0), 7);
    let a = this.param() - r.b;
    r.c = a < 0 ? 0 : a;
    if (this.rand100() < r.c) return yield* this.miss();
    this.targetDef();
    this.power();
    this.targetStatus();
    if (this.rd(r.hl) & 0x40) r.b >>= 1;
    if (this.targetAct() && !r.zf) r.b >>= 1;
    if (r.b < r.c) {
      this.targetStatus();
      this.wr(r.hl, this.rd(r.hl) | 1);
      yield* this.msg(0x3d);
      return yield* this.effect();
    }
    r.a = (r.b - r.c) & 0xff;
    yield* this.msg0C();
    yield* this.reaction4A15();
  }
  /** 06:4A15 */
  *reaction4A15(): Co {
    const r = this.r;
    if (!this.targetAct()) return;
    if (r.a & 0x02) return yield* this.counter();
    if (r.a & 0x04) return yield* this.inflict();
    if (r.a & 0x10) return yield* this.spikes();
  }

  /** 06:4A29 — c = the actor's +07 (strength), halved by its status bit 2. */
  strength(): void {
    const r = this.r;
    r.c = this.ent(this.hr(0xffb0), 7);
    r.hl = r.hl - 5;
    r.a = this.rd(r.hl);
    if (this.rd(r.hl) & 0x04) r.c >>= 1;
  }
  /** 06:4A3B — hl = power + random 0..power/2; FFB4/5. */
  powerValue(): void {
    const r = this.r;
    r.l = this.power();
    r.h = 0;
    r.e = r.a >> 1;
    this.addRand();
    this.setValue();
  }
  /** 06:4A4A — 06:4A3B, 06:4938, then the damage (06:4144). True when 4938 returned early. */
  *magic(): Co<boolean> {
    this.powerValue();
    if (yield* this.subDefence()) return true;
    yield* this.damage();
    return false;
  }

  /** 06:4A53 — 11 */
  *h4A53(): Co {
    const r = this.r;
    yield* this.attacks();
    this.strength();
    r.b = this.param();
    r.hl = r.hl; // 4A5D: hl from 4A29 (at +02) + 5 = +07
    this.add7F62(5, true);
    r.d = r.a;
    let a = (r.b - r.d) & 0xff;
    if (a & 0x80) a = 0;
    r.b = a;
    if (this.rand100() < r.b) return yield* this.miss();
    this.targetDef();
    yield* this.magic();
    yield* this.checkDeath();
  }

  /** 06:4A7B — hit roll: param of item a minus the target's agility; true after "miss" (the
   *  caller returns). */
  *hitParam(a: number): Co<boolean> {
    const r = this.r;
    yield* this.attacks();
    r.c = this.ent(this.hr(0xffb0), 9);
    r.hl = r.hl - 7;
    r.a = this.rd(r.hl);
    if (r.a & 0x08) r.c >>= 1;
    let v = this.itemParam(a) - r.c;
    r.c = v < 0 ? 0 : v;
    if (this.rand100() >= r.c) return false;
    yield* this.miss();
    return true;
  }

  /** 06:4AB1 — 13 */
  *h4AB1(): Co {
    const r = this.r;
    const a0 = r.a;
    yield* this.attacks();
    this.agilities();
    r.c = (this.itemParam(a0) + r.c - r.b) & 0xff;
    if (this.rand100() >= r.c) return yield* this.miss();
    r.b = this.hr(0xffb1);
    // 4AC9: looks for the entry whose actor is e = 4 (de = 4), not b
    let hl = 0xd3f2;
    while (this.rd(hl) !== 4) hl = (hl + 4) & 0xffff;
    this.wr(hl - 3, 0xff);
    r.de = 4;
    yield* this.msg(0x1f);
    this.targetDef();
    yield* this.magic();
    yield* this.checkDeath();
  }

  /** 06:4AEC — hl = power + random 0..param; FFB4/5. */
  powerParam(): void {
    const r = this.r;
    r.l = this.power();
    r.h = 0;
    r.e = this.param();
    this.addRand();
    this.setValue();
  }

  /** 06:4AFC — 14 */
  *h4AFC(): Co {
    const r = this.r;
    if (this.first()) {
      yield* this.attacks();
      yield* this.effect();
      this.targetDef();
      this.powerParam();
      if (yield* this.subDefence()) return;
      this.keepHl();
    }
    yield* this.msg0D();
    this.keptDe();
    yield* this.applyToTarget();
    yield* this.checkDeath();
  }

  /** 06:4B1F — 16 */
  *h4B1F(): Co {
    const r = this.r;
    if (this.first()) {
      yield* this.uses();
      yield* this.effect();
      this.powerParam();
      r.hl = (r.hl * 2) & 0xffff;
      this.setValue();
      this.keepHl();
      yield* this.msg(0x21);
      yield* this.msg0D();
    }
    this.keptDe();
    yield* this.applyToTarget();
    yield* this.checkDeath();
  }

  /** 06:4B43 — 17 */
  *h4B43(): Co {
    const r = this.r;
    if (this.first()) {
      yield* this.uses();
      yield* this.effect();
    }
    r.c = this.power();
    if (this.ent(this.hr(0xffb1), 0x1f) >= r.c) return yield* this.noEffect();
    this.targetStatus();
    this.wr(r.hl, this.rd(r.hl) | 1);
    this.wr(0xd4be, 1);
  }

  /** 06:4B91 — the target's guard (its action field 1 bit 3) redirects the spell; true when the
   *  target resists (the caller returns). */
  *guardRedirect(): Co<boolean> {
    const r = this.r;
    if (this.first()) {
      yield* this.attacks();
      if (this.targetAct() && (r.a & 0x08)) {
        this.wr(0xd4b7, this.hr(0xffb0));
        this.wr(0xd4b5, 1);
        yield* this.msg(0x0f);
        yield* this.msg(0x3c);
      } else this.wr(0xd4b5, 0);
    }
    if (this.rd(0xd4b5)) {
      this.hw(0xffb0, this.hr(0xffb1));
      this.hw(0xffb1, this.rd(0xd4b7));
      this.targetAction();
    }
    r.c = this.param();
    this.targetResist();
    if (!(r.a & r.c)) return false;
    if (!this.first()) return true;
    yield* this.msgF33();
    return true;
  }

  /** 06:4BE0 — 1A */
  *h4BE0(): Co {
    const r = this.r;
    if (yield* this.guardRedirect()) return;
    if (this.ent(this.hr(0xffb1), 0x0c) & r.c) r.b = 0;
    else {
      this.ent(this.hr(0xffb1), 0x0a);
      r.b = this.rd(r.hl);
    }
    r.c = this.actorDef();
    r.l = r.c >> 2;
    r.h = this.power();
    r.hl = mul8(r.h, r.l);
    r.e = r.l;
    this.add7F62(r.c);
    r.e >>= 1;
    this.addRand();
    const keep = r.hl;
    this.sub7F64(r.b);
    yield* this.effect();
    r.bc = r.hl;
    if ((r.b & 0x80) || !(r.b | r.c)) {
      r.hl = keep;
      return yield* this.msg0C();
    }
    this.nextHit();
    r.hl = keep;
    yield* this.applyMagic();
  }
  /** 06:4C27 — FFB4/5 = hl; de = -hl; the target, 06:4C35. */
  *applyMagic(): Co {
    const r = this.r;
    this.setValue();
    r.de = r.hl;
    this.neg();
    r.a = this.hr(0xffb1);
    yield* this.applyMagicTo();
  }
  /** 06:4C35 — add de to entity a's HP, the damage message, next hit, death check. */
  *applyMagicTo(): Co {
    yield* this.addHp();
    yield* this.damageMsg();
    this.nextHit();
    yield* this.checkDeath();
  }

  /** 06:4C41 — 1B */
  *h4C41(): Co {
    const r = this.r;
    if (yield* this.guardRedirect()) return;
    if (this.ent(this.hr(0xffb1), 0x0c) & r.c) r.de = 0;
    else {
      r.e = (this.ent(this.hr(0xffb1), 0x0a) + 0x14) & 0xff;
      r.d = 0;
      this.actorDef();
      r.de = (r.de - r.a) & 0xffff;
    }
    if (!(r.d & 0x80) && (r.e | r.d)) {
      if (this.rand100() < r.e) return yield* this.noEffect();
    }
    r.c = this.power();
    this.targetStatus();
    r.e = r.a;
    this.wr(r.hl, r.logic(r.a | r.c));
    yield* this.effect();
    yield* this.statusChange();
  }

  /** 06:4C7E — 1C */
  *h4C7E(): Co {
    const r = this.r;
    if (this.first()) yield* this.attacks();
    yield* this.effect();
    r.c = this.param();
    if (!(this.ent(this.hr(0xffb1), 1) & r.c)) return yield* this.msg(0x23);
    r.c = this.actorDef();
    r.l = r.c >> 2;
    r.h = this.power();
    r.hl = mul8(r.h, r.l);
    this.add7F62(r.c);
    r.e = r.c;
    this.addRand();
    yield* this.applyMagic();
  }

  /** 06:4CB3 — 1D */
  *h4CB3(): Co {
    const r = this.r;
    yield* this.attacks();
    this.agilities();
    let a = this.usesOf();
    if (a & 0x80) a = 0;
    this.hw(0xffb9, a);
    r.b = (a + r.b) & 0xff;
    if (this.targetAct() && !r.zf) r.b = (this.targetActParam() + r.b) & 0xff;
    let v = r.b - r.c;
    if (v < 0) v = 0;
    else { v -= 0x63; if (v < 0) v = 0; }
    r.c = v;
    if (this.rand100() < r.c) return yield* this.miss();
    this.targetDef();
    r.b = r.c;
    this.actorAgility();
    this.powerParam();
    this.add7F62(r.c);
    this.add7F62(0x63);
    this.sub7F64(this.hr(0xffb9));
    if (this.hr(0xffb9) === 0) r.hl = (r.hl * 3) & 0xffff;
    this.sub7F64(r.b);
    this.halving();
    if ((r.h & 0x80) || !(r.h | r.l)) return yield* this.noEffect();
    yield* this.damage();
    yield* this.checkDeath();
    if (r.cf) return;
    yield* this.reaction();
  }

  /** 06:4D21 — 1E: several hits. */
  *h4D21(): Co {
    const r = this.r;
    yield* this.attacks();
    r.c = this.evade();
    r.e = 0;
    r.d = this.param();
    do {
      if (this.rand100() >= r.c) r.e = (r.e + 1) & 0xff;
      r.d = (r.d - 1) & 0xff;
    } while (r.d);
    if (r.e === 0) return yield* this.miss();
    this.hw(0xffb6, r.e);
    this.setValueA(r.e);
    yield* this.msg(0x24);
    this.targetDef();
    this.hw(0xffb8, r.c);
    this.strength();
    this.hw(0xffb7, r.b);
    r.l = r.c >> 2;
    r.h = this.power();
    r.hl = mul8(r.h, r.l);
    r.de = r.hl;
    r.bc = 0;
    do {
      r.hl = (this.hr(0xffb7) + r.de) & 0xffff;
      const de = r.de;
      r.e >>= 1;
      this.randE();
      // 4D71: ld d,0; add hl,de: e (product / 2) is added, the random number is dropped
      r.d = 0;
      r.hl = (r.hl + r.de) & 0xffff;
      r.de = de;
      this.sub7F64(this.hr(0xffb8));
      if (r.h & 0x80) r.hl = 0;
      else {
        const d2 = r.de;
        this.cmpOne();
        r.de = d2;
        if (r.cf) r.hl = 0;
      }
      r.hl = (r.hl + r.bc) & 0xffff;
      r.bc = r.hl;
      this.hw(0xffb6, this.hr(0xffb6) - 1);
    } while (this.hr(0xffb6));
    r.hl = r.bc;
    this.halving();
    this.cmpOne();
    if (r.cf) {
      yield* this.msg0C();
      return yield* this.counter();
    }
    yield* this.damage();
    yield* this.checkDeath();
    if (r.cf) return;
    yield* this.reaction();
  }

  /** 06:4DAC — the target resists the action's param: "no effect", true (the caller returns). */
  *resists(): Co<boolean> {
    const r = this.r;
    r.c = this.param();
    if (!(this.targetResist() & r.c)) return false;
    yield* this.noEffect();
    return true;
  }

  /** 06:4DB9 — 1F */
  *h4DB9(): Co {
    const r = this.r;
    yield* this.attacks();
    if (yield* this.resists()) return;
    this.agilities();
    if (this.targetAct() && !r.zf) r.c = (this.targetActParam() + r.c) & 0xff;
    let v = r.b - r.c;
    r.c = v < 0 ? 0 : v;
    if (this.rand100() < r.c) return yield* this.miss();
    r.c = this.ent(this.hr(0xffb1), 0x0a);
    v = this.actorDef() + 0x32 - r.c;
    r.c = v < 0 ? 0 : v & 0xff;
    r.b = this.ent(this.hr(0xffb1), 0x0c);
    r.a = this.param() & r.b;
    if (r.a) r.c = (r.c << 1) & 0xff;
    r.e = 0x46;
    if (this.rnd(r.a, 0x46) >= r.c) {
      yield* this.msg(0x22);
      return yield* this.reaction4A15();
    }
    this.targetStatus();
    r.e = r.a;
    const old = r.a;
    this.power();
    this.wr(r.hl, r.logic(r.a | old));
    yield* this.effect();
    yield* this.statusChange();
  }

  /** 06:4E19 — 20: lower a stat by 1/8. */
  *h4E19(): Co {
    const r = this.r;
    yield* this.attacks();
    r.c = this.param();
    const off = this.rom(0x4e16 + this.power());
    this.hw(0xffb7, off);
    let v = this.ent(this.hr(0xffb1), off) - r.c;
    r.c = v < 0 ? 0 : v;
    if (this.rand100() < r.c) return yield* this.miss();
    const s = this.ent(this.hr(0xffb1), this.hr(0xffb7));
    r.e = s >> 3;
    this.wr(r.hl, r.a = (s - r.e) & 0xff);
    this.setValueA(r.e);
    yield* this.msg((this.power() + 0x25) & 0xff);
    yield* this.msg(0x29);
    yield* this.effect();
  }

  /** 06:4E69 — 22 */
  *h4E69(): Co {
    const r = this.r;
    if (this.first()) {
      yield* this.uses();
      yield* this.effect();
    }
    if (yield* this.resists()) return;
    if (!this.paramVsArmor()) r.a = this.ent(this.hr(0xffb1), 0x0a);
    else r.a = 0;
    r.c = r.a;
    r.b = this.actorDef();
    r.l = r.b >> 2;
    r.h = this.power();
    r.hl = mul8(r.h, r.l);
    r.e = r.l >> 1;
    this.add7F62(r.b);
    this.addRand();
    this.sub7F64(r.c);
    yield* this.applyIfPositive();
  }
  /** 06:4EA1 — hl <= 0: "no damage"; else 06:4C27. */
  *applyIfPositive(): Co {
    this.cmpOne();
    if (this.r.cf) return yield* this.msg0C();
    yield* this.applyMagic();
  }

  /** 06:4EAA — 23: every monster of group id = power... (entities whose +1F equals the counter) */
  *h4EAA(): Co {
    const r = this.r;
    yield* this.uses();
    r.b = this.power();
    this.hw(0xffb6, 0);
    yield* this.msg(0x40);
    yield* this.effect();
    let hl = 0xd01f;
    for (let c = 0x1b; c; c--) {
      if (this.rd(hl) === c) {
        const st = hl - 0x1d;
        if (!(this.rd(st) & 1)) this.hw(0xffb6, this.hr(0xffb6) + 1);
        this.wr(st, this.rd(st) | 1);
      }
      hl += 0x20;
    }
    this.actorStatus();
    this.wr(r.hl, this.rd(r.hl) | 1);
    yield* this.msg(this.hr(0xffb6) ? 0x3f : 0x41);
  }

  /** 06:4EED — 24: steal money. */
  *h4EED(): Co {
    const r = this.r;
    this.actorAgility();
    r.d = r.c;
    r.c = (this.power() + r.c) & 0xff;
    if (this.rand100() >= r.c) return;
    if (!(this.rd(0xcc8d) | this.rd(0xcc8e) | this.rd(0xcc8f))) return;
    this.hw(0xffb6, 0);
    r.e = this.ent(this.hr(0xffb0), 9);
    r.c = this.randE();
    r.b = this.param();
    let a = r.a;
    let c = r.c;
    do {
      const [v, cy] = adcDaa(a, r.b, 0);
      a = v;
      if (cy) this.hw(0xffb6, adcDaa(this.hr(0xffb6), 1, 0)[0]);
      c = (c - 1) & 0xff;
    } while (c);
    r.c = 0;
    this.wr(0xc402, a);
    this.wr(0xc401, this.hr(0xffb6));
    this.wr(0xc400, 0);
    // 4F2F: money (CC8D-CC8F) -= C400-C402 (BCD)
    let carry = 0;
    for (let i = 0; i < 3; i++) {
      const [v, cy] = sbcDaa(this.rd(0xcc8f - i), this.rd(0xc402 - i), carry);
      this.wr(0xcc8f - i, v);
      carry = cy;
    }
    if (carry) {
      this.wr(0xcc8d, 0); this.wr(0xcc8e, 0); this.wr(0xcc8f, 0);
    }
    yield* this.msg(0x2a);
  }

  /** 06:4F69 — 26 */
  *h4F69(): Co {
    const r = this.r;
    yield* this.attacks();
    if (this.ent(this.hr(0xffb1), 0) & 0xc0) return yield* this.noEffect();
    this.actorAgility();
    let v = this.param() - r.c;
    r.c = v < 0 ? 0 : v;
    if (this.rand100() < r.c) return yield* this.miss();
    this.powerValue();
    yield* this.applyMagic();
  }

  /** 06:4F8E — 27: power damage to everyone else, the actor healed by the total. */
  *h4F8E(): Co {
    const r = this.r;
    this.hw(0xffb6, 0);
    this.wr(0xd4aa, 0);
    yield* this.uses();
    yield* this.effect();
    this.hw(0xffb7, this.power());
    for (let c = 0; c !== 0x1f; c++) {
      if (this.hr(0xffb0) === c) continue;
      this.hw(0xffb1, c);
      if (this.ent(c, 2) & 3) continue;
      r.c = c;
      r.l = this.hr(0xffb7); r.h = 0;
      yield* this.damage();
      yield* this.checkDeath();
      this.hw(0xffb6, this.hr(0xffb6) + 1);
    }
    r.hl = mul8(this.hr(0xffb7), this.hr(0xffb6));
    this.setValue();
    r.de = r.hl;
    r.a = this.hr(0xffb0);
    yield* this.addHp();
    yield* this.msg(0x1c);
  }

  /** 06:4FDA — b = power, FFB4/5 = it; a = the target's +08 (hl at it). */
  powerAndDef(): void {
    const r = this.r;
    r.b = this.power();
    this.setValueA();
    this.ent(this.hr(0xffb1), 8);
  }
  /** 06:4FF2 — for the first target only (else the caller returns): 06:4287, the actor becomes
   *  the target. */
  *selfOnly(): Co<boolean> {
    if (!this.first()) return true;
    yield* this.firstUses();
    this.hw(0xffb1, this.hr(0xffb0));
    return false;
  }

  /** 06:503B — 2C: drain by the heal value. */
  *h503B(): Co {
    const r = this.r;
    yield* this.attacks();
    this.healValue();
    const v = r.hl;
    yield* this.msg(0x1a);
    yield* this.applyHl();
    yield* this.effect();
    r.a = this.hr(0xffb0);
    r.hl = v;
    r.de = r.hl;
    yield* this.applyMagicTo();
    this.ent(this.hr(0xffb1), 3);
    yield* this.checkDeath();
    if (r.cf) return;
    yield* this.reaction();
  }

  /** 06:505D — FFB4/5 = hl; the target loses hl HP. */
  *applyHlDamage(): Co {
    const r = this.r;
    this.setValue();
    r.de = r.hl;
    this.neg();
    r.a = this.hr(0xffb1);
    yield* this.addHp();
  }

  /** 06:50B7 — 30 */
  *h50B7(): Co {
    const r = this.r;
    yield* this.attacks();
    yield* this.effect();
    r.c = this.param();
    if (this.targetResist() & r.c) return yield* this.noEffect();
    r.hl = r.hl + 1;
    r.a = this.rd(r.hl) & r.c;
    let a: number;
    if (r.a) a = 0;
    else {
      r.hl = r.hl - 2;
      r.a = this.rd(r.hl);
      r.c = (r.a + 0x32) & 0xff;
      r.e = this.actorDef();
      const v = r.c - r.e;
      a = v < 0 ? 0 : v;
    }
    r.c = a;
    if (this.rand100() < r.c) return yield* this.noEffect();
    r.d = this.power();
    this.targetStatus();
    r.e = r.a;
    this.wr(r.hl, r.logic(r.a | r.d));
    yield* this.statusChange();
  }

  // ---------------------------------------------------------------- arithmetic helpers

  /** 06:7F62 — hl += a; a = [hl] (the read is real). */
  add7F62(a: number, read = true): void {
    const r = this.r;
    r.hl = (r.hl + (a & 0xff)) & 0xffff;
    if (read) r.a = this.rd(r.hl);
  }
  /** 06:7F64 — hl -= a; a = [hl]. */
  sub7F64(a: number): void {
    const r = this.r;
    r.hl = (r.hl - (a & 0xff)) & 0xffff;
    r.a = this.rd(r.hl);
  }
  /** 06:5C1D — hl >>= 1 (signed). */
  halve(): void {
    const r = this.r;
    r.hl = ((r.hl >> 1) | (r.hl & 0x8000)) & 0xffff;
  }

  // ---------------------------------------------------------------- end of turn (06:50F1)

  /** 06:50F1 — dead entities lose their HP; poisoned ones (status bit 4) recover or lose 1/16
   *  of their max HP. */
  *afterTurnCo(): Co {
    const r = this.r;
    r.c = 0;
    for (let b = 0x1f; b; b--) {
      const st = this.ent(r.c, 2);
      if (st & 1) {
        this.wr(r.hl + 1, 0);
        this.wr(r.hl + 2, 0);
        r.a = 0;
        r.hl = r.hl + 3;
      } else if (!(st & 2) && (st & 0x10)) {
        const bc = r.bc;
        yield* this.poison();
        r.bc = bc;
      }
      r.c = (r.c + 1) & 0xff;
    }
  }

  /** 06:5111 — poison: entity c recovers (rand < +0A) or loses max HP / 16. */
  *poison(): Co {
    const r = this.r;
    const st = r.hl;
    this.hw(0xffb0, r.c);
    this.hw(0xffb1, r.c);
    r.d = this.ent(r.c, 0x0a);
    if (this.rand100() < r.d) {
      r.a = this.rd(st);
      r.e = r.a;
      this.wr(st, r.a = r.a & 0xef);
      return yield* this.statusMsgs();
    }
    r.hl = st + 3;
    r.a = this.rd(r.hl);
    r.de = this.rd16(r.hl);
    r.hl = r.de >> 4;
    this.setValue();
    yield* this.msg01();
    yield* this.msg(0x02);
    yield* this.msg0D();
    this.hw(0xffb2, 0x20);
    yield* this.applyHl();
    yield* this.checkDeath();
  }

  // ---------------------------------------------------------------- victory, defeat (06:5155-539D)

  /** 06:5155 — the first meat drop: the meat screen (06:5E15) for the monster at hl. */
  *meatDrop(hl: number): Co {
    const s = this.r.save();
    this.wr(0xd4b2, this.rd(0xd4b2) + 1);
    if (this.rd(0xd4b2) === 1) {
      const id = this.rd(hl + 0x1f);
      yield* this.ui.meat(id);
      this.wr(0xd4ad, 0);
    }
    this.r.restore(s);
  }

  /** 06:517A — monster a: the meat chance (its +00 & 7 against a 0..7 roll), and its gold
   *  (table 06:72A4 by the record's +06 low nibble) added to FFB6-FFB8 (BCD). */
  *spoils(): Co {
    const r = this.r;
    const a0 = r.a;
    if (!this.monster(a0)) {
      const base = r.hl;
      r.a = this.rd(base) & 7;
      if (r.a) {
        r.c = r.a;
        r.e = 7;
        r.a = this.rand(0x518b, 0, 7);
        if (r.a < r.c) yield* this.meatDrop(base);
      }
      const id = this.rd(base + 0x1f);
      const rec = (id * 9 + 0x6ae8) & 0xffff;
      const g = (this.rom(rec + 6) & 0x0f) * 2;
      const p = 0x72a4 + g;
      let [v, cy] = adcDaa(this.hr(0xffb8), this.rom(p + 1), 0);
      this.hw(0xffb8, v);
      [v, cy] = adcDaa(this.hr(0xffb7), this.rom(p), cy);
      this.hw(0xffb7, v);
      [v, cy] = adcDaa(this.hr(0xffb6), 0, cy);
      this.hw(0xffb6, v);
    }
    r.a = a0;
  }

  /** 06:51C9 — the HP window; each party entity back into its record (00:0554). */
  *partyBack(): Co {
    yield* this.hpWindow();
    for (let a = 0; a < 4; a++) this.entityBack(a, 0xcc00 + 31 * a);
  }
  /** 06:51E0 — entity a -> record bc: status (battle bits cleared), HP, items and uses. */
  entityBack(a: number, rec: number): void {
    const r = this.r;
    let bc = 0xd000 + a * 32 + 2;
    let v = this.rd(bc);
    if (v !== 0xff) { v &= 0x0f; this.wr(bc, v); }
    this.wr(rec, v);
    this.wr(rec + 6, this.rd(bc + 1));
    this.wr(rec + 7, this.rd(bc + 2));
    bc += 0x0c;
    let hl = rec + 0x0f;
    for (let d = 8; d; d--) {
      this.wr(hl++, this.rd(bc));
      this.wr(hl++, this.rd(bc + 8));
      bc++;
    }
    r.a = a;
  }

  /** 06:5221 — c = how many of the b entities from d are dead or gone (status & 3). */
  countDown(b: number, d: number): number {
    let c = 0;
    for (; b; b--, d++) if (this.ent(d, 2) & 3) c++;
    this.r.c = c;
    this.r.d = d;
    return c;
  }

  /** 06:5240 — the end of the battle: the party wiped out (06:5231), or every monster down:
   *  victory, meat, gold, growth, and the party order (06:52B2). */
  *checkEnd(): Co {
    const r = this.r;
    yield* this.redraw();
    if (this.countDown(4, 0) === 4) return yield* this.gameOver();
    if (this.countDown(0x1b, 4) !== 0x1b) return;
    yield* this.defeated();
    this.hw(0xffe0, 0x0c);
    yield* this.msg(0x31);
    yield* this.partyBack();
    this.hw(0xffb6, 0); this.hw(0xffb7, 0); this.hw(0xffb8, 0);
    for (let a = 0; a !== 0x1b; a++) {
      r.a = a;
      yield* this.spoils();
    }
    this.wr(0xc400, this.hr(0xffb6));
    this.wr(0xc401, this.hr(0xffb7));
    this.wr(0xc402, this.hr(0xffb8));
    yield* this.msg(0x30);
    // 528A: money CC8F.. += FFB8.. (BCD), the carry into CC8C
    let c = 0;
    for (let i = 0; i < 3; i++) {
      const [v, cy] = adcDaa(this.hr(0xffb8 - i), this.rd(0xcc8f - i), c);
      this.wr(0xcc8f - i, v);
      c = cy;
    }
    this.wr(0xcc8c, adcDaa(this.rd(0xcc8c), 0, c)[0]);
    for (let a = 0; a < 4; a++) this.growth(a, 0xcc00 + 31 * a);
    this.order();
  }

  /** 06:5231 — the party is wiped out. */
  *gameOver(): Co {
    yield* this.hpWindow();
    this.hw(0xffe0, 0x0d);
    yield* this.msg(0x32);
    yield* this.ui.gameOver();
  }

  /** 06:52B2 — the party order after the battle (living members first, 06:5365), the records
   *  rearranged accordingly (CC8C follows the leader), then the battle ends (06:5CEB). */
  order(): never {
    const r = this.r;
    let hl = 0xd3ef;
    for (let i = 0; i < 4; i++) this.wr(hl++, this.rd(0xcc00 + 31 * i));
    for (let i = 0; i < 4; i++) this.wr(hl++, i);
    for (let b = 4; b; b--) {
      hl = 0xd3ef;
      for (let c = 3; c; c--) {
        r.e = this.rd(hl);
        hl++;
        r.a = this.rd(hl);
        if (!this.statusOrder()) {
          this.wr(hl, r.e);
          this.wr(hl - 1, r.a);
          const p = hl - 1 + 4;
          const x = this.rd(p), y = this.rd(p + 1);
          this.wr(p + 1, x);
          this.wr(p, y);
        }
      }
    }
    for (let i = 0; i < 0x7c; i++) this.wr(0xd000 + i, this.rd(0xcc00 + i));
    r.e = this.rd(0xcc8c);
    for (let d = 0; d < 4; d++) {
      const b = this.rd(0xd3f3 + d);
      if (b === r.e) this.wr(0xcc8c, d);
      for (let i = 0; i < 31; i++) this.wr(0xcc00 + d * 31 + i, this.rd(0xd000 + b * 31 + i));
    }
    throw new BattleExit();
  }
  /** 06:5359 — a with its bits reversed. */
  rev(a: number): number {
    let b = 0;
    for (let c = 8; c; c--) { b = (b >> 1) | ((a & 0x80) ? 0x80 : 0); a = (a << 1) & 0xff; }
    // rla / rr b: bit 7 of a goes into bit 7 of b first, then shifts right
    return b;
  }
  /** 06:5365 — carry when status a may stay after status e (e = a or FF, or a = FF, or the
   *  low nibbles compare reversed-bit a <= e...). a and e come back bit-reversed. */
  statusOrder(): boolean {
    const r = this.r;
    const a = r.a, e = r.e;
    let carry: boolean;
    if (a === e || a === 0xff) { carry = true; r.a = this.rev(a); r.e = this.rev(e); }
    else if (e === 0xff) { carry = false; r.a = this.rev(a); r.e = this.rev(e); }
    else {
      const e2 = this.rev(e & 0x0f), a2 = this.rev(a & 0x0f);
      carry = a2 >= e2;
      r.a = this.rev(a2);
      r.e = this.rev(e2);
    }
    r.cf = carry;
    return carry;
  }
  /** 06:539E — growth of party member a (record bc): living mutants (+00 & C0 = 40) roll
   *  0..255 against the thresholds at 06:7F00 for one of 8 changes (06:53DE). */
  growth(a: number, _bc: number): void {
    const r = this.r;
    this.hw(0xffb6, a);
    if (this.ent(a, 2) & 3) return;
    if ((this.rd(r.hl - 2) & 0xc0) !== 0x40) return;
    r.e = 0xff;
    const v = this.rand(0x53b8, 0, 0xff);
    let b = 0;
    for (; b < 8; b++) if (v < this.rom(0x7f00 + b)) break;
    if (b === 8) return;
    switch (b) {
      case 0: return this.newAbility();
      case 1: return this.hpUp();
      case 2: return this.statUp(0x0e, 0x7f0e, 0x5477);
      case 3: return this.statUp(0x0d, 0x7f0d, 0x5477);
      case 4: return this.statUp(0x0b, 0x7f0b, 0x5477);
      case 5: return this.statUp(0x0c, 0x7f0c, 0x5477);
      case 6: return this.usesChange();
      case 7: return;
    }
  }
  /** 06:53EE — a new ability (06:7F0F table) in a random slot. */
  newAbility(): void {
    let b: number;
    for (;;) {
      b = 0;
      let c = 0x20, ok = false;
      for (; c; c--) {
        if (this.rand(0x53f8, 0, 0x64) >= 0x5a) { ok = true; break; }
        b++;
      }
      if (ok) break;
    }
    const t = 0x7f0f + b * 2;
    const id = this.rom(t), d = this.rom(t + 1);
    const hl = this.recordAt(this.hr(0xffb6), 0x0f);
    const k = this.rand(0x541b, 0, 3) * 2;
    this.wr(hl + k, id);
    this.wr(hl + k + 1, d);
  }
  /** 06:5423 — random in [high nibble, low nibble] of a (00:016B, site = the caller's). */
  nibbleRand(a: number, site: number): number {
    return this.rand(site, a >> 4, a & 0x0f);
  }
  /** 06:542F — max HP + random (06:7F0A nibbles), at most 999. */
  hpUp(): void {
    const r = this.r;
    const inc = this.nibbleRand(this.rom(0x7f0a), 0x5435);
    const p = 0xcc00 + mul8(0x1f, this.hr(0xffb6)) + 8;
    const max = this.rd16(p);
    let v = (max + inc) & 0xffff;
    // 544E: 00:0168 with a = FFB6 (loaded before 00:015F, which keeps af)
    r.a = this.hr(0xffb6);
    const s = sub16(this.m, r.a, v, 0x3e7);
    if (!s.carry) v = 0x3e7;
    this.wr(p, v & 0xff);
    this.wr(p + 1, v >> 8);
  }
  /** 06:5474 — record field l += random (nibbles of the table byte), at most 99. */
  statUp(l: number, tab: number, site: number): void {
    const inc = this.nibbleRand(this.rom(tab), site);
    const hl = this.recordAt(this.hr(0xffb6), l);
    let a = (inc + this.rd(hl)) & 0xff;
    if (a >= 0x63) a = 0x63;
    this.wr(hl, a);
  }
  /** 06:5488 — hl = CC00 + a * 31 + l. */
  recordAt(a: number, l: number): number {
    const e = ((((a << 4) & 0xf0) << 1) - a + l) & 0xff;
    return 0xcc00 + e;
  }
  /** 06:549A — every ability's uses change: halved, + or - random (0..field 3 / 4), or reset to
   *  field 3. */
  usesChange(): void {
    let hl = this.recordAt(this.hr(0xffb6), 0x10);
    for (let c = 4; c; c--, hl += 2) {
      const u = this.rd(hl);
      if (u === 0xfe || u === 0xff) continue;
      const k = this.rand(0x54ba, 0, 3);
      const f3 = this.item(this.rd(hl - 1), 3);
      const e = f3 >> 2;
      if (k === 0) { let a = u >> 1; if (!a) a = 1; this.wr(hl, a); }
      else if (k === 1) { let a = this.rand(0x54e0, 0, e) + u; if (a >= 0x63) a = 0x63; this.wr(hl, a & 0xff); }
      else if (k === 2) { let a = u - this.rand(0x54d2, 0, e); if (a < 0) a = 0; this.wr(hl, a); }
      else this.wr(hl, f3);
    }
  }
  /** 00:07D3 (00:016B) with the call's return address. */
  rand(site: number, lo: number, hi: number): number {
    const v = rand16B(this.m, site, lo, hi);
    this.r.a = v;
    return v;
  }

  // ---------------------------------------------------------------- monster groups (06:5513)

  /** 06:5513 — D3E9: the three monster groups (id, living count), recounted. */
  groups(): void {
    const s = this.r.save();
    let hl = 0xd3e9;
    for (let i = 0; i < 3; i++) {
      const a = this.rd(hl++);
      if (a === 0xff) this.wr(hl++, 0xff);
      else this.wr(hl++, 0);
    }
    hl = 0xd082;
    for (let c = 0x1b; c; c--, hl += 0x20) {
      if (this.rd(hl) & 3) continue;
      const id = this.rd(hl + 0x1d);
      let p = this.findGroup(id);
      if (p >= 0) { this.wr(p, this.rd(p) + 1); continue; }
      p = this.findGroup(0xff);
      if (p < 0) continue;
      this.wr(p - 1, id);
      this.wr(p, 1);
    }
    this.r.restore(s);
  }
  /** 06:555F — the group slot with id e: the address of its count, or -1. */
  findGroup(e: number): number {
    for (let i = 0; i < 3; i++) if (this.rd(0xd3e9 + 2 * i) === e) return 0xd3ea + 2 * i;
    return -1;
  }

  // ---------------------------------------------------------------- loading (06:556A-581D)

  /** 06:556A — party records -> entities 0-3. */
  loadParty(): void {
    for (let a = 0; a < 4; a++) this.loadMember(a, 0xcc00 + 0x1f * a);
  }
  /** 06:5586 */
  loadMember(a: number, bc: number): void {
    const r = this.r;
    this.hw(0xffb8, a);
    this.hw(0xffb6, bc & 0xff);
    this.hw(0xffb7, bc >> 8);
    const base = 0xd000 + a * 32;
    const cls = this.rd(bc + 5);
    this.wr(base, cls);
    this.wr(base + 0x1f, cls);
    this.wr(base + 1, this.nibble(cls));
    this.wr(base + 2, this.rd(bc));
    this.wr(base + 3, this.rd(bc + 6));
    this.wr(base + 4, this.rd(bc + 7));
    this.wr(base + 5, this.rd(bc + 8));
    this.wr(base + 6, this.rd(bc + 9));
    const k = (this.rd(bc + 0x0a) >> 5) & 7;
    this.wr(base, this.rom(0x5603 + k));
    for (let i = 0; i < 4; i++) this.wr(base + 7 + i, this.rd(bc + 0x0b + i));
    let b9 = 0, ba = 0;
    let de = bc + 0x0f;
    for (let i = 0; i < 8; i++) {
      const id = this.rd(de++);
      this.wr(base + 0x0e + i, id);
      this.wr(base + 0x16 + i, this.rd(de++));
      if (id < 0xfe) {
        const f0 = this.item(id, 0);
        if (f0 & 0x40) b9 |= this.item(id, 5);
        if (f0 & 0x80) ba |= this.item(id, 5);
      }
    }
    this.hw(0xffb9, b9);
    this.hw(0xffba, ba);
    this.wr(base + 0x0b, b9);
    this.wr(base + 0x0c, ba);
    r.a = ba;
  }
  /** 06:71F0 table: the nibble for id e (high nibble for even e). */
  nibble(e: number): number {
    let a = this.rom(0x71f0 + (e >> 1));
    if (!(e & 1)) a >>= 4;
    return a & 0x0f;
  }

  /** 06:565E — entities: D000-DEFF cleared, 31 records from the template 06:568D; D3E9 groups
   *  empty. */
  clearEntities(): void {
    for (let i = 0; i < 0xf00; i++) this.wr(0xd000 + i, 0);
    for (let c = 0; c < 0x1f; c++)
      for (let i = 0; i < 0x20; i++) this.wr(0xd000 + c * 0x20 + i, this.rom(0x568d + i));
    const v = [0xff, 0, 0xff, 0, 0xff, 0];
    v.forEach((x, i) => this.wr(0xd3e9 + i, x));
    this.r.a = 0;
  }

  /** 06:56AD — the area's monsters (record 06:6868 + 5 * area): three groups, counts from the
   *  formation (06:72C4), D3E6 set for a boss formation. */
  loadMonsters(): void {
    const r = this.r;
    this.wr(0xd3e7, 4);
    const area = this.hr(0xffbd) & 0x7f;
    const rec = 0x6868 + area * 5;
    let p = rec + 3 + ((this.hr(0xffbd) & 0x80) ? 1 : 0);
    let f = this.rom(p);
    if (f & 0x80) this.wr(0xd3e6, this.rd(0xd3e6) + 1);
    f &= 0x1f;
    let bc = 0x72c4 + f * 3;
    let hl = rec;
    for (let i = 0; i < 3; i++) {
      const n = this.rom(bc);
      const cnt = this.rand(0x56fd, n >> 4, n & 0x0f);
      const id = this.rom(hl);
      for (let d = cnt; d; d--) this.newMonster(id);
      bc++;
      hl++;
    }
  }
  /** 06:5713 — monster id e as the next entity (D3E7): record 06:6AE8 + 9 * id. */
  newMonster(e: number): void {
    const r = this.r;
    let bc = 0x6ae8 + e * 9;
    const base = 0xd000 + this.rd(0xd3e7) * 32;
    this.wr(base, this.rom(bc++));
    this.wr(base + 0x1f, e);
    this.wr(base + 1, this.nibble(e));
    this.wr(base + 2, 0);
    const hp = this.monsterHp(this.rom(bc++));
    this.wr(base + 3, hp & 0xff);
    this.wr(base + 4, hp >> 8);
    this.wr(base + 5, hp & 0xff);
    this.wr(base + 6, hp >> 8);
    for (let i = 0; i < 4; i++) this.wr(base + 7 + i, this.rom(bc++));
    // bc = record + 6
    let de = this.rom(bc + 1) | (this.rom(bc + 2) << 8);
    const n = ((this.rom(bc - 6) >> 3) & 7) + 1;
    this.hw(0xffb6, n);
    let b7 = 0, b8 = 0;
    let hl = base + 0x0e;
    for (let k = n; k; k--) {
      const id = this.rom(de);
      this.wr(hl, id);
      if (id < 0xfe) {
        const f0 = this.item(id, 0);
        if (f0 & 0x40) b7 |= this.item(id, 5);
        if (this.item(id, 0) & 0x80) b8 |= this.item(id, 5);
        this.wr(hl + 8, this.item(id, 3));
      }
      de++;
      hl++;
    }
    this.hw(0xffb6, 0);
    this.hw(0xffb7, b7);
    this.hw(0xffb8, b8);
    this.wr(base + 0x0b, b7);
    this.wr(base + 0x0c, b8);
    const x = this.rom(bc) >> 4;
    this.wr(base + 0x0d, this.rd(base + 0x0d + x));
    this.wr(0xd3e7, this.rd(0xd3e7) + 1);
  }
  /** 06:57FA — HP: base from 06:7254 minus random 0..base/16 (FF for bases >= 4096). */
  monsterHp(a: number): number {
    const base = this.rom(0x7254 + a * 2) | (this.rom(0x7255 + a * 2) << 8);
    const d = base >> 8;
    const e = d < 0x10 ? (((d << 4) & 0xf0) | ((base & 0xff) >> 4)) : 0xff;
    const v = this.rand(0x5821, 0, e);
    return (base - v) & 0xffff;
  }

  // ---------------------------------------------------------------- monster actions (06:582B)

  /** 06:582B — every living monster picks its action (D3EF + 4 * (4 + n)) and target. */
  monsterActions(): void {
    const r = this.r;
    for (let n = 0; n !== 0x1b; n++) {
      this.wr(0xd4a8, n);
      for (;;) {
        if (this.monster(n)) break;
        const st = r.hl + 2;
        r.hl = st;
        if (this.rd(st) & 3) break;
        if (this.rd(st) & 0x80) { this.hw(0xffb6, 0xfd); this.storeAction(); break; }
        if (this.rd(st) & 0x40) { this.hw(0xffb6, 0xfe); this.storeAction(); break; }
        if (this.hr(0xffbd) === 1) { this.bossAction(); this.storeAction(); break; }
        if (this.noAbility()) { this.storeAction(); break; }
        const bc = 0xd48d + n;
        const k = this.rd(bc);
        this.wr(bc, (k + 1) & 7);
        r.hl = st;
        this.add7F62(k + 0x0c);
        this.hw(0xffb9, r.l);
        this.hw(0xffba, r.h);
        let a = r.a;
        if (a === 0xfe) { this.wr(bc, 0); continue; }
        this.hw(0xffb6, a);
        if (!(this.item(a, 0) & 1)) continue;
        r.e = 1;
        if (this.randE(1) === 0) continue;
        const u = r.hl + 8;
        const v = this.rd(u);
        if (v !== 0xfe) {
          this.wr(u, v - 1);
          if (((v - 1) & 0xff) === 0) this.wr(r.hl, 0xff); // 58B1: the ability slot = FF
        }
        this.storeAction();
        break;
      }
    }
  }
  /** 06:58B8 — the monster's entry: item FFB6, then its target (06:58E2). */
  storeAction(): void {
    const r = this.r;
    const n = this.rd(0xd4a8);
    r.hl = 0xd3ef + (((n + 4) * 4) & 0xff);
    this.wr(r.hl, this.hr(0xffb6));
    r.hl++;
    this.chooseTarget();
  }
  /** 06:58E2 — the target by the item's field 1 bits 5-7 (bits 5-6 when confused). */
  chooseTarget(): void {
    const r = this.r;
    const b6 = this.hr(0xffb6);
    if (b6 >= 0xfd) return;
    const p = r.hl;
    r.c = this.item(b6, 1);
    this.monster(this.rd(0xd4a8));
    let kind: number;
    if (r.a & 0x20) {
      const t = (r.c >> 5) & 3;
      kind = t === 0 ? 4 : t === 2 ? 0 : t === 1 ? 1 : 2;
    } else kind = (r.c >> 5) & 7;
    r.hl = p;
    switch (kind) {
      case 0: { // 591B — a random monster (battle RNG)
        let e: number;
        for (;;) {
          r.e = 0x1a;
          e = this.randE();
          r.e = e;
          if (this.monster(e)) continue;
          if (this.rd(r.hl + 2) & 3) continue;
          break;
        }
        this.wr(p, e + 4);
        this.wr(p + 1, 0x10);
        return;
      }
      case 4: { // 5937 — a random party member (00:016B)
        let e: number;
        for (;;) {
          e = this.rand(0x593e, 0, 3);
          r.e = e;
          if (this.entity(e)) continue;
          if (this.rd(r.hl + 2) & 3) continue;
          break;
        }
        this.wr(p, e);
        this.wr(p + 1, 1);
        return;
      }
      case 5: { // 5952 — a weighted party member
        let c = 0;
        for (;;) {
          c = 0;
          if (this.pick(c, 1)) break;
          c = 1;
          if (this.pick(c, 2)) break;
          c = 2;
          if (this.pick(c, 2)) break;
          c = 3;
          if (this.pick(c, 3)) break;
        }
        this.wr(p, c);
        this.wr(p + 1, 1);
        return;
      }
      case 2: this.wr(p + 1, 0x22); return; // 5916
      default: this.wr(p + 1, 0x02); return; // 5911
    }
  }
  /** 06:597D — a 1-in-(e+1) roll for party member c, alive. */
  pick(c: number, e: number): boolean {
    if (this.rand(0x5981, 0, e) !== 0) return false;
    if (this.entity(c)) return false;
    return !(this.rd(this.r.hl + 2) & 3);
  }
  /** 06:5A37 — z (true) when none of the monster's 8 abilities is usable (field 0 bit 0 with
   *  uses left); FFB6 = FC (the plain attack). hl at its status. */
  noAbility(): boolean {
    const r = this.r;
    const st = r.hl;
    let hl = st + 0x0c;
    let b = 0;
    for (let c = 8; c; c--, hl++) {
      const a = this.rd(hl);
      if (a >= 0xfe) { b++; continue; }
      if (!(this.item(a, 0) & 1)) { b++; continue; }
      const u = this.rd(hl + 8);
      if (u === 0 || u === 0xff) b++;
    }
    this.hw(0xffb6, 0xfc);
    r.hl = st;
    r.b = b;
    r.zf = b === 8;
    return r.zf;
  }
  /** 06:5DAF — area 1 (the boss): monster 4's ability by its HP (thresholds 06:7F50); the same
   *  HP twice in a row picks ability 0x13. */
  bossAction(): void {
    const r = this.r;
    this.hw(0xffb6, 0xff);
    this.ent(4, 3);
    r.bc = this.rd16(r.hl);
    r.de = this.rd16(0xd4bb);
    this.wr(0xd4bb, r.c);
    this.wr(0xd4bc, r.b);
    this.cmpBcDe(r.bc, r.de);
    let l = -1;
    if (r.zf) {
      const n = (this.rd(0xd4bd) + 1) & 0xff;
      this.wr(0xd4bd, n);
      r.a = n;
      if (n >= 2) { this.wr(0xd4bd, 0); l = 0x13; }
    }
    if (l < 0) {
      let hl = 0x7f50;
      do {
        this.hw(0xffb6, this.hr(0xffb6) + 1);
        r.de = this.rom(hl) | (this.rom(hl + 1) << 8);
        hl += 2;
      } while (this.cmpBcDe(r.bc, r.de));
      l = (this.hr(0xffb6) + 0x0e) & 0xff;
    }
    this.hw(0xffb6, this.ent(4, l));
  }

  // ---------------------------------------------------------------- turn order (06:59AC)

  /** 06:59AC — 50 random swaps of action entries, then D3E7 / 4 passes by agility. */
  turnOrder(): void {
    const r = this.r;
    for (let c = 0x32; c; c--) {
      r.e = (this.rd(0xd3e7) - 1) & 0xff;
      const b = this.randE();
      r.e = (this.rd(0xd3e7) - 1) & 0xff;
      const a = this.randE();
      this.swapEntries(0xd3ef + ((a * 4) & 0xff), 0xd3ef + ((b * 4) & 0xff));
    }
    for (let c = this.rd(0xd3e7) >> 2; c; c--) this.agilityPass();
  }
  /** 06:59DD — one pass: neighbours swapped when the later actor is faster. */
  agilityPass(): void {
    let bc = 0xd3f2;
    this.hw(0xffb7, 0x1e);
    do {
      if (!this.entity(this.rd(bc))) {
        const de = this.r.hl + 9;
        bc += 4;
        if (!this.entity(this.rd(bc))) {
          if (this.rd(de) < this.rd(this.r.hl + 9)) this.swapEntries(bc - 3, bc - 7);
        }
      }
      this.hw(0xffb7, this.hr(0xffb7) - 1);
    } while (this.hr(0xffb7));
  }
  /** 06:5A28 — swap 4 bytes at hl and de. */
  swapEntries(hl: number, de: number): void {
    for (let i = 0; i < 4; i++) {
      const x = this.rd(hl + i);
      this.wr(hl + i, this.rd(de + i));
      this.wr(de + i, x);
    }
  }

  // ---------------------------------------------------------------- messages, commands

  /** 06:5A71 — battle message n (the window opened first: 06:5E18); registers kept. */
  *msg(n: number): Co {
    const s = this.r.save();
    const cf = this.r.cf, zf = this.r.zf;
    if (this.rd(0xd4ad) === 0) yield* this.ui.openMessage();
    this.wr(0xd4ad, 1);
    yield* this.ui.message(n);
    this.r.restore(s);
    this.r.cf = cf;
    this.r.zf = zf;
  }

  /** 06:5A8A — the fight / run menu (06:5E09); running: a boss or a 50% failure (FFBC = 1,
   *  message 46), else the party escapes (message 4F, 06:52B2). */
  *runAway(): Co {
    const r = this.r;
    if (this.hr(0xffbc) === 1) return;
    this.wr(0xd4ad, 0);
    if (!(yield* this.ui.fightRun())) return;
    if (this.rd(0xd3e6) === 0) {
      if (this.hr(0xffbc) !== 2) {
        if (this.rand(0x5ac9, 0, 0x64) >= 0x32) return yield* this.escape();
      } else return yield* this.escape();
    }
    this.hw(0xffbc, 1);
    yield* this.msg(0x46);
  }
  /** 06:5AB4 */
  *escape(): Co {
    this.hw(0xffb0, 0);
    yield* this.msg(0x4f);
    yield* this.partyBack();
    this.order();
  }

  /** 06:5ACC — the action list reset (FF FF FF n), then the party's commands (06:5E0C, carry:
   *  back to the fight / run menu) and the confused members' random actions (06:5AF1). */
  *commands(): Co {
    const r = this.r;
    let hl = 0xd3ef;
    for (let c = 0; c < 0x1f; c++) {
      this.wr(hl++, 0xff); this.wr(hl++, 0xff); this.wr(hl++, 0xff);
      this.wr(hl++, c);
    }
    if (this.hr(0xffbc) !== 1) {
      this.wr(0xd4ad, 0);
      if (yield* this.ui.commands()) { r.cf = true; return; }
      this.confused();
    }
    r.cf = false;
  }
  /** 06:5AF1 */
  confused(): void {
    this.memberAction(0xd3ef, 0x0e);
    this.memberAction(0xd3f3, 0x2e);
    this.memberAction(0xd3f7, 0x4e);
    this.memberAction(0xd3fb, 0x6e);
  }
  /** 06:5B0E — a party entry: a confused member (status bit 5) gets a random slot and target;
   *  then the target flags from the item (06:5BCC). */
  memberAction(hl: number, b: number): void {
    const r = this.r;
    const d = this.rd(hl + 3);
    const st = this.ent(d, 2);
    r.e = st;
    if (st & 3) return;
    if (st & 0x20) {
      const t = this.rand(0x5b27, 0, 8);
      this.wr(hl + 1, t);
      const k = this.rand(0x5b2f, 0, 7);
      this.hw(0xffb7, k);
      const u = this.ent(d, (k + 0x16) & 0xff);
      let a: number;
      if (u & 0x80) a = 0xff;
      else {
        this.sub7F64(8);
        a = (this.item(r.a, 0) & 1) ? this.hr(0xffb7) : 0xff;
      }
      this.wr(hl, a);
    }
    const slot = this.rd(hl);
    if (slot === 0xff) return;
    const id = this.rd((0xd000 + ((slot + b) & 0xff)) & 0xffff);
    this.wr(0xd4ba, id);
    const c = (this.item(id, 7) >> 5) & 4;
    const e = ((this.item(id, 1) >> 6) & 3) | c;
    this.wr(hl + 2, this.rom(0x5bcc + e));
  }

  /** 06:5B8F — re-aim a party action at a monster group (target 4+k = group k of D3E9): the
   *  first living monster of that group; none left: the action is dropped (FF) unless its
   *  flags & EE; carry when dropped. hl = the entry. */
  retarget(): boolean {
    const r = this.r;
    const p = r.hl + 1;
    const t = this.rd(p);
    if (t < 4) { r.cf = false; return false; }
    const b = this.rd(0xd3e9 + (((t - 4) * 2) & 0xff));
    for (let c = 4; c !== 0x1f; c++) {
      if (this.ent(c, 2) & 3) continue;
      if (this.rd(r.hl + 0x1d) === b) {
        this.wr(p, c);
        r.cf = false;
        return false;
      }
    }
    if (this.rd(p + 1) & 0xee) { r.cf = false; return false; }
    this.wr(p - 1, 0xff);
    r.cf = true;
    return true;
  }

  /** 06:5BD4 — the status window (06:5E03). */
  *statusWindow(): Co {
    this.wr(0xd4ad, 0);
    yield* this.ui.status();
  }
  /** 06:5BDB — groups recounted, the monster pictures updated (06:5E12). */
  *redrawGroups(): Co {
    const s = this.r.save();
    this.groups();
    yield* this.ui.pictures();
    this.r.restore(s);
  }
  /** 06:5BE8 — the HP window back (06:5E21). */
  *hpWindow(): Co {
    const s = this.r.save();
    const cf = this.r.cf, zf = this.r.zf;
    yield* this.ui.restoreMap();
    this.r.restore(s);
    this.r.cf = cf;
    this.r.zf = zf;
  }

  /** 06:5C2F — z when monster c carries item d. */
  monsterHas(c: number, d: number): boolean {
    if (this.monster(c)) return false;
    let hl = this.r.hl + 0x0e;
    for (let k = 8; k; k--) if (this.rd(hl++) === d) return true;
    return false;
  }
  /** 06:5C4A — z when party member c carries item d. */
  memberHas(c: number, d: number): boolean {
    if (this.entity(c)) return false;
    let hl = this.r.hl + 0x0e;
    for (let k = 8; k; k--) if (this.rd(hl++) === d) return true;
    return false;
  }

  /** 06:5C6F — status a from e on the target: unchanged -> "no effect"; else the change
   *  messages with the target as the subject. */
  *statusChange(): Co {
    const r = this.r;
    const s = r.save();
    if (r.a === r.e) {
      yield* this.noEffect();
      r.restore(s);
      return;
    }
    const c = this.hr(0xffb0);
    this.hw(0xffb0, this.hr(0xffb1));
    yield* this.statusMsgs();
    this.hw(0xffb0, c);
    r.restore(s);
  }
  /** 06:5C8E — a message for every status bit that changed from e to a. */
  *statusMsgs(): Co {
    const r = this.r;
    const s = r.save();
    let d = r.a, e = r.e;
    if (e !== 0xff && e !== d) {
      for (let l = 0; l < 8; l++) {
        const ob = (e >> 7) & 1, nb = (d >> 7) & 1;
        e = (e << 1) & 0xff;
        d = (d << 1) & 0xff;
        if (nb !== ob) {
          const tab = nb === 1 ? 0x5cd2 : 0x5cda;
          yield* this.msg(0x01);
          yield* this.msg(this.rom(tab + l));
        }
      }
    }
    r.restore(s);
  }

  /** 06:5CF9 — the first turn only (D48A): an ambush or a first strike by the F9/FA/FB items
   *  the monsters or the party carry (10%). */
  *surprise(): Co {
    this.hw(0xffbc, 0);
    if (this.rd(0xd48a)) return;
    this.wr(0xd48a, 1);
    this.hw(0xffb6, 0);
    this.anyMonsterHas(0xf9);
    this.anyMemberHas(0xf9);
    const b6 = this.hr(0xffb6);
    if (b6 === 0) return;
    if (b6 === 1) {
      this.hw(0xffb6, 0);
      this.anyMemberHas(0xfa);
      if (this.hr(0xffb6) === 0xff) return;
      this.anyMemberHas(0xfb);
      if (this.hr(0xffb6) === 0xff) return;
      if (this.rand100() >= 0x0a) return;
      this.hw(0xffbc, 1);
      return yield* this.msg(0x44);
    }
    this.hw(0xffb6, 0);
    this.anyMonsterHas(0xfa);
    if (this.hr(0xffb6) === 1) return;
    this.anyMonsterHas(0xfb);
    if (this.hr(0xffb6) === 1) return;
    if (this.rand100() >= 0x0a) return;
    this.hw(0xffbc, 2);
    yield* this.msg(0x43);
    yield* this.statusWindow();
  }
  /** 06:5D6C — FFB6 + 1 when some monster carries item e. */
  anyMonsterHas(e: number): void {
    for (let c = 0; c !== 0x1b; c++) if (this.monsterHas(c, e)) { this.hw(0xffb6, this.hr(0xffb6) + 1); return; }
  }
  /** 06:5D7E — FFB6 - 1 when some party member carries item e. */
  anyMemberHas(e: number): void {
    for (let c = 0; c !== 4; c++) if (this.memberHas(c, e)) { this.hw(0xffb6, this.hr(0xffb6) - 1); return; }
  }

  /** 06:5D90 — the rst $38 / rst $30 vectors at D3E0 (jp 7F60) and D3E3 (jp 4296). */
  vectors(): void {
    this.wr(0xd3e0, 0xc3);
    this.wr(0xd3e3, 0xc3);
    this.wr(0xd3e1, 0x60);
    this.wr(0xd3e2, 0x7f);
    this.wr(0xd3e4, 0x96);
    this.wr(0xd3e5, 0x42);
    this.r.a = 0x42;
  }
}
