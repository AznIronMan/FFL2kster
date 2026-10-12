/** Battle menus (bank 1, 01:6AD1-6FCD) against PyBoy: each routine is resumed from a snapshot
 *  taken at its entry, fed the trace's buttons, and must produce the same screens, the same
 *  machine state at every frame wait, and the same state when it returns to the battle code.
 *  Traces (generated locally from the user's ROM and save states, never committed), from the
 *  repository root:
 *    P="none:20,a:3,none:30,down:3,none:15,a:3,none:15,up:3,none:15,a:3,none:30,a:3,none:30,a:3,none:30,b:3,none:30,b:3,none:30,a:3,none:30,a:3,none:30,a:3,none:30,a:3,none:30,a:3,none:30,a:3,none:30,a:3,none:30,a:3,none:30,down:3,none:15,down:3,none:15,a:3,none:30,down:3,none:15,a:3,none:40"
 *    python3 tools/trace_record.py bm_cmd1 pre_battle "$P" --hook 01:6AF9 --mark 0D:412D
 *    python3 tools/trace_record.py bm_run pre_battle "none:20,down:3,none:10,a:3,none:30" --hook 01:6AF9 --mark 0D:412D
 *    python3 tools/trace_record.py bm_back pre_battle "none:20,a:3,none:30,b:3,none:60,down:3,none:10,a:3,none:30" --hook 01:6AF9 --mark 0D:412D
 *    python3 tools/trace_record.py bm_init pre_battle "none:40" --hook 01:6AD1 --mark 0D:40EC
 *    python3 tools/trace_record.py bm_meat_yes meat_prompt "none:60,a:3,none:30,b:3,none:40,a:3,none:30,a:3,none:15,down:3,none:15,down:3,none:15,a:3,none:40" --hook 01:6C71 --mark 0D:42A1
 *    python3 tools/trace_record.py bm_meat_no meat_prompt "none:60,down:3,none:10,a:3,none:40" --hook 01:6C71 --mark 0D:42A1
 *    PK="D014=00,D112=2D,D113=00,D114=05,D212=14,D213=00,D214=05,D340=01,D920=03,D501=01,D601=00,D701=02,D933=03,D934=0A,D935=11,D939=02,D93A=02,D93B=02"
 *    python3 tools/trace_record.py bm_cmd2 pre_battle "none:20,a:3,none:30,a:3,none:30,a:3,none:30,b:3,none:30,a:3,none:30,a:3,none:30,a:3,none:30,b:3,none:30,a:3,none:30,a:3,none:30,down:3,none:12,right:3,none:12,up:3,none:12,left:3,none:12,a:3,none:40" --hook 01:6AF9 --mark 0D:412D --poke "$PK"
 *    python3 tools/trace_record.py bm_cmd3 pre_battle "none:20,a:3,none:30,b:3,none:60,down:3,none:10,a:3,none:30" --hook 01:6AF9 --mark 0D:412D --poke "$PK"
 *  Set BM_DEBUG=1 for details and PGM dumps of differing frames in build/bm/. */
import { describe, expect, it } from "vitest";
import { vsync, type Co, type Engine } from "@ffl2k/core";
import { installBattleMenus, statFfa5, vblankFfa5, waveStep } from "@ffl2k/core/src/menu/battle.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { haveRom, IGNORE, ROOT, Rig, loadRom, summarizeWaits } from "../src/index.js";
import { haveMarkedTrace, replayRoutine, summarizeEnd } from "../src/menuharness.js";
import { vramBegin, vramEnd } from "@ffl2k/core/src/field/sprites.js";

const ignore = IGNORE;

/** TEST STUBS for the battle display routines of bank 0D called by the meat prompt (01:6F74),
 *  which another module ports: minimal re-implementations of 0D:5009 (60BE), 0D:500C (60B9),
 *  0D:500F (6082) and 0D:5006 (60D3), reading the ROM at run time. Remove once bank 0D is ported. */
