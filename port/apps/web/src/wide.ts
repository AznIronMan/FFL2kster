/** Widescreen field (P5 extra, experimental): a 256x144 picture (16:9) with 48 extra columns on
 *  each side while walking on the field. The centre 160 columns are the game's own frame; the
 *  margins are drawn from the field map in WRAM (64x64 metatiles, D000), the current tileset in
 *  VRAM and the line's BGP/SCX/SCY, through the same metatile rules the game uses for its view
 *  (field/view.ts: displayMeta, 2x2 tiles per metatile). Only the background is drawn there:
 *  the game places sprites (NPCs) for its own 160-pixel view. Outside the field (title, battle,
 *  menus that left the field loop) the margins stay as they were last drawn when the game is
 *  still on the field screen, or blank. Reads game memory only; never changes it. */
import { field, type Engine } from "@ffl2k/core";
import { SCREEN_W, SCREEN_H } from "@ffl2k/render";

const M = 48;

export class WideView {
  readonly width = SCREEN_W + 2 * M;
  private readonly lineRegs = new Uint8Array(SCREEN_H * 4); // SCX, SCY, BGP, LCDC per line
  /** Colour indices (before BGP) of the margins, kept while the field is paused (dialogs). */
  private readonly margin = new Uint8Array(SCREEN_H * 2 * M);
  private valid = false;
  private readonly out = new Uint8Array((SCREEN_W + 2 * M) * SCREEN_H);

  constructor(readonly engine: Engine) {}

  /** Called for each visible line after the game's line is drawn: keep that line's registers. */
  line(y: number): void {
    const io = this.engine.g.m.io;
    this.lineRegs.set([io[0x43]!, io[0x42]!, io[0x47]!, io[0x40]!], 4 * y);
  }

  compose(frame: Uint8Array): Uint8Array {
    const g = this.engine.g, m = g.m, w = this.width, out = this.out;
    const inBattle = m.hram[0x0b] === 0xff;
    const live = !inBattle && g.ui.fieldFrame >= 0 && g.frame - g.ui.fieldFrame <= 2;
    if (live) this.drawMargins();
    if (inBattle || g.ui.fieldFrame < 0) this.valid = false;
    for (let y = 0; y < SCREEN_H; y++) {
      const bgp = this.lineRegs[4 * y + 2]!;
      const row = y * w;
      out.set(frame.subarray(y * SCREEN_W, (y + 1) * SCREEN_W), row + M);
      for (let i = 0; i < 2 * M; i++) {
        const ci = this.valid ? this.margin[y * 2 * M + i]! : 0;
        out[row + (i < M ? i : i + SCREEN_W)] = (bgp >> (2 * ci)) & 3;
      }
    }
    return out;
  }

  /** Margins from the field map: screen x → BG pixel (SCX + x) relative to the view ring's
   *  top-left tile (C449), whose map cell is (C42C, C42D); same for y. */
  private drawMargins(): void {
    const m = this.engine.g.m, vram = m.vram;
    const ptr = m.rd(0xc449) | (m.rd(0xc44a) << 8);
    const ox = (ptr & 0x1f) * 8, oy = ((ptr >> 5) & 0x1f) * 8;
    const cx = m.rd(0xc42c), cy = m.rd(0xc42d);
    for (let y = 0; y < SCREEN_H; y++) {
      const scx = this.lineRegs[4 * y]!, scy = this.lineRegs[4 * y + 1]!, lcdc = this.lineRegs[4 * y + 3]!;
      let dy = (scy - oy) & 0xff;
      if (dy >= 128) dy -= 256;
      let dx = (scx - ox) & 0xff;
      if (dx >= 128) dx -= 256;
      const ry = dy + y;
      const cellY = (cy + Math.floor(ry / 16)) & 0xff, sy = ((ry % 16) + 16) % 16;
      for (let i = 0; i < 2 * M; i++) {
        const sx = i < M ? i - M : SCREEN_W + (i - M);
        const rx = dx + sx;
        const cellX = (cx + Math.floor(rx / 16)) & 0xff, px = ((rx % 16) + 16) % 16;
        const v = field.offMap(cellX, cellY) ? 0 : field.cellGet(m, cellX, cellY);
        const t = (field.displayMeta(m, v) * 4 + (px >= 8 ? 1 : 0) + (sy >= 8 ? 2 : 0)) & 0xff;
        const base = lcdc & 0x10 ? t * 16 : 0x1000 + ((t << 24) >> 24) * 16;
        const r = sy & 7, c = 7 - (px & 7);
        const lo = vram[base + 2 * r]!, hi = vram[base + 2 * r + 1]!;
        this.margin[y * 2 * M + i] = ((lo >> c) & 1) | (((hi >> c) & 1) << 1);
      }
    }
    this.valid = true;
  }
}
