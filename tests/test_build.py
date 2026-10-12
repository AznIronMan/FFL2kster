import json
import shutil

import pytest

from ffl2kster.build import BuildError, build
from ffl2kster.project import Edit, load_project


def test_noop_build_is_byte_identical(rom_path, rom_bytes, project_file, tmp_path):
    out, diff = tmp_path / "out.gb", tmp_path / "diff.json"
    report = build(rom_path, load_project(project_file), out, diff)
    assert out.read_bytes() == rom_bytes
    assert report["identical"] and report["changed_bytes"] == 0
    assert json.loads(diff.read_text())["changes"] == []


def test_input_never_written(rom_path, rom_bytes, project_file, tmp_path):
    before = rom_path.stat().st_mtime_ns
    build(rom_path, load_project(project_file), tmp_path / "o.gb")
    assert rom_path.stat().st_mtime_ns == before
    assert rom_path.read_bytes() == rom_bytes


def test_refuses_to_overwrite_input(rom_path, project_file, tmp_path):
    copy = tmp_path / "in.gb"
    shutil.copy(rom_path, copy)
    with pytest.raises(BuildError, match="over the input"):
        build(copy, load_project(project_file), copy)


def test_refuses_wrong_rom(rom_bytes, project_file, tmp_path):
    bad = bytearray(rom_bytes)
    bad[0x1000] ^= 0xFF
    p = tmp_path / "bad.gb"
    p.write_bytes(bad)
    with pytest.raises(BuildError, match="does not match"):
        build(p, load_project(project_file), tmp_path / "o.gb")


def test_unknown_domain_rejected(rom_path, project_file, tmp_path):
    with pytest.raises(ValueError, match="unknown or unproven"):
        build(rom_path, load_project(project_file), tmp_path / "o.gb",
              edits=[Edit("nonsense", 0, "x", 1)])
