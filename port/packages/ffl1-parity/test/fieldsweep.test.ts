/** Legend I field sweep (P2; tools/ffl1/traces.py FIELD_SWEEP, EVENT_SWEEP): every map entered
 *  through its first warp from the first town, then a short walk with A presses (fswNNN), or a
 *  trigger cell stepped onto / an object talked to (evr / evt + command), or an event that texts
 *  start, poked as the pending event (tsw + command); every trace replayed. Prints
 *  the counts, the maps reached and the field event commands seen. Skipped without the ROM or
 *  the traces. */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { haveRom, haveTrace, replay, summarize, summarizeWaits, TRACES } from "../src/index.js";


const names = existsSync(TRACES) ? readdirSync(TRACES).filter((n) => /^(fsw\d+|ev[rt][0-9a-f]_\d+_\d+|ts[wb][0-9a-f]_[0-9a-f]{4})$/.test(n)).sort() : [];
const events: Record<string, number> = {};
const maps = new Set<number>();
const totals = { traces: 0, waits: 0, late: 0, tears: 0, raster: 0, blank: 0, rephased: 0, tickPhase: 0, battles: 0, lateRegs: 0, objOrder: 0 };

describe.skipIf(!haveRom() || names.length === 0)("FFL1 field sweep", () => {
  for (const name of names) {
    it.skipIf(!haveTrace(name))(name, () => {
      let ev: Record<string, number> = {}, mapAt: () => number = () => -1, battled = () => false;
      const r = replay(name, { keepGoing: true, setup: (rig) => {
        ev = rig.engine.events.coverage;
        mapAt = () => rig.g.m.rd(0xccc7);
        const b = rig.engine.battle as unknown as { coverage: Record<string, number> };
        battled = () => Object.keys(b.coverage).length > 0;
      } });
      for (const [k, v] of Object.entries(ev)) events[k] = (events[k] ?? 0) + v;
      maps.add(mapAt());
      totals.traces++; totals.waits += r.nWaits; totals.late += r.lateWrites; totals.tears += r.tears;
      totals.raster += r.rasterEdges; totals.blank += r.lcdBlanks; totals.rephased += r.rephased;
      totals.tickPhase += r.tickPhase; totals.lateRegs += r.lateRegs; totals.objOrder += r.objOrder; if (battled()) totals.battles++;
      const info = `${name}: map ${mapAt()} waits ${r.nWaits}/${r.trace.waitFrames.length} late ${r.lateWrites} tears ${r.tears}`;
      if (r.error || r.waits.length || r.diffs.length) console.log(`${info} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}\n${summarize(r.diffs)}`);
      expect(r.error).toBeUndefined();
      expect(r.waits).toEqual([]);
      expect(r.diffs.map((d) => [d.frame, d.pixels])).toEqual([]);
    });
  }
  it("summary", () => {
    console.log("field sweep totals", JSON.stringify(totals));
    console.log("maps at the end", maps.size, [...maps].sort((a, b) => a - b).join(" "));
    console.log("event commands", Object.keys(events).sort().map((k) => `${k}:${events[k]}`).join(" "));
  });
});
