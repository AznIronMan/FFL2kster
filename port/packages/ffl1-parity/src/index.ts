/** Legend I parity rig: an engine instance with the line-by-line PPU of @ffl2k/render (the TOL
 *  engine core's renderer, unchanged), plus loaders for the local PyBoy traces (ffl1/build/traces,
 *  tools/ffl1/trace_lib.py). Traces are ROM-derived and never committed. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Engine } from "@ffl1k/core";
import { Ppu, regsFromIo, SCREEN_W, SCREEN_H, type LcdRegs } from "@ffl2k/render";

export const ROOT = resolve(__dirname, "../../../..");
export const ROM_PATH = process.env.FFL1K_ROM ?? resolve(ROOT, "ffl1/input/original.gb");
export const haveRom = (): boolean => existsSync(ROM_PATH);
export const FRAME_BYTES = SCREEN_W * SCREEN_H;
export const TRACES = resolve(ROOT, "ffl1/build/traces");

export function loadRom(): Uint8Array {
  return new Uint8Array(readFileSync(ROM_PATH));
}

export function segments(rom: Uint8Array): Record<string, Uint8Array> {
  const s: Record<string, Uint8Array> = {};
  for (let b = 0; b < rom.length / 0x4000; b++) s[b.toString(16).padStart(2, "0")] = rom.slice(b * 0x4000, (b + 1) * 0x4000);
  return s;
}

/** Button names as the trace plans write them -> FF8D bits (directions high, buttons low). */
export const BUTTONS: Record<string, number> = { a: 0x01, b: 0x02, select: 0x04, start: 0x08, right: 0x10, left: 0x20, up: 0x40, down: 0x80, none: 0 };
export const buttonBits = (s: string): number => s.split("+").reduce((v, k) => v | (BUTTONS[k] ?? 0), 0);

export class Rig {
  readonly engine: Engine;
  readonly ppu: Ppu;
  /** The registers each line of the last frame was drawn with, and whether a polled raster
   *  (Game.lineHook) was active during it. */
  readonly lineRegs: LcdRegs[] = [];
  raster = false;
  /** Whether the frame was drawn with the VRAM-access handler 00:069F installed (the original
   *  was writing VRAM line by line during it). */
  vramWrites = false;
  /** Set when the code switched the LCD off (cleared by the replay before each frame). */
  lcdOff = false;
  /** The LCD registers after each write the code made in the current step (cleared by the
   *  replay before each frame): the values the original's display may have caught on its way. */
  stepRegs: LcdRegs[] = [];
  constructor(readonly rom: Uint8Array) {
    this.engine = new Engine(segments(rom), rom);
    const m = this.g.m;
    m.onLcdWrite = () => { this.stepRegs.push(regsFromIo(m.io)); };
    m.onLcdc = (v) => { if (!(v & 0x80)) this.lcdOff = true; };
    this.ppu = new Ppu(m.vram, m.oam);
    this.g.onLine = (y) => {
      if (y === 0) { this.ppu.beginFrame(); this.raster = false; this.vramWrites = m.rd(0xc39e) === 0x9f; }
      if (this.g.lineHook) this.raster = true;
      this.ppu.regs = regsFromIo(m.io);
      this.lineRegs[y] = this.ppu.regs;
      this.ppu.line(y);
    };
  }
  /** The last frame drawn again with line y taking line src's registers. */
  redraw(y: number, src: number): Uint8Array {
    const m = this.g.m;
    const p = new Ppu(m.vram, m.oam);
    p.beginFrame();
    for (let k = 0; k < 144; k++) {
      p.regs = this.lineRegs[k === y ? src : k]!;
      p.line(k);
    }
    return p.frame;
  }
  /** The last frame drawn again with PyBoy's object order instead of the DMG's: objects painted
   *  from the lowest priority to the highest, so a high-priority object hidden behind the
   *  background (attribute bit 7, background colour not 0) leaves the lower one visible; the
   *  hardware (and @ffl2k/render) lets it mask the pixel instead (Pan Docs, "object priority"). */
  redrawPyBoyObjects(): Uint8Array {
    const m = this.g.m, vram = m.vram, oam = m.oam;
    const bg = new Ppu(vram, oam), idx = new Ppu(vram, oam);
    bg.beginFrame();
    idx.beginFrame();
    for (let y = 0; y < 144; y++) {
      const r = this.lineRegs[y]!;
      bg.regs = { ...r, lcdc: r.lcdc & ~0x02 };
      idx.regs = { ...r, lcdc: r.lcdc & ~0x02, bgp: 0xe4 };
      bg.line(y);
      idx.line(y);
      if (!(r.lcdc & 0x02)) continue;
      const h = r.lcdc & 0x04 ? 16 : 8;
      const line: number[] = [];
      for (let i = 0; i < 40 && line.length < 10; i++) {
        const sy = oam[4 * i]! - 16;
        if (y >= sy && y < sy + h) line.push(i);
      }
      // lowest priority first: larger X, then larger OAM index
      line.sort((a, b) => oam[4 * b + 1]! - oam[4 * a + 1]! || b - a);
      for (const i of line) {
        const sy = oam[4 * i]! - 16, sx = oam[4 * i + 1]! - 8, fl = oam[4 * i + 3]!;
        let tile = oam[4 * i + 2]!;
        if (h === 16) tile &= 0xfe;
        let ty = y - sy;
        if (fl & 0x40) ty = h - 1 - ty;
        const a = tile * 16 + ty * 2;
        for (let tx = 0; tx < 8; tx++) {
          const x = sx + tx;
          if (x < 0 || x >= 160) continue;
          const px = fl & 0x20 ? 7 - tx : tx;
          const c = (((vram[a + 1]! >> (7 - px)) & 1) << 1) | ((vram[a]! >> (7 - px)) & 1);
          if (!c) continue;
          if (fl & 0x80 && idx.frame[y * 160 + x] !== 0) continue;
          bg.frame[y * 160 + x] = ((fl & 0x10 ? r.obp1 : r.obp0) >> (2 * c)) & 3;
        }
      }
    }
    return bg.frame;
  }

