/** Map headers, warps, triggers, objects and tile attributes (port of ffl2kster.schema.maps). */
import { Rom } from "./rom.js";
import { event, type GameEvent } from "./events.js";
import { parseLayout, layoutOffset, type LayoutOp } from "./layout.js";

export const DEST_OFFSET = 0x1c000;
export const DEST_COUNT = 511;
export const ALT_DEST_OFFSET = 0x1ef80;
export const TILE_ATTR = 0x1f000;

export interface Destination {
  index: number; alt: boolean; offset: number; header: number; x: number; facing: number; y: number;
  flag6: boolean; sound: boolean; map_x: number; map_y: number;
}

export function destRecord(rom: Rom, i: number, alt = false): Destination {
  const o = (alt ? ALT_DEST_OFFSET : DEST_OFFSET) + 4 * i;
  const r = rom.slice(o, 4);
  return {
    index: i, alt, offset: o, header: r[0]! | (r[1]! << 8), x: (r[2]! & 0x3f) - 5, facing: r[2]! >> 6, y: (r[3]! & 0x3f) - 4,
    flag6: !!(r[3]! & 0x40), sound: !!(r[3]! & 0x80), map_x: r[2]! & 0x3f, map_y: r[3]! & 0x3f,
  };
}

export interface Trigger {
  tile: number; b0: number; b1: number; alt: boolean; index: number; flags?: number; event: GameEvent;
  to_header?: number; to_x?: number; to_y?: number;
}

export interface Condition { type: "flag" | "progress"; flag?: number; var?: number; min?: number; max?: number; bit6?: boolean }

export interface MapObject {
  offset: number; raw: string; condition: Condition; x: number; y: number; y_flags: number; message: number;
  sprite_slot: number; x_flag: number; kind: number; event: GameEvent;
}

export interface MapHeader {
  header: number; offset: number; layout_ptr: number; layout_bank: number; layout_address: number; layout_offset: number;
  b2: number; tileset: number; flags: number; trigger_metatiles: number; flag7: boolean; encounters: boolean;
  field_4_5: number; zone: number | null; rate: number | null; triggers: Trigger[]; tail_offset: number;
  sprites?: number[]; npcs?: MapObject[]; end_offset?: number; layout_ops?: LayoutOp[];
}

function resolveTrigger(b0: number, b1: number): { alt: boolean; index: number; flags?: number } {
  if (b1 === 0x0e) return { alt: true, index: b0 };
  return { alt: false, index: b0 + 256 * ((b1 & 1) ^ 1), flags: b1 };
}

export function header(rom: Rom, ptr: number): MapHeader {
  const o = 0x1c000 + ptr - 0x4000;
  const r = rom.slice(o, 64);
  const lp = r[0]! | (r[1]! << 8);
  const flags = r[3]!;
  let i = 4;
  let zone: number | null = null, rate: number | null = null;
  if (flags & 0x40) {
    zone = r[4]!; rate = r[5]!; i = 6;
  }
  const L = r[i]!;
  const triggers: Trigger[] = [];
  for (let k = 0; k < L; k++) {
    const b0 = r[i + 1 + 2 * k]!, b1 = r[i + 2 + 2 * k]!;
    triggers.push({ tile: 0x40 + k, b0, b1, ...resolveTrigger(b0, b1), event: event(b1, b0) });
  }
  const [lbank, laddr] = lp < 0x4000 ? [0x08, 0x4000 + lp] : [0x09, lp];
  return {
    header: ptr, offset: o, layout_ptr: lp, layout_bank: lbank, layout_address: laddr, layout_offset: Rom.fileOffset(lbank, laddr),
    b2: r[2]!, tileset: r[2]!, flags, trigger_metatiles: flags & 0x0f, flag7: !!(flags & 0x80), encounters: !!(flags & 0x40),
    field_4_5: (flags >> 4) & 3, zone, rate, triggers, tail_offset: o + i + 1 + 2 * L,
  };
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function objects(rom: Rom, hd: MapHeader): { sprites: number[]; npcs: MapObject[]; end_offset: number } {
  let o = hd.tail_offset;
  const sprites: number[] = [];
  while (sprites.length < 6 && rom.u8(o) !== 0xff) sprites.push(rom.u8(o++));
  if (sprites.length < 6) o += 1;
  const npcs: MapObject[] = [];
  while (rom.u8(o) !== 0xff && npcs.length < 64) {
    const r = rom.slice(o, 6);
    const cond: Condition = r[0] === 0x80 ? { type: "flag", flag: r[1]! }
      : { type: "progress", var: r[0]! & 0x1f, min: r[1]! >> 4, max: r[1]! & 0x0f, bit6: !!(r[0]! & 0x40) };
    npcs.push({
      offset: o, raw: hex(r), condition: cond, x: r[2]! & 0x3f, y: r[3]! & 0x3f, y_flags: r[3]! >> 6, message: r[4]!,
      sprite_slot: (r[5]! >> 4) & 7, x_flag: r[5]! >> 7, kind: r[5]! & 0x0f, event: event(r[5]! & 0x0f, r[4]!),
    });
    o += 6;
  }
  return { sprites, npcs, end_offset: o + 1 };
}

export function tileAttributes(rom: Rom, tileset: number) {
  return Array.from({ length: 32 }, (_, m) => {
    const a = rom.u8(TILE_ATTR + 32 * tileset + m);
    return { metatile: m, attr: a, blocks_walking: !!(a & 2), special: !!(a & 0x80) };
  });
}

export function allHeaders(rom: Rom): number[] {
  const s = new Set<number>();
  for (let i = 0; i < DEST_COUNT; i++) s.add(destRecord(rom, i).header);
  return Array.from(s).sort((a, b) => a - b);
}

export function exportMaps(rom: Rom) {
  const destinations = Array.from({ length: DEST_COUNT }, (_, i) => destRecord(rom, i));
  const headers: Record<string, MapHeader> = {};
  for (const h of allHeaders(rom)) {
    const hd = header(rom, h);
    for (const t of hd.triggers) {
      const ev = t.event;
      if (ev.dest !== undefined) {
        const d = ev.alt ? destRecord(rom, ev.dest, true) : ev.dest < DEST_COUNT ? destinations[ev.dest] : undefined;
        if (d) Object.assign(t, { to_header: d.header, to_x: d.x, to_y: d.y });
      }
    }
    Object.assign(hd, objects(rom, hd));
    hd.layout_ops = parseLayout(rom.bytes, layoutOffset(hd.layout_ptr));
    headers[h.toString(16).padStart(4, "0")] = hd;
  }
  const tilesets = Array.from(new Set(Object.values(headers).map((h) => h.b2))).sort((a, b) => a - b);
  const tile_attributes: Record<string, ReturnType<typeof tileAttributes>> = {};
  for (const t of tilesets) tile_attributes[String(t)] = tileAttributes(rom, t);
  return { destinations, headers, tile_attributes };
}
