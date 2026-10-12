import sqlite3

import pytest

from ffl2kster import db
from ffl2kster.build import build
from ffl2kster.project import load_project
from conftest import PROJECT


@pytest.fixture
def dbfile(rom_path, tmp_path):
    p = tmp_path / "proj.sqlite"
    db.import_rom(rom_path, p, load_project(PROJECT))
    return p


def test_import_counts_and_provenance(dbfile):
    con = sqlite3.connect(dbfile)
    assert con.execute("SELECT COUNT(*) FROM enemies").fetchone()[0] == 256
    assert con.execute("SELECT COUNT(*) FROM enemy_fields").fetchone()[0] == 256 * 9
    row = con.execute("SELECT original_value, source_offset, source_bank, source_address, status "
                      "FROM enemy_fields WHERE enemy_id=120 AND field='hp'").fetchone()
    assert row == (45, 0x37432, 0x0D, 0x7432, "verified")
    assert con.execute("SELECT COUNT(*) FROM enemy_fields WHERE status NOT IN "
                       "('verified','probable','hypothesis')").fetchone()[0] == 0


def test_edits_separate_from_originals(dbfile):
    con = sqlite3.connect(dbfile)
    assert con.execute("SELECT original_value, effective_value, edited FROM enemy_effective "
                       "WHERE enemy_id=120 AND field='hp'").fetchone() == (45, 200, 1)
    assert con.execute("SELECT COUNT(*) FROM edits").fetchone()[0] == 1


def test_reimport_keeps_edits(rom_path, dbfile):
    db.import_rom(rom_path, dbfile)  # no project -> must not drop existing edits
    assert [(e.id, e.field, e.value) for e in db.load_edits(dbfile)] == [(120, "hp", 200)]


def test_db_build_matches_json_build(rom_path, dbfile, tmp_path):
    project = load_project(PROJECT)
    a, b = tmp_path / "json.gb", tmp_path / "db.gb"
    build(rom_path, project, a)
    build(rom_path, project, b, edits=db.load_edits(dbfile))
    assert a.read_bytes() == b.read_bytes()


def test_rejects_db_from_other_rom(rom_bytes, dbfile, tmp_path):
    other = bytearray(rom_bytes)
    other[0x1000] ^= 1
    p = tmp_path / "other.gb"
    p.write_bytes(other)
    with pytest.raises(ValueError, match="different ROM"):
        db.import_rom(p, dbfile)


def test_committed_db_is_current(rom_path):
    """project/ffl2kster.sqlite must reflect the ROM import and project.json edits."""
    from conftest import ROOT
    path = ROOT / "project" / "ffl2kster.sqlite"
    con = sqlite3.connect(path)
    assert con.execute("SELECT value FROM meta WHERE key='source_sha256'").fetchone()[0] == \
        load_project(PROJECT).supported_sha256
    assert [(e.id, e.field, e.value) for e in db.load_edits(path)] == \
        [(e.id, e.field, e.value) for e in load_project(PROJECT).edits]
