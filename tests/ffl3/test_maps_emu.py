"""Legend III map header and doors in the emulator (field.state: the hangar, walking down)."""

import os
import tempfile

import pytest

from ffl3kster import rom as romlib
from ffl3kster.emu import Emulator
from ffl3kster.schema import maps as M

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATE = ROOT / "ffl3" / "build" / "states" / "field.state"


def _walk(rom_bytes, steps):
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, rom_bytes); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(STATE)
            m, maps = e.pb.memory, []
            for _ in range(steps):
                e.press("down", hold=8, wait=12)
                maps.append(m[0xC6E8])
            return maps, (m[0xCA2B], m[0xCA2D], m[0xCA18])
    finally:
        os.remove(path)


def test_header_and_doors(ffl3_rom):
    pytest.importorskip("pyboy")
    if not STATE.exists():
        pytest.skip("run python -m ffl3kster make-states")
    assert _walk(ffl3_rom, 5)[0] == [0x10, 0x10, 0x10, 0x10, 0x0B]
    rom = bytearray(ffl3_rom)
    o = romlib.bank_to_file(6, M.map_pointer(ffl3_rom, 0x10))
    rom[o + 4], rom[o + 5], rom[o + 3] = 0xEB, 0x05, 0x1A          # rate class 7, zone 5, mode 1A
    assert _walk(bytes(rom), 3)[1] == (9, 5, 0x1A)
    rom = bytearray(ffl3_rom)
    rom[M.DOOR.record_offset(0x2D)] = 0x0A                          # the Talon's exit
    assert _walk(bytes(rom), 5)[0] == [0x10, 0x10, 0x10, 0x10, 0x0A]
