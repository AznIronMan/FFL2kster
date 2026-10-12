/** Field trace parity: the engine resumed at the field main loop (00:1A43) from a PyBoy
 *  snapshot, fed the same buttons, must produce the same screens, and the same machine state at
 *  every frame wait (rst $10), as the original. Sound driver state is not ported yet. */
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace, replayField, summarizeWaits, IGNORE } from "../src/index.js";

/** Known screen differences: frames where only the sprite blink phase differs (see BLINK in
 *  replay.ts). Any other difference fails. */
const KNOWN: Record<string, number[]> = { title1: [441, 456, 473] };

const CASES: [string, string, ("field" | "title")?][] = [
  ["walk1", "walking in four directions in the first town, NPCs wandering"],
  ["door1", "entering a building (fade out/in, map load) and leaving again"],
  ["talk1", "talking to an NPC: script, message window, text printing, button waits"],
  ["title1", "title menu, new game intro scroll, class choice, name entry, entering the field", "title"],
];

for (const [name, what, start] of CASES) {
  describe.skipIf(!haveRom() || !haveTrace(name))(`field trace ${name}`, () => {
    it(`${what}: same screens and wait-point state`, () => {
      const { trace, diffs, waits, nWaits } = replayField(name, { ignore: IGNORE, start: start ?? "field" });
      expect(trace.meta.frames.length).toBeGreaterThan(100);
      expect(diffs.filter((d) => d.pixels && !(KNOWN[name] ?? []).includes(d.frame)).map((d) => `${d.frame}:${d.pixels}`)).toEqual([]);
      expect(nWaits).toBe(trace.waitFrames!.length);
      expect(summarizeWaits(waits)).toBe("");
    });
  });
}
