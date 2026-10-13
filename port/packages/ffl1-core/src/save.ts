/** Legend I battery RAM (MBC2, 512 nibbles at A000): the 256-byte game state CC00-CCFF stored
 *  as low nibble then high nibble (00:04F6 load, 00:050D save); CCFC/CCFD = 1B E4 marks a
 *  save, CCFE/CCFF = the sum of CC00-CCFD (00:0542). */
import type { Game } from "./game.js";
import { copyBank, fill, sub16 } from "./sys.js";

/** 00:0533 + 00:04F6 + 00:0508 — read the save into CC00-CCFF (RAM enabled and disabled again). */
export function loadSave(g: Game): void {
  const m = g.m;
  g.ime = false;
  m.wr(0x0000, 0x0a);
  let hl = 0xa000;
  for (let de = 0xcc00; de < 0xcd00; de++) {
    const lo = m.rd(hl++) & 0x0f, hi = m.rd(hl++) & 0x0f;
    m.wr(de, (hi << 4) | lo);
  }
  m.wr(0x0000, 0);
  g.ime = true;
}

/** 00:0542 — sum of CC00-CCFD. */
export function saveSum(g: Game): number {
  let hl = 0;
  for (let de = 0xcc00; de < 0xccfe; de++) hl = (hl + g.m.rd(de)) & 0xffff;
  return hl;
}

/** 00:050D — mark, checksum and write CC00-CCFF to the battery RAM. */
export function writeSave(g: Game): void {
  const m = g.m;
  m.wr(0xccfc, 0x1b);
  m.wr(0xccfd, 0xe4);
  const s = saveSum(g);
  m.wr(0xccfe, s & 0xff);
  m.wr(0xccff, s >> 8);
  g.ime = false;
  m.wr(0x0000, 0x0a);
  let hl = 0xa000;
  for (let de = 0xcc00; de < 0xcd00; de++) {
    const a = m.rd(de);
    m.wr(hl++, a);
    m.wr(hl++, ((a << 4) | (a >> 4)) & 0xff);
  }
  m.wr(0x0000, 0);
  g.ime = true;
}

/** 00:04A6 — load and validate the save; returns true (carry) when valid, else starts a new
 *  party (00:04C8) and returns false. */
export function checkSave(g: Game): boolean {
  const m = g.m;
  loadSave(g);
  if (m.rd(0xccfc) === 0x1b && m.rd(0xccfd) === 0xe4) {
    const sum = saveSum(g);
    const lo = m.rd(0xccfe);
    const c = sub16(m, lo, lo | (m.rd(0xccff) << 8), sum);
    if (c.zero) return true;
  }
  newParty(g);
  return false;
}

/** 00:04C8 — a new game state: CC00-CCFB cleared, members 1-3 absent (FF), CC7C-CC8B = FF, text
 *  speed CCCA = 4, CC99-CCA4 from 02:6FC7. */
export function newParty(g: Game): void {
  const m = g.m;
  fill(m, 0xcc00, 0xfc, 0);
  m.wr(0xcc1f, 0xff);
  m.wr(0xcc3e, 0xff);
  m.wr(0xcc5d, 0xff);
  fill(m, 0xcc7c, 0x10, 0xff);
  m.wr(0xccca, 4);
  copyBank(g, 0x02, 0x6fc7, 0xcc99, 0x0c);
}
