"""Legend III text reinserted and shown in the emulator."""

import os
import tempfile

import pytest

from ffl3kster import script_text as T
from ffl3kster.emu import Emulator

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATE = ROOT / "ffl3" / "build" / "states" / "battle.state"


def _rows_seen(rom_bytes, presses=24):
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, rom_bytes); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(STATE)
            seen = set()
            for _ in range(presses):
                e.press("a", wait=30)
                seen.update(r.strip(" ·") for r in e.screen_text())
            return seen
    finally:
        os.remove(path)


def test_battle_message_reinserted(ffl3_rom):
    pytest.importorskip("pyboy")
    if not STATE.exists():
        pytest.skip("run python -m ffl3kster make-states")
    off, data = T.patch_in_place(ffl3_rom, "09:7BFC", "{1C}{1F FF} swung\n{1C}{1E 80} at\n")
    rom = bytearray(ffl3_rom)
    rom[off:off + len(data)] = data
    a, b = _rows_seen(ffl3_rom), _rows_seen(bytes(rom))
    assert "Myron used" in a and "Battle against" in a
    assert "Myron swung" in b and "Battle at" in b and "Myron used" not in b
