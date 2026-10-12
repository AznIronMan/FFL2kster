/** Field menu parity (bank 1: Start/Select menus, shops, inns, item use): PyBoy traces from the
 *  fm_* states (tools/fm_states.py: first town warped by the game into the shop/inn town 4940 with
 *  controlled RAM changes: GP, bag items, lowered HP, member types) replayed through the full
 *  engine with `installFieldMenus`; same screens (documented tolerances) and same machine state at
 *  every frame wait as the original (the IGNORE set of walk.test.ts), the same party block
 *  C200-C37F at the end, and the same battery RAM (tools/fm_sram.py, when recorded).
 *  FMDEBUG=name runs a diagnostic replay (WATCH=addr,.. WAITS=a-b FRAME=n DUMP=path NSCREENS=n). */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { installFieldMenus } from "@ffl2k/core/src/menu/field.js";
import { haveRom, haveTrace, replayField, summarizeWaits, IGNORE, TRACES, type Rig } from "../src/index.js";

/** Known screen differences: frames where the original's tile-map copy (00:0AF3 inside the
 *  00:1674/1691 VRAM window) races the beam, so the frame shows old rows above the copy position
 *  and new ones below it (tearing; the port copies between frames); each was checked on images.
 *  Besides these, the frame after a wait where the original's menu sprite page differs from the
 *  port's (spriteLag: its code moved a cursor after the frame tick that builds CC00, so the moved
 *  cursor is DMA'd one frame later) may differ. Any other difference fails. */
const KNOWN: Record<string, number[]> = { fm_inn_yes: [74], fm_inn_no: [74], fm_inn_poor: [74], fm_inn_types: [74], fm_select: [35, 215] };

/** From this frame on the screens are the field's (script 0x60 after the Door's warp: the split
 *  raster effect of field/effects.ts, outside this module), which differ from the original's line
 *  split; the machine state still matches at every wait. */
const FIELD_FROM: Record<string, number> = { fm_menu_use: 953 };

const CASES: [string, string][] = [
  ["fm_probe", "Start menu opened and closed"],
  ["fm_inn_yes", "inn: stay (GP paid, HP restored), thanks, back to the field"],
  ["fm_inn_no", "inn: exit, leaving message"],
  ["fm_inn_poor", "inn: stay without enough GP"],
  ["fm_inn_types", "inn: recovery by member type (mutant ability uses, monster record uses, robot half uses)"],
  ["fm_shop_buy", "item shop: buy (scrolling stock list, GP, first free bag slot), sell at half price"],
  ["fm_shop_poor", "weapon shop: buying with too little GP"],
  ["fm_shop_full", "item shop: buying with a full bag"],
  ["fm_shop_sell", "item shop: selling partly used items (price scaled by uses left)"],
  ["fm_menu_item", "Start menu Item: a Cure used on a member (calc VM effect), bag swap, drop to the trash"],
  ["fm_menu_abil", "Start menu Abil: member choice, slot swap, unusable item, back out"],
  ["fm_menu_equip", "Start menu Equip: armour off (DEF), items exchanged with the bag, armour back on"],
  ["fm_menu_magi", "Start menu MAGI: use (MAGI left in this world), equip to another member"],
  ["fm_menu_save", "Start menu Save: slot choice, Save? yes, slot summary from battery RAM"],
  ["fm_select", "Select menu: formation swap with the portrait animation"],
  ["fm_menu_types", "Start menu Equip by member type: robot (growth 0C:7B40 on HP/stats, uses halved), monster (can't equip)"],
  ["fm_menu_use", "items used from the bag: Power (Strength Up), Body (HP Max), Tent (all, full recovery), Elixier, Door (Warp list, leaves the menu through script 0x60 and warps)"],
];

/** The state after the frame tick differs from the original's (outside IGNORE): the replay then
 *  matches the state before the tick (counted as tickPhase). Diagnostic only. */
function preTick(exp: Uint8Array, got: Uint8Array): boolean {
  for (let a = 0; a < 0x8000; a++) {
    const addr = 0x8000 + a;
    if ((addr >= 0xa000 && addr < 0xc000) || (addr >= 0xe000 && addr < 0xfe00) || (addr >= 0xfea0 && addr < 0xff00)) continue;
    if (exp[a] !== got[a] && !IGNORE(addr)) return true;
  }
  return false;
}

/** The menu sprite page CC00-CC9F (computed by the frame tick from the cursor/portrait state)
 *  differs at a wait: the original's code changed that state after the tick of its frame. */
function spriteLag(exp: Uint8Array, got: Uint8Array): boolean {
  for (let a = 0xcc00; a < 0xcca0; a++) if (exp[a - 0x8000] !== got[a - 0x8000]) return true;
  return false;
}

function setup(name: string, out: { rig?: Rig }) {
  return (rig: Rig) => {
    out.rig = rig;
    installFieldMenus(rig.engine);
    const f = resolve(TRACES, name, "sram_start.bin");
    if (existsSync(f)) rig.g.m.sram.set(new Uint8Array(readFileSync(f)));
  };
}

