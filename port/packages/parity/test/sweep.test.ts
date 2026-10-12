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

/** Traces where the original itself goes off the rails; compared up to the given wait only.
 *  - Field sound test (op 0x47 from a script: story 11, reached from story 8 / field 34 / the
 *    kind-2 messages 5 and 206): 00:0FB1 loads only E = 0x45 for the menu message, D still holds
 *    the 0x9E left by 00:14CA's VRAM copy, so message 0x9E45 reads a garbage window header and the
 *    frame fill 00:0A2B runs 256-byte loops over WRAM, the stack included; the game resets
 *    through 00:0100. The port shows the menu (message 0x45), as the title's sound test does.
 *  - Alternate destinations 0x36, 0x79 and 0xFF of event 0E: their records (07:7F80 table) hold
 *    no valid map header (header pointers 0303 and C201, the latter in WRAM), so the original loads garbage (tileset
 *    0xC9, layout stream in RAM) and reads VRAM while the LCD is drawing.
 *  - Messages (2, 0x0E), (2, 0x28) and (3, 0x0D): the script pointer lands in bank-0 code (00:06B7,
 *    00:0602, 00:1F22),
 *    which the original interprets as a script; (2, 0x28) reaches `20 FB`, which re-dispatches
 *    through the control-code table out of range (entry CDC9, in WRAM), and (2, 0x0E) a far call
 *    that leaves bank 01 mapped; (3, 0x0D) diverges where a code byte reaches a 0F-bank print. */
const KNOWN: Record<string, { from: number; why: string }> = {
  sw_s0_008: { from: 223, why: "field sound test crash" },
  sw_s0_011: { from: 2, why: "field sound test crash" },
  sw_s1_034: { from: 223, why: "field sound test crash" },
  sw_s2_005: { from: 2, why: "field sound test crash" },
  sw_s2_206: { from: 2, why: "field sound test crash" },
  sw_s2_014: { from: 277, why: "script pointer in bank-0 code" },
  sw_s2_040: { from: 7, why: "script pointer in bank-0 code" },
  sw_s3_013: { from: 276, why: "script pointer in bank-0 code" },
  sw_e0e_054: { from: 21, why: "invalid alternate destination" },
  sw_e0e_121: { from: 21, why: "invalid alternate destination" },
  sw_e0e_255: { from: 21, why: "invalid alternate destination" },
};

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
    const { trace, diffs, waits, nWaits, error } = replayField(name, {
      ignore: IGNORE, keepGoing: true, rephase: JOYPAD,
      watch: (_i, f, exp, got) => { if (spriteLag(exp, got)) late.add(f + 1); },
    });
    const known = KNOWN[name];
    if (known) {
      // compared up to the point where the original goes wrong (the port may fail after it)
      expect(summarizeWaits(waits.filter((w) => w.wait < known.from).slice(0, 6))).toBe("");
      if (error) expect(error.wait, error.message).toBeGreaterThanOrEqual(known.from);
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
