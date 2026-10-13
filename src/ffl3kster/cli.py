"""Command-line interface: python -m ffl3kster <command> (mirrors ffl2kster's surface)."""

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

ROM = "ffl3/input/original.gb"
PROJECT = "ffl3/project/project.json"
DB = "ffl3/project/ffl3kster.sqlite"


def _int(s: str) -> int:
    return int(s, 0)


def cmd_info(a) -> int:
    data = romlib.load_rom(a.rom)
    hdr = romlib.parse_header(data)
    info = {"game": "FFL3", "path": a.rom, "size": len(data), "sha256": romlib.sha256(data),
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
    ap = argparse.ArgumentParser(prog="ffl3kster", description=__doc__)
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("info", help="verify ROM identity and header")
    s.add_argument("--rom", default=ROM)
    s.add_argument("--project", default=None)
    s.set_defaults(fn=cmd_info)

    s = sub.add_parser("build", help="build a patched ROM from the project")
    s.add_argument("--rom", default=ROM)
    s.add_argument("--project", default=PROJECT)
    s.add_argument("--out", default="ffl3/build/FFL3kster.gb")
    s.add_argument("--diff", default="ffl3/build/diff-report.json")
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
    s.add_argument("--out", default="ffl3/build/states")
    s.set_defaults(fn=cmd_states)

    def cmd_monsters(a):
        from .schema import monsters as M
        rom = romlib.load_rom(a.rom)
        rows = zip(*(t.extract(rom) for t in M.TABLES))
        for r, c, ab in rows:
            v, k = r["fields"], c["fields"]
            boss = "x16" if r["id"] >= M.BOSS_FROM else "   "
            print(f"{r['id']:02X} {r['bank']:02X}:{r['address']:04X} {r['name']:8s} Lv{k['level']:2d} kind {v['kind']} "
                  f"HP {v['hp']:4d}{boss} MP {v['mp']:4d} Atk {v['attack']:3d} Def {v['defence']:3d} Agl {v['agility']:3d} "
                  f"Mag {v['magic']:3d} EXP {k['exp']:3d} abil {ab['raw']}")
        return 0
    s = sub.add_parser("monsters", help="list the monster tables (0B:470D/4A19/533D, names 0E:7533)")
    s.add_argument("--rom", default=ROM)
    s.set_defaults(fn=cmd_monsters)

    def cmd_items(a):
        from .schema import items as I
        rom = romlib.load_rom(a.rom)
        for t in I.TABLES:
            if a.table and t.DOMAIN != a.table:
                continue
            print(f"# {t.DOMAIN}: {t.BANK:02X}:{t.ADDRESS:04X}, {t.RECORD_COUNT} x {t.RECORD_SIZE} bytes")
            for r in t.extract(rom):
                print(f"{r['id']:02X} {r['bank']:02X}:{r['address']:04X} {r['name']:8s} " +
                      " ".join(f"{k}={v}" for k, v in r["fields"].items()))
        return 0
    s = sub.add_parser("items", help="list the spell/weapon/armor/item/skill tables (bank 09)")
    s.add_argument("--rom", default=ROM)
    s.add_argument("--table", choices=["spell", "weapon", "armor", "item", "skill"])
    s.set_defaults(fn=cmd_items)

    def cmd_encounters(a):
        from .schema import encounters as E
        rom = romlib.load_rom(a.rom)
        print("thresholds", rom[E.THRESHOLDS:E.THRESHOLDS + 6].hex(" "), " rates", rom[E.RATES:E.RATES + 8].hex(" "))
        for r in E.ZONE.extract(rom):
            print(f"zone {r['id']:2d} " + " ".join(f"{v:02X}" for v in r["fields"].values()))
        for r in E.FORMATION.extract(rom):
            v = r["fields"]
            print(f"formation {r['id']:02X} {r['name']:32s} flags {v['flags']:02X} counts {v['counts']:02X}")
        return 0
    s = sub.add_parser("encounters", help="list encounter zones and formations")
    s.add_argument("--rom", default=ROM)
    s.set_defaults(fn=cmd_encounters)

    def cmd_text_export(a):
        from pathlib import Path
        from . import script_text as T
        data = T.export(romlib.load_rom(a.rom))
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
        print(f"wrote {a.out}: {len(data['scripts'])} scripts, {len(data['dictionary'])} dictionary entries")
        return 0
    s = sub.add_parser("text-export", help="decode every text script (banks 03, 09, 0A) to JSON")
    s.add_argument("--rom", default=ROM)
    s.add_argument("--out", default="ffl3/build/text.json")
    s.set_defaults(fn=cmd_text_export)

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
    s.add_argument("--db", default=DB)
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
    s.add_argument("id", type=_int)
    s.add_argument("field")
    s.add_argument("value", type=_int)
    s.add_argument("--reason", default="")
    s.add_argument("--db", default=DB)
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
    s.add_argument("id", type=_int)
    s.add_argument("--db", default=DB)
    s.set_defaults(fn=cmd_db_show)

    a = ap.parse_args(argv)
    return a.fn(a)
