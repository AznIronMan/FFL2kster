/** Music driver data: songs, instruments, sound effects, MIDI (port of ffl2kster.music). */
import { Rom } from "./rom.js";

const BANK = 0x0e;
const SONG_TABLE = 0x49f5, DUR_TABLE = 0x4244, FREQ_TABLE = 0x419a, OCT_REL = 0x47b5;
export const NSONGS = 19;
const ARGS: Record<number, number>[] = [
  { 0xe0: 2, 0xe1: 2, 0xe2: 2, 0xe3: 1, 0xe4: 2, 0xe5: 1, 0xe6: 1, 0xe7: 1, 0xe8: 0, 0xe9: 2, 0xea: 1, 0xeb: 3 },
  { 0xe0: 2, 0xe1: 2, 0xe2: 2, 0xe3: 1, 0xe4: 2, 0xe5: 1, 0xe6: 1, 0xe7: 0, 0xe8: 0, 0xe9: 2, 0xea: 1, 0xeb: 3 },
  { 0xe0: 1, 0xe1: 2, 0xe2: 2, 0xe3: 1, 0xe4: 2, 0xe5: 0, 0xe6: 1, 0xe7: 0, 0xe8: 2, 0xe9: 2, 0xea: 1, 0xeb: 3 },
];
const CMD_NAMES: Record<number, string> = { 0xe1: "jump", 0xe2: "loop1", 0xe3: "count1", 0xe4: "vibrato_ptr", 0xe6: "pan", 0xe9: "loop2", 0xea: "count2", 0xeb: "jump_if_count1", 0xe8: "nop" };
const CH_CMD: Record<number, string>[] = [
  { 0xe0: "envelope_ptr", 0xe5: "duty", 0xe7: "tempo" },
  { 0xe0: "envelope_ptr", 0xe5: "duty" },
  { 0xe0: "wave_volume", 0xe8: "wave_ptr" },
];

const off = (a: number) => BANK * 0x4000 + a - 0x4000;
const b = (rom: Rom, a: number) => rom.u8(off(a));
const w = (rom: Rom, a: number) => b(rom, a) | (b(rom, a + 1) << 8);

export function songPointers(rom: Rom, n: number): number[] {
  return [0, 1, 2].map((i) => w(rom, SONG_TABLE + 6 * (n - 1) + 2 * i));
}

export function durations(rom: Rom): number[] {
  return Array.from({ length: 13 }, (_, i) => b(rom, DUR_TABLE + i));
}

export function freqReg(rom: Rom, idx: number): number {
  return w(rom, FREQ_TABLE + 2 * idx) & 0x7ff;
}

export interface SeqEvent { t: number; type: string; dur?: number; index?: number; freq_reg?: number; args?: number[]; to?: number; at?: number }
export interface Channel { events: SeqEvent[]; loop_to: number | null; loop_at: number; length_ticks: number }

