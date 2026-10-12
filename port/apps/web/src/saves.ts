/** Portable saves: the game's battery RAM as a raw 8 KiB .sav file, the format Game Boy
 *  emulators use for this cartridge (MBC1 + 8 KiB RAM), identical on every platform. Export
 *  writes what IndexedDB holds; import validates the size and replaces it. */
import { loadSram, saveSram } from "./storage";
import { saveFile } from "./platform";

export const SAV_SIZE = 0x2000;
export const SAV_NAME = "legend2.sav";

export async function exportSave(): Promise<"saved" | "cancelled" | "empty"> {
  const s = await loadSram().catch(() => undefined);
  if (!s) return "empty";
  return (await saveFile(SAV_NAME, s.slice(0, SAV_SIZE))) ? "saved" : "cancelled";
}

/** Check and store an imported .sav; returns an error message, or null when accepted. */
export async function importSave(bytes: Uint8Array): Promise<string | null> {
  const err = checkSave(bytes);
  if (err) return err;
  await saveSram(bytes.slice(0, SAV_SIZE));
  return null;
}

export function checkSave(bytes: Uint8Array): string | null {
  if (bytes.length !== SAV_SIZE) return `a save file is ${SAV_SIZE} bytes (this one is ${bytes.length})`;
  return null;
}
