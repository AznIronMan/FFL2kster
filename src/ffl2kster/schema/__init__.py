"""Registry of proven data-domain schemas. Only fields registered here can be edited."""

from __future__ import annotations

from ..project import Edit

DOMAINS: dict = {}


def register(name: str, resolver) -> None:
    DOMAINS[name] = resolver


def resolve_edit(rom: bytes, edit: Edit):
    if edit.domain not in DOMAINS:
        raise ValueError(f"unknown or unproven data domain '{edit.domain}' "
                         f"(known: {sorted(DOMAINS)})")
    return DOMAINS[edit.domain](rom, edit)
