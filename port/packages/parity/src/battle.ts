/** Battle trace replay: run a PyBoy battle trace (tools/trace_record.py, traces named bt_*)
 *  through the engine, with the frame model and comparisons of replay.ts (waits matched in
 *  order, busy frames, tick-phase tolerance, blink and joypad-repeat re-phasing, IGNORE filter),
 *  and report how far it matches: the first divergent wait, the first differing screen, and the
 *  first error (e.g. NotPorted for a routine of another module not installed yet).
 *
 *  Two start points:
 *   - "battle": the start snapshot is the entry of 0D:4000 (--hook 0D:4000, --mark 00:0EF4 = the
 *     return of the far call at 00:0EEE); the engine runs the battle main loop (r0D_4000) and,
 *     on its return, the far call's bank restore; the machine is then compared with the mark;
 *   - "field": the start snapshot is the field loop (00:1A43); the encounter goes through the
 *     field script, 00:0EC5, 00:191E (formation + transition) and the battle.
 *  The battle modules are installed by name when present (installBattle, installBattleDisplay,
 *  installBattleMenus), looked up in @ffl2k/core and then in their source files, so this works
 *  before and after integration. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { VSYNC, vsync, type Co, type Engine } from "@ffl2k/core";
import { dumpCoverage } from "./replay.js";
import { Rig, loadRom, loadTrace, buttonBits, screenDiff, FRAME_BYTES, TRACES, ROOT, IGNORE, tickInFrame, type Trace, type WaitDiff, type FrameDiff } from "./index.js";
import { readFileSync } from "node:fs";

export type Installer = (e: Engine) => unknown;

/** Installer names and where to look for them (after @ffl2k/core's exports). */
const MODULES: [string, string[]][] = [
  ["installBattle", ["battle/main.ts", "battle/index.ts"]],
  ["installBattleDisplay", ["battle/index.ts", "battle/display.ts"]],
  ["installBattleMenus", ["menu/battle.ts", "menu/index.ts"]],
];

export interface BattleModules {
  installers: Map<string, Installer>;
  /** The battle main module (r0D_4000 …). */
  main: { r0D_4000: (e: Engine) => Co } | null;
  missing: string[];
}

function find(mod: Record<string, unknown>, name: string): Installer | undefined {
  if (typeof mod[name] === "function") return mod[name] as Installer;
  for (const v of Object.values(mod)) {
    if (v && typeof v === "object" && typeof (v as Record<string, unknown>)[name] === "function") return (v as Record<string, Installer>)[name];
  }
  return undefined;
}

