"""Game rules decoded from the bank-0C calc VM (see calcvm.py, docs/BATTLE_RULES.md).

Reference implementations for the port. Each function cites the VM script / ROM table it
mirrors. Status per rule is recorded in docs/BATTLE_RULES.md (verified / probable).
All VM arithmetic is evaluated strictly left to right; division is integer (floor for the
non-negative values used here); "-sat" is subtraction clamped at 0.
"""
from __future__ import annotations

from dataclasses import dataclass

BANK0C = 0x30000 - 0x4000      # file offset of 0C:xxxx is BANK0C + xxxx
RNG_TABLE = 0x3C000            # 0F:4000, 256 bytes; counters per stream at C0A0 + stream
FAMILY = 0x7800                # 0C:7800 + id: hi nibble family, lo nibble meat class
MEAT_RESULT = 0x7900           # 0C:7900 [12][3][16] result monster ids
STAT_FLAGS = 0x7B40            # 0C:7B40 + action id: bit7 STR, 6 AGL, 5 MANA, 4 DEF
REWARD = 0x7C50                # 0C:7C50 + id: bit7 meat, bit6 +80%, bit5 +20%, bits0-4 GP index
LEVEL_AI = 0x7D50              # 0C:7D50 + id: hi nibble AI type, lo nibble level
GP_TABLE = 0x7E50              # 0C:7E50 + 2*index (word)
DEFAULT_USES = 0x7E80          # 0C:7E80 + item id
AI_THRESHOLDS = 0x6F00         # 0C:6F00 + 8*ai_type + slot (cumulative, compared with rand 0-255)
GROWTH = 0x7F90                # 0C:7F90 + 16*race: [ability b0 b1][HP b0 b1]; stats see below
MUTANT_THRESH = 0x7FB0         # 33 cumulative thresholds
MUTANT_ABILITY = 0x7FD0        # 33 ability ids
MAX_GP = 0x7FF0                # 3 bytes = 999999
STATS = ("STR", "AGL", "MANA", "DEF")   # character bytes C20B..C20E, messages 19..22


def b(rom: bytes, addr: int) -> int:
    return rom[BANK0C + addr]


def w(rom: bytes, addr: int) -> int:
    return b(rom, addr) | b(rom, addr + 1) << 8


# ---------------------------------------------------------------- RNG (00:043E)

def rng_byte(rom: bytes, counter: int) -> int:
    """Value for an already-incremented stream counter (the game does counter += 1 first)."""
    return rom[RNG_TABLE + (counter & 0xFF)]


def rand_range(rom: bytes, counter: int, lo: int, hi: int) -> int:
    """00:043E with E=lo, D=hi (counter = the already-incremented stream counter):
    lo == 0xFF → 0xFF; hi == 0 → 0; hi == lo → lo; span 0xFF → T + lo;
    otherwise lo + T % (hi - lo + 1). (Corrected 2026-10-12 against the SM83 oracle.)"""
    t = rng_byte(rom, counter)
    if lo == 0xFF:
        return 0xFF
    if hi == 0:
        return 0
    if hi == lo:
        return lo
    span = (hi - lo) & 0xFF
    if span == 0xFF:
        return (t + lo) & 0xFF
    return (lo + t % (span + 1)) & 0xFF


# ---------------------------------------------------------------- monsters

def level(rom: bytes, mid: int) -> int:
    return b(rom, LEVEL_AI + mid) & 0x0F


def ai_type(rom: bytes, mid: int) -> int:
    return b(rom, LEVEL_AI + mid) >> 4


def family(rom: bytes, mid: int) -> tuple[int, int]:
    v = b(rom, FAMILY + mid)
    return v >> 4, v & 0x0F


def meat_result(rom: bytes, eater: int, meat: int) -> int:
    """Script 9 (0C:4E5A). Returns the new monster id (== eater means "Nothing happened")."""
    f1, c1 = family(rom, eater)
    f2, c2 = family(rom, meat)
    if f2 > 5:
        f2 += 1
    k = f1 + f2
    if k < 6:
        k += 12
    if k > 17:
        k -= 12
    k -= 6
    cls = min(max(c1 + c2 - 1, 0), 2)
    lv = max(level(rom, eater), level(rom, meat))
    return b(rom, MEAT_RESULT + (k * 3 + cls) * 16 + lv)


# ---------------------------------------------------------------- rewards (script 8)

@dataclass
class Reward:
    meat: bool          # bit 7: drops meat instead of an item
    chance_base: int    # 80*bit6 + 20*bit5 (percent-ish; + number defeated)
    gp_index: int
    gp_base: int


