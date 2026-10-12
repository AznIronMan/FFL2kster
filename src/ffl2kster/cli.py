"""Command-line interface: python -m ffl2kster <command>."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from . import rom as romlib
from .build import BuildError, build, diff_bytes
from .project import load_project


def _int(s: str) -> int:
    return int(s, 0)


def cmd_info(a) -> int:
    data = romlib.load_rom(a.rom)
    hdr = romlib.parse_header(data)
    info = {"path": a.rom, "size": len(data), "sha256": romlib.sha256(data),
            "md5": __import__("hashlib").md5(data).hexdigest(), "header": hdr.to_dict()}
    if a.project:
        p = load_project(a.project)
        info["matches_project"] = info["sha256"] == p.supported_sha256
    print(json.dumps(info, indent=2))
    ok = hdr.header_checksum_ok and hdr.global_checksum_ok and hdr.logo_ok
    if a.project and not info["matches_project"]:
        ok = False
    return 0 if ok else 1


def _load_edits(a, project):
    if getattr(a, "db", None):
        from .db import db_sha, load_edits
        if db_sha(a.db) != project.supported_sha256:
            raise BuildError("database was not imported from the project's supported ROM")
        return load_edits(a.db)
    return None


def cmd_build(a) -> int:
    project = load_project(a.project)
    try:
        report = build(a.rom, project, a.out, a.diff, edits=_load_edits(a, project))
        report_src = "database " + a.db if a.db else "project.json"
        print(f"edits from {report_src}")
    except BuildError as e:
        print(f"build failed: {e}", file=sys.stderr)
        return 2
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
            off = romlib.bank_to_file(int(b, 16), int(ad, 16))
            print(f"{v} -> file {off:#07x}")
        else:
            off = int(v, 0)
            print(f"file {off:#07x} -> {romlib.fmt_loc(off)}")
    return 0


def cmd_dump(a) -> int:
    data = romlib.load_rom(a.rom)
    start, n = a.offset, a.length
    for row in range(start, min(start + n, len(data)), a.width):
        chunk = data[row:min(row + a.width, start + n)]
        print(f"{romlib.fmt_loc(row)}  {chunk.hex(' ').upper()}")
    return 0


def cmd_diff(a) -> int:
    x, y = romlib.load_rom(a.a), romlib.load_rom(a.b)
    rows = diff_bytes(x, y)
    print(json.dumps({"changed_bytes": len(rows), "changes": rows}, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="ffl2kster", description=__doc__)
    ap.add_argument("--version", action="version", version=__version__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("info", help="verify ROM identity and header")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--project", default=None)
    s.set_defaults(fn=cmd_info)

    s = sub.add_parser("build", help="build a patched ROM from the project")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--project", default="project/project.json")
    s.add_argument("--out", default="build/FFL2kster.gb")
    s.add_argument("--diff", default="build/diff-report.json")
    s.add_argument("--db", default=None, help="take edits from a SQLite project database")
    s.set_defaults(fn=cmd_build)

    s = sub.add_parser("offset", help="convert file offset <-> BB:AAAA")
    s.add_argument("values", nargs="+")
    s.set_defaults(fn=cmd_offset)

    s = sub.add_parser("dump", help="hex dump a byte range")
    s.add_argument("offset", type=_int)
    s.add_argument("length", type=_int)
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--width", type=int, default=16)
    s.set_defaults(fn=cmd_dump)

    s = sub.add_parser("diff", help="byte diff two ROMs")
    s.add_argument("a")
    s.add_argument("b")
    s.set_defaults(fn=cmd_diff)

    def cmd_states(a):
        from . import rom as rl
        from .project import load_project
        p = load_project(a.project)
        if rl.sha256(rl.load_rom(a.rom)) != p.supported_sha256:
            print("ROM does not match project's supported ROM", file=sys.stderr)
            return 2
        from .states import make_states
        print(json.dumps(make_states(a.rom, a.out), indent=2))
        return 0

    s = sub.add_parser("make-states", help="regenerate test save states from cold boot (PyBoy)")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--project", default="project/project.json")
    s.add_argument("--out", default="build/states")
    s.set_defaults(fn=cmd_states)

    def cmd_rules(a):
        from . import calcvm, rules
        from . import rom as rl
        rom = rl.load_rom(a.rom)
        out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
        t = rules.export_tables(rom)
        t["source_sha256"] = rl.sha256(rom)
        (out / "rules_tables.json").write_text(json.dumps(t, indent=1) + "\n")
        (out / "calcvm_listing.txt").write_text(
            "# Bank-0C calc VM scripts, decompiled by ffl2kster.calcvm (see docs/BATTLE_RULES.md)\n"
            + calcvm.listing(rom) + "\n")
        print(f"wrote {out}/rules_tables.json and calcvm_listing.txt")
        return 0

    s = sub.add_parser("rules-export", help="export decoded battle/growth/meat rule tables + VM listing")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--out", default="data/battle")
    s.set_defaults(fn=cmd_rules)

    from . import analysis  # noqa: F401  registers analysis subcommands
    analysis.add_commands(sub)
    from .schema import encounters, enemies, items, maps, text
    encounters.add_commands(sub)
    maps.add_commands(sub)
    enemies.add_commands(sub)
    items.add_commands(sub)
    text.add_commands(sub)
    try:
        from . import db
        db.add_commands(sub)
    except ImportError:
        pass

    a = ap.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    raise SystemExit(main())
