/** APU synthesizer: hardware-behaviour unit tests, and a comparison with PyBoy's own audio for
 *  every song (fixtures from tools/sound_capture.py: the driver's register writes and PyBoy's
 *  48 kHz buffer of the same run; skipped when absent).
 *
 *  sfx_audio plays all 57 sound effects alone (pulse 1 with sweep, noise).
 *  Exact sample equality is not expected: PyBoy point-samples, this synth box-filters, and the
 *  pulse duty positions (never reset by a trigger) depend on history. The comparison renders in
 *  "digital" mode (PyBoy's unipolar sum of 4-bit channel outputs) and checks, after the first
 *  0.5 s:
 *   - loudness, the mean of 4096-sample windows (85 ms): Pearson correlation >= 0.95 and mean
 *     |error| <= 5 % of the mean level;
 *   - AC energy, RMS of 1024-sample windows (21 ms): median ratio synth/PyBoy in [0.9, 1.05];
 *   - pitch content, magnitude spectra of 1024-sample windows: median cosine similarity >= 0.9. */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Apu, CPU_HZ, FRAME_CYCLES } from "../src/apu.js";

const ROOT = resolve(__dirname, "../../../..");
const FIX = resolve(ROOT, "build/sound/fixtures");
const AUD = resolve(ROOT, "build/sound/audio");
/** Cycle of the driver's first write within a PyBoy frame (PyBoy's frames end at vblank; found
 *  by cross-correlation). Writes of one call are spaced 24 cycles apart. */
const WRITE_OFFSET = 12000;

const mono = (pcm: Float32Array) => {
  const m = new Float64Array(pcm.length / 2);
  for (let i = 0; i < m.length; i++) m[i] = (pcm[2 * i]! + pcm[2 * i + 1]!) / 2;
  return m;
};

function crossings(x: Float64Array): number {
  let n = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) n++;
  return n;
}

