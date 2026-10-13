/** Legend I maps, events, warps, shops and metatile attributes. Mirrors src/ffl1kster/schema/maps.py
 *  (map table 02:58D0, event lists bank 02, warps 02:52D0, shops 05:7D10, prices 05:7E10,
 *  attributes 02:4840). */
import { fileOffset, u16 } from "./rom.js";
import { decodeLayout } from "./layout.js";

const MAP_TABLE = fileOffset(0x02, 0x58d0);
export const MAP_COUNT = 200;
const WARPS = fileOffset(0x02, 0x52d0);
export const WARP_COUNT = 474;
const ATTRIBUTES = fileOffset(0x02, 0x4840);
const SHOPS = fileOffset(0x05, 0x7d10);
export const SHOP_COUNT = 25;
const PRICES = fileOffset(0x05, 0x7e10);
export const PRICE_COUNT = 128;
export const COMMANDS: Record<number, string> = { 0: "dialogue", 1: "dialogue", 2: "dialogue", 3: "chest", 4: "facility", 5: "warp", 6: "warp", 8: "battle" };

export type MapEvent =
  | { kind: "object"; flag: number; range: [number, number]; x: number; y: number; command: number; param: number; sprite: number }
  | { kind: "copy"; x: number; y: number; bits: number }
  | { kind: "bitflag"; flag: number; x: number; y: number; command: number; param: number; sprite: number };

export interface MapRecord {
  id: number; record_offset: number; b0: number; b1: number; graphics: number; attributes: number; layout: number;
  flags: number; b7: number; sprites?: number; events?: number; zones: (number | null)[]; length: number; event_list?: MapEvent[];
}

export const mapRecordOffset = (rom: Uint8Array, id: number): number => fileOffset(0x02, u16(rom, MAP_TABLE + 2 * id));

export function parseMapRecord(rom: Uint8Array, id: number): MapRecord {
  const o = mapRecordOffset(rom, id);
  let i = o;
  const r: MapRecord = { id, record_offset: o, b0: rom[i]!, b1: rom[i + 1]!, graphics: rom[i + 2]!, attributes: rom[i + 3]!,
    layout: u16(rom, i + 4), flags: rom[i + 6]!, b7: rom[i + 7]!, zones: [], length: 0 };
  i += 8;
  const B = r.flags;
  if (!(B & 0x80)) { r.sprites = rom[i]!; r.events = u16(rom, i + 1); i += 3; }
  for (const bit of [0x40, 0x20, 0x10]) {
    if (B & bit) r.zones.push(null); else r.zones.push(rom[i++]!);
  }
  r.length = i - o;
  return r;
}

export function parseEvents(rom: Uint8Array, pointer: number): MapEvent[] {
  const out: MapEvent[] = [];
  let i = fileOffset(0x02, pointer) + 1;
  while (rom[i] !== 0x81) {
    const b = rom[i]!;
    if (b === 0xff) {
      out.push({ kind: "bitflag", flag: rom[i + 1]!, x: rom[i + 2]!, y: rom[i + 3]!, command: rom[i + 4]!, param: rom[i + 5]!, sprite: rom[i + 6]! });
      i += 7;
    } else if (b & 0x80) {
      out.push({ kind: "copy", x: rom[i + 1]!, y: rom[i + 2]! & 0x3f, bits: rom[i + 2]! >> 6 });
      i += 3;
    } else {
      out.push({ kind: "object", flag: b, range: [rom[i + 1]! >> 4, rom[i + 1]! & 15], x: rom[i + 2]!, y: rom[i + 3]!,
        command: rom[i + 4]!, param: rom[i + 5]!, sprite: rom[i + 6]! });
      i += 7;
    }
  }
  return out;
}

export const warp = (rom: Uint8Array, n: number) => ({ id: n, map: rom[WARPS + 3 * n]!, x: rom[WARPS + 3 * n + 1]!, y: rom[WARPS + 3 * n + 2]! });
export const shop = (rom: Uint8Array, s: number): number[] =>
  Array.from(rom.subarray(SHOPS + 10 * s, SHOPS + 10 * (s + 1))).filter((b) => b !== 0xff);
/** BCD price (3 bytes) or null for ids without one (monster abilities, 0x80+). */
export function price(rom: Uint8Array, item: number): number | null {
  if (item >= PRICE_COUNT) return null;
  const o = PRICES + 3 * item;
  return Number(Array.from(rom.subarray(o, o + 3), (b) => b.toString(16).padStart(2, "0")).join(""));
}
/** Metatile attribute pairs (e, d) for the 32 metatiles of an attribute set. */
export const attributeSet = (rom: Uint8Array, set: number): [number, number][] =>
  Array.from({ length: 32 }, (_, t) => [rom[ATTRIBUTES + 64 * set + 2 * t]!, rom[ATTRIBUTES + 64 * set + 2 * t + 1]!]);

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");

export function exportMaps(rom: Uint8Array) {
  const maps = Array.from({ length: MAP_COUNT }, (_, id) => {
    const r = parseMapRecord(rom, id);
    if (r.events !== undefined) r.event_list = parseEvents(rom, r.events);
    return r;
  });
  const prices: Record<string, number | null> = {};
  for (let i = 0; i < PRICE_COUNT; i++) prices[String(i)] = price(rom, i);
  const layouts: Record<string, string[]> = {};
  for (const p of [...new Set(maps.map((m) => m.layout))].sort((a, b) => a - b)) {
    const s = hex(decodeLayout(rom, p));
    layouts[p.toString(16).toUpperCase().padStart(4, "0")] = Array.from({ length: 62 }, (_, y) => s.slice(128 * y, 128 * (y + 1)));
  }
  return {
    maps, warps: Array.from({ length: WARP_COUNT }, (_, n) => warp(rom, n)),
    shops: Array.from({ length: SHOP_COUNT }, (_, s) => shop(rom, s)), prices, layouts,
    attribute_sets: Array.from({ length: 40 }, (_, a) => attributeSet(rom, a)),
  };
}
