/** Legend III music (bank 0F; docs/ffl3/FINDINGS.md M7): the song table, the per-channel byte
 *  streams and a frame-level model of the driver's sequencing (0F:4006). Mirrors ffl3kster.music. */
import { fileOffset, u16 } from "./rom.js";

export const SONG_COUNT = 20;
export const CHANNELS = ["pulse1", "pulse2", "wave", "noise"] as const;
const SONGS = 0x482f, DURATIONS = fileOffset(0x0f, 0x41be);
const COMMAND_TABLES = [0x4428, 0x4448, 0x4468, 0x4488];
/** handler address -> operand bytes (0F:44A8-4615) */
export const HANDLER_OPS: Record<number, number> = { 0x44a8: 1, 0x44b0: 2, 0x44b5: 2, 0x44ba: 2, 0x44bf: 2, 0x44c4: 2, 0x44c9: 2,
  0x44d3: 1, 0x44d9: 1, 0x44df: 1, 0x44e5: 1, 0x44eb: 1, 0x44f1: 1, 0x44f7: 1, 0x44fd: 1,
  0x4503: 2, 0x4508: 2, 0x450d: 2, 0x4512: 2, 0x4517: 2, 0x451c: 2, 0x4521: 2, 0x4526: 2,
  0x452f: 3, 0x4534: 3, 0x4539: 3, 0x453e: 3, 0x4548: 2, 0x454e: 1, 0x4556: 1, 0x4565: 1,
  0x456b: 2, 0x458f: 7, 0x459b: 1, 0x45ac: 6, 0x45b5: 1, 0x45cf: 6, 0x45d8: 1, 0x45e9: 1, 0x4613: 1 };
const LOOP_A = new Set([0x4503, 0x4508, 0x450d, 0x4512]);
const LOOP_B = new Set([0x4517, 0x451c, 0x4521, 0x4526]);
const SET_A = new Set([0x44d3, 0x44d9, 0x44df, 0x44e5]);
const SET_B = new Set([0x44eb, 0x44f1, 0x44f7, 0x44fd]);
const CMP_A = new Set([0x452f, 0x4534, 0x4539, 0x453e]);
const JUMP = 0x4548, TEMPO = 0x4565, SETUP1 = 0x458f, HANG = 0x4616;

const at = (rom: Uint8Array, addr: number): number => rom[fileOffset(0x0f, addr)]!;
const ops = (rom: Uint8Array, addr: number, n: number): number[] => Array.from({ length: n }, (_, i) => at(rom, addr + i));

export function songPointers(rom: Uint8Array, n: number): number[] {
  if (n < 1 || n > SONG_COUNT) throw new Error(`song ${n} out of range 1..${SONG_COUNT}`);
  return [0, 1, 2, 3].map((c) => u16(rom, fileOffset(0x0f, SONGS + 8 * (n - 1) + 2 * c)));
}

export const handler = (rom: Uint8Array, ch: number, cmd: number): number => u16(rom, fileOffset(0x0f, COMMAND_TABLES[ch]! + 2 * (cmd & 0x0f)));

export class Channel {
  stopped = false;
  count = 1;
  a = 0;
  b = 0;
  constructor(readonly rom: Uint8Array, readonly ch: number, public ptr: number) {}

  tick(song: Song): void {
    if (this.stopped) return;
    this.count = (this.count - 1) & 0xff;
    if (this.count) return;
    const rom = this.rom;
    for (;;) {
      const c = at(rom, this.ptr++);
      if (c < 0xe0) { this.count = rom[DURATIONS + (c & 0x0f)]!; return; }
      if (c === 0xff) { this.stopped = true; this.ptr--; return; }   // the stored pointer stays on the FF (0F:4217)
      if (c < 0xf0) continue;
      const h = handler(rom, this.ch, c);
      if (h === HANG) throw new Error(`channel ${this.ch} command ${c.toString(16)} hangs the driver`);
      const o = ops(rom, this.ptr, HANDLER_OPS[h]!);
      if (h === JUMP) { this.ptr = o[0]! | (o[1]! << 8); continue; }
      if (LOOP_A.has(h) || LOOP_B.has(h)) {
        let v: number;
        if (LOOP_A.has(h)) v = this.a = (this.a - 1) & 0xff;
        else v = this.b = (this.b - 1) & 0xff;
        this.ptr = v ? o[0]! | (o[1]! << 8) : this.ptr + 2;
        continue;
      }
      if (CMP_A.has(h)) { this.ptr = o[0] === this.a ? o[1]! | (o[2]! << 8) : this.ptr + 3; continue; }
      if (SET_A.has(h)) this.a = o[0]!;
      else if (SET_B.has(h)) this.b = o[0]!;
      else if (h === TEMPO || h === SETUP1) song.tempo = o[0]!;
      this.ptr += o.length;
    }
  }
}