describe("Apu hardware behaviour", () => {
  it("pulse 2 plays 131072/(2048-x) Hz", () => {
    const apu = new Apu({ sampleRate: 48000 });
    apu.write(0x26, 0x80); apu.write(0x24, 0x77); apu.write(0x25, 0xff);
    apu.write(0x16, 0x80); apu.write(0x17, 0xf0); apu.write(0x18, 1750 & 0xff); apu.write(0x19, 0x80 | (1750 >> 8));
    apu.runUntil(CPU_HZ * 1.1);
    const x = mono(apu.take()).subarray(4800); // skip the high-pass settling
    const hz = crossings(x) / 2 / (x.length / 48000);
    expect(Math.abs(hz - 131072 / (2048 - 1750))).toBeLessThan(1.5);
  });

  it("wave plays 65536/(2048-x) Hz from wave RAM, noise 7-bit LFSR repeats every 127 steps", () => {
    const apu = new Apu({ sampleRate: 48000 });
    apu.write(0x26, 0x80); apu.write(0x24, 0x77); apu.write(0x25, 0x44);
    for (let i = 0; i < 16; i++) apu.write(0x30 + i, i < 8 ? 0xff : 0x00);
    apu.write(0x1a, 0x80); apu.write(0x1c, 0x20); apu.write(0x1d, 0x00); apu.write(0x1e, 0x87); // x = 0x700
    apu.runUntil(CPU_HZ);
    const x = mono(apu.take()).subarray(4800);
    expect(Math.abs(crossings(x) / 2 / (x.length / 48000) - 65536 / (2048 - 0x700))).toBeLessThan(1.5);
    // noise: period 8 << 4 = 128 cycles per step, 7-bit → 127 steps
    const n = new Apu({ sampleRate: CPU_HZ / 128, mode: "digital" });
    n.write(0x26, 0x80); n.write(0x25, 0x88); n.write(0x21, 0xf0); n.write(0x22, 0x48); n.write(0x23, 0x80);
    n.runUntil(128 * 1000);
    const s = n.take().filter((_, i) => i % 2 === 0);
    for (let i = 10; i < 600; i++) expect(s[i + 127]).toBe(s[i]);
    expect(new Set(s.slice(10, 137)).size).toBe(2);
  });

  it("length counter stops a channel; envelope decays; NR52 shows channel status", () => {
    const apu = new Apu();
    apu.write(0x26, 0x80);
    apu.write(0x16, 0x3f); apu.write(0x17, 0xf0); apu.write(0x19, 0xc7); // length 1, enabled
    expect(apu.read(0x26) & 0x02).toBe(2);
    apu.runUntil(8192 * 4);
    expect(apu.read(0x26) & 0x02).toBe(0);
    // envelope: volume 15 decreasing every 1/64 s → silent after 15/64 s, channel stays on
    const d = new Apu({ sampleRate: 1024, mode: "digital" });
    d.write(0x26, 0x80); d.write(0x25, 0x01); d.write(0x11, 0xc0); d.write(0x12, 0xf1); d.write(0x13, 0x00); d.write(0x14, 0x87);
    d.runUntil(CPU_HZ / 2);
    const s = d.take().filter((_, i) => i % 2 === 1);
    expect(Math.max(...s.slice(0, 16))).toBeGreaterThan(10);
    expect(Math.max(...s.slice(300))).toBe(0);
    expect(d.read(0x26) & 1).toBe(1);
  });

  it("sweep overflow disables pulse 1; writes are ignored while powered off", () => {
    const apu = new Apu();
    apu.write(0x26, 0x80);
    apu.write(0x10, 0x11); apu.write(0x12, 0xf0); apu.write(0x13, 0x00); apu.write(0x14, 0x87); // 0x700 + 0x380 > 0x7FF
    expect(apu.read(0x26) & 1).toBe(0);
    apu.write(0x10, 0x00); apu.write(0x14, 0x80);
    expect(apu.read(0x26) & 1).toBe(1);
    apu.write(0x26, 0x00);
    expect(apu.read(0x26) & 0x8f).toBe(0);
    apu.write(0x12, 0xf0); apu.write(0x14, 0x80);
    expect(apu.read(0x26) & 0x0f).toBe(0);
  });

  it("is deterministic and renders the requested number of frames", () => {
    const run = () => {
      const apu = new Apu({ sampleRate: 44100 });
      apu.write(0x26, 0x80); apu.write(0x24, 0x77); apu.write(0x25, 0xff);
      apu.write(0x21, 0xf3); apu.write(0x22, 0x31); apu.write(0x23, 0x80);
      return apu.render(4410);
    };
    const a = run(), b = run();
    expect(a.length).toBe(8820);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true);
  });
});

// ---------------------------------------------------------------- PyBoy comparison

function npyInt8(file: string): Int8Array {
  const b = readFileSync(file);
  const hl = b.readUInt16LE(8);
  const header = b.toString("latin1", 10, 10 + hl);
  if (!header.includes("'|i1'")) throw new Error(`unexpected npy dtype in ${file}`);
  return new Int8Array(b.buffer, b.byteOffset + 10 + hl, b.length - 10 - hl);
}

function renderFixture(file: string): Float32Array {
  const b = gunzipSync(readFileSync(file));
  const apu = new Apu({ sampleRate: 48000, mode: "digital" });
  let last = 0;
  for (let p = 0; p < b.length;) {
    const fr = b.readUInt32LE(p + 1), n = b.readUInt16LE(p + 5);
    p += 7 + 273 + 272;
    for (let k = 0; k < n; k++) apu.write(b[p + 2 * k]!, b[p + 2 * k + 1]!, fr * FRAME_CYCLES + WRITE_OFFSET + 24 * k);
    p += 2 * n;
    last = fr;
  }
  apu.runUntil((last + 1) * FRAME_CYCLES);
  return apu.take();
}

