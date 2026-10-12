/** Field map buffer (D000-DFFF, 64x64 metatiles) and metatile lookups (bank 0, 00:2636 etc.).
 *  A map byte: bit 7 = occupied (player, NPC, vehicle); bits 0-6 = metatile, where values
 *  >= 0x40 are trigger cells whose real metatile is saved in C500 + (v & 0x1F).
 *  A metatile value: bits 0-4 index into the tileset (attributes at C520), bit 5 = second
 *  ("hidden") layer, shown only while C43C has the same bit. */
import type { Memory } from "../memory.js";

/** 1A71: (0,0) then the step table 1A73 indexed by facing: 0 down, 1 up, 2 left, 3 right. */
export const DIR_DX = [0, 0, -1, 1] as const;
export const DIR_DY = [1, -1, 0, 0] as const;

/** 00:2636 — address of map cell (x, y) as the game computes it (BC on return). */
export function cellAddr(x: number, y: number): number {
  const lo = (((y & 3) << 6) | x) & 0xff;
  const hi = (((y & 0xff) >> 2) + 0xd0) & 0xff;
  return (hi << 8) | lo;
}

export const cellGet = (m: Memory, x: number, y: number): number => m.rd(cellAddr(x, y));
export const cellSet = (m: Memory, x: number, y: number, v: number): void => m.wr(cellAddr(x, y), v);

export function cellMark(m: Memory, x: number, y: number, occupied: boolean): void {
  const a = cellAddr(x, y);
  m.wr(a, occupied ? m.rd(a) | 0x80 : m.rd(a) & 0x7f);
}

/** 00:2946 — metatile value of a map byte (resolving trigger cells via C500). */
export function resolveMeta(m: Memory, v: number): number {
  v &= 0x7f;
  if (v < 0x40) return v;
  return m.rd(0xc500 + (v & 0x1f));
}

/** C520 + (meta & 0x1F): tile attributes of the current tileset. */
export const attrOf = (m: Memory, meta: number): number => m.rd(0xc520 + (meta & 0x1f));

/** 00:21A0 — metatile to draw for a map byte: the cell's metatile when its layer matches C43C,
 *  (with the layer bit removed: layer ^ v) when its layer matches C43C, else metatile 1 (inside
 *  the hidden layer) or 2 (outside). */
export function displayMeta(m: Memory, v: number): number {
  for (;;) {
    v &= 0x7f;
    if (v < 0x40) break;
    v = m.rd(0xc500 + (v & 0x1f));
  }
  const layer = m.rd(0xc43c);
  // 21AB: ret c returns A = layer ^ v (the metatile with the layer bit cleared when it matches)
  if (((layer ^ v) & 0xff) < 0x20) return (layer ^ v) & 0xff;
  const a = ((((layer >> 4) | (layer << 4)) & 0xff) - 1) & 0xff;
  return a === 1 ? 1 : 2;
}

/** 00:29B3 — map coordinates of the player's cell plus (dx, dy): (C42C + C42E/16 + dx,
 *  C42D + C42F/16 + dy), 8-bit. */
export function playerCell(m: Memory, dx = 0, dy = 0): [number, number] {
  const x = ((m.rd(0xc42e) >> 4) + dx + m.rd(0xc42c)) & 0xff;
  const y = ((m.rd(0xc42f) >> 4) + dy + m.rd(0xc42d)) & 0xff;
  return [x, y];
}

/** Out-of-map test used before cell access: (x | y) & 0xC0. */
export const offMap = (x: number, y: number): boolean => ((x | y) & 0xc0) !== 0;
