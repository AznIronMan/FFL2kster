/** Ad-hoc: TRACE=name npx vitest run packages/ffl1-parity/test/debug.test.ts */
import { describe, it } from "vitest";
import { haveRom, haveTrace, replay, summarize, summarizeWaits } from "../src/index.js";

const name = process.env.TRACE ?? "";
describe.skipIf(!name || !haveRom() || !haveTrace(name))("FFL1 debug replay", () => {
  it(name, () => {
    const r = replay(name, { keepGoing: true });
    console.log(`waits ${r.nWaits}/${r.trace.waitFrames.length} busy ${r.busy} tickPhase ${r.tickPhase} late ${r.lateWrites} tears ${r.tears} rephased ${r.rephased} diffs ${r.diffs.length} waitdiffs ${r.waits.length} error ${r.error ? r.error.message + " @" + r.error.wait : "-"}`);
    console.log(summarizeWaits(r.waits));
    console.log(summarize(r.diffs));
  });
});
