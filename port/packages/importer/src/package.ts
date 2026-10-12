/** Data package: everything the engine needs, built locally from the user's ROM.
 *  The package never leaves the user's device (stored in IndexedDB / app data). */
import { Rom, checkRom } from "./rom.js";
import { exportText, type Message } from "./text.js";
import { monsters, items, encounters } from "./tables.js";
import { exportEvents, exportScripts } from "./scripts.js";
import { exportRules, calcVmListing } from "./rules.js";
import { exportMaps } from "./maps.js";
import { songSummary, instruments, sfx, parseSong, NSONGS } from "./music.js";
import { vramBg, monsterGraphic, spritePage } from "./gfx.js";

export const PACKAGE_FORMAT = 2;
/** ROM banks kept as read-only data segments for the engine (tables, graphics, layouts 08/09, scripts
 *  0A/0B, calc VM 0C, music 0E, dictionary/phrases/RNG 0F). Stored only on the user's device. */
export const SEGMENT_BANKS = Array.from({ length: 16 }, (_, i) => i);

export interface DataPackage {
  format: number;
  sourceSha256: string;
  /** false: imported in the unverified mode (hash mismatch, best effort; no parity claim).
   *  Absent in packages built before this field existed, which all passed the hash check. */
  verified?: boolean;
  createdAt: string;
  monsters: ReturnType<typeof monsters>;
  items: ReturnType<typeof items>;
  encounters: ReturnType<typeof encounters>;
  text: Message[];
  events: ReturnType<typeof exportEvents>;
  rules: ReturnType<typeof exportRules>;
  maps: ReturnType<typeof exportMaps>;
  music: { songs: ReturnType<typeof songSummary>; instruments: ReturnType<typeof instruments>; sfx: ReturnType<typeof sfx>; sequences: ReturnType<typeof parseSong>[] };
  gfx: {
    tilesets: Record<string, Uint8Array>;
    monsters: { w: number; h: number; tiles: Uint8Array }[];
    spritePages: Uint8Array[];
  };
  segments: Record<string, Uint8Array>;
  listings: { scripts: string; calcVm: string };
}

export type Progress = (step: string, done: number, total: number) => void;

export interface ImportOptions {
  /** Import a hash mismatch anyway (unverified mode, direction note C). */
  unverified?: boolean;
}

export async function importRom(bytes: Uint8Array, progress: Progress = () => {}, opts: ImportOptions = {}): Promise<DataPackage> {
  const check = await checkRom(bytes);
  if (!check.ok && !(opts.unverified && check.canOverride)) throw new Error(`ROM rejected: ${check.reason}`);
  const rom = new Rom(bytes);
  const steps = 10;
  let n = 0;
  const step = (s: string) => progress(s, ++n, steps);
  step("monsters & items");
  const mons = monsters(rom);
  const its = items(rom);
  step("encounters");
  const enc = encounters(rom, new Map(mons.map((m) => [m.id, m.name])));
  step("text");
  const text = exportText(rom.bytes);
  step("events");
  const events = exportEvents(rom);
  step("rules");
  const rules = exportRules(rom);
  step("maps");
  const maps = exportMaps(rom);
  step("music");
  const music = { songs: songSummary(rom), instruments: instruments(rom), sfx: sfx(rom), sequences: Array.from({ length: NSONGS }, (_, i) => parseSong(rom, i + 1)) };
  step("graphics");
  const tilesets: Record<string, Uint8Array> = {};
  for (const t of Object.keys(maps.tile_attributes)) tilesets[t] = vramBg(rom, Number(t)).slice();
  const gfx = {
    tilesets,
    monsters: Array.from({ length: 256 }, (_, i) => { const g = monsterGraphic(rom, i); return { ...g, tiles: g.tiles.slice() }; }),
    spritePages: Array.from({ length: 0x80 }, (_, c) => spritePage(rom, c).slice()),
  };
  step("segments");
  const segments: Record<string, Uint8Array> = {};
  for (const bk of SEGMENT_BANKS) segments[bk.toString(16).padStart(2, "0")] = rom.slice(bk * 0x4000, 0x4000).slice();
  step("listings");
  const listings = { scripts: exportScripts(rom), calcVm: calcVmListing(rom) };
  return {
    format: PACKAGE_FORMAT, sourceSha256: check.sha256, verified: check.ok, createdAt: new Date().toISOString(),
    monsters: mons, items: its, encounters: enc, text, events, rules, maps, music, gfx, segments, listings,
  };
}