for (const [name, what] of CASES) {
  describe.skipIf(!haveRom() || !haveTrace(name))(`field menu trace ${name}`, () => {
    it(`${what}: same screens, wait-point state and battery RAM`, () => {
      const out: { rig?: Rig } = {};
      const late = new Set<number>(KNOWN[name] ?? []);
      const { trace, diffs, waits, nWaits } = replayField(name, {
        ignore: IGNORE, setup: setup(name, out),
        watch: (_i, f, exp, got) => { if (spriteLag(exp, got)) late.add(f + 1); },
      });
      expect(trace.meta.frames.length).toBeGreaterThan(100);
      const from = FIELD_FROM[name] ?? Infinity;
      expect(diffs.filter((d) => d.pixels && !late.has(d.frame) && d.frame < from).map((d) => `${d.frame}:${d.pixels}`)).toEqual([]);
      expect(nWaits).toBe(trace.waitFrames!.length);
      expect(summarizeWaits(waits)).toBe("");
      // the party block C200-C37F (members, formation, GP, bag, MAGI, flags) ends as the original's
      const last = trace.wram.subarray((trace.meta.frames.length - 1) * 0x2000);
      const party: string[] = [];
      for (let a = 0xc200; a < 0xc380; a++) {
        if (out.rig!.g.m.rd(a) !== last[a - 0xc000]) party.push(a.toString(16));
      }
      expect(party.slice(0, 16)).toEqual([]);
      const f = resolve(TRACES, name, "sram_end.bin");
      if (existsSync(f)) {
        const exp = new Uint8Array(readFileSync(f)), got = out.rig!.g.m.sram;
        const bad: string[] = [];
        for (let i = 0; i < exp.length; i++) if (exp[i] !== got[i]) bad.push((0xa000 + i).toString(16));
        expect(bad.slice(0, 16)).toEqual([]);
      }
    });
  });
}

/** Diagnostic (FMDEBUG=name [WATCH=addr,... WAITS=a-b]): first differing waits and screens. */
it.skipIf(!haveRom() || !process.env.FMDEBUG)("field menu debug", () => {
  const name = process.env.FMDEBUG!;
  const watchAddr = process.env.WATCH ? process.env.WATCH.split(",").map((x) => parseInt(x, 16)) : [];
  const [w0, w1] = (process.env.WAITS ?? "0-0").split("-").map(Number);
  const rows: string[] = [];
  const out: { rig?: Rig } = {};
  const frames: Uint8Array[] = [];
  const base = setup(name, out);
  let err = "";
  try {
    const { diffs, waits, nWaits, trace, tickPhase, busy, rephased } = replayField(name, {
      ignore: IGNORE,
      setup: (rig) => {
        base(rig);
        if (!process.env.FRAME) return;
        // follow the replay's trace frame (same rule as replay.ts) to pick the engine frame
        const wf = JSON.parse(readFileSync(resolve(TRACES, name, "waits.json"), "utf8")).frames as number[];
        let stored: ((k: number | void) => void) | null = null, fCur = -1, nv = 0;
        Object.defineProperty(rig.g, "onWait", {
          configurable: true,
          get: () => (kind: number | void) => {
            fCur = kind === 1 && nv < wf.length ? wf[nv++]! : fCur + 1;
            stored?.(kind);
          },
          set: (fn) => { stored = fn; },
        });
        const run = rig.g.runFrame.bind(rig.g);
        rig.g.runFrame = () => { run(); frames[fCur] = rig.ppu.frame.slice(); };
      },
      watch: (i, f, exp, got) => {
        if (preTick(exp, got)) rows.push(`pre-tick wait ${i} frame ${f}`);
        if (spriteLag(exp, got)) rows.push(`sprite-lag wait ${i} frame ${f}`);
        if (!watchAddr.length || i < w0! || i > w1!) return;
        rows.push(`w${i} f${f}: ` + watchAddr.map((a) => `${a.toString(16)} ${exp[a - 0x8000]!.toString(16)}/${got[a - 0x8000]!.toString(16)}`).join("  "));
      },
    });
    console.log(rows.join("\n"));
    console.log(`waits engine ${nWaits} trace ${trace.waitFrames?.length}, before tick ${tickPhase}, busy ${busy}, rephased ${rephased}`);
    console.log(summarizeWaits(waits));
    if (waits[0]) console.log(waits[0].values.map(([a, e, g, p]) => `${a.toString(16)}:${e.toString(16)}/${g.toString(16)}/${p.toString(16)}`).join(" "));
    console.log("screens", diffs.filter((d) => d.pixels).slice(0, Number(process.env.NSCREENS ?? 12)).map((d) => `${d.frame}:${d.pixels}`).join(" "));
    console.log((trace.waitFrames ?? []).slice(0, 200).join(","));
    if (process.env.FRAME) {
      // the engine frame closest to trace frame FRAME: differing pixels (x,y exp/got)
      const fr = Number(process.env.FRAME), W = 160;
      const exp = trace.screens.subarray(fr * W * 144, (fr + 1) * W * 144);
      const best = fr, got = frames[fr]!, px: string[] = [];
      let bn = 0;
      for (let j = 0; j < exp.length; j++) if (exp[j] !== got[j]) bn++;
      if (process.env.DUMP) {
        writeFileSync(process.env.DUMP + "_exp.bin", exp);
        writeFileSync(process.env.DUMP + "_got.bin", got);
      }
      for (let j = 0; j < exp.length && px.length < 40; j++) if (exp[j] !== got[j]) px.push(`${j % W},${Math.floor(j / W)} ${exp[j]}/${got[j]}`);
      console.log(`frame ${fr} ~ engine ${best} (${bn} px): ${px.join("  ")}`);
    }
  } catch (e) {
    err = String((e as Error).stack);
  }
  if (err) console.log(rows.join("\n") + "\n" + err);
});
