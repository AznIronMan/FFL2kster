/** Battle parity sweeps (tools/battle_sweep.py, lean traces build/traces/bs_*): battles started at
 *  the entry of the battle main loop 0D:4000 with poked parties (every type, item and ability,
 *  stats, statuses), formations (every enemy), guest switch, RNG counters and button plans, run
 *  by the original to the return of the far call (mark 00:0EF4). Each is replayed through the
 *  engine with replayBattle (battle.ts: waits matched in order, busy frames, tick-phase, blink and
 *  joypad re-phasing, BATTLE_IGNORE): the machine equal at every frame wait, every screen
 *  identical, and the machine equal at the return.
 *  Screens: as in sweep.test.ts, a difference that lasts more than 3 consecutive frames fails;
 *  shorter ones are reported, not failed. They come from writes the original makes while the
 *  LCD draws (code running from vblank into the visible lines, e.g. the spell animations'
 *  tile updates), timing within a frame that the frame model does not place; the machine at
 *  every wait around them, VRAM included, is compared exactly. CPU-time pauses of the original
 *  (frames between two waits where it computes with the picture unchanged, e.g. the calc VM
 *  before the transformation wave) are skipped (replayBattle option `pauses`).
 *  Runs only with BSWEEP=prefix (e.g. BSWEEP=bs_ for all, BSWEEP=bs_i_); BSWEEP_LIST=file limits
 *  it to the names listed in a file. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { haveRom, TRACES } from "../src/index.js";
import { loadBattleModules, replayBattle, battleReport } from "../src/battle.js";

const PREFIX = process.env.BSWEEP ?? "";
const LIST = process.env.BSWEEP_LIST ? new Set(readFileSync(process.env.BSWEEP_LIST, "utf8").split(/\s+/).filter(Boolean)) : null;
const NAMES = PREFIX && existsSync(TRACES)
  ? readdirSync(TRACES).filter((n) => n.startsWith(PREFIX) && n.startsWith("bs_") && (!LIST || LIST.has(n)) && existsSync(resolve(TRACES, n, "marks.json"))).sort()
  : [];

describe.skipIf(!haveRom() || NAMES.length === 0)("battle parity sweep", () => {
  it.each(NAMES.length ? NAMES : ["none"])("%s", async (name) => {
    const mods = await loadBattleModules();
    const r = replayBattle(name, mods, { from: "battle", probeDisplay: false, pauses: true });
    const msg = battleReport(r);
    expect(r.error, msg).toBeUndefined();
    expect(r.waits.map((w) => w.wait), msg).toEqual([]);
    const runs: number[][] = [];
    for (const d of r.diffs) {
      const last = runs[runs.length - 1];
      if (last && d.frame === last[last.length - 1]! + 1) last.push(d.frame);
      else runs.push([d.frame]);
    }
    if (runs.length) console.log(`${name}: transient screen differences at ${runs.map((x) => `${x[0]}+${x.length}`).join(" ")}`);
    expect(runs.filter((x) => x.length > 3).map((x) => `${x[0]}+${x.length}`), msg).toEqual([]);
    expect(r.nWaits, msg).toBe(r.expectedWaits);
    const marked = JSON.parse(readFileSync(resolve(TRACES, name, "marks.json"), "utf8")).marks.length > 0;
    if (marked) {
      expect(r.returned, msg).toBe(true);
      expect(r.end, msg).toEqual([]);
    }
  });
});
