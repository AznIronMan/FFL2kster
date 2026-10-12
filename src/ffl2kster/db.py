"""SQLite project store.

Extracted original values (with source bank/offset provenance and verification status) are
kept separate from user edits. `import` rebuilds the extracted tables from the ROM and keeps
any existing edits; `build --db` takes its edits from the `edits` table.
"""

from __future__ import annotations

import datetime as _dt
import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

from . import __version__
from . import rom as romlib
from .project import Edit

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS field_defs (
    domain TEXT NOT NULL, field TEXT NOT NULL, byte_offset INTEGER NOT NULL,
    size INTEGER NOT NULL, encoding TEXT NOT NULL, meaning TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('verified','probable','hypothesis')),
    evidence TEXT NOT NULL, editable INTEGER NOT NULL, min_value INTEGER, max_value INTEGER,
    PRIMARY KEY (domain, field));
CREATE TABLE IF NOT EXISTS enemies (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, type_name TEXT NOT NULL,
    record_offset INTEGER NOT NULL, bank INTEGER NOT NULL, address INTEGER NOT NULL,
    name_offset INTEGER NOT NULL, ability_offset INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS enemy_fields (
    enemy_id INTEGER NOT NULL REFERENCES enemies(id), field TEXT NOT NULL,
    original_value INTEGER NOT NULL, source_offset INTEGER NOT NULL,
    source_bank INTEGER NOT NULL, source_address INTEGER NOT NULL, size INTEGER NOT NULL,
    status TEXT NOT NULL, PRIMARY KEY (enemy_id, field),
    FOREIGN KEY (field) REFERENCES field_defs(field));
CREATE TABLE IF NOT EXISTS enemy_abilities (
    enemy_id INTEGER NOT NULL REFERENCES enemies(id), slot INTEGER NOT NULL,
    ability_id INTEGER NOT NULL, ability_name TEXT NOT NULL, source_offset INTEGER NOT NULL,
    status TEXT NOT NULL, PRIMARY KEY (enemy_id, slot));
CREATE TABLE IF NOT EXISTS edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, target_id INTEGER NOT NULL,
    field TEXT NOT NULL, value INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, UNIQUE (domain, target_id, field));
CREATE VIEW IF NOT EXISTS enemy_effective AS
    SELECT f.enemy_id, e.name, f.field, f.original_value,
           COALESCE(x.value, f.original_value) AS effective_value,
           x.value IS NOT NULL AS edited, f.source_bank, f.source_address, f.status
    FROM enemy_fields f JOIN enemies e ON e.id = f.enemy_id
    LEFT JOIN edits x ON x.domain = 'enemy' AND x.target_id = f.enemy_id AND x.field = f.field;
