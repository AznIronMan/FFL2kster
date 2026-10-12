"""Random encounters: zones -> formation slots -> formations -> group counts.

Generator 00:2AE6/00:2B14 (verified by controlled changes, docs/FINDINGS.md 2026-10-12):
  zone = map header byte (-> C454); 8 formation bytes at 0D:6570 + 8*zone
  slot = first s with rand(0..255) >= THRESH[s] (7 thresholds at 0D:6560), else slot 7
  formation f = byte & 0x7F at 0D:6C70 + 5*f: [id1, id2, id3, countA, countB];
               countB is used when the slot byte has bit 7 set
  count byte: bits 0-4 = pattern p at 0D:6EF0 + 3*p (one byte per group, nibbles = min/max
              count), bits 6-7 -> CFE9 (unknown; 0 for normal fights)
Results land in CFE0..CFE5 as (count, id) pairs one step before the battle triggers.
"""

from __future__ import annotations

from ..build import Patch

THRESH_OFFSET = 0x36560
ZONE_OFFSET = 0x36570
ZONE_COUNT = 135
FORMATION_OFFSET = 0x36C70
FORMATION_COUNT = 128
COUNT_OFFSET = 0x36EF0
COUNT_PATTERNS = 32


def thresholds(rom: bytes) -> list[int]:
    return list(rom[THRESH_OFFSET:THRESH_OFFSET + 7])


def slot_probabilities(rom: bytes) -> list[float]:
    t = thresholds(rom)
    bounds = [256] + t + [0]
    return [(bounds[s] - bounds[s + 1]) / 256 for s in range(8)]


def count_pattern(rom: bytes, p: int) -> list[tuple[int, int]]:
    o = COUNT_OFFSET + 3 * p
    return [(min(b & 0x0F, b >> 4), max(b & 0x0F, b >> 4)) for b in rom[o:o + 3]]


def formation(rom: bytes, f: int, alt: bool = False) -> dict:
    o = FORMATION_OFFSET + 5 * f
    r = rom[o:o + 5]
    cb = r[4] if alt else r[3]
    counts = count_pattern(rom, cb & 0x1F)
    groups = [{"enemy_id": r[k], "min": counts[k][0], "max": counts[k][1]}
              for k in range(3) if counts[k][1] > 0]
    return {"formation": f, "alt": alt, "count_byte": cb, "flags": cb >> 6, "groups": groups}


def export(rom: bytes, names: dict | None = None) -> dict:
    probs = slot_probabilities(rom)
    zones = []
    for z in range(ZONE_COUNT):
        zl = rom[ZONE_OFFSET + 8 * z:ZONE_OFFSET + 8 * z + 8]
        slots = []
        for s, b in enumerate(zl):
            fm = formation(rom, b & 0x7F, bool(b & 0x80))
            if names:
                for g in fm["groups"]:
                    g["enemy"] = names.get(g["enemy_id"])
            slots.append({"slot": s, "probability": probs[s], **fm})
        zones.append({"zone": z, "slots": slots})
    forms = []
    for f in range(FORMATION_COUNT):
        o = FORMATION_OFFSET + 5 * f
        forms.append({"formation": f, "offset": o, "bytes": list(rom[o:o + 5])})
    return {"thresholds": thresholds(rom), "slot_probabilities": probs, "zones": zones,
            "formations": forms,
            "count_patterns": [count_pattern(rom, p) for p in range(COUNT_PATTERNS)]}


# ---------------------------------------------------------------- edits
FIELDS = {  # field -> (domain, offset function, max id)
    "formation": {"id1": 0, "id2": 1, "id3": 2, "count_a": 3, "count_b": 4},
    "zone": {f"slot{s}": s for s in range(8)},
    "countpattern": {"group1": 0, "group2": 1, "group3": 2},
}


def resolve(rom: bytes, edit) -> list[Patch]:
    dom, f = edit.domain, edit.field
    if f not in FIELDS[dom]:
        raise ValueError(f"unknown {dom} field '{f}' (fields: {sorted(FIELDS[dom])})")
    if not 0 <= edit.value <= 0xFF:
        raise ValueError("value must be a byte")
    if dom == "formation":
        if not 0 <= edit.id < FORMATION_COUNT:
            raise ValueError("formation id out of range")
        off = FORMATION_OFFSET + 5 * edit.id + FIELDS[dom][f]
    elif dom == "zone":
        if not 0 <= edit.id < ZONE_COUNT:
            raise ValueError("zone id out of range")
        off = ZONE_OFFSET + 8 * edit.id + FIELDS[dom][f]
    else:
        if not 0 <= edit.id < COUNT_PATTERNS:
            raise ValueError("count pattern id out of range")
        off = COUNT_OFFSET + 3 * edit.id + FIELDS[dom][f]
    return [Patch(off, bytes([edit.value]),
                  f"{dom} {edit.id} {f} {rom[off]:#04x} -> {edit.value:#04x}" +
                  (f" [{edit.reason}]" if edit.reason else ""))]


def add_commands(sub) -> None:
    import json
    from .. import rom as romlib
    from . import enemies as E

    def cmd(a):
        rom = romlib.load_rom(a.rom)
        names = {r["id"]: r["name"] for r in E.extract(rom)}
        data = export(rom, names)
        data["source_sha256"] = romlib.sha256(rom)
        with open(a.out, "w") as fh:
            json.dump(data, fh, indent=1)
        print(f"wrote {a.out}: {len(data['zones'])} zones, {len(data['formations'])} formations")
        return 0
    s = sub.add_parser("encounters-export", help="export encounter zones/formations")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--out", default="data/encounters.json")
    s.set_defaults(fn=cmd)


from . import register  # noqa: E402

for _d in FIELDS:
    register(_d, resolve)
