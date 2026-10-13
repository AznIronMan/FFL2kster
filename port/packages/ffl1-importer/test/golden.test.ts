/** Golden tests: the Legend I TypeScript importer must reproduce the Python reference toolkit's
 *  output (ffl1/data from `python -m ffl1kster export-all`, ffl1/build/golden from
 *  tools/ffl1/golden_export.py). ROM-dependent: skipped without the player's ROM (e.g. in CI). */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  checkFfl1Rom, monsters, items, encounters, meat, exportText, exportMaps, exportMusic, font, tileset, spriteSet, picture,
  predictMeat, encounterGroups, importFfl1Rom, TILESET_COUNT, SPRITE_SET_COUNT,
} from "../src/index.js";

const ROOT = resolve(__dirname, "../../../..");
const ROM_PATH = process.env.FFL1K_ROM ?? resolve(ROOT, "ffl1/input/original.gb");
const DATA = resolve(ROOT, "ffl1/data");
const HAVE = existsSync(ROM_PATH) && existsSync(resolve(DATA, "monsters.json"));
const json = (p: string) => JSON.parse(readFileSync(resolve(DATA, p), "utf8"));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const body = (o: Record<string, unknown>) => { const c = { ...o }; delete c.game; delete c.source_sha256; delete c.fields; return c; };

describe.skipIf(!HAVE)("FFL1 importer golden (needs the player's ROM and ffl1/data)", () => {
  const rom = HAVE ? new Uint8Array(readFileSync(ROM_PATH)) : new Uint8Array();

  it("accepts the verified Legend I ROM", async () => {
    const c = await checkFfl1Rom(rom);
    expect(c).toMatchObject({ ok: true, title: "SAGA", warnings: [] });
  });

  it("monsters and items", () => {
    expect(plain(monsters(rom))).toEqual(json("monsters.json").records);
    expect(plain(items(rom))).toEqual(json("items.json").records);
  });

  it("encounters and meat", () => {
    expect(plain(encounters(rom))).toEqual(body(json("encounters.json")));
    expect(plain(meat(rom))).toEqual(body(json("meat.json")));
  });

  it("text (battle, ui, dialogue tables)", () => {
    expect(plain(exportText(rom))).toEqual(body(json("text.json")));
  });

  it("maps, events, warps, shops, prices, decoded layouts, attributes", () => {
    const ts = plain(exportMaps(rom));
    const py = body(json("maps.json"));
    expect(Object.keys(ts).sort()).toEqual(Object.keys(py).sort());
    for (const k of Object.keys(py)) expect(ts[k], k).toEqual(py[k]);
  });

  it("music sequences", () => {
    expect(plain(exportMusic(rom))).toEqual(body(json("music.json")));
  });

  const GOLD = resolve(ROOT, "ffl1/build/golden/golden.json");
  it.skipIf(!existsSync(GOLD))("graphics bytes equal the Python reference", () => {
    const g = JSON.parse(readFileSync(GOLD, "utf8"));
    expect(sha(font(rom))).toBe(g.font);
    expect(Array.from({ length: TILESET_COUNT }, (_, s) => sha(tileset(rom, s)))).toEqual(g.tilesets);
    expect(Array.from({ length: SPRITE_SET_COUNT }, (_, s) => sha(spriteSet(rom, s)))).toEqual(g.sprite_sets);
    expect(Array.from({ length: 200 }, (_, m) => sha(picture(rom, m).data))).toEqual(g.pictures);
    const pics = json("graphics/pictures.json").pictures;
    expect(Array.from({ length: 200 }, (_, m) => { const p = picture(rom, m); return { class: p.class, index: p.index, tiles: p.tiles, width: p.width }; })).toEqual(pics);
  });

  it("emulator-verified facts hold (CLIPPER eats ASIGARU -> LIZARD; area 19 groups)", () => {
    const names = monsters(rom).map((m) => m.name);
    expect(names[predictMeat(rom, 18, 155)!]).toBe("LIZARD");
    expect(encounterGroups(rom, 19)[2]!.monster).toBe(155);
  });

  it("builds a data package with 8 segments", async () => {
    const steps: string[] = [];
    const pkg = await importFfl1Rom(rom, (s) => steps.push(s));
    expect(pkg).toMatchObject({ game: "FFL1", verified: true });
    expect(Object.keys(pkg.segments)).toEqual(["00", "01", "02", "03", "04", "05", "06", "07"]);
    expect(steps).toHaveLength(7);
  });
});

describe("FFL1 importer without a ROM", () => {
  it("rejects an unknown file but allows the unverified mode for a 128 KiB file", async () => {
    const c = await checkFfl1Rom(new Uint8Array(0x20000));
    expect(c.ok).toBe(false);
    expect(c.canOverride).toBe(true);
    expect(c.warnings.join(" ")).toMatch(/internal name/);
    await expect(importFfl1Rom(new Uint8Array(0x20000))).rejects.toThrow(/rejected/);
  });
  it("refuses the unverified mode for a file too small to hold Legend I", async () => {
    const c = await checkFfl1Rom(new Uint8Array(0x8000));
    expect(c.canOverride).toBe(false);
  });
});
