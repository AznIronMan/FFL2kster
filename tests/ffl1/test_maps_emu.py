"""Legend I M5 controlled changes in PyBoy: map record zone slot, event command parameter, shop."""

import pytest

from .conftest import ROOT

pytestmark = pytest.mark.emu


@pytest.fixture(scope="module", autouse=True)
def states(ffl1_rom_path):
    pytest.importorskip("pyboy")
    if not (ROOT / "ffl1/build/states/first_town.state").exists():
        from ffl1kster.states import make_states
        make_states(ffl1_rom_path, ROOT / "ffl1/build/states", log=lambda *_: None)


def _tool(name):
    import importlib, sys
    sys.path.insert(0, str(ROOT / "tools/ffl1"))
    return importlib.import_module(name)


def test_world_map_zone_slot():
    t = _tool("map_change")
    W = t.record(88)
    assert t.run([])[3:] == (0x13, ["ASIGARU"])
    assert t.run([(W + 8, 0x08)])[3:] == (0x1E, ["GARGOYLE", "GARGOYLE"])
    assert t.run([(t.record(87) + 8, 0x08)])[3:] == (0x13, ["ASIGARU"])


def test_shop_inventory_and_price():
    t = _tool("shop_change")
    assert t.buy([])[0] == 132
    assert t.buy([(t.PRICES + 3 * 0x21 + 2, 0x77)])[0] == 177
    assert t.buy([(t.PRICES + 3 * 0x22 + 2, 0x77)])[0] == 132
    cost, text, _ = t.buy([(t.INV + 10 * t.SHOP, 0x24)])
    assert cost == 2060 and "KATANA" in text


def test_event_object_parameter():
    t = _tool("event_change")
    assert "Guild" in t.talk([])
    assert "This tower leads to Paradise" in t.talk([(t.NPC + 5, 0x08)])
    assert "ERASE99" in t.talk([(t.NPC + 5, 0x00)])
