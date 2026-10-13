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
  hooks: {
    soundTick?: (g: Game) => void; // 07:4003, from the frame tick
    softReset?: (g: Game) => void; // A+B+Select+Start (00:071C -> 00:0224)
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

  runFrame(): void {
    let waited = false, kind: number | void = undefined;
    if (this.main && !this.done) {
      try {
        const r = this.main.next();
        if (r.done) this.done = true;
        else {
          waited = true;
          kind = r.value;
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
      this.lines(false);
      this.ime = ime;
      this.frame++;
    }
    this.lines(waited, kind);
    this.frame++;
  }

  private lines(waited: boolean, kind?: number | void): void {
    const io = this.m.io;
    for (let ly = 0; ly < 144; ly++) {
      io[0x44] = ly;
      this.lineHook?.(ly);
      this.statCheck(ly);
      this.onLine?.(ly);
    }
    io[0x44] = 0x90;
    if (this.ime && this.m.hram[0x7f]! & 0x01) this.vblank();
    if (waited) this.onYield?.(kind);
    this.onFrameDone?.();
    for (let ly = 0x91; ly < 154; ly++) {
      io[0x44] = ly;
      this.statCheck(ly);
    }
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
