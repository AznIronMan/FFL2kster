"""Legend III music: the frame-level driver model equals the game's channel pointers."""

import io

import pytest

from ffl3kster import music as M
from ffl3kster.emu import Emulator

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATES = ROOT / "ffl3" / "build" / "states"


def _record(e, base, song, frames):
    m, rec, started = e.pb.memory, [], [False]
    e.pb.load_state(io.BytesIO(base))
    m[0xFFBA] = song
    e._rec, e._started = rec, started
    while len(rec) < frames:
        e.pb.tick(1, False)
    return rec


@pytest.fixture(scope="module")
def emu(ffl3_rom_path):
    pytest.importorskip("pyboy")
    if not (STATES / "menu.state").exists():
        pytest.skip("run python -m ffl3kster make-states")
    with Emulator(ffl3_rom_path) as e:
        m = e.pb.memory
        e._rec, e._started = [], [False]
        e.pb.hook_register(0x0F, 0x402D, lambda _: e._started.__setitem__(0, True), None)
        e.pb.hook_register(0x0F, 0x4028, lambda _: e._rec.append(
            [m[0xCB09] | m[0xCB0A] << 8, m[0xCB21] | m[0xCB22] << 8, m[0xCB39] | m[0xCB3A] << 8,
             m[0xCB51] | m[0xCB52] << 8]) if e._started[0] else None, None)
        yield e


def test_every_song_600_frames(emu, ffl3_rom):
    menu = (STATES / "menu.state").read_bytes()
    battle = (STATES / "battle.state").read_bytes()
    for n in range(1, M.SONG_COUNT + 1):
        rec = _record(emu, battle if n == 8 else menu, n, 600)    # song 8 already plays in the menu
        assert rec == M.trace(ffl3_rom, n, 600), n


def test_song_3_over_two_periods(emu, ffl3_rom):
    rec = _record(emu, (STATES / "menu.state").read_bytes(), 3, 3000)       # period 1,392 frames
    assert rec == M.trace(ffl3_rom, 3, 3000)
