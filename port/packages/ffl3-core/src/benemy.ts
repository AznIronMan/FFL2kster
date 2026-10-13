/** Legend III battle entity set-up (bank 0B, 0B:4444-469C and 0B:708B-7103): the party records
 *  C500.. copied to the battle entities D000.. (0x80 bytes each), the monster record of CC70 built
 *  in the scratch entity D680 (0E:7533 header, the 12-byte record 0B:4A19, the 9-byte item/spell
 *  list 0B:533D, the 4-byte record 0B:470D) and copied out once per monster of the groups
 *  CC59-CC5B (counts CC36-CC38), then every entity's spell bits (fields 51-56) turned into the
 *  ability flags of fields 6A-6F (0B:7543).
 *  Callers run these with bank 0B selected (the tables 0B:469D, 0B:46DD, 0B:470D, 0B:4A19,
 *  0B:533D and 0B:7543 are read from the current bank). */
import type { Game } from "./game.js";
import type { Memory } from "./memory.js";
import { copy, copyB, fill, memberOffset, far0Sync } from "./sys.js";
import { entityOffset, spellBit, entityResist, entityStats } from "./bstats.js";

/** 0E:7533 — the 8-byte monster header (D685-D68C), 8 per monster. */
const HEADER_TABLE = 0x7533;
/** 0B:4A19 — the 12-byte monster record, 12 per monster. */
const RECORD_TABLE = 0x4a19;
/** 0B:533D — the 9-byte item/spell list (a mask byte, then 8 ids), 9 per monster. */
const LIST_TABLE = 0x533d;
/** 0B:470D — the 4-byte record (D683, D68F/D6E8, D6E5-D6E7), 4 per monster. */
const EXTRA_TABLE = 0x470d;
/** 0B:469D — 4 bytes per high nibble of CC73 (-> D6D9). */
const NIBBLE4_TABLE = 0x469d;
/** 0B:46DD — 3 bytes per high nibble of CC74 (-> D6DD). */
const NIBBLE3_TABLE = 0x46dd;
/** 0B:7543 — per spell bit: the ability flag (byte << 3 | bit) in fields 6A.. */
const FLAG_TABLE = 0x7543;

/** 00:1C7E — 16 x 16 multiply (registers only; entered with carry clear): the low 16 bits of
 *  hl x de (returned in de). */
function mul16(hl: number, de: number): number {
  return (hl * de) & 0xffff;
}

/** 00:245F — hl = a * 8. */
function times8(a: number): number {
  return ((a & 0xff) << 3) & 0xffff;
}

// ---------------------------------------------------------------- the monster record (D680)

/** 0B:451C — D690-D6FF filled with FF (00:3934, 0x70 bytes). */
export function clearEnemyRecord(m: Memory): void {
  fill(m, 0xd690, 0x70, 0xff);
}

/** 0B:45AB — the word at de - 1 (low) / de (high): monsters BB and above (D68E) have it shifted
 *  left 4 and rewritten; then it is copied to de + 1 / de + 2. Returns de + 2. */
export function enemyStatWord(m: Memory, de: number): number {
  de = (de - 1) & 0xffff;
  let l = m.rd(de);
  de = (de + 1) & 0xffff;
  let h = m.rd(de);
  if (m.rd(0xd68e) >= 0xbb) {
    const hl = (((h << 8) | l) << 4) & 0xffff;
    l = hl & 0xff;
    h = hl >> 8;
    de = (de - 1) & 0xffff;
    m.wr(de, l);
    de = (de + 1) & 0xffff;
    m.wr(de, h);
  }
  de = (de + 1) & 0xffff;
  m.wr(de, l);
  de = (de + 1) & 0xffff;
  m.wr(de, h);
  return de;
}

/** 0B:453A — the 12-byte record of monster CC70 (0B:4A19 + 12 CC70): D68E = CC70, D68D = byte 0
 *  & 7; D690 = byte 1, CC73 = byte 2 and D691 = its low nibble (0B:45AB: D692/D693); D694 = byte
 *  3, CC74 = byte 4 and D695 = its low nibble (0B:45AB: D696/D697); bytes 5-8 to D698 and D6F0;
 *  bytes 9-11 to D6BD; then 4 bytes of 0B:469D for the high nibble of CC73 to D6D9 and 3 bytes of
 *  0B:46DD for the high nibble of CC74 to D6DD. */
