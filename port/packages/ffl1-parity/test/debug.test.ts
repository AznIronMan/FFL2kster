/** Ad-hoc: TRACE=name npx vitest run packages/ffl1-parity/test/debug.test.ts */
import { describe, it } from "vitest";
import { haveRom, haveTrace, replay, summarize, summarizeWaits } from "../src/index.js";

const name = process.env.TRACE ?? "";
describe.skipIf(!name || !haveRom() || !haveTrace(name))("FFL1 debug replay", () => {
  it(name, () => {
    let cov: (() => string) | null = null;
    const r = replay(name, { keepGoing: true, setup: (rig) => {
      const b = rig.engine.battle as unknown as { coverage: Record<string, number> };
      const u = rig.engine.battleUi as unknown as { coverage: Record<string, number> };
      cov = () => `handlers ${JSON.stringify(b.coverage)} screens ${JSON.stringify(u.coverage)}`;
    } });
    console.log(`waits ${r.nWaits}/${r.trace.waitFrames.length} busy ${r.busy} tickPhase ${r.tickPhase} late ${r.lateWrites} tears ${r.tears} raster ${r.rasterEdges} blank ${r.lcdBlanks} rephased ${r.rephased} diffs ${r.diffs.length} waitdiffs ${r.waits.length} error ${r.error ? r.error.message + " @" + r.error.wait : "-"}`);
    console.log(summarizeWaits(r.waits));
    console.log(summarize(r.diffs));
    if (cov) console.log((cov as () => string)());
  });
});
