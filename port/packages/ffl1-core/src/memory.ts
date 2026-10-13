/** Game Boy-shaped memory for the Legend I engine (MBC2 cartridge). Game state lives at the
 *  original addresses so states compare byte for byte with emulator snapshots and ported routines
 *  can be checked against the ROM's own code.
 *
 *  Map: 0000-3FFF ROM bank 0 data, 4000-7FFF switchable ROM bank data (read-only views of the
 *  player's ROM; never executed), 8000-9FFF VRAM, A000-A1FF MBC2 battery RAM (512 x 4 bits; the
 *  upper nibble reads as 1s), C000-DFFF WRAM (E000-FDFF echo), FE00-FE9F OAM, FF00-FF7F I/O
 *  registers as plain bytes, FF80-FFFF HRAM.
 *  MBC2: writes to 0000-3FFF with address bit 8 clear enable the RAM (low nibble 0x0A); with bit 8
 *  set they select the ROM bank (low nibble, 0 -> 1). Legend I writes the bank to 2100 (rst $28). */

export type Segments = Record<string, Uint8Array>; // "07" -> 0x4000 bytes

export class Memory {
  readonly vram = new Uint8Array(0x2000);
  /** MBC2 RAM: 512 nibbles, stored one per byte (low nibble). */
  readonly sram = new Uint8Array(0x200);
  readonly wram = new Uint8Array(0x2000);
  readonly oam = new Uint8Array(0xa0);
  readonly io = new Uint8Array(0x80);
  readonly hram = new Uint8Array(0x80);
  bank = 1;
  sramEnabled = false;
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
    if (a < 0xc000) return this.sramEnabled ? 0xf0 | this.sram[a & 0x1ff]! : 0xff;
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

  /** LCDC writes (the parity rig notes the LCD switched off). */
  onLcdc: ((v: number) => void) | null = null;
  /** Diagnostics (parity): every write to the LCD registers FF40-FF4B. */
  onLcdWrite: ((a: number, v: number) => void) | null = null;

  wr(a: number, v: number): void {
    a &= 0xffff;
    v &= 0xff;
    if (a < 0x4000) {
      if (a & 0x100) this.bank = v & 0x0f || 1;
      else this.sramEnabled = (v & 0x0f) === 0x0a;
    } else if (a < 0x8000) return;
    else if (a < 0xa000) this.vram[a - 0x8000] = v;
    else if (a < 0xc000) { if (this.sramEnabled) this.sram[a & 0x1ff] = v & 0x0f; }
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

  /** rst $28 (00:0028): FF8B = bank, write 2100; returns the previous bank. (The original ends
   *  with reti: interrupts are enabled after every bank switch; see Game.selectBank.) */
  selectBank(b: number): number {
    const prev = this.hram[0x0b]!;
    this.hram[0x0b] = b & 0xff;
    this.bank = b & 0x0f || 1;
    return prev;
  }

  /** Load C000-FFFF from an emulator snapshot (0x4000 bytes). */
  loadSnapshot(mem: Uint8Array): void {
    this.wram.set(mem.subarray(0, 0x2000));
    this.oam.set(mem.subarray(0x3e00, 0x3ea0));
    this.io.set(mem.subarray(0x3f00, 0x3f80));
    this.hram.set(mem.subarray(0x3f80, 0x4000));
  }

  snapshot(): Uint8Array {
    const out = new Uint8Array(0x4000);
    out.set(this.wram, 0);
    out.set(this.wram.subarray(0, 0x1e00), 0x2000);
    out.set(this.oam, 0x3e00);
    out.set(this.io, 0x3f00);
    out.set(this.hram, 0x3f80);
    return out;
  }

  /** Load 8000-FFFF (0x8000 bytes, the trace snapshot format); the battery RAM window is taken
   *  only when `sram` is true (it reads 0xFF while disabled). */
  loadFull(mem: Uint8Array, sram = false): void {
    this.vram.set(mem.subarray(0, 0x2000));
    if (sram) for (let i = 0; i < 0x200; i++) this.sram[i] = mem[0x2000 + i]! & 0x0f;
    this.loadSnapshot(mem.subarray(0x4000, 0x8000));
    this.bank = this.hram[0x0b]! & 0x0f || 1;
  }

  snapshotFull(): Uint8Array {
    const out = new Uint8Array(0x8000);
    out.set(this.vram, 0);
    const ram = new Uint8Array(0x2000).fill(0xff);
    if (this.sramEnabled) for (let i = 0; i < 0x2000; i++) ram[i] = 0xf0 | this.sram[i & 0x1ff]!;
    out.set(ram, 0x2000);
    out.set(this.snapshot(), 0x4000);
    return out;
  }
}
