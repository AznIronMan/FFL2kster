/** Battle display (0F:6080) and animation (0D:5000) parity against PyBoy routine traces
 *  (tools/bd_capture.py traces: hook at the routine's entry in a real battle, recorded until it
 *  returns; some with a controlled change of the animation id / target / flags at the hook).
 *  The port's entry runs from the start snapshot in the frame loop: same machine state at every
 *  frame wait (rst $10), same screens on every frame, same machine at the return. */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { haveRom, TRACES, ROOT, FRAME_BYTES } from "../src/index.js";
import { replayRoutine, haveRoutineTrace, summarizeRoutine } from "../src/routine.js";
import { installBattleDisplay } from "../../core/src/battle/index.js";

/** Not compared: sound driver RAM and its request bytes (FFB1-FFBF; the sound driver is not
 *  ported), the SM83 stack, and the timing registers DIV/IF/STAT/LY/LYC. Everything else —
 *  including the sprite page CC00, OAM and the FF90-FF92 scratch — must match. */
const SOUND = (a: number) => (a >= 0xcb00 && a < 0xcc00) || (a >= 0xffb1 && a < 0xffc0) || (a >= 0xff10 && a < 0xff40);
const STACK = (a: number) => a >= 0xce00 && a < 0xcf00;
const TIMING = (a: number) => a === 0xff04 || a === 0xff0f || a === 0xff41 || a === 0xff44 || a === 0xff45;
const IGN = (a: number) => SOUND(a) || STACK(a) || TIMING(a);

const WHAT: Record<string, string> = {
  bd_open_jaguar: "battle opening, 1 group (Jaguar): graphics, layout, wavy intro",
  bd_open_45: "battle opening, enemy id 45",
  bd_open_180: "battle opening, enemy id 180",
  bd_open_185: "battle opening, enemy id 185",
  bd_open_2grp: "battle opening, 2 groups",
  bd_open_3grp: "battle opening, 3 groups",
  bd_open_kind1: "battle opening of kind 1 (formation from 0F:62A6: no intro)",
  bd_hit_bc: "weapon animation BC (natural)",
  bd_hit_88: "weapon animation 88 (natural)",
  bd_fx00_nat: "enemy attack: window shake (natural)",
  bd_update_jaguar: "enemy update after an action, nobody died (natural)",
  bd_death_45: "enemy death: vanish rows + sprite burst (natural)",
  bd_death_185: "enemy death of the last of three (natural)",
  bd_slide: "enemy group slides back in (D986)",
  bd_restore: "update with the enemy area dark: 0D:5003 redraw and lighten",
  bd_death_kind2: "enemy death in a battle of kind 2 (quake and scroll)",
  bd_restore_kind2: "dark-area restore in a battle of kind 2 (backdrop pattern, 0F:608F)",
};
/** Scenarios that must be present whenever any battle trace is (guards against silently
 *  missing coverage). */
const REQUIRED = ["bd_open_jaguar", "bd_open_3grp", "bd_hit_bc", "bd_fx_02", "bd_anim_8a", "bd_death_45", "bd_restore"];

const names = existsSync(TRACES) ? readdirSync(TRACES).filter((n) => n.startsWith("bd_") && haveRoutineTrace(n)).sort() : [];
const entryOf = (name: string): number => {
  const hook: string = JSON.parse(readFileSync(resolve(TRACES, name, "trace.json"), "utf8")).hook;
  const [b, a] = hook.split(":").map((x) => parseInt(x, 16));
  return (b! << 16) | a!;
};

describe.skipIf(!haveRom() || !names.length)("battle display/animation routine traces", () => {
  it("has the key scenarios", () => {
    expect(REQUIRED.filter((n) => !names.includes(n))).toEqual([]);
  });
  for (const name of names) {
    const what = WHAT[name] ?? (name.startsWith("bd_anim_") ? `sprite animation ${name.slice(8)}` : name.startsWith("bd_fx_") ? `screen effect ${name.slice(6)}` : name);
    it(`${name}: ${what}`, () => {
      const entry = entryOf(name);
      const r = replayRoutine(name, (rig, regs) => rig.engine.far(entry, { a: regs.a, b: regs.b, c: regs.c, d: regs.d, e: regs.e, hl: regs.hl }), {
        ignore: IGN,
        setup: (rig) => installBattleDisplay(rig.engine),
      });
      expect(r.expectedWaits).toBeGreaterThan(0);
      expect(summarizeRoutine(r)).toBe("");
    });
  }
});

/** Diagnostic (BD_DEBUG=trace[,frame...]): writes the port's and the original's screens of the
 *  given frames (counted per drawn frame, including the hook's own) as PGM images to build/bd/
 *  and prints the summary and the first differing wait values. */
it.skipIf(!haveRom() || !process.env.BD_DEBUG)("debug battle trace", () => {
  const [name, ...fr] = process.env.BD_DEBUG!.split(",");
  const want = new Set(fr.map(Number));
  const out = resolve(ROOT, "build/bd");
  mkdirSync(out, { recursive: true });
  const shades = [255, 170, 85, 0];
  const pgm = (px: Uint8Array) => Buffer.concat([Buffer.from("P5 160 144 255\n"), Buffer.from(px.map((v) => shades[v] ?? 128))]);
  let frame = -1;
  const entry = entryOf(name!);
  const r = replayRoutine(name!, (rig, regs) => rig.engine.far(entry, { a: regs.a, b: regs.b, c: regs.c, d: regs.d, e: regs.e, hl: regs.hl }), {
    ignore: IGN,
    setup: (rig) => {
      installBattleDisplay(rig.engine);
      const onLine = rig.g.onLine;
      rig.g.onLine = (y) => {
        onLine?.(y);
        if (y !== 143) return;
        frame++;
        if (want.has(frame)) writeFileSync(resolve(out, `${name}_port_${frame}.pgm`), pgm(rig.ppu.frame));
      };
    },
  });
  for (const f of want) {
    const t = r.trace.screens.subarray(f * FRAME_BYTES, (f + 1) * FRAME_BYTES);
    writeFileSync(resolve(out, `${name}_orig_${f}.pgm`), pgm(t));
  }
  console.log(summarizeRoutine(r), "waits", r.nWaits, r.expectedWaits, "busy", r.busy, "partial", r.partial, "frames", r.frames);
  for (const w of r.waits.slice(0, 3)) console.log(w.wait, w.frame, w.values.map(([a, e, g2, p]) => `${a.toString(16)}:${e.toString(16)}/${g2.toString(16)}/${p.toString(16)}`).join(" "));
});
