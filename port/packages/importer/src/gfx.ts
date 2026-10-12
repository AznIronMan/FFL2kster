/** Graphics sources: tilesets, UI tiles, monster battle graphics, sprite pages (port of ffl2kster.gfx). */
import { Rom } from "./rom.js";

export const TILESET_TABLE = 0x1f800, BLOCKS = 0x8000, UI_TILES = 0x10800;
export const MON_CLASS = 0x36400, MON_DIMS = 0x36500, MON_BASE = 0x36510;

/** 64 bytes (tiles TL, TR, BL, BR) for metatile m (0..63) of tileset t. */
export function metatileTiles(rom: Rom, t: number, m: number): Uint8Array {
  if (m < 32) {
    const k = rom.u8(TILESET_TABLE + 32 * t + m);
    return rom.slice(BLOCKS + 64 * k, 64);
  }
  return rom.slice(UI_TILES + 16 * (4 * m - 0x80), 64);
}

/** BG tile area 0x8800-0x97FF as loaded for tileset t (before animation). */
export function vramBg(rom: Rom, t: number): Uint8Array {
  const out = new Uint8Array(0x1000);
  out.set(rom.slice(UI_TILES, 0x800), 0);
  for (let m = 0; m < 32; m++) out.set(metatileTiles(rom, t, m), 0x800 + 64 * m);
  return out;
}

export function monsterGraphic(rom: Rom, mid: number): { w: number; h: number; tiles: Uint8Array } {
  const v = rom.u8(MON_CLASS + mid);
  const c = v >> 4, i = v & 0x0f;
  const d = rom.u8(MON_DIMS + c);
  const w = d >> 4, h = d & 0x0f;
  const bank = rom.u8(MON_BASE + 3 * c), addr = rom.u16(MON_BASE + 3 * c + 1);
  const src = bank * 0x4000 + addr - 0x4000 + i * w * h * 16;
  return { w, h, tiles: rom.slice(src, w * h * 16) };
}

/** Overworld/battle sprite page (16 tiles): codes 0x00-0x3F bank 03, 0x40-0x7F bank 04. */
export function spritePage(rom: Rom, code: number): Uint8Array {
  const o = code < 0x40 ? 0xc000 + code * 0x100 : 0x10000 + (code - 0x40) * 0x100;
  return rom.slice(o, 0x100);
}

/** 2bpp tile → 64 colour indices (row-major). */
export function decodeTile(t: Uint8Array): Uint8Array {
  const out = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const lo = t[2 * y]!, hi = t[2 * y + 1]!;
    for (let x = 0; x < 8; x++) out[y * 8 + x] = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
  }
  return out;
}
