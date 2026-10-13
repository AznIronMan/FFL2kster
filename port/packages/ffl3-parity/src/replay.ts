/** Replay a Legend III PyBoy trace through the engine and compare every frame wait and screen.
 *  Synchronised on the original's frame waits (00:3A6D-3A77): the i-th wait of the engine is
 *  matched with the i-th one recorded. The port's code runs in no time between waits; the frames
 *  the original's CPU was still busy before a wait (VRAM copies paced by hblank, decompression)
 *  are taken from the trace and spent before the wait starts (`Game.onWaitStart`), with the
 *  interrupts running as in the original. */
import { BUSY, type Co } from "@ffl3k/core";
import { Rig, loadRom, loadTrace, buttonBits, screenDiff, FRAME_BYTES, type Trace } from "./index.js";

export interface WaitDiff {
  wait: number;
  frame: number;
  /** The port's frame at the wait (when it differs from the trace's). */
  portFrame?: number;
  diff: number[];
  values: [number, number, number][];
}

export interface FrameDiff {
  frame: number;
  pixels: number;
  got?: Uint8Array;
}

export interface ReplayOptions {
  start?: (rig: Rig) => Co<unknown>;
  ignore?: (addr: number) => boolean;
  keepGoing?: boolean;
  maxWaits?: number;
  /** Accept frames drawn while the original was still writing (tears; default true). */
  tears?: boolean;
  watch?: (wait: number, frame: number, exp: Uint8Array, got: Uint8Array) => void;
}

export interface ReplayResult {
  trace: Trace; diffs: FrameDiff[]; waits: WaitDiff[]; nWaits: number; busy: number; tears: number;
  /** Frames equal to the port's picture drawn with the original's objects of that frame, in or
   *  right after a busy stretch: the original's code wrote the OAM buffer after that frame's DMA
   *  (CPU time). The objects are compared byte for byte at every wait. */
  oamLate: number;
  error?: { message: string; wait: number };
}

/** The port's entry point for a trace hook. */
export function startFor(rig: Rig, hook: string): Co<unknown> {
  switch (hook) {
    case "01:7C79": return rig.engine.fromTitle();
    default: throw new Error(`no port entry point for hook ${hook}`);
  }
}

/** A frame drawn while the original was still writing VRAM / OAM / palettes (a busy frame: its
 *  code had not reached the frame wait): every pixel is the port's (new) picture or an old one
 *  (the port's previous frame, the original's previous frame). */
export function mixTear(exp: Uint8Array, got: Uint8Array, olds: Uint8Array[]): boolean {
  for (let i = 0; i < exp.length; i++) {
    const v = exp[i];
    if (v !== got[i] && !olds.some((o) => o[i] === v)) return false;
  }
  return true;
}

