/** Diagnostic: screen alignment between engine frames and trace frames. */
import { it } from "vitest";
import { field } from "@ffl2k/core";
import { Rig, loadRom, haveRom, haveTrace, loadTrace, buttonBits, screenDiff, FRAME_BYTES } from "../src/index.js";

it.skipIf(!haveRom() || !haveTrace("walk1") || !process.env.ALIGN)("alignment", () => {
  const t = loadTrace(process.env.ALIGN!);
  const rom = loadRom();
  const rig = new Rig(rom);
  rig.g.m.loadFull(t.start);
  const no = function* (): Generator<void, void, void> { throw new Error("x"); };
  const fe = new field.FieldEngine(rig.g, rom, { script: no, startMenu: no, selectMenu: no, event4: no });
  rig.g.start(fe.loop());
  const n = t.meta.frames.length;
  const shots: Uint8Array[] = [];
  for (let j = 0; j < n + 3; j++) {
    rig.g.buttons = buttonBits(t.meta.frames[Math.min(j, n - 1)]!.btn);
    rig.g.runFrame();
    shots.push(rig.ppu.frame.slice());
  }
  for (const off of [-1, 0, 1, 2, 3]) {
    const bad: number[] = [];
    for (let k = 0; k < n; k++) {
      const e = k + off;
      if (e < 0 || e >= shots.length) continue;
      if (screenDiff(shots[e]!, t.screens.subarray(k * FRAME_BYTES, (k + 1) * FRAME_BYTES))) bad.push(k);
    }
    console.log(`offset ${off}: ${bad.length} bad, first ${bad.slice(0, 10).join(",")}`);
  }
});
