/** Battle main loop: bank 0D below 5000 (0D:4000-45B3), entered by far call from the field
 *  script code 09 (00:0EC5 → 00:0EEE farcall 0D:4000).
 *
 *  Combatant blocks (0x100 bytes each): D000-D400 party members 0-3 and the guest, D500-D700
 *  enemy groups 1-3. Layout (byte offsets):
 *   00 count (party: 1; enemy group: members in the group)   01 alive count
 *   02-09 name (party: 4 bytes + 4 × FF; enemies: 8 bytes 0F:6EC0 + 8·id)
 *   0A id / class   0B type (0 human, 1 mutant, 2 monster, 3 robot; enemies: 0D:6F80 byte 0 hi)
 *   0C-0D max HP   0E STR   0F AGL   10 MANA   11 DEF
 *   12 + 3k (k = 0-7): ability k = [id, id hi (MAGI ≥ 0x100), uses] (uses FE: unlimited),
 *   2A-2C: MAGI held [index in C2DA, 1, count] (FF 00 FF: none)
 *   2D-2E: OR of ability flag bytes (0C:6F85 + 8·id) for usage classes 0x10 / 0x20
 *   40 + 8i (i = member of the group): status, HP (41-42), action (43 ability slot / code,
 *   44 target, 46 ability slot used, …)
 *  Turn data D800-D85E: D800 initiative (1 party first, 2 enemy first), D801 escaped,
 *  D802 actor counter, D803-D843 turn order (slot, actor) pairs ending FF, D844 formation flags,
 *  D845 drop (meat/item) pending, D846/D847 meat transformation, D848 round counter,
 *  D849-D84B enemy groups' ability counts (DE10), D84C eater, D84D + 2·actor last action,
 *  D85E defeat flag; DE00-DE10 enemy record scratch.
 *  Calc-VM scripts (0C:4680 table, run through 0D:4361): 0 first strike, 1 run, 2 enemy actions,
 *  3 turn order, 4 confusion, 5 execute action, 6 poison, 7 regeneration, 8 GP/drops, 9 meat,
 *  10 growth (docs/BATTLE_RULES.md).
 *
 *  Calls out of bank 0D go through the bank-0 stubs (00:01D4-01E3 → 00:1892-18BB), which are
 *  far calls: C0E5 = A, C0E7/C0E8 = target, FF88 = target bank during the call. They reach the
 *  other battle modules through Engine.far: 0F:6080 battle screen setup, 01:5015 / 01:5018 /
 *  01:501B battle menus (results in FF8C and the action slots), 0F:6083 after-action display,
 *  0D:5000 animation (calc VM native 0x01E0). Battle messages are rst $20 (TextEngine.script,
 *  mode 3: message D90C from 0B:6B80). */
import type { Engine } from "../engine.js";
import type { Co } from "../game.js";
import type { Memory } from "../memory.js";
import type { Regs } from "../text/engine.js";
import { CalcVm, type VmNatives } from "../calcvm.js";
import { rand } from "../rng.js";
import { vsync, varGet, fill } from "../sys.js";
import { memberField, vramCopy } from "../field/sprites.js";
import { r00_2ADF, r00_2B14 } from "./formation.js";

// ---------------------------------------------------------------- bank-0 helpers

/** 00:00D2 — read [hl] with ROM bank `bank` mapped (hl may also point to RAM: stale ability ids
 *  of empty enemy blocks make 0D:43FA read the 0C table "at" F80A, i.e. echo RAM). */
export function rdBank(m: Memory, bank: number, hl: number): number {
  hl &= 0xffff;
  return hl < 0x8000 ? m.romAt(bank, hl) : m.rd(hl);
}

/** 00:04BF as made by the bank-0 stubs 00:1892-18BB (and 00:0EEE): C0E5 = A, C0E7/C0E8 = the
 *  target address (the RAM trampoline C0E4 `ld a,n; jp nnnn`), FF88 = target bank for the call,
 *  the caller's bank restored afterwards. */
