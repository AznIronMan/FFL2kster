/** Diagnostic: print the first differing wait points of a trace (DEBUG=name). */
import { it } from "vitest";
import { haveRom, replayField, summarizeWaits, IGNORE } from "../src/index.js";

it.skipIf(!haveRom() || !process.env.DEBUG)("debug trace", () => {
  const { diffs, waits, nWaits, trace } = replayField(process.env.DEBUG!, { ignore: IGNORE });
  console.log(`waits engine ${nWaits} trace ${trace.waitFrames?.length}`);
  console.log(summarizeWaits(waits));
  console.log(diffs.filter((d) => d.pixels).slice(0, 5).map((d) => `${d.frame}:${d.pixels}`).join(" "));
  console.log((trace.waitFrames ?? []).slice(0, 120).join(","));
});
