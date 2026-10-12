/** Battle/reward/growth/meat rule tables (port of ffl2kster.rules.export_tables) and the
 *  calc-VM script listing (port of ffl2kster.calcvm). */
import { Rom } from "./rom.js";
import { itemName } from "./tables.js";

const B0C = 0x30000 - 0x4000;
const FAMILY = 0x7800, MEAT_RESULT = 0x7900, STAT_FLAGS = 0x7b40, REWARD = 0x7c50, LEVEL_AI = 0x7d50;
const GP_TABLE = 0x7e50, AI_THRESHOLDS = 0x6f00, GROWTH = 0x7f90, MUTANT_THRESH = 0x7fb0, MUTANT_ABILITY = 0x7fd0, MAX_GP = 0x7ff0;
const STATS = ["STR", "AGL", "MANA", "DEF"];

const b = (rom: Rom, a: number) => rom.u8(B0C + a);
const w = (rom: Rom, a: number) => b(rom, a) | (b(rom, a + 1) << 8);

export function statFlags(rom: Rom, action: number): string[] {
  const v = b(rom, STAT_FLAGS + action);
  return STATS.filter((_, i) => v & (0x80 >> i));
}

export function growthParams(rom: Rom, race: number) {
  const base = GROWTH + 16 * race;
  return {
    ability: [b(rom, base), b(rom, base + 1)],
    hp: [b(rom, base + 2), b(rom, base + 3)],
    stats: [0, 1, 2, 3].map((s) => [b(rom, GROWTH + 4 + (race * 5 + s) * 2), b(rom, GROWTH + 5 + (race * 5 + s) * 2)]),
  };
}

export function meatResult(rom: Rom, eater: number, meat: number): number {
  const fe = b(rom, FAMILY + eater), fm = b(rom, FAMILY + meat);
  const f1 = fe >> 4, c1 = fe & 15;
  let f2 = fm >> 4;
  const c2 = fm & 15;
  if (f2 > 5) f2 += 1;
  let k = f1 + f2;
  if (k < 6) k += 12;
  if (k > 17) k -= 12;
  k -= 6;
  const cls = Math.min(Math.max(c1 + c2 - 1, 0), 2);
  const lv = Math.max(b(rom, LEVEL_AI + eater) & 15, b(rom, LEVEL_AI + meat) & 15);
  return b(rom, MEAT_RESULT + (k * 3 + cls) * 16 + lv);
}

export const BATTLE_EFFECTS: [number, number] = [0x53e1, 50];
export const FIELD_EFFECTS: [number, number] = [0x5445, 10];

export function vmTable(rom: Rom, base: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => w(rom, base + 2 * i));
}

const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, "0");

export function effectIndex(rom: Rom) {
  const battle = vmTable(rom, ...BATTLE_EFFECTS);
  const field = vmTable(rom, ...FIELD_EFFECTS);
  const users = new Map<number, string[]>();
  for (let i = 0; i < 256; i++) {
    const e = rom.u8(0x32f80 + 8 * i + 3);
    if (!users.has(e)) users.set(e, []);
    users.get(e)!.push(`${i}:${itemName(rom, i)}`);
  }
  const out: Record<string, { battle_handler: string; field_handler: string | null; items: string[] }> = {};
  battle.forEach((h, e) => {
    out[String(e)] = { battle_handler: `0C:${hex4(h)}`, field_handler: e < field.length ? `0C:${hex4(field[e]!)}` : null, items: users.get(e) ?? [] };
  });
  return out;
}

