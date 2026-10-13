"""Legend I maps, events, warps and shops (docs/ffl1/FINDINGS.md, M5).

Map table 02:58D0: 200 pointers to variable-length records (02:5A60-62D8), read by the warp
routine 00:22CC / 00:231B:
  b0 -> FFF8, b1 -> FFF9, b2 = graphics set (C5B9, 02:4820 table), b3 = attribute set (C5C9,
  metatile attributes 02:4840 + 64*b3 -> DF80), b4-b5 = layout pointer (bank 03, layout.py),
  b6 = flags B (C5E2), b7 -> FFE0, then [if B bit 7 clear: sprite set (FFFA, 02:5240 + 6*n) and
  the event list pointer (FFFB/FFFC, bank 02)], then up to three encounter zone slots C5C3-C5C5
  (one byte each unless B bit 6 / 5 / 4 is set). Map ids below 0x18 count as tower floors.
Event list (00:2586): byte 0 = object count (max 16), then entries until 0x81:
  normal: flag, range (object present while flag value is in [high nibble, low nibble)), x, y,
          command, parameter, sprite/attributes                                  (7 bytes)
  0x80-0xFE except 0x81: the previous object again at x = byte 1, y = byte 2 & 0x3F (3 bytes)
  0xFF: bit-flag test byte, then x, y, command, parameter, sprite              (7 bytes)
Event commands (C3A9 low nibble, parameter C3AA, executor 00:16E0): 0-2 dialogue N = cmd*256 +
param (table 05:7B10 + 2N, i.e. 05:7B30 entry N-16), 3 chest, 4 facility (F0 inn, F1 house of
life, F2+ guild/others, else shop index), 5/6 warp (index param or 256+param; FF = back), 8 battle.
Warps 02:52D0: 474 x (map, x, y), ending where the first event lists start (02:585E).
Shops: 05:7D10 + 10*shop, item ids (FF = empty); prices 05:7E10 + 3*item, BCD.
Metatile attributes (e, d): e bit 6 = blocked event tile, e & 0xB0 = free, e bits 5/6 + low nibble
= touch command with parameter d; otherwise d's low bits block per movement mode (00:1538); the
top two bits of d pick the encounter zone slot (probable).
"""

from __future__ import annotations

from .. import rom as romlib
from ..layout import decode as decode_layout

MAP_TABLE = romlib.bank_to_file(0x02, 0x58D0)
MAP_COUNT = 200
WARPS = romlib.bank_to_file(0x02, 0x52D0)
WARP_COUNT = 474          # 02:52D0-585D; event lists follow (585E, 58B8, ...)
ATTRIBUTES = romlib.bank_to_file(0x02, 0x4840)
SHOPS = romlib.bank_to_file(0x05, 0x7D10)
SHOP_SLOTS, SHOP_COUNT = 10, 25
PRICES = romlib.bank_to_file(0x05, 0x7E10)
PRICE_COUNT = (0x8000 - 0x7E10) // 3   # 165 items have a price slot in bank 05
COMMANDS = {0: "dialogue", 1: "dialogue", 2: "dialogue", 3: "chest", 4: "facility", 5: "warp",
            6: "warp", 8: "battle"}


def _w(rom, o):
    return rom[o] | rom[o + 1] << 8


def record_offset(rom: bytes, mid: int) -> int:
    return romlib.bank_to_file(0x02, _w(rom, MAP_TABLE + 2 * mid))


def parse_record(rom: bytes, mid: int) -> dict:
    o = record_offset(rom, mid)
    i = o
    r = {"id": mid, "record_offset": o, "b0": rom[i], "b1": rom[i + 1], "graphics": rom[i + 2],
         "attributes": rom[i + 3], "layout": _w(rom, i + 4), "flags": rom[i + 6], "b7": rom[i + 7]}
    i += 8
    B = r["flags"]
    if not B & 0x80:
        r["sprites"] = rom[i]
        r["events"] = _w(rom, i + 1)
        i += 3
    zones = []
    for bit in (0x40, 0x20, 0x10):
        if B & bit:
            zones.append(None)
        else:
            zones.append(rom[i]); i += 1
    r["zones"] = zones
    r["length"] = i - o
    return r


def parse_events(rom: bytes, pointer: int) -> list[dict]:
    o = romlib.bank_to_file(0x02, pointer)
    out, i = [], o + 1
    while rom[i] != 0x81:
        b = rom[i]
        if b == 0xFF:
            e = rom[i:i + 7]
            out.append({"kind": "bitflag", "flag": e[1], "x": e[2], "y": e[3], "command": e[4],
                        "param": e[5], "sprite": e[6]})
            i += 7
        elif b & 0x80:
            out.append({"kind": "copy", "x": rom[i + 1], "y": rom[i + 2] & 0x3F, "bits": rom[i + 2] >> 6})
            i += 3
        else:
            e = rom[i:i + 7]
            out.append({"kind": "object", "flag": e[0], "range": (e[1] >> 4, e[1] & 15), "x": e[2], "y": e[3],
                        "command": e[4], "param": e[5], "sprite": e[6]})
            i += 7
    return out


def warp(rom: bytes, n: int) -> dict:
    m, x, y = rom[WARPS + 3 * n:WARPS + 3 * n + 3]
    return {"id": n, "map": m, "x": x, "y": y}


def shop(rom: bytes, s: int) -> list[int]:
    return [b for b in rom[SHOPS + SHOP_SLOTS * s:SHOPS + SHOP_SLOTS * (s + 1)] if b != 0xFF]


def price(rom: bytes, item: int) -> int | None:
    if item >= PRICE_COUNT:
        return None
    return int(rom[PRICES + 3 * item:PRICES + 3 * item + 3].hex())


def attributes(rom: bytes, aset: int) -> list[tuple[int, int]]:
    o = ATTRIBUTES + 64 * aset
    return [(rom[o + 2 * t], rom[o + 2 * t + 1]) for t in range(32)]


def extract(rom: bytes) -> dict:
    maps = []
    for mid in range(MAP_COUNT):
        r = parse_record(rom, mid)
        if "events" in r:
            r["event_list"] = parse_events(rom, r["events"])
        maps.append(r)
    return {"maps": maps, "warps": [warp(rom, n) for n in range(WARP_COUNT)],
            "shops": [shop(rom, s) for s in range(SHOP_COUNT)],
            "prices": {i: price(rom, i) for i in range(PRICE_COUNT)},
            "layouts": {f"{p:04X}": decode_layout(rom, p).hex() for p in sorted({m["layout"] for m in maps})}}
