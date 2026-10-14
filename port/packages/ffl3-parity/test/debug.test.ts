/** Debugging aid (skipped unless FFL3K_DEBUG names a trace): the stack at each frame wait in a
 *  window of waits, and the first differences. */
import { it } from "vitest";
import { haveRom, haveTrace, loadTrace, replay, summarizeWaits } from "../src/index.js";

Error.stackTraceLimit = 100;
const NAME = process.env.FFL3K_DEBUG ?? "";
const FROM = Number(process.env.FFL3K_FROM ?? 0), TO = Number(process.env.FFL3K_TO ?? 20);
const SF = Number(process.env.FFL3K_SFROM ?? 1e9), ST = Number(process.env.FFL3K_STO ?? -1);

it.skipIf(!NAME || !haveRom() || !haveTrace(NAME))(`debug ${NAME}`, () => {
  const DF = Number(process.env.FFL3K_DFROM ?? 1e9), DT = Number(process.env.FFL3K_DTO ?? -1);
  const r = replay(NAME, {
    keepGoing: true,
    setup: (rig) => {
      if (process.env.FFL3K_SFXLOG) { // each sound effect request in a frame range, with the code
        const [a, b] = process.env.FFL3K_SFXLOG.split(",").map(Number) as [number, number];
        const prev = rig.g.sfx.bind(rig.g);
        rig.g.sfx = (v) => {
          if (rig.g.frame >= a && rig.g.frame <= b) console.log(`sfx ${v.toString(16)} f${rig.g.frame} ly${rig.g.ly}: ${(new Error().stack ?? "").split("\n").filter((l) => l.includes("ffl3-core")).slice(1, 6).map((l) => l.trim().replace(/\(.*src\//, "(").replace(/^at /, "")).join(" < ")}`);
          prev?.(v);
        };
      }
      if (process.env.FFL3K_HRAMW) { // writes of one HRAM byte in a frame range: FFL3K_HRAMW=addr,from,to
        const [x, a, b] = process.env.FFL3K_HRAMW.split(",").map((v, i) => (i ? Number(v) : parseInt(v, 16))) as [number, number, number];
        const h = rig.g.m.hram;
        (rig.g.m as unknown as { hram: Uint8Array }).hram = new Proxy(h, {
          get: (t, k) => { const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; },
          set: (t, k, v) => {
            if (k === String(x - 0xff80) && rig.g.frame >= a && rig.g.frame <= b)
              console.log(`hramw ${x.toString(16)}=${Number(v).toString(16)} f${rig.g.frame} ly${rig.g.ly}: ${(new Error().stack ?? "").split("\n").filter((l) => l.includes("ffl3-core")).slice(0, 6).map((l) => l.trim().replace(/\(.*src\//, "(").replace(/^at /, "")).join(" < ")}`);
            return Reflect.set(t, k, v);
          },
        });
      }
      if (process.env.FFL3K_STATE) { // what the code waits for at the end of frame f: FFL3K_STATE=f
        const f0 = Number(process.env.FFL3K_STATE);
        const prev = rig.g.onFrameDone;
        rig.g.onFrameDone = () => {
          prev?.();
          const gg = rig.g as unknown as { waiting: number; lineAt?: [number, number]; work: unknown };
          if (rig.g.frame === f0) console.log(`state f${f0}: waiting ${gg.waiting} lineAt ${gg.lineAt?.join(",")} work ${JSON.stringify(gg.work)}`);
        };
      }
      if (process.env.FFL3K_TICKLOG) { // each sound tick in a frame range: FFL3K_TICKLOG=from,to
        const [a, b] = process.env.FFL3K_TICKLOG.split(",").map(Number) as [number, number];
        const tick = rig.g.hooks.soundTick;
        rig.g.hooks.soundTick = (g) => {
          if (g.frame >= a && g.frame <= b) console.log(`tick ${g.frame} ${g.ly} cb4c=${g.m.rd(0xcb4c).toString(16)} cb00=${g.m.rd(0xcb00).toString(16)}`);
          tick?.(g);
        };
      }
      if (process.env.FFL3K_TICK) { // the first frames whose music tempo accumulator CB00 differs (tick.bin)
        let shown = 0;
        const tk = loadTrace(NAME).tick;
        const prev = rig.g.onFrameDone;
        rig.g.onFrameDone = () => {
          prev?.();
          const f = rig.g.frame, t = tk;
          if (t && shown < Number(process.env.FFL3K_TICK) && f >= 0 && 2 * f < t.length && (t[2 * f] !== rig.g.m.rd(0xcb00) || shown)) { shown++; console.log(`tick f${f}: trace cb00 ${t[2 * f]} port ${rig.g.m.rd(0xcb00)}`); }
        };
      }
      rig.g.debug = (msg) => { if (rig.g.frame >= DF && rig.g.frame <= DT) console.log(msg); };
      const regs = (process.env.FFL3K_LCD ?? "").split(",").filter(Boolean).map((x) => parseInt(x, 16));
      if (regs.length) rig.g.m.onLcdWrite = (a, v) => {
        if (!regs.includes(a) || rig.g.frame < DF || rig.g.frame > DT) return;
        const st = (new Error().stack ?? "").split("\n").filter((l) => l.includes("ffl3-core")).slice(1, 7)
          .map((l) => l.trim().replace(/\(.*src\//, "(").replace(/^at /, "")).join(" < ");
        console.log(`lcd ${a.toString(16)}=${v.toString(16)} f${rig.g.frame} ly${rig.g.ly}: ${st}`);
      };
    },
    onSync: (i, f, pf) => {
      if (pf < SF || pf > ST) return;
      const st = (new Error().stack ?? "").split("\n").filter((l) => l.includes("ffl3-core")).slice(2, 2 + Number(process.env.FFL3K_DEPTH ?? 7))
        .map((l) => l.trim().replace(/\(.*src\//, "(").replace(/^at /, "")).join(" < ");
      console.log(`sync ${i} trace f${f} port f${pf}: ${st}`);
    },
    onWaitStart: (i, f, pf) => {
      if (i < FROM || i > TO) return;
      const st = (new Error().stack ?? "").split("\n").filter((l) => l.includes("ffl3-core")).slice(1, 1 + Number(process.env.FFL3K_DEPTH ?? 8))
        .map((l) => l.trim().replace(/\(.*src\//, "(").replace(/^at /, "")).join(" < ");
      console.log(`wait ${i} trace f${f} port f${pf}: ${st}`);
    },
  });
  for (const d of r.diffs.slice(0, Number(process.env.FFL3K_NDIFF ?? 0))) {
    const exp = r.trace.screens.subarray(d.frame * 23040, (d.frame + 1) * 23040);
    const rows = new Set<number>();
    for (let i = 0; i < 23040; i++) if (d.got && d.got[i] !== exp[i]) rows.add(Math.floor(i / 160));
    const rs = [...rows].sort((a, b) => a - b);
    const works = r.trace.works.filter((w) => w[2] >= d.frame - 1 && w[0] <= d.frame).map((w) => w.join(",")).join(" ");
    const prev = r.trace.screens.subarray((d.frame - 1) * 23040, d.frame * 23040);
    const px: string[] = [];
    for (let i = 0; i < 23040 && px.length < 16; i++) if (d.got && d.got[i] !== exp[i]) px.push(`${i % 160},${Math.floor(i / 160)}:${exp[i]}/${d.got[i]}/${prev[i]}`);
    console.log(px.join(" "));
    const odd: string[] = [];
    for (let i = 0; i < 23040; i++) if (d.got && d.got[i] !== exp[i] && prev[i] !== exp[i]) odd.push(`${i % 160},${Math.floor(i / 160)}:${exp[i]}/${d.got[i]}/${prev[i]}`);
    if (process.env.FFL3K_GRID) {
      const [x0, x1, y0, y1] = process.env.FFL3K_GRID.split(",").map(Number) as [number, number, number, number];
      const old2 = r.trace.screens.subarray((d.frame - 2) * 23040, (d.frame - 1) * 23040);
      const nxt = r.trace.screens.subarray((d.frame + 1) * 23040, (d.frame + 2) * 23040);
      for (let y = y0; y <= y1; y++) {
        const row = (a: Uint8Array) => Array.from({ length: x1 - x0 + 1 }, (_, k) => a[y * 160 + x0 + k]).join("");
        console.log(`grid y${y} exp ${row(exp)} got ${row(d.got!)} prev ${row(prev)} prev2 ${row(old2)} next ${row(nxt)}`);
      }
    }
    console.log(`not old: ${odd.length} ${odd.slice(0, 12).join(" ")}`);
    if (process.env.FFL3K_PGM) { // the expected, got and previous frames as PGM images (debugging)
      const fs = require("node:fs") as typeof import("node:fs");
      const pgm = (a: Uint8Array) => Buffer.concat([Buffer.from("P5 160 144 3\n"), Buffer.from(a.map((v) => 3 - v))]);
      fs.writeFileSync(`/tmp/${NAME}_${d.frame}_exp.pgm`, pgm(exp));
      fs.writeFileSync(`/tmp/${NAME}_${d.frame}_got.pgm`, pgm(d.got!));
      fs.writeFileSync(`/tmp/${NAME}_${d.frame}_prev.pgm`, pgm(prev));
    }
    console.log(`diff f${d.frame}: px ${d.pixels} rows ${rs[0]}-${rs[rs.length - 1]} (${rs.length}) works ${works}`);
  }
  console.log(`transient OAM waits:\n${summarizeWaits(r.transient)}`);
  console.log(`counts: tears ${r.tears} oamLate ${r.oamLate} transient ${r.oamTransient} syncs ${r.nSyncs}/${r.trace.syncs.length} late ${r.lateSyncs} polls ${r.nPolls}/${r.trace.polls.length} late ${r.latePolls} points ${r.nPoints} late ${r.latePoints} works ${r.nWorks}/${r.trace.works.length} mismatch ${r.workMismatch} lineTears ${r.lineTears}`);
  console.log(`waits ${r.nWaits} busy ${r.busy} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}`);
});
