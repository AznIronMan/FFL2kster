"""Hashes of the Legend I graphics as decoded by the Python reference (ffl1kster.gfx), for the
TypeScript importer's golden test. Writes ffl1/build/golden/golden.json (ROM-derived, gitignored).

    python tools/ffl1/golden_export.py
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from ffl1kster import gfx  # noqa: E402


def h(b: bytes) -> str:
    return hashlib.sha256(bytes(b)).hexdigest()


def main() -> None:
    rom = (ROOT / "ffl1/input/original.gb").read_bytes()
    out = {
        "font": h(b"".join(gfx.font_tile(rom, c) for c in range(0x80, 0xF7))),
        "tilesets": [h(gfx.tileset(rom, s)) for s in range(gfx.TILESET_COUNT)],
        "sprite_sets": [h(gfx.sprite_set(rom, s)) for s in range(gfx.SPRITE_SET_COUNT)],
        "pictures": [h(gfx.picture(rom, m)["data"]) for m in range(200)],
    }
    p = ROOT / "ffl1/build/golden/golden.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, indent=1) + "\n")
    print(p)


if __name__ == "__main__":
    main()
