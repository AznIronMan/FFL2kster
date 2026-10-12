/** Replay a PyBoy trace through the field engine and compare every frame. */
import { field } from "@ffl2k/core";
import { Rig, loadRom, loadTrace, buttonBits, screenDiff, FRAME_BYTES, type Trace } from "./index.js";

export interface WaitDiff {
  wait: number;
  frame: number;
  diff: number[];
}

export interface FrameDiff {
  frame: number;
  pixels: number;
  wram: number[];
  vram: number[];
  oam: number[];
  hram: number[];
}

/** Engine frame k corresponds to PyBoy trace frame k. */
export const OFFSET = 0;

export interface ReplayOptions {
  calls?: Partial<field.FieldCalls>;
  /** Addresses excluded from memory comparison (scratch whose timing differs). */
  ignore?: (addr: number) => boolean;
}

const missing = (what: string) => function* (): Generator<void, void, void> {
  throw new Error(`${what} not expected in this trace`);
};

export function replayField(name: string, opts: ReplayOptions = {}): { trace: Trace; diffs: FrameDiff[]; waits: WaitDiff[]; nWaits: number } {
  const t = loadTrace(name);
  const rom = loadRom();
  const rig = new Rig(rom);
  const m = rig.g.m;
  m.loadFull(t.start);
  const calls: field.FieldCalls = {
    script: missing("script"), startMenu: missing("start menu"), selectMenu: missing("select menu"), event4: missing("event 4"),
    ...opts.calls,
  };
  const fe = new field.FieldEngine(rig.g, rom, calls);
  rig.g.start(fe.loop());
  const n = t.meta.frames.length;
  const ign = opts.ignore ?? (() => false);
  const diffs: FrameDiff[] = [];
  const cmp = (a: Uint8Array, b: Uint8Array, base: number) => {
    const out: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !ign(base + i)) out.push(base + i);
    return out;
  };
  let snap = { wram: m.wram, vram: m.vram, oam: m.oam, hram: m.hram };
  const waits: WaitDiff[] = [];
  let nWaits = 0;
  rig.g.onYield = (kind) => {
    if (kind !== 1) return;
    const i = nWaits++;
    if (!t.waits || (i + 1) * 0x8000 > t.waits.length) return;
    const exp = t.waits.subarray(i * 0x8000, (i + 1) * 0x8000);
    const got = m.snapshotFull();
    const diff: number[] = [];
    for (let a = 0; a < 0x8000; a++) {
      const addr = 0x8000 + a;
      if (addr >= 0xa000 && addr < 0xc000) continue; // battery RAM window
      if (addr >= 0xe000 && addr < 0xfe00) continue; // echo
      if (addr >= 0xfea0 && addr < 0xff00) continue;
      if (got[a] !== exp[a] && !ign(addr)) diff.push(addr);
    }
    if (diff.length) waits.push({ wait: i, frame: t.waitFrames?.[i] ?? -1, diff });
  };
  rig.g.onFrameDone = () => {
    snap = { wram: m.wram.slice(), vram: m.vram.slice(), oam: m.oam.slice(), hram: m.hram.slice() };
  };
  for (let k = -OFFSET; k < n; k++) {
    rig.g.buttons = buttonBits(t.meta.frames[Math.max(0, Math.min(k + OFFSET, n - 1))]!.btn);
    rig.g.runFrame();
    if (k < 0) continue;
    const d: FrameDiff = {
      frame: k,
      pixels: screenDiff(rig.ppu.frame, t.screens.subarray(k * FRAME_BYTES, (k + 1) * FRAME_BYTES)),
      wram: cmp(snap.wram, t.wram.subarray(k * 0x2000, (k + 1) * 0x2000), 0xc000),
      vram: cmp(snap.vram, t.vram.subarray(k * 0x2000, (k + 1) * 0x2000), 0x8000),
      oam: cmp(snap.oam, t.oam.subarray(k * 0xa0, (k + 1) * 0xa0), 0xfe00),
      hram: cmp(snap.hram, t.hram.subarray(k * 0x80, (k + 1) * 0x80), 0xff80),
    };
    if (d.pixels || d.wram.length || d.vram.length || d.oam.length || d.hram.length) diffs.push(d);
  }
  return { trace: t, diffs, waits, nWaits };
}

export function summarizeWaits(w: WaitDiff[]): string {
  return w.slice(0, 8).map((d) => `wait ${d.wait} (frame ${d.frame}): ${d.diff.slice(0, 16).map((x) => x.toString(16)).join(",")}${d.diff.length > 16 ? `,+${d.diff.length - 16}` : ""}`).join("\n");
}

export function summarize(diffs: FrameDiff[]): string {
  const hx = (a: number[]) => a.slice(0, 12).map((x) => x.toString(16)).join(",") + (a.length > 12 ? `,+${a.length - 12}` : "");
  return diffs.slice(0, 10).map((d) => `f${d.frame}: px ${d.pixels} wram[${hx(d.wram)}] vram[${hx(d.vram)}] oam[${hx(d.oam)}] hram[${hx(d.hram)}]`).join("\n");
}