"""


def connect(path) -> sqlite3.Connection:
    con = sqlite3.connect(str(path))
    # Default SQLite journaling; FFL2K_SQLITE_JOURNAL=MEMORY for filesystems that forbid
    # deleting the rollback journal (e.g. sandboxed mounts). See docs/DECISIONS.md.
    mode = os.environ.get("FFL2K_SQLITE_JOURNAL")
    if mode:
        con.execute(f"PRAGMA journal_mode = {mode}")
    con.execute("PRAGMA foreign_keys = OFF")
    con.executescript(SCHEMA)
    return con


def import_rom(rom_path, db_path, project=None) -> dict:
    from .schema import enemies as E

    rom = romlib.load_rom(rom_path)
    digest = romlib.sha256(rom)
    if project is not None and digest != project.supported_sha256:
        raise ValueError("ROM does not match the project's supported ROM")
    # Build in a temporary file and copy into place so a failed import never leaves a
    # half-written project database.
    tmpdir = tempfile.mkdtemp(prefix="ffl2k-db-")
    target = Path(db_path)
    work = Path(tmpdir) / "work.sqlite"
    if target.exists() and target.stat().st_size:
        shutil.copyfile(target, work)
    try:
        res = _import_into(rom, digest, work, project)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(work, target)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return res


def _import_into(rom, digest, db_path, project) -> dict:
    from .schema import enemies as E

    con = connect(db_path)
    with con:
        old = con.execute("SELECT value FROM meta WHERE key='source_sha256'").fetchone()
        if old and old[0] != digest:
            raise ValueError("database was imported from a different ROM")
        for t in ("enemy_abilities", "enemy_fields", "enemies", "field_defs"):
            con.execute(f"DELETE FROM {t}")
        for f in E.FIELDS:
            con.execute("INSERT INTO field_defs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                        (E.DOMAIN, f.name, f.offset, f.size, f.encoding, f.meaning, f.status,
                         f.evidence, int(f.editable), f.min, f.max))
        n_fields = 0
        for r in E.extract(rom):
            con.execute("INSERT INTO enemies VALUES (?,?,?,?,?,?,?,?)",
                        (r["id"], r["name"], r["type_name"], r["record_offset"], r["bank"],
                         r["address"], r["name_offset"], r["ability_offset"]))
            for f in E.FIELDS:
                off = r["record_offset"] + f.offset
                bank, addr = romlib.file_to_bank(off)
                con.execute("INSERT INTO enemy_fields VALUES (?,?,?,?,?,?,?,?)",
                            (r["id"], f.name, r["fields"][f.name], off, bank, addr, f.size, f.status))
                n_fields += 1
            for i, a in enumerate(r["abilities"]):
                con.execute("INSERT INTO enemy_abilities VALUES (?,?,?,?,?,?)",
                            (r["id"], i, a["id"], a["name"], r["ability_offset"] + i, "verified"))
        meta = {"source_sha256": digest, "source_size": str(len(rom)),
                "tool_version": __version__, "schema_version": "1",
                "imported_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")}
        for k, v in meta.items():
            con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (k, v))
        if project is not None:
            for e in project.edits:
                set_edit(con, e, commit=False)
    n_edits = con.execute("SELECT COUNT(*) FROM edits").fetchone()[0]
    con.close()
    return {"enemies": 256, "fields": n_fields, "edits": n_edits, "source_sha256": digest}


def set_edit(con, e: Edit, commit=True) -> None:
    from .schema import enemies as E

    if e.domain != E.DOMAIN:
        raise ValueError(f"unknown domain {e.domain}")
    f = E.FIELD_BY_NAME.get(e.field)
    if f is None or not f.editable:
        raise ValueError(f"field {e.field} is not editable")
    E.encode_value(f, e.value)
    E.record_offset(e.id)
    con.execute("INSERT INTO edits (domain,target_id,field,value,reason,created_at) "
                "VALUES (?,?,?,?,?,?) ON CONFLICT(domain,target_id,field) DO UPDATE SET "
                "value=excluded.value, reason=excluded.reason, created_at=excluded.created_at",
                (e.domain, e.id, e.field, e.value, e.reason,
                 _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")))
    if commit:
        con.commit()


def load_edits(db_path) -> list[Edit]:
    if not Path(db_path).exists():
        raise FileNotFoundError(db_path)
    con = connect(db_path)
    rows = con.execute("SELECT domain,target_id,field,value,reason FROM edits ORDER BY id").fetchall()
    con.close()
    return [Edit(d, i, f, v, r) for d, i, f, v, r in rows]


def db_sha(db_path) -> str | None:
    con = connect(db_path)
    r = con.execute("SELECT value FROM meta WHERE key='source_sha256'").fetchone()
    con.close()
    return r[0] if r else None


def add_commands(sub) -> None:
    from .project import load_project

    def cmd_import(a):
        project = load_project(a.project)
        res = import_rom(a.rom, a.db, project if not a.no_project_edits else
                         type("P", (), {"supported_sha256": project.supported_sha256, "edits": []})())
        print(json.dumps(res, indent=2))
        return 0

    def cmd_edit(a):
        con = connect(a.db)
        set_edit(con, Edit(a.domain, a.id, a.field, a.value, a.reason))
        con.close()
        print(f"edit stored: {a.domain} {a.id} {a.field} = {a.value}")
        return 0

    def cmd_show(a):
        con = connect(a.db)
        for row in con.execute("SELECT * FROM enemy_effective WHERE enemy_id=?", (a.id,)):
            print(row)
        con.close()
        return 0

    s = sub.add_parser("db-import", help="(re)import the enemy table into the SQLite project")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--project", default="project/project.json")
    s.add_argument("--db", default="project/ffl2kster.sqlite")
    s.add_argument("--no-project-edits", action="store_true",
                   help="do not copy edits from project.json into the database")
    s.set_defaults(fn=cmd_import)
    s = sub.add_parser("db-edit", help="store or replace an edit in the SQLite project")
    s.add_argument("domain")
    s.add_argument("id", type=int)
    s.add_argument("field")
    s.add_argument("value", type=int)
    s.add_argument("--reason", default="")
    s.add_argument("--db", default="project/ffl2kster.sqlite")
    s.set_defaults(fn=cmd_edit)
    s = sub.add_parser("db-show", help="show original/effective values for one enemy")
    s.add_argument("id", type=int)
    s.add_argument("--db", default="project/ffl2kster.sqlite")
    s.set_defaults(fn=cmd_show)
