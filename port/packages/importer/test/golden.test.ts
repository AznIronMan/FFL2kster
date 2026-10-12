/** Golden tests: the TypeScript importer must reproduce the Python reference toolkit's output
 *  (data/ from `python -m ffl2kster export-all`, build/golden from tools/golden_export.py).
 *  ROM-dependent: skipped when the user's ROM is not available (e.g. in CI). */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  Rom, checkRom, monsters, items, encounters, exportText, exportEvents, exportScripts, exportRules, calcVmListing,
  exportMaps, songSummary, instruments, sfx, parseSong, toMidi, renderLayout, layoutOffset, header, vramBg, monsterGraphic,
} from "../src/index.js";

const ROOT = resolve(__dirname, "../../../..");
const ROM_PATH = process.env.FFL2K_ROM ?? resolve(ROOT, "input/original.gb");
const HAVE = existsSync(ROM_PATH);
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
const strip = <T extends Record<string, unknown>>(o: T, ...keys: string[]) => {
  const c = { ...o };
  for (const k of keys) delete c[k];
  return c;
};
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe.skipIf(!HAVE)("importer golden (needs the user's ROM)", () => {
  const bytes = HAVE ? new Uint8Array(readFileSync(ROM_PATH)) : new Uint8Array();
  const rom = new Rom(bytes);

  it("accepts the supported ROM", async () => {
    const c = await checkRom(bytes);
    expect(c.ok).toBe(true);
    expect(c.title).toBe("SAGA2");
  });

  it("monsters and items", () => {
    expect(plain(monsters(rom))).toEqual(json("data/monsters.json").records);
    expect(plain(items(rom))).toEqual(json("data/items.json").records);
  });

  it("encounters", () => {
    const names = new Map(monsters(rom).map((m) => [m.id, m.name]));
    expect(plain(encounters(rom, names))).toEqual(strip(json("data/encounters.json"), "source_sha256"));
  });

  it("text (906 entries, display form)", () => {
    expect(plain(exportText(bytes))).toEqual(json("data/text/messages.json").messages);
  });

  it("events and script listing", () => {
    expect(plain(exportEvents(rom))).toEqual(strip(json("data/events/events.json"), "source_sha256"));
    expect(exportScripts(rom)).toBe(readFileSync(resolve(ROOT, "data/events/scripts.txt"), "utf8"));
  });

  it("battle rule tables and calc-VM listing", () => {
    expect(plain(exportRules(rom))).toEqual(strip(json("data/battle/rules_tables.json"), "source_sha256"));
    const py = readFileSync(resolve(ROOT, "data/battle/calcvm_listing.txt"), "utf8");
    expect(calcVmListing(rom) + "\n").toBe(py.slice(py.indexOf("\n") + 1));
  });

  it("maps (headers, warps, objects, layout ops, tile attributes)", () => {
    const py = json("data/maps/maps.json");
    const ts = plain(exportMaps(rom));
    expect(ts.destinations).toEqual(py.destinations);
    expect(ts.tile_attributes).toEqual(py.tile_attributes);
    for (const [k, h] of Object.entries(py.headers as Record<string, Record<string, unknown>>)) expect(ts.headers[k]).toEqual(strip(h, "layout"));
  });

  it("music: summary, instruments, sfx, MIDI bytes", () => {
    const py = json("data/music/songs.json");
    expect(plain(songSummary(rom))).toEqual(py.songs);
    expect(plain(instruments(rom))).toEqual(py.instruments);
    expect(plain(sfx(rom))).toEqual(json("data/music/sfx.json").sfx);
    for (let n = 1; n <= 19; n++) {
      const midi = toMidi(parseSong(rom, n));
      expect(sha(midi)).toBe(sha(new Uint8Array(readFileSync(resolve(ROOT, `data/music/song_${String(n).padStart(2, "0")}.mid`)))));
    }
  });

  const GOLD = resolve(ROOT, "build/golden/golden.json");
  it.skipIf(!existsSync(GOLD))("layout renders and graphics match the Python reference", () => {
    const g = JSON.parse(readFileSync(GOLD, "utf8"));
    for (const L of g.layouts) {
      const hd = header(rom, parseInt(L.map, 16));
      const saved = new Uint8Array(256);
      const m = renderLayout(bytes, layoutOffset(hd.layout_ptr), { vars: L.vars, triggerCount: L.trigger_count, saved });
      expect(sha(m), L.map).toBe(L.sha256);
      expect(Buffer.from(saved).toString("hex")).toBe(L.saved);
    }
    for (const [t, h] of Object.entries(g.tilesets)) expect(sha(vramBg(rom, Number(t)))).toBe(h);
    for (const [id, [w, h, d]] of Object.entries(g.monsters as Record<string, [number, number, string]>)) {
      const m = monsterGraphic(rom, Number(id));
      expect([m.w, m.h, sha(m.tiles)]).toEqual([w, h, d]);
    }
  });
});

describe("importer without a ROM", () => {
  it("rejects an unknown file", async () => {
    const c = await checkRom(new Uint8Array(0x40000));
    expect(c.ok).toBe(false);
    expect(c.reason).toMatch(/unsupported/);
    expect(c.canOverride).toBe(true);
    expect(c.warnings.join(" ")).toMatch(/internal name/);
  });

  it("refuses a file too small for the game's layout, even unverified", async () => {
    const c = await checkRom(new Uint8Array(0x20000));
    expect(c.ok).toBe(false);
    expect(c.canOverride).toBe(false);
  });
});
