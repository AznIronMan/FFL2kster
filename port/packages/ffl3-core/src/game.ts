/** Legend III engine runtime: the frame clock, line by line, with the interrupt model of this ROM
 *  (docs/ffl3/ROM_MAP.md):
 *   - vblank jumps through C0B9 (normally 00:11A2; 00:1EFA in the VRAM bracket 00:1D9E), STAT
 *     through C0BC (normally 00:11E3 = reti; 00:1F27 at LYC = 3 in the bracket);
 *   - the frame wait 00:3A6D sets FF95 = n and halts until the vblank handler has counted it
 *     down to 0 (00:3A71-3A77);
 *   - the VRAM bracket enter/leave (00:1D9E / 00:1DFD) disable the interrupts, switch the
 *     handlers, poll STAT for mode 1 and end with reti: the interrupts that came meanwhile (the
 *     vblank, a STAT at LYC) are taken at once, in priority order, by the new handlers.
 *  Ported code is written as generators (`Co`) that yield what they wait for; the code between
 *  two yields runs in no time (CPU time is not modelled: the parity replay re-times frame waits
 *  from the trace, see `onWaitStart`). */
import { Memory, type Segments } from "./memory.js";

export type Co<T = void> = Generator<number | void, T, void>;
/** Frame wait (00:3A6D): resume when FF95 is 0 after an interrupt. */
export const WAIT = 1;
/** STAT polled for mode 1 (00:1E2E): resume at line 144, before the vblank interrupt is taken. */
export const VBLANK = 2;
/** Objects on a line from which the five writes of 00:20FF no longer fit in its hblank. */
const PACED_OBJECTS = 8;
/** Interrupts enabled here (reti / ei): pending interrupts are taken, then the code goes on. */
export const IRQ = 3;
/** CPU time spent before a frame wait (parity re-timing): resume after the next vblank
 *  interrupt. */
export const BUSY = 4;
/** A busy loop polling RAM the interrupts change (no halt, no FF95): resume after an interrupt
 *  once the condition holds. */
export const POLL = 5;
/** CPU time before a VRAM bracket entry (parity re-timing): resume at a given frame and line,
 *  after that line's interrupts. */
