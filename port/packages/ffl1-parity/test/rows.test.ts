/** Ad-hoc: TRACE=name FRAMES=71,72 ROWS=20,28 — expected / got pixel rows (0-3 shades). */
import { describe, it } from "vitest";
import { haveRom, haveTrace, replay, FRAME_BYTES } from "../src/index.js";

const name = process.env.TRACE ?? "";
const frames = (process.env.FRAMES ?? "").split(",").filter(Boolean).map(Number);
const rows = (process.env.ROWS ?? "").split(",").filter(Boolean).map(Number);
describe.skipIf(!name || !haveRom() || !haveTrace(name))("FFL1 rows", () => {
  it(name, () => {
    const got = new Map<number, Uint8Array>();
    const r = replay(name, { keepGoing: true, onFrame: (f, g) => { if (frames.includes(f) || frames.includes(f + 1)) got.set(f, g.slice()); } });
    for (const f of frames) for (const y of rows) {
      const e = r.trace.screens.subarray(f * FRAME_BYTES + y * 160, f * FRAME_BYTES + y * 160 + 160);
      const g = got.get(f)?.subarray(y * 160, y * 160 + 160);
      const g1 = got.get(f - 1)?.subarray(y * 160, y * 160 + 160);
      console.log(`f${f} y${y}\n e ${Array.from(e).join("")}\n g ${g ? Array.from(g).join("") : "-"}\n p ${g1 ? Array.from(g1).join("") : "-"}`);
    }
  });
});
