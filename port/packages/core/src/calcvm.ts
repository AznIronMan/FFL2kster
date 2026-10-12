/** Interpreter for the bank-0C "calc VM" bytecode (battle flow, rewards, growth, meat, item
 *  effects). Mirrors the ROM interpreter 0C:4000 instruction by instruction, including its
 *  working registers in WRAM (C1A0-C1B0, VM stack from C1B1), so WRAM effects are identical.
 *  Verified against the ROM interpreter run in the SM83 oracle (tools/vm_oracle.py).
 *  Native calls: 0x0020 (print battle message D90C with args D900-D90B) and 0x01E0 (battle
 *  animation D910) are presentation hooks supplied by the caller. */
import type { Memory } from "./memory.js";
import { rand } from "./rng.js";

export const SCRIPT_TABLE = 0x4680; // bank 0C
const ACC = 0xc1a5, OPR = 0xc1a8, LEFT = 0xc1ac, MODE = 0xc1a4, TGT = 0xc1a1, TGT_MODE = 0xc1a3, SP_PTR = 0xc1af;

export interface VmHooks {
  native?(addr: number, mem: Memory): void;
}

export class CalcVm {
  steps = 0;
  constructor(readonly mem: Memory, readonly hooks: VmHooks = {}, readonly maxSteps = 200_000) {}

  /** Run script n (0-10) from the table at 0C:4680 (as 0D:4361 does). */
  runScript(n: number): void {
    const prev = this.mem.bank;
    this.mem.bank = 0x0c;
    try {
      this.run(this.mem.rd16(SCRIPT_TABLE + 2 * n));
    } finally {
      this.mem.bank = prev;
    }
  }

  /** Run from address de (bank 0C mapped) until the statement-level end (0x1F). */
  run(de: number): void {
    const m = this.mem;
    m.wr(SP_PTR, 0xb1);
    m.wr(SP_PTR + 1, 0xc1);
    let pc = de;
    for (;;) {
      if (++this.steps > this.maxSteps) throw new Error("calc VM step limit");
      const op = m.rd(pc), code = op & 0x1f, mode = (op >> 5) & 7;
      if (code === 0x1f) return;
      switch (code) {
        case 0x00: { // assign
          let l = m.rd(pc + 1), h = 0xcf;
          pc += 2;
          if (mode >= 3) {
            if (mode < 5) {
              const a = (h << 8) | l;
              l = m.rd(a); h = m.rd(a + 1);
            } else {
              h = m.rd(pc); pc += 1;
            }
          }
          m.wr(TGT, l); m.wr(TGT + 1, h); m.wr(TGT_MODE, mode); m.wr(MODE, 0);
          pc = this.expression(pc);
          break;
        }
        case 0x01: // if: the statement byte carries the first operand's mode
          m.wr(MODE, 1);
          pc = this.expression(pc, true);
          break;
        case 0x02: pc = m.rd16(pc + 1); break;
        case 0x03: { const t = m.rd16(pc + 1); pc += 3; this.native(t); break; }
        case 0x04: m.wr(0xc1a0, m.rd(pc + 1)); pc += 2; break;
        case 0x05: { const t = m.rd16(pc + 1); this.push(pc + 3); pc = t; break; }
        case 0x06: pc = this.pop(); break;
        case 0x07: case 0x08: { // inc / dec CF:[a], up to 3 bytes with carry/borrow
          const a = 0xcf00 | m.rd(pc + 1);
          const n = Math.min(mode + 1, 3);
          for (let i = 0; i < n; i++) {
            const v = (m.rd(a + i) + (code === 7 ? 1 : 0xff)) & 0xff;
            m.wr(a + i, v);
            if (v !== (code === 7 ? 0 : 0xff)) break;
          }
          pc += 2;
          break;
        }
        case 0x09: { const t = m.rd16(0xcf00 | m.rd(pc + 1)); this.push(pc + 2); pc = t; break; }
        default: throw new Error(`calc VM: bad statement ${op.toString(16)} at 0C:${pc.toString(16)}`);
      }
    }
  }

