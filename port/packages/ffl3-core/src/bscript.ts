/** Legend III battle script interpreter (0C:4000, bank 0C selected): bytecode at de, an opcode
 *  in the low 5 bits of each statement's first byte (FF9F), an operand type in its top 3 bits.
 *  Variables live in page C9 (C9xx); an accumulator CC05-CC07 (24 bits), an operand CC08-CC0A,
 *  the target CC01/CC02 with its type CC03, a condition CC04 (0: an assignment) with the left
 *  side kept in CC0C-CC0E, a sign CC0B; a call stack of script addresses from CC11 (CC0F/CC10).
 *  Operand types (top 3 bits): 0-2 a 1/2/3-byte variable C9xx; 3-4 a 1/2-byte value through the
 *  pointer at C9xx; 5 a random number below the byte (00:1D2E); 6 an immediate byte; 7 an
 *  immediate word. Native routines are called by opcode 03 (`nativeRoutines`). */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { NotPorted } from "./irq.js";
import { add24, sub24, cmp24, randomBelow, multiply, divide } from "./math.js";

/** Native routines of the script (opcode 03 address) — bank 0C selected. */
export const nativeRoutines = new Map<number, (g: Game) => Co>();

/** The stack pointer the original has at 00:1C9C when the script divides (C0C1/C0C2 keep it). */
export const SCRIPT_DIVIDE_SP = 0xcfcf; // C0C1/C0C2 = CFC7 in the traces

/** How much shallower the stack is in the battle being run than in a battle from an event
 *  (00:19D0 via the event dispatch, where SCRIPT_DIVIDE_SP and FORMATION_LAYOUT_SP were measured):
 *  an encounter (00:10C2 from the field step) runs 1E bytes shallower (trace enc1, C0C1 E5). */
export const battleStack = { shallower: 0 };

const type = (b: number) => (b >> 5) & 0x07;

class Script {
  /** The last value of the CPU's a after an operand fetch (00:1CDD etc. keep it in FF9F). */
  a = 0;
  constructor(readonly g: Game, public de: number) {}
  get m(): Memory { return this.g.m; }
  byte(): number { const v = this.m.rd(this.de); this.de = (this.de + 1) & 0xffff; return v; }

  /** 0C:4434 (0C:4433 skips a byte first) — the variable C9xx named by the next byte. */
  variable(skip: boolean): number {
    if (skip) this.de = (this.de + 1) & 0xffff;
    return 0xc900 | this.byte();
  }

  /** 0C:43D6 — operand of type c (0-4) at hl -> CC08-CC0A. */
  loadAt(c: number, hl: number): void {
    const m = this.m;
    if (c >= 3) { c -= 3; hl = m.rd16(hl); }
    m.wr(0xcc0a, 0);
    m.wr(0xcc09, 0);
    let de = 0xcc08;
    if (c === 2) { m.wr(de++, m.rd(hl++)); }
    if (c >= 1) { m.wr(de++, m.rd(hl++)); }
    this.a = m.rd(hl);
    m.wr(de, this.a);
  }

  /** 0C:43C0 — the operand of the next term -> CC08-CC0A. */
  operand(): void {
    const m = this.m;
    const c = type(this.byte());
    if (c === 5) {
      const d = this.byte();
      const r = randomBelow(m, d);
      m.wr(0xcc08, r); m.wr(0xcc09, 0); m.wr(0xcc0a, 0);
      this.a = 0;
    } else if (c === 6) {
      m.wr(0xcc08, this.byte()); m.wr(0xcc09, 0); m.wr(0xcc0a, 0);
      this.a = 0;
    } else if (c === 7) {
      m.wr(0xcc08, this.byte());
      this.a = this.byte();
      m.wr(0xcc09, this.a);
      m.wr(0xcc0a, 0);
    } else this.loadAt(c, this.variable(false));
  }

  /** 0C:42D0 — the accumulator = the operand. */
  accFromOperand(): void {
    for (let k = 0; k < 3; k++) this.m.wr(0xcc05 + k, this.m.rd(0xcc08 + k));
  }

