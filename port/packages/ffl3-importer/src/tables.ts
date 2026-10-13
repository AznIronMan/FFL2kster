/** Legend III record tables (docs/ffl3/FINDINGS.md M1-M5): field layouts mirror the Python schema
 *  (ffl3kster.schema.*), which carries the meanings, status and evidence. Records come out as the
 *  data package's {id, name, bank, address, fields}. */
import { fileOffset, bankAddress, u16, hex } from "./rom.js";
import { decodeName, rstrip } from "./text.js";

export type Encoding = "u8" | "u12" | "nibble:hi" | "nibble:lo" | `bits:${number}-${number}`;
export type Field = [name: string, offset: number, encoding: Encoding];

export interface TableDef {
  domain: string;
  bank: number;
  address: number;
  size: number;
  count: number;
  idBase: number;
  fields: Field[];
  name(rom: Uint8Array, id: number): string;
}

export interface TableRecord { id: number; name: string; bank: number; address: number; fields: Record<string, number> }

export function readField(rom: Uint8Array, o: number, enc: Encoding): number {
  if (enc === "u12") return rom[o]! | ((rom[o + 1]! & 0x0f) << 8);
  const raw = rom[o]!;
  if (enc === "nibble:hi") return raw >> 4;
  if (enc === "nibble:lo") return raw & 0x0f;
  if (enc.startsWith("bits:")) {
    const [lo, hi] = enc.slice(5).split("-").map(Number) as [number, number];
    return (raw >> lo) & ((1 << (hi - lo + 1)) - 1);
  }
  return raw;
}

function fieldsAt(rom: Uint8Array, off: number, fields: Field[]): Record<string, number> {
  return Object.fromEntries(fields.map(([n, o, e]) => [n, readField(rom, off + o, e)]));
}

export function recordOffset(t: TableDef, id: number): number {
  if (id < t.idBase || id >= t.idBase + t.count) throw new Error(`${t.domain} id ${id} out of range`);
  return fileOffset(t.bank, t.address) + t.size * (id - t.idBase);
}

export function extract(rom: Uint8Array, t: TableDef): TableRecord[] {
  return Array.from({ length: t.count }, (_, k) => {
    const id = t.idBase + k, off = recordOffset(t, id);
    const [bank, address] = bankAddress(off);
    return { id, name: t.name(rom, id), bank, address, fields: fieldsAt(rom, off, t.fields) };
  });
}

const u8s = (names: string[], from = 0): Field[] => names.map((n, i) => [n, from + i, "u8"]);
const range = (p: string, a: number, b: number, from: number): Field[] =>
  Array.from({ length: b - a + 1 }, (_, i) => [`${p}${a + i}`, from + i, "u8"] as Field);

// --- monsters (bank 0B) ------------------------------------------------------------------------
export const MONSTER_COUNT = 195;
const MONSTER_NAMES = fileOffset(0x0e, 0x7533);
export const monsterName = (rom: Uint8Array, id: number): string =>
  rstrip(decodeName(rom.subarray(MONSTER_NAMES + 8 * id, MONSTER_NAMES + 8 * id + 8)));

export const MONSTER: TableDef = { domain: "monster", bank: 0x0b, address: 0x4a19, size: 12, count: MONSTER_COUNT, idBase: 0,
  name: monsterName, fields: [["kind", 0, "bits:0-2"], ["b0_high", 0, "bits:3-7"], ["hp", 1, "u12"], ["profile_a", 2, "nibble:hi"],
    ["mp", 3, "u12"], ["profile_b", 4, "nibble:hi"], ...u8s(["attack", "defence", "agility", "magic"], 5),
    ...range("bonus", 1, 3, 9)] };
export const MONSTER_CLASS: TableDef = { domain: "monster_class", bank: 0x0b, address: 0x470d, size: 4, count: MONSTER_COUNT, idBase: 0,
  name: monsterName, fields: [["level", 0, "bits:0-5"], ["class_bits", 0, "bits:6-7"], ["exp", 1, "u8"], ["c2", 2, "u8"], ["c3", 3, "u8"]] };
export const MONSTER_ABILITY: TableDef = { domain: "monster_ability", bank: 0x0b, address: 0x533d, size: 9, count: MONSTER_COUNT, idBase: 0,
  name: monsterName, fields: [["mask", 0, "u8"], ...range("slot", 1, 8, 1)] };
/** Monster ids >= BB have HP and MP x16 (0B:45AB). */
export const BOSS_FROM = 0xbb;