  private push(v: number): void {
    const m = this.mem, sp = m.rd16(SP_PTR);
    m.wr16(sp, v);
    m.wr16(SP_PTR, sp + 2);
  }

  private pop(): number {
    const m = this.mem, sp = m.rd16(SP_PTR) - 2;
    m.wr16(SP_PTR, sp);
    return m.rd16(sp);
  }

  private native(addr: number): void {
    if (this.hooks.native) this.hooks.native(addr, this.mem);
    else if (addr !== 0x0020 && addr !== 0x01e0) throw new Error(`calc VM: unhandled native ${addr.toString(16)}`);
  }

  private r24(a: number): number { const m = this.mem; return m.rd(a) | (m.rd(a + 1) << 8) | (m.rd(a + 2) << 16); }
  private w24(a: number, v: number): void { const m = this.mem; m.wr(a, v); m.wr(a + 1, v >> 8); m.wr(a + 2, v >> 16); }

  /** 0C:4476 / 4490: load the operand of the token at pc into C1A8-C1AA; returns new pc. */
  private loadOperand(pc: number): number {
    const m = this.mem, mode = (m.rd(pc) >> 5) & 7;
    pc += 1;
    if (mode === 5) { // rand6(0..imm)
      const v = rand(m, 6, 0, m.rd(pc));
      this.w24(OPR, v);
      return pc + 1;
    }
    if (mode === 6) { this.w24(OPR, m.rd(pc)); return pc + 1; }
    if (mode === 7) { this.w24(OPR, m.rd16(pc)); return pc + 2; }
    this.loadFrom(0xcf00 | m.rd(pc), mode);
    return pc + 1;
  }

  /** 0C:4490: mode 0-2 = 1-3 bytes at hl; mode 3-4 = 1-2 bytes at the pointer word at hl. */
  private loadFrom(hl: number, mode: number): void {
    const m = this.mem;
    let c = mode;
    if (c >= 3) { c -= 3; hl = m.rd16(hl); }
    const n = c + 1;
    m.wr(OPR + 2, 0); m.wr(OPR + 1, 0);
    for (let i = 0; i < Math.min(n, 3); i++) m.wr(OPR + i, m.rd(hl + i));
  }

  private negate(a: number): void { // 0C:42B9 on the top byte address a (3-byte value ending at a)
    const m = this.mem;
    if (!(m.rd(a) & 0x80)) return;
    const v = (-this.r24(a - 2)) & 0xffffff;
    this.w24(a - 2, v);
  }

  /** Expression evaluation (0C:401D loop) up to and including the 0x1F terminator; returns
   *  the pc of the next statement (after a failed `if`, the following statement is skipped). */
  private expression(pc: number, cond = false): number {
    const m = this.mem;
    if (cond) { // 0C:40B6 → 424F: the if byte itself is a load token
      pc = this.loadOperand(pc);
      this.w24(ACC, this.r24(OPR));
    }
    for (;;) {
      const op = m.rd(pc), code = op & 0x1f;
      if (code === 0x1f) return this.finish(pc + 1);
      if (code === 0x00 || (code >= 0x14 && code <= 0x1e)) {
        pc = this.loadOperand(pc);
        this.w24(ACC, this.r24(OPR));
        continue;
      }
      pc = this.token(pc, op, code);
    }
  }

