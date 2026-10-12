/** Replay a PyBoy trace through the field engine and compare every frame. */
import { field, VSYNC } from "@ffl2k/core";
import { Rig, loadRom, loadTrace, buttonBits, screenDiff, FRAME_BYTES, type Trace } from "./index.js";

export interface WaitDiff {
  wait: number;
  frame: number;
  diff: number[];
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
  calls?: Partial<field.FieldCalls>;
  /** Addresses excluded from memory comparison (scratch whose timing differs). */
  ignore?: (addr: number) => boolean;
}

const missing = (what: string) => function* (): Generator<void, void, void> {
  throw new Error(`${what} not expected in this trace`);
};

/** Replay a trace through the field engine, synchronized on the original's frame waits: the
 *  i-th rst $10 of the engine is matched with the i-th one recorded in the trace (CPU-bound
 *  stretches such as layout drawing take frames on the hardware but no time in the port). The
 *  buttons, screen and machine state of each wait come from the trace frame in which it happened;
 *  other waits (LY polling) advance one trace frame. */
export function replayField(name: string, opts: ReplayOptions = {}): { trace: Trace; diffs: FrameDiff[]; waits: WaitDiff[]; nWaits: number } {
  const t = loadTrace(name);
  const rom = loadRom();
  const rig = new Rig(rom);
  const m = rig.g.m;
  m.loadFull(t.start);
  const calls: field.FieldCalls = {
    script: missing("script"), startMenu: missing("start menu"), selectMenu: missing("select menu"), event4: missing("event 4"),
    ...opts.calls,
  };
  const fe = new field.FieldEngine(rig.g, rom, calls);
  rig.g.start(fe.loop());
  const n = t.meta.frames.length;
  const wf = t.waitFrames ?? [];
  const ign = opts.ignore ?? (() => false);
  const diffs: FrameDiff[] = [];
  const waits: WaitDiff[] = [];
  let nWaits = 0, f = -1;
  rig.g.onWait = (kind) => {
    f = kind === VSYNC && nWaits < wf.length ? wf[nWaits]! : f + 1;
    rig.g.buttons = buttonBits(t.meta.frames[Math.min(Math.max(f, 0), n - 1)]!.btn);
  };
  rig.g.onYield = (kind) => {
    if (kind !== VSYNC) return;
    const i = nWaits++;
    if (!t.waits || (i + 1) * 0x8000 > t.waits.length) return;
    const exp = t.waits.subarray(i * 0x8000, (i + 1) * 0x8000);
    const got = m.snapshotFull();
    const diff: number[] = [];
    for (let a = 0; a < 0x8000; a++) {
      const addr = 0x8000 + a;
      if (addr >= 0xa000 && addr < 0xc000) continue; // battery RAM window
      if (addr >= 0xe000 && addr < 0xfe00) continue; // echo
      if (addr >= 0xfea0 && addr < 0xff00) continue;
      if (got[a] !== exp[a] && !ign(addr)) diff.push(addr);
    }
    if (diff.length) waits.push({ wait: i, frame: wf[i] ?? -1, diff });
  };
  while (f < n - 1 && !(nWaits >= wf.length && wf.length)) {
    rig.g.runFrame();
    if (f < 0 || f >= n) continue;
    const pixels = screenDiff(rig.ppu.frame, t.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES));
    if (pixels) diffs.push({ frame: f, pixels, wram: [], vram: [], oam: [], hram: [] });
  }
  return { trace: t, diffs, waits, nWaits };
}

export function summarizeWaits(w: WaitDiff[]): string {
  return w.slice(0, 8).map((d) => `wait ${d.wait} (frame ${d.frame}): ${d.diff.slice(0, 16).map((x) => x.toString(16)).join(",")}${d.diff.length > 16 ? `,+${d.diff.length - 16}` : ""}`).join("\n");
}

export function summarize(diffs: FrameDiff[]): string {
  const hx = (a: number[]) => a.slice(0, 12).map((x) => x.toString(16)).join(",") + (a.length > 12 ? `,+${a.length - 12}` : "");
  return diffs.slice(0, 10).map((d) => `f${d.frame}: px ${d.pixels} wram[${hx(d.wram)}] vram[${hx(d.vram)}] oam[${hx(d.oam)}] hram[${hx(d.hram)}]`).join("\n");
}

// ---------------------------------------------------------------- comparison filters

/** Sound driver state and the sound requests it consumes (FFB1/FFB2); the driver is not ported yet. */
const SOUND = (a: number) => (a >= 0xcb00 && a < 0xcc00) || (a >= 0xffb1 && a < 0xffc0) || (a >= 0xff10 && a < 0xff40);
/** The SM83 call stack (SP starts at CF00) holds return addresses the port does not have. */
const STACK = (a: number) => a >= 0xce00 && a < 0xcf00;
/** Hardware timing registers: DIV, IF, STAT mode, LY, and LYC (set per line by the raster
 *  handlers, so its value at a wait depends on line timing). */
const TIMING = (a: number) => a === 0xff04 || a === 0xff0f || a === 0xff41 || a === 0xff44 || a === 0xff45;
/** Layout drawer temporaries (00:2279-2612), always written before being read. */
const LAYOUT_SCRATCH = (a: number) => a >= 0xc477 && a <= 0xc47d;
/** Everything excluded from wait-point state comparison. */
export const IGNORE = (a: number) => SOUND(a) || STACK(a) || TIMING(a) || LAYOUT_SCRATCH(a);

