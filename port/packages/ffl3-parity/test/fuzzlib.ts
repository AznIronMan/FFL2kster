/** Legend III input sweep (tools/ffl3/traces.py fuzz_sweep): seeded random single-button input
 *  from field_start with a rich party poked (every spell, MP, a bag of 24 item kinds), into a
 *  battle (zbNN), the field (zfNN) or a shop / forge / mix / clinic / service (zsNN), and the
 *  targeted battles: one spell known (zmNN), a bag of 6 item kinds (ziNN), and the map events
 *  (zeTTP: type TT, parameter P); every trace
 *  replayed wait-exact and screen-exact. Skipped
 *  without the ROM or the traces. */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { haveRom, haveTrace, replay, summarize, summarizeWaits, TRACES } from "../src/index.js";

/** Known residual frames, exactly as they stand (any change fails): zf13 frame 2834, 59 pixels of
 *  a menu text row drawn while a frame work crossed the vblank (docs/ffl3/FINDINGS.md 1.53.0). */
const RESIDUAL: Record<string, [number, number][]> = { zf13: [[2834, 59]] };

export function inputSweep(kind: string, label: string, suffix = "[0-9]{2}"): void {
  const names = existsSync(TRACES) ? readdirSync(TRACES).filter((n) => new RegExp(`^z${kind}${suffix}$`).test(n)).sort() : [];
  const totals = { traces: 0, passed: 0, waits: 0, frames: 0 };
  const errors: Record<string, string[]> = {};

  describe.skipIf(!haveRom() || names.length === 0)(`FFL3 input sweep (${label})`, () => {
    for (const name of names) {
      it.skipIf(!haveTrace(name))(name, () => {
        const r = replay(name, { keepGoing: true });
        totals.traces++;
        totals.waits += r.nWaits;
        totals.frames += r.trace.meta.frames.length;
        const got = r.diffs.map((d) => [d.frame, d.pixels]);
        const ok = !r.error && r.nWaits === r.trace.waitFrames.length && !r.waits.length && JSON.stringify(got) === JSON.stringify(RESIDUAL[name] ?? [])
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
        expect(got).toEqual(RESIDUAL[name] ?? []);
      });
    }
    it("summary", () => {
      console.log(`input sweep totals (${label})`, JSON.stringify(totals));
      for (const [k, v] of Object.entries(errors).sort((a, b) => b[1].length - a[1].length)) console.log(`  ${v.length} ${k}: ${v.join(" ")}`);
    });
  });
}
