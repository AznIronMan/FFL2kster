"""Legend III random encounter forced in the Talon (rate and zone poked), original vs patched."""

import os
import tempfile

import pytest

from ffl3kster.emu import Emulator
from ffl3kster.schema import encounters as E

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATE = ROOT / "ffl3" / "build" / "states" / "talon.state"


def _battle(rom_bytes):
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, rom_bytes); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(STATE)
            m = e.pb.memory
            m[0xCA2B], m[0xCA2D] = 0xFF, 0
            for b in ["right", "left"] * 4:
                e.press(b, hold=8, wait=12)
                if m[0xCA2C]:
                    break
            e.pb.tick(400, False)
            return m[0xFFCA], list(m[0xCC59:0xCC5C])
    finally:
        os.remove(path)


def test_zone_and_formation(ffl3_rom):
    pytest.importorskip("pyboy")
    if not STATE.exists():
        pytest.skip("run python -m ffl3kster make-states")
    assert _battle(ffl3_rom) == (0x00, [0x78, 0x04, 0xFF])
    rom = bytearray(ffl3_rom)
    for k in range(7):
        rom[E.ZONE.record_offset(0) + k] = 0x05
    assert _battle(bytes(rom)) == (0x05, [0x0D, 0x41, 0xFF])
    rom = bytearray(ffl3_rom)
    rom[E.FORMATION.record_offset(0)] = 0x46
    assert _battle(bytes(rom)) == (0x00, [0x46, 0x04, 0xFF])
