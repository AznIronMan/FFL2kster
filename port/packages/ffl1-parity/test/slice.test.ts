/** Legend I scenario parity: PyBoy traces (tools/ffl1/trace_lib.py, generated locally from the
 *  player's ROM, never committed) replayed through @ffl1k/core; every frame wait's machine state
 *  (VRAM, WRAM, OAM, HRAM; sound/stack/timing excluded, see IGNORE) and every screen must match.
 *  Skipped without the ROM or the trace. */
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace, replay, summarize, summarizeWaits } from "../src/index.js";

const TRACES: [string, string][] = [
  ["title1", "boot to the title screen, idle"],
  ["probe1", "title, prologue (A held), class select, name entry"],
  ["newgame1", "new game: prologue, class, name, the first town; objects walk"],
];

describe.skipIf(!haveRom())("FFL1 scenario parity", () => {
  for (const [name, what] of TRACES) {
    it.skipIf(!haveTrace(name))(`${name}: ${what}`, () => {
      const r = replay(name, { keepGoing: true });
      const info = `waits ${r.nWaits}/${r.trace.waitFrames.length} busy ${r.busy} tickPhase ${r.tickPhase} late ${r.lateWrites}`;
      if (r.error || r.waits.length || r.diffs.length) console.log(`${name}: ${info} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}\n${summarize(r.diffs)}`);
      expect(r.error).toBeUndefined();
      expect(r.nWaits).toBe(r.trace.waitFrames.length);
      expect(r.waits).toEqual([]);
      expect(r.diffs).toEqual([]);
    });
  }
});
