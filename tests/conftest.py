import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ROM = ROOT / "input" / "original.gb"
PROJECT = ROOT / "project" / "project.json"
EXPECTED_SHA256 = "ef66c90aeaab71672aefc6f39569b70925c08bda4996fe68f1452ed4a898486e"


@pytest.fixture(scope="session")
def rom_path():
    if not ROM.exists():
        pytest.skip("input/original.gb not present (supply your own ROM)")
    return ROM


@pytest.fixture(scope="session")
def rom_bytes(rom_path):
    return rom_path.read_bytes()


@pytest.fixture
def project_file(tmp_path):
    """A copy of project.json with no edits, so tests are independent of user edits."""
    data = json.loads(PROJECT.read_text())
    data["edits"] = []
    p = tmp_path / "project.json"
    p.write_text(json.dumps(data))
    return p
