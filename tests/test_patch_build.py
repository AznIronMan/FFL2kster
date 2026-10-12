import json

import pytest

from ffl2kster.build import BuildError, build
from ffl2kster.project import Edit, load_project
from conftest import PROJECT


def test_proof_build_changes_only_intended_bytes(rom_path, rom_bytes, tmp_path):
    project = load_project(PROJECT)
    assert [(e.domain, e.id, e.field, e.value) for e in project.edits] == [("enemy", 120, "hp", 200)]
    out, diff = tmp_path / "p.gb", tmp_path / "d.json"
    rep = build(rom_path, project, out, diff)
    changed = {c["offset"] for c in rep["changes"]}
    assert changed == {0x37432, 0x14E, 0x14F}
    data = out.read_bytes()
    assert data[0x37432] == 200 and data[0x37433] == 0
    assert all(c["reason"] for c in rep["changes"])
    assert rep["output"]["header_checksum_ok"] and rep["output"]["global_checksum_ok"]
    assert sum(a != b for a, b in zip(rom_bytes, data)) == 3
    assert json.loads(diff.read_text())["changed_bytes"] == 3


def test_rejects_non_editable_field(rom_path, project_file, tmp_path):
    with pytest.raises(ValueError, match="not editable"):
        build(rom_path, load_project(project_file), tmp_path / "o.gb",
              edits=[Edit("enemy", 120, "ability_ptr", 0x7980)])


def test_rejects_out_of_range(rom_path, project_file, tmp_path):
    with pytest.raises(ValueError, match="outside allowed range"):
        build(rom_path, load_project(project_file), tmp_path / "o.gb",
              edits=[Edit("enemy", 120, "str", 300)])
    with pytest.raises(ValueError, match="out of range"):
        build(rom_path, load_project(project_file), tmp_path / "o.gb",
              edits=[Edit("enemy", 256, "hp", 10)])


def test_conflicting_edits_rejected(rom_path, project_file, tmp_path):
    with pytest.raises(BuildError, match="conflicting"):
        build(rom_path, load_project(project_file), tmp_path / "o.gb",
              edits=[Edit("enemy", 120, "hp", 100), Edit("enemy", 120, "hp", 101)])


def test_stat_edit(rom_path, project_file, tmp_path):
    rep = build(rom_path, load_project(project_file), tmp_path / "o.gb",
                edits=[Edit("enemy", 45, "def", 9)])
    changed = {c["offset"] for c in rep["changes"]}
    # global checksum bytes change only as needed; every other change must be the target
    assert changed - {0x14E, 0x14F} == {0x36F80 + 457}
    assert all(c["reason"] == "cartridge checksum recomputed"
               for c in rep["changes"] if c["offset"] in (0x14E, 0x14F))
    assert rep["output"]["global_checksum_ok"]