/** Frame-level model of the driver for one song: CB00 += CB01 each frame; a carry ticks every channel twice. */
export class Song {
  tempo = 0x3c;
  acc = 0xff;
  readonly channels: Channel[];
  constructor(rom: Uint8Array, n: number) { this.channels = songPointers(rom, n).map((p, c) => new Channel(rom, c, p)); }

  frame(): void {
    this.acc += this.tempo;
    if (this.acc > 0xff) {
      this.acc &= 0xff;
      for (let k = 0; k < 2; k++) for (const ch of this.channels) ch.tick(this);
    }
  }
  pointers(): number[] { return this.channels.map((c) => c.ptr); }
  state(): string { return [this.acc, this.tempo, ...this.channels.map((c) => `${c.ptr},${c.count},${c.a},${c.b},${+c.stopped}`)].join("|"); }
}

export function trace(rom: Uint8Array, n: number, frames: number): number[][] {
  const s = new Song(rom, n), out: number[][] = [];
  for (let f = 0; f < frames; f++) { s.frame(); out.push(s.pointers()); }
  return out;
}

/** [first frame of the repeating part, period in frames] of the driver state, or [-1, -1]. */
export function songLoop(rom: Uint8Array, n: number, limit = 60000): [number, number] {
  const s = new Song(rom, n), seen = new Map<string, number>();
  for (let f = 0; f < limit; f++) {
    s.frame();
    const k = s.state(), p = seen.get(k);
    if (p !== undefined) return [p, f - p];
    seen.set(k, f);
  }
  return [-1, -1];
}

/** [first tick of the repeating part, period in ticks] of one channel, or [-1, 0] when it ends. */
export function channelLoop(rom: Uint8Array, n: number, ch: number, limit = 200000): [number, number] {
  const s = new Song(rom, n), c = s.channels[ch]!, seen = new Map<string, number>();
  for (let t = 0; t < limit; t++) {
    c.tick(s);
    if (c.stopped) return [-1, 0];
    const k = `${c.ptr},${c.count},${c.a},${c.b}`, p = seen.get(k);
    if (p !== undefined) return [p, t - p];
    seen.set(k, t);
  }
  return [-1, -1];
}

export type MusicEvent =
  | { at: number; note: number; length: number }
  | { at: number; end: true }
  | { at: number; octave: number }
  | { at: number; shift: number }
  | { at: number; cmd: number; ops: number[] };

/** Each channel's byte stream from its start, every reachable byte once (jumps followed). */
export function events(rom: Uint8Array, n: number): MusicEvent[][] {
  return songPointers(rom, n).map((start, ch) => {
    const todo = [start], seen = new Set<number>(), ev: MusicEvent[] = [];
    while (todo.length) {
      let p = todo.pop()!;
      while (!seen.has(p)) {
        seen.add(p);
        const c = at(rom, p);
        if (c < 0xe0) { ev.push({ at: p, note: c >> 4, length: rom[DURATIONS + (c & 0x0f)]! }); p++; continue; }
        if (c === 0xff) { ev.push({ at: p, end: true }); break; }
        if (c < 0xf0) { ev.push(c < 0xe8 ? { at: p, octave: c & 7 } : { at: p, shift: c & 7 }); p++; continue; }
        const h = handler(rom, ch, c), o = ops(rom, p + 1, HANDLER_OPS[h]!);
        ev.push({ at: p, cmd: c, ops: o });
        if (h === JUMP) { todo.push(o[0]! | (o[1]! << 8)); break; }
        if (LOOP_A.has(h) || LOOP_B.has(h)) todo.push(o[0]! | (o[1]! << 8));
        if (CMP_A.has(h)) todo.push(o[1]! | (o[2]! << 8));
        p += 1 + o.length;
      }
    }
    return ev.sort((x, y) => x.at - y.at);
  });
}

const h4 = (v: number): string => v.toString(16).toUpperCase().padStart(4, "0");

export function exportMusic(rom: Uint8Array) {
  return { songs: Array.from({ length: SONG_COUNT }, (_, i) => {
    const n = i + 1, [start_frame, period_frames] = songLoop(rom, n), ev = events(rom, n);
    return { song: n, pointers: songPointers(rom, n).map(h4), loop: { start_frame, period_frames },
      channel_loops_ticks: Object.fromEntries(CHANNELS.map((name, c) => { const [start, period] = channelLoop(rom, n, c); return [name, { start, period }]; })),
      channels: Object.fromEntries(CHANNELS.map((name, c) => [name, ev[c]])) };
  }) };
}
