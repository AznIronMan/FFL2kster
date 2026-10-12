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
  // LINES=frame: print SCX, SCY, WX, WY of some lines of that frame as drawn by the engine
  const linesAt = process.env.LINES ? Number(process.env.LINES) : -1;
  let frame = 0;
  const rows: string[] = [];
  const { trace, diffs } = replayField(name, {
    ignore: IGNORE, start: (process.env.START as "title") ?? "field",
    setup: (rig) => {
      const prev = rig.g.onLine;
      rig.g.onLine = (y) => {
        prev?.(y);
        if (y === 143) frame++;
        if (rig.g.frame === linesAt && [0, 10, 30, 40, 60, 70, 72, 75, 80, 90, 100, 120, 143].includes(y)) {
          const io = rig.g.m.io;
          rows.push(`${y}:(${io[0x43]},${io[0x42]},${io[0x4b]! - 7},${io[0x4a]})`);
        }
      };
    },
  });
  if (rows.length) console.log(rows.join(" "));
  console.log(diffs.filter((d) => d.pixels).map((d) => `${d.frame}:${d.pixels}`).join(" "));
  for (const f of want) {
    writeFileSync(resolve(dir, `${name}_${f}.exp.bin`), trace.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES));
    const d = diffs.find((x) => x.frame === f);
    if (d?.got) writeFileSync(resolve(dir, `${name}_${f}.got.bin`), d.got);
  }
});
