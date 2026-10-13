/** Legend I music sequences (driver bank 07, song table 07:462F, durations 07:4403). Mirrors
 *  src/ffl1kster/music.py; loop periods were verified frame-exactly against the ROM in PyBoy. */
import { fileOffset } from "./rom.js";

export const SONG_COUNT = 18;
const SONGS = fileOffset(0x07, 0x462f);
const DURATIONS = fileOffset(0x07, 0x4403);
const ARGS: Record<number, number> = { 0xe0: 1, 0xf5: 1, 0xf7: 1, 0xf8: 1, 0xfc: 2, 0xfd: 2, 0xfe: 2 };

export type MusicEvent = { pc: number; op: "note"; pitch: number; ticks: number } | { pc: number; op: "end" } | { pc: number; op: string; args: string };
export interface Channel { events: MusicEvent[]; loop: number | null; intro_ticks: number; loop_ticks: number; tempo: number | null; end: boolean }

export const durations = (rom: Uint8Array): number[] => Array.from(rom.subarray(DURATIONS, DURATIONS + 15));
export const songPointers = (rom: Uint8Array, s: number): number[] =>
  [0, 1, 2].map((k) => rom[SONGS + 6 * s + 2 * k]! | (rom[SONGS + 6 * s + 2 * k + 1]! << 8));

const ticksOf = (e: MusicEvent) => ("ticks" in e ? e.ticks : 0);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function decodeChannel(rom: Uint8Array, ptr: number, maxEvents = 20000): Channel {
  const dur = durations(rom);
  const events: MusicEvent[] = [];
  const seen = new Map<string, number>();
  let counter = 0, tempo: number | null = null, pc = ptr;
  for (let n = 0; n < maxEvents; n++) {
    const key = `${pc},${counter}`;
    const at = seen.get(key);
    if (at !== undefined) {
      const t = events.map(ticksOf);
      return { events, loop: at, intro_ticks: sum(t.slice(0, at)), loop_ticks: sum(t.slice(at)), tempo, end: false };
    }
    seen.set(key, events.length);
    const o = fileOffset(0x07, pc);
    const b = rom[o]!;
    if (b < 0xe0) { events.push({ pc, op: "note", pitch: b >> 4, ticks: dur[b & 15]! }); pc += 1; continue; }
    if (b === 0xff) {
      events.push({ pc, op: "end" });
      return { events, loop: null, intro_ticks: sum(events.map(ticksOf)), loop_ticks: 0, tempo, end: true };
    }
    const na = ARGS[b] ?? 0;
    const arg = rom.subarray(o + 1, o + 1 + na);
    events.push({ pc, op: b.toString(16).toUpperCase(), args: Array.from(arg, (v) => v.toString(16).padStart(2, "0")).join("") });
    pc += 1 + na;
    const target = na === 2 ? arg[0]! | (arg[1]! << 8) : 0;
    if (b === 0xe0) tempo = tempo || arg[0]!;
    else if (b >= 0xf9 && b <= 0xfb) counter = b - 0xf8;
    else if (b === 0xfc) { if (counter) { counter--; pc = target; } }
    else if (b === 0xfd) { if (counter === 0) pc = target; }
    else if (b === 0xfe) pc = target;
  }
  throw new Error("channel did not loop or end");
}

export interface Song { id: number; pointers: number[]; tempo: number | null; channels: Channel[] }

export function song(rom: Uint8Array, s: number): Song {
  const pointers = songPointers(rom, s);
  const channels = pointers.map((p) => decodeChannel(rom, p));
  return { id: s, pointers, tempo: channels.find((c) => c.tempo)?.tempo ?? null, channels };
}

export const exportMusic = (rom: Uint8Array) => ({ durations: durations(rom), songs: Array.from({ length: SONG_COUNT }, (_, s) => song(rom, s)) });
