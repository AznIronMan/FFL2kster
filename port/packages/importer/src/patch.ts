/** Run-time mods (P5): IPS and BPS patches applied on the player's device to their own ROM.
 *  FFL2kster writes IPS (`ffl2kster build --ips`); BPS (with its CRC32 checks) is the common
 *  format of other ROM-hacking tools. A patch carries only changed bytes, never a ROM. */

export type PatchFormat = "ips" | "bps";

export function patchFormat(p: Uint8Array): PatchFormat | null {
  const head = String.fromCharCode(...p.subarray(0, 5));
  if (head === "PATCH") return "ips";
  if (head.startsWith("BPS1")) return "bps";
  return null;
}

export function applyPatch(rom: Uint8Array, patch: Uint8Array): Uint8Array {
  const f = patchFormat(patch);
  if (f === "ips") return applyIps(rom, patch);
  if (f === "bps") return applyBps(rom, patch);
  throw new Error("not an IPS or BPS patch");
}

/** IPS: "PATCH", records [offset u24 BE][size u16 BE][data] or RLE (size 0: [count u16][value]),
 *  "EOF", then an optional truncation size (u24). */
export function applyIps(rom: Uint8Array, patch: Uint8Array): Uint8Array {
  let out = rom.slice();
  let p = 5;
  const u = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + patch[p++]!; return v; };
  for (;;) {
    if (p + 3 > patch.length) throw new Error("IPS patch ends without EOF");
    if (patch[p] === 0x45 && patch[p + 1] === 0x4f && patch[p + 2] === 0x46) { p += 3; break; }
    const off = u(3), size = u(2);
    let data: Uint8Array;
    if (size === 0) {
      const run = u(2);
      data = new Uint8Array(run).fill(patch[p++]!);
    } else {
      data = patch.subarray(p, p + size);
      p += size;
    }
    if (off + data.length > out.length) {
      const grown = new Uint8Array(off + data.length);
      grown.set(out);
      out = grown;
    }
    out.set(data, off);
  }
  if (p + 3 <= patch.length) out = out.slice(0, u(3));
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** BPS (byuu/beat): varint sizes, metadata, then SourceRead / TargetRead / SourceCopy /
 *  TargetCopy actions; footer CRC32 of source, target and patch. All three are checked. */
export function applyBps(rom: Uint8Array, patch: Uint8Array): Uint8Array {
  const end = patch.length - 12;
  const u32 = (o: number) => (patch[o]! | (patch[o + 1]! << 8) | (patch[o + 2]! << 16) | (patch[o + 3]! << 24)) >>> 0;
  if (crc32(patch.subarray(0, patch.length - 4)) !== u32(patch.length - 4)) throw new Error("BPS patch is damaged (checksum)");
  if (crc32(rom) !== u32(end)) throw new Error("this BPS patch is for a different ROM");
  let p = 4;
  const num = () => {
    let data = 0, shift = 1;
    for (;;) {
      const x = patch[p++]!;
      data += (x & 0x7f) * shift;
      if (x & 0x80) break;
      shift *= 128;
      data += shift;
    }
    return data;
  };
  if (num() !== rom.length) throw new Error("this BPS patch is for a different ROM size");
  const out = new Uint8Array(num());
  const meta = num(); // (not `p += num()`: num advances p)
  p += meta;
  let o = 0, srcRel = 0, tgtRel = 0;
  while (p < end) {
    const d = num(), len = (d >> 2) + 1;
    switch (d & 3) {
      case 0: for (let i = 0; i < len; i++, o++) out[o] = rom[o]!; break;
      case 1: for (let i = 0; i < len; i++) out[o++] = patch[p++]!; break;
      case 2: { const x = num(); srcRel += (x & 1 ? -1 : 1) * Math.floor(x / 2); for (let i = 0; i < len; i++) out[o++] = rom[srcRel++]!; break; }
      default: { const x = num(); tgtRel += (x & 1 ? -1 : 1) * Math.floor(x / 2); for (let i = 0; i < len; i++) out[o++] = out[tgtRel++]!; break; }
    }
  }
  if (crc32(out) !== u32(end + 4)) throw new Error("BPS result does not match the patch's checksum");
  return out;
}
