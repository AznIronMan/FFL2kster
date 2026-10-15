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
// (zk43: the map animation's strip bytes of a jump frame, spread evenly over the lines to 01:49D5
// by `vramUntil`, land a line or two off the original's on one tile's rows 39-42)
// (zyqf02: a frame work's tile bytes (the map animation, 1273 l14-49) written one by one while the
// lines are drawn: three lines show a tile row with one plane new and one old; the port writes
// the work at once, and the replay accepts such rows on two lines at most)
// (zu20, zu22, zu2e: a spell book's learn screen places the party's figures (00:2FBF, code 43)
// while the STAT on line 3 takes its frame work (00:3549, the walking figures' frame sets x bit 0):
// the original's stores straddle it, the first entry's x before the work and the rest after, so
// member 1's first entry ends one pixel off its others for 9 frames (37 px each); the port writes
// the placement at once at 00:3054 and cannot split it within the instruction stream)
const RESIDUAL: Record<string, [number, number][]> = { zf13: [[2834, 59]], zk43: [[2211, 15]], zyqf02: [[1273, 3]],
  zu20: [[255, 37], [256, 37], [258, 37], [259, 37], [260, 37], [261, 37], [262, 37], [263, 37], [264, 37]],
  zu22: [[3071, 37], [3072, 37], [3074, 37], [3075, 37], [3076, 37], [3077, 37], [3078, 37], [3079, 37], [3080, 37]],
  zu2e: [[1247, 37], [1248, 37], [1250, 37], [1251, 37], [1252, 37], [1253, 37], [1254, 37], [1255, 37], [1256, 37]],
};

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
