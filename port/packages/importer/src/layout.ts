/** Map layout command streams (drawer 00:2253): parser and bit-exact renderer.
 *  Port of ffl2kster.layout (verified against the ROM routine; see docs/FINDINGS.md). */

export const CIRCLE_TABLE = 0x2670;

export function layoutOffset(layoutPtr: number): number {
  return layoutPtr & 0x4000 ? 0x09 * 0x4000 + (layoutPtr & 0xffff) - 0x4000 : 0x08 * 0x4000 + layoutPtr;
}

export type LayoutOp =
  | { op: "end" }
  | { op: "tile"; offset: number; tile: number }
  | { op: "cursor"; x: number; y: number }
  | { op: "rect" | "fill_rect" | "circle" | "line" | "line_cont"; x: number; y: number; tiles: [number, number] }
  | { op: "fill"; tiles: [number, number] }
  | { op: "flood"; tile: number }
  | { op: "if_var"; var: number; min: number; max: number }
  | { op: string };

function pos(n: number, c: number): [number, number] {
  const w = ((n << 8) | c) << 2;
  return [c & 0x3f, (w >> 8) & 0x3f];
}

function tiles(rom: Uint8Array, p: number): [number, number, number] {
  const t = rom[p]!;
  if ((t & 0xc0) === 0) return [t, t, p + 1];
  return [t & 0x3f, rom[p + 1]!, p + 2];
}

export function circleTable(rom: Uint8Array, r: number): [number, number][] {
  let p = rom[CIRCLE_TABLE + 2 * (r - 1)]! | (rom[CIRCLE_TABLE + 2 * (r - 1) + 1]! << 8);
  const out: [number, number][] = [];
  while (rom[p] !== 0xff) {
    out.push([rom[p]!, rom[p + 1]!]);
    p += 2;
  }
  return out;
}

const NAMES: Record<number, "rect" | "fill_rect" | "circle" | "line" | "line_cont"> = { 3: "rect", 4: "fill_rect", 5: "circle", 6: "line", 9: "line_cont" };

export function parseLayout(rom: Uint8Array, offset: number): LayoutOp[] {
  const ops: LayoutOp[] = [];
  let p = offset;
  for (;;) {
    const b = rom[p]!, c = rom[p + 1]!;
    const op = b >> 4, n = b & 0x0f;
    p += 2;
    if (op === 0) {
      ops.push({ op: "end" });
      break;
    }
    const [x, y] = pos(n, c);
    if (op === 1) {
      ops.push({ op: "tile", offset: (n << 8) | c, tile: rom[p]! & 0x3f });
      p += 1;
    } else if (op === 2) ops.push({ op: "cursor", x, y });
    else if (NAMES[op]) {
      const [e, d, np] = tiles(rom, p);
      p = np;
      ops.push({ op: NAMES[op]!, x, y, tiles: [e, d] });
    } else if (op === 7) ops.push({ op: "fill", tiles: [x, y] });
    else if (op === 8) ops.push({ op: "flood", tile: x });
    else if (op === 10) ops.push({ op: "if_var", var: n, min: c >> 4, max: c & 0x0f });
    else {
      ops.push({ op: `unknown_${op}` });
      break;
    }
  }
  return ops;
}

class Grid {
  m = new Uint8Array(4096);
  budget = 1_000_000;
  static addr(x: number, y: number): number {
    const hi = 0xd0 + (y >> 2);
    const lo = (((y & 3) << 6) | x) & 0xff;
    return ((hi << 8) | lo) - 0xd000;
  }
  get(x: number, y: number): number {
    const a = Grid.addr(x & 0xff, y & 0xff);
    return a >= 0 && a < 4096 ? this.m[a]! : 0;
  }
  put(x: number, y: number, t: number): void {
    if (--this.budget < 0) throw new Error("layout drawing does not terminate");
    const a = Grid.addr(x & 0xff, y & 0xff);
    if (a >= 0 && a < 4096) this.m[a] = t & 0xff;
  }
}

export interface RenderOptions {
  /** 32 progress-variable nibbles (default all 0). */
  vars?: ArrayLike<number>;
  /** Header flags & 0x0F: metatiles 3..3+n-1 become trigger tiles 0x40|k (00:2647). */
  triggerCount?: number;
  /** Receives the original metatile of each trigger tile (C500+k). */
  saved?: Uint8Array;
  cursor?: [number, number];
  lastEnd?: [number, number];
}

