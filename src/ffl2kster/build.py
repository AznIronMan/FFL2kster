"""Patch compiler: apply schema-understood edits to a copy of the ROM."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from . import rom as romlib
from .project import Edit


class BuildError(Exception):
    pass


@dataclass
class Patch:
    offset: int
    data: bytes
    reason: str


def compile_edits(rom: bytes, edits: list[Edit]) -> list[Patch]:
    """Translate semantic edits to byte patches using the registered schemas."""
    from .schema import resolve_edit  # local import: schemas may import build helpers
    from .schema import encounters, enemies, items, text  # noqa: F401  (registers domains)

    patches: list[Patch] = []
    for e in edits:
        patches.extend(resolve_edit(rom, e))
    return patches


def apply_patches(original: bytes, patches: list[Patch]) -> tuple[bytearray, dict[int, str]]:
    out = bytearray(original)
    reasons: dict[int, str] = {}
    for p in patches:
        if p.offset < 0 or p.offset + len(p.data) > len(out):
            raise BuildError(f"patch out of range at {p.offset:#x}")
        for i, b in enumerate(p.data):
            off = p.offset + i
            if off in reasons and out[off] != b:
                raise BuildError(f"conflicting edits at {romlib.fmt_loc(off)}: "
                                 f"'{reasons[off]}' vs '{p.reason}'")
            out[off] = b
            reasons[off] = p.reason
    return out, reasons


def diff_bytes(a: bytes, b: bytes, reasons: dict[int, str] | None = None) -> list[dict]:
    if len(a) != len(b):
        raise BuildError(f"size mismatch: {len(a)} vs {len(b)}")
    reasons = reasons or {}
    rows = []
    for off in range(len(a)):
        if a[off] != b[off]:
            bank, addr = romlib.file_to_bank(off)
            rows.append({
                "offset": off, "offset_hex": f"{off:#07x}", "bank": bank,
                "address": f"{addr:04X}", "old": a[off], "new": b[off],
                "old_hex": f"{a[off]:02X}", "new_hex": f"{b[off]:02X}",
                "reason": reasons.get(off),
            })
    return rows


def build(rom_path: str | Path, project, out_path: str | Path,
          diff_path: str | Path | None = None, edits: list[Edit] | None = None) -> dict:
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
    patches = compile_edits(original, edits)
    out, reasons = apply_patches(original, patches)

    if out != original:
        before = bytes(out)
        romlib.fix_checksums(out)
        for off in (0x14D, 0x14E, 0x14F):
            if out[off] != original[off] or before[off] != out[off]:
                reasons.setdefault(off, "cartridge checksum recomputed")

    rows = diff_bytes(original, bytes(out), reasons)
    unexplained = [r for r in rows if not r["reason"]]
    if unexplained:
        raise BuildError(f"{len(unexplained)} changed bytes have no recorded reason")

    hdr = romlib.parse_header(bytes(out))
    if len(out) != len(original):
        raise BuildError("output size changed")
    if not (hdr.header_checksum_ok and hdr.global_checksum_ok and hdr.logo_ok):
        raise BuildError("output ROM failed header/global checksum validation")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(bytes(out))
    report = {
        "input": {"path": str(rom_path), "sha256": digest, "size": len(original)},
        "output": {"path": str(out_path), "sha256": romlib.sha256(bytes(out)), "size": len(out),
                   "header_checksum_ok": hdr.header_checksum_ok,
                   "global_checksum_ok": hdr.global_checksum_ok},
        "edits": [e.__dict__ for e in edits],
        "changed_bytes": len(rows),
        "identical": len(rows) == 0,
        "changes": rows,
    }
    if diff_path:
        Path(diff_path).parent.mkdir(parents=True, exist_ok=True)
        Path(diff_path).write_text(json.dumps(report, indent=2) + "\n")
    return report
