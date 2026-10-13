/** Legend III text: the name/menu character set and the script interpreter's format (00:3211;
 *  docs/ffl3/FINDINGS.md M3). Mirrors ffl3kster.text / ffl3kster.script_text. */
import { fileOffset, bankAddress, u16, hex } from "./rom.js";

export const CHARS: Record<number, string> = { 0xff: " ", 0xaf: ".", 0xae: "…", 0xf0: ":", 0xf1: "/", 0xf2: "-", 0xf3: "!", 0xf4: "?" };
for (let i = 0; i < 10; i++) CHARS[0xb0 + i] = String(i);
for (let i = 0; i < 26; i++) { CHARS[0xba + i] = String.fromCharCode(65 + i); CHARS[0xd4 + i] = String.fromCharCode(97 + i); }

export const decodeChar = (c: number): string => CHARS[c] ?? "·";
export const decodeName = (b: Uint8Array | number[]): string => Array.from(b, decodeChar).join("");
/** Python str.rstrip(): trailing whitespace only. */
export const rstrip = (s: string): string => s.replace(/\s+$/u, "");

const DICT = fileOffset(0x03, 0x71c5);
const DICT_SIZE = 80;
const DICT_CODES = [0x01, 0x02, 0x03, 0x04, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x40, 0x41, 0x42, 0x44, 0x45, 0x46,
  0x47, 0x48, 0x49, 0x4a, 0x0e, 0x0f];
const OPS: Record<number, number> = { 0x05: 0, 0x07: 0, 0x08: 0, 0x09: 1, 0x0a: 1, 0x0b: 0, 0x0c: 1, 0x0d: 1, 0x11: 1, 0x12: 1,
  0x13: 1, 0x14: 0, 0x15: 1, 0x1c: 0, 0x1d: 1, 0x1e: 1, 0x1f: 1, 0x20: 1, 0x21: 1, 0x22: 1, 0x23: 1, 0x24: 1, 0x25: 1, 0x26: 1,
  0x27: 0, 0x28: 1, 0x29: 1, 0x2a: 1, 0x2b: 1, 0x2c: 1, 0x2d: 1, 0x2e: 1, 0x2f: 1, 0x30: 1, 0x31: 1, 0x32: 1, 0x33: 1, 0x34: 0,
  0x35: 1, 0x36: 1, 0x37: 1, 0x38: 1, 0x39: 5, 0x3a: 8, 0x3b: 1, 0x3c: 4, 0x3d: 1, 0x3e: 2, 0x3f: 1, 0x43: 3, 0x4c: 0, 0x4d: 0 };
const REF_OPERANDS: Record<number, number[]> = { 0x3e: [0], 0x39: [1, 3], 0x3a: [2, 4, 6], 0x3c: [0, 2] };
export const REGIONS: [number, number, number][] = [
  [0x03, 0x6287, 0x71b5], [0x09, 0x5eac, 0x67bf], [0x09, 0x6c5f, 0x78fe], [0x09, 0x79c4, 0x8000],
  [0x0a, 0x4000, 0x4004], [0x0a, 0x41e2, 0x791e], [0x0a, 0x792e, 0x8000]];
export const POINTER_TABLES: Record<string, [number, number, number]> = {
  "0A:4004": [0x0a, 0x4004, 239], "09:78FE": [0x09, 0x78fe, 99], "0A:791E": [0x0a, 0x791e, 8] };
const EXTRA: Record<number, string> = { 0xac: ",", 0xad: "'", 0xee: "”", 0xef: "“", 0xf5: "○", 0xf6: "×",
  0xfd: "©", 0xfe: ".”" };
const lit = (c: number): string => EXTRA[c] ?? (c >= 0x88 && CHARS[c] !== undefined ? CHARS[c]! : `{$${hex(c)}}`);

export type Token = ["lit", number] | ["dict", number] | ["nl"] | ["code", number, number[]] | ["end", number];
export type Ref = ["scene", number, number] | [number, number];

