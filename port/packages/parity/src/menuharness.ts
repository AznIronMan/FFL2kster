/** Routine-level replay: run one ported routine from a PyBoy snapshot taken at its entry
 *  (tools/trace_record.py --hook BB:AAAA) with the trace's buttons, and compare the machine at
 *  every rst $10 wait, the screen of every frame before the routine returned, and the machine at
 *  the return (--mark on the caller's return address: marks.bin / marks.json). Same frame
 *  alignment and comparison filters as replay.ts. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { VSYNC, type Co } from "@ffl2k/core";
import { Rig, loadRom, loadTrace, buttonBits, screenDiff, FRAME_BYTES, TRACES, haveTrace, tickInFrame, type Trace } from "./index.js";
import type { WaitDiff, FrameDiff } from "./replay.js";

export interface Mark {
  frame: number;
  /** Number of waits recorded before the mark. */
  waits: number;
  at: string;
  regs: Record<string, number>;
}

export interface MarkedTrace extends Trace {
  marks: Mark[];
  /** Machine (8000-FFFF) at each mark. */
  markMem: Uint8Array;
}

export function haveMarkedTrace(name: string): boolean {
  return haveTrace(name) && existsSync(resolve(TRACES, name, "marks.json"));
}

export function loadMarkedTrace(name: string): MarkedTrace {
  const d = resolve(TRACES, name);
  return {
    ...loadTrace(name),
    marks: JSON.parse(readFileSync(resolve(d, "marks.json"), "utf8")).marks,
    markMem: new Uint8Array(readFileSync(resolve(d, "marks.bin"))),
  };
}

export interface RoutineOptions {
  /** Install the routines under test and any stubs. */
  setup(rig: Rig, t: MarkedTrace): void;
  /** The routine, as its caller calls it. */
  run(rig: Rig): Co<unknown>;
  /** ROM bank of the caller (restored by the farcall when the routine returns). */
  callerBank?: number;
  /** Addresses excluded from memory comparison. */
  ignore?: (addr: number) => boolean;
  /** Called at every wait with the expected and actual machine images (debugging). */
  watch?: (wait: number, frame: number, exp: Uint8Array, got: Uint8Array) => void;
  /** Called for every compared frame with the port's and the trace's screen (debugging). */
  onScreen?: (frame: number, got: Uint8Array, exp: Uint8Array) => void;
}

export interface RoutineResult {
  trace: MarkedTrace;
  /** Screens that differ (frames before the return). */
  diffs: FrameDiff[];
  waits: WaitDiff[];
  nWaits: number;
  /** Waits of the original before the return. */
  expectedWaits: number;
  returned: boolean;
  /** Addresses that differ from the machine at the return mark: [address, expected, got]. */
  end: [number, number, number][];
  /** Frames compared. */
  frames: number;
  tickPhase: number;
  /** Waits where the blink timer was re-phased. */
  rephased: number;
  /** Waits where the joypad repeat state was re-phased. */
  rephasedJoy: number;
}

/** Blink timer C7C6/C7C7 (frame tick) and the name entry's copy of it (see BLINK in replay.ts). */
const BLINK = new Set([0xc7c6, 0xc7c7, 0xd6c1, 0xd6c2]);
/** Joypad auto-repeat state C774/C775 (00:0469). After a cursor move the menu engine (01:5039)
 *  spends about 25 lines of CPU time (measured in PyBoy: joyRepeat at LY 23 of the next frame
 *  instead of LY 146), so its next read sees the following frame's sample; the port reads at
 *  vblank. When these are the only difference they are re-phased (counted in `rephasedJoy`). */
const JOY = new Set([0xc774, 0xc775]);

