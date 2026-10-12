"""Project manifest (project.json) loading and validation."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Edit:
    domain: str
    id: int
    field: str
    value: int
    reason: str = ""

    @classmethod
    def from_dict(cls, d: dict) -> "Edit":
        missing = {"domain", "id", "field", "value"} - d.keys()
        if missing:
            raise ValueError(f"edit missing keys: {sorted(missing)}: {d}")
        return cls(d["domain"], int(d["id"]), d["field"], int(d["value"]), d.get("reason", ""))


@dataclass
class Project:
    path: Path
    name: str
    supported_sha256: str
    supported_size: int
    edits: list[Edit] = field(default_factory=list)
    database: str | None = None
    raw: dict = field(default_factory=dict)

    @property
    def root(self) -> Path:
        return self.path.parent


def load_project(path: str | Path) -> Project:
    path = Path(path)
    data = json.loads(path.read_text())
    rom = data.get("supported_rom") or {}
    if "sha256" not in rom:
        raise ValueError("project.json: supported_rom.sha256 is required")
    return Project(
        path=path,
        name=data.get("name", "FFL2kster"),
        supported_sha256=rom["sha256"].lower(),
        supported_size=int(rom.get("size", 0)),
        edits=[Edit.from_dict(e) for e in data.get("edits", [])],
        database=data.get("database"),
        raw=data,
    )