export function parseChannel(rom: Rom, ch: number, start: number, maxEvents = 20000): Channel {
  const dur = durations(rom);
  let pc = start, octave = 0, loopTo: number | null = null, c1 = 0, c2 = 0, tick = 0, steps = 0;
  const events: SeqEvent[] = [];
  while (steps < maxEvents) {
    steps++;
    const op = b(rom, pc);
    if (op < 0xd0) {
      const d = op >> 4 < 13 ? dur[op >> 4]! : 0;
      const p = op & 0x0f;
      if (p === 0x0f) events.push({ t: tick, type: "rest", dur: d });
      else if (p === 0x0e) events.push({ t: tick, type: "tie", dur: d });
      else {
        const fi = Math.floor(octave / 2) + p;
        events.push({ t: tick, type: "note", dur: d, index: fi, freq_reg: freqReg(rom, fi) });
      }
      tick += d;
      pc += 1;
    } else if (op < 0xd8) {
      octave = (op & 7) * 24; pc += 1;
    } else if (op < 0xe0) {
      octave = (octave + b(rom, OCT_REL + (op & 7))) & 0xff; pc += 1;
    } else if (op === 0xff) {
      events.push({ t: tick, type: "end" });
      break;
    } else if (ARGS[ch]![op] !== undefined) {
      const n = ARGS[ch]![op]!;
      const args = Array.from({ length: n }, (_, i) => b(rom, pc + 1 + i));
      let nxt = pc + 1 + n;
      if (op === 0xe1) {
        loopTo = args[0]! | (args[1]! << 8);
        events.push({ t: tick, type: "loop", to: loopTo, at: pc });
        break;
      } else if (op === 0xe3) c1 = args[0]!;
      else if (op === 0xea) c2 = args[0]!;
      else if (op === 0xe2 || op === 0xe9) {
        let again: boolean;
        if (op === 0xe2) { c1 = (c1 - 1) & 0xff; again = c1 !== 0; } else { c2 = (c2 - 1) & 0xff; again = c2 !== 0; }
        if (again) nxt = args[0]! | (args[1]! << 8);
      } else if (op === 0xeb) {
        if (c1 === args[0]) nxt = args[1]! | (args[2]! << 8);
      } else {
        const name = CH_CMD[ch]![op] || CMD_NAMES[op] || `cmd_${op.toString(16).toUpperCase().padStart(2, "0")}`;
        events.push({ t: tick, type: name, args });
      }
      pc = nxt;
    } else throw new Error(`invalid byte ${op.toString(16)} at 0E:${pc.toString(16)} (channel ${ch})`);
  }
  const last = events[events.length - 1];
  const endPc = last ? (last.at ?? pc) : pc;
  return { events, loop_to: loopTo, loop_at: endPc, length_ticks: tick };
}

export interface Song { song: number; channels: Channel[] }

export function parseSong(rom: Rom, n: number): Song {
  return { song: n, channels: songPointers(rom, n).map((p, ch) => parseChannel(rom, ch, p)) };
}

export function tempo(song: Song): number | null {
  for (const e of song.channels[0]!.events) if (e.type === "tempo") return e.args![0]!;
  return null;
}

export function hz(reg: number, wave: boolean): number {
  return (wave ? 65536 : 131072) / (2048 - reg);
}

/** Python round(): round half to even. */
function pyRound(x: number): number {
  const f = Math.floor(x), diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function toMidi(song: Song, tpq = 24): Uint8Array {
  const t = tempo(song) || 0x40;
  const tps = (2 * t) / 256 * 59.7275;
  const usq = Math.trunc((1_000_000 * tpq) / tps);
  const vlq = (v: number) => {
    const out = [v & 0x7f];
    v >>= 7;
    while (v) { out.unshift((v & 0x7f) | 0x80); v >>= 7; }
    return out;
  };
  const tracks: number[][] = [];
  song.channels.forEach((c, ch) => {
    const ev: [number, number[]][] = [];
    if (ch === 0) ev.push([0, [0xff, 0x51, 0x03, (usq >> 16) & 0xff, (usq >> 8) & 0xff, usq & 0xff]]);
    ev.push([0, [0xc0 | ch, ch < 2 ? 80 : 81]]);
    let cur: number | null = null;
    for (const e of c.events) {
      if (e.type === "note") {
        if (cur !== null) ev.push([e.t, [0x80 | ch, cur, 0]]);
        const f = hz(e.freq_reg!, ch === 2);
        cur = Math.max(0, Math.min(127, pyRound(69 + 12 * Math.log2(f / 440))));
        ev.push([e.t, [0x90 | ch, cur, 96]]);
      } else if (e.type === "rest" || e.type === "end" || e.type === "loop") {
        if (cur !== null) { ev.push([e.t, [0x80 | ch, cur, 0]]); cur = null; }
      }
    }
    if (cur !== null) ev.push([c.length_ticks, [0x80 | ch, cur, 0]]);
    ev.sort((x, y) => x[0] - y[0]);
    const data: number[] = [];
    let last = 0;
    for (const [tk, msg] of ev) { data.push(...vlq(tk - last), ...msg); last = tk; }
    data.push(0x00, 0xff, 0x2f, 0x00);
    const len = data.length;
    tracks.push([0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, ...data]);
  });
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, 0, tpq];
  return new Uint8Array([...head, ...tracks.flat()]);
}

