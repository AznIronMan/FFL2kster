/** Legend III odds and ends (3): the sprite tiles of one member (0B:7DCA with a != 0), the
 *  battle objects of the sprites reset (09:410C), the member slot 3 kept aside (0B:6E15) and the
 *  menu side of a text code that waits (09:519C -> 00:3175). */
import type { Game, Co } from "./game.js";
import { copy, copyB, far0Sync, farSync } from "./sys.js";
import { memberTiles } from "./sprites.js";
import { levelValues } from "./names.js";
import { textCode } from "./textcodes.js";

/** 0B:7DCA with a != 0 (`jp nz,$7E17`) — the 4 sprite tiles of the member record at hl (C50D +
 *  offset) to de (0B:7E17 entered as it is, its sync point included; CD4D = a). Returns de
 *  after. */
export function* memberSpriteTiles(g: Game, a: number, hl: number, de: number): Co<number> {
  return yield* memberTiles(g, a, hl, de);
}

/** 09:410C — the sprites reset in battle (CD37 set): the 4 objects of 09:412F (y 0, x 0, tile 24,
 *  attributes 00 / 40 / 20 / 60) to C090 and to C050, then C050 -> C060 and C060 -> C070 (16
 *  bytes each, 00:1F66). The code goes on into 09:4127 (the walking figures). */
export function battleOam(g: Game): void {
  const m = g.m;
  copy(m, 0x412f, 0xc090, 16);
  let [hl, de] = copy(m, 0x412f, 0xc050, 16);
  [hl, de] = copy(m, 0xc050, de, 16);
  copy(m, hl, de, 16);
}

/** 0B:6E15 — member slot 3 with starting number 6 (from 0B:6DE4, after CE0C-CE0F were cleared):
 *  no starting record; the name entry's record C680 is kept aside at C620 (0x60 bytes, 00:1F97),
 *  its byte 3 (the level) from 07:7BA4 (starting record 3's), then (jp 00:1E46) the members'
 *  level values (0F:79D4). */
export function slotKeptAside(g: Game): void {
  const m = g.m;
  far0Sync(g, 0x00, () => copyB(m, 0xc680, 0xc620, 0x60));
  far0Sync(g, 0x07, () => copyB(m, 0x7ba4, 0xc623, 0x01));
  farSync(g, 0x0f, () => levelValues(g));
}

/** 09:519C (the dispatch) — a control code met in a menu box row: the text engine's handler
 *  (00:3175 table, CD3A set) with hl the text after the code, de the line position, b the row's
 *  count. The original simply calls it: a handler that waits (code 0C's pause 00:2766, the A
 *  waits 00:274D / 00:275C, code 3C's yes / no...) waits right there, in
 *  the middle of 09:5045's rows (the OAM DMA held by CD39, the frame waits counted by the normal
 *  vblank). Returns the handler's [hl, de, b] (09:51BA's de - 1, b + 1 are the caller's). */
export function* menuTextCode(g: Game, c: number, hl: number, de: number, b: number): Co<[number, number, number]> {
  return yield* textCode(g, c, hl, de, b);
}