function stubBank0D(e: Engine): void {
  const m = e.g.m;
  const rd0F = (r: { hl?: number }) => { const v = m.romAt(0x0f, r.hl!); r.hl = (r.hl! + 1) & 0xffff; return v; };
  e.extra.set(0xd5009, function* (_e, r): Co<number | void> { // 00:00C3 bank 4, hl → 8000, b bytes
    const prev = m.selectBank(0x04);
    yield* vramBegin(e.g);
    for (let i = 0; i < (r.b || 0x100); i++) m.wr(0x8000 + i, m.romAt(0x04, r.hl! + i));
    yield* vramEnd(e.g);
    m.selectBank(prev);
  });
  e.extra.set(0xd500c, function* (_e, r): Co<number | void> { return rd0F(r); });
  e.extra.set(0xd500f, function* (_e, r): Co<number | void> {
    let de = r.hl!;
    const t = { hl: (0x7b80 + 2 * r.a!) & 0xffff };
    const lo = rd0F(t), hi = rd0F(t);
    t.hl = lo | (hi << 8);
    for (;;) {
      const y = rd0F(t);
      if (y === 0xff) break;
      m.wr(de++, y + r.b!);
      m.wr(de++, rd0F(t) + r.c!);
      const v = rd0F(t);
      m.wr(de++, v & 0x0f);
      m.wr(de++, v & 0xf0);
    }
    r.hl = de;
    return r.a;
  });
  e.extra.set(0xd5006, function* (_e, r): Co<number | void> {
    let b = r.b!;
    do { yield* vsync(e.g); m.wr(0xff46, 0xcc); b = (b - 1) & 0xff; } while (b);
  });
}

/** Debugging: write differing frames as PGM (port | trace) to build/bm/. */
function dumpScreens(name: string, f: number, got: Uint8Array, exp: Uint8Array): void {
  let d = 0;
  for (let i = 0; i < got.length; i++) if (got[i] !== exp[i]) d++;
  if (!d) return;
  const W = 160, H = 144, img = new Uint8Array(2 * W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    img[y * 2 * W + x] = 255 - 85 * got[y * W + x]!;
    img[y * 2 * W + W + x] = 255 - 85 * exp[y * W + x]!;
  }
  mkdirSync(resolve(ROOT, "build/bm"), { recursive: true });
  writeFileSync(resolve(ROOT, `build/bm/${name}_${f}.pgm`), Buffer.concat([Buffer.from(`P5 ${2 * W} ${H} 255\n`), Buffer.from(img)]));
}

type Entry = 0x15015 | 0x15018 | 0x1501b;
const TRACES: [string, Entry, string][] = [
  ["bm_init", 0x15015, "01:6AD1 battle screen setup (pre_battle, hook 01:6AD1, mark 0D:40EC, none:40)"],
  ["bm_run", 0x15018, "FIGHT/RUN: Run (pre_battle, hook 01:6AF9, mark 0D:412D)"],
  ["bm_back", 0x15018, "Fight, B on the first member → battle screen again (6AD1), then Run"],
  ["bm_cmd1", 0x15018, "commands for all 4 members and the guest: unusable item (beep), Fight → target group, cancel target (B), back to previous member (B), guest's healing item → member target; FF8C = 5"],
  ["bm_cmd2", 0x15018, "pokes (no usable item for member 0, an all-enemies item for 1, an all-members item for 2, member 3 unable to act, 3 enemy groups with group 1 empty): message 0x39 + A, 0x36/0x38 + B then A, target 8, member 3 skipped both ways, guest's group cursor down/right/up/left over the live groups"],
  ["bm_cmd3", 0x15018, "same pokes: member 0 has no usable item, B → battle screen again, Run"],
  ["bm_meat_yes", 0x1501b, "meat prompt: Yes, B back to the question, Yes, a member that cannot eat (beep), another member (meat_prompt, hook 01:6C71, mark 0D:42A1)"],
  ["bm_meat_no", 0x1501b, "meat prompt: No"],
];