  /** 0C:444F — a comparison begins: CC04 = the code, the left side CC05-07 -> CC0C-0E. */
  compareBegin(): void {
    const m = this.m;
    m.wr(0xcc04, m.rd(this.de) & 0x1f);
    for (let k = 0; k < 3; k++) m.wr(0xcc0c + k, m.rd(0xcc05 + k));
  }

  /** 0C:441F — the 24-bit value ending at hl made positive (two's complement) when negative. */
  absolute(hl: number): void {
    const m = this.m;
    if (!(m.rd(hl) & 0x80)) return;
    m.wr(hl, ~m.rd(hl) & 0xff);
    m.wr(hl - 1, ~m.rd(hl - 1) & 0xff);
    const v = ((~m.rd(hl - 2) & 0xff) + 1) & 0xff;
    m.wr(hl - 2, v);
    if (v) return;
    m.wr(hl - 1, (m.rd(hl - 1) + 1) & 0xff);
    if (m.rd(hl - 1)) return;
    m.wr(hl, (m.rd(hl) + 1) & 0xff);
  }

  /** 0C:4242 / 0C:428A set-up — sign CC0B = CC07, both sides positive, CC0B ^= CC0A. */
  signs(): void {
    const m = this.m;
    m.wr(0xcc0b, m.rd(0xcc07));
    this.absolute(0xcc07);
    m.wr(0xcc0b, m.rd(0xcc0a) ^ m.rd(0xcc0b));
    this.absolute(0xcc0a);
  }

  /** 0C:427E — CC05 = e, CC06 = d, CC07 = l. */
  result(e: number, d: number, l: number): void {
    this.m.wr(0xcc07, l & 0xff);
    this.m.wr(0xcc06, d & 0xff);
    this.m.wr(0xcc05, e & 0xff);
  }

  /** One term of an expression (0C:4186 with the code at de): false at its end (1F). */
  term(code: number): boolean {
    const m = this.m;
    const acc = (op: (a: number, b: number) => number) => {
      for (let k = 0; k < 3; k++) m.wr(0xcc05 + k, op(m.rd(0xcc05 + k), m.rd(0xcc08 + k)) & 0xff);
    };
    if (code === 0x1f) return false;
    if (code === 0x12) { // 0C:42ED
      const hl = this.variable(true);
      const d = m.rd(hl);
      const r = randomBelow(m, d);
      m.wr(0xcc05, r); m.wr(0xcc06, 0); m.wr(0xcc07, 0);
      return true;
    }
    if (code === 0x13) { // 0C:4304
      if (m.rd(0xcc04)) this.compareBegin();
      const c = type(this.byte());
      const lo = this.byte(), hi = this.byte();
      this.loadAt(c, (hi << 8) | lo);
      this.accFromOperand();
      return true;
    }
    if (code >= 0x0c && code <= 0x10) { // 0C:42E1
      if (m.rd(0xcc04)) this.compareBegin();
      this.operand();
      this.accFromOperand();
      return true;
    }
    if (code === 0x00 || (code >= 0x14 && code <= 0x1e)) { this.operand(); this.accFromOperand(); return true; }
    this.operand();
    switch (code) {
      case 0x03: add24(m, this.a, 0xcc05, 0xcc08); break; // 0C:418F
      case 0x04: sub24(m, this.a, 0xcc05, 0xcc08); break; // 0C:419F
      case 0x11: { // 0C:41AF
        const { c } = sub24(m, this.a, 0xcc05, 0xcc08);
        if (c) { m.wr(0xcc05, 0); m.wr(0xcc06, 0); m.wr(0xcc07, 0); }
        break;
      }
      case 0x05: acc((a, b) => a & b); break; // 0C:41C8
      case 0x06: acc((a, b) => a | b); break; // 0C:41D3
      case 0x07: acc((a, b) => ~(a & b)); break; // 0C:41E3
      case 0x08: acc((a, b) => a ^ b); break; // 0C:41F4
      case 0x09: for (let k = 0; k < 3; k++) m.wr(0xcc05 + k, ~m.rd(0xcc08 + k) & 0xff); break; // 0C:4204
      case 0x0a: { // 0C:4214
        for (let n = m.rd(0xcc08); n; n--) {
          let c = 0;
          for (let k = 2; k >= 0; k--) { const v = m.rd(0xcc05 + k); m.wr(0xcc05 + k, (v >> 1) | (c << 7)); c = v & 1; }
        }
        break;
      }
      case 0x0b: { // 0C:422B
        for (let n = m.rd(0xcc08); n; n--) {
          let c = 0;
          for (let k = 0; k < 3; k++) { const v = (m.rd(0xcc05 + k) << 1) | c; m.wr(0xcc05 + k, v & 0xff); c = v >> 8; }
        }
        break;
      }
      case 0x01: { // 0C:4242 multiply (signed)
        this.signs();
        const r = multiply(m.rd16(0xcc05), m.rd16(0xcc08));
        let e = r.de & 0xff, d = r.de >> 8, l = r.hl & 0xff;
        if (m.rd(0xcc0b) & 0x80) {
          // the original loads e with the sign byte (80) before negating it
          e = ((~0x80 & 0xff) + 1) & 0xff;
          const c = 0; // 7F + 1: no carry
          d = ((~d & 0xff) + c) & 0xff;
          l = ((~l & 0xff) + c) & 0xff;
        }
        this.result(e, d, l);
        break;
      }
      case 0x02: { // 0C:428A divide (signed)
        this.signs();
        const r = divide(this.g, m.rd16(0xcc05), m.rd16(0xcc08), SCRIPT_DIVIDE_SP + battleStack.shallower);
        let e = r.hl & 0xff, d = r.hl >> 8, l = 0;
        if (m.rd(0xcc0b) & 0x80) {
          l = 0xff;
          const s = (~e & 0xff) + 1;
          e = s & 0xff;
          d = ((~d & 0xff) + (s >> 8)) & 0xff;
        }
        this.result(e, d, l);
        break;
      }
      default: throw new NotPorted(`0C:4186 expression code ${code.toString(16)}`);
    }
    return true;
  }

