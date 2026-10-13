/** Legend III name entry (0F:7A44 for each of the four members, from 01:7D75 after the
 *  prologue): the letter grid (09:78A0 -> D000 by 00:240E), the menu boxes of 0F:7B90 (portrait,
 *  class and name, the grid) through 09:4FEF, the cursor C080 (y 40-90, x 10-90) moved by the menu
 *  input 00:1E51. */
import type { Game, Co } from "./game.js";
import { copy, copyB, fill, far0, far0Sync, farcall, farSync, pushBank, popBank, fadeIn, fadeOut, soundBuzz,
  memberOffset, windowOff, textEnd, bracketLeave } from "./sys.js";
import { loadSpriteTiles } from "./sprites.js";
import { windowTop, menuInput } from "./title.js";
import { printText } from "./text.js";
import { menu } from "./menu.js";
import { NotPorted } from "./irq.js";

/** 00:20CF — the first 36 objects of the OAM buffer hidden (y 0). */
export function oamClear(g: Game): void {
  for (let k = 0; k < 0x24; k++) g.m.wr(0xc000 + 4 * k, 0);
}

/** 00:240E — the letter grid: 54 letters of 09:78A0 each after a blank (FF) -> D000, codes
 *  below 4E as they are, then 00. */
export function letterGrid(g: Game): void {
  const m = g.m;
  pushBank(g, 0x09);
  let hl = 0x78a0, de = 0xd000, c = 0x36;
  for (;;) {
    const a = m.rd(hl++);
    if (a >= 0x4e) {
      m.wr(de++, 0xff);
      c = (c - 1) & 0xff;
      m.wr(de++, a);
      if (!c) break;
    } else m.wr(de++, a);
  }
  m.wr(de, 0);
  popBank(g);
}

/** 0F:7B64 — the name entry screen of member a: its starting record (07:7A81 + 0x60 a -> C680),
 *  the sprite tiles (0B:7DCA), the boxes (0F:7B90 -> C8B0) drawn (00:1E49), the cursor at
 *  (40, 10), the window at the top. */
export function* entryScreen(g: Game, a: number): Co {
  const m = g.m;
  const off = (0x60 * a) & 0xffff;
  far0Sync(g, 0x07, () => copyB(m, (0x7a81 + off) & 0xffff, 0xc680, 0x60));
  farSync(g, 0x0b, () => loadSpriteTiles(g, 0));
  copyB(m, 0x7b90, 0xc8b0, 0x17);
  yield* menu(g);
  m.wr(0xc080, 0x40);
  m.wr(0xc081, 0x10);
  farSync(g, 0x0b, () => windowTop(g));
}

/** 0F:7B4B — the letter under the cursor: 09:78A0 + 9 CD15 + (C081 - 10) / 16. */
function letterAt(g: Game): number {
  const m = g.m;
  const b = m.rd(0xcd15);
  const x = (m.rd(0xc081) - 0x10) & 0xff;
  const c = ((x << 4) | (x >> 4)) & 0xff;
  const a = (b * 9 + c) & 0xff;
  pushBank(g, 0x09);
  const v = m.rd(0x78a0 + a);
  popBank(g);
  return v;
}

/** 0F:7B35 — letter a shown at position CD18 of the name (column 0D + CD18, row 1). */
function* showLetter(g: Game, a: number): Co {
  const m = g.m;
  m.wr(0xcd46, a);
  m.wr(0xcd47, 0);
  const e = (m.rd(0xcd18) + 0x0d) & 0xff;
  yield* far0(g, 0x00, () => printText(g, 0x04, 0xcd46, 0x0100 | e, 0x0201));
}

/** 0F:7A44 — enter the name of member a (CD4E): the screen, CDEA = 0, the grid pointer CDE6 =
 *  D000, row CD15 and length CD18 0; A adds the letter (the first one clears the name C687 and
 *  its 6 places; a blank is stored as 4C; 6 letters: buzzer), B takes one back (none left:
 *  CDEA = FF and out), Start keeps the name (none: buzzer) in the member's record (C507 + ...),
 *  the directions move the cursor around the 9 x 6 grid. */