  private token(pc: number, op: number, code: number): number {
    const m = this.mem;
    switch (code) {
      case 0x01: case 0x02: { // signed multiply / divide (16-bit magnitudes)
        pc = this.loadOperand(pc);
        let sign = m.rd(ACC + 2);
        this.negate(ACC + 2);
        sign ^= m.rd(OPR + 2);
        this.negate(OPR + 2);
        const a = m.rd16(ACC), b = m.rd16(OPR);
        if (code === 0x01) {
          let r = (a * b) & 0xffffff;
          if (sign & 0x80) r = (-r) & 0xffffff;
          this.w24(ACC, r);
        } else {
          let q = b === 0 ? 0 : Math.floor(a / b) & 0xffff;
          let hi = 0;
          if (sign & 0x80) { q = (-q) & 0xffff; hi = 0xff; }
          m.wr16(ACC, q); m.wr(ACC + 2, hi);
        }
        return pc;
      }
      case 0x03: pc = this.loadOperand(pc); this.w24(ACC, this.r24(ACC) + this.r24(OPR)); return pc;
      case 0x04: case 0x11: {
        pc = this.loadOperand(pc);
        const a = this.r24(ACC), b = this.r24(OPR);
        this.w24(ACC, code === 0x11 && a < b ? 0 : a - b);
        return pc;
      }
      case 0x05: pc = this.loadOperand(pc); this.w24(ACC, this.r24(ACC) & this.r24(OPR)); return pc;
      case 0x06: pc = this.loadOperand(pc); this.w24(ACC, this.r24(ACC) | this.r24(OPR)); return pc;
      case 0x07: pc = this.loadOperand(pc); this.w24(ACC, ~(this.r24(ACC) & this.r24(OPR))); return pc;
      case 0x08: pc = this.loadOperand(pc); this.w24(ACC, this.r24(ACC) ^ this.r24(OPR)); return pc;
      case 0x09: pc = this.loadOperand(pc); this.w24(ACC, ~this.r24(OPR)); return pc;
      case 0x0a: case 0x0b: {
        pc = this.loadOperand(pc);
        let n = m.rd(OPR), v = this.r24(ACC);
        while (n-- > 0) v = code === 0x0a ? v >>> 1 : (v << 1) & 0xffffff;
        this.w24(ACC, v);
        return pc;
      }
      case 0x0c: case 0x0d: case 0x0e: case 0x0f: case 0x10: case 0x12: case 0x13: {
        if (m.rd(MODE) !== 0) {
          m.wr(MODE, code);
          this.w24(LEFT, this.r24(ACC));
        }
        if (code === 0x13) {
          const mode = (op >> 5) & 7;
          this.loadFrom(m.rd16(pc + 1), mode);
          this.w24(ACC, this.r24(OPR));
          return pc + 3;
        }
        if (code === 0x12) {
          const v = rand(m, 5, 0, m.rd(0xcf00 | m.rd(pc + 1)));
          m.wr(ACC, v); m.wr(ACC + 1, 0); m.wr(ACC + 2, 0);
          return pc + 2;
        }
        pc = this.loadOperand(pc);
        this.w24(ACC, this.r24(OPR));
        return pc;
      }
      default:
        throw new Error(`calc VM: bad expression op ${op.toString(16)}`);
    }
  }

  /** 0C:4169: end of expression — store (assign) or test (if; false → skip next statement). */
  private finish(pc: number): number {
    const m = this.mem, mode = m.rd(MODE);
    if (mode === 0) {
      const c = m.rd(TGT_MODE);
      const n = (c < 3 ? c : c < 5 ? c - 3 : c - 5) + 1;
      const t = m.rd16(TGT);
      for (let i = 0; i < n; i++) m.wr(t + i, m.rd(ACC + i));
      return pc;
    }
    const left = this.r24(LEFT), right = this.r24(ACC);
    let pass: boolean;
    if (left === right) pass = [0x0c, 0x13, 0x0f, 0x10].includes(mode);
    else if (left < right) pass = [0x0d, 0x0f].includes(mode);
    else pass = [0x0e, 0x10].includes(mode);
    return pass ? pc : this.skipStatement(pc);
  }

  /** 0C:41EB: skip one statement. */
  private skipStatement(pc: number): number {
    const m = this.mem, op = m.rd(pc), code = op & 0x1f, mode = (op >> 5) & 7;
    if (code === 0x1f) return pc + 1;
    const skipExpr = (p: number): number => {
      for (;;) {
        const t = m.rd(p), tc = t & 0x1f;
        if (tc === 0x1f) return p + 1;
        p += tc === 0x13 || ((t >> 5) & 7) === 7 ? 3 : 2;
      }
    };
    switch (code) {
      case 0x00: return skipExpr(pc + (mode >= 5 ? 3 : 2));
      case 0x01: return skipExpr(pc + (mode === 7 ? 3 : 2));
      case 0x02: case 0x03: case 0x05: return pc + 3;
      case 0x06: return pc + 1;
      default: return pc + 2;
    }
  }
}
