/** End-to-end importer: builds the full data package from the user's ROM (skipped without it). */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importRom, PACKAGE_FORMAT } from "../src/index.js";

const ROOT = resolve(__dirname, "../../../..");
const ROM_PATH = process.env.FFL2K_ROM ?? resolve(ROOT, "input/original.gb");

describe.skipIf(!existsSync(ROM_PATH))("importRom", () => {
  it("builds a storable package with every domain", async () => {
    const steps: string[] = [];
    const pkg = await importRom(new Uint8Array(readFileSync(ROM_PATH)), (s) => steps.push(s));
    expect(pkg.format).toBe(PACKAGE_FORMAT);
    expect(steps).toHaveLength(10);
    expect(pkg.monsters).toHaveLength(256);
    expect(pkg.text).toHaveLength(906);
    expect(Object.keys(pkg.maps.headers)).toHaveLength(212);
    expect(Object.keys(pkg.gfx.tilesets)).toHaveLength(61);
    expect(pkg.gfx.monsters[120]).toMatchObject({ w: 6, h: 6 });
    expect(pkg.music.sequences).toHaveLength(19);
    // IndexedDB stores via structured clone: the package must survive it unchanged
    const clone = structuredClone(pkg);
    expect(clone.segments["0c"]).toEqual(pkg.segments["0c"]);
    expect(clone.listings.calcVm).toBe(pkg.listings.calcVm);
  });

  it("refuses a modified ROM", async () => {
    const b = new Uint8Array(readFileSync(ROM_PATH));
    b[0x36f82] ^= 1;
    await expect(importRom(b)).rejects.toThrow(/unsupported ROM revision/);
  });

  it("imports a modified ROM in the unverified mode when asked", async () => {
    const b = new Uint8Array(readFileSync(ROM_PATH));
    b[0x36f82] ^= 1;
    const pkg = await importRom(b, () => {}, { unverified: true });
    expect(pkg.verified).toBe(false);
    expect(pkg.monsters.length).toBe(256);
  });
});