export function exportRules(rom: Rom) {
  const monsters = Array.from({ length: 256 }, (_, m) => {
    const fam = b(rom, FAMILY + m), la = b(rom, LEVEL_AI + m), rw = b(rom, REWARD + m), gi = rw & 0x1f;
    return {
      id: m, family: fam >> 4, meat_class: fam & 15, level: la & 15, ai_type: la >> 4, drops_meat: !!(rw & 0x80),
      drop_chance_base: ((rw >> 6) & 1) * 80 + ((rw >> 5) & 1) * 20, gp_index: gi, gp_base: w(rom, GP_TABLE + 2 * gi),
    };
  });
  const sg: Record<string, string[]> = {};
  for (let a = 0; a < 0x110; a++) {
    const f = statFlags(rom, a);
    if (f.length) sg[String(a)] = f;
  }
  return {
    monsters,
    gp_table: Array.from({ length: 32 }, (_, i) => w(rom, GP_TABLE + 2 * i)),
    ai_thresholds: Array.from({ length: 16 }, (_, t) => Array.from({ length: 8 }, (_, s) => b(rom, AI_THRESHOLDS + 8 * t + s))),
    meat_result: Array.from({ length: 12 }, (_, k) => Array.from({ length: 3 }, (_, c) => Array.from({ length: 16 }, (_, lv) => b(rom, MEAT_RESULT + (k * 3 + c) * 16 + lv)))),
    stat_growth_by_action: sg,
    growth: { "0": growthParams(rom, 0), "1": growthParams(rom, 1) },
    mutant_abilities: Array.from({ length: 32 }, (_, i) => [b(rom, MUTANT_THRESH + i), b(rom, MUTANT_ABILITY + i)]),
    max_gp: b(rom, MAX_GP) | (b(rom, MAX_GP + 1) << 8) | (b(rom, MAX_GP + 2) << 16),
    effects: effectIndex(rom),
  };
}

// ---------------------------------------------------------------- calc VM listing
const SCRIPT_TABLE = 0x30680;
const EXPR: Record<number, string> = {
  0x00: "", 0x01: "*", 0x02: "/", 0x03: "+", 0x04: "-", 0x05: "&", 0x06: "|", 0x07: "nand", 0x08: "^", 0x09: "~",
  0x0a: ">>", 0x0b: "<<", 0x0c: "==", 0x0d: "<", 0x0e: ">", 0x0f: "<=", 0x10: ">=", 0x11: "-sat", 0x12: "rand", 0x13: "abs",
};
const CMP = new Set([0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x13]);
const voff = (a: number) => (a >= 0x4000 ? 0x0c * 0x4000 + a - 0x4000 : a);
const h2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");

function operand(rom: Uint8Array, p: number, mode: number): [string, number] {
  const v = rom[p]!;
  if (mode <= 2) return [`CF${h2(v)}` + (mode === 0 ? "" : `.${mode + 1}`), 1];
  if (mode <= 4) return [`[CF${h2(v)}]` + (mode === 3 ? "" : ".2"), 1];
  if (mode === 5) return [`rand6(0..${v})`, 1];
  if (mode === 6) return [`#${v}`, 1];
  const x = v | (rom[p + 1]! << 8);
  return [x >= 0x1000 ? `#$${hex4(x)}` : `#${x}`, 2];
}

function absOp(rom: Uint8Array, p: number, mode: number): string {
  const a = rom[p]! | (rom[p + 1]! << 8);
  const sz = ({ 0: "", 1: ".2", 2: ".3", 3: "[ptr]", 4: "[ptr].2" } as Record<number, string>)[mode] ?? `.m${mode}`;
  return `(${hex4(a)}${sz})`;
}

function expression(rom: Uint8Array, p: number, cond = false, first?: string): [string, number] {
  const parts: string[] = first !== undefined ? [first] : [];
  const start = p;
  for (;;) {
    const op = rom[p]!, code = op & 0x1f, mode = op >> 5;
    p += 1;
    if (code === 0x1f) break;
    let txt: string;
    if (code === 0x13) { txt = absOp(rom, p, mode); p += 2; }
    else if (code === 0x12) { txt = `rand5(0..CF${h2(rom[p]!)})`; p += 1; }
    else { const [t, n] = operand(rom, p, mode); txt = t; p += n; }
    if (!parts.length) parts.push(txt);
    else if (CMP.has(code)) parts.push(cond ? (code === 0x13 ? "==" : EXPR[code]) + " " + txt : "load " + txt);
    else if (code === 0x00 || code === 0x12) parts.push("load " + txt);
    else parts.push(`${EXPR[code] ?? "?" + h2(code)} ${txt}`);
  }
  return [parts.join(" "), p - start];
}