export function enemyBaseRecord(g: Game): void {
  const m = g.m;
  const a = m.rd(0xcc70);
  m.wr(0xd68e, a);
  let hl = (RECORD_TABLE + mul16(0x0c, a)) & 0xffff;
  m.wr(0xd68d, m.rd(hl) & 0x07);
  hl = (hl + 1) & 0xffff;
  let de = 0xd690;
  m.wr(de, m.rd(hl));
  hl = (hl + 1) & 0xffff;
  de = (de + 1) & 0xffff;
  let x = m.rd(hl);
  hl = (hl + 1) & 0xffff;
  m.wr(0xcc73, x);
  m.wr(de, x & 0x0f);
  enemyStatWord(m, de);
  de = 0xd694;
  m.wr(de, m.rd(hl));
  hl = (hl + 1) & 0xffff;
  de = (de + 1) & 0xffff;
  x = m.rd(hl);
  hl = (hl + 1) & 0xffff;
  m.wr(0xcc74, x);
  m.wr(de, x & 0x0f);
  enemyStatWord(m, de);
  const src = hl;
  far0Sync(g, 0, () => copy(m, src, 0xd698, 4));
  [hl] = far0Sync(g, 0, () => copy(m, src, 0xd6f0, 4));
  copy(m, hl, 0xd6bd, 3);
  hl = (NIBBLE4_TABLE + ((m.rd(0xcc73) & 0xf0) >> 2)) & 0xffff;
  far0Sync(g, 0, () => copy(m, hl, 0xd6d9, 4));
  const n = (m.rd(0xcc74) >> 4) & 0x0f;
  hl = (NIBBLE3_TABLE + ((n * 3) & 0xff)) & 0xffff;
  copy(m, hl, 0xd6dd, 3);
}

/** 0B:4526 — monster CC70 in full: D690.. cleared (0B:451C), its 8-byte header 0E:7533 + 8 CC70
 *  to D685-D68C (two 4-byte far copies with bank 0E), then its record (0B:453A). */
export function enemyFullRecord(g: Game): void {
  const m = g.m;
  clearEnemyRecord(m);
  let hl = (HEADER_TABLE + times8(m.rd(0xcc70))) & 0xffff;
  let de = 0xd685;
  [hl, de] = far0Sync(g, 0x0e, () => copy(m, hl, de, 4));
  [hl, de] = far0Sync(g, 0x0e, () => copy(m, hl, de, 4));
  enemyBaseRecord(g);
}

/** 0B:45CB — the rest of monster CC70 in D680: D680 = 0F, D681-D682 = 0, D6D1-D6D6 and
 *  D6EA-D6EF cleared; its list 0B:533D + 9 CC70 (a mask byte, then 8 ids, FF ends: MSB first,
 *  bit set -> the id copied to D6C8.. in turn; bit clear -> ids 30 and above to D6C0, below 30
 *  learned as spell CE94 of entity CD36 = 0D (0B:6E74)); then with CD36 = 0D the resistances
 *  (0B:7349) and attributes (0B:728B); from 0B:470D + 4 CC70: D683 = byte 0 & 3F, D68F = D6E8 =
 *  byte 0 >> 6, D6D7 = (D69A + D683) / 2 + 4B (8-bit), bytes 1-3 to D6E5. */
export function enemyEquipAndStats(g: Game): void {
  const m = g.m;
  m.wr(0xd680, 0x0f);
  m.wr(0xd681, 0);
  m.wr(0xd682, 0);
  fill(m, 0xd6d1, 6, 0);
  fill(m, 0xd6ea, 6, 0);
  let hl = (LIST_TABLE + mul16(0x09, m.rd(0xcc70))) & 0xffff;
  let de = 0xd6c8;
  let b = m.rd(hl);
  hl = (hl + 1) & 0xffff;
  for (let c = 8; c > 0; c--) {
    const a = m.rd(hl);
    if (a === 0xff) {
      // cp $ff with a = FF: carry clear, rl b shifts in 0; hl stays.
      b = (b << 1) & 0xff;
      continue;
    }
    // cp $ff with a < FF: carry set, rl b shifts in 1.
    const out = b & 0x80;
    b = ((b << 1) | 1) & 0xff;
    if (out) {
      [hl, de] = copy(m, hl, de, 1);
      continue;
    }
    hl = (hl + 1) & 0xffff;
    if (a >= 0x30) {
      m.wr(0xd6c0, a);
    } else {
      m.wr(0xce94, a);
      m.wr(0xcd36, 0x0d);
      spellBit(g);
    }
  }
  m.wr(0xcd36, 0x0d);
  entityResist(g);
  entityStats(g);
  hl = (EXTRA_TABLE + mul16(0x04, m.rd(0xcc70))) & 0xffff;
  const x = m.rd(hl);
  hl = (hl + 1) & 0xffff;
  const c = x & 0x3f;
  m.wr(0xd683, c);
  const t = (x >> 6) & 0x03;
  m.wr(0xd68f, t);
  m.wr(0xd6e8, t);
  m.wr(0xd6d7, ((((m.rd(0xd69a) + c) & 0xff) >> 1) + 0x4b) & 0xff);
  copy(m, hl, 0xd6e5, 3);
}

