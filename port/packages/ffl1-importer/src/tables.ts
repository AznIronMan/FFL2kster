/** Legend I tables (monsters, items, encounters, meat). Mirrors src/ffl1kster/schema/{monsters,items,
 *  encounters,meat}.py field for field; the golden test compares with ffl1/data/*.json. Addresses
 *  and layouts were derived from the Legend I ROM (docs/ffl1/FINDINGS.md), not from Legend II. */
import { fileOffset, bankAddress, u16 } from "./rom.js";
import { decodeName } from "./text.js";

const NAMES = fileOffset(0x05, 0x4000);
const MON_TABLE = fileOffset(0x06, 0x6ae8);
const HP_CLASSES = fileOffset(0x06, 0x7254);
const GP_TABLE = fileOffset(0x06, 0x72a4);
const NIBBLES = fileOffset(0x06, 0x71f0);
export const MONSTER_COUNT = 200;

const trimName = (rom: Uint8Array, o: number, n: number) => decodeName(rom.subarray(o, o + n)).replace(/\s+$/, "");

export const monsterName = (rom: Uint8Array, id: number): string => trimName(rom, NAMES + 8 * id, 8);
export const baseHp = (rom: Uint8Array, cls: number): number => u16(rom, HP_CLASSES + 2 * cls);
/** BCD GP reward (hi, lo). */
export const gpReward = (rom: Uint8Array, cls: number): number => {
  const h = rom[GP_TABLE + 2 * cls]!, l = rom[GP_TABLE + 2 * cls + 1]!;
  return Number(h.toString(16).padStart(2, "0") + l.toString(16).padStart(2, "0"));
};

export interface MonsterFields {
  class_bits: number; ability_count_minus1: number; meat_chance: number; hp_class: number;
  str: number; def: number; agl: number; mana: number; ability_index: number; gp_class: number; ability_ptr: number;
}
export interface Monster {
  id: number; name: string; name_offset: number; bank: number; address: number; fields: MonsterFields;
  base_hp: number; gp: number; nibble: number; ability_offset: number; abilities: number[];
}

export function monsterFields(rom: Uint8Array, id: number): MonsterFields {
  const o = MON_TABLE + 9 * id;
  const b0 = rom[o]!, b6 = rom[o + 6]!;
  return {
    class_bits: b0 >> 6, ability_count_minus1: (b0 >> 3) & 7, meat_chance: b0 & 7, hp_class: rom[o + 1]!,
    str: rom[o + 2]!, def: rom[o + 3]!, agl: rom[o + 4]!, mana: rom[o + 5]!,
    ability_index: b6 >> 4, gp_class: b6 & 15, ability_ptr: u16(rom, o + 7),
  };
}

export function monsters(rom: Uint8Array): Monster[] {
  return Array.from({ length: MONSTER_COUNT }, (_, id) => {
    const off = MON_TABLE + 9 * id;
    const [bank, address] = bankAddress(off);
    const f = monsterFields(rom, id);
    const ab = fileOffset(0x06, f.ability_ptr);
    const nb = rom[NIBBLES + (id >> 1)]!;
    return {
      id, name: monsterName(rom, id), name_offset: NAMES + 8 * id, bank, address, fields: f,
      base_hp: baseHp(rom, f.hp_class), gp: gpReward(rom, f.gp_class), nibble: id % 2 === 0 ? nb >> 4 : nb & 15,
      ability_offset: ab, abilities: Array.from(rom.subarray(ab, ab + f.ability_count_minus1 + 1)),
    };
  });
}

const ITEM_TABLE = fileOffset(0x06, 0x7700);
const ITEM_NAMES = NAMES + 8 * 200;
export const ITEM_FIELDS = ["kind", "flags", "handler", "uses", "power", "param", "unknown_6", "unknown_7"] as const;
export type ItemFields = Record<(typeof ITEM_FIELDS)[number] | "default_uses", number>;
export interface Item { id: number; name: string; record_offset: number; bank: number; address: number; name_offset: number; fields: ItemFields }

export const itemName = (rom: Uint8Array, id: number): string => trimName(rom, ITEM_NAMES + 8 * id, 7);

