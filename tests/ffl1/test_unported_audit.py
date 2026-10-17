"""Legend I: the game's data never reaches the port's not-ported branches (tools/ffl1/unported_audit.py,
docs/ffl1/FINDINGS.md 1.62.0): screen effect 8 (07:7A0E) and effects past the table 07:7AD5;
the item FC (handler 47, 06:5098) is held by no monster and sold by no shop."""

import sys

from .conftest import ROOT

sys.path.insert(0, str(ROOT / "tools/ffl1"))
from unported_audit import audit  # noqa: E402


def test_screen_effect_8_unreachable(ffl1_rom):
    a = audit(ffl1_rom)
    assert a["effects"][8] == 0x7A0E
    assert a["sprite_framing_contiguous"] and a["sprite_end"] == 0x7FB1   # the walk's framing holds
    assert a["scripts_with_effect_8"] == [8]                               # only screen script 8
    assert 8 not in a["item_screen_scripts"]                               # which no item selects
    assert a["reachable_effects"] == [1, 2, 3, 4, 5, 6, 7, 9]              # all ported, all in the table
    x = a["xrefs"]
    assert x["07:7A0E"] == {"calls": [], "words": ["07:7AE3"]}             # only the table entry 8
    assert x["07:77D1"]["calls"] == ["07:6EB9"] and x["07:77AF"]["calls"] == ["07:6E54"]
    assert x["07:6E0F"]["calls"] == ["07:6E03"]


def test_item_fc_held_by_no_monster(ffl1_rom):
    a = audit(ffl1_rom)
    assert a["handler_47"] == 0x5098 and a["handler_47_items"] == [0xFC]
    assert a["monsters_holding_fc"] == [] and a["shops_with_fc"] == []
