/** Legend I sound driver (07:4000 / 07:4003, @ffl1k/core SoundDriver) against PyBoy: the driver's
 *  RAM (CE00-CEFF, FFE1-FFEF) compared at every frame wait, on top of the usual compare.
 *  - sfx01-sfx36: each sound effect requested (FFE4) in the idle field loop of the first town;
 *  - jngXX: a jingle (FFE2), the music saved to CE60 and restored when its channels end;
 *  - the title and field traces whose code never writes a request inside a busy stretch (in
 *    battles the request lands a tick apart: CPU time, docs/FFL1_PROGRESS.md).
 *  Skipped without the ROM or the traces. */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { haveRom, haveTrace, replay, summarizeWaits, IGNORE_KEEP_SOUND, TRACES } from "../src/index.js";

const FIELD = ["title1", "probe1", "walk1", "walk2", "talk1", "menu1", "order1", "inn1", "shop1", "guild1", "care1"];
const names = existsSync(TRACES) ? [...readdirSync(TRACES).filter((n) => /^(sfx\d+|jng[0-9a-f]+)$/.test(n)).sort(), ...FIELD] : [];
const totals = { traces: 0, waits: 0, effects: 0, restored: 0 };

describe.skipIf(!haveRom() || names.length === 0)("FFL1 sound driver", () => {
  for (const name of names) {
    it.skipIf(!haveTrace(name))(name, () => {
      let restored = false, played = false;
      const at = (got: Uint8Array, a: number) => got[a - 0x8000]!;
      const r = replay(name, { keepGoing: true, ignore: IGNORE_KEEP_SOUND, watch: (_i, _f, _exp, got) => {
        if (name.startsWith("sfx") && (at(got, 0xce00) & 1 || at(got, 0xcec7) & 1)) played = true;
        if (name.startsWith("jng")) {
          if (at(got, 0xffe3)) played = true;
          else if (played) restored = true;
        }
      } });
      totals.traces++; totals.waits += r.nWaits;
      if (name.startsWith("sfx") && played) totals.effects++;
      if (restored) totals.restored++;
      if (r.error || r.waits.length) console.log(`${name}: ${r.error?.message ?? ""}\n${summarizeWaits(r.waits)}`);
      expect(r.error).toBeUndefined();
      expect(r.waits).toEqual([]);
    });
  }
  it("summary", () => console.log("sound totals", JSON.stringify(totals)));
});
