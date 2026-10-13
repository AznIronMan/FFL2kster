"""Edit domains for Legend III. Each module registers the fields it has evidence for."""

from __future__ import annotations

from typing import Callable

from ffl2kster.project import Edit

RESOLVERS: dict[str, Callable] = {}


def register(domain: str):
    def deco(fn):
        RESOLVERS[domain] = fn
        return fn
    return deco


def resolve_edit(rom: bytes, e: Edit):
    if e.domain not in RESOLVERS:
        raise ValueError(f"unknown edit domain {e.domain!r} (Legend III domains: {sorted(RESOLVERS)})")
    return RESOLVERS[e.domain](rom, e)
