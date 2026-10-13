/** Legend I layout decoder: port of 00:153C (bank 03 command stream -> 64-wide metatile buffer,
 *  62 rows, default metatile 0x1E). Mirrors src/ffl1kster/layout.py, which equals the ROM routine
 *  (SM83 oracle) for every layout. Legend II's layout format is unrelated. */
import { fileOffset } from "./rom.js";

export const LAYOUT_WIDTH = 64, LAYOUT_ROWS = 62, LAYOUT_DEFAULT = 0x1e;

export function decodeLayout(rom: Uint8Array, pointer: number): Uint8Array {
  const buf = new Uint8Array(0x1000).fill(LAYOUT_DEFAULT);
  const W = LAYOUT_WIDTH;
  const h: Record<number, number> = {};
  const pos = (i: number) => ((rom[i]! << 8) | rom[i + 1]!) >> 4;
  const size = (i: number): [number, number] => {
    const e = ((rom[i]! & 0x0f) << 2) | (rom[i + 1]! >> 6);
    const d = rom[i + 1]! & 0x3f;
    return [d || 1, e || 1];
  };
  const put = (a: number, v: number) => { buf[a & 0xfff] = v & 0xff; };
  const addLo = (a: number, n: number) => (a & ~0xff) | ((a + n) & 0xff);
  const rowAlt = (a: number, n: number, c: number) => { for (let k = 0; k < n; k++) { put(a, h[c]!); a++; c ^= 1; } return a; };
  const colAlt = (a: number, n: number, c: number) => { for (let k = 0; k < n; k++) { put(a, h[c]!); a += W; c ^= 1; } };
  const frame = (a: number, w: number, ht: number) => {
    rowAlt(a, w, 0xc1);
    rowAlt(a + (ht - 1) * W, w, 0xc0 | (ht & 1));
    colAlt(a, ht, 0xc1);
    colAlt(addLo(a, w - 1), ht, 0xc0 | (w & 1));
  };
  const fillAlt = (a: number, w: number, ht: number) => {
    let c = 0xc0;
    for (let r = 0; r < ht; r++) { rowAlt(a, w, c); a += W; c ^= 1; }
  };
  const corners = (base: number, w: number, ht: number) => {
    let d = (h[0xc0]! + 1) & 0xff;
    let a = base;
    put(a, d);
    if (w - 1 === 0) { a += (ht - 1) * W; put(a, d + 1); return; }
    a = addLo(a, w - 1); d += 1; put(a, d);
    if (ht - 1 === 0) return;
    a += (ht - 1) * W; d += 2; put(a, d);
    a = addLo(a, -(w - 1)); d -= 1; put(a, d);
  };
  let i = fileOffset(0x03, pointer);
  for (;;) {
    const cmd = rom[i]!;
    const top = cmd & 0xc0;
    if (top === 0xc0) return buf.slice(0, W * LAYOUT_ROWS);
    if (top === 0x00) { put(pos(i + 1), cmd & 0x3f); i += 3; continue; }
    h[0xc0] = cmd & 0x3f;
    const a = pos(i + 1);
    const [w, ht] = size(i + 2);
    if (top === 0x80) {
      let t = h[0xc0]!;
      for (let r = 0; r < ht; r++) for (let k = 0; k < w; k++) put(a + r * W + k, t++);
      i += 4;
    } else {
      const sub = rom[i + 4]!;
      h[0xc1] = sub & 0x3f;
      const shape = sub & 0xc0;
      if (shape === 0x00 || shape === 0x40) frame(a, w, ht); else fillAlt(a, w, ht);
      if (shape === 0x40 || shape === 0xc0) corners(a, w, ht);
      i += 5;
    }
  }
}
