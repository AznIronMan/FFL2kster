import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FFL3_ROM = ROOT / "ffl3" / "input" / "original.gb"
FFL3_PROJECT = ROOT / "ffl3" / "project" / "project.json"
FFL3_SHA256 = "5ed87f65225b72a74c3c04a4e5d67683fb5cc33e5f1266157350828ab973fc1d"


@pytest.fixture(scope="session")
def ffl3_rom_path():
    if not FFL3_ROM.exists():
        pytest.skip("ffl3/input/original.gb not present (supply your own Legend III ROM)")
    return FFL3_ROM


@pytest.fixture(scope="session")
def ffl3_rom(ffl3_rom_path):
    return ffl3_rom_path.read_bytes()


@pytest.fixture
def ffl3_project(tmp_path):
    data = json.loads(FFL3_PROJECT.read_text())
    data["edits"] = []
    p = tmp_path / "project.json"
    p.write_text(json.dumps(data))
    return p
