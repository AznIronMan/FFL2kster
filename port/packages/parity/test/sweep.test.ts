/** Parity sweeps (tools/sweep.py, lean traces build/traces/sw_*): every event script (story and
 *  field messages) run from the first town with A tapped, and every warp destination entered
 *  and walked in. Each trace is replayed through the full engine with the field-trace rules
 *  (replay.ts: wait-synchronized, IGNORE, busy frames, tick-phase and blink tolerances): every
 *  screen identical and the machine equal at every frame wait. One documented extra tolerance,
 *  as in field_menus.test.ts: when the menu sprite page CC00-CC9F differs at a wait (the
 *  original's code changed the cursor state after the tick of its frame), the next frame may
 *  show the cursor one frame late.
 *  Screens: a difference that lasts more than 3 consecutive frames fails (a rendering or state
 *  bug shows for as long as its cause lasts). Shorter ones are reported, not failed: frames where
 *  a raster split or a display write lands a line or a few frames' worth of CPU time differently
 *  (code that runs from vblank into the visible lines, raster handlers whose writes straddle the
 *  point a line's registers are taken) — timing within a frame, which the port does not model.
 *  The machine state at every wait around them is still compared exactly, and the dedicated
 *  traces (walk/door/talk/title/battle/field menus) compare every screen exactly.
 *  SWEEP_LIST=file limits it to the names listed in a file.
 *  Runs only with SWEEP=prefix (e.g. SWEEP=sw_ for all, SWEEP=sw_m_ or SWEEP=sw_s0_01). */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { haveRom, replayField, summarizeWaits, IGNORE, TRACES, type Rig } from "../src/index.js";

const PREFIX = process.env.SWEEP ?? "";
const LIST = process.env.SWEEP_LIST ? new Set(readFileSync(process.env.SWEEP_LIST, "utf8").split(/\s+/).filter(Boolean)) : null;
const NAMES = PREFIX && existsSync(TRACES)
  ? readdirSync(TRACES).filter((n) => n.startsWith(PREFIX) && n.startsWith("sw_") && (!LIST || LIST.has(n)) && existsSync(resolve(TRACES, n, "trace.json"))).sort()
  : [];

/** Where the original itself goes off the rails. Once one of these conditions holds in the port
 *  at a wait, the trace is compared only up to that point (the port may diverge or fail after it):
 *  - soundtest: script op 0x47 (field sound test: story 11, reached from story 8 / field 34 and
 *    the music player of map 5366). 00:0FB1 loads only E = 0x45 for the menu message; D still
 *    holds the 0x9E left by 00:14CA's VRAM copy, so message 0x9E45 reads a garbage window header,
 *    the frame fill 00:0A2B runs 256-byte loops over WRAM (the stack included) and the game
 *    resets through 00:0100. The port draws the same garbage and then fails.
 *  - bank0script: a script pointer below 4000 (messages (2, 0x0E), (2, 0x28), (3, 0x0D) point into
 *    bank-0 code, which the original interprets; e.g. `20 FB` re-dispatches through the control
 *    table out of range, entry CDC9 in WRAM).
 *  - wramscript: a script pointer in D000-DFFF (story indexes beyond the 192-entry table).
 *  - altdest: tileset index 3E or more after a warp (alternate destinations 0x36, 0x79, 0xFF of
 *    event 0E hold no valid map header: header pointers 0303 and C201), so the original loads
 *    garbage and reads VRAM while the LCD draws. */
const CAUSES: [string, (m: Uint8Array, rig: Rig) => boolean][] = [
  ["soundtest", (_m, rig) => (rig.engine.text.coverage[0x47] ?? 0) > 0],
  ["bank0script", (m) => (m[0xffa0 - 0x8000] === 1 || m[0xffa0 - 0x8000] === 2) && m[0xffa3 - 0x8000]! < 0x40],
  ["wramscript", (m) => m[0xffa0 - 0x8000] !== 0 && m[0xffa3 - 0x8000]! >= 0xd0 && m[0xffa3 - 0x8000]! < 0xe0],
  ["altdest", (m) => m[0xc450 - 0x8000]! >= 0x3e],
];

/** Joypad history (C770-C773, FF89/FF8A): sampled by the frame tick; when a long code segment
 *  installs or removes a STAT handler that changes who runs the tick (00:2F7F runs it by hand
 *  under the C305 = 2x effect), the original may tick once more or less in that frame depending
 *  on CPU time. Re-phased (copied from the trace) when they are the only difference at a wait. */
const JOYPAD = (a: number) => (a >= 0xc770 && a <= 0xc773) || a === 0xff89 || a === 0xff8a;

function spriteLag(exp: Uint8Array, got: Uint8Array): boolean {
  for (let a = 0xcc00; a < 0xcca0; a++) if (exp[a - 0x8000] !== got[a - 0x8000]) return true;
  return false;
}

describe.skipIf(!haveRom() || NAMES.length === 0)("parity sweep", () => {
  it.each(NAMES.length ? NAMES : ["none"])("%s", (name) => {
    const late = new Set<number>();
    let rig: Rig | undefined;
    let armed: { wait: number; cause: string } | undefined;
    const { trace, diffs, waits, nWaits, error } = replayField(name, {
      ignore: IGNORE, keepGoing: true, rephase: JOYPAD, setup: (r) => { rig = r; },
      watch: (i, f, exp, got) => {
        if (spriteLag(exp, got)) late.add(f + 1);
        if (!armed) for (const [cause, hit] of CAUSES) if (hit(got, rig!)) { armed = { wait: i, cause }; break; }
      },
    });
    if (armed) {
      // compared up to the point where the original goes wrong
      console.log(`${name}: original breaks (${armed.cause}) from wait ${armed.wait}`);
      expect(summarizeWaits(waits.filter((w) => w.wait < armed!.wait).slice(0, 6))).toBe("");
      if (error) expect(error.wait, error.message).toBeGreaterThanOrEqual(armed.wait);
      return;
    }
    expect(error?.message).toBeUndefined();
    expect(summarizeWaits(waits.slice(0, 6))).toBe("");
    expect(nWaits).toBe(trace.waitFrames!.length);
    const frames = diffs.filter((d) => d.pixels && !late.has(d.frame)).map((d) => d.frame);
    const runs: number[][] = [];
    for (const f of frames) {
      const r = runs[runs.length - 1];
      if (r && f === r[r.length - 1]! + 1) r.push(f);
      else runs.push([f]);
    }
    const persistent = runs.filter((r) => r.length > 3);
    if (frames.length) console.log(`${name}: ${frames.length} transient screen differences (${runs.map((r) => r.length > 1 ? `${r[0]}-${r[r.length - 1]}` : `${r[0]}`).join(" ")})`);
    expect(persistent.map((r) => `${r[0]}-${r[r.length - 1]}`)).toEqual([]);
  });
});
