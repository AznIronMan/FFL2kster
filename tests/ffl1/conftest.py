import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FFL1_ROM = ROOT / "ffl1" / "input" / "original.gb"
FFL1_PROJECT = ROOT / "ffl1" / "project" / "project.json"
FFL1_SHA256 = "e5b1d116a8fb01b7a7213f906b3ef1bcc91a18f6826b01ee1bccd89429a0d906"


@pytest.fixture(scope="session")
def ffl1_rom_path():
    if not FFL1_ROM.exists():
        pytest.skip("ffl1/input/original.gb not present (supply your own Legend I ROM)")
    return FFL1_ROM


@pytest.fixture(scope="session")
def ffl1_rom(ffl1_rom_path):
    return ffl1_rom_path.read_bytes()


@pytest.fixture
def ffl1_project(tmp_path):
    data = json.loads(FFL1_PROJECT.read_text())
    data["edits"] = []
    p = tmp_path / "project.json"
    p.write_text(json.dumps(data))
    return p
