/** IPS/BPS patch application (P5 run-time mods), with synthetic data (no ROM needed). */
import { describe, expect, it } from "vitest";
import { applyIps, applyBps, applyPatch, patchFormat, crc32 } from "../src/patch.js";

function ips(records: [number, number[]][], rle?: [number, number, number]): Uint8Array {
  const b: number[] = [..."PATCH"].map((c) => c.charCodeAt(0));
  for (const [off, data] of records) b.push(off >> 16, (off >> 8) & 255, off & 255, data.length >> 8, data.length & 255, ...data);
  if (rle) b.push(rle[0] >> 16, (rle[0] >> 8) & 255, rle[0] & 255, 0, 0, rle[1] >> 8, rle[1] & 255, rle[2]);
  b.push(0x45, 0x4f, 0x46);
  return new Uint8Array(b);
}

/** Minimal BPS writer: TargetRead for changed runs, SourceRead otherwise. */
function bps(src: Uint8Array, dst: Uint8Array): Uint8Array {
  const out: number[] = [..."BPS1"].map((c) => c.charCodeAt(0));
  const num = (v: number) => { for (;;) { const x = v & 0x7f; v = Math.floor(v / 128); if (v === 0) { out.push(0x80 | x); break; } out.push(x); v--; } };
  num(src.length); num(dst.length); num(0);
  let i = 0;
  while (i < dst.length) {
    let j = i;
    const same = src[i] === dst[i];
    while (j < dst.length && (src[j] === dst[j]) === same && j - i < 1000) j++;
    num(((j - i - 1) << 2) | (same ? 0 : 1));
    if (!same) for (let k = i; k < j; k++) out.push(dst[k]!);
    i = j;
  }
  const u32 = (v: number) => out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
  u32(crc32(src)); u32(crc32(dst));
  u32(crc32(new Uint8Array(out)));
  return new Uint8Array(out);
}

describe("patches", () => {
  const rom = new Uint8Array(4096).map((_, i) => (i * 7) & 255);
  it("IPS records and RLE", () => {
    const p = ips([[10, [1, 2, 3]], [4000, [9]]], [100, 5, 0xaa]);
    expect(patchFormat(p)).toBe("ips");
    const out = applyIps(rom, p);
    expect([...out.subarray(10, 13)]).toEqual([1, 2, 3]);
    expect(out[4000]).toBe(9);
    expect([...out.subarray(100, 105)]).toEqual([0xaa, 0xaa, 0xaa, 0xaa, 0xaa]);
    expect(out[13]).toBe(rom[13]);
    expect(rom[10]).toBe(70); // the input is not modified
  });
  it("BPS round trip with checksums", () => {
    const dst = rom.slice();
    dst.set([5, 5, 5], 200);
    dst[3000] = 1;
    const p = bps(rom, dst);
    expect(patchFormat(p)).toBe("bps");
    expect(applyPatch(rom, p)).toEqual(dst);
    const other = rom.slice(); other[0] ^= 1;
    expect(() => applyBps(other, p)).toThrow(/different ROM/);
  });
  it("rejects other files", () => {
    expect(() => applyPatch(rom, new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/not an IPS or BPS/);
  });
});
