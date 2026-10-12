/** Diagnostic for battle traces (BDEBUG=name, FRAMES=a-b): the lines that differ in each listed
 *  frame, the trace's LCD registers there, and the engine's per-line SCX/SCY/WX/WY/LCDC/BGP. */
import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { haveRom, loadTrace } from "../src/index.js";
import { loadBattleModules, replayBattle, battleReport } from "../src/battle.js";

it.skipIf(!haveRom() || !process.env.BDEBUG)("battle debug", async () => {
  const [f0, f1] = (process.env.FRAMES ?? "0-0").split("-").map(Number);
  const mods = await loadBattleModules();
  const WATCH = process.env.WATCH ? process.env.WATCH.split(",").map((x) => parseInt(x, 16)) : [];
  const [w0, w1] = (process.env.WAITS ?? "0-0").split("-").map(Number);
  const r1 = loadTrace(process.env.BDEBUG!);
  const out: string[] = [];
  const G = new Map<number, Uint8Array>(), E = new Map<number, Uint8Array>();
  const r = replayBattle(process.env.BDEBUG!, mods, {
    from: "battle", probeDisplay: false, pauses: process.env.PAUSES === "1",
    watch: (i, f, exp, got) => {
      if (!WATCH.length || i < w0! || i > w1!) return;
      out.push(`-1|w${i} f${f} btn ${r1.meta.frames[f]?.btn}: ` + WATCH.map((a) => `${a.toString(16)} ${exp[a - 0x8000]!.toString(16)}/${got[a - 0x8000]!.toString(16)}`).join("  "));
    },
    onScreen: (f, got, exp) => {
      if (f < f0! || f > f1!) return;
      G.set(f, got.slice()); E.set(f, exp.slice());
      const lines: number[] = [];
      for (let y = 0; y < 144; y++) {
        for (let x = 0; x < 160; x++) if (got[y * 160 + x] !== exp[y * 160 + x]) { lines.push(y); break; }
      }
      out.push(`${f}|frame ${f}: lines ${lines.length ? `${lines[0]}-${lines[lines.length - 1]} (${lines.length})` : "none"}`);
    },
  });
  console.log(battleReport(r));
  const eq = (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);
  const line = (a: Uint8Array, y: number) => a.subarray(y * 160, y * 160 + 160);
  const leq = (a: Uint8Array, b: Uint8Array) => a.every((v, i) => v === b[i]);
  for (const [f, g] of G) {
    const e = E.get(f)!, gp = G.get(f - 1);
    const rows: string[] = [];
    for (let y = 0; y < 144; y++) {
      if (leq(line(g, y), line(e, y))) continue;
      const tags = [];
      if (y > 0 && leq(line(g, y), line(e, y - 1))) tags.push("got=exp-1");
      if (y < 143 && leq(line(g, y), line(e, y + 1))) tags.push("got=exp+1");
      if (gp && leq(line(gp, y), line(e, y))) tags.push("exp=gotPrevFrame");
      rows.push(`${y}[${tags.join(",")}]`);
    }
    if (rows.length) console.log(`frame ${f} lines: ${rows.join(" ")}`);
  }
  if (process.env.DUMPDIR) {
    const pal = [255, 170, 85, 0];
    for (const [f, g] of G) {
      const e = E.get(f)!;
      const w = 320 + 8, h = 144;
      const img = new Uint8Array(w * h).fill(128);
      for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) { img[y * w + x] = pal[g[y * 160 + x]!]!; img[y * w + 168 + x] = pal[e[y * 160 + x]!]!; }
      writeFileSync(`${process.env.DUMPDIR}/f${f}.pgm`, Buffer.concat([Buffer.from(`P5 ${w} ${h} 255\n`), Buffer.from(img)]));
    }
  }
  for (const [f, g] of G) console.log(`got ${f} equals trace frames: ${[...E].filter(([, e]) => eq(g, e)).map(([k]) => k).join(",")}`);
  console.log(out.map((l) => { const [f, t] = l.split("|"); return f === "-1" ? t : `${t} lcd ${JSON.stringify(r.trace.meta.frames[Number(f)]?.lcd)}`; }).join("\n"));
});