/** Load the battle modules that exist (dynamic imports; missing ones are listed). */
export async function loadBattleModules(): Promise<BattleModules> {
  const core = (await import("@ffl2k/core")) as unknown as Record<string, unknown>;
  const src = resolve(ROOT, "port/packages/core/src");
  const load = async (rel: string): Promise<Record<string, unknown> | null> => {
    const p = resolve(src, rel);
    if (!existsSync(p)) return null;
    try {
      return (await import(/* @vite-ignore */ pathToFileURL(p).href)) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const installers = new Map<string, Installer>(), missing: string[] = [];
  for (const [name, files] of MODULES) {
    let fn = find(core, name);
    for (const f of files) {
      if (fn) break;
      const mod = await load(f);
      if (mod) fn = find(mod, name);
    }
    if (fn) installers.set(name, fn);
    else missing.push(name);
  }
  let main = find(core, "r0D_4000") ? (core as unknown as BattleModules["main"]) : null;
  if (!main) {
    const mod = await load("battle/main.ts");
    if (mod && typeof mod.r0D_4000 === "function") main = mod as unknown as BattleModules["main"];
  }
  return { installers, main, missing };
}

export interface BattleReplayOptions {
  from: "battle" | "field";
  /** Addresses excluded from memory comparison (default: BATTLE_IGNORE). */
  ignore?: (addr: number) => boolean;
  /** Without the battle display module, stand in for 0F:6080 with its first instruction (rst
   *  $10) and stop there: the state at that wait is produced by the battle main loop alone
   *  (default true). */
  probeDisplay?: boolean;
  /** Stop at the first divergent wait (default false: keep going to the end or an error). */
  stopAtDivergence?: boolean;
  watch?: (wait: number, frame: number, exp: Uint8Array, got: Uint8Array) => void;
  /** CPU-time pauses: between two waits the original may spend frames in code without changing
   *  the picture (e.g. a long calc-VM computation before a polled raster effect), where the port
   *  spends none. With this option a frame whose screen differs is matched against a later
   *  trace frame of the same stretch when every trace frame skipped repeats the picture shown
   *  before (a pause); the delay holds until the next wait, where the machine is compared
   *  exactly again. Only the original may pause, and only on an unchanged picture. */
  pauses?: boolean;
  /** Called for every compared frame with the port's and the trace's screen (debugging). */
  onScreen?: (frame: number, got: Uint8Array, exp: Uint8Array) => void;
}

export interface BattleReplay {
  trace: Trace;
  installed: string[];
  missing: string[];
  /** Waits run by the engine / recorded in the trace (up to the battle's return for "battle"). */
  nWaits: number;
  expectedWaits: number;
  /** Waits that matched before the first divergence. */
  matchedWaits: number;
  waits: WaitDiff[];
  diffs: FrameDiff[];
  frames: number;
  /** The engine stopped with this error (NotPorted, probe stop, or a real failure). */
  error?: string;
  /** "battle": the battle main loop returned; `end` = differences from the return mark. */
  returned: boolean;
  end: [number, number, number][];
  tickPhase: number;
  rephased: number;
  rephasedJoy: number;
  /** Trace frames skipped as CPU-time pauses of the original (option `pauses`). */
  paused: number;
}

/** Blink timer and joypad repeat re-phasing, as in replay.ts / menuharness.ts. */
const BLINK = new Set([0xc7c6, 0xc7c7, 0xd6c1, 0xd6c2]);
const JOY = new Set([0xc774, 0xc775]);
/** Joypad history C770-C773 and FF89/FF8A with the repeat state and the blink timer: when a
 *  long code segment (victory: write-back, growth) ends near a frame boundary, the original's
 *  frame tick may sample the buttons once more or less before its next wait depending on CPU
 *  time (as in sweep.test.ts JOYPAD). Re-phased when they are the only difference at a wait. */
const JOYPAD = new Set([0xc770, 0xc771, 0xc772, 0xc773, 0xff89, 0xff8a, 0xc774, 0xc775]);

/** C0E1/C0E2: 00:033F (16-bit division, used by the calc VM) saves the SM83 stack pointer there
 *  (restored through the RAM stub C0E0 `ld sp,nnnn`); like the call stack (replay.ts STACK) it
 *  holds a machine stack address the port does not have. */
const SP_SAVE = (a: number) => a === 0xc0e1 || a === 0xc0e2;
/** Default comparison filter for battle traces: replay.ts IGNORE plus SP_SAVE. */
export const BATTLE_IGNORE = (a: number) => IGNORE(a) || SP_SAVE(a);

export class ProbeStop extends Error {}

const compare = (exp: Uint8Array, got: Uint8Array, ign: (a: number) => boolean): number[] => {
  const diff: number[] = [];
  for (let a = 0; a < 0x8000; a++) {
    const addr = 0x8000 + a;
    if (addr >= 0xa000 && addr < 0xc000) continue;
    if (addr >= 0xe000 && addr < 0xfe00) continue;
    if (addr >= 0xfea0 && addr < 0xff00) continue;
    if (got[a] !== exp[a] && !ign(addr)) diff.push(addr);
  }
  return diff;
};

/** Replay battle trace `name` with the given modules. */
export function replayBattle(name: string, mods: BattleModules, opts: BattleReplayOptions): BattleReplay {
  const t = loadTrace(name);
  const d = resolve(TRACES, name);
  const marks = existsSync(resolve(d, "marks.json")) ? JSON.parse(readFileSync(resolve(d, "marks.json"), "utf8")).marks as { frame: number; waits: number }[] : [];
  const markMem = marks.length ? new Uint8Array(readFileSync(resolve(d, "marks.bin"))) : null;
  const rig = new Rig(loadRom());
  const m = rig.g.m, e = rig.engine;
  m.loadFull(t.start);
  const installed: string[] = [];
  for (const [k, fn] of mods.installers) {
    fn(e);
    installed.push(k);
  }
  if (opts.probeDisplay !== false && !e.extra.has(0xf6080)) {
    e.extra.set(0xf6080, function* (e) {
      yield* vsync(e.g); // 0F:6098 rst $10
      throw new ProbeStop("probe: stopped at the first wait of 0F:6080 (battle display not installed)");
    });
  }
  let endSnap: Uint8Array | null = null;
  const battle = opts.from === "battle";
  const mark = battle ? marks[0] : undefined;
  if (battle) {
    if (!mods.main) throw new Error("battle main module (r0D_4000) not found");
    const main = mods.main;
    rig.g.start((function* () {
      yield* main.r0D_4000(e);
      if (markMem) m.selectBank(markMem[0x7f88]!); // the far call restores the caller's bank
      endSnap = m.snapshotFull();
    })());
  } else rig.g.start(e.field.loop());
  const n = t.meta.frames.length;
  const wf = mark ? (t.waitFrames ?? []).slice(0, mark.waits) : (t.waitFrames ?? []);
  const lastFrame = mark ? mark.frame : n;
  const ign = opts.ignore ?? BATTLE_IGNORE;
  const diffs: FrameDiff[] = [], waits: WaitDiff[] = [];
  let nWaits = 0, f = -1, tickPhase = 0, frames = 0, rephased = 0, rephasedJoy = 0, lastRephase = -2, matched = -1;
  let pre: Uint8Array | null = null, error: string | undefined;
  let delay = 0, delayWait = -1, paused = 0;
  const scr = (k: number) => t.screens.subarray(k * FRAME_BYTES, (k + 1) * FRAME_BYTES);
  const btn = (k: number) => buttonBits(t.meta.frames[Math.min(Math.max(k, 0), n - 1)]!.btn);
  // Busy frames (frames the original spent without waiting) are run after the code segment, with
  // their own trace frames' buttons; the frame of the wait itself then gets its buttons back
  // (onFrameDone after the last busy frame's lines).
  let restore = false;
  rig.g.onFrameDone = () => {
    if (restore) { rig.g.buttons = btn(f); restore = false; }
  };
  rig.g.onWait = (kind) => {
    const prev = f;
    f = kind === VSYNC && nWaits < wf.length ? wf[nWaits]! : f + 1;
    if (f - prev > 1 && prev >= 0) {
      const busy = f - prev - 1;
      rig.g.busyFrames = busy;
      rig.g.onBusyFrame = (k) => { rig.g.buttons = btn(prev + 1 + k); restore = k === busy - 1; return tickInFrame(t, prev + 1 + k); };
    }
    rig.g.buttons = btn(f);
    pre = kind === VSYNC ? m.snapshotFull() : null;
  };
  rig.g.onYield = (kind) => {
    if (kind !== VSYNC) return;
    const i = nWaits++;
    if (!t.waits || i >= wf.length) {
      waits.push({ wait: i, frame: -1, diff: [-1], values: [] });
      if (matched < 0) matched = i;
      return;
    }
    const exp = t.waits.subarray(i * 0x8000, (i + 1) * 0x8000);
    const got = m.snapshotFull();
    opts.watch?.(i, wf[i]!, exp, got);
    let diff = compare(exp, got, ign);
    if (diff.length && pre && !compare(exp, pre, ign).length) { tickPhase++; diff = []; }
    const isOam = (a: number) => a >= 0xfe00 && a < 0xfea0;
    if (diff.length && diff.every((a) => BLINK.has(a) || isOam(a)) && (diff.some((a) => BLINK.has(a)) || lastRephase === i - 1)) {
      for (const a of diff) if (BLINK.has(a)) m.wr(a, exp[a - 0x8000]!);
      rephased++;
      lastRephase = i;
      diff = [];
    }
    if (diff.length && diff.every((a) => JOYPAD.has(a) || BLINK.has(a)) && diff.some((a) => JOYPAD.has(a))) {
      for (const a of diff) m.wr(a, exp[a - 0x8000]!);
      rephasedJoy++;
      diff = [];
    }
    if (diff.length) {
      waits.push({ wait: i, frame: wf[i]!, diff, values: diff.slice(0, 24).map((a) => [a, exp[a - 0x8000]!, got[a - 0x8000]!, pre ? pre[a - 0x8000]! : -1]) });
      if (matched < 0) matched = i;
    }
  };
  while (!rig.g.done && f < n - 1) {
    try {
      rig.g.runFrame();
    } catch (x) {
      error = x instanceof Error ? `${x.constructor.name}: ${x.message}` : String(x);
      break;
    }
    if (opts.stopAtDivergence && waits.length) break;
    // A trace that ends before the battle returns (no mark) is compared up to its last wait: the
    // original's next wait lies beyond the recording, so frames after it are not placed.
    if (!mark && wf.length && nWaits >= wf.length) break;
    if (rig.g.done || f < 0 || f >= n || f >= lastFrame) continue;
    if (nWaits < wf.length && wf[nWaits] === f) continue;
    frames++;
    if (delayWait !== nWaits) { delay = 0; delayWait = nWaits; }
    const next = nWaits < wf.length ? wf[nWaits]! : lastFrame;
    if (delay && f + delay >= next) continue; // beyond the stretch: not placed
    let expScreen = scr(f + delay);
    let pixels = screenDiff(rig.ppu.frame, expScreen);
    if (pixels && opts.pauses && f + delay > 0) {
      const shown = scr(f + delay - 1);
      for (let d = delay + 1; f + d < next; d++) {
        if (screenDiff(scr(f + d - 1), shown)) break; // the skipped frame changed the picture
        if (!screenDiff(rig.ppu.frame, scr(f + d))) { paused += d - delay; delay = d; expScreen = scr(f + d); pixels = 0; break; }
      }
    }
    opts.onScreen?.(f, rig.ppu.frame, expScreen);
    if (pixels) diffs.push({ frame: f, pixels, wram: [], vram: [], oam: [], hram: [] });
  }
  const end: [number, number, number][] = [];
  if (endSnap && markMem) {
    const got = endSnap as Uint8Array;
    for (const a of compare(markMem.subarray(0, 0x8000), got, ign)) end.push([a, markMem[a - 0x8000]!, got[a - 0x8000]!]);
  }
  dumpCoverage(name, rig);
  return {
    trace: t, installed, missing: mods.missing, nWaits, expectedWaits: wf.length, matchedWaits: matched < 0 ? nWaits : matched,
    waits, diffs, frames, error, returned: endSnap !== null, end, tickPhase, rephased, rephasedJoy, paused,
  };
}

/** One-paragraph progress report. */
export function battleReport(r: BattleReplay): string {
  const w = r.waits[0];
  const hx = (a: number) => a.toString(16);
  return [
    `${r.trace.name}: installed [${r.installed.join(", ")}]${r.missing.length ? `, missing [${r.missing.join(", ")}]` : ""}`,
    `waits: engine ${r.nWaits}, trace ${r.expectedWaits}, matched before the first divergence ${r.matchedWaits}` +
      ` (tick phase ${r.tickPhase}, blink ${r.rephased}, joypad ${r.rephasedJoy}${r.paused ? `, paused ${r.paused}` : ""})`,
    r.waits.length ? `divergent waits (${r.waits.length}): ${r.waits.slice(0, 12).map((x) => `${x.wait}@${x.frame}[${x.diff.slice(0, 6).map(hx).join(",")}${x.diff.length > 6 ? ",…" : ""}]`).join(" ")}` : "all waits match",
    w ? `first divergent wait ${w.wait} (trace frame ${w.frame}): ${w.values.slice(0, 12).map(([a, e, g]) => `${hx(a)}:${hx(e)}/${hx(g)}`).join(" ")}${w.diff.length > 12 ? ` +${w.diff.length - 12}` : ""}` : "no divergent wait",
    r.diffs.length ? `first screen difference: frame ${r.diffs[0]!.frame} (${r.diffs[0]!.pixels} px); ${r.diffs.length} frames differ of ${r.frames}` : `screens: ${r.frames} frames identical`,
    r.error ? `stopped: ${r.error}` : r.returned ? `returned from 0D:4000; differences at the return: ${r.end.length}` : "trace ended",
  ].join("\n");
}
