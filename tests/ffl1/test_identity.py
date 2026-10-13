"""Legend I: ROM identity, header, and the byte-identical no-op build (milestone-1 step 1)."""

import hashlib
import json

import pytest

from ffl1kster import rom as romlib
from ffl1kster.build import BuildError, build
from ffl1kster.cli import main
from ffl1kster.project import Edit, load_project

from .conftest import FFL1_SHA256


def test_identity(ffl1_rom):
    assert len(ffl1_rom) == 131072
    assert hashlib.sha256(ffl1_rom).hexdigest() == FFL1_SHA256 == romlib.USA_SHA256
    assert hashlib.sha1(ffl1_rom).hexdigest() == "901dfc83c72e172d35a376835807fc788444a9bb"
    assert hashlib.md5(ffl1_rom).hexdigest() == "d5c27ff8cb1b69cb56df4ff170e2baf0"


def test_header(ffl1_rom):
    h = romlib.parse_header(ffl1_rom)
    assert h.title == "SAGA"
    assert h.cart_type == 0x06 and h.cart_type_name == "MBC2+BATTERY"  # Legend II: MBC1+RAM+BATTERY
    assert h.rom_size_bytes == 131072 and h.ram_size_code == 0          # MBC2 RAM is built in
    assert h.destination == 1 and h.version == 0
    assert h.logo_ok and h.header_checksum_ok and h.global_checksum_ok
    assert (h.header_checksum, h.global_checksum) == (0xFF, 0xBE66)


def test_bank_math():
    assert romlib.BANKS == 8
    assert romlib.bank_to_file(7, 0x7FFF) == 131071
    assert romlib.file_to_bank(0x4000) == (1, 0x4000)


def test_noop_build_identical(ffl1_rom_path, ffl1_rom, ffl1_project, tmp_path):
    out, diff = tmp_path / "out.gb", tmp_path / "diff.json"
    before = ffl1_rom_path.stat().st_mtime_ns
    r = build(ffl1_rom_path, load_project(ffl1_project), out, diff)
    assert r["identical"] and r["changed_bytes"] == 0 and r["changes"] == []
    assert out.read_bytes() == ffl1_rom
    assert json.loads(diff.read_text())["changes"] == []
    assert ffl1_rom_path.stat().st_mtime_ns == before and ffl1_rom_path.read_bytes() == ffl1_rom


def test_refuses_overwrite(ffl1_rom_path, ffl1_project):
    with pytest.raises(BuildError):
        build(ffl1_rom_path, load_project(ffl1_project), ffl1_rom_path)


def test_refuses_wrong_rom(ffl1_rom, ffl1_project, tmp_path):
    bad = tmp_path / "bad.gb"
    bad.write_bytes(ffl1_rom[:-1] + bytes([ffl1_rom[-1] ^ 1]))
    with pytest.raises(BuildError, match="does not match"):
        build(bad, load_project(ffl1_project), tmp_path / "o.gb")


def test_rejects_unknown_domain(ffl1_rom_path, ffl1_project, tmp_path):
    with pytest.raises(ValueError, match="unknown edit domain"):
        build(ffl1_rom_path, load_project(ffl1_project), tmp_path / "o.gb",
              edits=[Edit("enemy", 0, "hp", 1)])


def test_cli_info(ffl1_rom_path, capsys):
    assert main(["info", "--rom", str(ffl1_rom_path)]) == 0
    assert '"MBC2+BATTERY"' in capsys.readouterr().out
