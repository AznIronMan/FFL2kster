/** Diagnostic (DUMP=name FRAMES=a,b,...): replay a trace and write the engine's and the trace's
 *  screens of the given frames to build/sweep/dump/<name>_<frame>.{got,exp}.bin (160x144 shades);
 *  tools/screens_png.py turns them into side-by-side PNGs. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "vitest";
import { haveRom, replayField, IGNORE, ROOT, FRAME_BYTES } from "../src/index.js";

it.skipIf(!haveRom() || !process.env.DUMP)("dump screens", () => {
  const name = process.env.DUMP!;
  const want = new Set((process.env.FRAMES ?? "").split(",").filter(Boolean).map(Number));
  const dir = resolve(ROOT, "build/sweep/dump");
  mkdirSync(dir, { recursive: true });
  const { trace, diffs } = replayField(name, { ignore: IGNORE, start: (process.env.START as "title") ?? "field" });
  console.log(diffs.filter((d) => d.pixels).map((d) => `${d.frame}:${d.pixels}`).join(" "));
  for (const f of want) {
    writeFileSync(resolve(dir, `${name}_${f}.exp.bin`), trace.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES));
    const d = diffs.find((x) => x.frame === f);
    if (d?.got) writeFileSync(resolve(dir, `${name}_${f}.got.bin`), d.got);
  }
});
