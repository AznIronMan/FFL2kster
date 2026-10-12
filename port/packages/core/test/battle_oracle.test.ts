/** Battle display/animation routines without frame waits vs the ROM routines in the SM83 oracle:
 *  for every snapshot captured at a routine's entry during real battles (tools/bd_capture.py
 *  snaps → build/routines/bd_nowait, run by tools/routine_oracle.py), the port's routine must
 *  change memory exactly like the original (8000-FFBF) and return the same output registers. */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Memory } from "../src/index.js";
import {
  groupTiles, groupMapAddr, enemyTileOffsets, enemyLayout, enemySizes, enemyGraphicSource, readBank0F,
  composeSprite, animFrame, polar, particlesDone, targetColumn,
} from "../src/battle/index.js";

const ROOT = resolve(__dirname, "../../../..");
const ROM = process.env.FFL2K_ROM ?? resolve(ROOT, "input/original.gb");
const DIR = resolve(ROOT, "build/routines/bd_nowait");
const HAVE = existsSync(ROM) && existsSync(resolve(DIR, "index.json"));

interface Ent { n: number; routine: string; regs: { a: number; b: number; c: number; d: number; e: number; hl: number }; bank: number }
interface Out { regs: Record<string, number>; changes: [number, number, number][] }
type R = Record<string, number>;

/** Each routine: run on the memory with the entry registers; returns the output registers
 *  (h/l split) that the routine defines. */
const RUN: Record<string, (m: Memory, r: Ent["regs"]) => R> = {
  "0F:6180": (m) => { const o = groupTiles(m); return { a: o.a, b: o.b, c: o.c, d: o.d, h: o.hl >> 8, l: o.hl & 0xff }; },
  "0F:61CA": (m, r) => { const hl = groupMapAddr(m, r.a); return { a: r.a, b: r.b, c: r.c, d: r.d, e: r.e, h: hl >> 8, l: hl & 0xff }; },
  "0F:6257": (m, r) => ({ a: enemyTileOffsets(m, r.a) }),
  "0D:525B": (m) => ({ a: enemyLayout(m) }),
  "0D:52E0": (m) => ({ a: enemySizes(m) }),
  "0D:5302": (m) => { const o = enemyGraphicSource(m); return { a: o.a, b: o.bc >> 8, c: o.bc & 0xff, d: o.d, h: o.hl >> 8, l: o.hl & 0xff }; },
  "0D:60B9": (m, r) => { const o = readBank0F(m, r.hl); return { a: o.a, h: o.hl >> 8, l: o.hl & 0xff }; },
  "0D:6082": (m, r) => { const hl = composeSprite(m, r.a, r.b, r.c, r.hl); return { a: r.a, d: r.d, e: r.e, h: hl >> 8, l: hl & 0xff }; },
  "0D:50E7": (m, r) => { animFrame(m, r.a); return {}; },
  "0D:5F61": (m, r) => { const o = polar(m, r.e, r.d, r.b, r.c); return { a: r.a, b: o.b, c: o.c, d: r.d, e: r.e }; },
  "0D:6057": (m) => ({ c: particlesDone(m) }),
  "0D:5240": (m) => { targetColumn(m); return {}; },
};

function segments(rom: Uint8Array) {
  const s: Record<string, Uint8Array> = {};
  for (let b = 0; b < rom.length / 0x4000; b++) s[b.toString(16).padStart(2, "0")] = rom.slice(b * 0x4000, (b + 1) * 0x4000);
  return s;
}

const skip = (a: number) => (a >= 0xa000 && a < 0xc000) || (a >= 0xe000 && a < 0xfe00) || (a >= 0xfea0 && a < 0xff00) || a >= 0xffc0;

describe.skipIf(!HAVE)("battle display/animation routines vs the SM83 oracle", () => {
  const rom = HAVE ? new Uint8Array(readFileSync(ROM)) : new Uint8Array();
  const idx: Ent[] = HAVE ? JSON.parse(readFileSync(resolve(DIR, "index.json"), "utf8")) : [];
  const by = new Map<string, Ent[]>();
  for (const e of idx) by.set(e.routine, [...(by.get(e.routine) ?? []), e]);
  it("covers every routine with many entries", () => {
    for (const k of Object.keys(RUN)) expect(by.get(k)?.length ?? 0, k).toBeGreaterThanOrEqual(k === "0D:5F61" ? 20 : 50);
  });
  for (const [routine, ents] of [...by].sort()) {
    it(`${routine}: ${ents.length} snapshots`, () => {
      const f = RUN[routine];
      expect(f, routine).toBeDefined();
      const bad: string[] = [];
      for (const e of ents) {
        const m = new Memory(segments(rom));
        const snap = new Uint8Array(readFileSync(resolve(DIR, `${String(e.n).padStart(4, "0")}.bin`)));
        m.loadFull(snap);
        m.bank = e.bank & 0x1f || 1;
        const before = m.snapshotFull();
        const regs = f!(m, e.regs);
        const after = m.snapshotFull();
        const got: [number, number, number][] = [];
        for (let i = 0; i < 0x8000; i++) {
          const a = 0x8000 + i;
          if (!skip(a) && before[i] !== after[i]) got.push([a, before[i]!, after[i]!]);
        }
        const out: Out = JSON.parse(readFileSync(resolve(DIR, `${String(e.n).padStart(4, "0")}.out.json`), "utf8"));
        const exp = out.changes.filter(([a]) => !skip(a));
        const regDiff = Object.entries(regs).filter(([k, v]) => out.regs[k] !== (v & 0xff)).map(([k, v]) => `${k}=${out.regs[k]!.toString(16)}/${(v & 0xff).toString(16)}`);
        const memDiff = JSON.stringify(got) !== JSON.stringify(exp);
        if (regDiff.length || memDiff) {
          const ea = new Map(exp.map(([a, , v]) => [a, v])), ga = new Map(got.map(([a, , v]) => [a, v]));
          const addrs = [...new Set([...ea.keys(), ...ga.keys()])].filter((a) => ea.get(a) !== ga.get(a)).slice(0, 6);
          bad.push(`#${e.n} regs[${regDiff.join(" ")}] mem[${addrs.map((a) => `${a.toString(16)}=${ea.get(a)?.toString(16)}/${ga.get(a)?.toString(16)}`).join(" ")}]`);
        }
      }
      expect(bad.slice(0, 5)).toEqual([]);
    });
  }
});
