/** Legend I (The Final Fantasy Legend, USA) ROM access. The importer reads the player's ROM on the
 *  device; nothing is stored except the data package, and nothing is uploaded. Layouts were derived
 *  from this ROM (docs/ffl1/); none are shared with Legend II. */

export const FFL1_SHA256 = "e5b1d116a8fb01b7a7213f906b3ef1bcc91a18f6826b01ee1bccd89429a0d906";
export const FFL1_SIZE = 131072;
export const FFL1_TITLE = "SAGA";

export function fileOffset(bank: number, address: number): number {
  return address < 0x4000 ? address : bank * 0x4000 + address - 0x4000;
}

export function bankAddress(offset: number): [number, number] {
  const bank = Math.floor(offset / 0x4000);
  return [bank, bank === 0 ? offset : 0x4000 + (offset % 0x4000)];
}

export const u16 = (rom: Uint8Array, o: number): number => rom[o]! | (rom[o + 1]! << 8);

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Ffl1Check {
  ok: boolean;
  sha256: string;
  title: string;
  /** Unverified import possible (direction note C): the file can hold Legend I's layout. */
  canOverride: boolean;
  warnings: string[];
  reason?: string;
}

/** Hash gate for Legend I: the verified path for the USA reference dump only (docs/VARIANTS.md);
 *  other 128 KiB SAGA dumps may be imported in the labelled unverified mode. */
export async function checkFfl1Rom(bytes: Uint8Array): Promise<Ffl1Check> {
  const sha256 = await sha256Hex(bytes);
  const title = bytes.length >= 0x150 ? String.fromCharCode(...bytes.subarray(0x134, 0x144)).replace(/\0.*$/s, "") : "";
  const warnings: string[] = [];
  if (bytes.length !== FFL1_SIZE) warnings.push(`size ${bytes.length} bytes (Legend I is ${FFL1_SIZE})`);
  if (title !== FFL1_TITLE) warnings.push(`internal name "${title}" (Legend I is "${FFL1_TITLE}")`);
  if (bytes.length >= 0x150 && bytes[0x147] !== 0x06) warnings.push("cartridge type is not MBC2+BATTERY");
  const ok = sha256 === FFL1_SHA256;
  return { ok, sha256, title, canOverride: !ok && bytes.length >= FFL1_SIZE, warnings,
    ...(ok ? {} : { reason: "not the verified Legend I (USA) ROM" }) };
}
