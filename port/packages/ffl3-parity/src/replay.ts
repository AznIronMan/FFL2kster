/** Replay a Legend III PyBoy trace through the engine and compare every frame wait and screen.
 *  Synchronised on the original's frame waits (00:3A6D-3A77): the i-th wait of the engine is
 *  matched with the i-th one recorded. The port's code runs in no time between waits; the frames
 *  the original's CPU was still busy before a wait (VRAM copies paced by hblank, decompression)
 *  are taken from the trace and spent before the wait starts (`Game.onWaitStart`), with the
 *  interrupts running as in the original. The vblank polls of the VRAM bracket are aligned the
 *  same way (`Game.onSync`, the trace's 00:1E35 frames), and so are the bracket's entries
 *  (`Game.onPollStart`, the frame and line of the original's 00:1D9E / 00:1DFD, whose di holds
 *  the interrupts of the poll back until its reti), so the interrupts' work in a busy stretch
 *  sees the code's state of that stretch. */
import { BUSY, LINE, type Co } from "@ffl3k/core";
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
  setup?: (rig: Rig) => void;
  ignore?: (addr: number) => boolean;
  keepGoing?: boolean;
  maxWaits?: number;
  /** Accept frames drawn while the original was still writing (tears; default true). */
  tears?: boolean;
  watch?: (wait: number, frame: number, exp: Uint8Array, got: Uint8Array) => void;
  /** Debugging: called when the port reaches vblank poll i (with the trace's frame). */
  onSync?: (i: number, frame: number, portFrame: number) => void;
  /** Debugging: called when the port starts frame wait i (with the trace's frame). */
  onWaitStart?: (i: number, frame: number, portFrame: number) => void;
}

