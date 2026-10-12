/** Replay a PyBoy trace through the field engine and compare every frame. */
import { VSYNC, SoftReset } from "@ffl2k/core";
import { Rig, loadRom, loadTrace, buttonBits, screenDiff, FRAME_BYTES, tickInFrame, type Trace } from "./index.js";

export interface WaitDiff {
  wait: number;
  frame: number;
  diff: number[];
  /** [address, expected, got, got before the tick] for the first differences. */
  values: [number, number, number, number][];
}

export interface FrameDiff {
  frame: number;
  pixels: number;
  wram: number[];
  vram: number[];
  oam: number[];
  hram: number[];
}

/** Engine frame k corresponds to PyBoy trace frame k. */
export const OFFSET = 0;

export interface ReplayOptions {
  /** Called at every wait with the expected and actual machine images (debugging). */
  watch?: (wait: number, frame: number, exp: Uint8Array, got: Uint8Array) => void;
  /** Spend the frames the original spent without waiting as busy frames (default true). */
  busyFrames?: boolean;
  /** Where the trace's start snapshot was taken: the field loop (default) or the title. */
  start?: "field" | "title";
  /** Addresses excluded from memory comparison (scratch whose timing differs). */
  ignore?: (addr: number) => boolean;
  /** Called with the rig after the start snapshot is loaded, before the engine starts (e.g. to
   *  install routines into `rig.engine.extra` or load battery RAM). */
  setup?: (rig: Rig) => void;
  /** Tick-phase state besides the blink timer that may be re-phased (copied from the trace) when
   *  it is the only difference at a wait (counted in `rephased`). */
  rephase?: (addr: number) => boolean;
}


/** Replay a trace through the field engine, synchronized on the original's frame waits: the
 *  i-th rst $10 of the engine is matched with the i-th one recorded in the trace (CPU-bound
 *  stretches such as layout drawing take frames on the hardware but no time in the port). The
 *  buttons, screen and machine state of each wait come from the trace frame in which it happened;
 *  other waits (LY polling) advance one trace frame. */
export function replayField(name: string, opts: ReplayOptions = {}): { trace: Trace; diffs: FrameDiff[]; waits: WaitDiff[]; nWaits: number; tickPhase: number; busy: number; rephased: number } {
  const t = loadTrace(name);
  const rom = loadRom();
  const rig = new Rig(rom);
  const m = rig.g.m;
  m.loadFull(t.start);
  opts.setup?.(rig);
  rig.g.start(opts.start === "title" ? rig.engine.fromTitle() : rig.engine.field.loop());
  const n = t.meta.frames.length;
  const wf = t.waitFrames ?? [];
  const ign = opts.ignore ?? (() => false);
  const diffs: FrameDiff[] = [];
  const waits: WaitDiff[] = [];
  let nWaits = 0, f = -1, tickPhase = 0, busy = 0, rephased = 0, lastRephase = -2;
  let pre: Uint8Array | null = null;
  /** The state after the busy frames, before the wait frame's own tick. */
  let preBusy: Uint8Array | null = null;
  const btn = (k: number) => buttonBits(t.meta.frames[Math.min(Math.max(k, 0), n - 1)]!.btn);
  rig.g.onWait = (kind) => {
    const prev = f;
    f = kind === VSYNC && nWaits < wf.length ? wf[nWaits]! : f + 1;
    // frames the original spent busy (no wait) before this one: run them as busy frames
    if (opts.busyFrames !== false && f - prev > 1 && prev >= 0) {
      const nb = f - prev - 1, cur = f;
      rig.g.busyFrames = nb;
      // buttons of each busy frame, then (after the last one's lines) those of the wait's frame
      rig.g.onBusyFrame = (k) => {
        rig.g.buttons = btn(prev + 1 + k);
        if (k === nb - 1) rig.g.onFrameDone = () => { rig.g.buttons = btn(cur); preBusy = m.snapshotFull(); rig.g.onFrameDone = null; };
        return tickInFrame(t, prev + 1 + k);
      };
      busy += f - prev - 1;
    }
    rig.g.buttons = btn(f);
    pre = kind === VSYNC ? m.snapshotFull() : null;
    preBusy = null;
  };
  const compare = (exp: Uint8Array, got: Uint8Array): number[] => {
    const diff: number[] = [];
    for (let a = 0; a < 0x8000; a++) {
      const addr = 0x8000 + a;
      if (addr >= 0xa000 && addr < 0xc000) continue; // battery RAM window
      if (addr >= 0xe000 && addr < 0xfe00) continue; // echo
      if (addr >= 0xfea0 && addr < 0xff00) continue;
      if (got[a] !== exp[a] && !ign(addr)) diff.push(addr);
    }
    return diff;
  };
  rig.g.onYield = (kind) => {
    if (kind !== VSYNC) return;
    const i = nWaits++;
    if (!t.waits || (i + 1) * 0x8000 > t.waits.length) return;
    const exp = t.waits.subarray(i * 0x8000, (i + 1) * 0x8000);
    // The original's frame tick (line 0) falls before or after the wait depending on CPU time:
    // accept the state after the tick (usual) or just before it.
    const got = m.snapshotFull();
    if (opts.watch) opts.watch(i, wf[i] ?? -1, exp, got);
    let diff = compare(exp, got);
    if (diff.length && pre) {
      const d2 = compare(exp, pre);
      if (!d2.length) { tickPhase++; diff = d2; }
    }
    // After busy frames the original's code may have spanned the busy frames' ticks (which then
    // saw its state half-way): accept the state before this frame's tick, up to the blink phase.
    if (diff.length && preBusy) {
      const d3 = compare(exp, preBusy);
      if (d3.every((a) => BLINK.has(a))) { tickPhase++; diff = d3; }
    }
    // Tick-phase counters: the blink timer C7C6/C7C7 advances in the frame tick, which on the
    // hardware can fall inside a long code segment; re-phase it when it is the only difference.
    // ... and accept the sprite positions (OAM) that follow from it in the same frame.
    const isOam = (a: number) => a >= 0xfe00 && a < 0xfea0;
    const phased = (a: number) => BLINK.has(a) || (opts.rephase?.(a) ?? false);
    if (diff.length && diff.every((a) => phased(a) || isOam(a)) && (diff.some(phased) || lastRephase === i - 1)) {
      for (const a of diff) if (phased(a)) m.wr(a, exp[a - 0x8000]!);
      rephased++;
      lastRephase = i;
      diff = [];
    }
    if (diff.length) waits.push({ wait: i, frame: wf[i] ?? -1, diff, values: diff.slice(0, 24).map((a) => [a, exp[a - 0x8000]!, got[a - 0x8000]!, pre ? pre[a - 0x8000]! : -1]) });
  };
  while (f < n - 1 && !(nWaits >= wf.length && wf.length)) {
    try {
      rig.g.runFrame();
    } catch (e) {
      // A+B+Select+Start in the frame tick: the original jumps to 00:0200 (boot, then the title)
      if (!(e instanceof SoftReset)) throw e;
      rig.g.start(rig.engine.main());
      continue;
    }
    if (f < 0 || f >= n) continue;
    // several waits can fall in one trace frame (the start tick): compare its screen once, at the last
    if (nWaits < wf.length && wf[nWaits] === f) continue;
    const pixels = screenDiff(rig.ppu.frame, t.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES));
    if (pixels) diffs.push({ frame: f, pixels, wram: [], vram: [], oam: [], hram: [] });
  }
  return { trace: t, diffs, waits, nWaits, tickPhase, busy, rephased };
}

