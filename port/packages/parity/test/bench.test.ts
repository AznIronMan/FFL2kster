/** Performance benchmark (BENCH=1): time per game frame for the engine alone and with the PPU,
 *  on the field (walking with random buttons from the first town) and in a battle, so the port's
 *  headroom on slow devices can be judged (a frame must fit in 16.7 ms; a phone or old laptop is
 *  roughly 4-6 times slower than a current desktop). Prints p50 / p95 / max and the average. */
import { it } from "vitest";
import { performance } from "node:perf_hooks";
import { haveRom, haveTrace, loadRom, loadTrace, Rig } from "../src/index.js";
import { loadBattleModules } from "../src/battle.js";

const N = Number(process.env.BENCH_FRAMES ?? 6000);

function stats(t: number[]): string {
  const s = [...t].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!.toFixed(3);
  return `avg ${(t.reduce((a, b) => a + b, 0) / t.length).toFixed(3)} ms, p50 ${q(0.5)}, p95 ${q(0.95)}, p99 ${q(0.99)}, max ${s[s.length - 1]!.toFixed(3)}`;
}

function run(rig: Rig, frames: number, buttons: (f: number) => number): number[] {
  const times: number[] = [];
  for (let f = 0; f < frames; f++) {
    rig.g.buttons = buttons(f);
    const t0 = performance.now();
    rig.g.runFrame();
    times.push(performance.now() - t0);
  }
  return times;
}

it.skipIf(!process.env.BENCH || !haveRom() || !haveTrace("sw_m_000"))("benchmark", async () => {
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const walk = (f: number) => (f % 24 < 16 ? [0x10, 0x20, 0x40, 0x80][Math.floor(f / 240) % 4]! : rnd() < 0.05 ? 1 : 0);
  // field with the PPU (as the player runs it)
  const t = loadTrace("sw_m_000");
  const rig = new Rig(loadRom());
  rig.g.m.loadFull(t.start);
  rig.g.start(rig.engine.field.loop());
  run(rig, 300, walk); // warm up
  console.log(`field, engine + PPU (${N} frames): ${stats(run(rig, N, walk))}`);
  // field, engine only
  const rig2 = new Rig(loadRom());
  rig2.g.onLine = null;
  rig2.g.m.loadFull(t.start);
  rig2.g.start(rig2.engine.field.loop());
  run(rig2, 300, walk);
  console.log(`field, engine only: ${stats(run(rig2, N, walk))}`);
  // battle with the PPU (bs_r_0000 from its entry, A pressed through menus)
  if (haveTrace("bs_r_0000")) {
    await loadBattleModules();
    const bt = loadTrace("bs_r_0000");
    const rig3 = new Rig(loadRom());
    rig3.g.m.loadFull(bt.start);
    const { r0D_4000 } = await import("@ffl2k/core").then((c) => (c as unknown as { battle: { main: { r0D_4000: (e: unknown) => Generator } } }).battle.main);
    rig3.g.start(r0D_4000(rig3.engine) as never);
    const times: number[] = [];
    for (let f = 0; f < 3000 && !rig3.g.done; f++) {
      rig3.g.buttons = f % 6 < 2 ? 1 : 0;
      const t0 = performance.now();
      rig3.g.runFrame();
      times.push(performance.now() - t0);
    }
    console.log(`battle, engine + PPU (${times.length} frames): ${stats(times)}`);
  }
  // display conversion: 256x144 widescreen-sized palette pass (the browser's per-frame draw)
  const img = new Uint8ClampedArray(256 * 144 * 4), frame = new Uint8Array(256 * 144);
  const pal = [[255, 255, 255], [170, 170, 170], [85, 85, 85], [0, 0, 0]];
  const dt: number[] = [];
  for (let k = 0; k < 2000; k++) {
    const t0 = performance.now();
    for (let i = 0; i < frame.length; i++) { const c = pal[frame[i]!]!; img[4 * i] = c[0]!; img[4 * i + 1] = c[1]!; img[4 * i + 2] = c[2]!; img[4 * i + 3] = 255; }
    dt.push(performance.now() - t0);
  }
  console.log(`palette pass 256x144: ${stats(dt)}`);
}, 600_000);
