/** Game Boy-shaped memory for the engine. Game state lives at the original addresses so the
 *  original bytecode (calc VM, event scripts, map layouts) runs unchanged, states are comparable
 *  with emulator snapshots byte for byte, and ported routines can be checked against the
 *  original routine run in the SM83 oracle.
 *
 *  Map: 0000-3FFF ROM bank 0 data, 4000-7FFF switchable ROM bank data (read-only data views of
 *  the user's ROM; never executed), 8000-9FFF VRAM, A000-BFFF battery RAM (saves), C000-DFFF
 *  WRAM (E000-FDFF echo), FE00-FE9F OAM, FF00-FF7F I/O registers as plain bytes, FF80-FFFF HRAM.
 *  Writes to 0000-1FFF enable battery RAM (0x0A) and to 2000-3FFF select the ROM bank (MBC1). */

export type Segments = Record<string, Uint8Array>; // "0c" -> 0x4000 bytes

export class Memory {
  readonly vram = new Uint8Array(0x2000); // 8000-9FFF
  readonly sram = new Uint8Array(0x2000); // A000-BFFF
  readonly wram = new Uint8Array(0x2000); // C000-DFFF
  readonly oam = new Uint8Array(0xa0); // FE00-FE9F
  readonly io = new Uint8Array(0x80); // FF00-FF7F
  readonly hram = new Uint8Array(0x80); // FF80-FFFF
  /** ROM bank mapped at 0x4000-0x7FFF. */
  bank = 1;
  sramEnabled = false;
  /** Called on writes to sound registers FF10-FF3F (APU model). */
  onSoundWrite: ((reg: number, v: number) => void) | null = null;

  constructor(readonly segments: Segments) {}

  private seg(bank: number): Uint8Array | undefined {
    return this.segments[bank.toString(16).padStart(2, "0")];
  }

  rd(a: number): number {
    a &= 0xffff;
    if (a < 0x4000) return this.seg(0)?.[a] ?? 0xff;
    if (a < 0x8000) return this.seg(this.bank)?.[a - 0x4000] ?? 0xff;
    if (a < 0xa000) return this.vram[a - 0x8000]!;
    if (a < 0xc000) return this.sramEnabled ? this.sram[a - 0xa000]! : 0xff;
    if (a < 0xe000) return this.wram[a - 0xc000]!;
    if (a < 0xfe00) return this.wram[a - 0xe000]!;
    if (a < 0xfea0) return this.oam[a - 0xfe00]!;
    if (a < 0xff00) return 0xff;
    if (a < 0xff80) return this.io[a - 0xff00]!;
    return this.hram[a - 0xff80]!;
  }

  wr(a: number, v: number): void {
    a &= 0xffff;
    v &= 0xff;
    if (a < 0x2000) this.sramEnabled = (v & 0x0f) === 0x0a;
    else if (a < 0x4000) this.bank = v & 0x1f || 1;
    else if (a < 0x8000) return;
    else if (a < 0xa000) this.vram[a - 0x8000] = v;
    else if (a < 0xc000) { if (this.sramEnabled) this.sram[a - 0xa000] = v; }
    else if (a < 0xe000) this.wram[a - 0xc000] = v;
    else if (a < 0xfe00) this.wram[a - 0xe000] = v;
    else if (a < 0xfea0) this.oam[a - 0xfe00] = v;
    else if (a < 0xff00) return;
    else if (a < 0xff80) {
      this.io[a - 0xff00] = v;
      if (a === 0xff46) this.dma(v);
      else if (a >= 0xff10 && a < 0xff40) this.onSoundWrite?.(a, v);
    } else this.hram[a - 0xff80] = v;
  }

  /** OAM DMA (FF46): copy 0xA0 bytes from page v. */
  dma(page: number): void {
    for (let i = 0; i < 0xa0; i++) this.oam[i] = this.rd((page << 8) | i);
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

  /** Select ROM bank like 00:04B1 (also mirrored in FF88 by the game); returns the previous. */
  selectBank(b: number): number {
    const prev = this.hram[0x08]!;
    this.hram[0x08] = b;
    this.bank = b & 0x1f || 1;
    return prev;
  }

  /** Load C000-FFFF from an emulator snapshot (0x4000 bytes). */
  loadSnapshot(mem: Uint8Array): void {
    this.wram.set(mem.subarray(0, 0x2000));
    this.oam.set(mem.subarray(0x3e00, 0x3ea0));
    this.io.set(mem.subarray(0x3f00, 0x3f80));
    this.hram.set(mem.subarray(0x3f80, 0x4000));
  }

  /** C000-FFFF image (0x4000 bytes; echo RAM mirrors WRAM). */
  snapshot(): Uint8Array {
    const out = new Uint8Array(0x4000);
    out.set(this.wram, 0);
    out.set(this.wram.subarray(0, 0x1e00), 0x2000);
    out.set(this.oam, 0x3e00);
    out.set(this.io, 0x3f00);
    out.set(this.hram, 0x3f80);
    return out;
  }

  /** Load 8000-FFFF (0x8000 bytes, the routine-oracle / trace snapshot format). The battery RAM
   *  window in such images reads 0xFF when disabled, so it is only taken when `sram` is true. */
  loadFull(mem: Uint8Array, sram = false): void {
    this.vram.set(mem.subarray(0, 0x2000));
    if (sram) this.sram.set(mem.subarray(0x2000, 0x4000));
    this.loadSnapshot(mem.subarray(0x4000, 0x8000));
    this.bank = this.hram[0x08]! & 0x1f || 1;
  }

  /** 8000-FFFF image (0x8000 bytes). */
  snapshotFull(): Uint8Array {
    const out = new Uint8Array(0x8000);
    out.set(this.vram, 0);
    out.set(this.sramEnabled ? this.sram : new Uint8Array(0x2000).fill(0xff), 0x2000);
    out.set(this.snapshot(), 0x4000);
    return out;
  }
}
