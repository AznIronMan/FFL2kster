/** Soak test (SOAK=hours of game time, e.g. SOAK=10): the full engine with the PPU, run with random
 *  button presses from field states across the game (a new sw_m start every 10 game minutes, so the
 *  walk is not stuck in one town) (held 2-30 frames) through whatever the game leads to
 *  (walking, menus, shops, battles, game over and back to the title, new games). Fails on any
 *  engine error; reports frame-time percentiles per hour and the heap, which must stay flat. */
import { expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { readdirSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { SoftReset } from "@ffl2k/core";
import { haveRom, haveTrace, loadRom, loadTrace, Rig, TRACES } from "../src/index.js";

const HOURS = Number(process.env.SOAK ?? 0);
const FPH = Math.round(59.7275 * 3600);

it.skipIf(!HOURS || !haveRom() || !haveTrace("sw_m_000"))("soak", () => {
  // heap readings are only meaningful after a full collection
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  const starts = readdirSync(TRACES).filter((n) => /^sw_m_\d+$/.test(n) && haveTrace(n)).sort();
  const rig = new Rig(loadRom());
  const SEGMENT = Math.round(FPH / 6);
  let seed = 12345, held = 0, left = 0, resets = 0, battles = 0, inBattle = false;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const heap: number[] = [];
  for (let h = 0; h < HOURS; h++) {
    const times: number[] = [];
    for (let f = 0; f < FPH; f++) {
      if (f % SEGMENT === 0) {
        rig.g.m.loadFull(loadTrace(starts[rnd(starts.length)]!).start);
        rig.g.start(rig.engine.field.loop());
        inBattle = false;
      }
      if (left-- <= 0) {
        // mostly single buttons; Start+Select+A+B together never (that is the soft reset combo)
        held = [0, 0, 1, 1, 1, 2, 0x10, 0x20, 0x40, 0x80, 8, 4][rnd(12)]!;
        left = 2 + rnd(28);
      }
      rig.g.buttons = held;
      const t0 = performance.now();
      try {
        rig.g.runFrame();
      } catch (e) {
        if (!(e instanceof SoftReset)) throw new Error(`hour ${h} frame ${f}: ${(e as Error).stack}`);
        resets++;
        rig.g.start(rig.engine.main());
      }
      times.push(performance.now() - t0);
      const b = rig.g.m.hram[0x0b] === 0xff;
      if (b && !inBattle) battles++;
      inBattle = b;
    }
    times.sort((a, b) => a - b);
    gc();
    heap.push(process.memoryUsage().heapUsed / 1e6);
    console.log(`hour ${h + 1}: p50 ${times[times.length >> 1]!.toFixed(3)} ms, p99 ${times[Math.floor(times.length * 0.99)]!.toFixed(3)}, max ${times[times.length - 1]!.toFixed(2)}; heap ${heap[h]!.toFixed(1)} MB; battles ${battles}, resets ${resets}`);
  }
  expect(battles).toBeGreaterThan(0); // the walk reached the battle engine
  if (heap.length > 2) expect(heap[heap.length - 1]!).toBeLessThan(heap[1]! * 1.5 + 20);
}, 3_600_000);
