"""Legend I M3: text reinsertion is visible in PyBoy (dialogue, battle message, UI template)."""

import json

import pytest

from ffl1kster import script_text as T
from ffl1kster.emu import Emulator

from .conftest import ROOT

pytestmark = pytest.mark.emu
STATES = ROOT / "ffl1" / "build" / "states"


@pytest.fixture(scope="module")
def states(ffl1_rom_path):
    pytest.importorskip("pyboy")
    if not (STATES / "pre_battle.state").exists():
        from ffl1kster.states import make_states
        make_states(ffl1_rom_path, STATES, log=lambda *_: None)
    return json.loads((STATES / "states.json").read_text())


def _patched(ffl1_rom, tmp_path, table, idx, old: bytes, new: bytes):
    e = T.table_entries(ffl1_rom, table)[idx]
    blob = ffl1_rom[e["offset"]:e["offset"] + e["length"]]
    assert blob.count(old) == 1 and len(old) == len(new)
    k = e["offset"] + blob.index(old)
    rom = bytearray(ffl1_rom)
    rom[k:k + len(new)] = new
    p = tmp_path / f"{table}{idx}.gb"
    p.write_bytes(bytes(rom))
    return p


def _screen(rom, state, steps):
    """Everything shown on screen after each step (text lines joined), from a state or cold boot."""
    seen = []
    with Emulator(rom) as e:
        if state is not None:
            e.load_state(state)
        for k, hold, wait in steps:
            if k == "wait":
                e.pb.tick(wait, False)
            else:
                e.press(k, hold=hold, wait=wait)
            seen.append(" | ".join(r.strip(" ·") for r in e.screen_text()))
    return " || ".join(seen)


def test_dialogue_reinsertion(ffl1_rom_path, ffl1_rom, states, tmp_path):
    """NPC east of the first town's start (dialogue 249): 'Guild.' -> 'Tower' (same byte length)."""
    from ffl1kster.text import encode
    steps = [("right", 4, 40), ("right", 4, 40), ("up", 4, 40), ("up", 4, 40), ("up", 2, 10),
             ("a", 4, 60)] + [("wait", 0, 60)] * 12
    old = bytes.fromhex("90b8d5a7f0")  # G u il d .
    p = _patched(ffl1_rom, tmp_path, "dialogue", 249, old, encode("Tower", 5))
    new = _screen(p, STATES / "first_town.state", steps)
    base = _screen(ffl1_rom_path, STATES / "first_town.state", steps)
    assert "Guild" in base and "Tower" in new and "Guild" not in new


def test_battle_message_reinsertion(ffl1_rom_path, ffl1_rom, states, tmp_path):
    """Battle message 13 ' {31} damage': the letter 'a' (0xA4) -> 'A' (0x8A)."""
    p = _patched(ffl1_rom, tmp_path, "battle", 13, bytes([0xA4]), bytes([0x8A]))
    d = states["pre_battle"]["direction"]
    steps = [(d, 4, 236)] + [("a", 4, 40)] * 12
    assert "10 damage" in _screen(ffl1_rom_path, STATES / "pre_battle.state", steps).replace("  ", " ")
    shown = _screen(p, STATES / "pre_battle.state", steps)
    assert "dAmage" in shown


def test_ui_template_reinsertion(ffl1_rom_path, ffl1_rom, states, tmp_path):
    """UI template 7 (title screen): 'START' -> 'BEGIN'."""
    from ffl1kster.text import encode
    p = _patched(ffl1_rom, tmp_path, "ui", 7, encode("START", 5), encode("BEGIN", 5))
    boot = [("wait", 0, 300)]
    assert "START" in _screen(ffl1_rom_path, None, boot)
    shown = _screen(p, None, boot)
    assert "BEGIN" in shown and "START" not in shown
