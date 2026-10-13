/** SM83 register file for the battle port. Bank 6's battle code passes values between routines in
 *  registers and flags far more than the field code does (a callee's leftover b/c/hl are read by
 *  the caller, carry/zero select paths), so its routines are ported over one shared register set,
 *  as the original's CPU state is shared. Only what the code reads is modelled: a, b, c, d, e, h, l
 *  and the carry and zero flags. */
export class Regs {
  a = 0; b = 0; c = 0; d = 0; e = 0; h = 0; l = 0;
  cf = false; zf = false;
  get hl(): number { return (this.h << 8) | this.l; }
  set hl(v: number) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  get de(): number { return (this.d << 8) | this.e; }
  set de(v: number) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  get bc(): number { return (this.b << 8) | this.c; }
  set bc(v: number) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  /** cp n: flags of a - n. */
  cp(n: number): void { const v = this.a - (n & 0xff); this.cf = v < 0; this.zf = (v & 0xff) === 0; }
  /** and/or/xor results: zero from the result, carry clear. */
  logic(v: number): number { this.a = v & 0xff; this.zf = this.a === 0; this.cf = false; return this.a; }
  save(): number[] { return [this.a, this.b, this.c, this.d, this.e, this.h, this.l]; }
  restore(s: number[], which = "abcdehl"): void {
    for (const k of which) {
      const i = "abcdehl".indexOf(k);
      (this as unknown as Record<string, number>)[k] = s[i]!;
    }
  }
}

/** Thrown to leave a routine and its caller at once (the original pops the caller's return
 *  address: `pop hl; ret` / `pop hl; jp ...`). Caught at the level the original returns to. */
export class PopReturn extends Error {
  constructor(readonly levels = 1) { super("pop-return"); }
}