// --- items, spells, skills (bank 09; names bank 0E) --------------------------------------------
const SPELL_NAMES = fileOffset(0x0e, 0x6d9b), ITEM_NAMES = fileOffset(0x0e, 0x6ebb), SKILL_NAMES = fileOffset(0x09, 0x67f7);
const STATUS_NAMES = fileOffset(0x0e, 0x6d73), RACE_NAMES = fileOffset(0x0e, 0x6d4f);

export function itemName(rom: Uint8Array, id: number): string {
  if (id === 0xff) return "";
  if (id < 0x30) { const o = SPELL_NAMES + 6 * id; return rstrip(decodeName(rom.subarray(o + 1, o + 6))); }
  const o = ITEM_NAMES + 8 * (id - 0x30);
  return rstrip(decodeName(rom.subarray(o + 1, o + 8)));
}
export const itemIcon = (rom: Uint8Array, id: number): number => id < 0x30 ? rom[SPELL_NAMES + 6 * id]! : rom[ITEM_NAMES + 8 * (id - 0x30)]!;
export const skillName = (rom: Uint8Array, id: number): string =>
  rstrip(decodeName(rom.subarray(SKILL_NAMES + 8 * id, SKILL_NAMES + 8 * id + 8)));
export const statusNames = (rom: Uint8Array): string[] =>
  Array.from({ length: 10 }, (_, i) => rstrip(decodeName(rom.subarray(STATUS_NAMES + 4 * i, STATUS_NAMES + 4 * i + 4))));
export const raceNames = (rom: Uint8Array): string[] =>
  Array.from({ length: 6 }, (_, i) => rstrip(decodeName(rom.subarray(RACE_NAMES + 6 * i, RACE_NAMES + 6 * i + 6))));

export const SPELL: TableDef = { domain: "spell", bank: 0x09, address: 0x5a50, size: 6, count: 0x30, idBase: 0, name: itemName,
  fields: [...u8s(["attribute", "power"]), ...range("b", 2, 5, 2)] };
export const WEAPON: TableDef = { domain: "weapon", bank: 0x09, address: 0x55c4, size: 7, count: 0x48, idBase: 0x30, name: itemName,
  fields: u8s(["attribute", "power", "b2", "b3", "family", "spell", "grade"]) };
export const ARMOR: TableDef = { domain: "armor", bank: 0x09, address: 0x5bfc, size: 5, count: 0x48, idBase: 0x78, name: itemName,
  fields: [["resist_element", 0, "nibble:hi"], ["resist_status", 0, "nibble:lo"], ["defence", 1, "nibble:hi"], ["m_def", 1, "nibble:lo"],
    ["evade", 2, "nibble:hi"], ["m_evade", 2, "nibble:lo"], ["linked", 3, "u8"], ["weight", 4, "u8"]] };
export const ITEM: TableDef = { domain: "item", bank: 0x09, address: 0x5b70, size: 5, count: 0x1c, idBase: 0xc0, name: itemName,
  fields: [...u8s(["attribute", "power"]), ...range("b", 2, 4, 2)] };
export const SKILL: TableDef = { domain: "skill", bank: 0x09, address: 0x57bc, size: 6, count: 0x6e, idBase: 0, name: skillName,
  fields: [...u8s(["attribute", "power"]), ...range("b", 2, 5, 2)] };

// --- encounters --------------------------------------------------------------------------------
const FORMATIONS = fileOffset(0x0b, 0x758b);
export const ZONE: TableDef = { domain: "zone", bank: 0x03, address: 0x76c2, size: 7, count: 76, idBase: 0,
  name: (_r, z) => `zone ${z}`, fields: range("slot", 0, 6, 0) };
export const FORMATION: TableDef = { domain: "formation", bank: 0x0b, address: 0x758b, size: 5, count: 0x7f, idBase: 0,
  name: (rom, f) => Array.from(rom.subarray(FORMATIONS + 5 * f, FORMATIONS + 5 * f + 3)).filter((i) => i !== 0xff).map((i) => monsterName(rom, i)).join(" + "),
  fields: u8s(["monster1", "monster2", "monster3", "flags", "counts"]) };
/** 03:76BC: a roll r picks slot k = number of thresholds above r (slot 0 for r >= E5 .. slot 6 for r < 0C). */
export const THRESHOLDS = fileOffset(0x03, 0x76bc);
/** 00:119A: steps encounter when rand < RATES[rate class]. */
export const RATES = 0x119a;
export const encounterSlot = (rom: Uint8Array, roll: number): number =>
  Array.from(rom.subarray(THRESHOLDS, THRESHOLDS + 6)).filter((t) => t > roll).length;