export function* farcall(e: Engine, bank: number, addr: number, a: number, regs: Regs = {}): Co<number | void> {
  const m = e.g.m;
  m.wr(0xc0e5, a);
  m.wr(0xc0e7, addr & 0xff);
  m.wr(0xc0e8, addr >> 8);
  const prev = m.selectBank(bank);
  const r = yield* e.far((bank << 16) | addr, { ...regs, a });
  m.selectBank(prev);
  return r;
}

/** 00:0608 (stub 00:0198) — FF90 = A; returns progress variable 0 (Z when 0). */
export function r00_0608(m: Memory, a: number): number {
  m.hram[0x10] = a;
  return varGet(m, 0);
}

/** 00:0550 (stub 00:01EF) — reload the shared tiles 03:7F00 → 8700 (0x100 bytes) through 00:00C3:
 *  bank 3 mapped, VRAM pacing (a frame wait before and after, 00:1674 / 00:1691). */
export function* r00_0550(e: Engine): Co {
  const m = e.g.m;
  const prev = m.selectBank(0x03);
  yield* vramCopy(e.g, 0x03, 0x7f00, 0x8700, 0x100);
  m.selectBank(prev);
}

/** 00:06F4 (stub 00:01F2) — leave battle mode: FF8B, C764, FF96, FFA5 = 0, then 00:0550. */
export function* r00_06F4(e: Engine): Co {
  const m = e.g.m;
  m.hram[0x0b] = 0;
  m.wr(0xc764, 0);
  m.hram[0x16] = 0;
  m.hram[0x25] = 0;
  yield* r00_0550(e);
}

// ---------------------------------------------------------------- bank 0D routines

/** Calc-VM natives in battle: 0x0020 = rst $20 (battle message D90C; in battle mode the script
 *  pointer DE is not used), 0x01E0 = stub 00:18AE → farcall 0D:5000 (animation D910) with A = 1
 *  (the interpreter jumps to a native with A = the address' high byte). */
export function battleNatives(e: Engine): VmNatives {
  return function* (addr) {
    if (addr === 0x0020) return yield* e.text.script(0);
    if (addr === 0x01e0) return yield* farcall(e, 0x0d, 0x5000, 0x01);
    throw new Error(`calc VM: unhandled native ${addr.toString(16)}`);
  };
}

/** 0D:4361 — run calc-VM script n (pointer 0C:4680 + 2n) by farcall 0C:4000 (A = pointer high
 *  byte). Returns A = 0x1F (the interpreter returns on the end statement). `natives` defaults to
 *  the battle natives (tests stub them). */
export function* r0D_4361(e: Engine, n: number, natives: VmNatives = battleNatives(e)): Co<number> {
  const m = e.g.m;
  const de = m.romAt(0x0c, 0x4680 + 2 * n) | (m.romAt(0x0c, 0x4681 + 2 * n) << 8);
  m.wr(0xc0e5, de >> 8);
  m.wr(0xc0e7, 0x00);
  m.wr(0xc0e8, 0x40);
  yield* new CalcVm(m).runScriptCo(n, natives);
  return 0x1f;
}

/** 0D:435A — A = sum of [hl] over b blocks (h += b); returns the sum and the new h. Used on the
 *  alive counts D001-D401 (party) and D501-D701 (enemies). */
export function r0D_435A(m: Memory, h: number, l: number, b: number): { a: number; h: number } {
  let a = 0;
  do {
    a = (a + m.rd((h << 8) | l)) & 0xff;
    h = (h + 1) & 0xff;
  } while (--b & 0xff);
  return { a, h };
}

/** 0D:4152 — wait (rst $10) for a change of the held buttons to a non-zero value, then leave
 *  battle mode (00:01F2). */
export function* r0D_4152(e: Engine): Co {
  const m = e.g.m;
  for (;;) {
    const b = m.hram[0x09]!;
    let v: number;
    do {
      yield* vsync(e.g);
      v = m.hram[0x09]!;
    } while (v === b);
    if (v) break;
  }
  yield* r00_06F4(e);
}

