/** Game Boy-shaped memory for the engine: ROM segments from the data package, WRAM (C000-DFFF)
 *  and HRAM (FF80-FFFF). Game state lives in WRAM at the original addresses so the original
 *  bytecode (calc VM, event scripts) runs unchanged and states are comparable with emulator
 *  snapshots. Writes to ROM or unmapped areas are ignored, like the hardware. */

export type Segments = Record<string, Uint8Array>; // "0c" -> 0x4000 bytes

export class Memory {
  readonly wram = new Uint8Array(0x2000); // C000-DFFF
  readonly hram = new Uint8Array(0x80); // FF80-FFFF
  readonly io = new Uint8Array(0x80); // FF00-FF7F (sound/LCD registers as plain bytes)
  /** Bank mapped at 0x4000-0x7FFF for reads. */
  bank = 1;

  constructor(readonly segments: Segments) {}

  private seg(bank: number): Uint8Array | undefined {
    return this.segments[bank.toString(16).padStart(2, "0")];
  }

  rd(a: number): number {
    a &= 0xffff;
    if (a < 0x4000) return this.seg(0)?.[a] ?? 0xff;
    if (a < 0x8000) return this.seg(this.bank)?.[a - 0x4000] ?? 0xff;
    if (a >= 0xc000 && a < 0xe000) return this.wram[a - 0xc000]!;
    if (a >= 0xe000 && a < 0xfe00) return this.wram[a - 0xe000]!;
    if (a >= 0xff80) return this.hram[a - 0xff80]!;
    if (a >= 0xff00) return this.io[a - 0xff00]!;
    return 0xff;
  }

  wr(a: number, v: number): void {
    a &= 0xffff;
    v &= 0xff;
    if (a >= 0xc000 && a < 0xe000) this.wram[a - 0xc000] = v;
    else if (a >= 0xe000 && a < 0xfe00) this.wram[a - 0xe000] = v;
    else if (a >= 0xff80) this.hram[a - 0xff80] = v;
    else if (a >= 0xff00) this.io[a - 0xff00] = v;
  }

  rd16(a: number): number {
    return this.rd(a) | (this.rd(a + 1) << 8);
  }

  wr16(a: number, v: number): void {
    this.wr(a, v & 0xff);
    this.wr(a + 1, (v >> 8) & 0xff);
  }

  /** Read from a specific ROM bank regardless of the mapped bank (like 00:00D2). */
  romAt(bank: number, a: number): number {
    if (a < 0x4000) return this.seg(0)?.[a] ?? 0xff;
    return this.seg(bank)?.[a - 0x4000] ?? 0xff;
  }

  /** Load C000-FFFF from an emulator snapshot (0x4000 bytes) — used by parity tests. */
  loadSnapshot(mem: Uint8Array): void {
    this.wram.set(mem.subarray(0, 0x2000));
    this.io.set(mem.subarray(0x3f00, 0x3f80));
    this.hram.set(mem.subarray(0x3f80, 0x4000));
  }

  snapshot(): Uint8Array {
    const out = new Uint8Array(0x4000);
    out.set(this.wram, 0);
    out.set(this.wram.subarray(0, 0x1e00), 0x2000);
    out.set(this.io, 0x3f00);
    out.set(this.hram, 0x3f80);
    return out;
  }
}