const compare = (exp: Uint8Array, got: Uint8Array, ign: (a: number) => boolean): number[] => {
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

/** Replay the routine until it returns (or the trace ends). */
export function replayRoutine(name: string, opts: RoutineOptions): RoutineResult {
  const t = loadMarkedTrace(name);
  const mark = t.marks[0]!;
  const rig = new Rig(loadRom());
  const m = rig.g.m;
  m.loadFull(t.start);
  if (opts.callerBank !== undefined) m.selectBank(opts.callerBank);
  opts.setup(rig, t);
  let endSnap: Uint8Array | null = null;
  const main = opts.run(rig);
  rig.g.start((function* () {
    yield* main;
    endSnap = m.snapshotFull(); // at the return, before the rest of the frame
  })());
  const n = t.meta.frames.length;
  const wf = (t.waitFrames ?? []).slice(0, mark.waits);
  const ign = opts.ignore ?? (() => false);
  const diffs: FrameDiff[] = [];
  const waits: WaitDiff[] = [];
  let nWaits = 0, f = -1, tickPhase = 0, frames = 0, rephased = 0, rephasedJoy = 0, lastRephase = -2;
  let pre: Uint8Array | null = null;
  const btn = (k: number) => buttonBits(t.meta.frames[Math.min(Math.max(k, 0), n - 1)]!.btn);
  rig.g.onWait = (kind) => {
    const prev = f;
    f = kind === VSYNC && nWaits < wf.length ? wf[nWaits]! : f + 1;
    if (f - prev > 1 && prev >= 0) {
      rig.g.busyFrames = f - prev - 1;
      rig.g.onBusyFrame = (k) => { rig.g.buttons = btn(prev + 1 + k); return tickInFrame(t, prev + 1 + k); };
    }
    rig.g.buttons = btn(f);
    pre = kind === VSYNC ? m.snapshotFull() : null;
  };
  rig.g.onYield = (kind) => {
    if (kind !== VSYNC) return;
    const i = nWaits++;
    if (!t.waits || i >= wf.length) {
      waits.push({ wait: i, frame: -1, diff: [-1], values: [] });
      return;
    }
    const exp = t.waits.subarray(i * 0x8000, (i + 1) * 0x8000);
    const got = m.snapshotFull();
    opts.watch?.(i, wf[i]!, exp, got);
    let diff = compare(exp, got, ign);
    // the frame tick (line 0) may fall before or after the original's wait (see replay.ts)
    if (diff.length && pre && !compare(exp, pre, ign).length) { tickPhase++; diff = []; }
    // blink timer advanced by the frame tick inside a long code segment: re-phase it when it is
    // the only difference (with the sprite positions that follow from it), as replay.ts does
    const isOam = (a: number) => a >= 0xfe00 && a < 0xfea0;
    if (diff.length && diff.every((a) => BLINK.has(a) || isOam(a)) && (diff.some((a) => BLINK.has(a)) || lastRephase === i - 1)) {
      for (const a of diff) if (BLINK.has(a)) m.wr(a, exp[a - 0x8000]!);
      rephased++;
      lastRephase = i;
      diff = [];
    }
    if (diff.length && diff.every((a) => JOY.has(a))) {
      for (const a of diff) m.wr(a, exp[a - 0x8000]!);
      rephasedJoy++;
      diff = [];
    }
    if (diff.length) waits.push({ wait: i, frame: wf[i]!, diff, values: diff.slice(0, 24).map((a) => [a, exp[a - 0x8000]!, got[a - 0x8000]!, pre ? pre[a - 0x8000]! : -1]) });
  };
  while (!rig.g.done && f < n - 1) {
    rig.g.runFrame();
    if (rig.g.done || f < 0 || f >= n || f >= mark.frame) continue;
    if (nWaits < wf.length && wf[nWaits] === f) continue;
    frames++;
    const expScreen = t.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES);
    opts.onScreen?.(f, rig.ppu.frame, expScreen);
    const pixels = screenDiff(rig.ppu.frame, expScreen);
    if (pixels) diffs.push({ frame: f, pixels, wram: [], vram: [], oam: [], hram: [] });
  }
  const end: [number, number, number][] = [];
  if (endSnap) {
    const exp = t.markMem.subarray(0, 0x8000), got = endSnap as Uint8Array;
    for (const a of compare(exp, got, ign)) end.push([a, exp[a - 0x8000]!, got[a - 0x8000]!]);
  }
  return { trace: t, diffs, waits, nWaits, expectedWaits: wf.length, returned: rig.g.done, end, frames, tickPhase, rephased, rephasedJoy };
}

export function summarizeEnd(end: [number, number, number][]): string {
  return end.slice(0, 24).map(([a, e, g]) => `${a.toString(16)}:${e.toString(16)}/${g.toString(16)}`).join(" ");
}
