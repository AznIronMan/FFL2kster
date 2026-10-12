/** Random numbers exactly like 00:043E: per-stream counters at C0A0+stream, values from the
 *  256-byte table at 0F:4000. rand(lo, hi): lo == 0xFF → 0xFF; hi == 0 → 0; hi == lo → lo;
 *  hi - lo == 0xFF → T + lo; else lo + T % (hi - lo + 1). (Verified against the ROM routine.) */
import type { Memory } from "./memory.js";

export const RNG_COUNTERS = 0xc0a0;

export function rand(mem: Memory, stream: number, lo: number, hi: number): number {
  const ca = RNG_COUNTERS + (stream & 0xff);
  const c = (mem.rd(ca) + 1) & 0xff;
  mem.wr(ca, c);
  const t = mem.romAt(0x0f, 0x4000 + c);
  if (lo === 0xff) return 0xff;
  if (hi === 0) return 0;
  if (hi === lo) return lo;
  const span = (hi - lo) & 0xff;
  if (span === 0xff) return (t + lo) & 0xff;
  return (lo + (t % (span + 1))) & 0xff;
}
