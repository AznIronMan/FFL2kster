/** Legend I input sweep (tools/ffl1/traces.py fuzz_sweep): seeded random single-button input from
 *  the first town's field loop with random items poked into the party and the bag, into a battle
 *  (ybNN), the field of a warped-to map (yfNN) or a facility (ysNN), the item sweep (yiXXv:
 *  one field-usable item everywhere, input weighted to A and the menu) and the targeted battles
 *  and shops (ygNN growth and meat, yrNN reactions, yvNN sales of worn items); every trace replayed
 *  wait-exact and screen-exact. Skipped without the ROM or the traces. */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { haveRom, haveTrace, replay, summarize, summarizeWaits, TRACES } from "../src/index.js";

/** Known residual frames, exactly as they stand (any change fails): none. */
const RESIDUAL: Record<string, [number, number][]> = {};

export function inputSweep(kind: string, label: string, suffix = "[0-9]{2}"): void {
  const names = existsSync(TRACES) ? readdirSync(TRACES).filter((n) => new RegExp(`^y${kind}${suffix}$`).test(n)).sort() : [];
  const totals = { traces: 0, passed: 0, waits: 0, late: 0, tears: 0, raster: 0, blank: 0, rephased: 0 };
  describe.skipIf(!haveRom() || names.length === 0)(`FFL1 input sweep (${label})`, () => {
    for (const name of names) {
      it.skipIf(!haveTrace(name))(name, () => {
        const r = replay(name, { keepGoing: true });
        totals.traces++; totals.waits += r.nWaits; totals.late += r.lateWrites; totals.tears += r.tears;
        totals.raster += r.rasterEdges; totals.blank += r.lcdBlanks; totals.rephased += r.rephased;
        const got = r.diffs.map((d) => [d.frame, d.pixels]);
        const ok = !r.error && !r.waits.length && JSON.stringify(got) === JSON.stringify(RESIDUAL[name] ?? []);
        if (ok) totals.passed++;
        else console.log(`${name}: waits ${r.nWaits}/${r.trace.waitFrames.length} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}\n${summarize(r.diffs)}`);
        expect(r.error).toBeUndefined();
        expect(r.waits).toEqual([]);
        expect(got).toEqual(RESIDUAL[name] ?? []);
      });
    }
    it("summary", () => {
      console.log(`input sweep totals (${label})`, JSON.stringify(totals));
    });
  });
}
