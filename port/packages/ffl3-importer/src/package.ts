/** Legend III data package: everything the FFL3 engine needs, built locally from the player's ROM.
 *  It never leaves the device. IDs are namespaced per game (game: "FFL3") so packages for
 *  different games can coexist (direction note D). */
import { checkFfl3Rom } from "./rom.js";
import { exportText } from "./text.js";
import { monsters, items, encounters, maps, MAP_COUNT } from "./tables.js";
import { exportLayouts } from "./layout.js";
import { exportMusic } from "./music.js";
import { font, mapTileset, pictures } from "./gfx.js";

export const FFL3_PACKAGE_FORMAT = 1;
/** All sixteen ROM banks, kept as read-only data segments the engine reads at original addresses. */
export const FFL3_SEGMENT_BANKS = Array.from({ length: 16 }, (_, i) => i);

export interface Ffl3DataPackage {
  game: "FFL3";
  format: number;
  sourceSha256: string;
  /** false: imported in the unverified mode (hash mismatch; best effort, no parity claim). */
  verified: boolean;
  createdAt: string;
  monsters: ReturnType<typeof monsters>;
  items: ReturnType<typeof items>;
  encounters: ReturnType<typeof encounters>;
  maps: ReturnType<typeof maps>;
  layouts: ReturnType<typeof exportLayouts>;
  text: ReturnType<typeof exportText>;
  music: ReturnType<typeof exportMusic>;
  gfx: {
    font: Uint8Array;
    /** One 0x800-byte tileset per map (BG tiles 00-7F). */
    tilesets: Uint8Array[];
    pictures: ReturnType<typeof pictures>;
  };
  segments: Record<string, Uint8Array>;
}

export type Progress = (step: string, done: number, total: number) => void;

export async function importFfl3Rom(bytes: Uint8Array, progress: Progress = () => {}, opts: { unverified?: boolean } = {}): Promise<Ffl3DataPackage> {
  const check = await checkFfl3Rom(bytes);
  if (!check.ok && !(opts.unverified && check.canOverride)) throw new Error(`ROM rejected: ${check.reason}`);
  const steps = 7;
  let n = 0;
  const step = (s: string) => progress(s, ++n, steps);
  step("monsters & items");
  const mons = monsters(bytes), its = items(bytes);
  step("encounters");
  const enc = encounters(bytes);
  step("text");
  const text = exportText(bytes);
  step("maps & layouts");
  const mp = maps(bytes), layouts = exportLayouts(bytes);
  step("music");
  const music = exportMusic(bytes);
  step("graphics");
  const gfx = { font: font(bytes), tilesets: Array.from({ length: MAP_COUNT }, (_, m) => mapTileset(bytes, m)), pictures: pictures(bytes) };
  step("segments");
  const segments: Record<string, Uint8Array> = {};
  for (const bk of FFL3_SEGMENT_BANKS) segments[bk.toString(16).padStart(2, "0")] = bytes.slice(bk * 0x4000, (bk + 1) * 0x4000);
  return { game: "FFL3", format: FFL3_PACKAGE_FORMAT, sourceSha256: check.sha256, verified: check.ok, createdAt: new Date().toISOString(),
    monsters: mons, items: its, encounters: enc, maps: mp, layouts, text, music, gfx, segments };
}
