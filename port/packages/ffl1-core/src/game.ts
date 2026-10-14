/** Legend I engine runtime: the frame clock and the work the original does in its interrupt
 *  handlers. The design follows @ffl2k/core's Game (the TOL engine core); the interrupt model is
 *  Legend I's own (derived from this ROM, docs/ffl1/ROM_MAP.md):
 *   - rst $10 (00:00C7) halts until LY >= 0x90: a frame wait ends at the frame's vblank;
 *   - vblank (vector C39A -> 00:06D3) only sets LYC = 0 and clears IF;
 *   - the STAT handler is the jp at C39D: 00:06D0 (normal: at LY = LYC = 0 the frame tick 00:06DB,
 *     sound driver + joypad) or 00:069F (installed by 00:043D while VRAM is written: the tick at
 *     line 0, then LYC = LY + 1 every line, each handler waiting for hblank).
 *  Ported code is written as generators (`Co`); `yield` is a frame wait. */
import { Memory, type Segments } from "./memory.js";

export type Co<T = void> = Generator<number | void, T, void>;
export const VSYNC = 1;
/** Yielded by a busy loop that polls state set by the frame tick (line 0, LYC = 0): the code
 *  resumes right after the next tick, in that frame (lines 1-143 drawn after it). */
export const TICK = 2;
export type LineHandler = (g: Game, ly: number) => void;

/** Joypad bits as the game stores them (FF8D/FF8E): low nibble buttons, high nibble directions. */
export const BTN = { A: 0x01, B: 0x02, SELECT: 0x04, START: 0x08, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80 } as const;

export interface GameOptions {
  /** Text appears without per-character frames (P5; off = the original). */
  fastText: boolean;
}
export const DEFAULT_OPTIONS: Readonly<GameOptions> = Object.freeze({ fastText: false });

export class Game {
  readonly m: Memory;
  readonly options: GameOptions = { ...DEFAULT_OPTIONS };
  /** Hints for the player shell; never read by game logic. */
  readonly ui = { battleCommand: false, fieldFrame: -1 };
  /** Buttons physically held this frame (BTN bits). */
  buttons = 0;
  /** Interrupt master enable (di/ei/reti). */
  ime = true;
  lineHook: ((ly: number) => void) | null = null;
  frame = 0;
  /** STAT handlers by original address (target of the jp at C39D). */
  readonly statHandlers = new Map<number, LineHandler>();
  onLine: ((ly: number) => void) | null = null;
  onFrameDone: (() => void) | null = null;
  onWait: ((kind: number | void) => void) | null = null;
  /** Frames to spend before the next wait completes, as if the CPU were still busy (CPU-bound
   *  stretches of the original, e.g. VRAM copies paced by the 00:069F handler). */
  busyFrames = 0;
  onBusyFrame: ((k: number) => boolean | void) | null = null;
  onYield: ((kind: number | void) => void) | null = null;
  /** Parity only: the line time (any monotonic clock) of a VRAM write the original made in
   *  hblank, or undefined for at once; with it, the line time of a line about to be drawn.
   *  Writes done in pacedWrites are then applied line by line, as the original's code did them
   *  (00:069F hands it the CPU in each line's hblank). Unset: at once (play). */
  writeTime: ((addr: number) => number | undefined) | null = null;
  lineTime: ((ly: number) => number) | null = null;
  private timed: number[] = []; // addr, value, time
  private timedAt = 0;
  hooks: {
    soundTick?: (g: Game) => void; // 07:4003, from the frame tick
    softReset?: (g: Game) => void; // A+B+Select+Start (00:071C -> 00:0224)
    divSeed?: (g: Game) => void; // 00:028C: C300-C37F read from DIV (FF04) at the start
  } = {};
  private main: Co | null = null;
  done = false;

  constructor(segments: Segments) {
    this.m = new Memory(segments);
  }

  start(main: Co): void {
    this.main = main;
    this.done = false;
  }

  /** rst $28: select a ROM bank; the original returns with reti (interrupts enabled). */
  selectBank(b: number): number {
    this.ime = true;
    return this.m.selectBank(b);
  }

  /** The last yield was TICK: the next frame resumes the code after its line 0. */
  private tickPending = false;