/** 0D:437E — write the party's battle blocks D000-D400 back to the member records (C206 +
 *  32·slot, guest C286): status hi nibble (bit 7 → cleared, HP 1), HP (0 → 1), abilities and
 *  uses (a used-up ability of a human/mutant, id < 0x80, becomes FF), MAGI counts (C2DB + 2i). */
export function r0D_437E(m: Memory): void {
  for (let a = 0; a < 5; a++) {
    const d = (0xd0 + a) << 8;
    let hl = memberField(m, a, 0xc206);
    let s = m.rd(d | 0x40) & 0xf0;
    m.wr(hl, s);
    let dead = false;
    if (s & 0x80) {
      s &= 0x70;
      m.wr(hl, s);
      dead = true;
    } else if (!(m.rd(d | 0x41) | m.rd(d | 0x42))) dead = true;
    if (dead) {
      m.wr(d | 0x41, 0x01);
      m.wr(d | 0x42, 0x00);
    }
    const page = hl & 0xff00;
    const lo = (o: number) => page | ((hl + o) & 0xff);
    m.wr(lo(1), m.rd(d | 0x41));
    m.wr(lo(2), m.rd(d | 0x42));
    hl = lo(9);
    let e = 0x12;
    for (let b = 0; b < 8; b++) {
      let c = m.rd(d | e);
      e += 2;
      if (!m.rd(d | e) && m.rd(d | 0x0b) < 2 && c < 0x80) {
        c = 0xff;
        m.wr(d | e, 0xff);
      }
      m.wr(hl, c);
      hl = page | ((hl + 1) & 0xff);
      m.wr(hl, m.rd(d | e));
      hl = page | ((hl + 1) & 0xff);
      e++;
    }
    const g = m.rd(d | 0x2a);
    if (g !== 0xff) m.wr((0xc2db + 2 * g) & 0xffff, m.rd(d | 0x2c));
  }
}

/** 0D:43FA — block h: D[h]2D/2E = OR of the flag byte 0C:6F85 + 8·id of its 9 ability entries
 *  (D[h]12 + 3k, id = [12+3k] | [13+3k] << 8; FF: none) whose usage bits 0C:6F82 & 0x30 are
 *  0x10 (→ 2D) or 0x20/0x30 (→ 2E). */
export function r0D_43FA(m: Memory, hl: number): void {
  const d = hl & 0xff00;
  m.wr(d | 0x2d, 0);
  m.wr(d | 0x2e, 0);
  for (let b = 0; b < 9; b++) {
    const lo = m.rd(hl);
    if (lo !== 0xff) {
      const id = lo | (m.rd(hl + 1) << 8);
      const t = (0x6f82 + 8 * id) & 0xffff;
      const u = rdBank(m, 0x0c, t) & 0x30;
      if (u) {
        const de = u === 0x10 ? d | 0x2d : d | 0x2e;
        m.wr(de, m.rd(de) | rdBank(m, 0x0c, t + 3));
      }
    }
    hl += 3;
  }
}

/** 0D:443A — enemy group b (D500/D600/D700): each member's HP (D[b]41 + 8i) = max HP −
 *  (rand(stream 7, 0..(HP/8)>>8) << 8 | rand(stream 8, 0..(HP/8)&FF)); status D[b]40 + 8i = 0.
 *  An id of FF gives every member the full max HP (no random draw offset). */
export function r0D_443A(m: Memory, b: number): void {
  const bc = b << 8;
  let n = m.rd(bc);
  if (!n) return;
  const hp = m.rd(bc | 0x0c) | (m.rd(bc | 0x0d) << 8);
  let de = m.rd(bc | 0x0a) === 0xff ? 0 : hp;
  de >>= 3;
  let c = 0x40;
  do {
    const r7 = rand(m, 7, 0, de >> 8);
    const r8 = rand(m, 8, 0, de & 0xff);
    const v = (hp - ((r7 << 8) | r8)) & 0xffff;
    m.wr(bc | c, 0);
    m.wr(bc | (c + 1), v & 0xff);
    m.wr(bc | (c + 2), v >> 8);
    c = ((c + 2) & 0xf8) + 8;
  } while (--n & 0xff);
}

