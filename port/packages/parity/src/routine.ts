/** Routine-level trace replay: a PyBoy trace recorded with tools/bd_capture.py trace starts at a
 *  routine's entry (hook) and records until it returns (ret.bin, meta.ret). The port's routine is
 *  run from the start snapshot inside the frame loop, synchronized on the original's frame waits
 *  like replayField: the i-th rst $10 of the port is matched with the i-th recorded one (memory
 *  compared at the end of that frame's lines, where the original wakes), screens are compared per frame until the routine returns, and the machine at
 *  the return is compared with ret.bin. */
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import { VSYNC, type Co } from "@ffl2k/core";
import { lcdRestarted } from "../../core/src/battle/anim.js";
import { Rig, loadRom, buttonBits, screenDiff, FRAME_BYTES, TRACES, type FrameDiff, type WaitDiff } from "./index.js";

export interface RoutineTrace {
  name: string;
  meta: { state: string; hook: string; start: { regs: Record<string, number>; frame: number; ly: number }; frames: { btn: string }[] };
  start: Uint8Array;
  screens: Uint8Array;
  waits: Uint8Array;
  waitFrames: number[];
  ret: { waits: number; frame: number; regs: Record<string, number> } | null;
  retMem: Uint8Array | null;
}

export function haveRoutineTrace(name: string): boolean {
  return existsSync(resolve(TRACES, name, "trace.json")) && existsSync(resolve(TRACES, name, "ret.bin"));
}

/** Load a routine trace (tools/bd_capture.py: screens.bin.gz / waits.bin.gz, or plain files). */
export function loadRoutineTrace(name: string): RoutineTrace {
  const d = resolve(TRACES, name);
  const rd = (f: string): Uint8Array => {
    if (existsSync(resolve(d, f + ".gz"))) return new Uint8Array(gunzipSync(readFileSync(resolve(d, f + ".gz"))));
    return new Uint8Array(readFileSync(resolve(d, f)));
  };
  const meta = JSON.parse(readFileSync(resolve(d, "trace.json"), "utf8"));
  return {
    name, meta, start: rd("start.bin"), screens: rd("screens.bin"), waits: rd("waits.bin"),
    waitFrames: JSON.parse(readFileSync(resolve(d, "waits.json"), "utf8")).frames,
    ret: meta.ret, retMem: existsSync(resolve(d, "ret.bin")) ? new Uint8Array(readFileSync(resolve(d, "ret.bin"))) : null,
  };
}

export interface RoutineResult {
  trace: RoutineTrace;
  /** Screen differences (frames before the return). */
  diffs: FrameDiff[];
  /** Memory differences at frame waits. */
  waits: WaitDiff[];
  /** Waits the port made / the original made before returning. */
  nWaits: number;
  expectedWaits: number;
  /** Differences at the return ([address, expected, got]). */
  final: [number, number, number][];
  done: boolean;
  tickPhase: number;
  busy: number;
  /** Frames compared. */
  frames: number;
  /** Frames not compared because the original was mid-segment (see replayRoutine). */
  partial: number;
}

export interface RoutineOptions {
  ignore?: (addr: number) => boolean;
  watch?: (wait: number, frame: number, exp: Uint8Array, got: Uint8Array) => void;
  /** Called after the rig is set up from the start snapshot (install routines, stubs). */
  setup?: (rig: Rig) => void;
  /** Frames (trace indices) whose screens are not compared. */
  skipFrames?: number[];
}

function compare(exp: Uint8Array, got: Uint8Array, ign: (a: number) => boolean): number[] {
  const diff: number[] = [];
  for (let a = 0; a < 0x8000; a++) {
    const addr = 0x8000 + a;
    if (addr >= 0xa000 && addr < 0xc000) continue;
    if (addr >= 0xe000 && addr < 0xfe00) continue;
    if (addr >= 0xfea0 && addr < 0xff00) continue;
    if (got[a] !== exp[a] && !ign(addr)) diff.push(addr);
  }
  return diff;
}

/** Replay routine trace `name` with `run` (the port's routine, given the rig and the registers at
 *  the hook). */