function disasm(rom: Uint8Array, entryAddr: number, limit = 4000): [number, string, number[]][] {
  const out: [number, string, number[]][] = [];
  let p = voff(entryAddr);
  const end = p + limit;
  let cond = false;
  while (p < end) {
    const wasCond = cond;
    cond = false;
    const a = 0x4000 + (p % 0x4000);
    const op = rom[p]!, code = op & 0x1f, mode = op >> 5;
    if (code === 0x1f) {
      out.push([a, "end", []]); p += 1;
      if (!wasCond) break;
      continue;
    }
    if (code === 0x00) {
      const t = rom[p + 1]!;
      let q = p + 2;
      let tgt: string;
      if (mode >= 5) { tgt = `(${hex4(t | (rom[p + 2]! << 8))}).${mode - 4}`; q += 1; }
      else if (mode >= 3) tgt = `[CF${h2(t)}]` + (mode === 3 ? "" : ".2");
      else tgt = `CF${h2(t)}` + (mode === 0 ? "" : `.${mode + 1}`);
      const [e, n] = expression(rom, q);
      out.push([a, `${tgt} = ${e}`, []]);
      p = q + n;
    } else if (code === 0x01) {
      const [f, n0] = operand(rom, p + 1, mode);
      const [e, n] = expression(rom, p + 1 + n0, true, f);
      out.push([a, `if ${e}:`, []]);
      p += 1 + n0 + n;
      cond = true;
    } else if (code === 0x02 || code === 0x03 || code === 0x05) {
      const t = rom[p + 1]! | (rom[p + 2]! << 8);
      const name = ({ 2: "goto", 3: "native", 5: "gosub" } as Record<number, string>)[code]!;
      out.push([a, `${name} ${hex4(t)}`, code !== 3 ? [t] : []]);
      p += 3;
      if (code === 2 && !wasCond) break;
    } else if (code === 0x04) {
      out.push([a, `C1A0 = ${rom[p + 1]}`, []]); p += 2;
    } else if (code === 0x06) {
      out.push([a, "return", []]); p += 1;
      if (!wasCond) break;
    } else if (code === 0x07 || code === 0x08) {
      out.push([a, (code === 7 ? "inc" : "dec") + ` CF${h2(rom[p + 1]!)}.${mode + 1}`, []]); p += 2;
    } else if (code === 0x09) {
      out.push([a, `gosub [CF${h2(rom[p + 1]!)}]`, []]); p += 2;
    } else {
      out.push([a, `?? ${h2(op)}`, []]); p += 1;
      break;
    }
  }
  return out;
}

export function calcVmListing(rom: Rom): string {
  const r = rom.bytes;
  const labels = new Map<number, string>();
  for (let i = 0; i < 11; i++) labels.set(r[SCRIPT_TABLE + 2 * i]! | (r[SCRIPT_TABLE + 2 * i + 1]! << 8), `script_${i}`);
  vmTable(rom, ...BATTLE_EFFECTS).forEach((a, i) => { if (!labels.has(a)) labels.set(a, `effect_${i}`); });
  vmTable(rom, ...FIELD_EFFECTS).forEach((a, i) => { if (!labels.has(a)) labels.set(a, `field_effect_${i}`); });
  const ins = new Map<number, string>();
  const todo = Array.from(labels.keys());
  const done = new Set<number>();
  while (todo.length) {
    const a = todo.pop()!;
    if (done.has(a)) continue;
    done.add(a);
    for (const [addr, txt, tg] of disasm(r, a)) {
      ins.set(addr, txt);
      for (const t of tg) {
        if (!labels.has(t)) labels.set(t, `L${hex4(t)}`);
        todo.push(t);
      }
    }
  }
  const lines: string[] = [];
  for (const addr of Array.from(ins.keys()).sort((x, y) => x - y)) {
    if (labels.has(addr)) lines.push(`\n${labels.get(addr)}:`);
    let txt = ins.get(addr)!;
    for (const [t, name] of labels) txt = txt.replace(`goto ${hex4(t)}`, `goto ${name}`).replace(`gosub ${hex4(t)}`, `gosub ${name}`);
    lines.push(`  ${hex4(addr)}  ${txt}`);
  }
  return lines.join("\n");
}
