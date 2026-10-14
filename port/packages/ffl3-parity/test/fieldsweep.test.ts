/** Legend III field sweep (P2; tools/ffl3/traces.py map_sweep): every map entered from
 *  field_start through a poked return point (event 04), then a short walk (mapXX); every trace
 *  replayed wait-exact. Prints the totals and the first error of each failing trace. Skipped
 *  without the ROM or the traces. */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { haveRom, haveTrace, replay, summarize, summarizeWaits, TRACES } from "../src/index.js";

const names = existsSync(TRACES) ? readdirSync(TRACES).filter((n) => /^(map[0-9a-f]{2}|t[0-9a-f]{2}_[0-9a-f])$/.test(n)).sort() : [];
const totals = { traces: 0, passed: 0, waits: 0, frames: 0 };
const errors: Record<string, string[]> = {};

describe.skipIf(!haveRom() || names.length === 0)("FFL3 field sweep", () => {
  for (const name of names) {
    it.skipIf(!haveTrace(name))(name, () => {
      const r = replay(name, { keepGoing: true });
      totals.traces++;
      totals.waits += r.nWaits;
      totals.frames += r.trace.meta.frames.length;
      const ok = !r.error && r.nWaits === r.trace.waitFrames.length && !r.waits.length && !r.diffs.length
        && !r.lateSyncs && !r.latePolls && !r.latePoints && !r.workMismatch;
      if (ok) totals.passed++;
      else {
        const k = r.error?.message.replace(/\(.*$/, "").trim() ?? (r.waits.length ? "wait diffs" : r.diffs.length ? "screen diffs" : "timing");
        (errors[k] ??= []).push(name);
        if (process.env.FFL3K_SWEEP_VERBOSE) console.log(`${name}: waits ${r.nWaits}/${r.trace.waitFrames.length} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}\n${summarize(r.diffs)}`);
      }
      expect(r.error).toBeUndefined();
      expect(r.nWaits).toBe(r.trace.waitFrames.length);
      expect(r.lateSyncs + r.latePolls + r.latePoints + r.workMismatch).toBe(0);
      expect(r.waits).toEqual([]);
      expect(r.diffs.map((d) => [d.frame, d.pixels])).toEqual([]);
    });
  }
  it("summary", () => {
    console.log("field sweep totals", JSON.stringify(totals));
    for (const [k, v] of Object.entries(errors).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${v.length} ${k}: ${v.join(" ")}`);
  });
});
