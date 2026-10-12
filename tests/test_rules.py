"""Decoded calc-VM rules (src/ffl2kster/rules.py) against measurements and controlled changes."""
import json

from ffl2kster import calcvm, rules
from conftest import ROOT


def test_meat_formula_matches_every_measured_transformation(rom_bytes):
    """Script 9 reimplemented must reproduce all 32,940 emulator-measured results
    (data/meat_transformations.json, tools/meat_full.py)."""
    d = json.loads((ROOT / "data" / "meat_transformations.json").read_text())["eaters"]
    n = 0
    for eater, row in d.items():
        for meat, result in enumerate(row):
            if result is None:
                continue
            assert rules.meat_result(rom_bytes, int(eater), meat) == result, (eater, meat)
            n += 1
    assert n == 32940


def test_reward_decoding_matches_observed_battles(rom_bytes):
    # Asigaru (180) x1: "Received 33 GP." and "Received Long." observed in PyBoy;
    # controlled change of 0C:7C50+180 0x21 -> 0x22 gave "Received 66 GP." (tools/drop_probe.py).
    r = rules.reward(rom_bytes, 180)
    assert (r.meat, r.chance_base, r.gp_base) == (False, 20, 30)
    assert rules.gp_for_group(rom_bytes, 180, 1) == 33
    t = bytearray(rom_bytes); t[rules.BANK0C + rules.REWARD + 180] = 0x22
    assert rules.gp_for_group(bytes(t), 180, 1) == 66
    assert rules.reward(rom_bytes, 120).meat  # Jaguar: monster, drops meat
    assert rules.gp_total(rom_bytes, [(180, 1)], 999990) == 999999


def test_rng_and_tables(rom_bytes):
    assert rules.rand_range(rom_bytes, 1, 0, 0) == 0
    for c in range(256):
        assert 0 <= rules.rand_range(rom_bytes, c, 0, 100) <= 100
    t = rules.export_tables(rom_bytes)
    assert t["max_gp"] == 999999 and len(t["monsters"]) == 256
    assert t["gp_table"][:16] == [30 * i for i in range(16)]
    assert all(row[-1][0] < 256 for row in t["meat_result"])
    assert rules.hp_up_amount(59, 9) == 15  # AAAA (59 HP) "Max HP gained by 15"


def test_calcvm_listing_complete(rom_bytes):
    txt = calcvm.listing(rom_bytes)
    assert "??" not in txt
    for i in range(calcvm.NSCRIPTS):
        assert f"script_{i}:" in txt
    for i in range(50):
        assert f"effect_{i}:" in txt  # every battle effect handler decodes
    assert "(D90C).1 = #11" in txt and "(D906).2 = CF13" in txt  # item drop message


def test_weapon_formula_and_effect_index(rom_bytes):
    assert rules.weapon_damage(6, 10, 5, 0) == 35 and rules.weapon_damage(1, 1, 50, 1) == 0
    assert rules.hit_chance(5, 5) == 97 and rules.hit_chance(5, 10) == 87
    eff = rules.effect_index(rom_bytes)
    assert len(eff) == 50 and eff["49"]["battle_handler"] == "0C:5512"
    assert any(i.endswith(":Long") for i in eff["49"]["items"])


def test_rng_matches_rom_routine(rom_bytes):
    """rules.rand_range equals 00:043E executed in the SM83 oracle for many (stream, lo, hi)."""
    import random
    from ffl2kster.sm83 import CPU
    rnd = random.Random(3)
    for _ in range(300):
        stream, lo, hi, ctr = rnd.randrange(16), rnd.choice([0, 0, 1, 5, 0xFF, rnd.randrange(256)]), \
            rnd.choice([0, 1, 100, 255, rnd.randrange(256)]), rnd.randrange(256)
        cpu = CPU(rom_bytes)
        cpu.mem[0xC0A0 + stream] = ctr
        cpu.a, cpu.d, cpu.e = stream, hi, lo
        cpu.call(0x016B)
        assert cpu.a == rules.rand_range(rom_bytes, (ctr + 1) & 0xFF, lo, hi), (stream, lo, hi, ctr)
        assert cpu.mem[0xC0A0 + stream] == (ctr + 1) & 0xFF


def test_growth_penalties_match_probes():
    """Values read from the original at script 10's rand calls (tools/mutant_growth.py setup with a
    pair patched to (0, 200), level-1 enemy): one-byte stores and the low byte of max HP."""
    assert rules.hp_penalty(999, 200) == 72          # CF0E 17, CF97 72
    assert rules._chance(0, 200, 1, rules.hp_penalty(999, 200)) == 128   # CF96 128
    assert rules.hp_penalty(100, 200) == 200         # CF0E 1, CF97 200
    assert rules._chance(0, 200, 1, rules.hp_penalty(100, 200)) == 0
    assert rules.stat_penalty(1, 200) == 40          # CF93 40
    assert rules._chance(0, 200, 1, rules.stat_penalty(1, 200)) == 160   # CF96 160


def test_mutant_stat_pairs_are_offset_by_ten(rom_bytes):
    """Verified by controlled change (tools/mutant_growth.py): a mutant's STR/AGL/MANA/DEF read
    0C:7F9E/7FA0/7FA2/7FA4 (7F94 + 10·race + 2·stat), a human's 7F94/96/98/9A."""
    rom = rom_bytes
    g = rules.growth_params(rom, 1)
    off = lambda a: 0x0C * 0x4000 + a - 0x4000
    assert g["stats"] == [(rom[off(a)], rom[off(a) + 1]) for a in (0x7F9E, 0x7FA0, 0x7FA2, 0x7FA4)]
    assert g["stats"][0] == (0, 0)                   # mutant STR: the zero bytes after the human record
    assert g["stats"][1] == g["ability"] and g["stats"][2] == g["hp"]
    h = rules.growth_params(rom, 0)
    assert h["stats"] == [(rom[off(a)], rom[off(a) + 1]) for a in (0x7F94, 0x7F96, 0x7F98, 0x7F9A)]
