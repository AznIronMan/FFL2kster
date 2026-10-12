/** Field trace parity: the engine resumed at the field main loop (00:1A43) from a PyBoy
 *  snapshot, fed the same buttons, must produce the same screens, and the same machine state at
 *  every frame wait (rst $10), as the original. Sound driver state is not ported yet. */
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace, replayField, summarizeWaits, IGNORE } from "../src/index.js";

const CASES: [string, string][] = [
  ["walk1", "walking in four directions in the first town, NPCs wandering"],
  ["door1", "entering a building (fade out/in, map load) and leaving again"],
  ["talk1", "talking to an NPC: script, message window, text printing, button waits"],
];

for (const [name, what] of CASES) {
  describe.skipIf(!haveRom() || !haveTrace(name))(`field trace ${name}`, () => {
    it(`${what}: same screens and wait-point state`, () => {
      const { trace, diffs, waits, nWaits } = replayField(name, { ignore: IGNORE });
      expect(trace.meta.frames.length).toBeGreaterThan(100);
      expect(diffs.filter((d) => d.pixels).map((d) => `${d.frame}:${d.pixels}`)).toEqual([]);
      expect(nWaits).toBe(trace.waitFrames!.length);
      expect(summarizeWaits(waits)).toBe("");
    });
  });
}
