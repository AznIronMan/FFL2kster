/** Golden tests: the Legend III TypeScript importer must reproduce the Python reference toolkit's
 *  output (ffl3/data from `python -m ffl3kster export-all`, ffl3/build/golden from
 *  tools/ffl3/golden_export.py). ROM-dependent: skipped without the player's ROM (e.g. in CI). */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  checkFfl3Rom, monsters, items, encounters, maps, exportLayouts, exportText, exportMusic, font, mapTileset, pictures,
  tilemap, mapTiles, importFfl3Rom, encounterSlot, statusNames, itemName, MAP_COUNT, LAYOUT_COUNT, BOSS_FROM,
} from "../src/index.js";

const ROOT = resolve(__dirname, "../../../..");
const ROM_PATH = process.env.FFL3K_ROM ?? resolve(ROOT, "ffl3/input/original.gb");
const DATA = resolve(ROOT, "ffl3/data");
const HAVE = existsSync(ROM_PATH) && existsSync(resolve(DATA, "monsters.json"));
const json = (p: string) => JSON.parse(readFileSync(resolve(DATA, p), "utf8"));
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const records = (file: string) => Object.fromEntries(Object.entries(json(file).tables as Record<string, { records: unknown }>).map(([k, v]) => [k, v.records]));

describe.skipIf(!HAVE)("FFL3 importer golden (needs the player's ROM and ffl3/data)", () => {
  const rom = HAVE ? new Uint8Array(readFileSync(ROM_PATH)) : new Uint8Array();

  it("accepts the verified Legend III ROM", async () => {
    expect(await checkFfl3Rom(rom)).toMatchObject({ ok: true, title: "SAGA3", warnings: [] });
  });

  it("monsters, items, encounters (every record and field)", () => {
    expect(plain(monsters(rom))).toEqual(records("monsters.json"));
    expect(plain(items(rom))).toEqual(records("items.json"));
    expect(plain(encounters(rom))).toEqual(records("encounters.json"));
  });

  it("maps, objects, warps, doors, shops", () => {
    const ts = plain(maps(rom)), py = json("maps.json").tables;
    const { objects, warps, ...tables } = ts;
    expect(tables).toEqual(records("maps.json"));
    expect(objects).toEqual(py.map.objects);
    expect(warps).toEqual(py.map.warps);
  });

  it("layouts (decoded metatile rows) and flag patches", () => {
    const py = json("layouts.json");
    expect(plain(exportLayouts(rom))).toEqual({ layouts: py.layouts, patches: py.patches });
  });

  it("text (dictionary, regions, pointer tables, every script)", () => {
    const { game: _g, source_sha256: _s, ...py } = json("text.json");
    expect(plain(exportText(rom))).toEqual(py);
  });

  it("music (pointers, driver loops, channel streams)", () => {
    expect(plain(exportMusic(rom))).toEqual({ songs: json("music.json").songs });
  });

  const GOLD = resolve(ROOT, "ffl3/build/golden/golden.json");
  it.skipIf(!existsSync(GOLD))("graphics and map buffers equal the Python reference", () => {
    const g = JSON.parse(readFileSync(GOLD, "utf8"));
    expect(sha(font(rom))).toBe(g.font);
    expect(Array.from({ length: MAP_COUNT }, (_, m) => sha(mapTileset(rom, m)))).toEqual(g.tilesets);
    expect(Object.fromEntries(pictures(rom).map((p) => [String(p.id), sha(p.data)]))).toEqual(g.pictures);
    expect(Array.from({ length: LAYOUT_COUNT }, (_, n) => sha(tilemap(rom, n + 1)))).toEqual(g.tilemaps);
    const mapsWith = (flags: Uint8Array) => Array.from({ length: MAP_COUNT }, (_, m) => {
      try { const { tiles, width } = mapTiles(rom, m, flags); return [sha(tiles), width]; } catch { return null; }
    });
    expect(mapsWith(new Uint8Array(32))).toEqual(g.maps_no_flags);
    expect(mapsWith(new Uint8Array(32).fill(0xff))).toEqual(g.maps_all_flags);
  });

  it("emulator-verified facts hold", () => {
    const mons = monsters(rom).monster!;
    expect(mons[0x46]!.name).toBe("Diviner");
    expect(mons[0x4b]!.name).toBe("Sprite");
    expect(BOSS_FROM).toBe(0xbb);
    expect(statusNames(rom)[5]).toBe("Pois");
    expect(itemName(rom, 0x30)).toBe("Long");
    expect([0xff, 0xe5, 0xe4, 0x0c, 0x0b, 0x00].map((r) => encounterSlot(rom, r))).toEqual([0, 0, 1, 5, 6, 6]);
    expect(encounters(rom).formation![0]!.name).toBe("Hooligan + F-Drake");
  });

  it("builds a data package with 16 segments", async () => {
    const steps: string[] = [];
    const pkg = await importFfl3Rom(rom, (s) => steps.push(s));
    expect(pkg).toMatchObject({ game: "FFL3", verified: true });
    expect(Object.keys(pkg.segments)).toEqual(Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(2, "0")));
    expect(pkg.gfx.tilesets).toHaveLength(MAP_COUNT);
    expect(pkg.gfx.pictures.length).toBeGreaterThan(180);
    expect(steps).toHaveLength(7);
  });
});

describe("FFL3 importer without a ROM", () => {
  it("rejects an unknown file but allows the unverified mode for a 256 KiB file", async () => {
    const c = await checkFfl3Rom(new Uint8Array(0x40000));
    expect(c.ok).toBe(false);
    expect(c.canOverride).toBe(true);
    expect(c.warnings.join(" ")).toMatch(/internal name/);
    await expect(importFfl3Rom(new Uint8Array(0x40000))).rejects.toThrow(/rejected/);
  });
  it("refuses the unverified mode for a file too small to hold Legend III", async () => {
    expect((await checkFfl3Rom(new Uint8Array(0x20000))).canOverride).toBe(false);
  });
});
