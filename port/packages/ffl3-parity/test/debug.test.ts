/** Debugging aid (skipped unless FFL3K_DEBUG names a trace): the stack at each frame wait in a
 *  window of waits, and the first differences. */
import { it } from "vitest";
import { haveRom, haveTrace, replay, summarizeWaits } from "../src/index.js";

const NAME = process.env.FFL3K_DEBUG ?? "";
const FROM = Number(process.env.FFL3K_FROM ?? 0), TO = Number(process.env.FFL3K_TO ?? 20);
const SF = Number(process.env.FFL3K_SFROM ?? 1e9), ST = Number(process.env.FFL3K_STO ?? -1);

it.skipIf(!NAME || !haveRom() || !haveTrace(NAME))(`debug ${NAME}`, () => {
  const DF = Number(process.env.FFL3K_DFROM ?? 1e9), DT = Number(process.env.FFL3K_DTO ?? -1);
  const r = replay(NAME, {
    keepGoing: true,
    setup: (rig) => { rig.g.debug = (msg) => { if (rig.g.frame >= DF && rig.g.frame <= DT) console.log(msg); }; },
    onSync: (i, f, pf) => {
      if (pf < SF || pf > ST) return;
      const st = (new Error().stack ?? "").split("\n").filter((l) => l.includes("ffl3-core")).slice(2, 9)
        .map((l) => l.trim().replace(/\(.*src\//, "(").replace(/^at /, "")).join(" < ");
      console.log(`sync ${i} trace f${f} port f${pf}: ${st}`);
    },
    onWaitStart: (i, f, pf) => {
      if (i < FROM || i > TO) return;
      const st = (new Error().stack ?? "").split("\n").filter((l) => l.includes("ffl3-core")).slice(1, 9)
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
    console.log(`diff f${d.frame}: px ${d.pixels} rows ${rs[0]}-${rs[rs.length - 1]} (${rs.length}) works ${works}`);
  }
  console.log(`transient OAM waits:\n${summarizeWaits(r.transient)}`);
  console.log(`counts: tears ${r.tears} oamLate ${r.oamLate} transient ${r.oamTransient} syncs ${r.nSyncs}/${r.trace.syncs.length} late ${r.lateSyncs} polls ${r.nPolls}/${r.trace.polls.length} late ${r.latePolls} points ${r.nPoints} late ${r.latePoints} works ${r.nWorks}/${r.trace.works.length} mismatch ${r.workMismatch} lineTears ${r.lineTears}`);
  console.log(`waits ${r.nWaits} busy ${r.busy} error ${r.error?.message ?? "-"}\n${summarizeWaits(r.waits)}`);
});
