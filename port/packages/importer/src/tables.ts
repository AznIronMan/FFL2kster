/** Monsters, items and encounter tables (ports of ffl2kster.schema.enemies/items/encounters). */
import { Rom } from "./rom.js";
import { decodeName } from "./text.js";

const TYPES: Record<number, string> = { 0: "human", 1: "mutant", 2: "monster", 3: "robot" };

export interface Ability { id: number; name: string }
export interface Monster {
  id: number;
  name: string;
  name_offset: number;
  record_offset: number;
  bank: number;
  address: number;
  fields: { type: number; ability_count_minus1: number; unknown_1: number; hp: number; str: number; agl: number; mana: number; def: number; ability_ptr: number };
  type_name: string;
  ability_offset: number;
  abilities: Ability[];
}

export const MONSTER_TABLE = 0x36f80;
export const MONSTER_NAMES = 0x3eec0;
export const ITEM_NAMES = 0x3e640;

export function abilityName(rom: Rom, aid: number): string {
  return decodeName(rom.slice(ITEM_NAMES + 8 * aid, 8));
}

export function monsters(rom: Rom): Monster[] {
  const out: Monster[] = [];
  for (let id = 0; id < 256; id++) {
    const off = MONSTER_TABLE + 10 * id;
    const [bank, address] = Rom.bankAddress(off);
    const b0 = rom.u8(off);
    const fields = {
      type: b0 >> 4, ability_count_minus1: b0 & 0x0f, unknown_1: rom.u8(off + 1), hp: rom.u16(off + 2),
      str: rom.u8(off + 4), agl: rom.u8(off + 5), mana: rom.u8(off + 6), def: rom.u8(off + 7), ability_ptr: rom.u16(off + 8),
    };
    const aoff = Rom.fileOffset(0x0d, fields.ability_ptr);
    const abilities: Ability[] = [];
    for (let k = 0; k <= fields.ability_count_minus1; k++) {
      const a = rom.u8(aoff + k);
      abilities.push({ id: a, name: abilityName(rom, a) });
    }
    out.push({
      id, name: decodeName(rom.slice(MONSTER_NAMES + 8 * id, 8)), name_offset: MONSTER_NAMES + 8 * id,
      record_offset: off, bank, address, fields, type_name: TYPES[fields.type] ?? "?", ability_offset: aoff, abilities,
    });
  }
  return out;
}

const ICONS: Record<number, string> = {
  0x9e: "magi", 0x9f: "whip", 0xa0: "heavy-gun", 0xa1: "gun", 0xa3: "shield", 0xa4: "claw", 0xa5: "spell-book",
  0xa6: "spear", 0xa7: "sword", 0xa8: "axe", 0xa9: "bow", 0xaa: "helmet", 0xab: "gloves", 0xac: "armor",
  0xad: "boots", 0xae: "spell-book", 0xaf: "item", 0x3c: "resist", 0x3d: "weakness",
};

export const ITEM_TABLE = 0x32f80;
export const ITEM_USES = 0x33e80;
export const ITEM_PRICES = 0x3f860;

export function itemName(rom: Rom, id: number): string {
  let raw = rom.slice(ITEM_NAMES + 8 * id, 8);
  if (ICONS[raw[0]!] !== undefined) raw = raw.subarray(1);
  return decodeName(raw);
}

export interface Item {
  id: number;
  name: string;
  icon: string | null;
  kind: "item" | "monster-ability";
  record_offset: number;
  bank: number;
  address: number;
  fields: { usage: number; flags1: number; equip: number; effect: number; power: number; param: number; anim: number; uses: number; price: number | null };
  slot: string | null;
  stat_bonus: Record<string, number> | null;
}

export function items(rom: Rom): Item[] {
  const out: Item[] = [];
  for (let id = 0; id < 256; id++) {
    const off = ITEM_TABLE + 8 * id;
    const [bank, address] = Rom.bankAddress(off);
    const f = {
      usage: rom.u8(off), flags1: rom.u8(off + 1), equip: rom.u8(off + 2), effect: rom.u8(off + 3),
      power: rom.u8(off + 4), param: rom.u8(off + 5), anim: rom.u16(off + 6), uses: rom.u8(ITEM_USES + id),
      price: id < 120 ? rom.u24(ITEM_PRICES + 3 * id) : null,
    };
    const eq = f.equip;
    const slot = eq ? ({ 1: "helm", 2: "body", 4: "gloves", 8: "boots" } as Record<number, string>)[eq & 0x0f] ?? null : null;
    let bonus: Record<string, number> | null = null;
    if (eq & 0x40) {
      bonus = {};
      const amt = f.param & 0x0f;
      for (const [k, bit] of [["str", 8], ["agl", 4], ["mana", 2]] as const) if ((f.param >> 4) & bit) bonus[k] = amt;
    }
    out.push({
      id, name: itemName(rom, id), icon: ICONS[rom.u8(ITEM_NAMES + 8 * id)] ?? null,
      kind: id >= 0x80 ? "monster-ability" : "item", record_offset: off, bank, address, fields: f, slot, stat_bonus: bonus,
    });
  }
  return out;
}

// ---------------------------------------------------------------- encounters
const THRESH = 0x36560, ZONES = 0x36570, FORMS = 0x36c70, COUNTS = 0x36ef0;

export function encounters(rom: Rom, names?: Map<number, string>) {
  const thresholds = Array.from(rom.slice(THRESH, 7));
  const bounds = [256, ...thresholds, 0];
  const probs = Array.from({ length: 8 }, (_, s) => (bounds[s]! - bounds[s + 1]!) / 256);
  const countPattern = (p: number): [number, number][] =>
    Array.from(rom.slice(COUNTS + 3 * p, 3), (b) => [Math.min(b & 0x0f, b >> 4), Math.max(b & 0x0f, b >> 4)]);
  const formation = (f: number, alt: boolean) => {
    const o = FORMS + 5 * f;
    const cb = rom.u8(o + (alt ? 4 : 3));
    const counts = countPattern(cb & 0x1f);
    const groups = [0, 1, 2].filter((k) => counts[k]![1] > 0).map((k) => {
      const g: { enemy_id: number; min: number; max: number; enemy?: string } = { enemy_id: rom.u8(o + k), min: counts[k]![0], max: counts[k]![1] };
      if (names) g.enemy = names.get(g.enemy_id)!;
      return g;
    });
    return { formation: f, alt, count_byte: cb, flags: cb >> 6, groups };
  };
  const zones = Array.from({ length: 135 }, (_, z) => ({
    zone: z,
    slots: Array.from(rom.slice(ZONES + 8 * z, 8), (b, s) => ({ slot: s, probability: probs[s]!, ...formation(b & 0x7f, !!(b & 0x80)) })),
  }));
  const formations = Array.from({ length: 128 }, (_, f) => ({ formation: f, offset: FORMS + 5 * f, bytes: Array.from(rom.slice(FORMS + 5 * f, 5)) }));
  return { thresholds, slot_probabilities: probs, zones, formations, count_patterns: Array.from({ length: 32 }, (_, p) => countPattern(p)) };
}
