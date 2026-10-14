/** Legend III routines ported without a recorded trace reaching them (1.47.0), checked on a
 *  synthetic cartridge (no game content): the battle script natives 0C:499B, 0C:6B55, 0C:7E35
 *  and the battle OAM 09:410C. Each expectation is worked out by hand from the listing. */
import { describe, expect, it } from "vitest";
import { Game, nativeRoutines, battleOam } from "@ffl3k/core";

function cart(bank: number, plant: Record<number, number[]> = {}): Game {
  const segs: Record<string, Uint8Array> = {};
  for (let b = 0; b < 16; b++) {
    const s = new Uint8Array(0x4000);
    for (let i = 0; i < s.length; i++) s[i] = (i * 7 + b) & 0xff;
    segs[b.toString(16).padStart(2, "0")] = s;
  }
  for (const [at, bytes] of Object.entries(plant)) {
    const a = Number(at), seg = segs[(a >> 16).toString(16).padStart(2, "0")]!;
    bytes.forEach((v, i) => { seg[(a & 0x3fff) + i] = v; });
  }
  const g = new Game(segs);
  g.m.bank = bank;
  g.m.wr(0xc0b1, bank);
  return g;
}

function native(g: Game, at: number): void {
  const fn = nativeRoutines.get(at);
  expect(fn, `native 0C:${at.toString(16)}`).toBeDefined();
  const it = fn!(g);
  for (let r = it.next(); !r.done; r = it.next()) { /* no waits */ }
}

describe("FFL3 routines without a trace", () => {
  it("0C:499B — the monster copied into the group's first slot that left it", () => {
    const g = cart(0x0c), m = g.m;
    m.wr(0xd87a, 1); // group 1
    m.wr(0xd895, 0xe0); // its slots 7, 6, 5
    m.wr(0xcc5f, 0x80); // slot 7 still in: 6 and 5 have left, 6 is taken
    m.wr(0xc9d6, 0x0c); // the monster D600
    for (let i = 0; i < 0x80; i++) m.wr(0xd600 + i, i ^ 0x5a);
    native(g, 0x499b);
    expect(m.rd(0xcc5f)).toBe(0xc0);
    expect(m.rd(0xc985)).toBe(0x0b); // slot 6 + 5
    for (let i = 0; i < 0x80; i++) expect(m.rd(0xd580 + i)).toBe(i ^ 0x5a);
  });

  it("0C:7E35 — C985-C987 from 0C:7E3E (999999)", () => {
    const g = cart(0x0c, { [0x0c3e3e]: [0x0f, 0x42, 0x3f] }), m = g.m;
    native(g, 0x7e35);
    expect([m.rd(0xc985), m.rd(0xc986), m.rd(0xc987)]).toEqual([0x0f, 0x42, 0x3f]);
  });

  it("0C:6B55 — D888 from the table C97B, half step, bank 0C back", () => {
    const g = cart(0x0c), m = g.m;
    m.wr16(0xc97b, 0xd900);
    m.wr(0xc995, 5); // >> 1 = 2
    m.wr(0xc96e, 3); // (3 - 1) & FE = 2
    for (let i = 0; i < 32; i++) m.wr(0xd900 + i, 0x40 + i);
    native(g, 0x6b55);
    expect(m.rd(0xd888)).toBe(0x44);
    expect(m.bank).toBe(0x0c);
  });

  it("09:410C — the battle OAM rows from 09:412F", () => {
    const row = Array.from({ length: 16 }, (_, i) => 0xa0 + i);
    const g = cart(0x09, { [0x09412f]: row }), m = g.m;
    battleOam(g);
    for (const base of [0xc050, 0xc060, 0xc070, 0xc090]) {
      expect(Array.from({ length: 16 }, (_, i) => m.rd(base + i)), base.toString(16)).toEqual(row);
    }
    expect(m.rd(0xc080)).toBe(0); // the row between is not touched
  });
});