  /** The last frame drawn again from a VRAM (each line with its registers), or with fixed
   *  registers. */
  redrawFrom(vram: Uint8Array, regs?: LcdRegs): Uint8Array {
    const p = new Ppu(vram, this.g.m.oam);
    p.beginFrame();
    for (let k = 0; k < 144; k++) {
      p.regs = regs ?? this.lineRegs[k]!;
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
  meta: { state: string; plan: string; hook: string; start: { regs: Record<string, number>; frame: number; ly: number }; frames: { btn: string; ff89: number }[] };
  start: Uint8Array;
  screens: Uint8Array;
  hram: Uint8Array;
  /** Per frame: CEC2 (sound tick accumulator), C3A0. */
  tick: Uint8Array;
  waits: Uint8Array;
  waitFrames: number[];
  /** VRAM writes the original made in hblank with the LCD on: [frame, LY, address]. */
  vramWrites?: [number, number, number][];
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

export function loadTrace(name: string): Trace {
  const d = resolve(TRACES, name);
  const rd = (f: string) => new Uint8Array(readFileSync(resolve(d, f)));
  const meta = JSON.parse(readFileSync(resolve(d, "trace.json"), "utf8"));
  const start = rd("start.bin");
  return {
    name, meta, start, screens: undelta(rd("screens.dx.gz"), FRAME_BYTES), hram: rd("hram.bin"),
    tick: existsSync(resolve(d, "tick.bin")) ? rd("tick.bin") : new Uint8Array(0),
    waits: undelta(rd("waits.dx.gz"), 0x8000, start),
    ...waitsJson(resolve(d, "waits.json")),
    ...(existsSync(resolve(d, "prev.bin")) ? { prevScreen: rd("prev.bin") } : {}),
  };
}

function waitsJson(p: string): { waitFrames: number[]; vramWrites?: [number, number, number][] } {
  const w = JSON.parse(readFileSync(p, "utf8"));
  return { waitFrames: w.frames, ...(w.vw ? { vramWrites: w.vw } : {}) };
}

export function screenDiff(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < FRAME_BYTES; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** Whether the original's frame tick ran in trace frame f: the sound driver adds the tempo to
 *  CEC2 on every call (07:403A). Used for busy frames only. */
export function tickInFrame(t: Trace, f: number): boolean {
  if (f <= 0 || 2 * (f + 1) > t.tick.length) return true;
  return t.tick[2 * f] !== t.tick[2 * (f - 1)];
}

export * from "./replay.js";
