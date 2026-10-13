/** Legend III item / spell / skill records (bank 09): the 7-byte record of id CE26 copied from the
 *  bank 09 tables to CEDB.. and the flags CE28 / CE29 derived from it. CE25 = 0: the item id space
 *  (00-2F spells, 30-77 weapons, 78-BF armor, C0-DB items); CE25 != 0: a monster ability.
 *  All routines here run with bank 09 selected (their table reads are 4000-7FFF ROM reads). */
import type { Game } from "./game.js";
import { copy, farSync } from "./sys.js";

/** 09:5E73 — hl += de, copy the 7-byte record at hl -> CEDB (00:1F81 of the copy chain). */
function recordCopy(g: Game, hl: number, de: number): void {
  copy(g.m, (hl + de) & 0xffff, 0xcedb, 7);
}

/** 09:5E6A — the monster ability record CE26: 09:57BC + 6 CE26 (00:2448) -> CEDB. */
function abilityRecord(g: Game): void {
  const a = g.m.rd(0xce26);
  recordCopy(g, (a * 6) & 0xffff, 0x57bc);
}

/** 09:5E7A — the weapon record CE26: 09:55C4 + 7 (CE26 - 30) (00:2453) -> CEDB. */
function weaponRecord(g: Game): void {
  const a = (g.m.rd(0xce26) - 0x30) & 0xff;
  recordCopy(g, (a * 7) & 0xffff, 0x55c4);
}

/** 09:5E87 — the armor record CE26: 09:5BFC + 5 (CE26 - 78) (00:243D) -> CEDB. */
function armorRecord(g: Game): void {
  const a = (g.m.rd(0xce26) - 0x78) & 0xff;
  recordCopy(g, (a * 5) & 0xffff, 0x5bfc);
}

/** 09:5E94 — the spell record CE26: 09:5A50 + 6 CE26 (00:2448) -> CEDB. */
function spellRecord(g: Game): void {
  const a = g.m.rd(0xce26);
  recordCopy(g, (a * 6) & 0xffff, 0x5a50);
}

/** 09:5E9F — the item record CE26: 09:5B70 + 5 (CE26 - C0) (00:243D) -> CEDB. */
function goodsRecord(g: Game): void {
  const a = (g.m.rd(0xce26) - 0xc0) & 0xff;
  recordCopy(g, (a * 5) & 0xffff, 0x5b70);
}

/** 09:5DC4 — a monster ability (CE25 != 0): ids below 6E copy their record, CE28 = CEE0. */
function abilityLoad(g: Game): void {
  const m = g.m;
  if (m.rd(0xce26) >= 0x6e) return;
  abilityRecord(g);
  m.wr(0xce28, m.rd(0xcee0));
}

/** 09:5DD4 — a weapon (30-77): its record; CE27 clear: CE28 = 81 (30-5D, 62-6D), 83 (5E-61,
 *  71-77) or 84 (6E-70) (09:5DF2 / 09:5DF8 / 09:5DFE); CE27 set: 09:5E04. */
function weaponLoad(g: Game): void {
  const m = g.m;
  weaponRecord(g);
  if (m.rd(0xce27)) {
    weaponSpell(g);
    return;
  }
  const a = m.rd(0xce26);
  if (a < 0x5e) m.wr(0xce28, 0x81);
  else if (a < 0x62) m.wr(0xce28, 0x83);
  else if (a < 0x6e) m.wr(0xce28, 0x81);
  else if (a < 0x71) m.wr(0xce28, 0x84);
  else m.wr(0xce28, 0x83);
}

/** 09:5E04 — a weapon with CE27 set: the record of the spell CEE0 loaded (CE26 = CEE0, CE27 = 0,
 *  farcall 09:5D7F), CE29 = 0, CE26 restored, the weapon record copied again (09:5E7A). */
function weaponSpell(g: Game): void {
  const m = g.m;
  const id = m.rd(0xce26);
  m.wr(0xce26, m.rd(0xcee0));
  m.wr(0xce27, 0);
  farSync(g, 0x09, () => itemLoad(g));
  m.wr(0xce29, 0);
  m.wr(0xce26, id);
  weaponRecord(g);
}

/** 09:5E1F — armor (78-BF): its record, then the record of CEDE loaded (CE26 = CEDE, CE27 = 0,
 *  farcall 09:5D7F), CE29 = 0, CE26 restored, the armor record copied again (09:5E87). */
function armorLoad(g: Game): void {
  const m = g.m;
  const id = m.rd(0xce26);
  armorRecord(g);
  m.wr(0xce26, m.rd(0xcede));
  m.wr(0xce27, 0);
  farSync(g, 0x09, () => itemLoad(g));
  m.wr(0xce29, 0);
  m.wr(0xce26, id);
  armorRecord(g);
}

/** 09:5E3D — a spell (00-2F): its record; CE27 clear: CE28 = CEE0 and CE29 = 2 (2 ((CE26 >> 1)
 *  & 7) + 4), for CE26 bit 5 set 2 (2 x - 8) instead. */
function spellLoad(g: Game): void {
  const m = g.m;
  spellRecord(g);
  if (m.rd(0xce27)) return;
  m.wr(0xce28, m.rd(0xcee0));
  const b = m.rd(0xce26);
  let a = (((b >> 1) | (b << 7)) & 0xff) & 0x07; // rrca, and 07
  a = (a + a) & 0xff;
  a = (a + 4) & 0xff;
  if (b & 0x20) {
    a = (a + a) & 0xff;
    a = (a - 8) & 0xff;
  }
  a = (a + a) & 0xff;
  m.wr(0xce29, a);
}

/** 09:5E61 — an item (C0-DB): its record, CE28 = 28. */
function goodsLoad(g: Game): void {
  goodsRecord(g);
  g.m.wr(0xce28, 0x28);
}

/** 09:5D87 — load the record of id CE26 (CE25 = 0: the item id space, else a monster ability) to
 *  CEDB.. and set CE28 / CE29 (both cleared first; CE26 = FF: nothing else). Items C0-DB: CD37
 *  set: only D1 and C0-CA; CD37 clear: only C0-D7. */
export function itemRecord(g: Game): void {
  const m = g.m;
  m.wr(0xce28, 0);
  m.wr(0xce29, 0);
  if (m.rd(0xce26) === 0xff) return;
  if (m.rd(0xce25)) {
    abilityLoad(g);
    return;
  }
  const a = m.rd(0xce26);
  if (a < 0x30) spellLoad(g);
  else if (a < 0x78) weaponLoad(g);
  else if (a < 0xc0) armorLoad(g);
  else if (m.rd(0xcd37)) {
    if (a === 0xd1 || a < 0xcb) goodsLoad(g);
  } else if (a < 0xd8) goodsLoad(g);
}

/** 09:5D7F — 09:5D87, then CE27 = 0. Bank 09 must be selected by the caller
 *  (`farSync(g, 0x09, () => itemLoad(g))`). */
export function itemLoad(g: Game): void {
  itemRecord(g);
  g.m.wr(0xce27, 0);
}
