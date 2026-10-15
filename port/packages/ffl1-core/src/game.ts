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
/** Yielded by `untilPoint`: the code goes on after the trace frame `Game.pointFrame` (the frames
 *  before it are run as busy frames by the replay). */
export const POINT = 3;
export type LineHandler = (g: Game, ly: number) => void;

/** Joypad bits as the game stores them (FF8D/FF8E): low nibble buttons, high nibble directions. */
export const BTN = { A: 0x01, B: 0x02, SELECT: 0x04, START: 0x08, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80 } as const;

export interface GameOptions {
  /** Text appears without per-character frames (P5; off = the original). */
  fastText: boolean;
}
export const DEFAULT_OPTIONS: Readonly<GameOptions> = Object.freeze({ fastText: false });

/** Unwinds the code at a soft reset (`Game.restart` from inside it). */
class Restart extends Error {}

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
   *  VRAM writes made inside the VRAM bracket (00:043D .. 00:044E, the 069F handler giving the code
   *  the CPU in each line's hblank) are then applied line by line, as the original's were. Unset:
   *  at once (play). */
  writeTime: ((addr: number) => number | undefined) | null = null;
  /** Parity only: whether the original made its next field direction read (00:209D) after the
   *  next frame's tick (the code then resumes after that tick, TICK). */
  onPoll: (() => boolean) | null = null;
  /** Parity only: a TICK yielded before this frame's line 0 (its tick reads this frame's buttons). */
  onTickInFrame: (() => void) | null = null;
  lineTime: ((ly: number) => number) | null = null;
  private timed: number[] = []; // addr, value, time
  private timedAt = 0;
  /** Writes scheduled at line times (`schedule`; not flushed when the code goes on). */
  private sched: number[] = []; // addr, value, time
  private schedAt = 0;
  /** Parity only: the times [frame, LY] the original reached a sync point (trace "points"). */
  onPointTimes: ((addr: number) => [number, number][] | undefined) | null = null;
  /** Parity only: the line time at which the original took the wave's STAT for line ly of this
   *  frame, when it took it late (trace "waveLate"); undefined: on time. */
  onWaveLate: ((ly: number) => number | undefined) | null = null;
  /** Parity: the wave round started at [frame, LY] raced the beam: the frame and LY of each table
   *  store until the vblank (waits.json "waveStores"); undefined when it started in the vblank. */
  onWaveStores: ((frame: number, ly: number) => { f: number; ly: number[] } | undefined) | null = null;
  /** Parity only: the trace frame of the next frame to be drawn. */
  traceFrame: (() => number) | null = null;
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

  /** Parity: a soft reset (`restart`): the records of the code before it are left behind. */
  onRestart: (() => void) | null = null;

  /** The code is running (`main.next()`), not an interrupt handler between its yields. */
  private inMain = false;

  /** A+B+Select+Start in the frame tick (00:071C jp 00:0224, from the STAT handler or a direct
   *  call): the code starts again with `co` (di, the stack reset); the frame's lines go on. */
  restart(co: Co): void {
    this.main = co;
    this.done = false;
    this.tickPending = false;
    this.busyFrames = 0;
    this.ime = false;
    this.onRestart?.();
    if (this.inMain) throw new Restart();
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
        this.inMain = true;
        r = this.main.next();
        this.inMain = false;
        this.endDeferIo();
        this.queuePaced();
        if (!r.done && r.value === TICK && from === 0) {
          // the tick of this very frame: line 0, then on
          this.onTickInFrame?.();
          this.lineRange(0, 1);
          from = 1;
          this.inMain = true;
          r = this.main.next();
          this.inMain = false;
          this.endDeferIo();
          this.queuePaced();
        }
        if (r.done) this.done = true;
        else {
          waited = true;
          kind = r.value;
          if (kind === TICK) this.tickPending = true;
          this.onWait?.(kind);
        }
      } catch (e) {
        this.inMain = false;
        if (!(e instanceof Restart)) {
          this.done = true;
          throw e;
        }
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
      if (this.timedAt < this.timed.length || this.schedAt < this.sched.length) this.applyTimed(ly);
      this.lineHook?.(ly);
      this.statCheck(ly);
      this.onLine?.(ly);
    }
  }

  private lines(waited: boolean, kind?: number | void, from = 0): void {
    const io = this.m.io;
    this.lineRange(from, 144);
    io[0x44] = 0x90;
    if (this.timedAt < this.timed.length || this.schedAt < this.sched.length) this.applyTimed(0x90);
    if (this.ime && this.m.hram[0x7f]! & 0x01) this.vblank();
    if (waited) this.onYield?.(kind);
    this.onFrameDone?.();
    for (let ly = 0x91; ly < 154; ly++) {
      io[0x44] = ly;
      if (this.timedAt < this.timed.length || this.schedAt < this.sched.length) this.applyTimed(ly);
      this.statCheck(ly);
    }
  }

  /** The VRAM bracket's writes being logged (parity: `writeTime`): address, old, new. */
  private paceLog: number[] | null = null;
  private paceWr: ((a: number, v: number) => void) | null = null;

  /** 00:043D installed the 069F handler: from here VRAM writes are paced (with `writeTime`). */
  beginPacing(): void {
    if (!this.writeTime || this.paceLog) return;
    const m = this.m, log: number[] = [], wr = m.wr;
    this.paceLog = log;
    this.paceWr = wr;
    m.wr = (a: number, v: number) => {
      if (m.pacedSite && a >= 0x8000 && a < 0xa000) log.push(a, m.rd(a), v & 0xff);
      wr.call(m, a, v);
    };
  }

  /** The normal STAT handler back (00:044E / 044F): no more pacing. */
  endPacing(): void {
    if (!this.paceLog) return;
    this.queuePaced();
    this.m.wr = this.paceWr!;
    this.paceLog = null;
    this.paceWr = null;
  }

  /** The logged writes undone (reads in the code saw them, as the original's do) and queued at
   *  their recorded line times. */
  private queuePaced(): void {
    const log = this.paceLog, wr = this.paceWr;
    if (!log || !log.length || !wr) return;
    const m = this.m;
    for (let i = log.length - 3; i >= 0; i -= 3) wr.call(m, log[i]!, log[i + 1]!);
    for (let i = 0; i < log.length; i += 3) {
      const t = this.writeTime!(log[i]!);
      if (t === undefined && this.timedAt >= this.timed.length) wr.call(m, log[i]!, log[i + 2]!);
      else this.timed.push(log[i]!, log[i + 2]!, t ?? -1);
    }
    log.length = 0;
  }

  /** The timed writes made before this line (in an earlier hblank). */
  private pointAt = new Map<number, number>();
  /** The trace frame after which `untilPoint` resumes (read by the replay with POINT). */
  pointFrame = 0;

  /** Parity: a sync point — the line time at which the original reached addr (its next recorded
   *  time), for the writes due on that line (`schedule`); undefined without a record (play). */
  pointTime(addr: number): number | undefined {
    const ts = this.onPointTimes?.(addr);
    if (!ts || !this.traceFrame) return undefined;
    const k = this.pointAt.get(addr) ?? 0;
    this.pointAt.set(addr, k + 1);
    const p = ts[k];
    return p ? p[0] * 154 + p[1] : undefined;
  }

  /** Parity: the code goes on in the frame of line time t (the port does not resume in the middle
   *  of a frame): the frames before it pass, and until the code's next wait its writes to the LCD
   *  registers (FF40-FF4B) land on t's line, after the ones scheduled there. */
  *untilPoint(t: number | undefined): Co {
    if (t === undefined || !this.traceFrame) return;
    const f = Math.floor(t / 154);
    if (this.traceFrame() < f) {
      this.pointFrame = f - 1;
      yield POINT;
    }
    this.deferIo(t);
  }

  private ioWr: ((a: number, v: number) => void) | null = null;
  private deferIo(t: number): void {
    if (this.ioWr) return;
    const m = this.m, wr = m.wr;
    this.ioWr = wr;
    m.wr = (a: number, v: number) => {
      if (a >= 0xff40 && a <= 0xff4b && a !== 0xff44 && a !== 0xff46) this.schedule(t, a, v);
      else wr.call(m, a, v);
    };
  }
  private endDeferIo(): void {
    if (!this.ioWr) return;
    this.m.wr = this.ioWr;
    this.ioWr = null;
  }

  /** Parity: the write of v at addr at line time t (as `lineTime`), in time order. */
  schedule(t: number, addr: number, v: number): void {
    const z = this.sched;
    let i = z.length;
    while (i > this.schedAt && z[i - 1]! > t) i -= 3; // in time order (equal times: as made)
    z.splice(i, 0, addr, v & 0xff, t);
  }

  private applyTimed(ly: number): void {
    const now = this.lineTime ? this.lineTime(ly) : Infinity;
    if (this.schedAt < this.sched.length) {
      const z = this.sched;
      let j = this.schedAt;
      while (j < z.length && z[j + 2]! < now) {
        this.m.wr(z[j]!, z[j + 1]!);
        j += 3;
      }
      this.schedAt = j;
      if (j >= z.length) { this.sched = []; this.schedAt = 0; }
    }
    if (this.timedAt >= this.timed.length) return;
    const q = this.timed;
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
