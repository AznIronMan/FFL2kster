/** Ad-hoc: TRACE=name npx vitest run packages/ffl1-parity/test/diffbox.test.ts — for each
 *  differing frame: the bounding box of the differing pixels, the rows, and whether each differing
 *  pixel equals the previous frame's (expected or port). */
import { describe, it } from "vitest";
import { haveRom, haveTrace, replay, FRAME_BYTES } from "../src/index.js";

const name = process.env.TRACE ?? "";
describe.skipIf(!name || !haveRom() || !haveTrace(name))("FFL1 diff boxes", () => {
  it(name, () => {
    const got = new Map<number, Uint8Array>();
    const r = replay(name, { keepGoing: true, onFrame: (f, g) => got.set(f, g.slice()) });
    for (const d of r.diffs) {
      const f = d.frame, exp = r.trace.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES);
      const prevE = r.trace.screens.subarray((f - 1) * FRAME_BYTES, f * FRAME_BYTES), prevG = got.get(f - 1);
      let x0 = 160, x1 = -1, y0 = 144, y1 = -1, oldE = 0, oldG = 0, n = 0;
      for (let i = 0; i < FRAME_BYTES; i++) {
        if (exp[i] === d.got[i]) continue;
        n++;
        const x = i % 160, y = (i / 160) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        if (exp[i] === prevE[i]) oldE++;
        if (prevG && exp[i] === prevG[i]) oldG++;
      }
      console.log(`f${f}: ${n} px in x ${x0}-${x1} y ${y0}-${y1}; exp = trace prev ${oldE}, = port prev ${oldG}`);
    }
  });
});
