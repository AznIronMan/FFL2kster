/** ROM access helpers. The importer never stores or transmits the ROM; it only reads it. */

export const SUPPORTED_SHA256 = "ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e";

export class Rom {
  constructor(readonly bytes: Uint8Array) {}

  get length(): number {
    return this.bytes.length;
  }

  u8(offset: number): number {
    const v = this.bytes[offset];
    if (v === undefined) throw new RangeError(`ROM offset ${offset.toString(16)} out of range`);
    return v;
  }

  u16(offset: number): number {
    return this.u8(offset) | (this.u8(offset + 1) << 8);
  }

  u24(offset: number): number {
    return this.u8(offset) | (this.u8(offset + 1) << 8) | (this.u8(offset + 2) << 16);
  }

  slice(offset: number, length: number): Uint8Array {
    return this.bytes.subarray(offset, offset + length);
  }

  /** File offset of bank:address (address 0x4000-0x7FFF for banks >= 1, < 0x4000 for bank 0). */
  static fileOffset(bank: number, address: number): number {
    return address < 0x4000 ? address : bank * 0x4000 + address - 0x4000;
  }

  /** [bank, address] for a file offset (bank 0 addresses stay below 0x4000). */
  static bankAddress(offset: number): [number, number] {
    const bank = Math.floor(offset / 0x4000);
    return [bank, bank === 0 ? offset : 0x4000 + (offset % 0x4000)];
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RomCheck {
  ok: boolean;
  sha256: string;
  title: string;
  reason?: string;
}

/** Hash gate: only the supported revision is accepted (patched FFL2kster builds come later). */
export async function checkRom(bytes: Uint8Array): Promise<RomCheck> {
  const sha256 = await sha256Hex(bytes);
  const title = String.fromCharCode(...bytes.subarray(0x134, 0x144)).replace(/\0+$/, "");
  if (bytes.length !== 0x40000) return { ok: false, sha256, title, reason: "unexpected size (expected 256 KiB)" };
  if (sha256 !== SUPPORTED_SHA256) return { ok: false, sha256, title, reason: "unsupported ROM revision (SHA-256 mismatch)" };
  return { ok: true, sha256, title };
}