/** 0B:466B — every id 6A in the list D6C8-D6CF removed: the bytes after it moved down one
 *  (00:1F97, b = slots left - 1; 0 copies 256 bytes) and FF stored after them. */
export function dropItem6A(g: Game): void {
  const m = g.m;
  let hl = 0xd6c8;
  for (let b = 8; b > 0; b--) {
    const de = hl;
    const a = m.rd(hl);
    hl = (hl + 1) & 0xffff;
    if (a !== 0x6a) continue;
    const src = hl;
    const [, d2] = far0Sync(g, 0, () => copyB(m, src, de, (b - 1) & 0xff));
    m.wr(d2, 0xff);
  }
}

/** 0B:468B — D680-D6FF copied a times (0 = 256) to de, de, + 0x80, ...; CC71/CC72 = the next de. */
export function copyEnemyEntities(g: Game, de: number, a: number): void {
  const m = g.m;
  let c = a & 0xff;
  do {
    [, de] = far0Sync(g, 0, () => copyB(m, 0xd680, de, 0x80));
    c = (c - 1) & 0xff;
  } while (c);
  m.wr(0xcc71, de & 0xff);
  m.wr(0xcc72, de >> 8);
}

/** 0B:4685 — 0B:468B at the address CC71/CC72. */
export function copyEnemyEntitiesNext(g: Game, a: number): void {
  copyEnemyEntities(g, g.m.rd16(0xcc71), a);
}

// ---------------------------------------------------------------- ability flags (fields 6A..)

/** 0B:70DE — the ability flag of spell bit CD20 (0B:7543 + CD20 = t): returns [address of field
 *  6A + (t >> 3) of entity CD36 (00:1FC4), the bit 1 << (7 - (t & 7)) (00:1EF1), t >> 3]. */
export function abilityFlagOf(g: Game): [number, number, number] {
  const m = g.m;
  const t = m.rd((FLAG_TABLE + m.rd(0xcd20)) & 0xffff);
  const e = t >> 3;
  const hl = (entityOffset(m) + 0xc56a + e) & 0xffff;
  const a = 1 << ((~(t & 0x07) + 8) & 0xff);
  return [hl, a & 0xff, e];
}

/** 0B:70D1 — set the ability flag of spell bit CD20 (0B:70DE); a flag in field 6A itself then
 *  has field 6A cut to its low 5 bits. */
export function setAbilityFlag(g: Game): void {
  const m = g.m;
  const [hl, a, e] = abilityFlagOf(g);
  m.wr(hl, a | m.rd(hl));
  if (e) return;
  m.wr(hl, m.rd(hl) & 0x1f);
}

/** 0B:70B9 — the 8 bits of [hl] from bit 0 (each `rrc [hl]` rewrites it, 8 rotations leave it
 *  as it was): every set bit c sets its ability flag (CD20 = c, 0B:70D1). Returns c + 8. */
export function abilityFlagsByte(g: Game, hl: number, c: number): number {
  const m = g.m;
  for (let e = 8; e > 0; e--) {
    const v = m.rd(hl);
    const carry = v & 1;
    m.wr(hl, (v >> 1) | (carry << 7));
    if (carry) {
      m.wr(0xcd20, c);
      setAbilityFlag(g);
    }
    c = (c + 1) & 0xff;
  }
  return c;
}

/** 0B:70B4 — the big-endian spell word at hl: low byte hl + 1, then high byte hl (0B:70B9).
 *  Returns c. */
export function abilityFlagsWord(g: Game, hl: number, c: number): number {
  c = abilityFlagsByte(g, (hl + 1) & 0xffff, c);
  return abilityFlagsByte(g, hl, c);
}

