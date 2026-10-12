/** Diagnostic: print the first differing wait points of a trace (DEBUG=name). */
import { it } from "vitest";
import { haveRom, replayField, summarizeWaits, IGNORE } from "../src/index.js";

it.skipIf(!haveRom() || !process.env.DEBUG)("debug trace", () => {
  const watchAddr = process.env.WATCH ? process.env.WATCH.split(",").map((x) => parseInt(x, 16)) : [];
  const [w0, w1] = (process.env.WAITS ?? "0-0").split("-").map(Number);
  const rows: string[] = [];
  const { diffs, waits, nWaits, trace, tickPhase, busy, rephased } = replayField(process.env.DEBUG!, {
    ignore: IGNORE, start: (process.env.START as "title") ?? "field",
    watch: watchAddr.length ? (i, f, exp, got) => {
      if (i < w0! || i > w1!) return;
      rows.push(`w${i} f${f}: ` + watchAddr.map((a) => `${a.toString(16)} ${exp[a - 0x8000]!.toString(16)}/${got[a - 0x8000]!.toString(16)}`).join("  "));
    } : undefined,
  });
  if (rows.length) console.log(rows.join("\n"));
  console.log(`waits engine ${nWaits} trace ${trace.waitFrames?.length}, matched before the tick: ${tickPhase}, busy frames ${busy}, blink re-phased ${rephased}`);
  console.log(summarizeWaits(waits));
  if (waits[0]) console.log(waits[0].values.map(([a, e, g, p]) => `${a.toString(16)}:${e.toString(16)}/${g.toString(16)}/${p.toString(16)}`).join(" "));
  console.log(diffs.filter((d) => d.pixels).slice(0, 5).map((d) => `${d.frame}:${d.pixels}`).join(" "));
  console.log((trace.waitFrames ?? []).slice(0, 120).join(","));
});
