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
