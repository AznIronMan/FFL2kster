/** Encounter formations and the transition into battle (bank 0, 00:2ADF-2B89).
 *
 *  Field script code 09 (00:0EC5, TextEngine.battle) calls 00:191E (random formation for the
 *  zone) or 00:190F with C = formation, then far-calls the battle main loop 0D:4000.
 *  Tables (bank 0D, read from the user's ROM at run time):
 *   - 0D:6560: 7 descending thresholds; 0D:6570 + 8·zone: the 8 formations of zone C454;
 *   - 0D:6C70 + 5·n: formation n = 3 enemy ids, then two flag bytes (the second is used when
 *     bit 7 of C is set): bits 7-6 = music/ambush kind (CFE9), bit 5 = no escape, bits 0-4 =
 *     count ranges row;
 *   - 0D:6EF0 + 3·row: per group a count range byte (hi nibble min, lo nibble max).
 *  Results: CFE0/CFE2/CFE4 = counts, CFE1/CFE3/CFE5 = enemy ids, CFE9 = kind, CFEA = D844 = flags.
 *  (verified against the SM83 oracle, see parity/test/battle.routines.test.ts) */
import type { Co, Game } from "../game.js";
import type { Memory } from "../memory.js";
import { rand } from "../rng.js";
import { splitOpen } from "../field/effects.js";

/** 00:2AE6 — formation for the encounter zone C454: rand(stream 0A, 0-255) against the
 *  thresholds 0D:6560 picks one of the zone's 8 formations (0D:6570 + 8·zone). Maps bank 0D
 *  (FF88) and leaves it mapped, like the original's rst $28. Returns C. */
export function r00_2AE6(m: Memory): number {
  const base = (0x6570 + 8 * m.rd(0xc454)) & 0xffff;
  m.selectBank(0x0d);
  const r = rand(m, 0x0a, 0x00, 0xff);
  let hl = 0x6560, c = 0;
  for (let b = 7; b > 0; b--) {
    if (r >= m.romAt(0x0d, hl)) break;
    hl++;
    c++;
  }
  return m.romAt(0x0d, base + c);
}

/** 00:2B14 up to 00:2B86 — formation C (bit 7: alternative flag byte): enemy ids and flags from
 *  0D:6C70 + 5·(C & 0x7F), group counts rand(stream 0B, min, max) from 0D:6EF0 + 3·row;
 *  requests sound effect 0x28 (FFB2). */
export function r00_2B14setup(m: Memory, c: number): void {
  const n = c & 0x7f;
  let hl = 0x6c70 + 5 * n;
  for (let i = 0; i < 3; i++) m.wr(0xcfe1 + 2 * i, m.romAt(0x0d, hl++));
  if (c & 0x80) hl++;
  const f = m.romAt(0x0d, hl);
  m.wr(0xcfe9, (f & 0xc0) >> 6);
  m.wr(0xd844, f);
  m.wr(0xcfea, f);
  hl = 0x6ef0 + 3 * (f & 0x1f);
  for (let i = 0; i < 3; i++) {
    const v = m.romAt(0x0d, hl++);
    m.wr(0xcfe0 + 2 * i, rand(m, 0x0b, v >> 4, v & 0x0f));
  }
  m.hram[0x32] = 0x28; // FFB2: sound effect request
}

/** 00:2B14 (00:190F) — set up formation C, then the split opening into battle (00:2CBE). */
export function* r00_2B14(g: Game, c: number): Co {
  r00_2B14setup(g.m, c);
  yield* splitOpen(g);
}

/** 00:2ADF (00:191E) — random formation for the zone, set up, transition. Bank 0D stays mapped
 *  (00:2AE6); the caller (00:0EC5) restores its bank. */
export function* r00_2ADF(g: Game): Co {
  const c = r00_2AE6(g.m);
  yield* r00_2B14(g, c);
}