/** In-place iterative radix-2 FFT; returns magnitudes of bins 1..n/2. */
function magnitudes(x: Float64Array): Float64Array {
  const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const t = re[i]!; re[i] = re[j]!; re[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const xr = re[b]! * wr - im[b]! * wi, xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi;
        re[a]! += xr; im[a]! += xi;
      }
    }
  }
  const m = new Float64Array(n / 2);
  for (let k = 1; k <= n / 2; k++) m[k - 1] = Math.hypot(re[k]!, im[k]!);
  return m;
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
function pearson(a: number[], b: number[]): number {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i]! - ma, y = b[i]! - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
}

const monoAt = (pcm: ArrayLike<number>, i: number) => (pcm[2 * i]! + pcm[2 * i + 1]!) / 2;

export function compare(ref: Int8Array, syn: Float32Array, skip = 24000) {
  const n = Math.min(ref.length, syn.length) / 2;
  // loudness: 4096-sample window means
  const la: number[] = [], lb: number[] = [];
  for (let s = skip; s + 4096 <= n; s += 4096) {
    let ta = 0, tb = 0;
    for (let i = s; i < s + 4096; i++) { ta += monoAt(ref, i); tb += monoAt(syn, i); }
    la.push(ta / 4096); lb.push(tb / 4096);
  }
  const level = la.reduce((t, v) => t + v, 0) / la.length;
  const err = la.reduce((t, v, i) => t + Math.abs(v - lb[i]!), 0) / la.length;
  // AC energy and spectra: 1024-sample windows
  const win = 1024, ratios: number[] = [], cos: number[] = [];
  for (let s = skip; s + win <= n; s += win) {
    const a = new Float64Array(win), b = new Float64Array(win);
    for (let i = 0; i < win; i++) { a[i] = monoAt(ref, s + i); b[i] = monoAt(syn, s + i); }
    const ma = a.reduce((t, v) => t + v, 0) / win, mb = b.reduce((t, v) => t + v, 0) / win;
    for (let i = 0; i < win; i++) { a[i]! -= ma; b[i]! -= mb; }
    const ra = Math.sqrt(a.reduce((t, v) => t + v * v, 0) / win), rb = Math.sqrt(b.reduce((t, v) => t + v * v, 0) / win);
    if (ra > 0.5) ratios.push(rb / ra);
    if (ra > 0.5 && rb > 0.5) {
      const fa = magnitudes(a), fb = magnitudes(b);
      let ab = 0, aa = 0, bb = 0;
      for (let k = 0; k < fa.length; k++) { ab += fa[k]! * fb[k]!; aa += fa[k]! ** 2; bb += fb[k]! ** 2; }
      cos.push(ab / Math.sqrt(aa * bb));
    }
  }
  return { seconds: (n - skip) / 48000, meanCorr: pearson(la, lb), meanErr: err / level, rmsRatio: median(ratios), spectralCos: median(cos) };
}

const HAVE = existsSync(FIX) && existsSync(AUD);
describe.skipIf(!HAVE)("Apu vs PyBoy audio (all songs, all SFX)", () => {
  const songs = HAVE ? readdirSync(AUD).filter((f) => /^(song_\d\d|sfx_audio)\.npy$/.test(f)).sort() : [];
  it("has the 19 song recordings and the SFX recording", () => expect(songs.length).toBe(20));
  for (const f of songs) {
    it(f.replace(".npy", ""), () => {
      const syn = renderFixture(resolve(FIX, f.replace(".npy", ".bin.gz")));
      const r = compare(npyInt8(resolve(AUD, f)), syn);
      console.log(`apu ${f.replace(".npy", "")}: ${r.seconds.toFixed(1)} s, mean corr ${r.meanCorr.toFixed(3)}, mean err ${(100 * r.meanErr).toFixed(1)}%, rms ratio ${r.rmsRatio.toFixed(3)}, spectral cos ${r.spectralCos.toFixed(3)}`);
      expect(r.meanCorr).toBeGreaterThanOrEqual(0.95);
      expect(r.meanErr).toBeLessThanOrEqual(0.05);
      expect(r.rmsRatio).toBeGreaterThanOrEqual(0.9);
      expect(r.rmsRatio).toBeLessThanOrEqual(1.05);
      expect(r.spectralCos).toBeGreaterThanOrEqual(0.9);
    });
  }
});
