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
    assert rules.rand_range(rom_bytes, 1, 0, 0) == rules.rng_byte(rom_bytes, 1)  # max 0 -> raw byte
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