def reward(rom: bytes, mid: int) -> Reward:
    v = b(rom, REWARD + mid)
    gi = v & 0x1F
    return Reward(bool(v & 0x80), ((v >> 6) & 1) * 80 + ((v >> 5) & 1) * 20, gi, w(rom, GP_TABLE + 2 * gi))


def gp_for_group(rom: bytes, mid: int, count: int) -> int:
    """GP from one defeated group: ((gp/10)*n + gp)*n (left-to-right VM expression)."""
    g = reward(rom, mid).gp_base
    return (g // 10 * count + g) * count


def gp_total(rom: bytes, groups: list[tuple[int, int]], current: int = 0) -> int:
    """New party GP after a battle (sum over groups 5..7, capped at 0C:7FF0 = 999999)."""
    cap = b(rom, MAX_GP) | b(rom, MAX_GP + 1) << 8 | b(rom, MAX_GP + 2) << 16
    return min(current + sum(gp_for_group(rom, m, n) for m, n in groups), cap)


def drop_threshold(rom: bytes, mid: int, count: int) -> int:
    """A group drops when rand(0..100) <= threshold. Groups are tried in order (5, 6, 7); the
    first success ends the check, so at most one drop (item or meat) per battle. An item drop
    picks enemy ability slot rand(0..last slot); ids > 127 (non-items) give nothing; the item
    goes to the first free inventory slot (C2B9, 16 x [id, uses]) with default uses."""
    return reward(rom, mid).chance_base + count


# ---------------------------------------------------------------- growth (script 10)

def growth_params(rom: bytes, race: int) -> dict:
    """Pairs (b0, b1) read by script 10 for a human (race 0) or mutant (race 1).

    The stat pair address is CF89 * 5 + CF61 * 2 + 7F94 evaluated left to right by the calc VM,
    i.e. 7F94 + 10 * race + 2 * stat (verified by controlled change, tools/mutant_growth.py): for a
    mutant, STR reads the two zero bytes after the human record (7F9E), AGL the mutant ability
    pair (7FA0), MANA the mutant HP pair (7FA2) and DEF 7FA4."""
    base = GROWTH + 16 * race
    return {"ability": (b(rom, base), b(rom, base + 1)), "hp": (b(rom, base + 2), b(rom, base + 3)),
            "stats": [(b(rom, GROWTH + 4 + (race * 5 + s) * 2), b(rom, GROWTH + 5 + (race * 5 + s) * 2))
                      for s in range(4)]}


def _chance(base: int, factor: int, battle_level: int, penalty: int) -> int:
    """CF96 = CF1C * b1 -sat penalty + b0, stored in one byte."""
    return (max(battle_level * factor - penalty, 0) + base) & 0xFF


def hp_penalty(max_hp: int, b1: int) -> int:
    """Script 10 (0C:4FBE-4FCC, L5218): CFB3 = CF0C / 26 + 50 reads max HP as one byte (its low
    byte); CF0E = max HP / CFB3 (16-bit); CF97 = CF0E * b1 stored in one byte (verified with a
    probe of CF0E/CF97/CF96 at the rand call: max HP 999, b1 200 -> CF0E 17, CF97 72)."""
    cfb3 = ((max_hp & 0xFF) // 26 + 50) & 0xFF
    return (max_hp // cfb3 * b1) & 0xFF


def stat_penalty(value: int, b1: int) -> int:
    """0C:51C3: CFB3 = stat / 20 + 5; CF93 = stat * b1 / CFB3 (left to right), one byte."""
    return (value * b1 // (value // 20 + 5)) & 0xFF


def hp_up_chance(rom: bytes, race: int, max_hp: int, battle_level: int) -> int:
    """HP grows when rand(0..200) <= chance. battle_level = level of the first enemy group."""
    b0, b1 = growth_params(rom, race)["hp"]
    return _chance(b0, b1, battle_level, hp_penalty(max_hp, b1))


def mutant_ability_chance(rom: bytes, race: int, max_hp: int, battle_level: int) -> int:
    """Checked first; new ability when rand(0..200) < chance (0 for humans)."""
    b0, b1 = growth_params(rom, race)["ability"]
    return _chance(b0, b1, battle_level, hp_penalty(max_hp, b1))


def hp_up_amount(max_hp: int, r: int) -> int:
    """r = rand(0..10). No growth at max HP >= 999."""
    return max_hp // 50 + r + 5


def stat_up_chance(rom: bytes, race: int, stat: int, value: int, battle_level: int) -> int:
    """Stat `stat` (index into STATS, chosen by the first set flag of the last action's
    0C:7B40 byte) grows by 1 when rand(0..200) <= chance; never at 99."""
    b0, b1 = growth_params(rom, race)["stats"][stat]
    return _chance(b0, b1, battle_level, stat_penalty(value, b1))


def stat_flags(rom: bytes, action: int) -> list[str]:
    v = b(rom, STAT_FLAGS + action)
    return [s for i, s in enumerate(STATS) if v & (0x80 >> i)]


def mutant_ability_table(rom: bytes) -> list[tuple[int, int]]:
    """(threshold, ability id): pick first entry with rand(0..min(level*24+15, 255)) <= threshold."""
    return [(b(rom, MUTANT_THRESH + i), b(rom, MUTANT_ABILITY + i)) for i in range(32)]


# ---------------------------------------------------------------- battle flow

def initiative_range(agl: int, party: bool) -> tuple[int, int]:
    """Script 3: each combatant rolls rand(v..2v) with v = AGL (party: AGL/4 + AGL);
    actors act in descending order."""
    v = agl // 4 + agl if party else agl
    return v, 2 * v


def escape_succeeds(party_agl_or_100: list[int], enemy_agl: list[int], r: int,
                    no_escape: bool = False, struck_first: bool = False) -> bool:
    """Script 1: fail if the formation forbids running (D844 bit 5); succeed after a first
    strike; else party score (alive: AGL, empty/dead party slot: 100) must exceed enemy AGL
    sum + rand(0..50)."""
    if no_escape:
        return False
    if struck_first:
        return True
    return sum(party_agl_or_100) > sum(enemy_agl) + r


def export_tables(rom: bytes) -> dict:
    mons = []
    for m in range(256):
        f, c = family(rom, m)
        rw = reward(rom, m)
        mons.append({"id": m, "family": f, "meat_class": c, "level": level(rom, m),
                     "ai_type": ai_type(rom, m), "drops_meat": rw.meat,
                     "drop_chance_base": rw.chance_base, "gp_index": rw.gp_index, "gp_base": rw.gp_base})
    return {
        "monsters": mons,
        "gp_table": [w(rom, GP_TABLE + 2 * i) for i in range(32)],
        "ai_thresholds": [[b(rom, AI_THRESHOLDS + 8 * t + s) for s in range(8)] for t in range(16)],
        "meat_result": [[[b(rom, MEAT_RESULT + (k * 3 + c) * 16 + lv) for lv in range(16)]
                         for c in range(3)] for k in range(12)],
        "stat_growth_by_action": {str(a): stat_flags(rom, a) for a in range(0x110) if stat_flags(rom, a)},
        "growth": {str(r): growth_params(rom, r) for r in range(2)},
        "mutant_abilities": mutant_ability_table(rom),
        "max_gp": b(rom, MAX_GP) | b(rom, MAX_GP + 1) << 8 | b(rom, MAX_GP + 2) << 16,
        "effects": effect_index(rom),
        # RNG table (0F:4000) deliberately not exported: raw ROM bytes; read it with rng_byte().
    }


def effect_index(rom: bytes) -> dict:
    """Item/ability effect id (item byte 3) → calc-VM handler address and the items using it."""
    from . import calcvm
    from .schema import items
    battle = calcvm.table(rom, *calcvm.BATTLE_EFFECTS)
    field = calcvm.table(rom, *calcvm.FIELD_EFFECTS)
    users: dict[int, list[str]] = {}
    for i in range(256):
        users.setdefault(rom[0x32F80 + 8 * i + 3], []).append(f"{i}:{items.name(rom, i)}")
    return {str(e): {"battle_handler": f"0C:{battle[e]:04X}",
                     "field_handler": f"0C:{field[e]:04X}" if e < len(field) else None,
                     "items": users.get(e, [])} for e in range(len(battle))}


# ---------------------------------------------------------------- weapon attack (effect 49)

def weapon_damage(strength: int, power: int, target_def: int, r: int, halved: bool = False) -> int:
    """Effect 49 (0C:5512 → L6A32/L6E8C): max(STR·power + r − 5·DEF, 0), r = rand(0..STR);
    halved when the target guards (status/defence flags). Agrees with the milestone-2
    measurements (power and DEF terms exact, random term grows with STR)."""
    d = max(strength * power + r - 5 * target_def, 0)
    return d // 2 if halved else d


def hit_chance(attacker_agl: int, target_agl: int) -> int:
    """L6AB5/L6B1F: the attack lands when rand(0..100) <= 97 - max(target AGL - attacker AGL, 0)·2."""
    return max(97 - max(target_agl - attacker_agl, 0) * 2, 0)
