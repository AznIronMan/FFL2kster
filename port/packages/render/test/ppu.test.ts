/** PPU model vs emulator screenshots: rendering the captured VRAM/OAM/registers of every map
 *  capture must reproduce the screenshot exactly. */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Ppu } from "../src/index.js";

const DIR = resolve(__dirname, "../../../../build/golden/field");

describe.skipIf(!existsSync(DIR))("PPU parity with captures", () => {
  const caps = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")) : [];
  it("renders all captures exactly", () => {
    const bad: string[] = [];
    for (const f of caps) {
      const k = f.slice(0, 4);
      const g = JSON.parse(readFileSync(resolve(DIR, f), "utf8"));
      const ppu = new Ppu();
      ppu.vram.set(readFileSync(resolve(DIR, `${k}.vram`)));
      ppu.oam.set(g.oam);
      const [lcdc, scy, scx, wy, wx, bgp, obp0] = g.regs;
      ppu.regs = { lcdc, scy, scx, wy, wx, bgp, obp0, obp1: obp0 };
      const out = ppu.render();
      const exp = Buffer.from(g.screen, "hex");
      let diff = 0;
      for (let i = 0; i < out.length; i++) if (out[i] !== exp[i]) diff++;
      if (diff) bad.push(`${k}:${diff}`);
    }
    // 4800 (player outside the map) and 634c (battle data in the buffer) are invalid captures
    expect(bad.map((b) => b.slice(0, 4))).toEqual(["4800", "634c"]);
    expect(caps.length).toBe(212);
  });
});
