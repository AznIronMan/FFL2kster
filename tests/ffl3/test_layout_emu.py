"""Legend III layouts equal the game's D000 tile buffer after every map load of the intro."""

import pytest

from ffl3kster import layout as L
from ffl3kster.emu import Emulator

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATES = ROOT / "ffl3" / "build" / "states"


def test_map_loads_match(ffl3_rom_path, ffl3_rom):
    pytest.importorskip("pyboy")
    if not (STATES / "battle.state").exists():
        pytest.skip("run python -m ffl3kster make-states")
    snaps = []
    with Emulator(ffl3_rom_path) as e:
        e.load_state(STATES / "battle.state")
        m = e.pb.memory
        e.pb.hook_register(0, 0x0371, lambda _: snaps.append((m[0xC6E8], bytes(m[0xD000:0xE000]),
                                                               bytes(m[0xC760:0xC780]))), None)
        for _ in range(1000):
            e.press("a", wait=30)
        for _ in range(9):
            e.press("down", hold=8, wait=12)
    assert [s[0] for s in snaps] == [0x17, 0x1A, 0x55, 0x1A, 0x16, 0x02, 0x0A, 0x0B, 0x10, 0x0B]
    for mid, ram, flags in snaps:
        tiles, _ = L.map_tiles(ffl3_rom, mid, flags)
        assert tiles == ram[:len(tiles)], hex(mid)