/** 0D:449A — party block d from the member record at hl (C200 + 32·slot / C280): count 1, name,
 *  class, type, status (alive = status bit 4 clear), HP, max HP and stats, 8 abilities as
 *  [id, 0, uses], no MAGI (FF 00 FF), flags 0. */
export function r0D_449A(m: Memory, d: number, hl: number): void {
  const blk = d << 8;
  m.wr(blk, 1);
  let e = 2;
  for (let i = 0; i < 4; i++) m.wr(blk | e++, m.rd(hl++));
  for (let i = 0; i < 4; i++) m.wr(blk | e++, 0xff);
  m.wr(blk | e++, m.rd(hl++));
  m.wr(blk | e++, m.rd(hl++));
  const st = m.rd(hl++);
  m.wr(blk | 0x40, st);
  m.wr(blk | 0x01, ((st & 0x10) >> 4) ^ 1);
  m.wr(blk | 0x41, m.rd(hl++));
  m.wr(blk | 0x42, m.rd(hl++));
  for (let i = 0; i < 6; i++) m.wr(blk | e++, m.rd(hl++));
  for (let i = 0; i < 8; i++) {
    m.wr(blk | e++, m.rd(hl++));
    m.wr(blk | e++, 0);
    m.wr(blk | e++, m.rd(hl++));
  }
  m.wr(blk | e++, 0xff);
  m.wr(blk | e++, 0x00);
  m.wr(blk | e++, 0xff);
  m.wr(blk | e++, 0x00);
  m.wr(blk | e, 0x00);
}

/** 0D:44F4 — enemy group block d (id at D[d]0A): name 0F:6EC0 + 8·id; record 0D:6F80 + 10·id
 *  copied to DE00-DE09: type (byte 0 hi nibble), max HP, STR, AGL, MANA, DEF, ability pointer;
 *  DE10 = ability count − 1 (byte 0 lo nibble); abilities [id, 0, FE] then [FF, 0, FF] up to 2C;
 *  flags 2D/2E = 0. */
export function r0D_44F4(m: Memory, d: number): void {
  const blk = d << 8;
  const id = m.rd(blk | 0x0a);
  for (let i = 0; i < 8; i++) m.wr(blk | (2 + i), m.romAt(0x0f, (0x6ec0 + 8 * id + i) & 0xffff));
  for (let i = 0; i < 10; i++) m.wr(0xde00 + i, m.romAt(0x0d, (0x6f80 + 10 * id + i) & 0xffff));
  const t = m.rd(0xde00);
  m.wr(blk | 0x0b, t >> 4);
  for (let i = 0; i < 6; i++) m.wr(blk | (0x0c + i), m.rd(0xde02 + i));
  let p = m.rd(0xde08) | (m.rd(0xde09) << 8);
  const k = t & 0x0f;
  m.wr(0xde10, k);
  let e = 0x12;
  for (let b = k + 1; b > 0; b--) {
    m.wr(blk | e, rdBank(m, 0x0d, p));
    p = (p + 1) & 0xffff;
    m.wr(blk | ((e + 1) & 0xff), 0);
    m.wr(blk | ((e + 2) & 0xff), 0xfe);
    e = (e + 3) & 0xff;
  }
  do {
    m.wr(blk | e, 0xff);
    m.wr(blk | ((e + 1) & 0xff), 0);
    m.wr(blk | ((e + 2) & 0xff), 0xff);
    e = (e + 3) & 0xff;
  } while (e < 0x2d);
  m.wr(blk | 0x2d, 0);
  m.wr(blk | 0x2e, 0);
}

