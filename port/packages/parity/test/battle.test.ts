/** Battle traces (tools/trace_record.py, build/traces/bt_*): the battle main loop 0D:4000 (and the
 *  encounter from the field) replayed against the original, frame by frame.
 *
 *  The battle screen (0F:6080/6083, 0D:5000), the battle menus (01:5015/5018/501B) and the battle
 *  main loop are ported as separate modules; this file installs whichever exist.
 *   1. "progress" (always runs when the trace and ROM exist): replays each trace and reports how
 *      far it matches. Without the display module, 0F:6080 is replaced by a probe that runs its
 *      first instruction (rst $10) and stops: the machine at that wait (and, for bt_field, at
 *      every wait of the walk, the encounter script and the transition 00:2CBE before it) is
 *      produced by the ported code alone and must match.
 *   2. "full parity": every
 *      wait and screen up to the return of 0D:4000 (machine at the return = mark 00:0EF4). */
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace } from "../src/index.js";
import { loadBattleModules, replayBattle, battleReport } from "../src/battle.js";

/** Display, menus and the battle loop are wired into the Engine: full parity always runs
 *  (FFL2K_BATTLE_FULL=0 turns it off for diagnosis). */
const FULL = process.env.FFL2K_BATTLE_FULL !== "0";

/** Known screen differences (full parity): bt_field frames 258 and 317 are drawn while the
 *  original is still executing the encounter / split-opening code (00:0EC5 → 00:2ADF → 00:2DDC
 *  writes SCY/SCX after LY 43; 00:2CBE raster loop): register writes in the middle of a frame,
 *  which the frame model (code runs at vblank) does not place. The machine state at every wait
 *  around them matches. */
const KNOWN: Record<string, number[]> = { bt_field: [258, 317] };

const TRACES: [string, "battle" | "field", string][] = [
  ["bt_win45", "battle", "Fight with A every turn: one round, victory, GP"],
  ["bt_win180", "battle", "one round, victory, GP, growth"],
  ["bt_run", "battle", "Run on the first turn: escaped"],
  ["bt_runfail", "battle", "Run fails (formation flag D844 bit 5 poked): enemy initiative, two rounds, victory"],
  ["bt_meat", "battle", "party at 1 HP: a member dies, two rounds, victory, meat drop, Eat prompt, eater chosen"],
  ["bt_defeat", "battle", "party at 1 HP vs 3 × enemy 100 (formation poked): defeat (C763), game-over palette"],
  ["bt_field", "field", "walk on the world map into a random encounter: script, formation 00:2ADF, transition 00:2CBE, battle"],
];

for (const [name, from, what] of TRACES) {
  describe.skipIf(!haveRom() || !haveTrace(name))(`battle trace ${name} (progress)`, () => {
    it(`${what}: report how far it matches`, async () => {
      const mods = await loadBattleModules();
      expect(mods.installers.has("installBattle")).toBe(true);
      const r = replayBattle(name, mods, { from });
      console.log(battleReport(r));
      // The ported battle code must not fail by itself: the only acceptable stops are routines of
      // other modules not installed yet (NotPorted) and the display probe.
      if (r.error) expect(r.error).toMatch(/^(NotPorted|ProbeStop|Error: not ported)|not ported yet|probe:/);
      // Everything before the first call into a module that is missing must match.
      if (!mods.installers.has("installBattleDisplay")) {
        expect(r.waits.filter((w) => w.wait < r.nWaits - (r.error?.includes("probe") ? 0 : 1))).toEqual([]);
        if (r.error?.includes("probe")) expect(r.nWaits).toBeGreaterThan(0);
      }
    });
  });
}

describe.runIf(FULL)("battle traces: full parity (integration)", () => {
  for (const [name, from, what] of TRACES) {
    it.skipIf(!haveRom() || !haveTrace(name))(`${name}: ${what}`, async () => {
      const mods = await loadBattleModules();
      expect(mods.missing).toEqual([]);
      const r = replayBattle(name, mods, { from, probeDisplay: false });
      const msg = battleReport(r);
      expect(r.error, msg).toBeUndefined();
      expect(r.waits.map((w) => w.wait), msg).toEqual([]);
      expect(r.diffs.filter((d) => !(KNOWN[name] ?? []).includes(d.frame)).map((d) => `${d.frame}:${d.pixels}`), msg).toEqual([]);
      expect(r.nWaits, msg).toBe(r.expectedWaits);
      if (from === "battle") {
        expect(r.returned, msg).toBe(true);
        expect(r.end, msg).toEqual([]);
      }
    });
  }
});
