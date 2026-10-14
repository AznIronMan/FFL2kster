/** Legend III odds and ends (4): battle script natives that the scripts of bank 0C reach through
 *  their computed jumps (the action table 0C:7CEA by C9BC, the scene table 0C:7E53 by C9DA and
 *  the step table 0C:5A92 by C919 & 7):
 *   - 0C:499B, action 20 (0C:721F): a monster of group D87A copied into the first slot of that
 *     group that has left it (the group's bits D894 + D87A against CC5E + D87A);
 *   - 0C:6B4F (farcall 0B:44A8), scene state 1 of monster C1 / C2 (0C:7EDC): the monster groups
 *     CC59-CC5B rebuilt in D280.. (the second half of 0B:4444) and the ability flags (0B:708B);
 *   - 0C:6B55 (farcall 0B:7E96), the status scene's steps 0 / 1 (0C:5ABE / 5ACA): D888 from the
 *     table C97B (the mirror of 0C:6B52 / 0B:7E89);
 *   - 0C:7E35, action 21 (0C:72E3): C985-C987 = 999999 (0F 42 3F, 0C:7E3E, 00:1F8D).
 *  Each is registered in `nativeRoutines` by its address. */
import type { Game } from "./game.js";
import { NotPorted } from "./irq.js";
import { nativeRoutines } from "./bscript.js";
import { copy, copyB, farSync } from "./sys.js";
import { enemyFullRecord, enemyEquipAndStats, copyEnemyEntities, copyEnemyEntitiesNext,
  abilityFlagsAll } from "./benemy.js";

/** 0C:499B — the free slot of group D87A taken by entity C9D6: c = [D894 + D87A] ^ [CC5E + D87A]
 *  (the group's slots that have left it); its first set bit from the top (a = 7 .. 0) set in
 *  CC5E + D87A; C985 = a + 5 (the slot); the 0x80-byte record D000 + 0x80 C9D6 copied to
 *  D000 + 0x80 C985 (00:1F97). Bank 0C selected. */
export function groupSlotFill(g: Game): void {
  const m = g.m;
  const k = m.rd(0xd87a);
  let c = m.rd((0xd894 + k) & 0xffff);
  const hl = (0xcc5e + k) & 0xffff;
  c = (m.rd(hl) ^ c) & 0xff;
  // 49AA: b = 1, a = 8; rrc b / rlc c / dec a until the carry out of c
  if (!c) throw new NotPorted("0C:49AE (no slot left the group: the original loops forever)");
  let b = 0x01, a = 0x08;
  for (;;) {
    b = ((b >> 1) | (b << 7)) & 0xff;
    const carry = c >> 7;
    c = ((c << 1) | carry) & 0xff;
    a = (a - 1) & 0xff;
    if (carry) break;
  }
  c = a;
  m.wr(hl, m.rd(hl) | b);
  // 49B9: de = D000 + 0x80 (c + 5)
  let s = (c + 0x05) & 0xff;
  m.wr(0xc985, s);
  const de = (0xd000 + (((s & 1) << 7) | ((s >> 1) << 8))) & 0xffff;
  // 49C9: hl = D000 + 0x80 C9D6
  s = m.rd(0xc9d6);
  const src = (0xd000 + (((s & 1) << 7) | ((s >> 1) << 8))) & 0xffff;
  copyB(m, src, de, 0x80);
}

/** 0B:44A8 — the monster groups rebuilt (the end of 0B:4444): CC70 = CC59, its record in D680
 *  (0B:4526, 0B:45CB) copied CC36 times from D280 (0B:468B); groups 2 (CC5A, CC37) and 3 (CC5B,
 *  CC38) after it when their count is not 0 (0B:4685); then the ability flags of all entities
 *  (jp 0B:708B). Bank 0B selected. */
function groupsRebuild(g: Game): void {
  const m = g.m;
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

/** 0B:7E96 — D888 = [the word C97B + (C995 >> 1) + ((C96E - 1) & FE)] (8-bit offset, 0B:7EA9 /
 *  0B:7EA2). Bank 0B selected. */
function tableByteHalf(g: Game): void {
  const m = g.m;
  const hl = m.rd16(0xc97b);
  const c = (m.rd(0xc995) >> 1) & 0xff;
  let a = (m.rd(0xc96e) - 1) & 0xfe;
  a = (a + c) & 0xff;
  m.wr(0xd888, m.rd((hl + a) & 0xffff));
}

/** 0C:6B4F — the monster groups rebuilt (farcall 0B:44A8). */
export function groupsRebuildNative(g: Game): void {
  farSync(g, 0x0b, () => groupsRebuild(g));
}

/** 0C:6B55 — D888 from the table C97B, half step (farcall 0B:7E96). */
export function tableByteHalfNative(g: Game): void {
  farSync(g, 0x0b, () => tableByteHalf(g));
}

/** 0C:7E35 — C985-C987 = 0F 42 3F (999999) from 0C:7E3E (00:1F8D). Bank 0C selected. */
export function cap999999(g: Game): void {
  copy(g.m, 0x7e3e, 0xc985, 3);
}

nativeRoutines.set(0x499b, function* (g) { groupSlotFill(g); });
nativeRoutines.set(0x6b4f, function* (g) { groupsRebuildNative(g); });
nativeRoutines.set(0x6b55, function* (g) { tableByteHalfNative(g); });
nativeRoutines.set(0x7e35, function* (g) { cap999999(g); });