// ---------------------------------------------------------------- instruments + SFX
export function modList(rom: Rom, ptr: number, signed: boolean, limit = 64, holdFF = false) {
  const steps: [number, number][] = [];
  const seen = new Map<number, number>();
  let p = ptr;
  while (steps.length < limit) {
    if (seen.has(p)) break;
    const d = b(rom, p);
    if (d === 0) {
      const tgt = w(rom, p + 1);
      return { ptr, steps, loop_to: seen.get(tgt) ?? tgt };
    }
    seen.set(p, steps.length);
    const v = b(rom, p + 1);
    steps.push([d, signed && v > 127 ? v - 256 : v]);
    if (holdFF && d === 0xff) return { ptr, steps, loop_to: null, hold: true };
    p += 2;
  }
  return { ptr, steps, loop_to: null };
}

const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, "0");

export function instruments(rom: Rom) {
  const envelopes: Record<string, ReturnType<typeof modList>> = {}, vibratos: Record<string, ReturnType<typeof modList>> = {}, waveforms: Record<string, number[]> = {};
  for (let n = 1; n <= NSONGS; n++) {
    songPointers(rom, n).forEach((start, ch) => {
      for (const e of parseChannel(rom, ch, start).events) {
        const a = e.args ? e.args[0]! | ((e.args[1] ?? 0) << 8) : 0;
        if (e.type === "envelope_ptr") envelopes[hex4(a)] ??= modList(rom, a, false, 64, true);
        else if (e.type === "vibrato_ptr") vibratos[hex4(a)] ??= modList(rom, a, true);
        else if (e.type === "wave_ptr") waveforms[hex4(a)] ??= Array.from({ length: 16 }, (_, i) => b(rom, a + i)).flatMap((x) => [x >> 4, x & 15]);
      }
    });
  }
  return { envelopes, vibratos, waveforms };
}

export const NSFX = 57;
const SFX_PULSE = 0x7ac5, SFX_NOISE = 0x7b37;

export function sfxStream(rom: Rom, ptr: number, regs: number, limit = 256) {
  const out: Record<string, unknown>[] = [];
  let p = ptr;
  while (out.length < limit) {
    const d = b(rom, p);
    if (d === 0) { out.push({ end: true }); break; }
    if (d === 0xef) { out.push({ loop_to: w(rom, p + 1) }); p += 3; continue; }
    if (d >= 0xf0) { out.push({ loop_count: d & 0x0f }); p += 1; continue; }
    out.push({ frames: d, regs: Array.from({ length: regs }, (_, i) => b(rom, p + 1 + i)), at: p });
    p += 1 + regs;
  }
  return out;
}

export function sfx(rom: Rom) {
  return Array.from({ length: NSFX }, (_, i) => ({
    sfx: i + 1,
    pulse: sfxStream(rom, w(rom, SFX_PULSE + 2 * i), 5),
    noise: sfxStream(rom, w(rom, SFX_NOISE + 2 * i), 2),
  }));
}

const SONG_NAMES: Record<number, string> = { 5: "title (probable)", 10: "town (observed)", 12: "world map (observed)", 17: "battle (observed)" };

export function songSummary(rom: Rom) {
  return Array.from({ length: NSONGS }, (_, i) => {
    const s = parseSong(rom, i + 1), t = tempo(s)!;
    return {
      song: i + 1, name: SONG_NAMES[i + 1] ?? null, tempo: t, ticks_per_second: Math.round(2 * t / 256 * 59.7275 * 1000) / 1000,
      channels: s.channels.map((c) => ({ length_ticks: c.length_ticks, loops: c.loop_to !== null, notes: c.events.filter((e) => e.type === "note").length })),
    };
  });
}
