/** Replay a Legend I PyBoy trace through the engine and compare every frame wait and screen.
 *  Synchronised on the original's frame waits (rst $10): the i-th wait of the engine is matched
 *  with the i-th one recorded; frames the original spent without waiting (CPU-bound stretches,
 *  e.g. VRAM copies paced by the 00:069F handler) are run as busy frames. Same method as
 *  @ffl2k/parity's replay (the TOL engine core's harness), with Legend I's handlers and RAM. */
import { VSYNC, SoftReset, type Co } from "@ffl1k/core";
import { Ppu, regsFromIo } from "@ffl2k/render";
import { Rig, loadRom, loadTrace, buttonBits, screenDiff, FRAME_BYTES, tickInFrame, type Trace } from "./index.js";

export interface WaitDiff {
  wait: number;
  frame: number;
  diff: number[];
  values: [number, number, number, number][];
}

export interface FrameDiff {
  frame: number;
  pixels: number;
  got?: Uint8Array;
  raster?: boolean;
}

export interface ReplayOptions {
  /** The coroutine to start after the snapshot is loaded (default: by the trace's hook: the
   *  title 03:7D50, or the field loop 00:1243). */
  start?: (rig: Rig) => Co;
  busyFrames?: boolean;
  ignore?: (addr: number) => boolean;
  setup?: (rig: Rig) => void;
  keepGoing?: boolean;
  watch?: (wait: number, frame: number, exp: Uint8Array, got: Uint8Array) => void;
  /** Stop after this many waits (debugging). */
  maxWaits?: number;
  /** Joypad re-phasing (default true). */
  rephase?: boolean;
  /** Every frame the port drew (debugging). */
  onFrame?: (frame: number, got: Uint8Array) => void;
  /** Accept frames the original finished drawing during the display (splitTear; default true),
   *  counted in `tears`. */
  tears?: boolean;
}

export interface ReplayResult {
  trace: Trace; diffs: FrameDiff[]; waits: WaitDiff[]; nWaits: number; tickPhase: number; busy: number;
  lateWrites: number; rephased: number; tears: number; rasterEdges: number; lcdBlanks: number; error?: { message: string; wait: number };
}

/** A polled raster's register write lands some cycles after the line change (the polling loop's
 *  latency, CPU time the port does not model), on either side of the point where the line's
 *  registers are taken: accept a frame when every differing line equals the port's frame drawn
 *  with that line taking the previous or the next line's registers. */
export function rasterRows(rig: { redraw(y: number, src: number): Uint8Array; ppu: { frame: Uint8Array } }, exp: Uint8Array): boolean {
  const W = 160, got = rig.ppu.frame;
  const same = (a: Uint8Array, y: number) => { for (let x = 0; x < W; x++) if (a[y * W + x] !== exp[y * W + x]) return false; return true; };
  // a few lines at most: a systematic line offset in the port must not pass
  let n = 0;
  for (let y = 0; y < 144; y++) if (!same(got, y)) n++;
  if (n === 0 || n > RASTER_ROWS) return false;
  for (let y = 0; y < 144; y++) {
    if (same(got, y)) continue;
    if (y > 0 && same(rig.redraw(y, y - 1), y)) continue;
    if (y < 143 && same(rig.redraw(y, y + 1), y)) continue;
    return false;
  }
  return true;
}
/** The most lines rasterRows accepts in one frame. */
export const RASTER_ROWS = 8;

/** A frame whose writes the original finished during the display (its code ran longer than the
 *  vertical blank; CPU time is not modelled): from some line L on, every line is the port's
 *  picture (`got`, or `latched`: the same state drawn with the window still on from the frame's
 *  start: the DMG keeps a window that has started for the rest of the frame when WY is moved
 *  below the current line), and every pixel above L is the old picture (`olds`: the port's last
 *  picture, the original's previous frame) or already the new one (writes in progress). */
export function splitTear(exp: Uint8Array, got: Uint8Array, latched: Uint8Array | null, olds: Uint8Array[]): boolean {
  const W = 160, H = 144;
  const rowEq = (a: Uint8Array, y: number) => { for (let x = 0; x < W; x++) if (a[y * W + x] !== exp[y * W + x]) return false; return true; };
  let L = H;
  while (L > 0 && (rowEq(got, L - 1) || (latched !== null && rowEq(latched, L - 1)))) L--;
  if (L === 0 || L === H) return false;
  for (let i = 0; i < L * W; i++) {
    const v = exp[i];
    if (v !== got[i] && !(latched && v === latched[i]) && !olds.some((o) => o[i] === v)) return false;
  }
  return true;
}

