/** Event model: kinds raised by triggers, objects and script op 0x19 (port of ffl2kster.events). */

export const EVENT_KINDS: Record<number, string> = {
  0: "script", 1: "message", 2: "message", 3: "message", 4: "shop", 5: "warp", 6: "warp", 7: "sound", 8: "none",
  9: "chest_item", 0x0a: "chest_magi", 0x0b: "chest_item_prompt", 0x0c: "warp_save_return", 0x0d: "warp_save_return",
  0x0e: "warp_alt",
};

export interface GameEvent {
  kind: string;
  code: number;
  arg: number;
  status?: string;
  table?: string;
  index?: number;
  shop?: number | null;
  inn?: boolean;
  dest?: number;
  alt?: boolean;
  song?: number;
  ffb1?: number;
  sfx?: number;
  item?: number | null;
  magi?: number;
}

export function event(kind: number, arg: number): GameEvent {
  if (kind >= 0xf0) return { kind: "special", code: kind, arg, status: "hypothesis" };
  const d: GameEvent = { kind: EVENT_KINDS[kind] ?? `kind_${kind.toString(16).toUpperCase().padStart(2, "0")}`, code: kind, arg };
  if (kind === 0) Object.assign(d, { table: "story", index: arg });
  else if (kind >= 1 && kind <= 3) Object.assign(d, { table: "field", index: (kind - 1) * 256 + arg });
  else if (kind === 4) Object.assign(d, { shop: arg === 0xff ? null : arg, inn: arg === 0xff });
  else if (kind === 5 || kind === 6 || kind === 0x0c || kind === 0x0d) d.dest = arg + 256 * ((kind & 1) ^ 1);
  else if (kind === 0x0e) Object.assign(d, { dest: arg, alt: true });
  else if (kind === 7) {
    if (arg < 0x40) d.song = arg;
    else if (arg < 0x80) d.ffb1 = arg - 0x40;
    else d.sfx = arg - 0x80;
  } else if (kind === 9 || kind === 0x0b) d.item = arg === 0xff ? null : arg;
  else if (kind === 0x0a) d.magi = arg;
  return d;
}
