/** Legend I map buffer and metatile attributes (bank 0): the layout drawer 00:153C (bank 03
 *  command stream -> D000, 64 x 62 metatiles), cell access 00:13B0, attributes 00:13ED (DF80 +
 *  2m: e, d), passability 00:13FA. The layout format is Legend I's own (docs/ffl1/FINDINGS.md). */
import type { Game } from "../game.js";
import type { Memory } from "../memory.js";

export const MAP_W = 64, MAP_H = 62;

/** 00:13B0 — cell (row e, column d): [address, value]; outside the map: value 0x1E, address null. */
export function cell(m: Memory, e: number, d: number): [number | null, number] {
  if (e >= 0x3e || d >= 0x40) return [null, 0x1e];
  const a = 0xd000 + ((e << 6) | d);
  return [a, m.rd(a)];
}
export const cellValue = (m: Memory, e: number, d: number): number => cell(m, e, d)[1];

/** 00:13F0 — attribute pair (e, d) of metatile value v: DF80 + (2v | 0x80) & 0xFF. */
export function attrOf(m: Memory, v: number): [number, number] {
  const l = ((v * 2) | 0x80) & 0xff;
  return [m.rd(0xdf00 | l), m.rd(0xdf00 | ((l + 1) & 0xff))];
}
/** 00:13ED — attributes of the cell at (row e, column d). */
export const cellAttr = (m: Memory, e: number, d: number): [number, number] => attrOf(m, cellValue(m, e, d));

/** 00:13FA — passability of the cell: { blocked (nz), e, d }. e bit 6: blocked (event tile,
 *  returns 1); e & 0xB0: free (0); else d & mask[CCC1] (00:1538, by movement mode). */
export function passable(m: Memory, row: number, col: number): { nz: boolean; a: number; e: number; d: number } {
  const [e, d] = cellAttr(m, row, col);
  if (e & 0x40) return { nz: true, a: 1, e, d };
  if (e & 0xb0) return { nz: false, a: 0, e, d };
  const a = m.rd(0x1538 + m.rd(0xccc1)) & d;
  return { nz: a !== 0, a, e, d };
}

/** 00:153C — draw the layout at bank 03:hl into D000 (filled with 0x1E first). Leaves bank 03
 *  selected and FFC0-FFC5 as the routine does (tiles A/B, last block address, height, width). */
export function drawLayout(g: Game, hl: number): void {
  const m = g.m;
  g.selectBank(0x03);
  for (let a = 0xd000; a < 0xdf80; a++) m.wr(a, 0x1e);
  const W = 0x40;
  const H = m.hram;
  const put = (a: number, v: number) => m.wr(0xd000 + (a & 0xfff), v);
  const pos = (i: number) => ((m.rd(i) << 8) | m.rd(i + 1)) >> 4;
  const size = (i: number): [number, number] => {
    const e = ((m.rd(i) & 0x0f) << 2) | (m.rd(i + 1) >> 6);
    const d = m.rd(i + 1) & 0x3f;
    return [d || 1, e || 1];
  };
  const addLo = (a: number, n: number) => (a & ~0xff) | ((a + n) & 0xff);
  const rowAlt = (a: number, n: number, c: number) => { for (let k = 0; k < n; k++) { put(a, H[c]!); a++; c ^= 1; } };
  const colAlt = (a: number, n: number, c: number) => { for (let k = 0; k < n; k++) { put(a, H[c]!); a += W; c ^= 1; } };
  let i = hl;
  for (;;) {
    const cmd = m.rd(i);
    const top = cmd & 0xc0;
    if (top === 0xc0) return;
    if (top === 0x00) { put(pos(i + 1), cmd & 0x3f); i += 3; continue; }
    H[0x40] = cmd & 0x3f;
    const a = pos(i + 1);
    const [w, h] = size(i + 2);
    if (top === 0x80) {
      let t = H[0x40]!;
      for (let r = 0; r < h; r++) for (let k = 0; k < w; k++) put(a + r * W + k, t++);
      i += 4;
      continue;
    }
    const b = 0xd0 + (a >> 8);
    H[0x42] = a & 0xff; H[0x43] = b & 0xff; H[0x44] = h & 0xff; H[0x45] = w & 0xff;
    const sub = m.rd(i + 4);
    H[0x41] = sub & 0x3f;
    const shape = sub & 0xc0;
    if (shape === 0x00 || shape === 0x40) {
      rowAlt(a, w, 0x41);
      rowAlt(a + (h - 1) * W, w, 0x40 | (h & 1));
      colAlt(a, h, 0x41);
      colAlt(addLo(a, w - 1), h, 0x40 | (w & 1));
    } else {
      let c = 0x40, p = a;
      for (let r = 0; r < h; r++) { rowAlt(p, w, c); p += W; c ^= 1; }
    }
    if (shape === 0x40 || shape === 0xc0) {
      // 00:163B corners
      let d = (H[0x40]! + 1) & 0xff, p = a;
      put(p, d);
      if (w - 1 === 0) { p += (h - 1) * W; put(p, d + 1); }
      else {
        p = addLo(p, w - 1); d++; put(p, d);
        if (h - 1 !== 0) { p += (h - 1) * W; d += 2; put(p, d); p = addLo(p, -(w - 1)); d--; put(p, d); }
      }
    }
    i += 5;
  }
}
