/** IndexedDB persistence of the locally built data package (never uploaded anywhere). */
import type { DataPackage } from "@ffl2k/importer";

const DB = "ffl2kster", STORE = "package", KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const savePackage = (p: DataPackage) => tx("readwrite", (s) => s.put(p, KEY));
export const loadPackage = () => tx<DataPackage | undefined>("readonly", (s) => s.get(KEY));
export const clearPackage = () => tx("readwrite", (s) => s.delete(KEY));

const SRAM_KEY = "sram";
/** Battery RAM (the game's save slots), kept on this device only. */
export const saveSram = (b: Uint8Array) => tx("readwrite", (s) => s.put(b, SRAM_KEY));
export const loadSram = () => tx<Uint8Array | undefined>("readonly", (s) => s.get(SRAM_KEY));

/** The ROM as imported (before mods), kept on this device so mods can be switched on and off
 *  without choosing the ROM again. Never uploaded. */
export const saveBase = (b: Uint8Array) => tx("readwrite", (s) => s.put(b, "base"));
export const loadBase = () => tx<Uint8Array | undefined>("readonly", (s) => s.get("base"));

/** Run-time mods (P5): patch files the player added, in order, each on or off. */
export interface Mod { name: string; bytes: Uint8Array; enabled: boolean }
export const saveMods = (m: Mod[]) => tx("readwrite", (s) => s.put(m, "mods"));
export const loadMods = async () => (await tx<Mod[] | undefined>("readonly", (s) => s.get("mods"))) ?? [];
export const clearBase = () => tx("readwrite", (s) => s.delete("base"));

/** The save as it was before the last play session (kept on the first write of a session), so
 *  one bad session or write never loses everything. */
export const saveSramBackup = (b: Uint8Array) => tx("readwrite", (s) => s.put(b, "sram.prev"));
export const loadSramBackup = () => tx<Uint8Array | undefined>("readonly", (s) => s.get("sram.prev"));

/** Legend I (FFL1kster): its own data package and battery RAM (MBC2, 512 cells), kept beside
 *  Legend II's under separate keys. */
export const saveFfl1Package = (p: unknown) => tx("readwrite", (s) => s.put(p, "ffl1"));
export const loadFfl1Package = () => tx<unknown>("readonly", (s) => s.get("ffl1"));
export const clearFfl1Package = () => tx("readwrite", (s) => s.delete("ffl1"));
export const saveFfl1Sram = (b: Uint8Array) => tx("readwrite", (s) => s.put(b, "ffl1.sram"));
export const loadFfl1Sram = () => tx<Uint8Array | undefined>("readonly", (s) => s.get("ffl1.sram"));
export const saveFfl1SramBackup = (b: Uint8Array) => tx("readwrite", (s) => s.put(b, "ffl1.sram.prev"));
export const loadFfl1SramBackup = () => tx<Uint8Array | undefined>("readonly", (s) => s.get("ffl1.sram.prev"));

/** Legend III (FFL3kster): its own data package and battery RAM (MBC1, 8 KiB), kept beside the
 *  other games' under separate keys. */
export const saveFfl3Package = (p: unknown) => tx("readwrite", (s) => s.put(p, "ffl3"));
export const loadFfl3Package = () => tx<unknown>("readonly", (s) => s.get("ffl3"));
export const clearFfl3Package = () => tx("readwrite", (s) => s.delete("ffl3"));
export const saveFfl3Sram = (b: Uint8Array) => tx("readwrite", (s) => s.put(b, "ffl3.sram"));
export const loadFfl3Sram = () => tx<Uint8Array | undefined>("readonly", (s) => s.get("ffl3.sram"));
export const saveFfl3SramBackup = (b: Uint8Array) => tx("readwrite", (s) => s.put(b, "ffl3.sram.prev"));
export const loadFfl3SramBackup = () => tx<Uint8Array | undefined>("readonly", (s) => s.get("ffl3.sram.prev"));
