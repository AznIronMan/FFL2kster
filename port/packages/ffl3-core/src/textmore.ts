/** Legend III text engine, the remaining branches: the scene codes (00:3086) and dictionary codes
 *  (00:308C) reached through the code table 00:3175 (the menu side 09:519C, and code 4B on the
 *  text side), the two special newlines of code 06 (00:26D3 with CD3A set, 00:26E3 with CD34 bit
 *  4), the menu side of code 1F 10-1F (00:29A5) and 00:1EE7 with a = 0.
 *
 *  Registers at a handler of 00:3175: hl = the text after the code byte. From the text
 *  interpreter (00:32CB) bc = hl and, for codes below 4E, de = 3175 (the table base it added);
 *  from a menu row (09:519C) de = the row position, b = the row's count. */
import type { Game, Co } from "./game.js";
import type { Memory } from "./memory.js";
import { pushBank, popBank, farcall, far0, copy, copyB } from "./sys.js";
import { NotPorted } from "./irq.js";
import { printText } from "./text.js";
import { sceneCode } from "./events.js";

// ---------------------------------------------------------------- 00:1EE7

/** 00:1EE7 — the index of the lowest set bit of a (c counted up per rra until the carry). The
 *  carry on entry rotates in at bit 7, so it only matters for a = 0: carry set -> 8 (nine rra);
 *  carry clear -> the original loops forever (thrown). Its callers: 00:1E6D, 00:22D6 and 00:2801
 *  never pass 0 (and / or a with jr z before); 00:22A4 passes [hl] after rlc [hl] (carry = its
 *  bit 0, clear when 0); 00:3073 (code 4D, a = CDC0) enters with the carry clear on both sides
 *  (00:32CB add hl,de / 09:519C rst $00 of 2 x 4D to 3175: no carry; 00:27C5 keeps it). */
export function lowestSetBit(a: number, carry: boolean): number {
  a &= 0xff;
  if (!a) {
    if (carry) return 8;
    throw new NotPorted("00:1EE7 with a = 0 and the carry clear (the original loops forever)");
  }
  let c = 0;
  while (!(a & 1)) { a >>= 1; c++; }
  return c;
}

// ---------------------------------------------------------------- 00:3086 / 00:308C

/** 00:3086 — scene code c with its operand at hl: 0B:6C35 (the script reference (operand, the
 *  type of c in 0B:6C4C) through 00:2EF6, mode 40). hl moves past the operand (0B:6C35 inc hl);
 *  de and b are kept (00:2EF8 saves them). Returns [hl, de, b]. */
export function* sceneTextCode(g: Game, c: number, hl: number, de: number, b: number): Co<[number, number, number]> {
  const op = g.m.rd(hl);
  yield* farcall(g, 0x0b, () => sceneCode(g, c, op));
  return [(hl + 1) & 0xffff, de, b];
}

/** 00:30B8 — the dictionary entry of code c: 4E and above c - 4E; else 3A + the position of c
 *  in the 0-terminated list 00:30D1 (a code not listed, i.e. 4B: 3A + the list length + 1). */
function dictIndex(m: Memory, c: number): number {
  if (c >= 0x4e) return (c - 0x4e) & 0xff;
  let b = 0x3a;
  for (let p = 0x30d1; ; p++) {
    const v = m.rd(p);
    if (v === c) return b;
    b = (b + 1) & 0xff;
    if (!v) return b;
  }
}

/** 00:308C — dictionary code c: entry k of the length-prefixed strings 03:71C5 copied to CD4D
 *  (00:1F97; a 00 after it), then drawn as a text in the open box (00:3211 mode 40). hl, de and
 *  bc are kept (pushed). Returns [hl, de, b]. */
export function* dictTextCode(g: Game, c: number, hl: number, de: number, b: number): Co<[number, number, number]> {
  const m = g.m;
  let k = dictIndex(m, c);
  let p = 0x71c5;
  pushBank(g, 0x03);
  for (; k; k--) p = (p + 1 + m.rd(p)) & 0xffff;
  const n = m.rd(p);
  p = (p + 1) & 0xffff;
  const [, end] = copyB(m, p, 0xcd4d, n);
  popBank(g);
  m.wr(end, 0x00);
  yield* far0(g, 0, () => printText(g, 0x40, 0xcd4d, end, 0)); // mode 40: de / bc unused
  return [hl, de, b];
}

// ---------------------------------------------------------------- code 06 (00:26CC)

/** 00:3114 with CD3A set (00:3168): c characters from hl copied to de on a letter row (CD12 bit
 *  0, 00:1F97), else skipped; de += c, b -= c. Returns [de, b]. */
function menuChars(m: Memory, hl: number, c: number, de: number, b: number): [number, number] {
  c &= 0xff;
  if (!c) return [de, b];
  if (m.rd(0xcd12) & 0x01) copyB(m, hl, de, c);
  return [(de + c) & 0xffff, (b - c) & 0xff];
}

/** 00:26D3 — code 06 with CD3A set: b blanks (00:3155, c = b) through 00:3114 (menu side: copied
 *  to de on a letter row, CD12 bit 0). From the text interpreter (a text drawn while a menu is
 *  built, e.g. a dictionary entry of a box) de = 3175 and b = the high byte of the text pointer,
 *  so a letter row gets b bytes of 00:3155.. written from 3175 on (the MBC registers). Returns
 *  [de, b]. */
export function listNewline(g: Game, de: number, b: number): [number, number] {
  return menuChars(g.m, 0x3155, b, de, b);
}

/** 00:26E3 — code 06 with CD34 bit 4: the bit cleared, the lower line buffer C894 (18 tiles,
 *  00:1F60) to the upper one C880, CD06 = 0. Returns de as left (C892). */
export function upperRowNewline(m: Memory): number {
  m.wr(0xcd34, m.rd(0xcd34) & 0xef);
  const [, de] = copy(m, 0xc894, 0xc880, 18);
  m.wr(0xcd06, 0x00);
  return de;
}

// ---------------------------------------------------------------- code 1F 10-1F (menu side)

/** 00:29A5 (a = 10-1F, the parameter of code 1F) on the menu side: the monster name 07:7A88 +
 *  60 (a - 0C) (00:246B, 16-bit), CD34 bit 1 set (00:27C5), 6 letters through 00:3108 with bank
 *  07 (CD3A set: 00:3168). Returns [de, b]. */
export function monsterNameMenu(g: Game, a: number, de: number, b: number): [number, number] {
  const m = g.m;
  const k = (a - 0x0c) & 0xff;
  const src = ((k * 0x60) + 0x7a88) & 0xffff;
  m.wr(0xcd34, m.rd(0xcd34) | 0x02);
  pushBank(g, 0x07);
  const r = menuChars(m, src, 0x06, de, b);
  popBank(g);
  return r;
}
