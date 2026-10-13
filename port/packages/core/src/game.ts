/** Engine runtime: the frame clock and the work the original does in interrupt handlers.
 *
 *  Ported game code is written as generator functions (`Co`). `yield` is a frame wait — the
 *  original's `rst $10` (00:00D9, halt until vblank) and its busy-waits on LY. A frame runs:
 *   1. the game code resumes until its next frame wait (on the hardware it runs from vblank into
 *      the first lines of the frame);
 *   2. lines 0-143: the STAT (LY == LYC) handler, then the line is drawn (`onLine`);
 *   3. LY 144: the vblank handler (00:16DF); a `rst $10` wait ends here (`onYield`, the state
 *      the original has when rst $10 returns, 00:00E4);
 *   4. lines 145-153: STAT handler checks.
 *  The default STAT handler runs the per-frame tick (joypad sampling, sound) at line 0, after the
 *  code segment: on the hardware the field loop reads the joypad early in vblank, before line 0,
 *  so code always sees the previous frame's sample. The STAT handler is whichever routine the
 *  code installed at C706-C708 (jp nnnn); handlers are registered by original address, so the
 *  RAM vector bytes stay identical to the original. */
import { Memory, type Segments } from "./memory.js";

/** A coroutine of game code. Yielded values mark the kind of frame wait: VSYNC for the
 *  original's rst $10 (00:00D9), undefined for other waits (LY polling loops, VRAM pacing). */
export type Co<T = void> = Generator<number | void, T, void>;
export const VSYNC = 1;
export type LineHandler = (g: Game, ly: number) => void;

/** Joypad bits as the game stores them in FF89/FF8A. */
export const BTN = { A: 0x01, B: 0x02, SELECT: 0x04, START: 0x08, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80 } as const;

/** Opt-in extras that change game behaviour (P5). Every one is off by default, and off means
 *  the original's behaviour exactly (the parity suites run with the defaults). */
export interface GameOptions {
  /** Text appears a window at a time: no frame per character and no speed delay. */
  fastText: boolean;
  /** Experimental cap break (direction note D): max HP up to 9,999 and stats up to 255, with
   *  4-digit HP and 3-digit stats on screen. Applied by Engine (bytecode constants) and the
   *  text engine (number display). */
  capBreak: boolean;
}

export const DEFAULT_OPTIONS: Readonly<GameOptions> = Object.freeze({ fastText: false, capBreak: false });

export class Game {
  readonly m: Memory;
  /** Opt-in extras (P5); all off by default. */
  readonly options: GameOptions = { ...DEFAULT_OPTIONS };
  /** Hints for the player shell, set by the port's code; never read by game logic.
   *  battleCommand: the battle command menus (01:6AF9) are waiting for input (auto-battle);
   *  fieldFrame: the frame the field main loop last ran (widescreen field). */
  readonly ui = { battleCommand: false, fieldFrame: -1 };
  /** Buttons physically held this frame (BTN bits). */
  buttons = 0;
  /** Interrupt master enable (the original's di/ei); off: no vblank or STAT handlers. */
  ime = true;
  /** Per-line hook installed by code that writes registers at given lines while polling LY
   *  with interrupts off (e.g. the title intro's palette bands); runs before STAT handling. */
  lineHook: ((ly: number) => void) | null = null;
  frame = 0;
  /** STAT interrupt handlers by original address (target of the jp at C706). */
  readonly statHandlers = new Map<number, LineHandler>();
  /** Renderer hook, called after each visible line's STAT handling. */
  onLine: ((ly: number) => void) | null = null;
  /** Called when the visible lines are done (LY 144), before the vblank handler and the code. */
  onFrameDone: (() => void) | null = null;
  /** Called right after the game code reaches a frame wait, before the frame's lines. */
  onWait: ((kind: number | void) => void) | null = null;
  /** Frames to spend before the next wait completes, as if the CPU were still busy (the
   *  original spends frames in CPU-bound stretches such as layout drawing). Set from onWait;
   *  onBusyFrame(k) is called before each. */
  busyFrames = 0;
  /** Called before busy frame k; returning false runs that frame with no interrupts (the
   *  original's CPU-bound stretch had the LCD off or interrupts masked, so no frame tick). */
  onBusyFrame: ((k: number) => boolean | void) | null = null;
  /** Called for each frame wait of the game code (with the yielded marker) at the end of the
   *  frame's lines — the state the original has when rst $10 returns at vblank (00:00E4). */
  onYield: ((kind: number | void) => void) | null = null;
  /** Hooks for subsystems driven from the interrupt handlers. */
  hooks: {
    soundTick?: (g: Game) => void; // 0E:4000 sound driver, once per frame
    vblankFfa5?: (g: Game) => void; // 01:502D when FFA5 != 0
    statFfa5?: (g: Game) => void; // 01:5033 when FFA5 != 0
    spriteTickFf96?: (g: Game) => void; // 00:176C when FF96 != 0
    softReset?: (g: Game) => void; // A+B+Select+Start
    soundInit?: (g: Game) => void; // 0E:4003
  } = {};
  /** Register writes a STAT handler makes too late in its line to show on it (its CPU time runs
   *  past the point where the line's registers are taken); applied after the line is drawn. */
  readonly afterLine: [number, number][] = [];
  private main: Co | null = null;
  /** Set when the main coroutine returned (or threw). */
  done = false;

  constructor(segments: Segments) {
    this.m = new Memory(segments);
  }

  start(main: Co): void {
    this.main = main;
    this.done = false;
  }

  /** Run one video frame (plus any busy frames requested at the wait). */
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

  /** Lines 0-143 (STAT, draw), then 145-153. */
  private lines(waited: boolean, kind?: number | void): void {
    const io = this.m.io;
    // The original's rst $10 (00:00D9) halts until LY reaches 0x90: the wait ends at this frame's
    // vblank, after all of its lines (frame tick at line 0, raster handlers, line hooks).
    for (let ly = 0; ly < 144; ly++) {
      io[0x44] = ly;
      this.lineHook?.(ly);
      this.statCheck(ly);
      this.onLine?.(ly);
      if (this.afterLine.length) {
        for (const [a, v] of this.afterLine) this.m.wr(a, v);
        this.afterLine.length = 0;
      }
    }
    io[0x44] = 0x90;
    // vblank interrupt (IE bit 0), then rst $10 returns: the wait state
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
    const vec = m.wram[0x707]! | (m.wram[0x708]! << 8); // C706: jp nnnn
    const h = this.statHandlers.get(vec);
    if (!h) throw new Error(`no STAT handler for ${vec.toString(16)}`);
    h(this, ly);
  }

  /** 00:16DF vblank interrupt. */
  private vblank(): void {
    const m = this.m;
    if (m.hram[0x25]) this.hooks.vblankFfa5?.(this);
    m.io[0x45] = 0; // LYC = 0
    m.io[0x0f] = 0;
  }
}
