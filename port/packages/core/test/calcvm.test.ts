/** Calc VM parity: for every captured real invocation (tools/vm_snapshots.py), the TypeScript
 *  interpreter must leave memory exactly as the ROM interpreter does in the SM83 oracle
 *  (tools/vm_oracle.py) and request the same messages/animations in the same order.
 *  Excluded scratch: FF90 (arithmetic helpers save A there) and C0E1-C0E2 (division saves SP). */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Memory, CalcVm } from "../src/index.js";

const ROOT = resolve(__dirname, "../../../..");
const ROM = process.env.FFL2K_ROM ?? resolve(ROOT, "input/original.gb");
const SNAP = resolve(ROOT, "build/vm_snapshots");
const GOLD = resolve(ROOT, "build/golden/vm");
const HAVE = existsSync(ROM) && existsSync(GOLD);
const IGNORE = new Set([0xff90, 0xc0e1, 0xc0e2]);

function segments(rom: Uint8Array) {
  const s: Record<string, Uint8Array> = {};
  for (let b = 0; b < 16; b++) s[b.toString(16).padStart(2, "0")] = rom.slice(b * 0x4000, (b + 1) * 0x4000);
  return s;
}

describe.skipIf(!HAVE)("calc VM parity with the ROM interpreter", () => {
  const rom = HAVE ? new Uint8Array(readFileSync(ROM)) : new Uint8Array();
  const files = HAVE ? readdirSync(GOLD).filter((f) => f.endsWith(".json")).sort() : [];
  it("has oracle cases", () => expect(files.length).toBeGreaterThan(40));
  for (const f of files) {
    it(`snapshot ${f}`, () => {
      const g = JSON.parse(readFileSync(resolve(GOLD, f), "utf8"));
      const mem = new Memory(segments(rom));
      const snap = new Uint8Array(readFileSync(resolve(SNAP, f.replace(".json", ".bin"))));
      mem.loadSnapshot(snap);
      const before = mem.snapshot();
      const events: object[] = [];
      const vm = new CalcVm(mem, {
        native(addr, m) {
          if (addr === 0x0020) events.push({ type: "message", id: m.rd(0xd90c), args: Array.from({ length: 12 }, (_, i) => m.rd(0xd900 + i)) });
          else if (addr === 0x01e0) events.push({ type: "anim", id: m.rd(0xd910), sfx: m.rd(0xffb2) });
          else throw new Error(`native ${addr}`);
        },
      });
      vm.runScript(g.script);
      const after = mem.snapshot();
      const changes: number[][] = [];
      for (let i = 0; i < 0x4000; i++) {
        const a = 0xc000 + i;
        if (a >= 0xe000 && a < 0xfe00) continue; // echo RAM
        if (before[i] !== after[i] && a < 0xffc0 && !IGNORE.has(a)) changes.push([a, before[i]!, after[i]!]);
      }
      const expected = (g.changes as number[][]).filter((c) => !IGNORE.has(c[0]!) && !(c[0]! >= 0xe000 && c[0]! < 0xfe00));
      expect(events).toEqual(g.events);
      expect(changes).toEqual(expected);
    });
  }
});

describe.skipIf(!HAVE)("calc VM generator variant (runScriptCo) parity with the ROM interpreter", () => {
  const rom = HAVE ? new Uint8Array(readFileSync(ROM)) : new Uint8Array();
  const files = HAVE ? readdirSync(GOLD).filter((f) => f.endsWith(".json")).sort() : [];
  for (const f of files) {
    it(`snapshot ${f}`, () => {
      const g = JSON.parse(readFileSync(resolve(GOLD, f), "utf8"));
      const mem = new Memory(segments(rom));
      const snap = new Uint8Array(readFileSync(resolve(SNAP, f.replace(".json", ".bin"))));
      mem.loadSnapshot(snap);
      mem.bank = mem.hram[0x08]! & 0x1f || 1;
      const before = mem.snapshot();
      const bankBefore = mem.bank;
      const events: object[] = [];
      let frames = 0, bankInNative = -1;
      const vm = new CalcVm(mem);
      const co = vm.runScriptCo(g.script, function* (addr, m) {
        bankInNative = m.hram[0x08]!;
        if (addr === 0x0020) events.push({ type: "message", id: m.rd(0xd90c), args: Array.from({ length: 12 }, (_, i) => m.rd(0xd900 + i)) });
        else if (addr === 0x01e0) events.push({ type: "anim", id: m.rd(0xd910), sfx: m.rd(0xffb2) });
        else throw new Error(`native ${addr}`);
        yield; // a native that waits a frame
      });
      while (!co.next().done) frames++;
      const after = mem.snapshot();
      const changes: number[][] = [];
      for (let i = 0; i < 0x4000; i++) {
        const a = 0xc000 + i;
        if (a >= 0xe000 && a < 0xfe00) continue; // echo RAM
        if (before[i] !== after[i] && a < 0xffc0 && !IGNORE.has(a)) changes.push([a, before[i]!, after[i]!]);
      }
      const expected = (g.changes as number[][]).filter((c) => !IGNORE.has(c[0]!) && !(c[0]! >= 0xe000 && c[0]! < 0xfe00));
      expect(events).toEqual(g.events);
      expect(frames).toBe(g.events.length);
      if (g.events.length) expect(bankInNative).toBe(0x0c); // natives run with bank 0C mapped (FF88)
      expect(mem.bank).toBe(bankBefore);
      expect(changes).toEqual(expected);
    });
  }
});
