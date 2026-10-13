"""Legend III processed data package: deterministic, no raw ROM bytes."""

import hashlib
import json

from ffl3kster.export import export_all


def _digest(d):
    return {str(p.relative_to(d)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(d.rglob("*")) if p.is_file()}


def test_export_reproducible(ffl3_rom, tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    ra, rb = export_all(ffl3_rom, a), export_all(ffl3_rom, b)
    assert ra == rb and ra["files"] == 253
    assert _digest(a) == _digest(b)
    mon = json.loads((a / "monsters.json").read_text())
    assert mon["game"] == "FFL3" and len(mon["tables"]["monster"]["records"]) == 195
    assert all("raw" not in r for t in mon["tables"].values() for r in t["records"])
    assert len(json.loads((a / "text.json").read_text())["scripts"]) == 1639
    assert len(json.loads((a / "music.json").read_text())["songs"]) == 20