export function* nameEntry(g: Game, a: number): Co {
  const m = g.m;
  m.wr(0xcd4e, a);
  yield* farcall(g, 0x0f, () => entryScreen(g, a));
  m.wr(0xcdea, 0);
  m.wr(0xcde6, 0x00);
  m.wr(0xcde7, 0xd0);
  m.wr(0xcd15, 0);
  m.wr(0xcd18, 0);
  yield* menuInput(g, function* (i) {
    switch (i) {
      case 0: { // 0F:7A6E
        const n = m.rd(0xcd18);
        if (n === 0) {
          fill(m, 0xc687, 6, 0xff);
          yield* far0(g, 0x00, () => printText(g, 0x04, 0x3161, 0x010d, 0x0206));
        } else if (n === 6) { yield* soundBuzz(g); return false; }
        const v = letterAt(g);
        m.wr((0xc687 + m.rd(0xcd18)) & 0xffff, v === 0xff ? 0x4c : v);
        yield* showLetter(g, v);
        m.wr(0xcd18, m.rd(0xcd18) + 1);
        return false;
      }
      case 1: { // 0F:7AAB
        const n = m.rd(0xcd18);
        if (n) {
          m.wr(0xcd18, n - 1);
          m.wr((0xc687 + n - 1) & 0xffff, 0xff);
          yield* showLetter(g, 0xff);
          return false;
        }
        m.wr(0xcdea, 0xff);
        return true;
      }
      case 2: yield* soundBuzz(g); return false;
      case 3: { // 0F:7AC5
        if (m.rd(0xcd18) === 0 && m.rd(0xc687) === 0xff) { yield* soundBuzz(g); return false; }
        copy(m, 0xc687, (0xc507 + memberOffset(m, m.rd(0xcd4e))) & 0xffff, 6);
        return true;
      }
      case 4: { const x = m.rd(0xc081); m.wr(0xc081, x === 0x90 ? 0x10 : x + 0x10); return false; } // 0F:7AE8
      case 5: { const x = (m.rd(0xc081) - 0x10) & 0xff; m.wr(0xc081, x ? x : 0x90); return false; } // 0F:7AF7
      case 6: { // 0F:7B04
        const r = m.rd(0xcd15);
        if (r) { m.wr(0xcd15, r - 1); m.wr(0xc080, (m.rd(0xc080) - 0x10) & 0xff); }
        else { m.wr(0xcd15, 5); m.wr(0xc080, 0x90); }
        return false;
      }
      default: { // 0F:7B1C
        const r = m.rd(0xcd15);
        if (r === 5) { m.wr(0xcd15, 0); m.wr(0xc080, 0x40); }
        else { m.wr(0xcd15, r + 1); m.wr(0xc080, (m.rd(0xc080) + 0x10) & 0xff); }
        return false;
      }
    }
  });
}

/** 01:7D75 — after the prologue: fade out, C200-C20F cleared, the window at the top, the objects
 *  hidden, the letter grid, the first entry screen (0F:7B64), the arrow objects' x (C089 / C08D
 *  = 8), fade in; then the four names (B on a first letter goes back a member). */
