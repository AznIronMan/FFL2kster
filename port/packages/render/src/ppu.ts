/** A Game Boy (DMG) PPU model working line by line: composes the 160x144 screen from VRAM
 *  (0x8000-0x9FFF), OAM and the LCD registers like the DMG, so raster effects that change
 *  registers between lines (the original's STAT handlers) come out right. The engine writes
 *  tilemaps, tiles and sprites the way the original game does, so screens match the original
 *  pixel for pixel; enhanced renderers (widescreen, filters) can be layered on later.
 *  Output: shade indices 0-3 after palettes (0 = lightest). */

export interface LcdRegs {
  lcdc: number; scy: number; scx: number; wy: number; wx: number; bgp: number; obp0: number; obp1: number;
}

export const SCREEN_W = 160, SCREEN_H = 144;

/** Registers from an I/O array (FF00-FF7F). */
export function regsFromIo(io: Uint8Array): LcdRegs {
  return { lcdc: io[0x40]!, scy: io[0x42]!, scx: io[0x43]!, wy: io[0x4a]!, wx: io[0x4b]!, bgp: io[0x47]!, obp0: io[0x48]!, obp1: io[0x49]! };
}

export class Ppu {
  regs: LcdRegs = { lcdc: 0xc3, scy: 0, scx: 0, wy: 0, wx: 7, bgp: 0xe4, obp0: 0xe4, obp1: 0xe4 };
  readonly frame = new Uint8Array(SCREEN_W * SCREEN_H);
  private winLine = 0;
  private readonly bgRaw = new Uint8Array(SCREEN_W);

  constructor(readonly vram: Uint8Array = new Uint8Array(0x2000), readonly oam: Uint8Array = new Uint8Array(0xa0)) {}

  private tilePixel(tileAddr: number, x: number, y: number): number {
    const lo = this.vram[tileAddr + 2 * y]!, hi = this.vram[tileAddr + 2 * y + 1]!;
    return ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
  }

  private bgTileAddr(id: number): number {
    if (this.regs.lcdc & 0x10) return id * 16;
    return 0x1000 + ((id << 24) >> 24) * 16; // signed: 0x9000 base
  }

  /** Start a frame (resets the window line counter). */
  beginFrame(): void {
    this.winLine = 0;
  }

  /** Draw line y with the current registers. */
  line(y: number): void {
    const r = this.regs, out = this.frame, bgRaw = this.bgRaw;
    const o = y * SCREEN_W;
    if (!(r.lcdc & 0x80)) {
      out.fill(0, o, o + SCREEN_W);
      return;
    }
    const bgMap = r.lcdc & 0x08 ? 0x1c00 : 0x1800;
    const winMap = r.lcdc & 0x40 ? 0x1c00 : 0x1800;
    let usedWin = false;
    for (let x = 0; x < SCREEN_W; x++) {
      let c = 0;
      if (r.lcdc & 0x01) {
        const inWin = (r.lcdc & 0x20) !== 0 && y >= r.wy && x >= r.wx - 7 && r.wx <= 166 && r.wy <= 143;
        if (inWin) {
          usedWin = true;
          const wx = x - (r.wx - 7), wy = this.winLine;
          const id = this.vram[winMap + (wy >> 3) * 32 + (wx >> 3)]!;
          c = this.tilePixel(this.bgTileAddr(id), wx & 7, wy & 7);
        } else {
          const px = (x + r.scx) & 0xff, py = (y + r.scy) & 0xff;
          const id = this.vram[bgMap + (py >> 3) * 32 + (px >> 3)]!;
          c = this.tilePixel(this.bgTileAddr(id), px & 7, py & 7);
        }
      }
      bgRaw[x] = c;
      out[o + x] = (r.bgp >> (2 * c)) & 3;
    }
    if (usedWin) this.winLine++;
    if (r.lcdc & 0x02) this.spriteLine(y);
  }

  private spriteLine(y: number): void {
    const r = this.regs, tall = (r.lcdc & 0x04) !== 0, h = tall ? 16 : 8;
    // DMG: up to 10 sprites per line, chosen in OAM order; drawing priority = lower X, then OAM index
    const line: number[] = [];
    for (let i = 0; i < 40 && line.length < 10; i++) {
      const sy = this.oam[4 * i]! - 16;
      if (y >= sy && y < sy + h) line.push(i);
    }
    line.sort((a, b) => this.oam[4 * a + 1]! - this.oam[4 * b + 1]! || a - b);
    const drawn = new Uint8Array(SCREEN_W);
    const o = y * SCREEN_W;
    for (const i of line) {
      const sy = this.oam[4 * i]! - 16, sx = this.oam[4 * i + 1]! - 8;
      let tile = this.oam[4 * i + 2]!;
      const fl = this.oam[4 * i + 3]!;
      if (tall) tile &= 0xfe;
      let ty = y - sy;
      if (fl & 0x40) ty = h - 1 - ty;
      const addr = (tile + (ty >> 3)) * 16;
      for (let tx = 0; tx < 8; tx++) {
        const x = sx + tx;
        if (x < 0 || x >= SCREEN_W || drawn[x]) continue;
        const px = fl & 0x20 ? 7 - tx : tx;
        const c = this.tilePixel(addr, px, ty & 7);
        if (c === 0) continue;
        drawn[x] = 1;
        if (fl & 0x80 && this.bgRaw[x] !== 0) continue;
        this.frame[o + x] = ((fl & 0x10 ? r.obp1 : r.obp0) >> (2 * c)) & 3;
      }
    }
  }

  /** Render a whole frame with fixed registers. */
  render(): Uint8Array {
    this.beginFrame();
    for (let y = 0; y < SCREEN_H; y++) this.line(y);
    return this.frame;
  }
}