  /** The rest of an expression (0C:4186 ...) up to its 1F; then 0C:4043. Returns whether the
   *  statement after it runs (a condition) — assignments always continue. */
  expression(): boolean {
    for (;;) {
      const code = this.m.rd(this.de) & 0x1f;
      if (!this.term(code)) break;
    }
    // 0C:4043
    this.de = (this.de + 1) & 0xffff;
    const m = this.m;
    const cond = m.rd(0xcc04);
    if (!cond) { this.store(); return true; }
    const { c, z } = cmp24(m, cond, 0xcc0c, 0xcc05);
    if (z) return cond === 0x0c || cond === 0x13 || cond >= 0x0f;
    if (c) return cond === 0x0d || cond === 0x0f;
    return cond === 0x0e || cond === 0x10;
  }

  /** 0C:4017 — the accumulator to the target CC01/CC02 (1, 2 or 3 bytes by CC03). */
  store(): void {
    const m = this.m;
    let a = m.rd(0xcc03);
    if (a >= 3) a = a < 5 ? a - 3 : a - 5;
    let hl = m.rd16(0xcc01);
    let de = 0xcc05;
    if (a === 2) m.wr(hl++, m.rd(de++));
    if (a >= 1) m.wr(hl++, m.rd(de++));
    m.wr(hl, m.rd(de));
  }

  /** 0C:407C — the statement at de skipped (0C:437C by its opcode, b = 7). */
  skip(): void {
    const m = this.m;
    let a = m.rd(this.de) & 0x1f;
    if (a === 0x1f) a = 0x06;
    const step = (n: number) => { this.de = (this.de + n) & 0xffff; };
    const terms = () => { // 0C:43A5
      for (;;) {
        const c = m.rd(this.de);
        const o = c & 0x1f;
        if (o === 0x1f) { step(1); return; }
        if (o === 0x13 || type(c) === 7) step(3); else step(2);
      }
    };
    if (a === 0x00) { step(type(m.rd(this.de)) < 5 ? 2 : 3); terms(); } // 0C:4398
    else if (a === 0x01) terms();
    else if (a === 0x02 || a === 0x03 || a === 0x05) step(3);
    else if (a === 0x04 || (a >= 0x07 && a <= 0x0a)) step(2);
    else if (a === 0x06 || (a >= 0x0b && a <= 0x0d)) step(1);
    else throw new NotPorted(`0C:437C skip of opcode ${a.toString(16)}`);
  }

