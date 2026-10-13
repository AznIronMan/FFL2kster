/** Legend III engine runtime: the frame clock, line by line, with the interrupt model of this ROM
 *  (docs/ffl3/ROM_MAP.md):
 *   - vblank jumps through C0B9 (normally 00:11A2; 00:1EFA in the VRAM bracket 00:1D9E), STAT
 *     through C0BC (normally 00:11E3 = reti; 00:1F27 at LYC = 3 in the bracket);
 *   - the frame wait 00:3A6D sets FF95 = n and halts until the vblank handler has counted it
 *     down to 0 (00:3A71-3A77);
 *   - the VRAM bracket enter/leave (00:1D9E / 00:1DFD) poll STAT for mode 1 with interrupts off,
 *     switch the handlers, and end with reti: the pending vblank interrupt is taken at once.
 *  Ported code is written as generators (`Co`) that yield what they wait for; the code between
 *  two yields runs in no time (CPU time is not modelled: the parity replay re-times frame waits
 *  from the trace, see `onWaitStart`). */
import { Memory, type Segments } from "./memory.js";

export type Co<T = void> = Generator<number | void, T, void>;
/** Frame wait (00:3A6D): resume when FF95 is 0 after an interrupt. */
export const WAIT = 1;
/** STAT polled for mode 1 (00:1E2E): resume at line 144, before the vblank interrupt is taken. */
export const VBLANK = 2;
/** Interrupts enabled here (reti / ei): pending interrupts are taken, then the code goes on. */
export const IRQ = 3;
/** CPU time spent before a frame wait (parity re-timing): resume after the next vblank
 *  interrupt. */
export const BUSY = 4;

export type Handler = (g: Game) => void;

/** Joypad bits as the game stores them (FF8A held / FF8B pressed): A, B, Select, Start in the
 *  low nibble, Right, Left, Up, Down in the high nibble (00:36F1). */
export const BTN = { A: 0x01, B: 0x02, SELECT: 0x04, START: 0x08, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80 } as const;

export interface GameOptions {
  /** Text appears without per-character frames (off = the original). */
  fastText: boolean;
}
export const DEFAULT_OPTIONS: Readonly<GameOptions> = Object.freeze({ fastText: false });

export class Game {
  readonly m: Memory;
  readonly options: GameOptions = { ...DEFAULT_OPTIONS };
  /** Buttons physically held this frame (BTN bits). */
  buttons = 0;
  /** Interrupt master enable (di/ei/reti). */
  ime = true;
  frame = 0;
  ly = 0;
  /** The vblank interrupt of the current frame has been taken. */
  vblankTaken = false;
  /** Interrupt handlers by original address (the jp at C0B9 / C0BC). */
  readonly handlers = new Map<number, Handler>();
  onLine: ((ly: number) => void) | null = null;
  onFrameDone: (() => void) | null = null;
  /** A frame wait is about to set FF95 = n: the number of frames the original was still busy
   *  before it (parity re-timing; 0 in play). */
  onWaitStart: ((n: number) => number) | null = null;
  /** A frame wait ended (00:3A77): the trace's wait point. */
  onWaitDone: (() => void) | null = null;
  hooks: {
    soundTick?: (g: Game) => void; // 0F:4006 (through 00:1F3A)
    /** 00:3549 — the frame work run while CD3D is set (bracket STAT handler, bracket switches). */
    statWork?: (g: Game) => void;
  } = {};
  private main: Co<unknown> | null = null;
  private waiting = 0;
  private busyUntil = -1;
  done = false;

  constructor(segments: Segments) {
    this.m = new Memory(segments);
  }

  start(main: Co<unknown>): void {
    this.main = main;
    this.done = false;
    this.waiting = -1; // run at the first opportunity
  }

  /** What the code waits for (WAIT, VBLANK, BUSY; 0 running or done). */
  get waitingFor(): number {
    return this.waiting;
  }

  /** The frame whose vblank interrupt comes next. */
  nextVblankFrame(): number {
    return this.vblankTaken ? this.frame + 1 : this.frame;
  }

  /** Run lines `from`..153 of the current frame. */
  runFrame(from = 0): void {
    const m = this.m, io = m.io;
    if (from === 0) this.vblankTaken = false;
    for (let ly = from; ly < 154; ly++) {
      this.ly = ly;
      io[0x44] = ly;
      if (ly === io[0x45] && io[0x41]! & 0x40) io[0x0f] = io[0x0f]! | 0x02;
      if (ly === 144) io[0x0f] = io[0x0f]! | 0x01;
      if (this.waiting === -1) this.resume();
      if (this.waiting === VBLANK && ly >= 144) this.resume();
      const took = this.serve();
      if (took && this.waiting === WAIT && m.hram[0x15] === 0) {
        this.onWaitDone?.();
        this.resume();
      }
      if (this.waiting === BUSY && this.frame === this.busyUntil && this.vblankTaken) this.resume();
      if (ly < 144) this.onLine?.(ly);
    }
    this.onFrameDone?.();
    this.frame++;
    this.vblankTaken = false;
  }

  /** Take pending enabled interrupts (vblank first). Returns whether one was taken. */
  serve(): boolean {
    const m = this.m, io = m.io;
    let took = false;
    while (this.ime) {
      const p = io[0x0f]! & m.hram[0x7f]! & 0x1f;
      if (!p) break;
      const bit = p & 1 ? 1 : p & 2 ? 2 : p & 4 ? 4 : p & 8 ? 8 : 16;
      io[0x0f] = io[0x0f]! & ~bit;
      if (bit === 1) this.vblankTaken = true;
      const vec = bit === 1 ? 0xc0b9 : bit === 2 ? 0xc0bc : -1;
      if (vec < 0) throw new Error(`interrupt ${bit} not modelled`);
      if (m.rd(vec) !== 0xc3) throw new Error(`no jp at ${vec.toString(16)}`);
      const addr = m.rd16(vec + 1);
      const h = this.handlers.get(addr);
      if (!h) throw new Error(`no interrupt handler for ${addr.toString(16)}`);
      this.ime = false;
      h(this);
      this.ime = true; // reti
      took = true;
    }
    return took;
  }

  private resume(): void {
    if (!this.main || this.done) return;
    for (;;) {
      this.waiting = 0;
      let r: IteratorResult<number | void, unknown>;
      try {
        r = this.main.next();
      } catch (e) {
        this.done = true;
        throw e;
      }
      if (r.done) { this.done = true; return; }
      const k = r.value ?? WAIT;
      if (k === IRQ) { this.serve(); continue; }
      if (k === VBLANK && this.ly >= 144) continue;
      if (k === BUSY) this.busyUntil = this.nextVblankFrame();
      this.waiting = k;
      return;
    }
  }

  // ---------------------------------------------------------------- waits used by ported code

  /** 00:3A6D — wait n frames (FF95 = n, halt until the vblank handler counted it down). */
  *wait(n: number): Co {
    const b = n ? this.onWaitStart?.(n) ?? 0 : 0;
    for (let k = 0; k < b; k++) yield BUSY;
    this.m.hram[0x15] = n & 0xff;
    if (n) yield WAIT;
  }

  /** 00:1E2E — poll STAT until mode 1 (vblank). */
  *untilVblank(): Co {
    yield VBLANK;
  }

  /** reti / ei: interrupts on; pending ones are taken now. */
  *reti(): Co {
    this.ime = true;
    yield IRQ;
  }
}