export function items(rom: Uint8Array): Item[] {
  return Array.from({ length: 256 }, (_, id) => {
    const off = ITEM_TABLE + 8 * id;
    const [bank, address] = bankAddress(off);
    const fields = {} as ItemFields;
    ITEM_FIELDS.forEach((k, i) => { fields[k] = rom[off + i]!; });
    fields.default_uses = rom[ITEM_NAMES + 8 * id + 7]!;
    return { id, name: itemName(rom, id), record_offset: off, bank, address, name_offset: ITEM_NAMES + 8 * id, fields };
  });
}

const ZONES = fileOffset(0x06, 0x6400);
const AREAS = fileOffset(0x06, 0x6868);
const FORMATIONS = fileOffset(0x06, 0x72c4);
export const SLOT_THRESHOLDS = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x00];

export interface Zone { id: number; rate: number; areas: number[] }
export interface Area { id: number; monsters: number[]; formation: number; alt_formation: number }

export const zone = (rom: Uint8Array, z: number): Zone => {
  const o = ZONES + 8 * z;
  return { id: z, rate: rom[o]!, areas: Array.from(rom.subarray(o + 1, o + 8)) };
};
export const area = (rom: Uint8Array, a: number): Area => {
  const o = AREAS + 5 * a;
  return { id: a, monsters: Array.from(rom.subarray(o, o + 3)), formation: rom[o + 3]!, alt_formation: rom[o + 4]! };
};
export const formation = (rom: Uint8Array, f: number): [number, number][] =>
  Array.from(rom.subarray(FORMATIONS + 3 * f, FORMATIONS + 3 * f + 3), (b) => [b >> 4, b & 15]);

export function slotWeights(): number[] {
  let prev = 256;
  return SLOT_THRESHOLDS.map((t) => { const w = (prev - t) / 256; prev = t; return w; });
}

/** Groups of an encounter area id (bit 7 = alternate formation). */
export function encounterGroups(rom: Uint8Array, areaId: number): { monster: number; min: number; max: number }[] {
  const a = area(rom, areaId & 0x7f);
  const f = ((areaId & 0x80 ? a.alt_formation : a.formation) & 0x1f);
  const fm = formation(rom, f);
  return a.monsters.map((m, k) => ({ monster: m, min: fm[k]![0], max: fm[k]![1] }));
}

export function encounters(rom: Uint8Array) {
  return {
    zones: Array.from({ length: 141 }, (_, z) => zone(rom, z)),
    areas: Array.from({ length: 128 }, (_, a) => area(rom, a)),
    formations: Array.from({ length: 31 }, (_, f) => formation(rom, f)),
    slot_weights: slotWeights(),
  };
}

const FAMILY_BYTES = fileOffset(0x02, 0x7900);
const GROUP_STARTS = 0x0e16;
const RESULTS = fileOffset(0x02, 0x6fd3);
const FAMILY_LEVELS = fileOffset(0x02, 0x72a8);
const LEVELS = fileOffset(0x02, 0x7438);
export const MEAT_ROWS = 25, MEAT_COLS = 29;

export const meatFamily = (rom: Uint8Array, id: number): number => {
  const b = rom[FAMILY_BYTES + id]!;
  return rom[GROUP_STARTS + ((b >> 4) & 7)]! + (b & 15);
};
export const meatLevel = (rom: Uint8Array, id: number): number => rom[LEVELS + id]! & 15;
export const resultFamily = (rom: Uint8Array, eater: number, meat: number): number => rom[RESULTS + MEAT_COLS * eater + meat]!;
export const familyMonster = (rom: Uint8Array, fam: number, lvl: number): number => rom[FAMILY_LEVELS + 16 * fam + lvl]!;

/** Monster the eater becomes, or null ("Nothing happened"). */
export function predictMeat(rom: Uint8Array, eater: number, meat: number): number | null {
  const r = resultFamily(rom, meatFamily(rom, eater), meatFamily(rom, meat));
  return r === 0xff ? null : familyMonster(rom, r, Math.max(meatLevel(rom, eater), meatLevel(rom, meat)));
}

export function meat(rom: Uint8Array) {
  const ids = Array.from({ length: 200 }, (_, i) => i);
  return {
    families: ids.map((i) => meatFamily(rom, i)),
    levels: ids.map((i) => meatLevel(rom, i)),
    results: Array.from({ length: MEAT_ROWS }, (_, e) => Array.from({ length: MEAT_COLS }, (_, m) => resultFamily(rom, e, m))),
    family_levels: Array.from({ length: MEAT_ROWS }, (_, f) => Array.from({ length: 16 }, (_, l) => familyMonster(rom, f, l))),
  };
}
