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
  /** VRAM and OAM as the last frame's last line was drawn. */
  private readonly lastVram = new Uint8Array(0x2000);
  private readonly lastOam = new Uint8Array(0xa0);
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
      if (y === 143) { this.lastVram.set(m.vram); this.lastOam.set(m.oam); }
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
  /** The last frame drawn again from the current VRAM and OAM with each line's registers, SCX
   *  replaced where `scx` gives one (and the palettes, when given). */
  redrawScx(scx: (number | undefined)[], pal?: [number, number, number]): Uint8Array {
    const p = new Ppu(this.g.m.vram, this.g.m.oam);
    p.beginFrame();
    for (let k = 0; k < 144; k++) {
      let r = this.lineRegs[k]!;
      if (pal) r = { ...r, bgp: pal[0], obp0: pal[1], obp1: pal[2] };
      p.regs = scx[k] === undefined ? r : { ...r, scx: scx[k]! };
      p.line(k);
    }
    return p.frame;
  }
  /** The last frame drawn again from the current VRAM and OAM, the lines in `late` with the
   *  registers of the line before. */
  redrawLate(late: Set<number>): Uint8Array {
    const p = new Ppu(this.g.m.vram, this.g.m.oam);
    p.beginFrame();
    for (let k = 0; k < 144; k++) {
      p.regs = late.has(k) && k > 0 ? this.lineRegs[k - 1]! : this.lineRegs[k]!;
      p.line(k);
    }
    return p.frame;
  }
  /** The last frame drawn again with the reference emulator's object priority (PyBoy, which
   *  recorded the traces): objects drawn from the lowest priority up, one behind a non-zero BG
   *  pixel leaving the pixel as it was. The DMG instead lets the highest-priority object's opaque
   *  pixel decide even when it is behind the BG, hiding the objects under it (the port's PPU). */
  redrawPyBoyObjects(): Uint8Array {
    const vram = this.lastVram, oam = this.lastOam;
    const raw = new Ppu(vram, oam), base = new Ppu(vram, oam);
    raw.beginFrame();
    base.beginFrame();
    const out = base.frame;
    for (let y = 0; y < 144; y++) {
      const r = this.lineRegs[y]!;
      raw.regs = { ...r, lcdc: r.lcdc & ~0x02, bgp: 0xe4 };
      raw.line(y);
      base.regs = { ...r, lcdc: r.lcdc & ~0x02 };
      base.line(y);
      if (!(r.lcdc & 0x80) || !(r.lcdc & 0x02)) continue;
      const h = r.lcdc & 0x04 ? 16 : 8, line: number[] = [];
      for (let n = 0; n < 40 && line.length < 10; n++) {
        const sy = oam[4 * n]! - 16;
        if (sy <= y && y < sy + h) line.push(n);
      }
      // (lowest priority first: the larger X, then the larger OAM index)
      line.sort((a, b) => (oam[4 * b + 1]! - oam[4 * a + 1]!) || b - a);
      for (const n of line) {
        const sy = oam[4 * n]! - 16, sx = oam[4 * n + 1]! - 8, fl = oam[4 * n + 3]!;
        let tile = oam[4 * n + 2]!;
        if (h === 16) tile &= 0xfe;
        const dy = y - sy, ty = fl & 0x40 ? h - 1 - dy : dy;
        const addr = (tile * 16 + ty * 2) & 0x1fff;
        for (let dx = 0; dx < 8; dx++) {
          const x = sx + dx;
          if (x < 0 || x >= 160) continue;
          const px = fl & 0x20 ? 7 - dx : dx;
          const c = ((vram[addr]! >> (7 - px)) & 1) | (((vram[addr + 1]! >> (7 - px)) & 1) << 1);
          if (!c) continue;
          if (fl & 0x80 && raw.frame[y * 160 + x] !== 0) continue;
          out[y * 160 + x] = ((fl & 0x10 ? r.obp1 : r.obp0) >> (2 * c)) & 3;
        }
      }
    }
    return out;
  }
  get g() {
    return this.engine.g;
  }
}

export interface Trace {
  name: string;
  meta: { state: string; plan: string; hook: string; start: { regs: Record<string, number>; frame: number; ly: number }; frames: { btn: string }[];
    /** Pokes the recording applied as frame wait n ended ("ADDR=VV[/MASK]"). */
    waitPokes?: [number, string[]][] };
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
  /** [frame, LY] of the game's writes of a sound effect request FFBC (traces from 1.45.0). */
  sfx?: [number, number][];
  /** [frame, LY] of the battle script's writes of a music request FFBA (0C:4017). */
  song?: [number, number][];
  /** [frame, LY] of the original's entries to the bracket's STAT handler 00:1F27. */
  stat?: [number, number][];
  /** [frame, LY, FF93] at each call of the random generator 00:39D5 (its FF93 read 00:39D8 from
   *  1.48.0). */
  rand: [number, number, number][];
  /** [frame, LY, de, n] of each chunk the hblank copy 00:20FF writes (n = 5 at 00:2120, 1 for each
   *  of its last bytes at 00:216E; traces from 1.48.0). */
  paced?: [number, number, number, number][];
  prevScreen?: Uint8Array;
  /** The cartridge RAM (8 KB) at the start, then at the end (sram.bin; traces from 1.42.0). */
  sram?: Uint8Array;
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

function waitsJson(f: string): Pick<Trace, "waitFrames" | "syncs" | "polls" | "works" | "starts" | "points" | "rand" | "sfx" | "song" | "stat" | "paced"> {
  const w = JSON.parse(readFileSync(f, "utf8"));
  return { waitFrames: w.frames, syncs: w.syncs ?? [], polls: w.polls ?? [], works: w.works ?? [], starts: w.starts ?? [], rand: w.rand ?? [], sfx: w.sfx, song: w.song, stat: w.stat, paced: w.paced,
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
    ...(existsSync(resolve(d, "sram.bin")) ? { sram: rd("sram.bin") } : {}),
  };
}

export function screenDiff(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < FRAME_BYTES; i++) if (a[i] !== b[i]) n++;
  return n;
}

export * from "./replay.js";
