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