export function lateWrite(got: Uint8Array, exp: Uint8Array, prev: Uint8Array): boolean {
  const W = 160;
  let y0 = 144;
  for (let y = 143; y >= 0; y--) {
    let same = true;
    for (let x = 0; x < W && same; x++) same = got[y * W + x] === exp[y * W + x];
    if (!same) break;
    y0 = y;
  }
  if (y0 === 0 || y0 === 144) return false;
  for (let i = 0; i < y0 * W; i++) if (exp[i] !== prev[i]) return false;
  return true;
}

/** The port's entry point for a trace hook. */
export function startFor(rig: Rig, hook: string): Co {
  switch (hook) {
    case "03:7D50": return rig.engine.fromTitle();
    case "00:1243": return rig.engine.field.loop();
    default: throw new Error(`no port entry point for hook ${hook}`);
  }
}

export function replay(name: string, opts: ReplayOptions = {}): ReplayResult {
  const t = loadTrace(name);
  const rig = new Rig(loadRom());
  const m = rig.g.m;
  m.loadFull(t.start);
  opts.setup?.(rig);
  rig.g.start(opts.start ? opts.start(rig) : startFor(rig, t.meta.hook));
  let lateWrites = 0;
  let error: { message: string; wait: number } | undefined;
  let lastGot: Uint8Array | null = t.prevScreen ?? null;
  const n = t.meta.frames.length;
  const wf = t.waitFrames;
  const ign = opts.ignore ?? IGNORE;
  const diffs: FrameDiff[] = [];
  const waits: WaitDiff[] = [];
  let nWaits = 0, f = -1, tickPhase = 0, busy = 0, rephased = 0, tears = 0, rasterEdges = 0, lcdBlanks = 0;
  const latchPpu = new Ppu(m.vram, m.oam);
  let lastDrawn = -1;
  let pre: Uint8Array | null = null;
  const btn = (k: number) => buttonBits(t.meta.frames[Math.min(Math.max(k, 0), n - 1)]!.btn);
  rig.g.onWait = (kind) => {
    const prev = f;
    f = kind === VSYNC && nWaits < wf.length ? wf[nWaits]! : f + 1;
    if (opts.busyFrames !== false && f - prev > 1) {
      const nb = f - prev - 1;
      rig.g.busyFrames = nb;
      rig.g.onBusyFrame = (k) => {
        rig.g.buttons = btn(prev + 1 + k);
        if (k === nb - 1) rig.g.onFrameDone = () => { rig.g.buttons = btn(f); rig.g.onFrameDone = null; };
        return tickInFrame(t, prev + 1 + k);
      };
      busy += nb;
    }
    rig.g.buttons = btn(f);
    pre = kind === VSYNC ? m.snapshotFull() : null;
  };
  const compare = (exp: Uint8Array, got: Uint8Array): number[] => {
    const diff: number[] = [];
    for (let a = 0; a < 0x8000; a++) {
      const addr = 0x8000 + a;
      if (addr >= 0xa000 && addr < 0xc000) continue;
      if (addr >= 0xe000 && addr < 0xfe00) continue;
      if (addr >= 0xfea0 && addr < 0xff00) continue;
      if (got[a] !== exp[a] && !ign(addr)) diff.push(addr);
    }
    return diff;
  };
  rig.g.onYield = (kind) => {
    if (kind !== VSYNC) return;
    const i = nWaits++;
    if ((i + 1) * 0x8000 > t.waits.length) return;
    const exp = t.waits.subarray(i * 0x8000, (i + 1) * 0x8000);
    const got = m.snapshotFull();
    opts.watch?.(i, wf[i] ?? -1, exp, got);
    let diff = compare(exp, got);
    if (diff.length && pre) {
      const d2 = compare(exp, pre);
      if (!d2.length) { tickPhase++; diff = d2; }
    }
    // Joypad re-phase: the original reads the joypad after the next frame's tick in its longer
    // code segments (CPU time is not modelled); when the joypad state is the only difference it
    // is taken from the trace (counted).
    if (diff.length && opts.rephase !== false && diff.every(JOYPAD)) {
      for (const a of diff) m.wr(a, exp[a - 0x8000]!);
      rephased++;
      diff = [];
    }
    if (diff.length) waits.push({ wait: i, frame: wf[i] ?? -1, diff, values: diff.slice(0, 24).map((a) => [a, exp[a - 0x8000]!, got[a - 0x8000]!, pre ? pre[a - 0x8000]! : -1]) });
  };
  while (f < n - 1 && !(nWaits >= wf.length && wf.length) && !(opts.maxWaits && nWaits >= opts.maxWaits)) {
    const io0 = m.io.slice();
    rig.lcdOff = false;
    const prevF = f;
    try {
      rig.g.runFrame();
    } catch (e) {
      if (e instanceof SoftReset || !opts.keepGoing) throw e;
      error = { message: String(e instanceof Error ? e.message : e), wait: nWaits };
      break;
    }
    // PyBoy clears its screen when the LCD is switched off, and shows nothing until the first
    // frame after it is switched back on has passed: the frame whose wait came before the switch
    // (its tick goes on into vblank) and the first frame after are white in the trace.
    let blank = false;
    if (rig.lcdOff) {
      const last = diffs[diffs.length - 1];
      const white = (k: number) => k >= 0 && t.screens.subarray(k * FRAME_BYTES, (k + 1) * FRAME_BYTES).every((v) => v === 0);
      if (last && last.frame === prevF && white(prevF)) { diffs.pop(); lcdBlanks++; }
      blank = white(f);
    }
    if (f < 0 || f >= n) continue;
    opts.onFrame?.(f, rig.ppu.frame);
    const prevDrawn = lastDrawn;
    lastDrawn = f;
    if (nWaits < wf.length && wf[nWaits] === f) continue;
    const exp = t.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES);
    const pixels = screenDiff(rig.ppu.frame, exp);
    if (!pixels) { lastGot = rig.ppu.frame.slice(); continue; }
    if (blank) { lcdBlanks++; continue; }
    if (lastGot && lateWrite(rig.ppu.frame, exp, lastGot)) { lateWrites++; lastGot = rig.ppu.frame.slice(); continue; }
    // a polled raster frame: lines whose register write landed a line early or late
    if (rig.raster && opts.tears !== false && rasterRows(rig, exp)) { rasterEdges++; lastGot = rig.ppu.frame.slice(); continue; }
    // only after a busy frame: the original had not reached its frame wait (its code ran on)
    if (opts.tears !== false && f - prevDrawn > 1) {
      // the window as latched at the frame's start (WY then; LCDC window enable then)
      let latched: Uint8Array | null = null;
      const r = regsFromIo(m.io);
      if ((io0[0x40]! & 0x20) && io0[0x4a]! < r.wy) {
        latchPpu.beginFrame();
        latchPpu.regs = { ...r, wy: io0[0x4a]!, lcdc: r.lcdc | 0x20 };
        for (let y = 0; y < 144; y++) latchPpu.line(y);
        latched = latchPpu.frame.slice();
      }
      const olds = [lastGot, f > 0 ? t.screens.subarray((f - 1) * FRAME_BYTES, f * FRAME_BYTES) : null].filter((x): x is Uint8Array => !!x);
      if (splitTear(exp, rig.ppu.frame, latched, olds)) { tears++; lastGot = rig.ppu.frame.slice(); continue; }
    }
    diffs.push({ frame: f, pixels, got: rig.ppu.frame.slice() });
  }
  return { trace: t, diffs, waits, nWaits, tickPhase, busy, lateWrites, rephased, tears, rasterEdges, lcdBlanks, error };
}

