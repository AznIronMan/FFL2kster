/** Ad-hoc: TRACE=name npx vitest run packages/ffl1-parity/test/dumpdiff.test.ts — for every
 *  differing frame f writes a PGM to ffl1/build/png (local only): top row expected f-2..f+2,
 *  bottom row the port's f-2..f+2 (frames that are frame waits are skipped by the compare). */
import { describe, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { haveRom, haveTrace, replay, FRAME_BYTES } from "../src/index.js";

const name = process.env.TRACE ?? "";
describe.skipIf(!name || !haveRom() || !haveTrace(name))("FFL1 diff dump", () => {
  it(name, () => {
    const got = new Map<number, Uint8Array>();
    const r = replay(name, { keepGoing: true, onFrame: (f, g) => got.set(f, g.slice()) });
    const dir = new URL("../../../../ffl1/build/png/", import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    const W = 160, H = 144, N = 5, G = 4, OW = N * (W + G);
    const shade = (v: number) => 255 - (v & 3) * 85;
    for (const d of r.diffs) {
      const out = new Uint8Array(OW * (2 * H + G)).fill(128);
      for (let k = 0; k < N; k++) {
        const f = d.frame - 2 + k;
        const exp = r.trace.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES);
        const g = got.get(f);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          if (exp.length) out[y * OW + k * (W + G) + x] = shade(exp[y * W + x]!);
          if (g) out[(H + G + y) * OW + k * (W + G) + x] = shade(g[y * W + x]!);
        }
      }
      const exp = (f: number) => r.trace.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES);
      const row = (a: Uint8Array | undefined, b: Uint8Array, y: number) => !!a && a.length > 0 && a.subarray(y * W, y * W + W).every((v, i) => v === b[y * W + i]);
      let cls = "";
      for (let y = 0; y < H; y++) {
        const e = exp(d.frame);
        cls += row(d.got, e, y) ? "=" : row(exp(d.frame - 1), e, y) ? "p" : row(got.get(d.frame - 1) ?? got.get(d.frame - 2), e, y) ? "q" : "x";
      }
      console.log(`f${d.frame} got-keys ${[-2, -1, 0, 1, 2].map((k) => got.has(d.frame + k) ? 1 : 0).join("")} wait ${r.trace.waitFrames.includes(d.frame - 1) ? "f-1" : ""} rows ${cls.replace(/(.)\1*/g, (m, c) => `${c}${m.length} `)}`);
      writeFileSync(`${dir}${name}_n${d.frame}.pgm`, Buffer.concat([Buffer.from(`P5 ${OW} ${2 * H + G} 255\n`), Buffer.from(out)]));
    }
    console.log(r.diffs.map((d) => d.frame).join(" "), "frames", r.trace.screens.length / FRAME_BYTES);
  });
});
