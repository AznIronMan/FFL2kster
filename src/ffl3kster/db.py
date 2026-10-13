"""Legend III SQLite store (ffl3/project/ffl3kster.sqlite).

Same principles as FFL2kster's store, with one generic layout for every domain: extracted
original values carry bank/offset provenance and a verification status, user edits live in their
own table, and `build --db` takes its edits from there. IDs are namespaced per game (meta.game =
'FFL3'), so a future cross-game store can merge them without collisions (direction note D).
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
    domain TEXT NOT NULL, field TEXT NOT NULL, byte_offset INTEGER NOT NULL, size INTEGER NOT NULL,
    encoding TEXT NOT NULL, meaning TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('verified','probable','hypothesis')),
    evidence TEXT NOT NULL, editable INTEGER NOT NULL, min_value INTEGER, max_value INTEGER,
    PRIMARY KEY (domain, field));
CREATE TABLE IF NOT EXISTS records (
    game TEXT NOT NULL DEFAULT 'FFL3', domain TEXT NOT NULL, id INTEGER NOT NULL, name TEXT NOT NULL,
    record_offset INTEGER NOT NULL, bank INTEGER NOT NULL, address INTEGER NOT NULL, extra_json TEXT,
    PRIMARY KEY (domain, id));
CREATE TABLE IF NOT EXISTS fields (
    domain TEXT NOT NULL, id INTEGER NOT NULL, field TEXT NOT NULL, original_value INTEGER NOT NULL,
    source_offset INTEGER NOT NULL, source_bank INTEGER NOT NULL, source_address INTEGER NOT NULL,
    size INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (domain, id, field));
CREATE TABLE IF NOT EXISTS edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, target_id INTEGER NOT NULL,
    field TEXT NOT NULL, value INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL, UNIQUE (domain, target_id, field));
CREATE VIEW IF NOT EXISTS effective AS
    SELECT f.domain, f.id, r.name, f.field, f.original_value,
           COALESCE(x.value, f.original_value) AS effective_value, x.value IS NOT NULL AS edited,
           f.source_bank, f.source_address, f.status
    FROM fields f JOIN records r ON r.domain = f.domain AND r.id = f.id
    LEFT JOIN edits x ON x.domain = f.domain AND x.target_id = f.id AND x.field = f.field;
"""


def connect(path) -> sqlite3.Connection:
    con = sqlite3.connect(str(path))
    mode = os.environ.get("FFL2K_SQLITE_JOURNAL")  # same switch as FFL2kster (sandboxed mounts)
    if mode:
        con.execute(f"PRAGMA journal_mode = {mode}")
    con.executescript(SCHEMA)
    return con


def _domains():
    from .schema import encounters, items, maps, monsters
    return list(monsters.TABLES) + list(items.TABLES) + list(encounters.TABLES) + list(maps.TABLES)


def import_rom(rom_path, db_path, project=None) -> dict:
    rom = romlib.load_rom(rom_path)
    digest = romlib.sha256(rom)
    if project is not None and digest != project.supported_sha256:
        raise ValueError("ROM does not match the project's supported ROM")
    tmp = tempfile.mkdtemp(prefix="ffl3k-db-")
    work, target = Path(tmp) / "work.sqlite", Path(db_path)
    if target.exists() and target.stat().st_size:
        shutil.copyfile(target, work)
    try:
        res = _import_into(rom, digest, work, project)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(work, target)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return res


def _import_into(rom, digest, db_path, project) -> dict:
    con = connect(db_path)
    counts = {}
    with con:
        old = con.execute("SELECT value FROM meta WHERE key='source_sha256'").fetchone()
        if old and old[0] != digest:
            raise ValueError("database was imported from a different ROM")
        for D in _domains():
            for t in ("fields", "records", "field_defs"):
                con.execute(f"DELETE FROM {t} WHERE domain=?", (D.DOMAIN,))
            for f in D.FIELDS:
                con.execute("INSERT INTO field_defs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                            (D.DOMAIN, f.name, f.offset, f.size, f.encoding, f.meaning, f.status,
                             f.evidence, int(f.editable), f.min, f.max))
            n = 0
            for r in D.extract(rom):
                extra = {k: v for k, v in r.items() if k not in ("id", "name", "record_offset", "bank",
                                                               "address", "fields", "raw")}
                con.execute("INSERT INTO records VALUES ('FFL3',?,?,?,?,?,?,?)",
                            (D.DOMAIN, r["id"], r["name"], r["record_offset"], r["bank"], r["address"],
                             json.dumps(extra)))
                for f in D.FIELDS:
                    off = r["record_offset"] + f.offset
                    bank, addr = romlib.file_to_bank(off)
                    con.execute("INSERT INTO fields VALUES (?,?,?,?,?,?,?,?,?)",
                                (D.DOMAIN, r["id"], f.name, r["fields"][f.name], off, bank, addr, f.size,
                                 f.status))
                    n += 1
            counts[D.DOMAIN] = {"records": D.RECORD_COUNT, "fields": n}
        meta = {"game": "FFL3", "source_sha256": digest, "source_size": str(len(rom)),
                "tool_version": __version__, "schema_version": "1",
                "imported_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")}
        for k, v in meta.items():
            con.execute("INSERT OR REPLACE INTO meta VALUES (?,?)", (k, v))
        if project is not None:
            for e in project.edits:
                set_edit(con, e, commit=False)
    n_edits = con.execute("SELECT COUNT(*) FROM edits").fetchone()[0]
    con.close()
    return {"game": "FFL3", "domains": counts, "edits": n_edits, "source_sha256": digest}


def set_edit(con, e: Edit, commit=True) -> None:
    for D in _domains():
        if D.DOMAIN == e.domain:
            f = D.FIELD_BY_NAME.get(e.field)
            if f is None or not f.editable:
                raise ValueError(f"field {e.field} is not editable")
            if not f.min <= int(e.value) <= f.max:
                raise ValueError(f"{e.field}={e.value} outside allowed range {f.min}..{f.max}")
            D.record_offset(e.id)
            break
    else:
        raise ValueError(f"unknown domain {e.domain}")
    con.execute("INSERT INTO edits (domain,target_id,field,value,reason,created_at) VALUES (?,?,?,?,?,?) "
                "ON CONFLICT(domain,target_id,field) DO UPDATE SET value=excluded.value, "
                "reason=excluded.reason, created_at=excluded.created_at",
                (e.domain, e.id, e.field, int(e.value), e.reason,
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
