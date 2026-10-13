/** Legend I graphics (2bpp): font 03:7100 (1bpp), BG tilesets 02:4000 + 0x82*set, sprite sets
 *  02:5240 + 6*set plus the shared block 01:7F00, monster pictures from 02:7900/79D2/79EA in bank 04.
 *  Mirrors src/ffl1kster/gfx.py; equal to VRAM captures (docs/ffl1/FINDINGS.md, M6). */
import { fileOffset } from "./rom.js";

const FONT = fileOffset(0x03, 0x7100);
const TILESETS = fileOffset(0x02, 0x4000);
export const TILESET_COUNT = 16;
const SPRITE_SETS = fileOffset(0x02, 0x5240);
export const SPRITE_SET_COUNT = 23;
const SPRITE_SHARED = fileOffset(0x01, 0x7f00);
const PIC_BASES = fileOffset(0x02, 0x79d2);
const PIC_TILES = fileOffset(0x02, 0x79ea);
const FAMILY = fileOffset(0x02, 0x7900);
export const PIC_WIDTH: Record<number, number> = { 0: 4, 1: 4, 2: 6, 3: 6, 4: 8 };

/** 2bpp tile (16 bytes) for character code 0x80-0xF6. */
export function fontTile(rom: Uint8Array, code: number): Uint8Array {
  const o = FONT + 8 * (code - 0x80);
  const t = new Uint8Array(16);
  for (let y = 0; y < 8; y++) t[2 * y] = t[2 * y + 1] = rom[o + y]!;
  return t;
}

export function font(rom: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 * (0xf7 - 0x80));
  for (let c = 0x80; c < 0xf7; c++) out.set(fontTile(rom, c), 16 * (c - 0x80));
  return out;
}

/** 128 tiles (2 KiB) as loaded to VRAM 8800-8FFF. */
export function tileset(rom: Uint8Array, s: number): Uint8Array {
  const o = TILESETS + 0x82 * s;
  const blocks = [rom[o]! >> 4, rom[o]! & 15, rom[o + 1]! >> 4, rom[o + 1]! & 15];
  const stage = new Uint8Array(0x1000);
  blocks.forEach((n, k) => { const src = fileOffset(1, 0x4000 + 0x400 * n); stage.set(rom.subarray(src, src + 0x400), 0x400 * k); });
  const out = new Uint8Array(0x800);
  for (let k = 0; k < 128; k++) { const t = rom[o + 2 + k]!; out.set(stage.subarray(16 * t, 16 * t + 16), 16 * k); }
  return out;
}

/** VRAM 8100-87FF: six 16-tile blocks of bank 01 (bit 7 = skip) and the shared block. */
export function spriteSet(rom: Uint8Array, s: number): Uint8Array {
  const o = SPRITE_SETS + 6 * s;
  const out = new Uint8Array(0x700);
  for (let k = 0; k < 6; k++) {
    const n = rom[o + k]!;
    if (!(n & 0x80) && 0x6000 + 0x100 * n < 0x8000) {
      const src = fileOffset(1, 0x6000 + 0x100 * n);
      out.set(rom.subarray(src, src + 0x100), 0x100 * k);
    }
  }
  out.set(rom.subarray(SPRITE_SHARED, SPRITE_SHARED + 0x100), 0x600);
  return out;
}

export interface Picture { class: number; index: number; tiles: number; width: number; offset: number; data: Uint8Array }

export function picture(rom: Uint8Array, id: number): Picture {
  const v = rom[FAMILY + id]!;
  const g = (v >> 4) & 7, i = v & 15;
  const base = rom[PIC_BASES + 2 * g]! | (rom[PIC_BASES + 2 * g + 1]! << 8);
  const n = rom[PIC_TILES + g]!;
  const o = fileOffset(0x04, base + i * n * 16);
  return { class: g, index: i, tiles: n, width: PIC_WIDTH[g] ?? 4, offset: o, data: rom.slice(o, o + n * 16) };
}
