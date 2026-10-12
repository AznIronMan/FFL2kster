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
 *  Runs only with SWEEP=prefix (e.g. SWEEP=sw_ for all, SWEEP=sw_m_ or SWEEP=sw_s0_01). */
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { haveRom, replayField, summarizeWaits, IGNORE, TRACES } from "../src/index.js";

const PREFIX = process.env.SWEEP ?? "";
const NAMES = PREFIX && existsSync(TRACES) ? readdirSync(TRACES).filter((n) => n.startsWith(PREFIX) && n.startsWith("sw_")).sort() : [];

function spriteLag(exp: Uint8Array, got: Uint8Array): boolean {
  for (let a = 0xcc00; a < 0xcca0; a++) if (exp[a - 0x8000] !== got[a - 0x8000]) return true;
  return false;
}

describe.skipIf(!haveRom() || NAMES.length === 0)("parity sweep", () => {
  it.each(NAMES.length ? NAMES : ["none"])("%s", (name) => {
    const late = new Set<number>();
    const { trace, diffs, waits, nWaits } = replayField(name, {
      ignore: IGNORE,
      watch: (_i, f, exp, got) => { if (spriteLag(exp, got)) late.add(f + 1); },
    });
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
