/** Sound driver parity: for every driver call recorded in PyBoy (tools/sound_capture.py), the
 *  port must leave the driver RAM (CB00-CBFF, FFB0-FFBF) exactly as the original does and make
 *  the same APU register writes (FF10-FF3F) with the same values in the same order.
 *  The port runs chained: its RAM carries over from call to call; only bytes the game changed
 *  between calls in the recording (song/SFX/jingle requests, FF25 from other code) are injected. */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Memory } from "../src/memory.js";
import { Game } from "../src/game.js";
import { soundInit, soundUpdate } from "../src/sound/driver.js";
import { installSound } from "../src/sound/index.js";

const ROOT = resolve(__dirname, "../../../..");
const ROM = process.env.FFL2K_ROM ?? resolve(ROOT, "input/original.gb");
const FIX = resolve(ROOT, "build/sound/fixtures");
const HAVE = existsSync(ROM) && existsSync(FIX);

function segments(rom: Uint8Array) {
  const s: Record<string, Uint8Array> = {};
  for (let b = 0; b < rom.length / 0x4000; b++) s[b.toString(16).padStart(2, "0")] = rom.slice(b * 0x4000, (b + 1) * 0x4000);
  return s;
}

interface Call { kind: number; frame: number; inp: Uint8Array; out: Uint8Array; writes: Uint8Array }

function load(file: string): Call[] {
  const b = gunzipSync(readFileSync(file));
  const out: Call[] = [];
  for (let p = 0; p < b.length;) {
    const kind = b[p]!, frame = b.readUInt32LE(p + 1), n = b.readUInt16LE(p + 5);
    p += 7;
    const inp = b.subarray(p, p + 273); p += 273;
    const o = b.subarray(p, p + 272); p += 272;
    const writes = b.subarray(p, p + 2 * n); p += 2 * n;
    out.push({ kind, frame, inp, out: o, writes });
  }
  return out;
}

const getRam = (m: Memory, i: number) => (i < 0x100 ? m.wram[0xb00 + i]! : m.hram[0x30 + i - 0x100]!);
function setRam(m: Memory, i: number, v: number): void {
  if (i < 0x100) m.wram[0xb00 + i] = v;
  else m.hram[0x30 + i - 0x100] = v;
}
const hex = (v: number, n = 2) => v.toString(16).padStart(n, "0");
const addr = (i: number) => (i < 0x100 ? 0xcb00 + i : 0xffb0 + i - 0x100);

/** Runs a recording; returns [calls compared, writes compared, injected bytes, first mismatch]. */
function replay(rom: Uint8Array, calls: Call[]): { calls: number; writes: number; injected: number; error: string | null } {
  const m = new Memory(segments(rom));
  m.selectBank(0x0e);
  const writes: number[] = [];
  m.onSoundWrite = (r, v) => writes.push(r & 0xff, v);
  let prev: Uint8Array | null = null, injected = 0, nw = 0;
  for (let k = 0; k < calls.length; k++) {
    const c = calls[k]!;
    for (let i = 0; i < 272; i++) {
      if (!prev || c.inp[i] !== prev[i]) {
        if (prev) injected++;
        setRam(m, i, c.inp[i]!);
      }
    }
    m.io[0x25] = c.inp[272]!;
    writes.length = 0;
    if (c.kind === 1) soundInit(m);
    else soundUpdate(m);
    const where = `call ${k} (frame ${c.frame}, kind ${c.kind})`;
    for (let i = 0; i < 272; i++) {
      if (getRam(m, i) !== c.out[i]) return { calls: k, writes: nw, injected, error: `${where}: ${hex(addr(i), 4)} = ${hex(getRam(m, i))}, original ${hex(c.out[i]!)}` };
    }
    const w = c.writes;
    const same = w.length === writes.length && writes.every((v, i) => v === w[i]);
    if (!same) {
      const fmt = (a: ArrayLike<number>) => Array.from({ length: a.length / 2 }, (_, i) => `${hex(a[2 * i]!)}=${hex(a[2 * i + 1]!)}`).join(" ");
      return { calls: k, writes: nw, injected, error: `${where}: writes\n  port     ${fmt(writes)}\n  original ${fmt(w)}` };
    }
    nw += w.length / 2;
    prev = c.out;
  }
  return { calls: calls.length, writes: nw, injected, error: null };
}

describe.skipIf(!HAVE)("sound driver parity with the original (PyBoy recordings)", () => {
  const rom = HAVE ? new Uint8Array(readFileSync(ROM)) : new Uint8Array();
  const files = HAVE ? readdirSync(FIX).filter((f) => f.endsWith(".bin.gz")).sort() : [];
  it("has recordings for all songs, the SFX, song changes, the jingle and boot", () => {
    for (let n = 1; n <= 19; n++) expect(files).toContain(`song_${String(n).padStart(2, "0")}.bin.gz`);
    for (const f of ["sfx_all", "sfx_audio", "sfx_overlap", "song_change", "jingle", "boot"]) expect(files).toContain(`${f}.bin.gz`);
  });
  let total = 0, totalWrites = 0;
  for (const f of files) {
    it(`recording ${f}`, () => {
      const calls = load(resolve(FIX, f));
      const r = replay(rom, calls);
      expect(r.error).toBeNull();
      expect(r.calls).toBe(calls.length);
      total += r.calls;
      totalWrites += r.writes;
      console.log(`sound ${f}: ${r.calls} driver calls, ${r.writes} register writes identical (${r.injected} request bytes injected)`);
    });
  }
  it("summary", () => {
    console.log(`sound total: ${total} driver calls, ${totalWrites} register writes identical`);
  });
});

describe("installSound", () => {
  it("selects bank 0E around the driver and restores the previous bank", () => {
    const seg: Record<string, Uint8Array> = {};
    for (let b = 0; b < 16; b++) seg[hex(b)] = new Uint8Array(0x4000);
    const g = new Game(seg);
    installSound(g);
    g.m.selectBank(0x03);
    g.m.wr(0xcb13, 0xff); g.m.wr(0xcb2b, 0xff); g.m.wr(0xcb43, 0xff);
    let bankSeen = -1;
    g.m.onSoundWrite = () => { bankSeen = g.m.hram[0x08]!; };
    g.hooks.soundInit!(g);
    expect(g.m.hram[0x08]).toBe(0x0e);
    g.m.selectBank(0x03);
    g.hooks.soundTick!(g);
    expect(g.m.hram[0x08]).toBe(0x03);
    expect(g.m.bank).toBe(0x03);
    expect(bankSeen).toBe(0x0e);
  });
});