export function renderLayout(rom: Uint8Array, offset: number, opts: RenderOptions = {}): Uint8Array {
  const vars = opts.vars ?? new Array<number>(32).fill(0);
  const g = new Grid();
  let cur: [number, number] = [...(opts.cursor ?? [0, 0])];
  let last: [number, number] = [...(opts.lastEnd ?? [0, 0])];
  let p = offset;
  for (;;) {
    const b = rom[p]!, c = rom[p + 1]!;
    const op = b >> 4, n = b & 0x0f;
    p += 2;
    if (op === 0) break;
    if (op === 1) {
      g.m[(n << 8) | c] = rom[p]! & 0x3f;
      p += 1;
      continue;
    }
    const [x, y] = pos(n, c);
    if (op === 2) {
      cur = [x, y];
      continue;
    }
    if (op === 7) {
      let t1 = x, t2 = y;
      for (let row = 0; row < 64; row++) {
        for (let col = 0; col < 64; col += 2) {
          g.m[row * 64 + col] = t1;
          g.m[row * 64 + col + 1] = t2;
        }
        [t1, t2] = [t2, t1];
      }
      continue;
    }
    if (op === 8) {
      flood(g, cur[0], cur[1], x);
      continue;
    }
    if (op === 10) {
      const v = (vars[n & 0x1f] ?? 0) & 0x0f;
      if ((c & 0x0f) < v) break;
      if (c >> 4 <= v) continue;
      break;
    }
    if (!NAMES[op]) break;
    const [e, d, np] = tiles(rom, p);
    p = np;
    if (op === 3) rect(g, cur, x, y, e, d);
    else if (op === 4) fillRect(g, cur, x, y, e, d);
    else if (op === 5) circle(rom, g, cur, x, y, e);
    else {
      const start = op === 6 ? cur : last;
      last = [x, y];
      line(g, start, x, y, e, d);
    }
  }
  if (opts.triggerCount) triggers(g, opts.triggerCount, opts.saved);
  return g.m;
}

function order(cur: [number, number], x: number, y: number): [number, number, number, number] {
  let l = cur[0], h = cur[1], c = x, b = y;
  if (!(l < c)) [l, c] = [c, l];
  if (!(h < b)) [h, b] = [b, h];
  return [l, h, c, b];
}

function rect(g: Grid, cur: [number, number], x: number, y: number, e: number, d: number): void {
  let [l, h, c, b] = order(cur, x, y);
  const minx = l, miny = h;
  for (;;) { g.put(l, h, e); if ((l & 0xff) === c) break; [e, d] = [d, e]; l = (l + 1) & 0xff; }
  for (;;) { g.put(l, h, e); if ((h & 0xff) === b) break; [e, d] = [d, e]; h = (h + 1) & 0xff; }
  for (;;) { g.put(l, h, e); if ((l & 0xff) === minx) break; [e, d] = [d, e]; l = (l - 1) & 0xff; }
  for (;;) { g.put(l, h, e); if ((h & 0xff) === miny) break; [e, d] = [d, e]; h = (h - 1) & 0xff; }
}

function fillRect(g: Grid, cur: [number, number], x: number, y: number, e: number, d: number): void {
  let [l, h, c, b] = order(cur, x, y);
  for (;;) {
    const rowL = l, rowE = e, rowD = d;
    for (;;) { g.put(l, h, e); if ((l & 0xff) === c) break; [e, d] = [d, e]; l = (l + 1) & 0xff; }
    l = rowL; e = rowE; d = rowD;
    if ((h & 0xff) === b) break;
    [e, d] = [d, e];
    h = (h + 1) & 0xff;
  }
}

