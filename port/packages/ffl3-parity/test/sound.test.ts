/** Legend III sound parity (1.45.0): every trace recorded from 1.45.0 on (the sound requests'
 *  times in waits.json) compares the sound driver's state (CB00-CBFE, FFBB-FFC5; the port's
 *  driver 0F:4006, sound.ts) at each frame wait, in the slice and the sweeps. The residuals in
 *  SOUND_KNOWN are compared without it; this checks that each still differs (fixed: drop it from
 *  the list) and that its other state is equal. Skipped without the ROM or the traces. */
import { describe, expect, it } from "vitest";
import { haveRom, haveTrace, replay, IGNORE, IGNORE_SOUND_ON, SOUND_KNOWN } from "../src/index.js";

describe.skipIf(!haveRom())("FFL3 sound residuals", () => {
  for (const name of SOUND_KNOWN) {
    it.skipIf(!haveTrace(name))(`${name} (sound state still differs)`, () => {
      const r = replay(name, { ignore: IGNORE_SOUND_ON, keepGoing: true });
      expect(r.waits.length).toBeGreaterThan(0);
      const plain = replay(name, { ignore: IGNORE, keepGoing: true });
      expect(plain.waits).toEqual([]);
    });
  }
});