export function ref(lo: number, hi: number): Ref {
  if (hi < 0x40) return ["scene", hi, lo];
  if (!(hi & 0x80)) return [0x09, (hi << 8) | lo];
  if (!(hi & 0x40)) return [0x0a, (((hi & 0x7f) | 0x40) << 8) | lo];
  return [0x03, ((hi & 0x7f) << 8) | lo];
}

export function dictionary(rom: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let o = DICT;
  for (let i = 0; i < DICT_SIZE; i++) { const n = rom[o]!; out.push(rom.slice(o + 1, o + 1 + n)); o += 1 + n; }
  return out;
}

function dictIndex(c: number): number | null {
  if (c >= 0x4e && c < 0x88) return c - 0x4e;
  const k = DICT_CODES.indexOf(c);
  return k >= 0 ? 58 + k : null;
}

export function tokens(rom: Uint8Array, off: number): [Token[], number] {
  const out: Token[] = [];
  for (;;) {
    const c = rom[off++]!;
    if (c === 0x00 || c === 0x10) { out.push(["end", c]); return [out, off]; }
    if (c >= 0x88) out.push(["lit", c]);
    else if (dictIndex(c) !== null) out.push(["dict", dictIndex(c)!]);
    else if (c === 0x06) out.push(["nl"]);
    else if (c in OPS) { out.push(["code", c, Array.from(rom.subarray(off, off + OPS[c]!))]); off += OPS[c]!; }
    else throw new Error(`unknown text code ${hex(c)}`);
  }
}

export function render(toks: Token[], dic: Uint8Array[]): string {
  let s = "";
  for (const t of toks) {
    if (t[0] === "lit") s += lit(t[1]);
    else if (t[0] === "dict") { const e = new Uint8Array(dic[t[1]]!.length + 1); e.set(dic[t[1]]!); s += render(tokens(e, 0)[0], dic); }
    else if (t[0] === "nl") s += "\n";
    else if (t[0] === "code") s += "{" + [t[1], ...t[2]].map((x) => hex(x)).join(" ") + "}";
    else if (t[1] === 0x10) s += "{10}";
  }
  return s;
}

export interface Script { id: string; bank: number; address: number; length: number; end: number; text: string; refs: Ref[] }

export function scripts(rom: Uint8Array): Script[] {
  const dic = dictionary(rom), rows: Script[] = [];
  for (const [bank, first, end] of REGIONS) {
    let o = fileOffset(bank, first);
    const stop = fileOffset(bank, end - 1) + 1;
    while (o < stop) {
      const [toks, nxt] = tokens(rom, o);
      const refs: Ref[] = [];
      for (const t of toks) if (t[0] === "code" && REF_OPERANDS[t[1]]) for (const k of REF_OPERANDS[t[1]]!) refs.push(ref(t[2][k]!, t[2][k + 1]!));
      const [b, a] = bankAddress(o);
      rows.push({ id: `${hex(b)}:${hex(a, 4)}`, bank: b, address: a, length: nxt - o, end: (toks[toks.length - 1] as ["end", number])[1],
        text: render(toks, dic), refs });
      o = nxt;
    }
    if (o !== stop) throw new Error(`text region ${hex(bank)}:${hex(first, 4)} does not end at ${hex(end, 4)}`);
  }
  return rows;
}

export function pointerTable(rom: Uint8Array, name = "0A:4004"): number[] {
  const [bank, addr, n] = POINTER_TABLES[name]!;
  const o = fileOffset(bank, addr);
  return Array.from({ length: n }, (_, i) => u16(rom, o + 2 * i));
}

export function exportText(rom: Uint8Array) {
  const dic = dictionary(rom);
  return {
    dictionary: dic.map((e) => { const b = new Uint8Array(e.length + 1); b.set(e); return render(tokens(b, 0)[0], dic); }),
    regions: REGIONS.map(([b, a, e]) => `${hex(b)}:${hex(a, 4)}-${hex(e - 1, 4)}`),
    pointer_tables: Object.fromEntries(Object.keys(POINTER_TABLES).map((k) => [k, pointerTable(rom, k).map((p) => hex(p, 4))])),
    scripts: scripts(rom),
  };
}