export function* names(g: Game): Co {
  const m = g.m;
  yield* fadeOut(g);
  fill(m, 0xc200, 0x10, 0);
  farSync(g, 0x0b, () => windowTop(g));
  oamClear(g);
  letterGrid(g);
  yield* farcall(g, 0x0f, () => entryScreen(g, 0));
  m.wr(0xc089, 0x08);
  m.wr(0xc08d, 0x08);
  yield* fadeIn(g);
  let b = 4;
  do {
    const k = 4 - b;
    yield* farcall(g, 0x0f, () => nameEntry(g, k));
    if (m.rd(0xcdea) === 0xff) {
      if (b === 4) continue;
      b += 2;
    }
    b--;
  } while (b);
  // 01:7DAE
  yield* fadeOut(g);
  copyB(m, 0xc620, 0xc680, 0x60);
  farSync(g, 0x0b, () => memberFromTable(g, 3, 2));
  farSync(g, 0x0b, () => m.wr((0xc503 + 0x60 * 4) & 0xffff, 0xff));
  // 01:7DC5
  farSync(g, 0x0f, () => levelValues(g));
  farSync(g, 0x0b, () => farSync(g, 0x0f, () => { fill(m, 0x9800, 0x0800, 0xff); }));
  yield* g.point(0x017dca); // after the 2 KiB fill (CPU time): WY 50 turns the frame work to the field
  windowOff(m);
  m.wr(0xff4a, 0x50);
  oamClear(g);
  yield* textEnd(g);
  yield* bracketLeave(g);
}

/** 0B:6DE4 — member slot a (here 3, b = 2): CE00 + 4 a cleared (4 bytes), then its record (C500 +
 *  0x60 a) from the starting records, number 0B:7573[b] (07:7A81 + 0x60 n). (b = 6: the record
 *  kept aside at C620, not ported.) */
export function memberFromTable(g: Game, a: number, b: number): void {
  const m = g.m;
  fill(m, (0xce00 + 4 * a) & 0xffff, 4, 0);
  if (a === 3 && b === 6) throw new NotPorted("0B:6E15 (member slot 3 kept aside)");
  const n = m.rd(0x7573 + b);
  far0Sync(g, 0x07, () => copyB(m, (0x7a81 + 0x60 * n) & 0xffff, (0xc500 + 0x60 * a) & 0xffff, 0x60));
}

/** 00:2499 — CD46-CD49 = (CD48/CD49) x (CD46/CD47) (shift and add, 16 steps). */
export function mul16(g: Game): void {
  const m = g.m;
  const e = m.rd(0xcd46), d = m.rd(0xcd47);
  m.wr(0xcd46, 0);
  m.wr(0xcd47, 0);
  for (let b = 0; b < 16; b++) {
    let carry = 0;
    for (let k = 0; k < 4; k++) {
      const v = (m.rd(0xcd46 + k) << 1) | carry;
      carry = v >> 8;
      m.wr(0xcd46 + k, v & 0xff);
    }
    if (carry) {
      let v = m.rd(0xcd46) + e; m.wr(0xcd46, v & 0xff); let c = v >> 8;
      v = m.rd(0xcd47) + d + c; m.wr(0xcd47, v & 0xff); c = v >> 8;
      v = m.rd(0xcd48) + c; m.wr(0xcd48, v & 0xff); c = v >> 8;
      v = m.rd(0xcd49) + c; m.wr(0xcd49, v & 0xff);
    }
  }
}

/** 0F:79D4 — for members 0-3 a 3-byte value at CD9D + 3 k from the level byte L (C503 + ...;
 *  63: 0): (L + 4) (L + 1)^2 (00:246B, 00:2499). */
export function levelValues(g: Game): void {
  const m = g.m;
  for (let k = 0; k < 4; k++) {
    m.wr(0xcd46, 0); m.wr(0xcd47, 0); m.wr(0xcd48, 0);
    const v = m.rd((memberOffset(m, k) + 0xc503) & 0xffff);
    if (v !== 0x63) {
      const a = (v + 4) & 0xff;
      m.wr(0xcd46, a);
      const l = (a - 3) & 0xff;
      const hl = (l * l) & 0xffff;
      m.wr(0xcd48, hl & 0xff);
      m.wr(0xcd49, hl >> 8);
      mul16(g);
    }
    copy(m, 0xcd46, (0xcd9d + 3 * k) & 0xffff, 3);
  }
}