function line(g: Grid, start: [number, number], x: number, y: number, e: number, d: number): void {
  let [l, h] = start;
  let dx = (x - l) & 0xff, dy = (y - h) & 0xff;
  let sx = 1, sy = 1, stx = 1, sty = 1;
  if (dx >= 0x80) { dx = -dx & 0xff; sx = stx = 0xff; }
  if (dy >= 0x80) { dy = -dy & 0xff; sy = sty = 0xff; }
  let major: number, minor: number;
  if (dx >= dy) { major = dx; minor = dy; sty = 0; } else { major = dy; minor = dx; stx = 0; }
  let acc = major >> 1 || 1;
  for (;;) {
    g.put(l, h, e);
    [e, d] = [d, e];
    if (l === x && h === y) break;
    acc = (acc + minor) & 0xff;
    if (major >= acc) { l = (l + stx) & 0xff; h = (h + sty) & 0xff; }
    else { l = (l + sx) & 0xff; h = (h + sy) & 0xff; acc = (acc - major) & 0xff; }
  }
}

/** 00:24CC: 16-bit / 8-bit restoring division exactly as coded (r = 0 gives 0xFFFF). */
function udiv(v: number, r: number): number {
  let a = 0, q = 0;
  for (let i = 0; i < 16; i++) {
    a = ((a << 1) | (v >> 15)) & 0xff;
    v = (v << 1) & 0xffff;
    const bit = a >= r ? 1 : 0;
    q = ((q << 1) | bit) & 0xffff;
    if (bit) a = (a - r) & 0xff;
  }
  return q;
}

function sdiv(v: number, r: number): number {
  v &= 0xffff;
  if (v >= 0x8000) return (0x10000 - udiv((0x10000 - v) & 0xffff, r)) & 0xffff;
  return udiv(v, r);
}

function circle(rom: Uint8Array, g: Grid, cur: [number, number], x: number, y: number, tile: number): void {
  const [l, h] = cur;
  const c = (x - l) & 0xff, b = (y - h) & 0xff;
  const ax = c < 0x80 ? c : -c & 0xff;
  const ay = b < 0x80 ? b : -b & 0xff;
  const r = (ax + ay) & 0xff;
  if (r && r < 8) {
    for (const [oc, ob] of circleTable(rom, r)) {
      for (const [px0, py0] of [[l + oc, h + ob], [l + ob, h - oc], [l - oc, h - ob], [l - ob, h + oc]] as const) {
        const px = px0 & 0xff, py = py0 & 0xff;
        if (px < 0x40 && py < 0x40) g.put(px, py, tile);
      }
    }
    return;
  }
  let count = (r * 8 + 1) & 0xffff;
  let bc = (c << 8) & 0xffff, de = (b << 8) & 0xffff;
  for (;;) {
    bc = (bc + sdiv(de, r)) & 0xffff;
    de = (de - sdiv(bc, r)) & 0xffff;
    const px = (l + (bc >> 8)) & 0xff;
    if (px < 0x40) {
      const py = (h + (de >> 8)) & 0xff;
      if (py < 0x40) g.put(px, py, tile);
    }
    count = (count - 1) & 0xffff;
    if (count === 0) break;
  }
}

function flood(g: Grid, cx: number, cy: number, tile: number): void {
  const d = g.get(cx, cy);
  const row = (c: number, b: number) => {
    let x = c;
    for (;;) { if (g.get(x, b) !== d) break; g.put(x, b, tile); x = (x + 1) & 0xff; if (x >= 0x40) break; }
    x = (c - 1) & 0xff;
    for (;;) { if (g.get(x, b) !== d) break; g.put(x, b, tile); x = (x - 1) & 0xff; if (x >= 0x40) break; }
  };
  let b = cy;
  for (;;) { if (g.get(cx, b) !== d) break; row(cx, b); b = (b + 1) & 0xff; if (b >= 0x40) break; }
  b = (cy - 1) & 0xff;
  for (;;) { if (g.get(cx, b) !== d) break; row(cx, b); b = (b - 1) & 0xff; if (b >= 0x40) break; }
}

function triggers(g: Grid, k: number, saved?: Uint8Array): void {
  const hi = k + 3;
  let idx = 0;
  for (let a = 0; a < 4096; a++) {
    const v = g.m[a]!;
    const t = v & 0x1f;
    if (t >= 3 && t < hi) {
      if (saved) saved[idx & 0xff] = v;
      g.m[a] = ((v & 0x20) | 0x40 | (idx & 0xff)) & 0xff;
      idx++;
    }
  }
}
