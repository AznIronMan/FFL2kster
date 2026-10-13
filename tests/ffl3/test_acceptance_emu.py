"""Legend III milestone-1 acceptance (PyBoy): original vs patched from the same pre-battle state
(the prologue Simulator battle, Diviner x2 and Sprite x2; proof edit Sprite HP 45 -> 900)."""

import json

import pytest

from ffl3kster.build import build
from ffl3kster.emu import Emulator, battle_from_state
from ffl3kster.project import load_project

from .conftest import FFL3_PROJECT, ROOT

pytestmark = pytest.mark.emu
STATES = ROOT / "ffl3" / "build" / "states"
ART = ROOT / "ffl3" / "build" / "test-artifacts"
SPRITE_HP = {0xD390, 0xD391, 0xD392, 0xD393, 0xD410, 0xD411, 0xD412, 0xD413,   # entities 2-3, +10..+13
             0xD690, 0xD691, 0xD692, 0xD693,                                   # staging slot
             0xCC73}                                                           # loader copy of b2


@pytest.fixture(scope="module")
def states(ffl3_rom_path):
    pytest.importorskip("pyboy")
    if not (STATES / "pre_battle.state").exists():
        from ffl3kster.states import make_states
        make_states(ffl3_rom_path, STATES, log=lambda *_: None)
    return json.loads((STATES / "states.json").read_text())


@pytest.fixture(scope="module")
def patched(ffl3_rom_path, tmp_path_factory):
    out = tmp_path_factory.mktemp("acc") / "FFL3kster.gb"
    build(ffl3_rom_path, load_project(FFL3_PROJECT), out)
    return out


def test_states_manifest(states):
    assert states["group_ids"] == [0x46, 0x4B, 0xFF] and states["group_counts"] == [2, 2, 0]
    assert len(states["loads"]) == 2 and states["pre_battle"] < states["loads"][0] < states["battle"]


def test_both_reach_battle_and_differ_only_in_sprite_hp(ffl3_rom_path, patched, states):
    a = battle_from_state(ffl3_rom_path, STATES / "pre_battle.state")
    b = battle_from_state(patched, STATES / "pre_battle.state")
    assert a.menu and b.menu and a.loads == b.loads == 2
    assert [e.monster_id for e in a.enemies] == [e.monster_id for e in b.enemies] == [0x46, 0x46, 0x4B, 0x4B]
    assert [(e.hp, e.max_hp) for e in a.enemies] == [(45, 45)] * 4
    assert [(e.hp, e.max_hp) for e in b.enemies] == [(45, 45)] * 2 + [(900, 900)] * 2
    diff = {0xC000 + i for i in range(0x2000) if a.wram[i] != b.wram[i]}
    assert diff == SPRITE_HP


def _fight(rom, presses=115):
    with Emulator(rom) as e:
        e.load_state(STATES / "pre_battle.state")
        assert e.wait_for_text("Fight", 900, 5)
        m, hp, seen = e.pb.memory, [], set()
        for _ in range(presses):
            e.press("a", wait=40)
            hp.append(m[0xD390] | m[0xD391] << 8)
            seen.update(r.strip(" ·") for r in e.screen_text())
        return hp, seen, e.screenshot()


def test_outcome_differs(ffl3_rom_path, patched, states):
    ha, sa, img_a = _fight(ffl3_rom_path)
    hb, sb, img_b = _fight(patched)
    assert 0 in ha and "Sprite fell." in sa                 # original: the first Sprite falls
    assert "Sprite fell." not in sb and "Curtis fell." in sb  # patched: it outlasts a party member,
    assert hb[0] == 900 and min(hb[:90]) == 900               # takes no lethal damage before then,
    assert any("Simulator" in s for s in sb)                  # and the Simulator battle ends early
    ART.mkdir(parents=True, exist_ok=True)
    img_a.save(ART / "fight_original.png")
    img_b.save(ART / "fight_patched.png")