/** 0B:70A4 — the ability flags of the entity at record offset hl from its 3 spell words
 *  (fields 51-56, bits 0-47, 0B:70B4). */
export function abilityFlagsEntity(g: Game, hl: number): void {
  hl = (hl + 0xc551) & 0xffff;
  let c = abilityFlagsWord(g, hl, 0);
  hl = (hl + 2) & 0xffff;
  c = abilityFlagsWord(g, hl, c);
  hl = (hl + 2) & 0xffff;
  abilityFlagsWord(g, hl, c);
}

/** 0B:708B — the ability flags of entities 0-0C (CD36 = each in turn, record offsets from
 *  00:1FCD of member 0, + 0x80 each; 0B:70A4). */
export function abilityFlagsAll(g: Game): void {
  const m = g.m;
  let hl = memberOffset(m, 0);
  let a = 0;
  for (;;) {
    m.wr(0xcd36, a);
    abilityFlagsEntity(g, hl);
    a = m.rd(0xcd36);
    if (a === 0x0c) return;
    hl = (hl + 0x80) & 0xffff;
    a = (a + 1) & 0xff;
  }
}

// ---------------------------------------------------------------- entry routines

/** 0B:4444 — the battle entities: D000-D67F filled with FF; the 5 party records C500 + 0x60 k
 *  whose field 03 is not FF copied to D000 + 0x80 k (0x60 bytes, 00:1F97); fields 18-1B of those
 *  whose field 18 is not FF copied to fields 70-73; fields 6A-6F of the 5 cleared; then each
 *  monster group (CC70 = CC59 / CC5A / CC5B, counts CC36 / CC37 / CC38; groups 2 and 3 only when
 *  their count is not 0) built in D680 (0B:4526, 0B:45CB) and copied out from D280 on (0B:468B /
 *  0B:4685); last the ability flags of all entities (0B:708B). */
export function battleEntities(g: Game): void {
  const m = g.m;
  fill(m, 0xd000, 0x0680, 0xff);
  let hl = 0xc500;
  let de = 0xd000;
  for (let c = 5; c > 0; c--) {
    if (m.rd((hl + 3) & 0xffff) === 0xff) {
      hl = (hl + 0x60) & 0xffff;
      de = (de + 0x80) & 0xffff;
    } else {
      const s = hl, d = de;
      [hl, de] = far0Sync(g, 0, () => copyB(m, s, d, 0x60));
      de = (de + 0x20) & 0xffff;
    }
  }
  hl = 0xc518;
  de = 0xd070;
  for (let c = 5; c > 0; c--) {
    if (m.rd(hl) !== 0xff) {
      const s = hl, d = de;
      far0Sync(g, 0, () => copy(m, s, d, 4));
    }
    hl = (hl + 0x60) & 0xffff;
    de = (de + 0x80) & 0xffff;
  }
  hl = 0xd06a;
  for (let c = 5; c > 0; c--) {
    hl = fill(m, hl, 6, 0);
    hl = (hl + 0x7a) & 0xffff;
  }
  m.wr(0xcc70, m.rd(0xcc59));
  enemyFullRecord(g);
  enemyEquipAndStats(g);
  copyEnemyEntities(g, 0xd280, m.rd(0xcc36));
  if (m.rd(0xcc37)) {
    m.wr(0xcc70, m.rd(0xcc5a));
    enemyFullRecord(g);
    enemyEquipAndStats(g);
    copyEnemyEntitiesNext(g, m.rd(0xcc37));
  }
  if (m.rd(0xcc38)) {
    m.wr(0xcc70, m.rd(0xcc5b));
    enemyFullRecord(g);
    enemyEquipAndStats(g);
    copyEnemyEntitiesNext(g, m.rd(0xcc38));
  }
  abilityFlagsAll(g);
}

/** 0B:44F0 — monster C91B built in D680 without its 0E:7533 header: CC70 = C91B, D690.. cleared
 *  (0B:451C), its record (0B:453A) and list/stats (0B:45CB), then id 6A dropped from its list
 *  (0B:466B). */
export function enemyRecordC91B(g: Game): void {
  const m = g.m;
  m.wr(0xcc70, m.rd(0xc91b));
  clearEnemyRecord(m);
  enemyBaseRecord(g);
  enemyEquipAndStats(g);
  dropItem6A(g);
}
