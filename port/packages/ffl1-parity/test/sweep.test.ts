/** Legend I battle sweep (tools/ffl1/traces.py SWEEP: a party of four with the item under test in
 *  slot 0, fighting an area): every trace replayed; prints the counts and the effect handler /
 *  screen routine coverage. Skipped without the ROM or the traces. */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { haveRom, haveTrace, replay, summarize, summarizeWaits, TRACES } from "../src/index.js";

const names = existsSync(TRACES) ? readdirSync(TRACES).filter((n) => /^bsw\d+$/.test(n)).sort() : [];
const cover: Record<string, number> = {}, uiCover: Record<string, number> = {};
const totals = { traces: 0, waits: 0, late: 0, tears: 0, raster: 0, blank: 0, rephased: 0 };

describe.skipIf(!haveRom() || names.length === 0)("FFL1 battle sweep", () => {
  for (const name of names) {
    it.skipIf(!haveTrace(name))(name, () => {
      const r = replay(name, { keepGoing: true, setup: (rig) => {
        const b = rig.engine.battle, u = rig.engine.battleUi;
        (globalThis as unknown as { __b: unknown }).__b = { b, u };
      } });
      const { b, u } = (globalThis as unknown as { __b: { b: { coverage: Record<string, number> }; u: { coverage: Record<string, number> } } }).__b;
      for (const [k, v] of Object.entries(b.coverage)) cover[k] = (cover[k] ?? 0) + v;
      for (const [k, v] of Object.entries(u.coverage)) uiCover[k] = (uiCover[k] ?? 0) + v;
      totals.traces++; totals.waits += r.nWaits; totals.late += r.lateWrites; totals.tears += r.tears;
      totals.raster += r.rasterEdges; totals.blank += r.lcdBlanks; totals.rephased += r.rephased;
      const info = `${name}: waits ${r.nWaits}/${r.trace.waitFrames.length} late ${r.lateWrites} tears ${r.tears} raster ${r.rasterEdges} blank ${r.lcdBlanks}`;
      if (r.error || r.waits.length || r.diffs.length) console.log(`${info} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}\n${summarize(r.diffs)}`);
      expect(r.error).toBeUndefined();
      expect(r.waits).toEqual([]);
      expect(r.diffs).toEqual([]);
    });
  }
  it("summary", () => {
    console.log("sweep totals", JSON.stringify(totals));
    console.log("handlers", Object.keys(cover).sort().map((k) => `${k}:${cover[k]}`).join(" "));
    console.log("screens", Object.keys(uiCover).sort().map((k) => `${k}:${uiCover[k]}`).join(" "));
  });
});
