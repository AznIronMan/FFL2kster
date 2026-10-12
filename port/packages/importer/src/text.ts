/** Fixed-width names and script text (port of ffl2kster.text / ffl2kster.script_text). */

/** ffl2kster.text.decode: letters, digits, space, '-', '.'; other bytes as {XX}; right-trimmed. */
export function decodeName(b: Uint8Array | number[]): string {
  let s = "";
  for (const x of b) {
    if (x >= 0xba && x <= 0xd3) s += String.fromCharCode(65 + x - 0xba);
    else if (x >= 0xd4 && x <= 0xed) s += String.fromCharCode(97 + x - 0xd4);
    else if (x >= 0xb0 && x <= 0xb9) s += String.fromCharCode(48 + x - 0xb0);
    else if (x === 0xff) s += " ";
    else if (x === 0xf2) s += "-";
    else if (x === 0xf0) s += ".";
    else s += `{${hex2(x)}}`;
  }
  return s.replace(/\s+$/, "");
}

export function hex2(x: number): string {
  return x.toString(16).toUpperCase().padStart(2, "0");
}

export const DICT_OFFSET = 0x3e560; // 0F:6560
export const CTRL_TABLE = 0x13be;

/** Argument byte counts per control code (see docs/FINDINGS.md). */
export const ARGS: Record<number, number> = (() => {
  const a: Record<number, number> = {};
  for (let i = 0; i < 0x4e; i++) a[i] = 0;
  Object.assign(a, {
    0x07: 1, 0x08: 1, 0x09: 1, 0x11: 1, 0x14: 2, 0x15: 2, 0x17: 1, 0x19: 2, 0x1a: 1, 0x1b: 1,
    0x1c: 1, 0x1d: 1, 0x1f: 1, 0x20: 1, 0x21: 2, 0x22: 1, 0x23: 1, 0x26: 1, 0x2b: 1, 0x2d: 1,
    0x30: 1, 0x32: 1, 0x33: 2, 0x35: 1, 0x36: 1, 0x39: 1, 0x3a: 1, 0x3e: 0, 0x3f: 2, 0x41: 1,
    0x44: 1, 0x45: 1, 0x48: 2, 0x49: 1, 0x12: 1, 0x13: 1, 0x18: 1, 0x40: 1, 0x4b: 1,
  });
  return a;
})();

const PUNCT: Record<number, string> = {
  0xee: "'", 0xef: ",", 0xf0: ".", 0xf1: "…", 0xf2: "-", 0xf3: "!", 0xf4: "?", 0xf5: ":", 0xf6: "/", 0xff: " ",
};

export function glyph(b: number): string {
  const p = PUNCT[b];
  if (p !== undefined) return p;
  const s = decodeName([b]);
  return s && !s.startsWith("{") ? s : `{${hex2(b)}}`;
}

export function argLen(rom: Uint8Array, i: number, code: number): number {
  if (code === 0x20) {
    const sub = rom[i] ?? 0;
    return 1 + (sub < 0x4e ? (ARGS[sub] ?? 0) : 0);
  }
  return ARGS[code] ?? 0;
}

export function dictionary(rom: Uint8Array): number[][] {
  const d: number[][] = [];
  for (let i = 0; i < 0x50; i++) d.push([rom[DICT_OFFSET + 2 * i]!, rom[DICT_OFFSET + 2 * i + 1]!]);
  return d;
}

export type Token = string | [number, number[]];

export function decodeStream(rom: Uint8Array, offset: number, limit = 4096, stopAtEnd = true): [Token[], number] {
  const d = dictionary(rom);
  const out: Token[] = [];
  let buf: string[] = [];
  let i = offset;
  const end = Math.min(rom.length, offset + limit);
  while (i < end) {
    const b = rom[i]!;
    i += 1;
    if (b >= 0x9e) buf.push(glyph(b));
    else if (b >= 0x4e) buf.push(d[b - 0x4e]!.map(glyph).join(""));
    else {
      if (buf.length) {
        out.push(buf.join(""));
        buf = [];
      }
      const n = argLen(rom, i, b);
      out.push([b, Array.from(rom.subarray(i, i + n))]);
      i += n;
      if (b === 0x00 && stopAtEnd) break;
    }
  }
  if (buf.length) out.push(buf.join(""));
  return [out, i];
}

