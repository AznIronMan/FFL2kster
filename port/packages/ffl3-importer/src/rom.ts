/** Legend III (Final Fantasy Legend III, USA) ROM access. The importer reads the player's ROM on
 *  the device; nothing is stored except the data package, and nothing is uploaded. Layouts were
 *  derived from this ROM (docs/ffl3/). */

export const FFL3_SHA256 = "5ed87f65225b72a74c3c04a4e5d67683fb5cc33e5f1266157350828ab973fc1d";
export const FFL3_SIZE = 262144;
export const FFL3_TITLE = "SAGA3";

export function fileOffset(bank: number, address: number): number {
  return address < 0x4000 ? address : bank * 0x4000 + address - 0x4000;
}

export function bankAddress(offset: number): [number, number] {
  const bank = Math.floor(offset / 0x4000);
  return [bank, bank === 0 ? offset : 0x4000 + (offset % 0x4000)];
}

export const u16 = (rom: Uint8Array, o: number): number => rom[o]! | (rom[o + 1]! << 8);
export const hex = (v: number, n = 2): string => v.toString(16).toUpperCase().padStart(n, "0");

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Ffl3Check {
  ok: boolean;
  sha256: string;
  title: string;
  canOverride: boolean;
  warnings: string[];
  reason?: string;
}

/** Hash gate for Legend III: the verified path for the USA reference dump only (docs/VARIANTS.md);
 *  other 256 KiB SAGA3 dumps may be imported in the labelled unverified mode (direction note C). */
export async function checkFfl3Rom(bytes: Uint8Array): Promise<Ffl3Check> {
  const sha256 = await sha256Hex(bytes);
  const title = bytes.length >= 0x150 ? String.fromCharCode(...bytes.subarray(0x134, 0x144)).replace(/\0.*$/s, "") : "";
  const warnings: string[] = [];
  if (bytes.length !== FFL3_SIZE) warnings.push(`size ${bytes.length} bytes (Legend III is ${FFL3_SIZE})`);
  if (title !== FFL3_TITLE) warnings.push(`internal name "${title}" (Legend III is "${FFL3_TITLE}")`);
  if (bytes.length >= 0x150 && bytes[0x147] !== 0x03) warnings.push("cartridge type is not MBC1+RAM+BATTERY");
  const ok = sha256 === FFL3_SHA256;
  return { ok, sha256, title, canOverride: !ok && bytes.length >= FFL3_SIZE, warnings,
    ...(ok ? {} : { reason: "not the verified Legend III (USA) ROM" }) };
}