  /** 0C:40F1 — call: de pushed on the script stack (CC0F), de = hl. */
  call(hl: number): void {
    const m = this.m;
    const sp = m.rd16(0xcc0f);
    m.wr(sp, this.de & 0xff);
    m.wr(sp + 1, this.de >> 8);
    m.wr16(0xcc0f, (sp + 2) & 0xffff);
    this.de = hl;
  }
}

/** 0C:4000 — run the battle script at de until its end (1F). */
export function* battleScript(g: Game, de: number): Co {
  const m = g.m;
  m.wr(0xcc0f, 0x11);
  m.wr(0xcc10, 0xcc);
  const s = new Script(g, de);
  for (;;) {
    const op = m.rd(s.de) & 0x1f;
    if (op === 0x1f) return;
    m.hram[0x1f] = op;
    switch (op) {
      case 0x00: case 0x0b: { // 0C:414B
        const c = type(m.rd(s.de));
        let hl = s.variable(true);
        if (c >= 3 && c < 5) hl = m.rd16(hl);
        else if (c >= 5) hl = (s.byte() << 8) | (hl & 0xff);
        m.wr(0xcc01, hl & 0xff); m.wr(0xcc02, hl >> 8); m.wr(0xcc03, c); m.wr(0xcc04, 0);
        if (op === 0x0b) {
          m.wr(0xcc05, s.byte()); m.wr(0xcc06, 0); m.wr(0xcc07, 0);
          s.store();
          break;
        }
        if (!s.expression()) s.skip();
        break;
      }
      case 0x01: // 0C:42C8
        m.wr(0xcc04, 1);
        s.operand();
        s.accFromOperand();
        if (!s.expression()) s.skip();
        break;
      case 0x02: { s.de = (s.de + 1) & 0xffff; s.de = m.rd16(s.de); break; } // 0C:411A goto
      case 0x03: { // 0C:4135 native call
        const addr = m.rd16((s.de + 1) & 0xffff);
        s.de = (s.de + 3) & 0xffff;
        const fn = nativeRoutines.get(addr);
        if (!fn) throw new NotPorted(`battle script native 0C:${addr.toString(16).padStart(4, "0")}`);
        yield* fn(g);
        break;
      }
      case 0x04: s.de = (s.de + 2) & 0xffff; break; // 0C:4146
      case 0x05: { // 0C:40EA gosub
        s.de = (s.de + 1) & 0xffff;
        const lo = s.byte(), hi = s.byte();
        s.call((hi << 8) | lo);
        break;
      }
      case 0x06: { // 0C:4107 return
        const sp = (m.rd16(0xcc0f) - 2) & 0xffff;
        s.de = m.rd16(sp);
        m.wr16(0xcc0f, sp);
        break;
      }
      case 0x07: case 0x08: { // 0C:408F increment / decrement (with carry over c + 1 bytes)
        const b = m.rd(s.de);
        let c = type(b) + 1;
        let hl = s.variable(true);
        if (b & 1) { // 07: increment
          for (;;) { const v = (m.rd(hl) + 1) & 0xff; m.wr(hl, v); if (v) break; hl++; if (!--c) break; }
        } else { // 08: decrement
          for (;;) { const v = (m.rd(hl) - 1) & 0xff; m.wr(hl, v); hl++; if (v !== 0xff) break; if (!--c) break; }
        }
        break;
      }
      case 0x09: { const hl = s.variable(true); s.call(m.rd16(hl)); break; } // 0C:40B4
      case 0x0a: { const hl = s.variable(true); s.de = m.rd16(hl); break; } // 0C:412D
      case 0x0c: { // 0C:40BC
        const t = m.rd16(0x40ce + 2 * type(m.rd(s.de)));
        s.de = (s.de + 1) & 0xffff;
        s.call(t);
        break;
      }
      case 0x0d: s.de = m.rd16(0x40de + 2 * type(m.rd(s.de))); break; // 0C:411F
      default: // 0E-1E: accumulator statements = expression codes 00-10 (0C:42CD ...)
        s.term(op - 0x0e);
        if (!s.expression()) s.skip();
    }
  }
}