export function replay(name: string, opts: ReplayOptions = {}): ReplayResult {
  const t = loadTrace(name);
  const rig = new Rig(loadRom());
  const g = rig.g, m = g.m;
  m.loadFull(t.start);
  g.ime = true;
  const wf = t.waitFrames, n = t.meta.frames.length;
  const ign = opts.ignore ?? IGNORE;
  const waits: WaitDiff[] = [], diffs: FrameDiff[] = [];
  let nWaits = 0, busy = 0, tears = 0, oamLate = 0, prevBusy = false;
  let error: { message: string; wait: number } | undefined;
  const btn = (k: number) => buttonBits(t.meta.frames[Math.min(Math.max(k, 0), n - 1)]!.btn);
  g.onWaitStart = (k) => {
    const f = wf[nWaits];
    if (f === undefined) return 0;
    const b = f - (g.nextVblankFrame() + k - 1);
    if (b < 0) {
      error ??= { message: `wait ${nWaits}: the port reaches it ${-b} frame(s) after the original`, wait: nWaits };
      return 0;
    }
    busy += b;
    return b;
  };
  g.onWaitDone = () => {
    const i = nWaits++;
    if ((i + 1) * 0x8000 > t.waits.length) return;
    const exp = t.waits.subarray(i * 0x8000, (i + 1) * 0x8000);
    const got = m.snapshotFull();
    opts.watch?.(i, wf[i] ?? -1, exp, got);
    const diff: number[] = [];
    for (let a = 0; a < 0x8000; a++) {
      const addr = 0x8000 + a;
      if (addr >= 0xa000 && addr < 0xc000) continue;
      if (addr >= 0xe000 && addr < 0xfe00) continue;
      if (addr >= 0xfea0 && addr < 0xff00) continue;
      if (addr >= 0xc0a0 && addr < 0xc0b0 && addr - 0xc0a0 >= exp[0xc0b0 - 0x8000]!) continue;
      const x = (got[a]! ^ exp[a]!) & (MASKED[addr] ?? 0xff);
      if (x && !ign(addr)) diff.push(addr);
    }
    const frameOk = g.frame === wf[i];
    if (diff.length || !frameOk) {
      waits.push({ wait: i, frame: wf[i] ?? -1, ...(frameOk ? {} : { portFrame: g.frame }), diff,
        values: diff.slice(0, 24).map((a) => [a, exp[a - 0x8000]!, got[a - 0x8000]!]) });
    }
  };
  g.start(opts.start ? opts.start(rig) : startFor(rig, t.meta.hook));
  g.frame = -1;
  g.buttons = btn(0);
  let lastGot: Uint8Array | null = t.prevScreen ?? null;
  try {
    g.runFrame(t.meta.start.ly);
    for (let f = 0; f < n; f++) {
      if (opts.maxWaits && nWaits >= opts.maxWaits) break;
      if (error && !opts.keepGoing) break;
      g.buttons = btn(f);
      rig.lcdOff = false;
      // the original's CPU was still busy in this frame (its code had not reached the wait yet)
      const busyFrame = g.waitingFor === BUSY;
      g.runFrame();
      const exp = t.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES);
      const got = rig.ppu.frame;
      const pixels = screenDiff(got, exp);
      if (pixels) {
        const olds = [lastGot, f > 0 ? t.screens.subarray((f - 1) * FRAME_BYTES, f * FRAME_BYTES) : null]
          .filter((x): x is Uint8Array => !!x);
        const oamOf = (k: number) => t.oam.subarray(k * 0xa0, (k + 1) * 0xa0);
        if (opts.tears !== false && busyFrame && mixTear(exp, got, olds)) tears++;
        else if (opts.tears !== false && (busyFrame || prevBusy) && f > 0 && t.oam.length >= f * 0xa0
          && !screenDiff(rig.redrawFrom(m.vram, undefined, oamOf(f - 1)), exp)) oamLate++;
        else diffs.push({ frame: f, pixels, got: got.slice() });
      }
      lastGot = got.slice();
      prevBusy = busyFrame;
    }
  } catch (e) {
    if (!opts.keepGoing) throw e;
    error = { message: String(e instanceof Error ? e.message : e), wait: nWaits };
  }
  return { trace: t, diffs, waits, nWaits, busy, tears, oamLate, error };
}

export function summarizeWaits(w: WaitDiff[]): string {
  return w.slice(0, 8).map((d) => `wait ${d.wait} (frame ${d.frame}${d.portFrame !== undefined ? `, port ${d.portFrame}` : ""}): ${d.values.slice(0, 12).map(([a, e, g]) => `${a.toString(16)}:${e.toString(16)}/${g.toString(16)}`).join(" ")}${d.diff.length > 12 ? ` +${d.diff.length - 12}` : ""}`).join("\n");
}

export function summarize(diffs: FrameDiff[]): string {
  return diffs.slice(0, 10).map((d) => `f${d.frame}: px ${d.pixels}`).join("\n");
}

// ---------------------------------------------------------------- comparison filters

/** Sound driver state and APU registers (the driver 0F:4006 is not ported yet): CB00-CBFE and
 *  FFBB-FFC4 (FFBC the sound effect request, cleared by the driver when it takes it; FFC2/FFC3
 *  the wave pointer of 0F:456B). CBFF (the sprite flip switch, 00:3E26) and FFBA (the music
 *  request written by game code) are compared. */
const SOUND = (a: number) => (a >= 0xcb00 && a < 0xcbff) || (a >= 0xffbb && a <= 0xffc4) || (a >= 0xff10 && a < 0xff40);
/** The SM83 stack (SP starts at CFFF). */
const STACK = (a: number) => a >= 0xcf00 && a < 0xd000;
/** Hardware timing registers and the joypad select register. */
const TIMING = (a: number) => a === 0xff00 || a === 0xff04 || a === 0xff0f || a === 0xff41 || a === 0xff44;
/** FFA1-FFA4: rst $18's own scratch (the caller's f, a, l, h; read only by 00:378A). */
const RST18 = (a: number) => a >= 0xffa1 && a <= 0xffa4;
export const IGNORE = (a: number) => SOUND(a) || STACK(a) || TIMING(a) || RST18(a);
/* The ROM bank stack's slots at and above its depth (C0A0 + C0B0 ..) are dead: the interrupt
 * handlers' pushes (00:1F3A every frame) write them at whatever depth the CPU's code was, which
 * depends on CPU time; the replay skips them (by the trace's depth). */
/** Bytes compared under a mask: CDCF holds STAT as read by 00:1D9E, whose mode and coincidence
 *  bits are the CPU's position in the frame (not modelled). */
export const MASKED: Record<number, number> = { 0xcdcf: 0xf8 };
