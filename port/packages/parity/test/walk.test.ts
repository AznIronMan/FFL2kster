/** Field walking parity: the engine resumed at the field main loop (00:1A43) from the PyBoy
 *  snapshot, fed the same buttons, must produce the same screens, and the same machine state at
 *  every frame wait (rst $10), as the original. Sound driver state is not ported yet. */
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace, replayField, summarize, summarizeWaits } from "../src/index.js";

const NAME = "walk1";
const SOUND = (a: number) => (a >= 0xcb00 && a < 0xcc00) || (a >= 0xffb3 && a < 0xffc0) || (a >= 0xff10 && a < 0xff40);
/** The SM83 call stack (SP starts at CF00) holds return addresses the port does not have. */
const STACK = (a: number) => a >= 0xce00 && a < 0xcf00;
/** Hardware timing registers: DIV, IF, STAT mode, LY. */
const TIMING = (a: number) => a === 0xff04 || a === 0xff0f || a === 0xff41 || a === 0xff44;

describe.skipIf(!haveRom() || !haveTrace(NAME))("field walk trace parity", () => {
  it("matches the original screens and wait-point state", () => {
    const { trace, diffs, waits, nWaits } = replayField(NAME, { ignore: (a) => SOUND(a) || STACK(a) || TIMING(a) });
    expect(trace.meta.frames.length).toBeGreaterThan(100);
    expect(diffs.filter((d) => d.pixels).map((d) => d.frame)).toEqual([]);
    expect(nWaits).toBeGreaterThanOrEqual(trace.waitFrames!.length);
    expect(summarizeWaits(waits)).toBe("");
  });
});