/** 0D:4579 — forced actions: each living party member (D[h]01 != 0) gets action slot 0
 *  (D[h]43/44) from the table 0D:4598 by its lowest status bit 0-6 (bit 0 → 0F 01, bit 1 →
 *  0E 01, none → FF 00). */
export function r0D_4579(m: Memory): void {
  for (let h = 0xd0; h < 0xd5; h++) {
    const blk = h << 8;
    if (!m.rd(blk | 1)) continue;
    let a = m.rd(blk | 0x40), de = 0x4598;
    for (let b = 7; b > 0; b--) {
      const c = a & 1;
      a = (a >> 1) | (c << 7);
      if (c) break;
      de += 2;
    }
    m.wr(blk | 0x43, m.romAt(0x0d, de));
    m.wr(blk | 0x44, m.romAt(0x0d, de + 1));
  }
}

/** 0D:4000-40DB — battle setup: clear the VM variables CF00-CFDF, D844 = CFEA, empty all blocks,
 *  enemy groups from the formation CFE0-CFE5 (non-empty groups packed from D500, loaded by
 *  0D:44F4; D849-D84B = DE10), party blocks (0D:449A; the guest D400 is absent unless progress
 *  variable 0 is set), enemy HP (0D:443A), MAGI owners from C2DA (14 × [owner hi nibble,
 *  count]), ability flags (0D:43FA), last actions D84D-D85C = FF 00, battle music FFB0 =
 *  CFE9 + 0x11 (kind 3: unchanged). Returns A for 00:01D4. */
export function r0D_4000init(m: Memory): number {
  fill(m, 0xcf00, 0xe0, 0);
  m.wr(0xd844, m.rd(0xcfea));
  for (let h = 0xd0; h < 0xd8; h++) {
    m.wr(h << 8, 0);
    m.wr((h << 8) | 1, 0);
  }
  let h = 0xd5;
  for (let i = 0; i < 3; i++) {
    const n = m.rd(0xcfe0 + 2 * i);
    if (n) {
      m.wr(h << 8, n);
      m.wr((h << 8) | 1, n);
      m.wr((h << 8) | 0x0a, m.rd(0xcfe1 + 2 * i));
      h++;
    }
  }
  for (let i = 0; i < 3; i++) {
    const d = 0xd5 + i;
    if (m.rd(d << 8)) r0D_44F4(m, d);
    m.wr(0xd849 + i, m.rd(0xde10));
  }
  for (let a = 0; a < 5; a++) r0D_449A(m, 0xd0 + a, memberField(m, a, 0xc200));
  if (!r00_0608(m, 5)) {
    m.wr(0xd400, 0);
    m.wr(0xd401, 0);
  }
  for (let b = 0xd5; b < 0xd8; b++) r0D_443A(m, b);
  for (let i = 0; i < 0x0e; i++) {
    const a = m.rd(0xc2da + 2 * i) & 0xf0;
    if (!a) continue;
    const blk = ((((a >> 4) - 1 + 0xd0) & 0xff) << 8);
    m.wr(blk | 0x2a, i);
    m.wr(blk | 0x2b, 1);
    m.wr(blk | 0x2c, m.rd(0xc2db + 2 * i));
  }
  for (let h2 = 0xd0; h2 < 0xd8; h2++) r0D_43FA(m, (h2 << 8) | 0x12);
  for (let i = 0; i < 8; i++) {
    m.wr(0xd84d + 2 * i, 0xff);
    m.wr(0xd84e + 2 * i, 0x00);
  }
  let a = m.rd(0xcfe9);
  if (a !== 3) {
    a = (a + 0x11) & 0xff;
    m.hram[0x30] = a; // FFB0: music
  }
  return a;
}

/** 0D:40EC-4122 — start of a round: D848 += 1, turn order D803-D843 = FF, D802 = 0, every
 *  combatant's action slots (D[h]43 + 8i) = FF 00, forced actions (0D:4579). */