export function summarizeWaits(w: WaitDiff[]): string {
  return w.slice(0, 8).map((d) => `wait ${d.wait} (frame ${d.frame}): ${d.diff.slice(0, 16).map((x) => x.toString(16)).join(",")}${d.diff.length > 16 ? `,+${d.diff.length - 16}` : ""}`).join("\n");
}

export function summarize(diffs: FrameDiff[]): string {
  const hx = (a: number[]) => a.slice(0, 12).map((x) => x.toString(16)).join(",") + (a.length > 12 ? `,+${a.length - 12}` : "");
  return diffs.slice(0, 10).map((d) => `f${d.frame}: px ${d.pixels} wram[${hx(d.wram)}] vram[${hx(d.vram)}] oam[${hx(d.oam)}] hram[${hx(d.hram)}]`).join("\n");
}

// ---------------------------------------------------------------- comparison filters

/** Blink timer C7C6/C7C7 (advanced by the frame tick) and the name entry's saved copy of it
 *  (D674 + 0x4D, 01:6228). Which side of a write the tick falls on inside a long code segment
 *  depends on CPU time; the replay re-phases these when they are the only difference. */
const BLINK = new Set([0xc7c6, 0xc7c7, 0xd6c1, 0xd6c2]);

/** Sound: APU registers (the emulator's read-back values differ from the written values the
 *  port stores) and the driver's RAM CB00-CBFF / FFB1-FFBF. The driver is verified separately,
 *  byte for byte per call with identical register writes (core/test/sound.test.ts); in whole-game
 *  traces its state depends on whether the frame tick fell before or after the code that posts a
 *  sound request (CPU time within a frame, not modelled), a one-frame shift. */
const SOUND = (a: number) => (a >= 0xcb00 && a < 0xcc00) || (a >= 0xffb1 && a < 0xffc0) || (a >= 0xff10 && a < 0xff40);
/** The SM83 call stack (SP starts at CF00) holds return addresses the port does not have. */
const STACK = (a: number) => a >= 0xce00 && a < 0xcf00;
/** Hardware timing registers: DIV, IF, STAT mode, LY, and LYC (set per line by the raster
 *  handlers, so its value at a wait depends on line timing). */
const TIMING = (a: number) => a === 0xff04 || a === 0xff0f || a === 0xff41 || a === 0xff44 || a === 0xff45;
/** Layout drawer temporaries (00:2279-2612), always written before being read. */
const LAYOUT_SCRATCH = (a: number) => a >= 0xc477 && a <= 0xc47d;
/** HRAM temporaries FF90-FF95 (arithmetic helpers, sprite tick, menus), written before read. */
const HRAM_SCRATCH = (a: number) => a >= 0xff90 && a <= 0xff95;
/** The menu sprite page CC00-CC9F is recomputed every frame tick (00:176C) from C7A6-C7C5 and
 *  FF97-FF9A (compared); whether that tick ran before or after a write depends on CPU time
 *  within long text/menu segments. What is shown is checked through the screens. */
const SPRITE_PAGE = (a: number) => a >= 0xcc00 && a < 0xcca0;
/** OAM is a DMA copy of a shadow page (C000/C100, compared) or of CC00 (above): derived. */
const OAM = (a: number) => a >= 0xfe00 && a < 0xfea0;
/** Everything excluded from wait-point state comparison. */
export const IGNORE = (a: number) => SOUND(a) || STACK(a) || TIMING(a) || LAYOUT_SCRATCH(a) || HRAM_SCRATCH(a) || SPRITE_PAGE(a) || OAM(a);

