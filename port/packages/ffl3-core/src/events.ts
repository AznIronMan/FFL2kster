/** Legend III scene events (docs/ffl3/FINDINGS.md M3/M5): script references (00:2EF6/2EF8),
 *  the scene commands of the text engine (0B:6C35), and the event dispatcher 00:1236 (type =
 *  CA29 & 3F, parameter CA28). */
import type { Game, Co } from "./game.js";
import { pushBank, popBank, far0, farcall } from "./sys.js";
import { NotPorted } from "./irq.js";
import { loadMap, leaderLook } from "./mapload.js";
import { windowClose } from "./window.js";
import { printText } from "./text.js";
import { battleEvent } from "./battle.js";

/** 0B:6C4C — text codes handled as scene events: code -> event type. */
const SCENE_TYPE: Record<number, number> = { 0x32: 0x26, 0x3d: 0x28, 0x3b: 0x27, 0x13: 0x1d, 0x12: 0x1c, 0x3f: 0x1b,
  0x0a: 0x10, 0x0d: 0x0e, 0x38: 0x12 };

/** 0B:6C35 — a scene command of the text: the reference (op, type) through 00:2EF6. */
export function* sceneCode(g: Game, code: number, op: number): Co {
  const t = SCENE_TYPE[code];
  if (t === undefined) throw new Error(`no scene type for code ${code.toString(16)}`);
  yield* reference(g, 0x40, op, t);
}

/** 00:2EF8 — the 2-byte script reference at hl (lo, hi); returns hl after it. */
export function* scriptRef(g: Game, e: number, hl: number): Co<number> {
  const m = g.m;
  const lo = m.rd(hl), hi = m.rd(hl + 1);
  yield* reference(g, e, lo, hi);
  return (hl + 2) & 0xffff;
}

/** 00:2EF8 with the operands in hand: CA28 = lo; hi < 40 is a scene event (CA29 = hi, 0F:7DD4,
 *  00:1236); else a text in bank 09 (hi 40-7F), 0A (80-BF: | 40) or 03 (C0-FF: & 7F) drawn with
 *  mode e in the box (1,1) 18 x 6. */
export function* reference(g: Game, e: number, lo: number, hi: number): Co {
  const m = g.m;
  m.wr(0xca28, lo);
  if (hi < 0x40) {
    m.wr(0xca29, hi);
    yield* farcall(g, 0x0f, () => beforeEvent(g, hi));
    yield* dispatch(g);
    return;
  }
  let h = hi, bank = 0x09;
  if (h & 0x80) {
    h &= 0x7f;
    if (!(h & 0x40)) { h |= 0x40; bank = 0x0a; } else bank = 0x03;
  }
  const addr = (h << 8) | lo;
  yield* far0(g, bank, () => printText(g, e, addr, 0x0101, 0x0612));
}

/** 0F:7DD4 — before an event: types below 10 and 11, 17, 1B, 1E, 1F, 27, 28 close the text
 *  window first (00:35D2). */
function* beforeEvent(g: Game, t: number): Co {
  if (t < 0x10 || [0x11, 0x17, 0x1b, 0x1e, 0x1f, 0x27, 0x28].includes(t)) yield* windowClose(g);
}

/** 00:1236 — the event CA29 & 3F (CD3D cleared meanwhile), then 00:12CA: C2F0 C0-type cleared,
 *  CD3D back. */
export function* dispatch(g: Game): Co {
  const m = g.m;
  const cd3d = m.rd(0xcd3d);
  m.wr(0xcd3d, 0);
  const t = m.rd(0xca29) & 0x3f;
  switch (t) {
    case 0x0d: m.wr(0xca59, 1); yield* door(g); break;
    case 0x0e: yield* door(g); break;
    case 0x12: yield* special(g); break;
    case 0x1b: yield* battleEvent(g); break;
    case 0x06: case 0x07: break;
    default:
      if (t >= 0x2d && t !== 0x2f && t !== 0x3f) break;
      throw new NotPorted(`event type ${t.toString(16).padStart(2, "0")}`);
  }
  if ((m.rd(0xc2f0) & 0xc0) === 0xc0) m.wr(0xc2f0, 0);
  m.wr(0xcd3d, cd3d);
}

/** 00:1389 — door CA28 (06:6BA4 + 3 (n - 1): map, y, x with the high bits and the facing,
 *  00:1468) after 00:1B64 (the return point C7C9-C7CB for maps below 0A), then the map load. */
function* door(g: Game): Co {
  const m = g.m;
  pushBank(g, 0x06);
  let hl = (0x6ba4 + 3 * ((m.rd(0xca28) - 1) & 0xff)) & 0xffff;
  returnPoint(g);
  m.wr(0xc6e8, m.rd(hl++));
  let b = 0;
  let v = m.rd(hl++);
  b = ((b >> 1) | (v & 0x80)) & 0xff;
  v = m.rd(hl--);
  b = ((b >> 1) | (v & 0x80)) & 0xff;
  m.wr(0xc6ee, b);
  v = m.rd(hl);
  m.wr(0xc6e4, (v << 4) & 0xf0);
  m.wr(0xc6e5, (v >> 4) & 0x07);
  hl++;
  v = m.rd(hl);
  m.wr(0xc6e6, (v << 4) & 0xf0);
  m.wr(0xc6e7, (v >> 4) & 0x07);
  popBank(g);
  yield* loadMap(g);
}

/** 00:1B64 — leaving a map below 0A: C7CB = map, C6F7 = facing + 80, C7C9 / C7CA = the cell
 *  (y, x), one step back against the facing. */
function returnPoint(g: Game): void {
  const m = g.m;
  const map = m.rd(0xc6e8);
  if (map >= 0x0a) return;
  m.wr(0xc7cb, map);
  m.wr(0xc6f7, m.rd(0xc6ee) + 0x80);
  const sw = (v: number) => ((v << 4) | (v >> 4)) & 0xff;
  m.wr(0xc7c9, sw(m.rd(0xc6e4)) | sw(m.rd(0xc6e5)));
  m.wr(0xc7ca, sw(m.rd(0xc6e6)) | sw(m.rd(0xc6e7)));
  const f = m.rd(0xc6f7);
  if (f === 0x00) m.wr(0xc7c9, (m.rd(0xc7c9) - 1) & 0x3f);
  else if (f === 0x40) m.wr(0xc7ca, (m.rd(0xc7ca) + 1) & 0x3f);
  else if (f === 0x80) m.wr(0xc7c9, (m.rd(0xc7c9) + 1) & 0x3f);
  else m.wr(0xc7ca, (m.rd(0xc7ca) - 1) & 0x3f);
}

/** 00:16B9 — event type 12, special CA28: 00 CA00 = 1 (the leader starts hidden), 01 walking
 *  again (C6E3 = 0, 00:08AD), 02 nothing, ... */
function* special(g: Game): Co {
  const m = g.m;
  const k = m.rd(0xca28);
  if (k === 0x00) { m.wr(0xca00, 1); return; }
  if (k === 0x01) { m.wr(0xc6e3, 0); yield* leaderLook(g); return; }
  if (k === 0x02) return;
  throw new NotPorted(`event 12 special ${k.toString(16).padStart(2, "0")} (00:16B9)`);
}