export function r0D_40ECround(m: Memory): void {
  m.wr(0xd848, m.rd(0xd848) + 1);
  fill(m, 0xd803, 0x41, 0xff);
  m.wr(0xd802, 0);
  for (let h = 0xd0; h < 0xd8; h++) {
    const blk = h << 8;
    let l = 0x43;
    for (let b = m.rd(blk); b > 0; b--) {
      m.wr(blk | l, 0xff);
      m.wr(blk | ((l + 1) & 0xff), 0);
      l = (l + 8) & 0xff;
    }
  }
  r0D_4579(m);
}

/** 0D:417E-41F0 bookkeeping after an action of actor `actor` with action slot `slot`: the last
 *  action (D84D + 2·actor) = D[actor]43/44 + 8·slot, and the ability's uses (D[actor]14 + 3·k,
 *  k = D[actor]46 + 8·slot) are decremented unless unlimited (FE) or the action is 0E/0F with
 *  target 1 (forced status actions) or FF. Returns A as passed to 00:01E3. */
export function r0D_41BDuses(m: Memory, slot: number, actor: number): number {
  const blk = ((0xd0 + actor) & 0xff) << 8;
  const last = 0xd800 | ((actor * 2 + 0x4d) & 0xff);
  let e = (slot * 8 + 0x43) & 0xff;
  const c = m.rd(blk | e);
  m.wr(last, c);
  e = (e + 1) & 0xff;
  const h = m.rd(blk | e);
  m.wr(last + 1, h);
  if (c === 0xff) return 0xff;
  if (c === 0x0e || (c === 0x0f && h !== 0)) {
    if (((h - 1) & 0xff) === 0) return 0;
  }
  const v = m.rd(blk | ((e + 2) & 0xff));
  if (v === 0xff) return 0xff;
  const k = (3 * v + 0x14) & 0xff;
  const u = m.rd(blk | k);
  if (u === 0xfe) return 0xfe;
  const a = (u - 1) & 0xff;
  m.wr(blk | k, a);
  return a;
}

/** 0D:42C0-4347 — meat transformation of the eater's record hl (C204 + 32·slot): class = D847,
 *  type, HP (current = max), stats from 0D:6F80 + 10·id; abilities (0D, pointer at record +8)
 *  into C20F.. as [id, uses 0C:7E80 + id], unused slots FF. */
export function r0D_42C0transform(m: Memory, hl: number): void {
  const page = hl & 0xff00;
  const at = (o: number) => page | ((hl + o) & 0xff);
  const id = m.rd(0xd847);
  m.wr(at(0), id);
  let src = (0x6f80 + 10 * id) & 0xffff;
  const b0 = m.romAt(0x0d, src);
  m.wr(at(1), b0 >> 4);
  src += 2;
  const lo = m.romAt(0x0d, src++);
  const hi = m.romAt(0x0d, src++);
  m.wr(at(3), lo);
  m.wr(at(4), hi);
  m.wr(at(6), hi);
  m.wr(at(5), lo);
  for (let i = 0; i < 4; i++) m.wr(at(7 + i), m.romAt(0x0d, src++));
  let p = m.romAt(0x0d, src) | (m.romAt(0x0d, src + 1) << 8);
  const de = at(11);
  for (let i = 0; i < 16; i++) m.wr((de + i) & 0xffff, 0xff);
  const n = (b0 & 0x0f) + 1;
  for (let k = 0; k < n; k++) m.wr(page | ((de + 2 * k) & 0xff), rdBank(m, 0x0d, p++));
  for (let k = 0; k < n; k++) {
    const a = m.rd(page | ((de + 2 * k) & 0xff));
    m.wr(page | ((de + 2 * k + 1) & 0xff), m.romAt(0x0c, 0x7e80 + a));
  }
}

const DEFEAT = 1, VICTORY = 2;