export function render(tokens: Token[]): string {
  let s = "";
  for (const t of tokens) {
    if (typeof t === "string") s += t;
    else {
      const [c, a] = t;
      if (c === 0x06) s += "\n";
      else if (c === 0x00) s += "⟨end⟩";
      else s += `⟨${hex2(c)}${a.map((x) => " " + hex2(x)).join("")}⟩`;
    }
  }
  return s;
}

export const TABLES: [string, number, number, number][] = [
  ["field", 0x28000, 256, 0x0a],
  ["story", 0x2c000, 192, 0x0b],
  ["battle", 0x2eb80, 109, 0x0b],
  ["menu", 0x2f400, 77, 0x0b],
  ["topic", 0x3c250, 16, 0x0f],
  ["phrase", 0x3c270, 256, 0x0f],
];

export const SAFE_CODES = new Set([0x00, 0x05, 0x06, 0x20, 0x36]);

export interface TableEntry {
  table: string;
  index: number;
  offset: number;
  end: number | null;
}

export function tableEntries(rom: Uint8Array): TableEntry[] {
  const out: TableEntry[] = [];
  for (const [name, base, n, bank] of TABLES) {
    const offs: number[] = [];
    for (let i = 0; i < n; i++) offs.push(bank * 0x4000 + (rom[base + 2 * i]! | (rom[base + 2 * i + 1]! << 8)) - 0x4000);
    const srt = Array.from(new Set(offs)).sort((a, b) => a - b);
    offs.forEach((o, i) => {
      const k = srt.indexOf(o);
      out.push({ table: name, index: i, offset: o, end: k + 1 < srt.length ? srt[k + 1]! : null });
    });
  }
  return out;
}

export function entryTokens(rom: Uint8Array, e: TableEntry): [Token[], number] {
  return decodeStream(rom, e.offset, e.end !== null ? e.end - e.offset : 2000, e.end === null);
}

export function entry(rom: Uint8Array, table: string, index: number): [number, number, Token[]] {
  const e = tableEntries(rom).find((x) => x.table === table && x.index === index);
  if (!e) throw new Error(`no text entry ${table}[${index}]`);
  const [toks, end] = entryTokens(rom, e);
  return [e.offset, end, toks];
}

export function resolvePhrases(rom: Uint8Array, text: string, phraseCache?: Map<number, string>): string {
  return text.replace(/⟨4B ([0-9A-F]{2})⟩/g, (_m, h: string) => {
    const n = parseInt(h, 16);
    let s = phraseCache?.get(n);
    if (s === undefined) {
      s = render(entry(rom, "phrase", n)[2]).replace(/⟨end⟩/g, "");
      phraseCache?.set(n, s);
    }
    return s;
  });
}

export interface Message {
  table: string;
  index: number;
  offset: number;
  bank: number;
  address: number;
  length: number;
  text: string;
  display: string;
  control_codes: number[];
  pure_message: boolean;
}

export function exportText(rom: Uint8Array): Message[] {
  const rows: Message[] = [];
  const cache = new Map<number, string>();
  for (const e of tableEntries(rom)) {
    const [toks, end] = entryTokens(rom, e);
    const codes = Array.from(new Set(toks.filter((t): t is [number, number[]] => typeof t !== "string").map((t) => t[0]))).sort((a, b) => a - b);
    const text = render(toks);
    rows.push({
      table: e.table, index: e.index, offset: e.offset, bank: Math.floor(e.offset / 0x4000),
      address: 0x4000 + (e.offset % 0x4000), length: end - e.offset, text,
      display: resolvePhrases(rom, text, cache), control_codes: codes,
      pure_message: codes.every((c) => SAFE_CODES.has(c)),
    });
  }
  return rows;
}


