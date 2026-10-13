/** Legend III graphics (docs/ffl3/FINDINGS.md M6), as 2bpp Game Boy tile bytes. Mirrors ffl3kster.gfx.
 *  - Map tilesets (07:7F5B): 03:731C + 2 * layout -> a 6-byte record whose bytes 1-4 name four
 *    512-byte blocks of bank 05, loaded to 9000 (BG tiles 00-7F).
 *  - Font and window tiles: 03:4000-47FF -> 8800 (tiles 80-FF).
 *  - Monster pictures (0B:417D): code 0B:4301 + id (sheet c >> 3, slot c & 7), sheet bank/size
 *    0B:43CC, tile count 0B:43C4 + size, two compressed bitplane spans at 0B:43E4 + 4 * sheet; the
 *    picture is n tiles from slot * n. Sheet 19 (Xagor) has block-size byte FF: not decoded. */
import { fileOffset, u16 } from "./rom.js";
import { decompress } from "./layout.js";
import { mapOffset, MONSTER_COUNT } from "./tables.js";

const FONT = fileOffset(0x03, 0x4000);
const PIC_CODES = fileOffset(0x0b, 0x4301), PIC_SIZES = fileOffset(0x0b, 0x43c4);
const PIC_SHEETS = fileOffset(0x0b, 0x43cc), PIC_POINTERS = fileOffset(0x0b, 0x43e4);
export const PIC_SHEET_COUNT = 24;
export const XAGOR_SHEET = 19;
/** Tiles across, by size code (probable: the decoded pictures are coherent this way). */
export const PIC_COLUMNS: Record<number, number> = { 0: 4, 1: 8, 2: 4, 3: 6, 4: 8, 5: 16 };

export function mapTileset(rom: Uint8Array, mapId: number): Uint8Array {
  const lay = rom[mapOffset(rom, mapId) + 1]!;
  const rec = fileOffset(0x03, u16(rom, fileOffset(0x03, 0x731c + 2 * lay)));
  const out = new Uint8Array(0x800);
  for (let k = 0; k < 4; k++) { const o = fileOffset(0x05, rom[rec + 1 + k]! << 8); out.set(rom.subarray(o, o + 0x200), 0x200 * k); }
  return out;
}

export const font = (rom: Uint8Array): Uint8Array => rom.slice(FONT, FONT + 0x800);

/** A sheet's tiles: bitplane 0 and bitplane 1 decompressed separately, interleaved per row. */
export function pictureSheet(rom: Uint8Array, sheet: number): Uint8Array[] {
  const bank = rom[PIC_SHEETS + sheet]! >> 4, p = PIC_POINTERS + 4 * sheet;
  const a0 = u16(rom, p), a1 = u16(rom, p + 2), a2 = u16(rom, p + 4);
  const lo = decompress(rom, bank, a0, a1), hi = decompress(rom, bank, a1, a2);
  return Array.from({ length: Math.floor(lo.length / 8) }, (_, t) => {
    const tile = new Uint8Array(16);
    for (let r = 0; r < 8; r++) { tile[2 * r] = lo[8 * t + r]!; tile[2 * r + 1] = hi[8 * t + r]!; }
    return tile;
  });
}

export interface Picture { id: number; sheet: number; slot: number; tiles: number; columns: number; data: Uint8Array }

export function picture(rom: Uint8Array, id: number): Picture {
  const c = rom[PIC_CODES + id]!, sheet = c >> 3, slot = c & 7, size = rom[PIC_SHEETS + sheet]! & 0x0f;
  const n = rom[PIC_SIZES + size]!;
  const tiles = pictureSheet(rom, sheet).slice(slot * n, slot * n + n);
  const data = new Uint8Array(16 * tiles.length);
  tiles.forEach((t, k) => data.set(t, 16 * k));
  return { id, sheet, slot, tiles: tiles.length, columns: PIC_COLUMNS[size]!, data };
}

export const pictureSheetOf = (rom: Uint8Array, id: number): number => rom[PIC_CODES + id]! >> 3;

/** Every monster picture the importer can decode (all but Xagor's sheet). */
export function pictures(rom: Uint8Array): Picture[] {
  const out: Picture[] = [];
  for (let id = 0; id < MONSTER_COUNT; id++) if (pictureSheetOf(rom, id) !== XAGOR_SHEET) out.push(picture(rom, id));
  return out;
}
