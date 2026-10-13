/** Legend I name encoding (0x8A 'A', 0xA4 'a', 0x80 '0', 0xFF space, 0xF2 '-') and the dialogue /
 *  engine text decoders (dictionary 05:4E40; codes 0x50-0x7F and 0xC0-0xE7). Mirrors
 *  src/ffl1kster/text.py and script_text.py. */
import { fileOffset, u16 } from "./rom.js";

export function decodeName(b: Uint8Array): string {
  let s = "";
  for (const c of b) {
    if (c >= 0x8a && c <= 0xa3) s += String.fromCharCode(65 + c - 0x8a);
    else if (c >= 0xa4 && c <= 0xbd) s += String.fromCharCode(97 + c - 0xa4);
    else if (c >= 0x80 && c <= 0x89) s += String.fromCharCode(48 + c - 0x80);
    else if (c === 0xff) s += " ";
    else if (c === 0xf2) s += "-";
    else s += "{" + c.toString(16).toUpperCase().padStart(2, "0") + "}";
  }
  return s;
}

export const DICT = fileOffset(0x05, 0x4e40);
const PUNCT: Record<number, string> = { 0xf0: ".", 0xbf: ",", 0xbe: "'", 0xf2: "-" };
const literal = (c: number): string => PUNCT[c] ?? decodeName(Uint8Array.of(c));

export function pairs(rom: Uint8Array): string[] {
  return Array.from({ length: 88 }, (_, i) => literal(rom[DICT + 2 * i]!) + literal(rom[DICT + 2 * i + 1]!));
}

function pairIndex(c: number): number | null {
  if (c >= 0x50 && c <= 0x7f) return c - 0x50;
  if (c >= 0xc0 && c <= 0xe7) return c - 0xc0 + 48;
  return null;
}

function char(p: string[], c: number): string | null {
  const k = pairIndex(c);
  if (k !== null) return p[k]!;
  if ((c >= 0x80 && c <= 0xbd) || c === 0xff) return decodeName(Uint8Array.of(c));
  return PUNCT[c] ?? null;
}

const ENGINE_END = new Set([...Array(10).keys(), 0x0b, 0x0c, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b]);
const ENGINE_ARGS: Record<number, number> = { 0x20: 1, 0x21: 2, 0x22: 1, 0x23: 1, 0x25: 1, 0x26: 1, 0x27: 1, 0x28: 1, 0x29: 1,
  0x2a: 1, 0x2b: 1, 0x2c: 1, 0x32: 1, 0x35: 2, 0x36: 1, 0x38: 1, 0x3a: 1, 0x3c: 1, 0x3d: 1 };
const DIALOGUE_ARGS: Record<number, number> = { 0x01: 2, 0x02: 2, 0x11: 2, 0x12: 2, 0x16: 1, 0x19: 1 };
const DIALOGUE_CODES = new Set([0x00, 0x04, 0x13, 0x14, 0x15, 0x1a, ...Object.keys(DIALOGUE_ARGS).map(Number)]);

const hex2 = (v: number): string => v.toString(16).toUpperCase().padStart(2, "0");

/** Parse one string; returns the rendered text (same notation as the Python export) and length. */
export function parseText(rom: Uint8Array, start: number, kind: "engine" | "dialogue"): { text: string; length: number } {
  const p = pairs(rom);
  let s = "";
  let i = start;
  const code = (c: number, n: number) => {
    let t = "{" + hex2(c);
    for (let k = 1; k <= n; k++) t += " " + hex2(rom[i + k]!);
    s += t + "}";
    i += 1 + n;
  };
  for (;;) {
    const c = rom[i]!;
    if (kind === "engine" && c < 0x40) {
      if (ENGINE_END.has(c)) { code(c, 0); break; }
      code(c, ENGINE_ARGS[c] ?? 0);
      continue;
    }
    if (kind === "dialogue" && c < 0x50 && c !== 0x0d && DIALOGUE_CODES.has(c)) {
      code(c, DIALOGUE_ARGS[c] ?? 0);
      if (c === 0x00) break;
      continue;
    }
    const ch = char(p, c);
    if (ch === null) code(c, 0);
    else { s += ch; i++; }
  }
  return { text: s, length: i - start };
}

export const TEXT_TABLES: Record<string, { bank: number; address: number; count: number; kind: "engine" | "dialogue" }> = {
  battle: { bank: 0x02, address: 0x7860, count: 80, kind: "engine" },
  ui: { bank: 0x03, address: 0x7080, count: 51, kind: "engine" },
  dialogue: { bank: 0x05, address: 0x7b30, count: 255, kind: "dialogue" },
};

export interface TextEntry { id: number; pointer: string; length: number; text: string }

export function textTable(rom: Uint8Array, name: string): TextEntry[] {
  const t = TEXT_TABLES[name]!;
  const base = fileOffset(t.bank, t.address);
  return Array.from({ length: t.count }, (_, id) => {
    const ptr = u16(rom, base + 2 * id);
    const r = parseText(rom, fileOffset(t.bank, ptr), t.kind);
    return { id, pointer: ptr.toString(16).toUpperCase().padStart(4, "0"), length: r.length, text: r.text };
  });
}

export function exportText(rom: Uint8Array) {
  const tables: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(TEXT_TABLES)) {
    tables[name] = { bank: t.bank, pointer_table: t.address.toString(16).toUpperCase().padStart(4, "0"),
      interpreter: t.kind, entries: textTable(rom, name) };
  }
  return { dictionary: pairs(rom), tables };
}
