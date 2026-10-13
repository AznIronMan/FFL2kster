"""Command-line interface: python -m ffl1kster <command> (mirrors ffl2kster's surface)."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys

from ffl2kster.analysis import find_all, relative_search

from . import __version__
from . import rom as romlib
from .build import BuildError, build, diff_bytes
from .project import load_project

ROM = "ffl1/input/original.gb"
PROJECT = "ffl1/project/project.json"


def _int(s: str) -> int:
    return int(s, 0)


def cmd_info(a) -> int:
    data = romlib.load_rom(a.rom)
    hdr = romlib.parse_header(data)
    info = {"game": "FFL1", "path": a.rom, "size": len(data), "sha256": romlib.sha256(data),
            "sha1": hashlib.sha1(data).hexdigest(), "md5": hashlib.md5(data).hexdigest(),
            "header": hdr.to_dict()}
    if a.project:
        info["matches_project"] = info["sha256"] == load_project(a.project).supported_sha256
    print(json.dumps(info, indent=2))
    ok = hdr.header_checksum_ok and hdr.global_checksum_ok and hdr.logo_ok
    return 0 if ok and info.get("matches_project", True) else 1


def cmd_build(a) -> int:
    project = load_project(a.project)
    edits = None
    if a.db:
        from .db import db_sha, load_edits
        if db_sha(a.db) != project.supported_sha256:
            print("build failed: database was not imported from the project's ROM", file=sys.stderr)
            return 2
        edits = load_edits(a.db)
    try:
        report = build(a.rom, project, a.out, a.diff, edits=edits)
    except BuildError as e:
        print(f"build failed: {e}", file=sys.stderr)
        return 2
    print(f"edits from {'database ' + a.db if a.db else 'project.json'}")
    print(f"built {a.out}: {report['changed_bytes']} changed bytes"
          f"{' (byte-identical)' if report['identical'] else ''}")
    for r in report["changes"]:
        print(f"  {r['offset_hex']} {r['bank']:02X}:{r['address']} "
              f"{r['old_hex']} -> {r['new_hex']}  {r['reason']}")
    return 0


def cmd_offset(a) -> int:
    for v in a.values:
        if ":" in v:
            b, ad = v.split(":")
            print(f"{v} -> file {romlib.bank_to_file(int(b, 16), int(ad, 16)):#07x}")
        else:
            print(f"file {int(v, 0):#07x} -> {romlib.fmt_loc(int(v, 0))}")
    return 0


def cmd_dump(a) -> int:
    data = romlib.load_rom(a.rom)
    for row in range(a.offset, min(a.offset + a.length, len(data)), a.width):
        chunk = data[row:min(row + a.width, a.offset + a.length)]
        print(f"{romlib.fmt_loc(row)}  {chunk.hex(' ').upper()}")
    return 0


def cmd_diff(a) -> int:
    rows = diff_bytes(romlib.load_rom(a.a), romlib.load_rom(a.b))
    print(json.dumps({"changed_bytes": len(rows), "changes": rows}, indent=2))
    return 0


def cmd_find(a) -> int:
    data = romlib.load_rom(a.rom)
    for off in find_all(data, bytes.fromhex(a.hex)):
        print(romlib.fmt_loc(off))
    return 0


def cmd_relsearch(a) -> int:
    data = romlib.load_rom(a.rom)
    for off, base in relative_search(data, a.word):
        print(f"{romlib.fmt_loc(off)}  'A' = {base:#04x}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ffl1kster", description=__doc__)
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("info", help="verify ROM identity and header")
    s.add_argument("--rom", default=ROM)
    s.add_argument("--project", default=None)
    s.set_defaults(fn=cmd_info)

    s = sub.add_parser("build", help="build a patched ROM from the project")
    s.add_argument("--rom", default=ROM)
    s.add_argument("--project", default=PROJECT)
    s.add_argument("--out", default="ffl1/build/FFL1kster.gb")
    s.add_argument("--diff", default="ffl1/build/diff-report.json")
    s.add_argument("--db", default=None, help="take edits from the SQLite store instead")
    s.set_defaults(fn=cmd_build)

    s = sub.add_parser("offset", help="convert file offset <-> BB:AAAA")
    s.add_argument("values", nargs="+")
    s.set_defaults(fn=cmd_offset)

    s = sub.add_parser("dump", help="hex dump a byte range")
    s.add_argument("offset", type=_int)
    s.add_argument("length", type=_int)
    s.add_argument("--width", type=int, default=16)
    s.add_argument("--rom", default=ROM)
    s.set_defaults(fn=cmd_dump)

    s = sub.add_parser("diff", help="byte diff two ROMs")
    s.add_argument("a")
    s.add_argument("b")
    s.set_defaults(fn=cmd_diff)

    s = sub.add_parser("find", help="find a hex byte string")
    s.add_argument("hex")
    s.add_argument("--rom", default=ROM)
    s.set_defaults(fn=cmd_find)

    s = sub.add_parser("relsearch", help="relative text search (letters contiguous, ascending)")
    s.add_argument("word")
    s.add_argument("--rom", default=ROM)
    s.set_defaults(fn=cmd_relsearch)

    def cmd_states(a):
        from .states import make_states
        make_states(a.rom, a.out)
        return 0
    s = sub.add_parser("make-states", help="regenerate test save states from cold boot (PyBoy)")
    s.add_argument("--rom", default=ROM)
    s.add_argument("--out", default="ffl1/build/states")
    s.set_defaults(fn=cmd_states)

    def cmd_monsters(a):
        from .schema import monsters as M
        rom = romlib.load_rom(a.rom)
        for r in M.extract(rom):
            v = r["fields"]
            print(f"{r['id']:3d} {r['bank']:02X}:{r['address']:04X} {r['name']:8s} HP~{r['base_hp']:5d} "
                  f"Str {v['str']:3d} Def {v['def']:3d} Agl {v['agl']:3d} Mana {v['mana']:3d} "
                  f"abil {' '.join(f'{x:02X}' for x in r['abilities'])}")
        return 0
    s = sub.add_parser("monsters", help="list the monster table (06:6AE8)")
    s.add_argument("--rom", default=ROM)
    s.set_defaults(fn=cmd_monsters)

    def cmd_db_import(a):
        from .db import import_rom
        p = load_project(a.project)
        if a.no_project_edits:
            p.edits = []
        print(json.dumps(import_rom(a.rom, a.db, p), indent=2))
        return 0
    s = sub.add_parser("db-import", help="(re)import proven tables into the SQLite store")
    s.add_argument("--rom", default=ROM)
    s.add_argument("--project", default=PROJECT)
    s.add_argument("--db", default="ffl1/project/ffl1kster.sqlite")
    s.add_argument("--no-project-edits", action="store_true")
    s.set_defaults(fn=cmd_db_import)

    def cmd_db_edit(a):
        from .db import connect, set_edit
        from .project import Edit
        con = connect(a.db)
        set_edit(con, Edit(a.domain, a.id, a.field, a.value, a.reason))
        con.close()
        print(f"edit stored: {a.domain} {a.id} {a.field} = {a.value}")
        return 0
    s = sub.add_parser("db-edit", help="store or replace an edit in the SQLite store")
    s.add_argument("domain")
    s.add_argument("id", type=int)
    s.add_argument("field")
    s.add_argument("value", type=int)
    s.add_argument("--reason", default="")
    s.add_argument("--db", default="ffl1/project/ffl1kster.sqlite")
    s.set_defaults(fn=cmd_db_edit)

    def cmd_db_show(a):
        from .db import connect
        con = connect(a.db)
        for row in con.execute("SELECT * FROM effective WHERE domain=? AND id=?", (a.domain, a.id)):
            print(row)
        con.close()
        return 0
    s = sub.add_parser("db-show", help="original/effective values for one record")
    s.add_argument("domain")
    s.add_argument("id", type=int)
    s.add_argument("--db", default="ffl1/project/ffl1kster.sqlite")
    s.set_defaults(fn=cmd_db_show)

    a = ap.parse_args(argv)
    return a.fn(a)
