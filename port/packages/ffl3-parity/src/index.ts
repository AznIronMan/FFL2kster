/** Legend III parity rig: an engine instance with the line-by-line PPU of @ffl2k/render (the TOL
 *  engine core's renderer, unchanged), plus loaders for the local PyBoy traces (ffl3/build/traces,
 *  tools/ffl3/trace_lib.py). Traces are ROM-derived and never committed. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Engine } from "@ffl3k/core";
import { Ppu, regsFromIo, SCREEN_W, SCREEN_H, type LcdRegs } from "@ffl2k/render";

export const ROOT = resolve(__dirname, "../../../..");
export const ROM_PATH = process.env.FFL3K_ROM ?? resolve(ROOT, "ffl3/input/original.gb");
export const haveRom = (): boolean => existsSync(ROM_PATH);
export const FRAME_BYTES = SCREEN_W * SCREEN_H;
export const TRACES = resolve(ROOT, "ffl3/build/traces");

export function loadRom(): Uint8Array {
  return new Uint8Array(readFileSync(ROM_PATH));
}

export function segments(rom: Uint8Array): Record<string, Uint8Array> {
  const s: Record<string, Uint8Array> = {};
  for (let b = 0; b < rom.length / 0x4000; b++) s[b.toString(16).padStart(2, "0")] = rom.slice(b * 0x4000, (b + 1) * 0x4000);
  return s;
}

/** Button names as the trace plans write them -> FF8A bits (A, B, Select, Start low; Right,
 *  Left, Up, Down high). */
export const BUTTONS: Record<string, number> = { a: 0x01, b: 0x02, select: 0x04, start: 0x08, right: 0x10, left: 0x20, up: 0x40, down: 0x80, none: 0 };
export const buttonBits = (s: string): number => s.split("+").reduce((v, k) => v | (BUTTONS[k] ?? 0), 0);

export class Rig {
  readonly engine: Engine;
  readonly ppu: Ppu;
  /** The registers each line of the last frame was drawn with. */
  readonly lineRegs: LcdRegs[] = [];
  /** Set when the code switched the LCD off (cleared by the replay before each frame). */
  lcdOff = false;
  constructor(readonly rom: Uint8Array) {
    this.engine = new Engine(segments(rom), rom);
    const m = this.g.m;
    m.onLcdc = (v) => { if (!(v & 0x80)) this.lcdOff = true; };
    this.ppu = new Ppu(m.vram, m.oam);
    this.g.onLine = (y) => {
      if (y === 0) this.ppu.beginFrame();
      this.ppu.regs = regsFromIo(m.io);
      this.lineRegs[y] = this.ppu.regs;
      this.ppu.line(y);
    };
  }
  /** The last frame drawn again from a VRAM and OAM (each line with its registers), or with
   *  fixed registers. */
  redrawFrom(vram: Uint8Array, regs?: LcdRegs, oam: Uint8Array = this.g.m.oam): Uint8Array {
    const p = new Ppu(vram, oam);
    p.beginFrame();
    for (let k = 0; k < 144; k++) {
      p.regs = regs ?? this.lineRegs[k]!;
      p.line(k);
    }
    return p.frame;
  }
  /** The last frame drawn again from the current VRAM and OAM with each line's registers but
   *  the palettes given (BGP, OBP0, OBP1). */
  redrawPalettes([bgp, obp0, obp1]: [number, number, number]): Uint8Array {
    const p = new Ppu(this.g.m.vram, this.g.m.oam);
    p.beginFrame();
    for (let k = 0; k < 144; k++) {
      p.regs = { ...this.lineRegs[k]!, bgp, obp0, obp1 };
      p.line(k);
    }
    return p.frame;
  }
  get g() {
    return this.engine.g;
  }
}

export interface Trace {
  name: string;
  meta: { state: string; plan: string; hook: string; start: { regs: Record<string, number>; frame: number; ly: number }; frames: { btn: string }[] };
  start: Uint8Array;
  screens: Uint8Array;
  hram: Uint8Array;
  /** Per frame: CB00 (music tempo accumulator), FF93 (vblank frame counter). */
  tick: Uint8Array;
  /** Per frame: OAM (FE00-FE9F) after the frame. */
  oam: Uint8Array;
  waits: Uint8Array;
  waitFrames: number[];
  /** The frames of the original's vblank polls in the bracket (00:1E35); -1: the hook's frame. */
  syncs: number[];
  /** [frame, LY] of the original's entries to 00:1D9E / 00:1DFD (di before the poll). */
  polls: [number, number][];
  /** [frame, LY, end frame, end LY] of the original's runs of the frame work 00:3557. */
  works: [number, number, number, number][];
  /** [frame, LY] at which each frame wait began (00:3A6D). */
  starts: [number, number][];
  /** The times the CPU reached the sync points (tools/ffl3/trace_lib.py POINTS), by bank << 16 |
   *  address. */
  points: Record<number, [number, number][]>;
  /** [frame, LY, FF93] at each call of the random generator 00:39D5. */
  rand: [number, number, number][];
  prevScreen?: Uint8Array;
}

export function haveTrace(name: string): boolean {
  return existsSync(resolve(TRACES, name, "trace.json")) && existsSync(resolve(TRACES, name, "start.bin"));
}

function undelta(gz: Uint8Array, size: number, first?: Uint8Array): Uint8Array {
  const out = new Uint8Array(gunzipSync(gz));
  let prev = first ?? new Uint8Array(size);
  for (let o = 0; o + size <= out.length; o += size) {
    for (let i = 0; i < size; i++) out[o + i]! ^= prev[i]!;
    prev = out.subarray(o, o + size);
  }
  return out;
}

function waitsJson(f: string): Pick<Trace, "waitFrames" | "syncs" | "polls" | "works" | "starts" | "points" | "rand"> {
  const w = JSON.parse(readFileSync(f, "utf8"));
  return { waitFrames: w.frames, syncs: w.syncs ?? [], polls: w.polls ?? [], works: w.works ?? [], starts: w.starts ?? [], rand: w.rand ?? [],
    points: Object.fromEntries(Object.entries(w.points ?? {}).map(([k, v]) => {
      const [b, a] = k.includes(":") ? k.split(":").map((x) => parseInt(x, 16)) as [number, number] : [0, parseInt(k, 16)];
      return [(b << 16) | a, v as [number, number][]];
    })) };
}

export function loadTrace(name: string): Trace {
  const d = resolve(TRACES, name);
  const rd = (f: string) => new Uint8Array(readFileSync(resolve(d, f)));
  const meta = JSON.parse(readFileSync(resolve(d, "trace.json"), "utf8"));
  const start = rd("start.bin");
  return {
    name, meta, start, screens: undelta(rd("screens.dx.gz"), FRAME_BYTES), hram: rd("hram.bin"),
    tick: existsSync(resolve(d, "tick.bin")) ? rd("tick.bin") : new Uint8Array(0),
    oam: existsSync(resolve(d, "oam.bin")) ? rd("oam.bin") : new Uint8Array(0),
    waits: undelta(rd("waits.dx.gz"), 0x8000, start),
    ...waitsJson(resolve(d, "waits.json")),
    ...(existsSync(resolve(d, "prev.bin")) ? { prevScreen: rd("prev.bin") } : {}),
  };
}

export function screenDiff(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < FRAME_BYTES; i++) if (a[i] !== b[i]) n++;
  return n;
}

export * from "./replay.js";