  runFrame(): void {
    let waited = false, kind: number | void = undefined, from = 0;
    if (this.main && !this.done) {
      try {
        let r: IteratorResult<number | void, void>;
        this.flushTimed();
        if (this.tickPending) {
          this.tickPending = false;
          this.lineRange(0, 1);
          from = 1;
        }
        r = this.main.next();
        if (!r.done && r.value === TICK && from === 0) {
          // the tick of this very frame: line 0, then on
          this.lineRange(0, 1);
          from = 1;
          r = this.main.next();
        }
        if (r.done) this.done = true;
        else {
          waited = true;
          kind = r.value;
          if (kind === TICK) this.tickPending = true;
          this.onWait?.(kind);
        }
      } catch (e) {
        this.done = true;
        throw e;
      }
    }
    for (let k = 0; this.busyFrames > 0; k++) {
      this.busyFrames--;
      const irq = this.onBusyFrame?.(k) !== false, ime = this.ime;
      if (!irq) this.ime = false;
      // a frame whose line 0 is drawn already (TICK) is the first busy frame
      this.lines(false, undefined, from);
      from = 0;
      this.ime = ime;
      this.frame++;
    }
    this.lines(waited, kind, from);
    this.frame++;
  }

  private lineRange(a: number, b: number): void {
    const io = this.m.io;
    for (let ly = a; ly < b; ly++) {
      io[0x44] = ly;
      if (this.timedAt < this.timed.length) this.applyTimed(ly);
      this.lineHook?.(ly);
      this.statCheck(ly);
      this.onLine?.(ly);
    }
  }

  private lines(waited: boolean, kind?: number | void, from = 0): void {
    const io = this.m.io;
    this.lineRange(from, 144);
    io[0x44] = 0x90;
    if (this.timedAt < this.timed.length) this.applyTimed(0x90);
    if (this.ime && this.m.hram[0x7f]! & 0x01) this.vblank();
    if (waited) this.onYield?.(kind);
    this.onFrameDone?.();
    for (let ly = 0x91; ly < 154; ly++) {
      io[0x44] = ly;
      if (this.timedAt < this.timed.length) this.applyTimed(ly);
      this.statCheck(ly);
    }
  }

  /** Runs fn, a stretch of VRAM writes the original makes in hblanks (00:069F): with writeTime
   *  set, its writes are undone and replayed at their recorded line times; reads in fn see its
   *  own earlier writes, as the original's do. */
  pacedWrites(fn: () => void): void {
    if (!this.writeTime) return fn();
    const m = this.m, log: number[] = [], wr = m.wr;
    m.wr = (a: number, v: number) => {
      if (a >= 0x8000 && a < 0xa000) log.push(a, m.rd(a), v & 0xff);
      wr.call(m, a, v);
    };
    try {
      fn();
    } finally {
      m.wr = wr;
    }
    for (let i = log.length - 3; i >= 0; i -= 3) wr.call(m, log[i]!, log[i + 1]!);
    for (let i = 0; i < log.length; i += 3) {
      const t = this.writeTime(log[i]!);
      if (t === undefined && this.timedAt >= this.timed.length) wr.call(m, log[i]!, log[i + 2]!);
      else this.timed.push(log[i]!, log[i + 2]!, t ?? -1);
    }
  }

  /** The timed writes made before this line (in an earlier hblank). */
  private applyTimed(ly: number): void {
    const now = this.lineTime ? this.lineTime(ly) : Infinity, q = this.timed;
    let i = this.timedAt;
    while (i < q.length && q[i + 2]! < now) {
      this.m.wr(q[i]!, q[i + 1]!);
      i += 3;
    }
    this.timedAt = i;
    if (i >= q.length) { this.timed = []; this.timedAt = 0; }
  }

  /** Before the code goes on: the writes still pending come first. */
  private flushTimed(): void {
    const q = this.timed;
    for (let i = this.timedAt; i < q.length; i += 3) this.m.wr(q[i]!, q[i + 1]!);
    this.timed = [];
    this.timedAt = 0;
  }

  private statCheck(ly: number): void {
    const m = this.m;
    if (!this.ime) return;
    if (!(m.hram[0x7f]! & 0x02) || !(m.io[0x41]! & 0x40) || m.io[0x45] !== ly) return;
    const vec = m.wram[0x39e]! | (m.wram[0x39f]! << 8); // C39D: jp nnnn
    const h = this.statHandlers.get(vec);
    if (!h) throw new Error(`no STAT handler for ${vec.toString(16)}`);
    h(this, ly);
  }

  /** 00:06D3 — vblank: LYC = 0, IF = 0. */
  private vblank(): void {
    this.m.io[0x45] = 0;
    this.m.io[0x0f] = 0;
  }
}