export const LINE = 6;

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
  /** The code is about to poll for vblank (the bracket, 00:1E2E): the frame in which the
   *  original's poll ended (parity re-timing: the CPU time before it is spent first, with the
   *  interrupts running); undefined in play. */
  onSync: (() => number | undefined) | null = null;
  /** The code is about to enter or leave the VRAM bracket (00:1D9E / 00:1DFD, di): the frame and
   *  line at which the original did (parity re-timing: the CPU time before it is spent first,
   *  with the interrupts running); undefined in play. */
  onPollStart: (() => [number, number] | undefined) | null = null;
  /** The frame work 00:3557 ran (from 00:3549, CDC5 0 -> 1): the frame and line at which the
   *  original's run ended (parity re-timing: its hblank-paced VRAM copies take lines, during which
   *  CDC5 stays set and the interrupts stay off unless the work enabled them); undefined in
   *  play. */
  /** The original's end of the frame work just run and, for a work that enabled the interrupts,
   *  the time of its di (00:356B): [end frame, end LY, di frame, di LY]. */
  onWork: (() => [number, number] | [number, number, number, number] | undefined) | null = null;
  /** Parity: the original's time of the game's next write of a sound effect request FFBC (the
   *  code before it took CPU time; undefined: none recorded). */
  onSfx: (() => [number, number] | undefined) | null = null;
  /** Parity: whether the original entered the bracket's STAT handler 00:1F27 in frame f (from the
   *  current line on); undefined without that record. */
  onStatIn: ((f: number) => boolean | undefined) | null = null;
  /** With a trace: the times (frame * 154 + LY) at which the original's hblank copy to `dest`
   *  started near `now` first wrote each of its first `len` bytes, and its last chunk's. */
  onPaced: ((dest: number, len: number, now: number) => { first: number[]; end: number } | undefined) | null = null;
  /** Parity: the original's time of the next bracket entry / leave, not taken (a look ahead). */
  onNextPoll: (() => [number, number] | undefined) | null = null;
  /** Parity: the same for the battle script's music requests FFBA. */
  onSong: (() => [number, number] | undefined) | null = null;
  /** Parity: a vblank poll entered on line 153 whose end the trace puts in frame f: whether the
   *  original went on at f's top (it ran something in f's visible lines) or polled a whole frame. */
  onCrossing: ((f: number) => boolean) | null = null;
  /** The code is about to reach `addr` (bank << 16 | address; a sync point): the frame and line
   *  at which the original did (parity re-timing, as `onPollStart`); undefined in play. */
  onPoint: ((addr: number, quiet?: boolean) => [number, number] | undefined) | null = null;
  /** With a trace: when the last object drawing (00:01A0) had its OAM buffer complete (00:01CF,
   *  the DMA hold CD39 restored). */
  objectsOam: [number, number] | undefined;
  /** Debugging output (parity tools). */
  debug: ((msg: string) => void) | null = null;
  hooks: {
    soundTick?: (g: Game) => void; // 0F:4006 (through 00:1F3A)
    /** The stack pointer at 00:1C9C (the port keeps no stack: a call-depth estimate is passed;
     *  the parity rig answers with the original's, read from the trace's next wait). */
    divideSp?: (estimate: number) => number;
    /** 00:3549 — the frame work run while CD3D is set (bracket STAT handler, bracket switches). */
    statWork?: (g: Game) => void;
  } = {};
  private main: Co<unknown> | null = null;
  private waiting = 0;
  private busyUntil = -1;
  private pollFor: (() => boolean) | null = null;
  private syncFrame = -Infinity;
  private lineAt: [number, number] = [-Infinity, 0];
  /** An interrupt handler's work still running in the original (see `handlerBusy`). */
  private work: { end: [number, number]; holds: boolean; done: () => void; di?: [number, number]; code?: boolean } | null = null;
  /** Register writes the interrupt handlers make at later lines (hblank waits), by line. */
  private readonly lineWork = new Map<number, (() => void)[]>();
  /** Writes due at a later frame and line (`at`), in order. */
  private timed: { f: number; l: number; fn: () => void }[] = [];
  done = false;

  constructor(segments: Segments) {
    this.m = new Memory(segments);
    this.m.onSfx = (v) => this.sfx(v);
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

  /** Per line of the current frame: the SCX the line would show had a raster handler's write
   *  landed on the other side of the line's drawing (the port does not count the CPU cycles that
   *  decide it); empty when no handler wrote mid-line. */
  readonly scxAlt: (number | undefined)[] = [];
  /** Lines of the current frame that may show the registers of the line before: a raster handler
   *  timed by hblank polls, entered late (after the line's hblank had begun), makes its writes a
   *  line later (the port does not count the cycles that decide it). */
  readonly lateLines = new Set<number>();

  /** A coincidence LY = LYC the code's STAT / LYC writes came too late for: (frame, line). */
  private lycLate: [number, number] | null = null;

  /** The code's STAT / LYC writes just made land in the next line, after its start (CPU time
   *  before them): that line's coincidence does not interrupt. */
  lycWrittenLate(): void {
    // with a trace: whether the writes beat the line's start is a matter of cycles; the original
    // took that STAT (00:1F27 entered later in this frame) or not
    const took = this.onStatIn?.(this.frame);
    if (took === true) return;
    this.lycLate = [this.frame, this.ly + 1];
  }

  /** Code about to move LYC whose writes land after the next line has begun (CPU time in a di
   *  stretch): a coincidence the old LYC makes on that line still requests a STAT (taken at the
   *  code's ei, by whatever handler is set then). */
  lycStillNext(): void {
    const io = this.m.io;
    if (io[0x45] !== this.ly + 1 || !(io[0x41]! & 0x40)) return;
    // with a trace: the race is decided by where in the line the code was; the original's next
    // bracket call (00:1DFD right after) comes lines later when it took that STAT (its handler ran)
    const p = this.onNextPoll?.();
    if (p && p[0] * 154 + p[1] - (this.frame * 154 + this.ly) <= 2) return;
    this.at(this.frame, this.ly + 1, () => { io[0x0f] = io[0x0f]! | 0x02; });
  }

  /** Run lines `from`..153 of the current frame. */
  runFrame(from = 0): void {
    const m = this.m, io = m.io;
    if (from === 0) { this.vblankTaken = false; this.scxAlt.length = 0; this.lateLines.clear(); }
    else if (from > 144) this.vblankTaken = true; // started after this frame's vblank interrupt
    for (let ly = from; ly < 154; ly++) {
      this.ly = ly;
      io[0x44] = ly;
      const work = this.lineWork.get(ly);
      if (work) { this.lineWork.delete(ly); for (const f of work) f(); }
      if (this.timed.length) this.runTimed();
      const on = io[0x40]! & 0x80; // (the LCD off: no vblank, no STAT)
      if (on && ly === io[0x45] && io[0x41]! & 0x40 && !(this.lycLate && this.lycLate[0] === this.frame && this.lycLate[1] === ly))
        io[0x0f] = io[0x0f]! | 0x02;
      if (on && ly === 144) io[0x0f] = io[0x0f]! | 0x01;
      if (this.waiting === -1) this.resume();
      if (this.waiting === VBLANK && ly >= 144 && this.frame >= this.syncFrame) this.resume();
      let took = this.serve();
      if (this.work && this.reachedAt(this.work.end)) {
        const done = this.work.done;
        // run by the code (00:1E38): it returns with the interrupts off after its di
        if (this.work.code && this.work.di) this.ime = false;
        this.work = null;
        done();
        took = this.serve() || took;
      }
      if (took && this.waiting === WAIT && m.hram[0x15] === 0) {
        this.onWaitDone?.();
        this.resume();
      }
      if (took && this.waiting === POLL && this.pollFor?.()) this.resume();
      if (this.waiting === LINE && this.reached() && !this.work) this.resume();
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
    while (this.ime && !this.workHolds()) {
      const p = io[0x0f]! & m.hram[0x7f]! & 0x1f;
      if (!p) break;
      const bit = p & 1 ? 1 : p & 2 ? 2 : p & 4 ? 4 : p & 8 ? 8 : 16;
      io[0x0f] = io[0x0f]! & ~bit;
      if (bit === 1) this.vblankTaken = true;
      const vec = bit === 1 ? 0xc0b9 : bit === 2 ? 0xc0bc : -1;
      if (vec < 0) throw new Error(`interrupt ${bit} not modelled`);
      if (m.rd(vec) === 0xc9) { // a `ret` vector (01:5EB8): the interrupts stay off (no reti)
        this.ime = false;
        took = true;
        continue;
      }
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
      if (k === IRQ) {
        this.serve();
        // a handler taken here whose work goes on (CPU time): the code waits for its end
        if (this.work) { this.lineAt = this.work.end; this.waiting = LINE; return; }
        continue;
      }
      if (k === VBLANK && this.ly >= 144 && this.frame >= this.syncFrame) continue;
      if (k === LINE && this.reached() && !this.work) continue;
      if (k === BUSY) this.busyUntil = this.nextVblankFrame();
      this.waiting = k;
      return;
    }
  }

  private reached(): boolean {
    return this.reachedAt(this.lineAt);
  }

  /** The clock is at or after frame f, line l. */
  reachedAt([f, l]: [number, number]): boolean {
    return this.frame > f || (this.frame === f && this.ly >= l);
  }

  /** From an interrupt handler: its work goes on until `end` in the original (CPU time); `done`
   *  runs then. With `holds` (the handler left the interrupts off), no interrupt is taken
   *  before. */
  handlerBusy(end: [number, number], holds: boolean, done: () => void, di?: [number, number]): void {
    if (this.work) throw new Error("handler work overlaps another");
    this.work = { end, holds, done, ...(di ? { di } : {}) };
  }

  /** The work just run was called by the code (00:1E38 from 00:1D9E), not by the STAT handler. */
  workFromCode(): void {
    if (this.work) this.work.code = true;
  }

  /** A running work keeps the interrupts off: it never enabled them, or it is past its di
   *  (00:356B; an interrupt requested on the di's own line came before it). */
  private workHolds(): boolean {
    const w = this.work;
    if (!w) return false;
    if (w.holds) return true;
    return !!w.di && (this.frame > w.di[0] || (this.frame === w.di[0] && this.ly > w.di[1]));
  }

  // ---------------------------------------------------------------- waits used by ported code

  /** Before 00:1D9E / 00:1DFD: with `onPollStart`, the CPU time until the original's entry. */
  *pollStart(): Co {
    this.pollAt = this.onPollStart?.();
    yield* this.until_(this.pollAt);
  }
  /** The original's entry of the last timed poll (`pollStart`). */
  private pollAt: [number, number] | undefined;

  /** Before the routine at `addr` (a sync point): with `onPoint`, the CPU time until the
   *  original's entry. */
  *point(addr: number): Co {
    yield* this.until_(this.onPoint?.(addr));
  }

  /** Poll LY until it equals ly (a busy loop, no interrupt needed): this frame if the line is
   *  still ahead or current, else the next frame. */
  *untilLine(ly: number): Co {
    if (this.ly === ly) return;
    yield* this.until_([this.ly < ly ? this.frame : this.frame + 1, ly]);
  }

  /** A frame work is still running and has enabled the interrupts (01:5730's reti). */
  get workIrq(): boolean {
    return !!this.work && !this.workHolds();
  }

  /** From the code itself (not an interrupt): the frame work it just ran (00:1E38) goes on until
   *  the end the replay gave (`handlerBusy`). */
  *workDone(): Co {
    if (this.work) yield* this.until_(this.work.end);
  }

  private *until_(p: [number, number] | undefined): Co {
    if (!p) return;
    this.lineAt = p;
    yield LINE;
  }

  /** 00:3A6D — wait n frames (FF95 = n, halt until the vblank handler counted it down). */
  *wait(n: number): Co {
    const b = n ? this.onWaitStart?.(n) ?? 0 : 0;
    for (let k = 0; k < b; k++) yield BUSY;
    this.m.hram[0x15] = n & 0xff;
    if (n) yield WAIT;
  }

  /** 00:1E2E — poll STAT until mode 1 (vblank); with `onSync`, not before the frame in which
   *  the original's poll ended. */
  *untilVblank(atTrace = false): Co {
    this.syncFrame = this.onSync?.() ?? -Infinity;
    // entered at the original's time (`atTrace`, a timed poll start) at the end of a vblank, the
    // poll ending in the next frame: it either passed on line 153 (its next instructions run at
    // the next frame's top) or saw that frame begin and polled through it (`onCrossing` tells)
    const e = this.pollAt;
    if (atTrace && e && e[1] >= 144 && e[0] === this.frame && this.ly >= 144 && this.frame === this.syncFrame - 1
        && this.onCrossing?.(this.syncFrame)) {
      yield* this.until_([this.syncFrame, 0]);
      return;
    }
    yield VBLANK;
  }

  /** A busy loop until `cond` holds (checked after each interrupt). */
  *until(cond: () => boolean): Co {
    if (cond()) return;
    this.pollFor = cond;
    yield POLL;
    this.pollFor = null;
  }

  /** `fn` runs at the start of line l of frame f (now when that is not ahead); the writes of
   *  code that paces itself by hblank polls, timed from a sync point's trace time. */
  at(f: number, l: number, fn: () => void): void {
    if (f < this.frame || (f === this.frame && l <= this.ly)) { fn(); return; }
    this.timed.push({ f, l, fn });
  }

  private runTimed(): void {
    const due = this.timed.filter((t) => t.f < this.frame || (t.f === this.frame && t.l <= this.ly));
    if (!due.length) return;
    this.timed = this.timed.filter((t) => !due.includes(t));
    for (const t of due) t.fn();
  }

  /** Runs `fn` now but lets its VRAM writes show only from the trace time t (code whose VRAM
   *  copies are hblank-paced and end there): the bytes it changed are put back and written again
   *  at t, in address order spread evenly from now to t. RAM and registers stay in the code's
   *  order. Without t (play), `fn` simply runs. */
  vramUntil<T>(t: [number, number] | undefined, fn: () => T, oamAtEnd = false, vramAtEnd = false,
    oamAt?: () => [number, number] | undefined): T {
    if (!t) return fn();
    const v = this.m.vram, before = v.slice();
    const w = this.m.wram, oamBefore = oamAtEnd ? w.slice(0, 0xa0) : null;
    const r = fn();
    const changed: [number, number][] = [];
    for (let i = 0; i < v.length; i++) if (v[i] !== before[i]) { changed.push([i, v[i]!]); v[i] = before[i]!; }
    const start = this.frame * 154 + this.ly, end = t[0] * 154 + t[1];
    changed.forEach(([i, b], k) => {
      const at = vramAtEnd ? end : start + Math.floor(((end - start) * (k + 1)) / changed.length);
      this.at(Math.floor(at / 154), at % 154, () => { v[i] = b; });
    });
    if (oamBefore) { // the OAM buffer C000-C09F: complete at the end only (a vblank DMA meanwhile sees the old)
      const now = w.slice(0, 0xa0);
      w.set(oamBefore, 0);
      const o = oamAt?.() ?? t;
      this.at(o[0], o[1], () => w.set(now, 0));
    }
    return r;
  }

  /** Runs `fn`, an hblank-paced VRAM copy (00:20FF) of `len` bytes to `dest`, now; with a trace
   *  its VRAM writes show at the lines the original wrote them (the trace's `paced` record, else a
   *  model: 5 bytes in the hblank of each visible line, the rest in vblank at ~19 a line; on a line
   *  whose objects leave the hblank too short (`PACED_OBJECTS`) the 5 bytes are still written (VRAM
   *  is open in mode 2 too) but 00:20FF sees mode 2 at its check and writes them again on the next
   *  line; no chunk starts on the lines LYC - 1 and LYC: 00:210B waits while LY is within 3 lines
   *  before LYC). `pacedDone` then waits for the copy's end. RAM and registers stay in the code's
   *  order. */
  vramPaced<T>(fn: () => T, dest: number, len: number): T {
    if (!this.onPoint) return fn();
    const v = this.m.vram, before = v.slice();
    const r = fn();
    const changed: [number, number][] = [];
    for (let i = 0; i < v.length; i++) if (v[i] !== before[i]) { changed.push([i, v[i]!]); v[i] = before[i]!; }
    const now = this.frame * 154 + this.ly;
    let rec = this.onPaced?.(dest, len, now);
    if (!rec) { // the model
      const lyc = this.m.rd(0xff45);
      // the bytes a line's hblank (or vblank time) writes, and whether the copy moves on after it
      const line = (l: number): [number, boolean] =>
        l >= 144 ? [19, true] : l === lyc || l + 1 === lyc ? [0, true] : [5, this.objectsOnLine(l) < PACED_OBJECTS];
      const first = new Array<number>(len).fill(-1);
      // (the set-up before the first chunk passes the current line's hblank)
      let t = now + 1, done = 0;
      while (done < len) {
        const [n, on] = line(t % 154);
        for (let o = done; o < done + n && o < len; o++) if (first[o]! < 0) first[o] = t;
        if (on) done += n;
        if (done < len) t++;
      }
      rec = { first, end: t };
    }
    for (const [i, b] of changed) {
      const at = rec.first[(i + 0x8000 - dest) & 0xffff]! + 1; // (written in that line's hblank)
      this.at(Math.floor(at / 154), at % 154, () => { v[i] = b; });
    }
    this.pacedEnd = [Math.floor((rec.end + 1) / 154), (rec.end + 1) % 154];
    return r;
  }

  /** The line after the last chunk of the last `vramPaced` copy (with a trace). */
  private pacedEnd: [number, number] | undefined;

  /** The main code is the copy loop (00:20FF waits for each hblank): it goes on only once the
   *  last `vramPaced` copy has ended. */
  *pacedDone(): Co {
    const p = this.pacedEnd;
    this.pacedEnd = undefined;
    yield* this.until_(p);
  }

  /** The objects on line l (OAM, 8x8 or 8x16 by LCDC bit 2), up to 10. */
  private objectsOnLine(l: number): number {
    const h = this.m.rd(0xff40) & 0x04 ? 16 : 8, o = this.m.oam;
    let n = 0;
    for (let k = 0; k < 0xa0 && n < 10; k += 4) {
      const y = o[k]! - 16;
      if (l >= y && l < y + h) n++;
    }
    return n;
  }

  /** Wait (a busy main code) until the trace time t. */
  *untilTime(t: [number, number] | undefined): Co {
    yield* this.until_(t);
  }

  /** A write the original made at sync point `addr` (one the sound driver reads, FFBA): with a
   *  trace it lands at that point's time (the CPU time before it), without holding the code. */
  atPoint(addr: number, fn: () => void): void {
    const t = this.onPoint?.(addr);
    if (!t) { fn(); return; }
    this.at(t[0], t[1], fn);
  }

  /** A sound effect request: FFBC = v (read by the sound driver's next tick); with a trace it
   *  lands at the original's write time, without holding the code. */
  sfx(v: number): void {
    const t = this.onSfx?.();
    if (!t) { this.m.hram[0x3c] = v & 0xff; return; }
    this.sfxAt = t;
    this.at(t[0], t[1], () => { this.m.hram[0x3c] = v & 0xff; });
  }
  /** A music request FFBA = v from the battle script (0C:4017): with a trace it lands at the
   *  original's write time (the script's CPU time), without holding the code. */
  song(v: number): void {
    const t = this.onSong?.();
    if (!t) { this.m.hram[0x3a] = v & 0xff; return; }
    this.at(t[0], t[1], () => { this.m.hram[0x3a] = v & 0xff; });
  }

  /** The time of the last request `sfx` put off (a tick from the code waits for it). */
  private sfxAt: [number, number] | undefined;

  /** Before a sound tick the code itself runs (00:3A60, 00:361F): the requests it wrote before
   *  are in (the CPU time up to the original's last write). */
  *sfxWritten(): Co {
    const t = this.sfxAt;
    this.sfxAt = undefined;
    if (t && !this.reachedAt(t)) yield* this.until_(t);
  }

  /** The trace time of the next hit of sync point `addr` without waiting for it (code that runs
   *  in no time here but whose writes the original spread over lines); undefined in play. */
  pointTime(addr: number, quiet = false): [number, number] | undefined {
    return this.onPoint?.(addr, quiet);
  }

  /** From an interrupt handler: `fn` runs at the start of line ly + dl (a write in the hblank
   *  of the line before). */
  later(dl: number, fn: () => void): void {
    const l = this.ly + dl;
    if (l > 153) throw new Error("line work past the frame");
    const a = this.lineWork.get(l);
    if (a) a.push(fn); else this.lineWork.set(l, [fn]);
  }

  /** reti / ei: interrupts on; pending ones are taken now. */
  *reti(): Co {
    this.ime = true;
    yield IRQ;
  }
}