/** 0D:417E — the round's actions in turn order (D803 pairs [slot, actor] until FF): actors alive
 *  (D[a]01) and not disabled (status of the slot & 0x90) act — confusion (status bit 3: script
 *  4), script 5 (execute), uses bookkeeping, 0F:6083 — and after each the party and enemies are
 *  checked (D001-D401, D501-D701 alive counts). Returns DEFEAT / VICTORY or 0 at the end. */
function* actions(e: Engine): Co<number> {
  const m = e.g.m;
  let p = 0xd803;
  while (m.rd(p) !== 0xff) {
    const slot = m.rd(p), actor = m.rd(p + 1);
    const blk = ((0xd0 + actor) & 0xff) << 8;
    const st = m.rd(blk | ((slot * 8 + 0x40) & 0xff));
    if (m.rd(blk | 1) && !(st & 0x90)) {
      if (st & 0x08) yield* r0D_4361(e, 4);
      yield* r0D_4361(e, 5);
      const a = r0D_41BDuses(m, slot, actor);
      yield* farcall(e, 0x0f, 0x6083, a);
      const party = r0D_435A(m, 0xd0, 0x01, 5);
      if (!party.a) return DEFEAT;
      if (!r0D_435A(m, party.h, 0x01, 3).a) return VICTORY;
    }
    p += 2;
    m.wr(0xd802, m.rd(0xd802) + 1);
  }
  return 0;
}

/** Party (D001-D401) / enemies (D501-D701) alive check as at 0D:4217 / 0D:4232. */
function outcome(m: Memory): number {
  const party = r0D_435A(m, 0xd0, 0x01, 5);
  if (!party.a) return DEFEAT;
  if (!r0D_435A(m, party.h, 0x01, 3).a) return VICTORY;
  return 0;
}

/** 0D:4251 — defeat: message 0x59, wait for a button (0D:4152), palettes black, D85E = C763 = 1
 *  (00:0EF7 runs the game-over script), FFC0 = 2, music 7. No field restore. */
function* defeat(e: Engine): Co {
  const m = e.g.m;
  m.wr(0xd90c, 0x59);
  yield* e.text.script(0);
  yield* r0D_4152(e);
  m.wr(0xff47, 0);
  m.wr(0xff48, 0);
  m.wr(0xff49, 0);
  m.wr(0xd85e, 1);
  m.wr(0xc763, 1);
  m.wr(0xffc0, 2);
  m.hram[0x30] = 7;
}

/** 0D:4274 — victory: fanfare (FFB0 = 3) unless the first enemy id (D50A) is FF, message 0x5A,
 *  write back (0D:437E); unless D50A = FF: GP and drops (script 8), the meat prompt (01:501B,
 *  FF8C = eater or FF) with meat (script 9) and transformation (D846), growth (script 10);
 *  then wait for a button, restore the field (00:1915) and its music (C31A). */
function* victory(e: Engine): Co {
  const m = e.g.m;
  if (m.rd(0xd50a) !== 0xff) m.hram[0x30] = 3;
  m.wr(0xd85e, 0);
  m.wr(0xd90c, 0x5a);
  yield* e.text.script(0);
  r0D_437E(m);
  if (m.rd(0xd50a) !== 0xff) {
    yield* r0D_4361(e, 8);
    const drop = m.rd(0xd845);
    if (drop) {
      yield* farcall(e, 0x01, 0x501b, drop);
      const who = m.hram[0x0c]!;
      if (who !== 0xff) {
        m.wr(0xd84c, who);
        const hl = memberField(m, who, 0xc204);
        yield* r0D_4361(e, 9);
        if (m.rd(0xd846)) r0D_42C0transform(m, hl);
      }
    }
    yield* r0D_4361(e, 10);
  }
  yield* r0D_4152(e);
  yield* e.far(0x1915);
  m.hram[0x30] = m.rd(0xc31a);
}

