/** Legend III in play (no trace: no sync points, no re-timing, the app's way): from power-on with
 *  the button plans of a few recorded scenarios, the engine must run without an engine error (a
 *  NotPorted stop or the game's reset is reported, not failed) and reach the field loop. The
 *  re-timings collapse in play, so the game may drift from the recorded run (other random
 *  draws); this checks robustness, not parity. Skipped without the ROM or the traces. */
import { describe, expect, it } from "vitest";
import { Engine, NotPorted, Reset, segmentsOf } from "@ffl3k/core";
import { haveRom, haveTrace, loadRom, loadTrace, buttonBits } from "../src/index.js";

/** After the plans: a seeded walk (a direction held 8-40 frames), A now and then, B to close. */
function walker(seed: number): (f: number) => number {
  let x = seed, dir = 0, until = 0;
  return (f) => {
    if (f >= until) { x = (x * 1103515245 + 12345) >>> 0; dir = [0x10, 0x20, 0x40, 0x80, 0][x >>> 29 & 3]!; until = f + 8 + (x >>> 8) % 33; }
    return f % 47 < 3 ? 0x01 : f % 211 < 3 ? 0x02 : dir;
  };
}

function play(plans: string[], frames: number, walk = walker(1)): { frame: number; stop?: string; field: boolean } {
  const rom = loadRom();
  const e = new Engine(segmentsOf(rom), rom);
  const g = e.g, m = g.m;
  m.wr(0xff40, 0x91);
  m.wr(0xff47, 0xfc);
  let field = false;
  const fieldLoopHit = () => { if (m.rd(0xc6e8) && m.rd(0xff4a) !== 0x50) field = true; };
  g.start(e.fromStart());
  const btns: number[] = [];
  for (const p of plans) for (const f of loadTrace(p).meta.frames) btns.push(buttonBits(f.btn));
  for (let f = 0; f < frames; f++) {
    g.buttons = btns[f] ?? walk(f);
    try {
      g.runFrame();
    } catch (err) {
      if (err instanceof NotPorted || err instanceof Reset) return { frame: f, stop: (err as Error).message, field };
      throw err;
    }
    if (f % 60 === 0) fieldLoopHit();
  }
  return { frame: frames, field };
}

describe.skipIf(!haveRom() || !haveTrace("opening3"))("FFL3 play from power-on", () => {
  it("the opening's buttons, then a walk", () => {
    const r = play(["opening3"], 90000);
    console.log(`play: ${r.frame} frames, field ${r.field}${r.stop ? `, stopped: ${r.stop}` : ""}`);
    expect(r.frame).toBeGreaterThan(30000);
  });
});
