/** Parity rig: an engine instance with a line-by-line PPU, plus loaders for the local PyBoy
 *  traces (build/traces) and routine-oracle fixtures (build/routines). Fixtures are generated
 *  from the user's ROM by tools/trace_record.py and tools/routine_oracle.py and never committed. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Engine } from "@ffl2k/core";
import { Ppu, regsFromIo, SCREEN_W, SCREEN_H } from "@ffl2k/render";

export const ROOT = resolve(__dirname, "../../../..");
export const ROM_PATH = process.env.FFL2K_ROM ?? resolve(ROOT, "input/original.gb");
export const haveRom = (): boolean => existsSync(ROM_PATH);
export const FRAME_BYTES = SCREEN_W * SCREEN_H;

export * from "./replay.js";

export function loadRom(): Uint8Array {
  return new Uint8Array(readFileSync(ROM_PATH));
}

export function segments(rom: Uint8Array): Record<string, Uint8Array> {
  const s: Record<string, Uint8Array> = {};
  for (let b = 0; b < rom.length / 0x4000; b++) s[b.toString(16).padStart(2, "0")] = rom.slice(b * 0x4000, (b + 1) * 0x4000);
  return s;
}

export const BUTTONS: Record<string, number> = { a: 0x01, b: 0x02, select: 0x04, start: 0x08, right: 0x10, left: 0x20, up: 0x40, down: 0x80, none: 0 };
export const buttonBits = (s: string): number => s.split("+").reduce((v, k) => v | (BUTTONS[k] ?? 0), 0);

/** Engine + PPU wired like the app: each visible line is drawn after its STAT handling. */
export class Rig {
  readonly engine: Engine;
  readonly ppu: Ppu;
  constructor(readonly rom: Uint8Array) {
    this.engine = new Engine(segments(rom), rom);
    const m = this.g.m;
    this.ppu = new Ppu(m.vram, m.oam);
    this.g.onLine = (y) => {
      if (y === 0) this.ppu.beginFrame();
      this.ppu.regs = regsFromIo(m.io);
      this.ppu.line(y);
    };
  }
  get g() {
    return this.engine.g;
  }
}

export interface Trace {
  name: string;
  meta: { state: string; plan: string; hook: string; start: { regs: Record<string, number>; frame: number; ly: number }; frames: { btn: string; ff89: number; keys: Record<string, number> }[] };
  start: Uint8Array;
  screens: Uint8Array;
  wram: Uint8Array;
  vram: Uint8Array;
  oam: Uint8Array;
  hram: Uint8Array;
  /** Machine (8000-FFFF) at each rst $10 wait, and the trace frame of each. */
  waits?: Uint8Array;
  waitFrames?: number[];
  /** Lean traces: the screen of the frame before the start (hook). */
  prevScreen?: Uint8Array;
}

export const TRACES = resolve(ROOT, "build/traces");

export function haveTrace(name: string): boolean {
  return existsSync(resolve(TRACES, name, "trace.json")) && existsSync(resolve(TRACES, name, "start.bin"));
}

/** Undo the XOR-delta encoding of tools/trace_lib.py (records of `size` bytes, each XORed with
 *  the previous one; the first with `first`, or zeros). */
function undelta(gz: Uint8Array, size: number, first?: Uint8Array): Uint8Array {
  const out = new Uint8Array(gunzipSync(gz));
  let prev = first ?? new Uint8Array(size);
  for (let o = 0; o + size <= out.length; o += size) {
    for (let i = 0; i < size; i++) out[o + i]! ^= prev[i]!;
    prev = out.subarray(o, o + size);
  }
  return out;
}

export function loadTrace(name: string): Trace {
  const d = resolve(TRACES, name);
  const rd = (f: string) => new Uint8Array(readFileSync(resolve(d, f)));
  const meta = JSON.parse(readFileSync(resolve(d, "trace.json"), "utf8"));
  if (meta.lean) {
    // lean sweep trace (tools/trace_lib.py): no per-frame WRAM/VRAM/OAM
    const start = rd("start.bin");
    return {
      name, meta, start, screens: undelta(rd("screens.dx.gz"), FRAME_BYTES), wram: new Uint8Array(0),
      vram: new Uint8Array(0), oam: new Uint8Array(0), hram: rd("hram.bin"),
      waits: undelta(rd("waits.dx.gz"), 0x8000, start),
      waitFrames: JSON.parse(readFileSync(resolve(d, "waits.json"), "utf8")).frames,
      ...(existsSync(resolve(d, "prev.bin")) ? { prevScreen: rd("prev.bin") } : {}),
    };
  }
  return {
    name, meta, start: rd("start.bin"),
    screens: rd("screens.bin"), wram: rd("wram.bin"), vram: rd("vram.bin"), oam: rd("oam.bin"), hram: rd("hram.bin"),
    ...(existsSync(resolve(d, "waits.bin")) ? { waits: rd("waits.bin"), waitFrames: JSON.parse(readFileSync(resolve(d, "waits.json"), "utf8")).frames } : {}),
  };
}

/** Pixels that differ between two frames. */
export function screenDiff(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < FRAME_BYTES; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Whether the original's frame tick ran in trace frame f: the sound driver (called first by the
 *  tick, 00:16F9) advances its frame counter FFB4 on every call. Used for busy frames only, where
 *  the port cannot know CPU time: a CPU-bound stretch with the LCD off (map loads) or interrupts
 *  masked gets no tick. */
export function tickInFrame(t: Trace, f: number): boolean {
  if (f <= 0 || (f + 1) * 128 > t.hram.length) return true;
  return t.hram[f * 128 + 0x34] !== t.hram[(f - 1) * 128 + 0x34];
}