/** 0D:4000 — battle main: setup, screen (0F:6080), first strike (script 0), then rounds:
 *  command input (01:5015, 01:5018 unless the enemy has the initiative), run (FF8C = FF:
 *  script 1; escaped → sound 0x38, wait, write back, field), enemy actions (script 2 unless the
 *  party has the initiative), turn order (script 3), actions, poison (script 6) and
 *  regeneration (script 7) with the after-action display, until defeat or victory. */
export function* r0D_4000(e: Engine): Co {
  const m = e.g.m;
  let a = r0D_4000init(m);
  yield* farcall(e, 0x0f, 0x6080, a);
  yield* r0D_4361(e, 0);
  m.wr(0xd848, 0);
  a = 0;
  for (;;) {
    yield* farcall(e, 0x01, 0x5015, a);
    r0D_40ECround(m);
    const ini = m.rd(0xd800);
    if (ini !== 2) {
      yield* farcall(e, 0x01, 0x5018, ini);
      if (m.hram[0x0c] === 0xff) {
        yield* r0D_4361(e, 1);
        if (m.rd(0xd801)) {
          m.hram[0x32] = 0x38; // FFB2: escape sound
          yield* r0D_4152(e);
          r0D_437E(m);
          yield* e.far(0x1915);
          m.hram[0x30] = m.rd(0xc31a);
          return;
        }
        r0D_4579(m);
      }
    }
    if (m.rd(0xd800) !== 1) yield* r0D_4361(e, 2);
    m.wr(0xd800, 0);
    yield* r0D_4361(e, 3);
    let r = yield* actions(e);
    if (!r) r = outcome(m);
    if (!r) {
      a = yield* r0D_4361(e, 6);
      yield* farcall(e, 0x0f, 0x6083, a);
      r = outcome(m);
      if (!r) a = yield* r0D_4361(e, 7);
    }
    if (r === DEFEAT) return yield* defeat(e);
    if (r === VICTORY) return yield* victory(e);
  }
}

// ---------------------------------------------------------------- wiring

/** Register the battle entry points in Engine.extra: 00:191E (00:2ADF random formation for the
 *  zone + transition), 00:190F (00:2B14 formation C + transition), 0D:4000 (battle main, entered
 *  by the far call at 00:0EEE with A = FF: C0E5/C0E7/C0E8 and FF88 = 0D as that far call sets
 *  them, the caller's bank restored on return). */
export function installBattle(e: Engine): void {
  e.extra.set(0x191e, (e) => r00_2ADF(e.g));
  e.extra.set(0x190f, (e, regs) => r00_2B14(e.g, regs.c ?? 0));
  e.extra.set(0xd4000, (e, regs) => battleFar(e, regs.a ?? 0xff));
}

/** farcall 0D:4000 (00:0EEE). */
function* battleFar(e: Engine, a: number): Co {
  const m = e.g.m;
  m.wr(0xc0e5, a);
  m.wr(0xc0e7, 0x00);
  m.wr(0xc0e8, 0x40);
  const prev = m.selectBank(0x0d);
  yield* r0D_4000(e);
  m.selectBank(prev);
}

/** Battle routines by original address (documentation / auditing). */
export const BATTLE_ROUTINES: Record<string, string> = {
  "00:2ADF": "r00_2ADF", "00:2AE6": "r00_2AE6", "00:2B14": "r00_2B14 (r00_2B14setup + 00:2CBE splitOpen)",
  "00:0550": "r00_0550", "00:0608": "r00_0608", "00:06F4": "r00_06F4", "00:04BF": "farcall",
  "0D:4000": "r0D_4000 (r0D_4000init, r0D_40ECround, actions, outcome, defeat, victory)",
  "0D:4152": "r0D_4152", "0D:41BD": "r0D_41BDuses", "0D:42C0": "r0D_42C0transform", "0D:435A": "r0D_435A",
  "0D:4361": "r0D_4361", "0D:437E": "r0D_437E", "0D:43FA": "r0D_43FA", "0D:443A": "r0D_443A",
  "0D:449A": "r0D_449A", "0D:44F4": "r0D_44F4", "0D:4579": "r0D_4579",
};
