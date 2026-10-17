/** Legend I in play (no trace: no sync points, no re-timing, the app's way): from power-on (the
 *  start code 00:0224, as apps/web player1.ts boots it) with the button plan of a recorded new
 *  game, then a seeded walk, the engine must run every frame without an engine error and without
 *  a not-ported stop (NotPorted, NotPortedEvent, NotPortedBattle: none is expected, so any is a
 *  failure here), reach the field loop and keep the frame counter advancing. A soft reset is
 *  answered with a new start, as the app does. The play drifts from the recorded run (other
 *  random draws), so this checks robustness, not parity. Skipped without the ROM or the trace. */
import { describe, expect, it } from "vitest";
import { Engine, SoftReset } from "@ffl1k/core";
import { Ppu, regsFromIo } from "@ffl2k/render";
import { haveRom, haveTrace, loadRom, loadTrace, buttonBits, segments } from "../src/index.js";

/** A direction held 8-40 frames, A now and then, B to close; Start now and then (Legend III's
 *  walk plus Start: Legend I's name entry, reached again after a defeat restarts the game, only
 *  ends with Start or its END cell). */
function walker(seed: number): (f: number) => number {
  let x = seed, dir = 0, until = 0;
  return (f) => {
    if (f >= until) { x = (x * 1103515245 + 12345) >>> 0; dir = [0x10, 0x20, 0x40, 0x80, 0][x >>> 29 & 3]!; until = f + 8 + (x >>> 8) % 33; }
    return f % 47 < 3 ? 0x01 : f % 211 < 3 ? 0x02 : f % 997 < 3 ? 0x08 : dir;
  };
}

/** fieldPasses: passes of the field loop 00:1243 (one per step or idle frame). */
interface Played { frame: number; error?: string; fieldPasses: number; maps: number; battles: number; resets: number; }

function play(plan: string, frames: number, seed: number): Played {
  const rom = loadRom();
  const e = new Engine(segments(rom), rom);
  const g = e.g, m = g.m;
  const walk = walker(seed);
  // the app's renderer on every line (apps/web player1.ts)
  const ppu = new Ppu(m.vram, m.oam);
  g.onLine = (y) => { if (y === 0) ppu.beginFrame(); ppu.regs = regsFromIo(m.io); ppu.line(y); };
  // the random counters C300 (DIV at 00:028C) from the seed, so a run repeats
  let rs = seed;
  g.hooks.divSeed = (gg) => { for (let i = 0; i < 0x80; i++) { rs = (rs * 1103515245 + 12345) >>> 0; gg.m.wr(0xc300 + i, rs >>> 24); } };
  const boot = () => g.start(e.run(e.boot()));
  boot();
  // the trace starts at the title (03:7D50), 31 frames after the start code (power1: 00:0224 at
  // PyBoy frame 64, newgame2: 03:7D50 at frame 95)
  const btns: number[] = new Array(31).fill(0);
  for (const f of loadTrace(plan).meta.frames) btns.push(buttonBits(f.btn));
  const maps = new Set<number>();
  let fieldPasses = 0, battles = 0, resets = 0, lastFrame = -1, lastField = -1;
  const run = e.battle.run.bind(e.battle);
  e.battle.run = function* () { battles++; return yield* run(); };
  for (let f = 0; f < frames; f++) {
    g.buttons = btns[f] ?? walk(f);
    try {
      g.runFrame();
    } catch (err) {
      if (err instanceof SoftReset) { resets++; boot(); continue; }
      return { frame: f, error: `${(err as Error).constructor.name}: ${(err as Error).message}`, fieldPasses, maps: maps.size, battles, resets };
    }
    if (g.frame <= lastFrame) return { frame: f, error: `frame counter stuck at ${g.frame}`, fieldPasses, maps: maps.size, battles, resets };
    lastFrame = g.frame;
    if (g.ui.fieldFrame !== lastField) { lastField = g.ui.fieldFrame; fieldPasses++; maps.add(m.rd(0xccc7)); }
  }
  return { frame: frames, fieldPasses, maps: maps.size, battles, resets };
}

describe.skipIf(!haveRom() || !haveTrace("newgame2"))("FFL1 play from power-on", () => {
  for (const seed of [1, 2, 3]) {
    it(`a new game's buttons, then a walk (seed ${seed})`, () => {
      const r = play("newgame2", 90000, seed);
      console.log(`play (seed ${seed}): ${r.frame} frames, field loop passes ${r.fieldPasses}, maps ${r.maps}, battles ${r.battles}, soft resets ${r.resets}${r.error ? `, stopped: ${r.error}` : ""}`);
      expect(r.error).toBeUndefined();
      expect(r.frame).toBe(90000);
      expect(r.fieldPasses).toBeGreaterThan(1000); // the field loop (00:1243) kept running
    });
  }
});
