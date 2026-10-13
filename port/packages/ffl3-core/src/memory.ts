/** Game Boy-shaped memory for the Legend III engine (MBC1 cartridge, 16 ROM banks, 8 KiB battery
 *  RAM). Game state lives at the original addresses so states compare byte for byte with emulator
 *  snapshots and ported routines can be checked against the ROM's own code.
 *
 *  Map: 0000-3FFF ROM bank 0 data, 4000-7FFF switchable ROM bank data (read-only views of the
 *  player's ROM; never executed), 8000-9FFF VRAM, A000-BFFF battery RAM (when enabled),
 *  C000-DFFF WRAM (E000-FDFF echo), FE00-FE9F OAM, FF00-FF7F I/O registers as plain bytes,
 *  FF80-FFFF HRAM.
 *  MBC1: 0000-1FFF enables the RAM (low nibble 0x0A); 2000-3FFF selects the ROM bank (low 5 bits,
 *  0 -> 1). Legend III writes the bank to 2000 (00:38E1 / 00:38FC) and 2100 (00:3910). */

export type Segments = Record<string, Uint8Array>; // "0f" -> 0x4000 bytes

export class Memory {
  readonly vram = new Uint8Array(0x2000);
  readonly sram = new Uint8Array(0x2000);
  readonly wram = new Uint8Array(0x2000);
  readonly oam = new Uint8Array(0xa0);
  readonly io = new Uint8Array(0x80);
  readonly hram = new Uint8Array(0x80);
  bank = 1;
  sramEnabled = false;
  onSoundWrite: ((reg: number, v: number) => void) | null = null;
  /** LCDC writes (the parity rig notes the LCD switched off). */
  onLcdc: ((v: number) => void) | null = null;
  /** Diagnostics (parity): every write to the LCD registers FF40-FF4B. */
  onLcdWrite: ((a: number, v: number) => void) | null = null;

  constructor(readonly segments: Segments) {}

  seg(bank: number): Uint8Array | undefined {
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
    if (a === 0xff41) {
      const ly = this.io[0x44]!;
      return 0x80 | (this.io[0x41]! & 0x78) | (ly === this.io[0x45] ? 4 : 0) | (ly >= 144 ? 1 : 0);
    }
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
      else if (a === 0xff40) this.onLcdc?.(v);
      else if (a >= 0xff10 && a < 0xff40) this.onSoundWrite?.(a, v);
      if (a >= 0xff40 && a <= 0xff4b) this.onLcdWrite?.(a, v);
    } else this.hram[a - 0xff80] = v;
  }

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

  /** Read address a with ROM bank `bank` mapped (4000-7FFF only; 8000+ reads RAM). */
  romAt(bank: number, a: number): number {
    a &= 0xffff;
    if (a < 0x4000) return this.seg(0)?.[a] ?? 0xff;
    if (a >= 0x8000) return this.rd(a);
    return this.seg(bank)?.[a - 0x4000] ?? 0xff;
  }

  /** Load 8000-FFFF (0x8000 bytes, the trace snapshot format); the battery RAM window is taken
   *  only when `sram` is true (it reads 0xFF while disabled). The ROM bank is C0B1 (00:38E1). */
  loadFull(mem: Uint8Array, sram = false): void {
    this.vram.set(mem.subarray(0, 0x2000));
    if (sram) this.sram.set(mem.subarray(0x2000, 0x4000));
    this.wram.set(mem.subarray(0x4000, 0x6000));
    this.oam.set(mem.subarray(0x7e00, 0x7ea0));
    this.io.set(mem.subarray(0x7f00, 0x7f80));
    this.hram.set(mem.subarray(0x7f80, 0x8000));
    this.bank = this.wram[0x0b1]! & 0x1f || 1;
  }

  snapshotFull(): Uint8Array {
    const out = new Uint8Array(0x8000);
    out.set(this.vram, 0);
    if (this.sramEnabled) out.set(this.sram, 0x2000);
    else out.fill(0xff, 0x2000, 0x4000);
    out.set(this.wram, 0x4000);
    out.set(this.wram.subarray(0, 0x1e00), 0x6000);
    out.set(this.oam, 0x7e00);
    out.fill(0xff, 0x7ea0, 0x7f00);
    out.set(this.io, 0x7f00);
    out.set(this.hram, 0x7f80);
    return out;
  }
}
