/** Event scripts (field/story tables), shops and map placements (port of ffl2kster.events). */
import { Rom } from "./rom.js";
import { ARGS, dictionary, entry, glyph, hex2 } from "./text.js";
import { OPS } from "./ops.js";
import { event, EVENT_KINDS, type GameEvent } from "./events.js";
import { itemName } from "./tables.js";
import { allHeaders, header, objects } from "./maps.js";

export const SHOP_TABLE = 0x3f9e0;
export const SHOP_COUNT = 24;

export function shops(rom: Rom) {
  return Array.from({ length: SHOP_COUNT }, (_, s) => ({
    shop: s,
    items: Array.from(rom.slice(SHOP_TABLE + 8 * s, 8)).filter((i) => i !== 0xff).map((id) => ({ id, name: itemName(rom, id) })),
  }));
}

/** Greedy DTE encoder (ffl2kster.script_text.encode_text) — used for byte sizes. */
export function encodeText(rom: Uint8Array, s: string): number[] {
  const gm = new Map<string, number>();
  for (let b = 0x9e; b < 0x100; b++) {
    const g = glyph(b);
    if (!g.startsWith("{") && !gm.has(g)) gm.set(g, b);
  }
  const pairs = new Map<string, number>();
  dictionary(rom).forEach((p, i) => {
    const k = p.map(glyph).join("");
    if (!pairs.has(k)) pairs.set(k, 0x4e + i);
  });
  const out: number[] = [];
  const chars = Array.from(s);
  let i = 0;
  while (i < chars.length) {
    const two = chars.slice(i, i + 2).join("");
    if (chars.length - i >= 2 && pairs.has(two)) {
      out.push(pairs.get(two)!);
      i += 2;
      continue;
    }
    const ch = chars[i]!;
    if (ch === "{" && i + 3 < chars.length && chars[i + 3] === "}") {
      out.push(parseInt(chars.slice(i + 1, i + 3).join(""), 16));
      i += 4;
      continue;
    }
    const g = gm.get(ch);
    if (g === undefined) throw new Error(`unencodable character ${ch}`);
    out.push(g);
    i += 1;
  }
  return out;
}

export type ScriptOp =
  | { op: "text"; text: string; size: number }
  | { op: string; code: number; args: number[]; event?: GameEvent };

export function decodeScript(rom: Rom, table: string, index: number): ScriptOp[] {
  const [, , toks] = entry(rom.bytes, table, index);
  return toks.map((t): ScriptOp => {
    if (typeof t === "string") return { op: "text", text: t, size: encodeText(rom.bytes, t).length };
    const [c, a] = t;
    const name = OPS[c]?.[0] ?? `op_${hex2(c)}`;
    const d: ScriptOp = { op: name, code: c, args: a };
    if (c === 0x19) d.event = event(a[0]!, a[1]!);
    return d;
  });
}

/** Python repr() of a str (for byte-identical scripts.txt). */
export function pyRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === q) out += "\\" + q;
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (cp < 0x20 || cp === 0x7f) out += "\\x" + cp.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + q;
}

function pyStr(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  return String(v);
}

const KEY_ORDER = ["kind", "code", "arg", "status", "table", "index", "shop", "inn", "dest", "alt", "song", "ffb1", "sfx", "item", "magi"];

export function renderScript(ops: ScriptOp[]): string {
  const lines: string[] = [];
  let skip = 0;
  for (const op of ops) {
    const ind = skip > 0 ? "    " : "";
    if (skip > 0) skip -= "size" in op ? op.size : 1 + (op as { args: number[] }).args.length;
    if (op.op.startsWith("if_")) skip = 4;
    if (op.op === "text") lines.push(ind + pyRepr((op as { text: string }).text));
    else if (op.op === "newline") continue;
    else if (op.op === "event") {
      const o = op as { args: number[]; event: GameEvent };
      const ev = o.event;
      if (ev.kind === "special") lines.push(ind + `event special(0x${hex2(ev.code)}, 0x${hex2(ev.arg)})`);
      else {
        const extra = KEY_ORDER.filter((k) => !["kind", "code", "arg"].includes(k) && k in ev)
          .map((k) => `${k}=${pyStr((ev as unknown as Record<string, unknown>)[k])}`).join(", ");
        lines.push(ind + `event ${ev.kind}(${extra || o.args[1]})`);
      }
    } else {
      const o = op as { op: string; args: number[] };
      lines.push(ind + o.op + (o.args.length ? "(" + o.args.join(", ") + ")" : ""));
    }
  }
  return lines.join("\n");
}

export function exportScripts(rom: Rom): string {
  const out = ["# FFL2 event scripts (field + story tables) decoded by ffl2kster.events; see docs/EVENTS.md"];
  for (const [name, n] of [["story", 192], ["field", 256]] as const) {
    for (let i = 0; i < n; i++) {
      out.push(`\n## ${name}[${i}]`);
      out.push(renderScript(decodeScript(rom, name, i)));
    }
  }
  return out.join("\n") + "\n";
}

export function placements(rom: Rom) {
  const out = { chests: [] as object[], shops: [] as object[], sound: [] as object[], scripts: [] as object[] };
  for (const h of allHeaders(rom)) {
    const hd = header(rom, h);
    const objs = objects(rom, hd).npcs;
    const srcs: [string, GameEvent, Record<string, unknown>][] = [
      ...objs.map((n): [string, GameEvent, Record<string, unknown>] => ["object", n.event, { x: n.x, y: n.y, condition: n.condition }]),
      ...hd.triggers.map((t): [string, GameEvent, Record<string, unknown>] => ["trigger", t.event, { tile: t.tile }]),
    ];
    for (const [src, ev, where] of srcs) {
      const base = { map: h.toString(16).padStart(4, "0"), source: src, ...where };
      if (ev.kind.startsWith("chest")) {
        const it = ev.item;
        out.chests.push({ ...base, kind: ev.kind, item: it ?? null, magi: ev.magi ?? null, name: it !== undefined && it !== null ? itemName(rom, it) : null });
      } else if (ev.kind === "shop") out.shops.push({ ...base, shop: ev.shop, inn: ev.inn });
      else if (ev.kind === "sound") {
        const s: Record<string, number> = {};
        for (const k of ["song", "sfx", "ffb1"] as const) if (ev[k] !== undefined) s[k] = ev[k]!;
        out.sound.push({ ...base, ...s });
      } else if (ev.kind === "script") out.scripts.push({ ...base, story: ev.index });
    }
  }
  return out;
}

export function exportEvents(rom: Rom) {
  const ops: Record<string, { name: string; status: string; args: number }> = {};
  for (const [c, [n, s]] of Object.entries(OPS)) ops[hex2(Number(c))] = { name: n, status: s, args: ARGS[Number(c)] ?? 0 };
  const kinds: Record<string, string> = {};
  for (const [k, v] of Object.entries(EVENT_KINDS)) kinds[hex2(Number(k))] = v;
  return { ...placements(rom), shop_inventories: shops(rom), ops, event_kinds: kinds };
}
