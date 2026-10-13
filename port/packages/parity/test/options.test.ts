/** P5 extras: every option is off by default, and "off" is the original (the parity suites run
 *  with the defaults); the engine-level options change only what they say when on. */
import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, CAP_BREAK_PATCHES, Game } from "@ffl2k/core";
import { haveRom, haveTrace, loadRom, loadTrace, Rig } from "../src/index.js";

describe("options", () => {
  it("are all off by default", () => {
    expect(Object.values(DEFAULT_OPTIONS).every((v) => v === false)).toBe(true);
    expect(new Game({}).options).toEqual(DEFAULT_OPTIONS);
  });

  it.skipIf(!haveRom())("cap break patches the bank-0C limits only while on", () => {
    const rig = new Rig(loadRom());
    const seg = () => rig.g.m.segments["0c"]!;
    const before = seg().slice();
    rig.engine.setOptions({ capBreak: true });
    for (const [addr, from, to] of CAP_BREAK_PATCHES) {
      expect([...before.subarray(addr - 0x4000, addr - 0x4000 + from.length)]).toEqual([...from]);
      expect([...seg().subarray(addr - 0x4000, addr - 0x4000 + to.length)]).toEqual([...to]);
    }
    expect(seg().filter((b, i) => b !== before[i]).length).toBe(6);
    rig.engine.setOptions({ capBreak: false });
    expect(seg()).toEqual(before);
  });

  /** A field message (sw_s1_005: field message 5 queued at the first town) printed with and
   *  without fast text: same characters, far fewer frames. */
  it.skipIf(!haveRom() || !haveTrace("sw_s1_005"))("fast text prints the same message in fewer frames", () => {
    const run = (fast: boolean) => {
      const t = loadTrace("sw_s1_005");
      const rig = new Rig(loadRom());
      rig.g.m.loadFull(t.start);
      rig.engine.setOptions({ fastText: fast });
      rig.g.start(rig.engine.field.loop());
      let last = 0, frames = 0, prev = rig.g.m.rd(0xc7a1);
      for (let f = 0; f < 600; f++) {
        rig.g.buttons = 0;
        rig.g.runFrame();
        const c = rig.g.m.rd(0xc7a1);
        if (c !== prev) { last = f; prev = c; frames++; }
      }
      return { last, chars: rig.g.m.rd(0xc7a1), screen: rig.ppu.frame.slice() };
    };
    const slow = run(false), fast = run(true);
    expect(fast.chars).toBe(slow.chars);
    expect(fast.last).toBeLessThan(slow.last / 2);
    expect(fast.screen).toEqual(slow.screen); // the finished window looks the same
  });
});