export function summarizeWaits(w: WaitDiff[]): string {
  return w.slice(0, 8).map((d) => `wait ${d.wait} (frame ${d.frame}): ${d.values.slice(0, 12).map(([a, e, g]) => `${a.toString(16)}:${e.toString(16)}/${g.toString(16)}`).join(" ")}${d.diff.length > 12 ? ` +${d.diff.length - 12}` : ""}`).join("\n");
}

export function summarize(diffs: FrameDiff[]): string {
  return diffs.slice(0, 10).map((d) => `f${d.frame}: px ${d.pixels}`).join("\n");
}

// ---------------------------------------------------------------- comparison filters

/** Sound driver state (CE00-CEFF, FFE1-FFEF) and APU registers: verified separately per driver
 *  call; in whole-game traces they depend on where the frame tick fell (CPU time). FFE0 (the
 *  music request written by game code) is compared. */
const SOUND = (a: number) => (a >= 0xce00 && a < 0xcf00) || (a >= 0xffe1 && a < 0xfff0) || (a >= 0xff10 && a < 0xff40);
/** The SM83 stack (SP starts at D000) and the SP saved by the multiply/divide (C381/C382). */
const STACK = (a: number) => (a >= 0xcf00 && a < 0xd000) || a === 0xc381 || a === 0xc382;
/** Hardware timing registers and the joypad select register. */
const TIMING = (a: number) => a === 0xff00 || a === 0xff04 || a === 0xff0f || a === 0xff41 || a === 0xff44 || a === 0xff45;
/** FF96-FF98 (text row, column, line-start column): set from the caller's b and c registers by
 *  every 00:08D4 text before use; the battle messages (00:088A) only count with them. Their
 *  values between texts are the callers' leftover registers. */
const TEXT_REGS = (a: number) => a >= 0xff96 && a <= 0xff98;
export const IGNORE = (a: number) => SOUND(a) || STACK(a) || TIMING(a) || TEXT_REGS(a);
/** Joypad state: samples C3A0-C3A3, repeat counter/last C3A4/C3A5, FF8D held, FF8E repeated. */
export const JOYPAD = (a: number) => (a >= 0xc3a0 && a <= 0xc3a5) || a === 0xff8d || a === 0xff8e;
