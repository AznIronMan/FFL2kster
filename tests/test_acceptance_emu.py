"""Milestone-1 acceptance test: original vs patched ROM in PyBoy.

Fully automated: both ROMs are cold-booted through the recorded input chain to the
same battle (proves both boot and reach the test point); then both are run from the SAME
save state (generated from the original ROM) one step into the 3x Jaguar battle; the enemy
block in WRAM must differ exactly in the patched HP, and a fixed input sequence must show
a different battle outcome. Artifacts: build/test-artifacts/.
"""

import datetime as dt
import json
import shutil

import pytest

pytest.importorskip("pyboy")

from ffl2kster.build import build  # noqa: E402
from ffl2kster.emu import Emulator, battle_from_state  # noqa: E402
from ffl2kster.project import load_project  # noqa: E402
from ffl2kster.states import make_states  # noqa: E402
from conftest import PROJECT, ROOT  # noqa: E402

pytestmark = pytest.mark.emu
ART = ROOT / "build" / "test-artifacts"
EXPECTED_WRAM = {0xD50C, 0xD50D, 0xD541, 0xD542, 0xD549, 0xD54A, 0xD551, 0xD552, 0xDE02, 0xDE03}


@pytest.fixture(scope="module")
def setup(rom_path, tmp_path_factory):
    tmp = tmp_path_factory.mktemp("acc")
    ART.mkdir(parents=True, exist_ok=True)
    project = load_project(PROJECT)
    patched = tmp / "FFL2kster.gb"
    report = build(rom_path, project, patched, ART / "diff-report.json")
    states_o = make_states(rom_path, tmp / "states_orig", log=lambda *_: None)
    states_p = make_states(patched, tmp / "states_patched", log=lambda *_: None)
    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    return dict(tmp=tmp, patched=patched, report=report, so=states_o, sp=states_p,
                stamp=stamp, rom=rom_path)


def test_diff_report_only_intended(setup):
    changed = {c["offset"] for c in setup["report"]["changes"]}
    assert changed - {0x14E, 0x14F} == {0x37432}


def test_both_roms_cold_boot_to_test_point(setup):
    o, p = setup["so"], setup["sp"]
    assert o["steps_to_battle"] == p["steps_to_battle"]
    bo, bp = bytes.fromhex(o["enemy_block"]), bytes.fromhex(p["enemy_block"])
    assert bo[10] == bp[10] == 120                 # Jaguar group in both
    assert bo[12] | bo[13] << 8 == 45
    assert bp[12] | bp[13] << 8 == 200


def test_same_state_intended_value_differs(setup):
    st = setup["tmp"] / "states_orig" / "pre_battle.state"
    a = battle_from_state(setup["rom"], st, setup["so"]["direction"])
    b = battle_from_state(setup["patched"], st, setup["so"]["direction"])
    assert a.loaded and b.loaded
    assert a.enemy_id == b.enemy_id == 120
    assert a.enemy_hp == 45 and b.enemy_hp == 200
    assert a.enemy_stats == b.enemy_stats == [6, 5, 3, 5]
    diffs = {0xC000 + i for i in range(len(a.wram)) if a.wram[i] != b.wram[i]}
    assert 0xD50C in diffs
    assert diffs <= EXPECTED_WRAM, f"unexpected WRAM differences: {sorted(map(hex, diffs - EXPECTED_WRAM))}"
    s = setup["stamp"]
    a.screenshot.save(ART / f"{s}_battle_original.png")
    b.screenshot.save(ART / f"{s}_battle_patched.png")
    setup["wram_diffs"] = sorted(f"{x:04X}" for x in diffs)
    setup["battle"] = {"original": {"hp": a.enemy_hp, "individual": a.individual_hp},
                       "patched": {"hp": b.enemy_hp, "individual": b.individual_hp}}


def _fight(rom, state, direction, presses=30):
    with Emulator(rom) as e:
        e.load_state(state)
        e.press(direction)
        e.pb.tick(240, False)
        for _ in range(presses):
            e.pb.button("a", 6)
            e.pb.tick(26, False)
        hp = [e.pb.memory[0xD541 + 8 * j] | e.pb.memory[0xD542 + 8 * j] << 8 for j in range(3)]
        return hp, e.screenshot()


def test_observable_battle_outcome(setup):
    st = setup["tmp"] / "states_orig" / "pre_battle.state"
    d = setup["so"]["direction"]
    hp_o, img_o = _fight(setup["rom"], st, d)
    hp_p, img_p = _fight(setup["patched"], st, d)
    s = setup["stamp"]
    img_o.save(ART / f"{s}_after30_original.png")    # shows "Jaguar fell."
    img_p.save(ART / f"{s}_after30_patched.png")     # Jaguar survives the same 116-damage hit
    assert hp_o[0] == 0 and hp_p[0] > 0
    assert list(img_o.getdata()) != list(img_p.getdata())
    out = {"timestamp": s, "rom_sha256": setup["report"]["input"]["sha256"],
           "patched_sha256": setup["report"]["output"]["sha256"],
           "diff_changed_bytes": setup["report"]["changed_bytes"],
           "cold_boot": {"original": setup["so"], "patched": setup["sp"]},
           "same_state_battle": setup.get("battle"), "wram_diffs": setup.get("wram_diffs"),
           "after_30_presses_individual_hp": {"original": hp_o, "patched": hp_p},
           "automated": "everything (state generation, battle entry, assertions, screenshots)",
           "manual": "none"}
    (ART / "acceptance-report.json").write_text(json.dumps(out, indent=2) + "\n")
    shutil.copyfile(setup["patched"], ART / "FFL2kster-under-test.gb")


