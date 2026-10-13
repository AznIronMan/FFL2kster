"""Legend I milestone-1 acceptance (PyBoy): original vs patched from the same pre-battle state."""

import json
from pathlib import Path

import pytest

from ffl1kster.build import build
from ffl1kster.emu import Emulator
from ffl1kster.project import load_project
from ffl1kster.schema import monsters as M

from .conftest import FFL1_PROJECT, ROOT

pytestmark = pytest.mark.emu
STATES = ROOT / "ffl1" / "build" / "states"
ART = ROOT / "ffl1" / "build" / "test-artifacts"


@pytest.fixture(scope="module")
def states(ffl1_rom_path):
    pytest.importorskip("pyboy")
    if not (STATES / "pre_battle.state").exists():
        from ffl1kster.states import make_states
        make_states(ffl1_rom_path, STATES, log=lambda *_: None)
    return json.loads((STATES / "states.json").read_text())


@pytest.fixture(scope="module")
def patched(ffl1_rom_path, tmp_path_factory):
    out = tmp_path_factory.mktemp("acc") / "FFL1kster.gb"
    build(ffl1_rom_path, load_project(FFL1_PROJECT), out)
    return out


def _fight(rom, direction, presses):
    with Emulator(rom) as e:
        e.load_state(STATES / "pre_battle.state")
        snap = e.step_into_battle(direction)
        trace = []
        for _ in range(presses):
            e.press("a", wait=40)
            m = e.pb.memory
            trace.append((m[0xD083] | m[0xD084] << 8, m[0xFF4A]))
        return snap, trace, e.screenshot()


def test_both_reach_battle_and_differ_only_in_hp(ffl1_rom_path, patched, states):
    d = states["pre_battle"]["direction"]
    with Emulator(ffl1_rom_path) as e:
        e.load_state(STATES / "pre_battle.state")
        a = e.step_into_battle(d)
    with Emulator(patched) as e:
        e.load_state(STATES / "pre_battle.state")
        b = e.step_into_battle(d)
    assert a.loaded and b.loaded
    assert [x.monster_id for x in a.enemies] == [x.monster_id for x in b.enemies] == [155]
    assert a.enemies[0].max_hp == 19 and 795 - 49 <= b.enemies[0].max_hp <= 795
    diff = {0xC000 + i for i in range(0x2000) if a.wram[i] != b.wram[i]}
    assert diff and diff <= {0xD083, 0xD084, 0xD085, 0xD086}
    ART.mkdir(parents=True, exist_ok=True)
    a.screenshot.save(ART / "battle_original.png")
    b.screenshot.save(ART / "battle_patched.png")


def test_outcome_differs(ffl1_rom_path, patched, states):
    d = states["pre_battle"]["direction"]
    _, ta, img_a = _fight(ffl1_rom_path, d, 50)
    _, tb, img_b = _fight(patched, d, 50)
    assert ta[-1] == (0, 144)            # original: ASIGARU fell, back on the field (window hidden)
    assert tb[-1][0] > 700 and tb[-1][1] < 144  # patched: same hits taken, still fighting
    ART.mkdir(parents=True, exist_ok=True)
    img_a.save(ART / "after_original.png")
    img_b.save(ART / "after_patched.png")


def test_name_table_drives_battle_name(ffl1_rom_path, states, tmp_path):
    """Controlled change of the name entry 05:4000 + 8*155 shows up in the battle window."""
    rom = bytearray(ffl1_rom_path.read_bytes())
    from ffl1kster.text import encode
    rom[M.NAMES + 8 * 155:M.NAMES + 8 * 156] = encode("ZYXWVUTS", 8)
    p = tmp_path / "n.gb"
    p.write_bytes(bytes(rom))
    with Emulator(p) as e:
        e.load_state(STATES / "pre_battle.state")
        e.step_into_battle(states["pre_battle"]["direction"])
        assert any("ZYXWVUTS" in r for r in e.screen_text())
    with Emulator(ffl1_rom_path) as e:
        e.load_state(STATES / "pre_battle.state")
        e.step_into_battle(states["pre_battle"]["direction"])
        assert any("ASIGARU" in r for r in e.screen_text())
