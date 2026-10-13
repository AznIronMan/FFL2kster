"""Legend I random encounters (verified 2026-10-12, docs/ffl1/FINDINGS.md, M4).

Per step (00:2266): zone = C5C2[top two bits of the metatile's attribute] (four zone slots per
map); zone record 06:6400 + 8*zone = rate, then 7 area ids. Encounter if rand(0..e) == 0 with
e = (C5B3 - 1)*8 + rate (capped at 255). Then rand(0..255) against 80 40 20 10 08 04 00 (00:22B5)
picks area slot 1..7 (weights 1/2, 1/4, ... 1/64, 1/128); the area id goes to C3AA with event
command 8 (battle, 00:1BBE -> FFBD). Area id bit 7 selects the area's alternate formation.
Area record 06:6868 + 5*area: 3 monster ids (groups 1-3), formation, alternate formation (bit 7 of
the formation byte increments D3E6). Formation 06:72C4 + 3*f: per group, high nibble = minimum,
low nibble = maximum count.
Fixed battles use the same command 8 from event scripts.
"""

from __future__ import annotations

from .. import rom as romlib

ZONES = romlib.bank_to_file(0x06, 0x6400)
ZONE_SIZE, ZONE_COUNT = 8, 141           # 06:6400-6867 (the area table follows)
AREAS = romlib.bank_to_file(0x06, 0x6868)
AREA_SIZE, AREA_COUNT = 5, 128
FORMATIONS = romlib.bank_to_file(0x06, 0x72C4)
FORMATION_SIZE, FORMATION_COUNT = 3, 31
SLOT_THRESHOLDS = (0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x00)   # 00:22B5


def zone(rom: bytes, z: int) -> dict:
    r = rom[ZONES + ZONE_SIZE * z:ZONES + ZONE_SIZE * (z + 1)]
    return {"id": z, "rate": r[0], "areas": list(r[1:8])}


def area(rom: bytes, a: int) -> dict:
    r = rom[AREAS + AREA_SIZE * a:AREAS + AREA_SIZE * (a + 1)]
    return {"id": a, "monsters": list(r[:3]), "formation": r[3], "alt_formation": r[4]}


def formation(rom: bytes, f: int) -> list[tuple[int, int]]:
    r = rom[FORMATIONS + FORMATION_SIZE * f:FORMATIONS + FORMATION_SIZE * (f + 1)]
    return [(b >> 4, b & 15) for b in r]


def slot_weights() -> list[float]:
    """Probability of each of the 7 area slots for rand(0..255) >= threshold."""
    w, prev = [], 256
    for t in SLOT_THRESHOLDS:
        w.append((prev - t) / 256)
        prev = t
    return w


def encounter_groups(rom: bytes, area_id: int) -> list[dict]:
    a = area(rom, area_id & 0x7F)
    f = (a["alt_formation"] if area_id & 0x80 else a["formation"]) & 0x1F
    return [{"monster": m, "min": lo, "max": hi} for m, (lo, hi) in zip(a["monsters"], formation(rom, f))]


def extract(rom: bytes) -> dict:
    return {"zones": [zone(rom, z) for z in range(ZONE_COUNT)],
            "areas": [area(rom, a) for a in range(AREA_COUNT)],
            "formations": [formation(rom, f) for f in range(FORMATION_COUNT)],
            "slot_weights": slot_weights()}
