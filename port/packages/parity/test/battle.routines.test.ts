/** Battle routines (bank 0D below 5000, 00:2AE6 / 00:2B14) against the SM83 oracle: for every
 *  routine entry captured in real battles (tools/routine_oracle.py capture bt_* …), the ported
 *  routine must change memory exactly as the ROM routine run in the oracle (run with stubs
 *  0020,01E0 and segment stops, see BATTLE_CAPTURES below), and leave the same live-out registers.
 *  Captures are generated locally from the user's ROM (build/routines) and never committed. */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { haveRom, loadRom, ROOT, Rig } from "../src/index.js";
import type { Memory } from "@ffl2k/core";
import { r0D_4000init, r0D_40ECround, r0D_41BDuses, r0D_42C0transform, r0D_435A, r0D_4361, r0D_437E, r0D_43FA,
  r0D_443A, r0D_449A, r0D_44F4, r0D_4579 } from "../../core/src/battle/main.js";
import { r00_2AE6, r00_2B14setup } from "../../core/src/battle/formation.js";

/** Captures: `python tools/routine_oracle.py capture bt_… battle_… <routines>` (scenarios battle_* in
 *  tools/routine_oracle.py) and variants `… synth SRC bt_syn_… ROUTINE REG|@ADDR values`; oracle run:
 *  python tools/routine_oracle.py run NAME 0020,01E0 --stop 0D:4000=01D4,0D:40EC=4123,0D:41BD=41F1,0D:4044=4047,00:2B14=2CBE,0D:42C0=4349
 *  (0D:4000, 0D:40EC, 0D:41BD, 0D:42C0 and 00:2B14 are code segments ending at the stop address;
 *  0D:4044 is the `call 44F4` of the setup, since 0D:44F4 itself is hooked by the emulator harness). */
const DIR = resolve(ROOT, "build/routines");
/** All captures named bt_* (scenarios battle_* in tools/routine_oracle.py: battle_fight,
 *  battle_walk, battle_run, battle_death, battle_defeat, battle_meat*, battle_meat_mon*). */
export const BATTLE_CAPTURES = existsSync(DIR) ? readdirSync(DIR).filter((n) => n.startsWith("bt_")).sort() : [];

type Ent = { n: number; routine: string; regs: { a: number; f: number; b: number; c: number; d: number; e: number; hl: number }; bank: number };
type Out = { regs: Record<string, number>; calls: number[]; changes: number[][]; stopped?: number };

/** Run the ported routine for an oracle entry; returns the live-out registers it models. */
function* runEntry(rig: Rig, ent: Ent, calls: number[]): Generator<void, Record<string, number>, void> {
  const m: Memory = rig.g.m;
  const r = ent.regs, h = r.hl >> 8, l = r.hl & 0xff;
  switch (ent.routine) {
    case "0D:4000": return { a: r0D_4000init(m) };
    case "0D:40EC": r0D_40ECround(m); return {};
    case "0D:41BD": return { a: r0D_41BDuses(m, (r.e - 0x40) >> 3, r.d - 0xd0) };
    case "0D:435A": { const o = r0D_435A(m, h, l, r.b); return { a: o.a, h: o.h }; }
    case "0D:4361": {
      const a = yield* r0D_4361(rig.engine, r.a, function* (addr) { calls.push(addr); });
      return { a };
    }
    case "0D:437E": r0D_437E(m); return {};
    case "0D:43FA": r0D_43FA(m, r.hl); return {};
    case "0D:443A": r0D_443A(m, r.b); return {};
    case "0D:449A": r0D_449A(m, r.d, r.hl); return {};
    case "0D:4044": r0D_44F4(m, r.d); return {};
    case "0D:4579": r0D_4579(m); return {};
    case "0D:42C0": r0D_42C0transform(m, r.hl); return {};
    case "00:2AE6": return { c: r00_2AE6(m) };
    case "00:2B14": r00_2B14setup(m, r.c); return {};
  }
  throw new Error(`no port for ${ent.routine}`);
}

/** Scratch the VM's arithmetic helpers leave (FF90: A saved; C0E1-C0E2: SP saved by division). */
const VM_SCRATCH = new Set([0xff90, 0xc0e1, 0xc0e2]);

// Without captured fixtures (CI has no ROM) the file still declares a (skipped) suite.
describe.skipIf(BATTLE_CAPTURES.length === 0 || !haveRom())("battle routine captures", () => {
  it("are present", () => expect(BATTLE_CAPTURES.length).toBeGreaterThan(0));
});

for (const cap of BATTLE_CAPTURES) {
  const idxPath = resolve(DIR, cap, "index.json");
  const have = haveRom() && existsSync(idxPath) && existsSync(resolve(DIR, cap, "0000.out.json"));
  describe.skipIf(!have)(`battle routines vs SM83 oracle: ${cap}`, () => {
    const rom = have ? loadRom() : new Uint8Array();
    const idx: Ent[] = have ? JSON.parse(readFileSync(idxPath, "utf8")) : [];
    it("has cases", () => expect(idx.length).toBeGreaterThan(0));
    for (const ent of idx) {
      it(`${ent.routine} #${ent.n}`, () => {
        const out: Out = JSON.parse(readFileSync(resolve(DIR, cap, `${String(ent.n).padStart(4, "0")}.out.json`), "utf8"));
        const rig = new Rig(rom);
        const m = rig.g.m;
        m.loadFull(new Uint8Array(readFileSync(resolve(DIR, cap, `${String(ent.n).padStart(4, "0")}.bin`))));
        m.selectBank(ent.bank || 1);
        const before = m.snapshotFull();
        const calls: number[] = [];
        const co = runEntry(rig, ent, calls);
        let x = co.next();
        while (!x.done) x = co.next();
        const regs = x.value;
        const after = m.snapshotFull();
        const vm = ent.routine === "0D:4361";
        const changes: number[][] = [];
        for (let i = 0; i < 0x8000; i++) {
          const a = 0x8000 + i;
          if ((a >= 0xe000 && a < 0xfe00) || (a >= 0xfea0 && a < 0xff00) || a >= 0xffc0) continue;
          if (vm && VM_SCRATCH.has(a)) continue;
          if (before[i] !== after[i]) changes.push([a, before[i]!, after[i]!]);
        }
        const expected = out.changes.filter(([a]) => !((a! >= 0xe000 && a! < 0xfe00) || (a! >= 0xfea0 && a! < 0xff00) || (vm && VM_SCRATCH.has(a!))));
        expect(changes.map(hexc)).toEqual(expected.map(hexc));
        expect(m.hram[0x08]).toBe(out.bank);
        if (vm) expect(calls).toEqual(out.calls);
        const live: Record<string, number> = {};
        for (const k of Object.keys(regs)) live[k] = out.regs[k]!;
        expect(regs).toEqual(live);
      });
    }
  });
}

const hexc = (c: number[]) => `${c[0]!.toString(16)}:${c[1]!.toString(16)}>${c[2]!.toString(16)}`;
