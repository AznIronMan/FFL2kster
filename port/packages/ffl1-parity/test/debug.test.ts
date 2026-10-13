/** Ad-hoc: TRACE=name npx vitest run packages/ffl1-parity/test/debug.test.ts */
import { describe, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { haveRom, haveTrace, replay, summarize, summarizeWaits, IGNORE_KEEP_SOUND } from "../src/index.js";

const name = process.env.TRACE ?? "";
describe.skipIf(!name || !haveRom() || !haveTrace(name))("FFL1 debug replay", () => {
  it(name, () => {
    let cov: (() => string) | null = null;
    // SHOT=f: the port's frame f (-1: the last) as a PGM in ffl1/build/png (local only)
    const shot = process.env.SHOT !== undefined ? Number(process.env.SHOT) : null;
    let last: Uint8Array | null = null;
    const r = replay(name, { keepGoing: true, ...(process.env.SOUND ? { ignore: IGNORE_KEEP_SOUND } : {}), onFrame: (f, px) => { if (shot === -1 || f === shot) last = px.slice(); }, setup: (rig) => {
      const b = rig.engine.battle as unknown as { coverage: Record<string, number> };
      const u = rig.engine.battleUi as unknown as { coverage: Record<string, number> };
      cov = () => `handlers ${JSON.stringify(b.coverage)} screens ${JSON.stringify(u.coverage)}`;
    } });
    console.log(`waits ${r.nWaits}/${r.trace.waitFrames.length} busy ${r.busy} tickPhase ${r.tickPhase} late ${r.lateWrites} tears ${r.tears} raster ${r.rasterEdges} blank ${r.lcdBlanks} lateRegs ${r.lateRegs} rephased ${r.rephased} seeds ${r.seeds} diffs ${r.diffs.length} waitdiffs ${r.waits.length} error ${r.error ? r.error.message + " @" + r.error.wait : "-"}`);
    console.log(summarizeWaits(r.waits));
    console.log(summarize(r.diffs));
    if (cov) console.log((cov as () => string)());
    if (last) {
      const dir = new URL("../../../../ffl1/build/png/", import.meta.url).pathname;
      mkdirSync(dir, { recursive: true });
      const px = Uint8Array.from(last as Uint8Array, (v) => 255 - v * 85);
      writeFileSync(`${dir}${name}_shot.pgm`, Buffer.concat([Buffer.from("P5 160 144 255\n"), Buffer.from(px)]));
    }
  });
});