export function replayRoutine(name: string, run: (rig: Rig, regs: Record<string, number>) => Co<unknown>, opts: RoutineOptions = {}): RoutineResult {
  const t = loadRoutineTrace(name);
  const rig = new Rig(loadRom());
  const g = rig.g, m = g.m;
  m.loadFull(t.start);
  // The first frame after the LCD is switched back on is not displayed (battle effect 0x04).
  let blank = false;
  const onLine = g.onLine;
  g.onLine = (y) => {
    onLine?.(y);
    // PyBoy paints the frames without picture in one uniform colour (recorded as shade 2)
    if (blank) rig.ppu.frame.fill(2, y * 160, (y + 1) * 160);
  };
  opts.setup?.(rig);
  const regs = t.meta.start.regs;
  let finished = false;
  let atReturn: Uint8Array | null = null;
  const co = run(rig, regs);
  g.start((function* () { yield* co; finished = true; atReturn = m.snapshotFull(); })());
  const n = t.meta.frames.length;
  const wf = t.waitFrames ?? [];
  const ign = opts.ignore ?? (() => false);
  const skip = new Set(opts.skipFrames ?? []);
  // Frames drawn while the original's code segment was still running (the next wait comes more
  // than one frame later: CPU-bound copies paced by hblank) show a partial state the port, which
  // runs each segment at once, cannot have; the state is checked at the next wait instead.
  let partial = 0;
  for (let i = 0; i + 1 < wf.length; i++) if (wf[i + 1]! - wf[i]! > 1) { skip.add(wf[i]!); partial++; }
  const diffs: FrameDiff[] = [];
  const waits: WaitDiff[] = [];
  const retFrame = t.ret ? t.ret.frame : n;
  let nWaits = 0, f = -2, tickPhase = 0, busy = 0, frames = 0;
  let pre: Uint8Array | null = null;
  const btn = (k: number) => buttonBits(t.meta.frames[Math.min(Math.max(k, 0), n - 1)]!.btn);
  g.onWait = (kind) => {
    blank = lcdRestarted.has(g);
    lcdRestarted.delete(g);
    const prev = f;
    f = kind === VSYNC && nWaits < wf.length ? wf[nWaits]! : f + 1;
    if (f - prev > 1 && prev >= -1) {
      g.busyFrames = f - prev - 1;
      g.onBusyFrame = (k) => { g.buttons = btn(prev + 1 + k); };
      busy += f - prev - 1;
    }
    g.buttons = btn(f);
    pre = kind === VSYNC ? m.snapshotFull() : null;
  };
  // The original wakes from rst $10 at vblank, after the frame's lines: compare there (end of
  // the frame's lines), so writes made during the lines (raster hooks, LY polling) are included.
  let pending = -1;
  g.onYield = (kind) => {
    if (kind === VSYNC) pending = nWaits++;
  };
  g.onFrameDone = () => {
    if (pending < 0) return;
    const i = pending;
    pending = -1;
    if (!t.waits || (i + 1) * 0x8000 > t.waits.length) return;
    const exp = t.waits.subarray(i * 0x8000, (i + 1) * 0x8000);
    const got = m.snapshotFull();
    opts.watch?.(i, wf[i] ?? -1, exp, got);
    let diff = compare(exp, got, ign);
    if (diff.length && pre) {
      const d2 = compare(exp, pre, ign);
      if (!d2.length) { tickPhase++; diff = d2; }
    }
    if (diff.length) waits.push({ wait: i, frame: wf[i] ?? -1, diff, values: diff.slice(0, 24).map((a) => [a, exp[a - 0x8000]!, got[a - 0x8000]!, pre ? pre[a - 0x8000]! : -1]) });
  };
  // The hook's own tick (trace frame -1): when the hook was hit within the visible lines, the
  // lines before it (and their line-0 frame tick) already ran in the original.
  const ly0 = t.meta.start.ly;
  if (wf[0] === -1 && ly0 > 0 && ly0 < 0x90) {
    const saved = new Map(g.statHandlers);
    for (const [k, h] of saved) g.statHandlers.set(k, (g2, ly) => { if (ly >= ly0) h(g2, ly); });
    g.runFrame();
    for (const [k, h] of saved) g.statHandlers.set(k, h);
  }
  let guard = 0;
  while (!finished && guard++ < n + 600) {
    g.runFrame();
    if (finished) break;
    if (f < 0 || f >= n || f >= retFrame) continue;
    if (nWaits < wf.length && wf[nWaits] === f) continue;
    if (skip.has(f)) continue;
    frames++;
    const pixels = screenDiff(rig.ppu.frame, t.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES));
    if (pixels) diffs.push({ frame: f, pixels, wram: [], vram: [], oam: [], hram: [] });
  }
  const final: [number, number, number][] = [];
  if (t.retMem) {
    const got: Uint8Array = atReturn ?? m.snapshotFull();
    for (const a of compare(t.retMem, got, ign)) final.push([a, t.retMem[a - 0x8000]!, got[a - 0x8000]!]);
  }
  return { trace: t, diffs, waits, nWaits, expectedWaits: t.ret ? t.ret.waits : wf.length, final, done: finished, tickPhase, busy, frames, partial };
}

const hx = (v: number) => v.toString(16);
export function summarizeRoutine(r: RoutineResult): string {
  const out: string[] = [];
  if (!r.done) out.push("routine did not return");
  if (r.nWaits !== r.expectedWaits) out.push(`waits ${r.nWaits} != ${r.expectedWaits}`);
  for (const w of r.waits.slice(0, 6)) out.push(`wait ${w.wait} (f${w.frame}): ${w.values.slice(0, 10).map(([a, e, g2]) => `${hx(a)}=${hx(e)}/${hx(g2)}`).join(" ")}${w.diff.length > 10 ? ` +${w.diff.length - 10}` : ""}`);
  if (r.final.length) out.push(`return: ${r.final.slice(0, 12).map(([a, e, g2]) => `${hx(a)}=${hx(e)}/${hx(g2)}`).join(" ")}${r.final.length > 12 ? ` +${r.final.length - 12}` : ""}`);
  if (r.diffs.length) out.push(`screens: ${r.diffs.slice(0, 12).map((d) => `f${d.frame}:${d.pixels}`).join(" ")}${r.diffs.length > 12 ? ` +${r.diffs.length - 12}` : ""}`);
  return out.join("\n");
}