for (const [name, entry, what] of TRACES) {
  describe.skipIf(!haveRom() || !haveMarkedTrace(name))(`battle menu trace ${name}`, () => {
    it(`${what}: same screens, wait-point state and state at the return`, () => {
      const r = replayRoutine(name, {
        callerBank: 0x0d,
        ignore,
        setup: (rig) => {
          installBattleMenus(rig.engine);
          stubBank0D(rig.engine);
        },
        run: (rig) => rig.engine.far(entry),
        onScreen: process.env.BM_DEBUG ? (f, got, exp) => dumpScreens(name, f, got, exp) : undefined,
      });
      if (process.env.BM_DEBUG) console.log(name, { returned: r.returned, waits: `${r.nWaits}/${r.expectedWaits}`, tickPhase: r.tickPhase, rephased: r.rephased, rephasedJoy: r.rephasedJoy, frames: r.frames, screens: r.diffs.map((d) => `${d.frame}:${d.pixels}`).join(" "), waitDiffs: summarizeWaits(r.waits), firstValues: r.waits.slice(0, 3).flatMap((w) => w.values).map((v) => v.map((x) => x.toString(16)).join("/")).join(" "), end: summarizeEnd(r.end) });
      expect(r.returned).toBe(true);
      expect(r.nWaits).toBe(r.expectedWaits);
      expect(r.diffs.map((d) => `${d.frame}:${d.pixels}`)).toEqual([]);
      expect(summarizeWaits(r.waits)).toBe("");
      expect(summarizeEnd(r.end)).toBe("");
      expect(r.frames).toBeGreaterThan(10);
      // tolerated timing re-phases (see menuharness.ts): bounded so they cannot hide behaviour
      expect(r.rephased + r.rephasedJoy).toBeLessThanOrEqual(8);
    });
  });
}

/** Routines no trace reaches (FFA5 tile animation, wave step, scripted monster appearance),
 *  against the SM83 oracle on random inputs: python3 tools/battle_menu_oracle.py */
const ORACLE = resolve(ROOT, "build/routines/bm_oracle/cases.json");
interface OracleCase { routine: string; in: Record<string, number>; out: Record<string, number>; regs: Record<string, number>; ly?: number; src?: number[]; calls?: string[] }

describe.skipIf(!haveRom() || !existsSync(ORACLE))("battle routines vs the SM83 oracle", () => {
  const cases: OracleCase[] = existsSync(ORACLE) ? JSON.parse(readFileSync(ORACLE, "utf8")) : [];
  const rom = haveRom() ? loadRom() : new Uint8Array(0);
  const check = (c: OracleCase, rd: (a: number) => number) =>
    Object.entries(c.out).filter(([a, v]) => rd(parseInt(a, 16)) !== v).map(([a, v]) => `${a}:${v.toString(16)}/${rd(parseInt(a, 16)).toString(16)}`);
  const fresh = () => {
    const rig = new Rig(rom);
    rig.g.m.selectBank(1);
    rig.g.m.hram[0x7f] = 3;
    return rig;
  };
  for (const r of ["6DF1", "6DC5", "6F49"]) {
    it(`01:${r}: same memory as the original on every case`, () => {
      const bad: string[] = [];
      const list = cases.filter((c) => c.routine === r);
      expect(list.length).toBeGreaterThan(10);
      for (const c of list) {
        const rig = fresh(), m = rig.g.m;
        for (const [a, v] of Object.entries(c.in)) m.wr(parseInt(a, 16), v);
        if (r === "6DF1") statFfa5(rig.g);
        else if (r === "6DC5") { m.io[0x44] = c.ly!; vblankFfa5(rig.g); }
        else waveStep(m, c.regs.d!, c.regs.e!);
        bad.push(...check(c, (a) => m.rd(a)).slice(0, 4));
      }
      expect(bad).toEqual([]);
    });
  }
  it("01:6E27 (text code 0x48): same wave table, tile copy and registers at the end", () => {
    const list = cases.filter((c) => c.routine === "6E27");
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) {
      const rig = fresh(), e = rig.engine, m = rig.g.m;
      installBattleMenus(e);
      const calls: string[] = [];
      e.extra.set(0xf6092, function* (): Co<number | void> { calls.push("0F6092"); });
      e.extra.set(0xd5018, function* (_e, r): Co<number | void> {
        calls.push("0D5018");
        r.hl = c.src![1]; r.b = c.src![2]! >> 8; r.c = c.src![2]! & 0xff;
        return c.src![0];
      });
      rig.g.start(e.far(0x1502a, { b: c.regs.b, c: c.regs.c }) as Co);
      let frames = 0;
      while (!rig.g.done && frames < 5000) { rig.g.runFrame(); frames++; }
      expect(rig.g.done).toBe(true);
      expect(calls).toEqual(c.calls);
      expect(check(c, (a) => m.rd(a)).slice(0, 8)).toEqual([]);
      expect(rig.g.ime).toBe(true);
      expect(rig.g.lineHook).toBe(null);
    }
  });
});

