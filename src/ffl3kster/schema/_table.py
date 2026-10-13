"""Generic fixed-size record table for the Legend III edit domains.

A table is `count` records of `size` bytes at bank:addr for the ids id_base..id_base+count-1; each
field says where it sits in the record, how it is encoded, what it is believed to mean, and how
well that is established (verified / probable / hypothesis) with its evidence.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from ffl2kster.build import Patch

from .. import rom as romlib


@dataclass(frozen=True)
class FieldDef:
    name: str
    offset: int
    size: int
    encoding: str      # u8 | bits:lo-hi | nibble:hi | nibble:lo | u12 (byte, then the low nibble of the next)
    meaning: str
    status: str        # verified | probable | hypothesis
    evidence: str
    editable: bool = False
    min: int = 0
    max: int = 0xFF


def _bits(spec: str) -> tuple[int, int]:
    lo, hi = spec.split(":")[1].split("-")
    return int(lo), int(hi)


class Table:
    def __init__(self, domain: str, bank: int, addr: int, size: int, count: int,
                 name_fn: Callable[[bytes, int], str], fields: list[FieldDef], doc: str, id_base: int = 0):
        self.DOMAIN, self.BANK, self.ADDRESS = domain, bank, addr
        self.RECORD_SIZE, self.RECORD_COUNT, self.ID_BASE = size, count, id_base
        self.TABLE = romlib.bank_to_file(bank, addr)
        self.END = self.TABLE + size * count
        self.FIELDS = fields
        self.FIELD_BY_NAME = {f.name: f for f in fields}
        self.EDITABLE = {f.name for f in fields if f.editable}
        self.name = name_fn
        self.__doc__ = doc

    @property
    def ids(self) -> range:
        return range(self.ID_BASE, self.ID_BASE + self.RECORD_COUNT)

    def record_offset(self, rid: int) -> int:
        if rid not in self.ids:
            raise ValueError(f"{self.DOMAIN} id {rid:#04x} out of range {self.ID_BASE:#04x}.."
                             f"{self.ID_BASE + self.RECORD_COUNT - 1:#04x}")
        return self.TABLE + self.RECORD_SIZE * (rid - self.ID_BASE)

    def read_field(self, rom: bytes, rid: int, name: str) -> int:
        f = self.FIELD_BY_NAME[name]
        o = self.record_offset(rid) + f.offset
        if f.encoding == "u12":
            return rom[o] | (rom[o + 1] & 0x0F) << 8
        raw = rom[o]
        if f.encoding.startswith("bits:"):
            lo, hi = _bits(f.encoding)
            return (raw >> lo) & ((1 << (hi - lo + 1)) - 1)
        if f.encoding == "nibble:hi":
            return raw >> 4
        if f.encoding == "nibble:lo":
            return raw & 0x0F
        return raw

    def encode_field(self, rom: bytes, rid: int, f: FieldDef, value: int) -> bytes:
        if not f.editable:
            raise ValueError(f"field '{f.name}' is not editable in the current schema")
        if not f.min <= value <= f.max:
            raise ValueError(f"{f.name}={value} outside allowed range {f.min}..{f.max}")
        o = self.record_offset(rid) + f.offset
        if f.encoding == "u12":
            return bytes([value & 0xFF, (rom[o + 1] & 0xF0) | value >> 8])
        if f.encoding.startswith("bits:"):
            lo, hi = _bits(f.encoding)
            mask = ((1 << (hi - lo + 1)) - 1) << lo
            return bytes([(rom[o] & ~mask & 0xFF) | (value << lo)])
        if f.encoding == "nibble:hi":
            return bytes([(rom[o] & 0x0F) | value << 4])
        if f.encoding == "nibble:lo":
            return bytes([(rom[o] & 0xF0) | value])
        return bytes([value])

    def extract(self, rom: bytes) -> list[dict]:
        rows = []
        for rid in self.ids:
            off = self.record_offset(rid)
            bank, addr = romlib.file_to_bank(off)
            rows.append({"id": rid, "name": self.name(rom, rid), "record_offset": off, "bank": bank,
                         "address": addr, "raw": rom[off:off + self.RECORD_SIZE].hex(" "),
                         "fields": {f.name: self.read_field(rom, rid, f.name) for f in self.FIELDS}})
        return rows

    def resolve(self, rom: bytes, edit) -> list[Patch]:
        if edit.field not in self.FIELD_BY_NAME:
            raise ValueError(f"unknown {self.DOMAIN} field '{edit.field}' (editable: {sorted(self.EDITABLE)})")
        f = self.FIELD_BY_NAME[edit.field]
        data = self.encode_field(rom, edit.id, f, int(edit.value))
        old = self.read_field(rom, edit.id, f.name)
        reason = f"{self.DOMAIN} {edit.id:#04x} ({self.name(rom, edit.id)}) {f.name} {old} -> {edit.value}"
        if edit.reason:
            reason += f" [{edit.reason}]"
        return [Patch(self.record_offset(edit.id) + f.offset, data, reason)]
