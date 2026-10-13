"""Hashes of the Legend III graphics and map buffers as decoded by the Python reference
(ffl3kster.gfx / ffl3kster.layout), for the TypeScript importer's golden test. Writes
ffl3/build/golden/golden.json (ROM-derived, gitignored).

    python tools/ffl3/golden_export.py
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from ffl3kster import gfx, layout  # noqa: E402
from ffl3kster.schema.maps import MAP_COUNT  # noqa: E402


def h(b: bytes) -> str:
    return hashlib.sha256(bytes(b)).hexdigest()


def _map(rom: bytes, m: int, flags: bytes):
    try:
        tiles, width = layout.map_tiles(rom, m, flags)
    except ValueError:
        return None
    return [h(tiles), width]


def main() -> None:
    rom = (ROOT / "ffl3/input/original.gb").read_bytes()
    pics = {}
    for mid in range(195):
        if rom[gfx.PIC_CODES + mid] >> 3 != gfx.XAGOR_SHEET:
            pics[mid] = h(b"".join(gfx.picture(rom, mid)))
    out = {
        "font": h(gfx.font(rom)),
        "tilesets": [h(gfx.map_tileset(rom, m)) for m in range(MAP_COUNT)],
        "pictures": {str(k): v for k, v in pics.items()},
        "tilemaps": [h(layout.tilemap(rom, n)) for n in range(1, 32)],
        "maps_no_flags": [_map(rom, m, bytes(32)) for m in range(MAP_COUNT)],
        "maps_all_flags": [_map(rom, m, b"\xff" * 32) for m in range(MAP_COUNT)],
    }
    p = ROOT / "ffl3/build/golden/golden.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, indent=1) + "\n")
    print(p)


if __name__ == "__main__":
    main()