// --- maps (bank 06) and shops (bank 01) --------------------------------------------------------
export const MAP_COUNT = 192;
const MAPS = fileOffset(0x06, 0x6c58), WARPS = fileOffset(0x06, 0x6308), DOORS_ADDR = 0x6ba4;
export const MAP_FIELDS: Field[] = [["b0", 0, "u8"], ["layout", 1, "u8"], ["b2", 2, "u8"], ["mode", 3, "u8"], ["music", 4, "bits:0-4"],
  ["encounter_rate", 4, "bits:5-7"], ["encounter_zone", 5, "u8"]];
export const OBJECT_FIELDS: Field[] = [["flag", 0, "u8"], ["param", 1, "u8"], ["x", 2, "bits:0-5"], ["y", 3, "bits:0-5"],
  ["type", 4, "bits:6-7"], ["sprite", 5, "u8"]];

export function mapPointer(rom: Uint8Array, m: number): number {
  if (m < 0 || m >= MAP_COUNT) throw new Error(`map ${m} out of range 0..${MAP_COUNT - 1}`);
  return u16(rom, MAPS + 2 * m);
}
export const mapOffset = (rom: Uint8Array, m: number): number => fileOffset(0x06, mapPointer(rom, m));

export function mapObjects(rom: Uint8Array, m: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let o = mapOffset(rom, m) + 6; rom[o] !== 0xff; o += 6) out.push(rom.slice(o, o + 6));
  return out;
}

export function mapWarps(rom: Uint8Array, m: number): Uint8Array[] {
  const ptrs = [...new Set(Array.from({ length: MAP_COUNT }, (_, i) => u16(rom, WARPS + 2 * i)))].sort((a, b) => a - b);
  const p = u16(rom, WARPS + 2 * m);
  const end = ptrs.find((q) => q > p) ?? DOORS_ADDR;
  const o = fileOffset(0x06, p);
  return Array.from({ length: Math.floor((end - p) / 4) }, (_, k) => rom.slice(o + 4 * k, o + 4 * k + 4));
}

export const mapHeader = (rom: Uint8Array, m: number): Record<string, number> => fieldsAt(rom, mapOffset(rom, m), MAP_FIELDS);
export const objectFields = (o: Uint8Array): Record<string, number> => fieldsAt(o, 0, OBJECT_FIELDS);

export const DOOR: TableDef = { domain: "door", bank: 0x06, address: DOORS_ADDR, size: 3, count: 60, idBase: 1,
  name: (rom, n) => `door ${hex(n)} -> map ${hex(rom[fileOffset(0x06, DOORS_ADDR) + 3 * (n - 1)]!)}`, fields: u8s(["map", "x", "y"]) };
const shop = (domain: string, address: number, count: number, idBase: number): TableDef => ({ domain, bank: 0x01, address, size: 6, count, idBase,
  name: (_r, n) => `shop ${hex(n)}`, fields: range("item", 1, 6, 0) });
export const SHOP_WEAPON = shop("shop_weapon", 0x780c, 15, 0x00);
export const SHOP_ARMOR = shop("shop_armor", 0x7866, 15, 0x10);
export const SHOP_ITEM = shop("shop_item", 0x78c0, 9, 0x20);
export const SHOP_MAGIC = shop("shop_magic", 0x78f6, 15, 0x30);

const spaced = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(" ");

export function mapRecords(rom: Uint8Array): TableRecord[] {
  return Array.from({ length: MAP_COUNT }, (_, m) => {
    const [bank, address] = bankAddress(mapOffset(rom, m));
    return { id: m, name: `map ${hex(m)}`, bank, address, fields: mapHeader(rom, m) };
  });
}

const group = (rom: Uint8Array, ts: TableDef[]) => Object.fromEntries(ts.map((t) => [t.domain, extract(rom, t)]));
export const monsters = (rom: Uint8Array) => group(rom, [MONSTER, MONSTER_CLASS, MONSTER_ABILITY]);
export const items = (rom: Uint8Array) => group(rom, [SPELL, WEAPON, ARMOR, ITEM, SKILL]);
export const encounters = (rom: Uint8Array) => group(rom, [ZONE, FORMATION]);
export function maps(rom: Uint8Array) {
  const ids = Array.from({ length: MAP_COUNT }, (_, m) => m);
  return {
    ...group(rom, [DOOR, SHOP_WEAPON, SHOP_ARMOR, SHOP_ITEM, SHOP_MAGIC]),
    map: mapRecords(rom),
    objects: Object.fromEntries(ids.map((m) => [hex(m), mapObjects(rom, m).map(spaced)])),
    warps: Object.fromEntries(ids.map((m) => [hex(m), mapWarps(rom, m).map(spaced)])),
  };
}