def test_text_reinsertion_visible(setup):
    import re
    out = setup["tmp"] / "text.gb"
    build(setup["rom"], load_project(PROJECT), out,
          edits=[__import__("ffl2kster.project", fromlist=["Edit"]).Edit("text", 90, "battle", "\nVictory!\n⟨end⟩")])
    st = setup["tmp"] / "states_orig" / "pre_battle.state"

    def after(rom):
        with Emulator(rom) as e:
            e.load_state(st); e.press(setup["so"]["direction"]); e.pb.tick(240, False)
            for _ in range(200):
                e.pb.button("a", 6); e.pb.tick(26, False)
                t = re.sub(r"\s+", " ", " ".join(x.strip("|· ") for x in e.screen_text()[:10]))
                if "GP" in t:
                    e.screenshot().save(ART / f"{setup['stamp']}_text_{rom.name}.png")
                    return t
    assert "Right on" in after(setup["rom"])
    t = after(out)
    assert "Victory" in t and "Right on" not in t


def test_encounter_formation_edit_visible(setup):
    from ffl2kster.project import Edit
    out = setup["tmp"] / "enc.gb"
    build(setup["rom"], load_project(PROJECT), out, edits=[Edit("formation", 20, "id1", 45)])

    def first_battle(rom):
        with Emulator(rom) as e:
            e.load_state(setup["tmp"] / "states_orig" / "world.state")
            for i in range(40):
                e.hook_hits.clear(); e.press(["up", "down"][(i // 3) % 2])
                if e.hook_hits:
                    break
            e.pb.tick(240, False)
            return e.pb.memory[0xD50A], e.pb.memory[0xD501]
    assert first_battle(setup["rom"]) == (120, 3)
    assert first_battle(out) == (45, 3)


def _rewards(rom, state, direction="down", presses=150):
    """Fight with repeated A presses; return (GP gained, inventory ids, meat prompt seen)."""
    with Emulator(rom) as emu:
        emu.load_state(state)
        gp0 = int.from_bytes(bytes(emu.pb.memory[0xC2A2:0xC2A5]), "little")
        hp0 = [emu.pb.memory[0xC209 + 32 * k] | emu.pb.memory[0xC20A + 32 * k] << 8 for k in range(4)]
        inv0 = bytes(emu.pb.memory[0xC2B9:0xC2D9])
        emu.step_into_battle(direction)
        meat = False
        for _ in range(presses):
            emu.pb.button("a", 6)
            emu.pb.tick(20, False)
            if emu.pb.memory[0xCF10] and not meat and "meat" in " ".join(emu.screen_text()[:10]):
                meat = True
        gp1 = int.from_bytes(bytes(emu.pb.memory[0xC2A2:0xC2A5]), "little")
        inv1 = bytes(emu.pb.memory[0xC2B9:0xC2D9])
        hp1 = [emu.pb.memory[0xC209 + 32 * k] | emu.pb.memory[0xC20A + 32 * k] << 8 for k in range(4)]
    new = [inv1[i] for i in range(0, 32, 2) if inv1[i] != inv0[i]]
    _rewards.hp_gain = [b - a for a, b in zip(hp0, hp1)]
    return gp1 - gp0, new, meat


def test_battle_rewards_controlled_changes(setup, tmp_path):
    """Script 8 (calc VM): reward byte 0C:7C50+id. Asigaru (180) = 0x21 → 33 GP + item drop
    (Long, id 1) from the deterministic RNG; 0x01 → no drop; 0x22 → 66 GP."""
    from ffl2kster import rules
    state = setup["tmp"] / "states_orig" / "pre_battle_id180.state"
    d = setup["so"]["more"][180]
    base = setup["rom"].read_bytes()
    gp, new, _ = _rewards(setup["rom"], state, d)
    assert gp == 33 and new == [1]
    for val, exp_gp, exp_new in ((0x01, 33, []), (0x22, 66, [1])):
        t = bytearray(base); t[rules.BANK0C + rules.REWARD + 180] = val
        p = tmp_path / f"r{val:02x}.gb"; p.write_bytes(t)
        gp, new, _ = _rewards(p, state, d)
        assert (gp, new) == (exp_gp, exp_new), val


def test_growth_hp_chance_controlled_change(setup, tmp_path):
    """Script 10: HP growth when rand(0..200) <= b0 + max(level*b1 - penalty, 0) with (b0, b1)
    at 0C:7F92 + 16*race. Baseline: a party member gains Max HP after the Asigaru battle;
    (b0, b1) = (0, 0) → no gain; (200, 0) → every member gains."""
    from ffl2kster import rules
    state = setup["tmp"] / "states_orig" / "pre_battle_id180.state"
    d = setup["so"]["more"][180]
    base = setup["rom"].read_bytes()
    _rewards(setup["rom"], state, d)
    assert any(g > 0 for g in _rewards.hp_gain)
    results = {}
    for vals in ((0, 0), (200, 0)):
        t = bytearray(base)
        t[rules.BANK0C + rules.GROWTH + 2:rules.BANK0C + rules.GROWTH + 4] = bytes(vals)
        p = tmp_path / f"g{vals[0]}.gb"; p.write_bytes(t)
        _rewards(p, state, d)
        results[vals] = list(_rewards.hp_gain)
    assert all(g == 0 for g in results[(0, 0)])
    assert all(g > 0 for g in results[(200, 0)])
