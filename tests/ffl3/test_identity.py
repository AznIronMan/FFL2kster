"""Legend III: ROM identity, header, and the byte-identical no-op build (milestone-1 step 1)."""

import hashlib
import json

import pytest

from ffl3kster import rom as romlib
from ffl3kster.build import BuildError, build
from ffl3kster.cli import main
from ffl3kster.project import Edit, load_project

from .conftest import FFL3_SHA256


def test_identity(ffl3_rom):
    assert len(ffl3_rom) == 262144
    assert hashlib.sha256(ffl3_rom).hexdigest() == FFL3_SHA256 == romlib.USA_SHA256
    # No-Intro "Final Fantasy Legend III (USA)" (.private/ffl-saga-versions.csv): CRC 3E454710
    assert hashlib.sha1(ffl3_rom).hexdigest() == romlib.USA_SHA1
    assert hashlib.md5(ffl3_rom).hexdigest() == romlib.USA_MD5


def test_header(ffl3_rom):
    h = romlib.parse_header(ffl3_rom)
    assert h.title == "SAGA3"
    assert h.cart_type == 0x03 and h.cart_type_name == "MBC1+RAM+BATTERY"  # as Legend II; Legend I: MBC2
    assert h.rom_size_bytes == 262144 and h.ram_size_bytes == 8192
    assert h.cgb_flag == 0 and h.sgb_flag == 0                          # DMG only
    assert h.destination == 1 and h.version == 0
    assert h.logo_ok and h.header_checksum_ok and h.global_checksum_ok
    assert (h.header_checksum, h.global_checksum) == (0xCC, 0xE1A6)


def test_bank_math():
    assert romlib.BANKS == 16
    assert romlib.bank_to_file(15, 0x7FFF) == 262143
    assert romlib.file_to_bank(0x3C000) == (15, 0x4000)


def test_noop_build_identical(ffl3_rom_path, ffl3_rom, ffl3_project, tmp_path):
    out, diff = tmp_path / "out.gb", tmp_path / "diff.json"
    before = ffl3_rom_path.stat().st_mtime_ns
    r = build(ffl3_rom_path, load_project(ffl3_project), out, diff)
    assert r["identical"] and r["changed_bytes"] == 0 and r["changes"] == []
    assert out.read_bytes() == ffl3_rom
    assert json.loads(diff.read_text())["changes"] == []
    assert ffl3_rom_path.stat().st_mtime_ns == before and ffl3_rom_path.read_bytes() == ffl3_rom


def test_refuses_overwrite(ffl3_rom_path, ffl3_project):
    with pytest.raises(BuildError):
        build(ffl3_rom_path, load_project(ffl3_project), ffl3_rom_path)


def test_refuses_wrong_rom(ffl3_rom, ffl3_project, tmp_path):
    bad = tmp_path / "bad.gb"
    bad.write_bytes(ffl3_rom[:-1] + bytes([ffl3_rom[-1] ^ 1]))
    with pytest.raises(BuildError, match="does not match"):
        build(bad, load_project(ffl3_project), tmp_path / "o.gb")


def test_rejects_unknown_domain(ffl3_rom_path, ffl3_project, tmp_path):
    with pytest.raises(ValueError, match="unknown edit domain"):
        build(ffl3_rom_path, load_project(ffl3_project), tmp_path / "o.gb",
              edits=[Edit("enemy", 0, "hp", 1)])


def test_cli_info(ffl3_rom_path, capsys):
    assert main(["info", "--rom", str(ffl3_rom_path)]) == 0
    assert '"MBC1+RAM+BATTERY"' in capsys.readouterr().out
