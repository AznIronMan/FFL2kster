/** Legend I data package: everything the FFL1 engine needs, built locally from the player's ROM.
 *  It never leaves the device. IDs are namespaced per game (game: "FFL1") so packages for different
 *  games can coexist (direction note D). */
import { checkFfl1Rom } from "./rom.js";
import { exportText } from "./text.js";
import { monsters, items, encounters, meat } from "./tables.js";
import { exportMaps } from "./maps.js";
import { exportMusic } from "./music.js";
import { font, tileset, spriteSet, picture, TILESET_COUNT, SPRITE_SET_COUNT } from "./gfx.js";

export const FFL1_PACKAGE_FORMAT = 1;
/** All eight ROM banks, kept as read-only data segments the engine reads at original addresses. */
export const FFL1_SEGMENT_BANKS = Array.from({ length: 8 }, (_, i) => i);

export interface Ffl1DataPackage {
  game: "FFL1";
  format: number;
  sourceSha256: string;
  /** false: imported in the unverified mode (hash mismatch; best effort, no parity claim). */
  verified: boolean;
  createdAt: string;
  monsters: ReturnType<typeof monsters>;
  items: ReturnType<typeof items>;
  encounters: ReturnType<typeof encounters>;
  meat: ReturnType<typeof meat>;
  text: ReturnType<typeof exportText>;
  maps: ReturnType<typeof exportMaps>;
  music: ReturnType<typeof exportMusic>;
  gfx: {
    font: Uint8Array;
    tilesets: Uint8Array[];
    spriteSets: Uint8Array[];
    pictures: { class: number; index: number; tiles: number; width: number; data: Uint8Array }[];
  };
  segments: Record<string, Uint8Array>;
}

export type Progress = (step: string, done: number, total: number) => void;

export async function importFfl1Rom(bytes: Uint8Array, progress: Progress = () => {}, opts: { unverified?: boolean } = {}): Promise<Ffl1DataPackage> {
  const check = await checkFfl1Rom(bytes);
  if (!check.ok && !(opts.unverified && check.canOverride)) throw new Error(`ROM rejected: ${check.reason}`);
  const steps = 7;
  let n = 0;
  const step = (s: string) => progress(s, ++n, steps);
  step("monsters & items");
  const mons = monsters(bytes), its = items(bytes);
  step("encounters & meat");
  const enc = encounters(bytes), mt = meat(bytes);
  step("text");
  const text = exportText(bytes);
  step("maps");
  const maps = exportMaps(bytes);
  step("music");
  const music = exportMusic(bytes);
  step("graphics");
  const gfx = {
    font: font(bytes),
    tilesets: Array.from({ length: TILESET_COUNT }, (_, s) => tileset(bytes, s)),
    spriteSets: Array.from({ length: SPRITE_SET_COUNT }, (_, s) => spriteSet(bytes, s)),
    pictures: Array.from({ length: 200 }, (_, id) => { const { offset: _o, ...p } = picture(bytes, id); return p; }),
  };
  step("segments");
  const segments: Record<string, Uint8Array> = {};
  for (const bk of FFL1_SEGMENT_BANKS) segments[bk.toString(16).padStart(2, "0")] = bytes.slice(bk * 0x4000, (bk + 1) * 0x4000);
  return { game: "FFL1", format: FFL1_PACKAGE_FORMAT, sourceSha256: check.sha256, verified: check.ok, createdAt: new Date().toISOString(),
    monsters: mons, items: its, encounters: enc, meat: mt, text, maps, music, gfx, segments };
}