export interface ReplayResult {
  trace: Trace; diffs: FrameDiff[]; waits: WaitDiff[]; nWaits: number; busy: number; tears: number;
  /** Waits whose only differences were in the OAM buffer / OAM and that a later wait shows equal
   *  again (the interrupts' sprite work saw the original's code half way, e.g. a copy of the
   *  party records interrupted by the STAT handler: CPU time). */
  oamTransient: number;
  /** Those waits (for inspection). */
  transient: WaitDiff[];
  /** Vblank polls the port reached after the original's frame (should be 0), and their count. */
  lateSyncs: number; nSyncs: number;
  /** Frames drawn while the original's code was still writing VRAM line by line (CPU time; the
   *  port writes at once): its main code before the frame wait or bracket entry it reached in that
   *  frame, or the interrupt-time frame work 00:3557 (hblank-paced copies, e.g. the map animation
   *  01:54A0). Every differing pixel is on such a line and shows an old picture. */
  lineTears: number;
  /** Of these, frames with a line drawn between two chunks of a copy (see `lineTear`). */
  chunkTears: number;
  /** Runs of the frame work whose start frame differs from the original's (should be 0). */
  workMismatch: number; nWorks: number;
  /** Bracket entries (00:1D9E / 00:1DFD) the port reached after the original's frame and line
   *  (should be 0), and their count. */
  latePolls: number; nPolls: number;
  /** Sync points (see `Game.onPoint`) the port reached after the original (should be 0). */
  latePoints: number; nPoints: number;
  /** Random numbers drawn (00:39D5) by the port. */
  nRand: number;
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

/** A frame drawn while the original's code wrote VRAM over the lines `spans` (CPU time):
 *  every differing pixel lies on one of those lines and shows an old picture — except, with
 *  `partial`, on at most two lines (16 pixels): the lines drawn between two chunks of one
 *  hblank-paced copy (00:20FF writes 5 bytes an hblank, so a tile row can be half written, its
 *  planes from two states). Returns "full", "partial" or false. */
export function lineTear(exp: Uint8Array, got: Uint8Array, olds: Uint8Array[], spans: [number, number][],
  partial = true): "full" | "partial" | false {
  if (!spans.length) return false;
  const odd = new Set<number>();
  let nOdd = 0;
  for (let i = 0; i < exp.length; i++) {
    const v = exp[i];
    if (v === got[i]) continue;
    const y = Math.floor(i / 160);
    if (!spans.some(([a, b]) => y >= a && y <= b)) return false;
    if (olds.some((o) => o[i] === v)) continue;
    if (!partial) return false;
    odd.add(y);
    if (++nOdd > 16 || odd.size > 2) return false;
  }
  return nOdd ? "partial" : "full";
}

export function replay(name: string, opts: ReplayOptions = {}): ReplayResult {
  const t = loadTrace(name);
  const rig = new Rig(loadRom());
  const g = rig.g, m = g.m;
  m.loadFull(t.start);
  g.ime = true;
  opts.setup?.(rig);
  const wf = t.waitFrames, n = t.meta.frames.length;
  const ign = opts.ignore ?? IGNORE;
  const waits: WaitDiff[] = [], diffs: FrameDiff[] = [];
  let nWaits = 0, busy = 0, tears = 0, oamLate = 0, prevBusy = false, oamTransient = 0;
  const transient: WaitDiff[] = [];
  const isOam = (a: number) => (a >= 0xc000 && a < 0xc0a0) || (a >= 0xfe00 && a < 0xfea0);
  let oamPending: WaitDiff[] = [];
  let error: { message: string; wait: number } | undefined;
  const btn = (k: number) => buttonBits(t.meta.frames[Math.min(Math.max(k, 0), n - 1)]!.btn);
  g.onWaitStart = (k) => {
    const f = wf[nWaits];
    opts.onWaitStart?.(nWaits, f ?? -1, g.frame);
    if (f === undefined) return 0;
    const b = f - (g.nextVblankFrame() + k - 1);
    if (b < 0) {
      error ??= { message: `wait ${nWaits}: the port reaches it ${-b} frame(s) after the original`, wait: nWaits };
      return 0;
    }
    busy += b;
    return b;
  };
  // the port's vblank polls wait for the frame of the original's (CPU time before them)
  let nSyncs = 0, lateSyncs = 0;
  g.onSync = () => {
    const f = t.syncs[nSyncs++];
    if (f !== undefined && f < g.frame) lateSyncs++;
    opts.onSync?.(nSyncs - 1, f ?? -2, g.frame);
    return f;
  };
  // ... and enter / leave the bracket (di) at the original's frame and line
  let nPolls = 0, latePolls = 0;
  g.onPollStart = () => {
    const p = t.polls[nPolls++];
    if (!p) return undefined;
    if (p[0] < g.frame || (p[0] === g.frame && p[1] < g.ly)) latePolls++;
    return p;
  };
  // ... and reach the sync-point routines at the original's frame and line
  let nPoints = 0, latePoints = 0;
  const pointAt = new Map<number, number>();
  g.onPoint = (addr) => {
    const k = pointAt.get(addr) ?? 0;
    pointAt.set(addr, k + 1);
    const p = t.points[addr]?.[k];
    nPoints++;
    if (!p) return undefined;
    if (p[0] < g.frame || (p[0] === g.frame && p[1] < g.ly)) latePoints++;
    return p;
  };
  // the random generator reads the frame counter the original had at that call
  let nRand = 0;
  m.onRandom = () => t.rand[nRand++]?.[2];
  // the frame work's runs end when the original's did (hblank-paced copies)
  let nWorks = 0, workMismatch = 0, lineTears = 0, chunkTears = 0;
  /** Where the port ran each work (in no time: its VRAM writes are all on that line). */
  const portWork: [number, number][] = [];
  g.onWork = () => {
    portWork.push([g.frame, g.ly]);
    const w = t.works[nWorks++];
    g.debug?.(`work ${nWorks - 1}: trace ${w?.join(",") ?? "-"} port f${g.frame} ly${g.ly}`);
    if (!w) return undefined;
    // the original's handler may start the work later (CPU time: a long sound tick from a STAT
    // taken in vblank), but not before the port's
    if (!(w[0] === g.frame || (w[0] === g.frame + 1 && g.ly >= 144))) workMismatch++;
    return [w[2], w[3]];
  };
  /** The visible lines of frame f over which the original's frame work wrote and the port's did
   *  not yet (from the port's line, or the original's start if earlier, to the original's end). */
  const workLines = (f: number): [number, number][] => t.works.flatMap((w, i) => {
    const p = portWork[i];
    const [f0, l0] = p && (p[0] < w[0] || (p[0] === w[0] && p[1] < w[1])) ? p : [w[0], w[1]];
    if (!((f0 < f || (f0 === f && l0 < 144)) && w[2] >= f)) return [];
    return [[f0 < f ? 0 : l0, w[2] > f ? 143 : Math.min(w[3], 143)] as [number, number]];
  });
  /** The port's frame drawn with the original's palettes of the frame before (a palette the
   *  original's code wrote later in the frame than the port). */
  const oldPalette = (f: number): Uint8Array[] => {
    const lcd = (t.meta.frames[f - 1] as { lcd?: number[] } | undefined)?.lcd;
    return lcd ? [rig.redrawPalettes([lcd[5]!, lcd[6]!, lcd[7]!])] : [];
  };
  /** The visible lines of frame f the original's main code ran: up to the last frame wait or
   *  bracket entry it reached in that frame. */
  const mainLines = (f: number): [number, number][] => {
    let l = -1;
    for (const [pf, pl] of [...t.starts, ...t.polls]) if (pf === f && pl < 144) l = Math.max(l, pl);
    return l < 0 ? [] : [[0, l]];
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
    const oamOnly = frameOk && diff.length > 0 && diff.every(isOam);
    if (!oamOnly && !diff.some(isOam)) { oamTransient += oamPending.length; transient.push(...oamPending); oamPending = []; }
    if (oamOnly) {
      oamPending.push({ wait: i, frame: wf[i] ?? -1, diff, values: diff.slice(0, 24).map((a) => [a, exp[a - 0x8000]!, got[a - 0x8000]!]) });
      return;
    }
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
      // (or before a bracket entry / sync point it reaches later)
      const busyFrame = g.waitingFor === BUSY || g.waitingFor === LINE;
      g.runFrame();
      const exp = t.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES);
      const got = rig.ppu.frame;
      const pixels = screenDiff(got, exp);
      if (pixels) {
        const olds = [lastGot, f > 0 ? t.screens.subarray((f - 1) * FRAME_BYTES, f * FRAME_BYTES) : null]
          .filter((x): x is Uint8Array => !!x);
        const oamOf = (k: number) => t.oam.subarray(k * 0xa0, (k + 1) * 0xa0);
        let lt: ReturnType<typeof lineTear> = false;
        // in a busy frame, also the port's objects and registers over the VRAM of the last wait
        // (the original had not written its new tiles yet)
        const lastVram = (): Uint8Array[] => nWaits > 0 ? [rig.redrawFrom(t.waits.subarray((nWaits - 1) * 0x8000, (nWaits - 1) * 0x8000 + 0x2000))] : [];
        if (opts.tears !== false && busyFrame && (mixTear(exp, got, olds) || mixTear(exp, got, [...olds, ...lastVram()]))) tears++;
        else if (opts.tears !== false && (lt = lineTear(exp, got, [...olds, ...oldPalette(f)], [...workLines(f), ...mainLines(f)]))) {
          lineTears++;
          if (lt === "partial") chunkTears++;
        }
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
  waits.push(...oamPending);
  waits.sort((a, b) => a.wait - b.wait);
  return { trace: t, diffs, waits, nWaits, busy, tears, oamLate, oamTransient, transient, lateSyncs, nSyncs, latePolls, nPolls, latePoints, nPoints, nRand, lineTears, chunkTears, workMismatch, nWorks, error };
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
