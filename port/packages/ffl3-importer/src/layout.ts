/** Legend III map layouts (docs/ffl3/FINDINGS.md M5): the compressed metatile maps of banks 07/08
 *  (00:0F42, decompressor 00:3D76) and the story-flag patches (0B:78F5). Mirrors ffl3kster.layout. */
import { fileOffset, u16, hex } from "./rom.js";
import { mapOffset, MAP_COUNT } from "./tables.js";

export const PATCH_COUNT = 0x2f;
export const LAYOUT_COUNT = 31;

const w16 = (rom: Uint8Array, bank: number, addr: number): number => u16(rom, fileOffset(bank, addr));

export function location(n: number): [bank: number, entry: number] {
  if (n < 1 || n > LAYOUT_COUNT) throw new Error(`layout data index ${n} out of range 1..31`);
  return n >= 0x10 ? [0x08, n - 0x10] : [0x07, n - 1];
}

/** 00:3D76: a block-size byte s (blocks of 4 << (s + 1) bytes), then per block a fill byte, an
 *  MSB-first bit mask (1 = next literal, 0 = fill) and the literals. The end is tested after each
 *  block, so at least one block is decoded. */
export function decompress(rom: Uint8Array, bank: number, start: number, end: number): Uint8Array {
  let o = fileOffset(bank, start);
  const stop = end > 0x4000 ? fileOffset(bank, end - 1) + 1 : 0;
  const s = rom[o]!;
  const size = s < 0xff && s + 1 < 8 ? (4 << (s + 1)) & 0xff : 0;
  if (![8, 16, 32, 64].includes(size)) throw new Error(`block size byte ${hex(s)} at ${hex(bank)}:${hex(start, 4)}: the game copies stale RAM`);
  o++;
  const out: number[] = [];
  for (;;) {
    const fill = rom[o]!, maskEnd = o + 1 + size / 8;
    let lit = maskEnd;
    for (let m = o + 1; m < maskEnd; m++) {
      const mb = rom[m]!;
      for (let bit = 0; bit < 8; bit++) out.push(mb & (0x80 >> bit) ? rom[lit++]! : fill);
    }
    o = lit;
    if (o >= stop) return Uint8Array.from(out);
  }
}

export interface LayoutInfo { index: number; bank: number; width: number; tiles: number; data: [number, number]; metatiles: number }

export function layoutInfo(rom: Uint8Array, n: number): LayoutInfo {
  const [bank, k] = location(n);
  return { index: n, bank, width: rom[fileOffset(0x07, 0x7ea0) + n]!, tiles: w16(rom, 0x07, 0x7ec0 + 2 * n),
    data: [w16(rom, bank, 0x4000 + 2 * k), w16(rom, bank, 0x4002 + 2 * k)], metatiles: w16(rom, bank, 0x4022 + 2 * k) };
}

export function metatileMap(rom: Uint8Array, n: number): Uint8Array {
  const i = layoutInfo(rom, n);
  return decompress(rom, i.bank, i.data[0], i.data[1]);
}

/** The W-wide tile buffer the game builds at D000 (before flag patches). Metatile m expands
 *  through B:4022 + 2k + 4m as top-left, bottom-left, top-right, bottom-right. */
export function tilemap(rom: Uint8Array, n: number): Uint8Array {
  const i = layoutInfo(rom, n), w = i.width, meta = fileOffset(i.bank, i.metatiles);
  const data = metatileMap(rom, n), buf = new Uint8Array(i.tiles);
  let de = 0;
  for (let k = 0; k < i.tiles >> 2; k++) {
    const b = meta + 4 * data[k]!;
    buf[de] = rom[b]!; buf[de + 1] = rom[b + 2]!; buf[de + w] = rom[b + 1]!; buf[de + w + 1] = rom[b + 3]!;
    de += 2;
    if ((de & (w - 1)) === 0) de += w;
  }
  return buf;
}

/** (story flag or FF = always, pointer in bank 0B) of every patch for a map (0B:78F5). */
export function layoutPatches(rom: Uint8Array, mapId: number): [number, number][] {
  const ids = fileOffset(0x0b, 0x7982), flags = fileOffset(0x0b, 0x79b1), out: [number, number][] = [];
  for (let e = 0; e < PATCH_COUNT; e++) if (rom[ids + e] === mapId) out.push([rom[flags + e]!, w16(rom, 0x0b, 0x79e0 + 2 * e)]);
  return out;
}

/** Story flags at C760: flag f is bit 7 - (f & 7) of byte f >> 3. */
export const flagSet = (flags: Uint8Array, f: number): boolean => !!(flags[f >> 3]! & (0x80 >> (f & 7)));

export function applyPatches(rom: Uint8Array, buf: Uint8Array, width: number, mapId: number, flags: Uint8Array): void {
  for (const [flag, ptr] of layoutPatches(rom, mapId)) {
    if (flag !== 0xff && !flagSet(flags, flag)) continue;
    let o = fileOffset(0x0b, ptr);
    const x = rom[o]!, y = rom[o + 1]!, wh = rom[o + 2]!;
    if (!wh) continue;
    const w = wh >> 4, h = wh & 0x0f;
    o += 3;
    let row = x + y * width;
    for (let r = 0; r < h; r++) {
      // rows past the buffer land in RAM after it (map 11's flag-30 patches reach row 16 of 16)
      const n = Math.max(0, Math.min(w, buf.length - row));
      if (n) buf.set(rom.subarray(o, o + n), row);
      o += w;
      row += width;
    }
  }
}

export function mapTiles(rom: Uint8Array, mapId: number, flags: Uint8Array): { tiles: Uint8Array; width: number } {
  const n = rom[mapOffset(rom, mapId)]! & 0x7f;
  const tiles = tilemap(rom, n), width = layoutInfo(rom, n).width;
  applyPatches(rom, tiles, width, mapId, flags);
  return { tiles, width };
}

const hexBytes = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The data package's layouts: decoded metatile rows (no compressed ROM bytes) and the patch list. */
export function exportLayouts(rom: Uint8Array) {
  const layouts: Record<string, { width_tiles: number; tiles: number; metatile_rows: string[] }> = {};
  for (let n = 1; n <= LAYOUT_COUNT; n++) {
    const i = layoutInfo(rom, n), mm = metatileMap(rom, n), w = i.width / 2;
    layouts[String(n).padStart(2, "0")] = { width_tiles: i.width, tiles: i.tiles,
      metatile_rows: Array.from({ length: Math.floor(mm.length / w) }, (_, y) => hexBytes(mm.subarray(w * y, w * (y + 1)))) };
  }
  const patches: Record<string, [number, string][]> = {};
  for (let m = 0; m < MAP_COUNT; m++) {
    const p = layoutPatches(rom, m);
    if (p.length) patches[hex(m)] = p.map(([f, a]) => [f, hex(a, 4)]);
  }
  return { layouts, patches };
}
