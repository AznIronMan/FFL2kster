"""Patch compiler for Legend I: semantic edits -> byte patches on a copy of the ROM.

The byte-level machinery (apply, diff, checksum fix-up) is game-independent and comes from
ffl2kster.build; only the edit schemas are Legend I's own.
"""

from __future__ import annotations

import json
from pathlib import Path

from ffl2kster.build import BuildError, Patch, apply_patches, diff_bytes  # noqa: F401

from . import rom as romlib
from .project import Edit


def compile_edits(rom: bytes, edits: list[Edit]) -> list[Patch]:
    from . import schema
    from .schema import _domains  # noqa: F401  (registers the Legend I domains)
    out: list[Patch] = []
    for e in edits:
        out.extend(schema.resolve_edit(rom, e))
    return out


def build(rom_path, project, out_path, diff_path=None, edits=None) -> dict:
    rom_path, out_path = Path(rom_path), Path(out_path)
    if rom_path.resolve() == out_path.resolve():
        raise BuildError("refusing to write output over the input ROM")
    original = rom_path.read_bytes()
    digest = romlib.sha256(original)
    if digest != project.supported_sha256:
        raise BuildError(f"input ROM sha256 {digest} does not match project's "
                         f"supported ROM {project.supported_sha256}")
    if project.supported_size and len(original) != project.supported_size:
        raise BuildError("input ROM size does not match project")

    edits = project.edits if edits is None else edits
    out, reasons = apply_patches(original, compile_edits(original, edits))
    if out != original:
        romlib.fix_checksums(out)
        for off in (0x14D, 0x14E, 0x14F):
            if out[off] != original[off]:
                reasons.setdefault(off, "cartridge checksum recomputed")
    rows = diff_bytes(original, bytes(out), reasons)
    if any(not r["reason"] for r in rows):
        raise BuildError("changed bytes without a recorded reason")
    hdr = romlib.parse_header(bytes(out))
    if len(out) != len(original):
        raise BuildError("output size changed")
    if not (hdr.header_checksum_ok and hdr.global_checksum_ok and hdr.logo_ok):
        raise BuildError("output ROM failed header/global checksum validation")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(bytes(out))
    report = {
        "game": "FFL1",
        "input": {"path": str(rom_path), "sha256": digest, "size": len(original)},
        "output": {"path": str(out_path), "sha256": romlib.sha256(bytes(out)), "size": len(out),
                   "header_checksum_ok": hdr.header_checksum_ok,
                   "global_checksum_ok": hdr.global_checksum_ok},
        "edits": [e.__dict__ for e in edits],
        "changed_bytes": len(rows),
        "identical": not rows,
        "changes": rows,
    }
    if diff_path:
        Path(diff_path).parent.mkdir(parents=True, exist_ok=True)
        Path(diff_path).write_text(json.dumps(report, indent=2) + "\n")
    return report
