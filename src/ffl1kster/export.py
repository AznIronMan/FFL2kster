"""Legend I processed data package (ffl1/data/): every proven table decoded to JSON plus the
graphics as PNG. Deterministic: `python -m ffl1kster export-all` reproduces ffl1/data/ byte for byte.
Raw ROM bytes are not part of it (layouts are kept as decoded metatile grids)."""

from __future__ import annotations

import json
from pathlib import Path

from . import gfx, music, script_text
from . import rom as romlib
from .schema import encounters, items, maps, meat, monsters


def _write(path: Path, obj, indent=1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=indent, ensure_ascii=False, sort_keys=True,
                               separators=None if indent else (",", ":")) + "\n")


def export_all(rom: bytes, out_dir) -> dict:
    out = Path(out_dir)
    sha = romlib.sha256(rom)
    meta = {"game": "FFL1", "source_sha256": sha}
    mons = monsters.extract(rom)
    for r in mons:
        r.pop("record_offset", None)
    _write(out / "monsters.json", {**meta, "fields": [f.__dict__ for f in monsters.FIELDS], "records": mons})
    its = items.extract(rom)
    _write(out / "items.json", {**meta, "fields": [f.__dict__ for f in items.FIELDS], "records": its})
    _write(out / "encounters.json", {**meta, **encounters.extract(rom)})
    _write(out / "meat.json", {**meta, **meat.extract(rom)})
    _write(out / "text.json", {**meta, **script_text.export(rom)})
    m = maps.extract(rom)
    # layouts: 62 rows of 64 metatile ids, each row as a hex string
    m["layouts"] = {k: [v[128 * y:128 * (y + 1)] for y in range(62)] for k, v in m["layouts"].items()}
    m["attribute_sets"] = [maps.attributes(rom, a) for a in range(40)]
    _write(out / "maps.json", {**meta, **m})
    _write(out / "music.json", {**meta, "durations": music.durations(rom),
                                "songs": [music.song(rom, s) for s in range(music.SONG_COUNT)]}, indent=None)
    g = out / "graphics"
    (g / "monsters").mkdir(parents=True, exist_ok=True)
    (g / "tilesets").mkdir(parents=True, exist_ok=True)
    (g / "sprites").mkdir(parents=True, exist_ok=True)
    gfx.tiles_to_image(b"".join(gfx.font_tile(rom, c) for c in range(0x80, 0xF7)), 16).save(g / "font.png", optimize=True)
    for s in range(gfx.TILESET_COUNT):
        gfx.tiles_to_image(gfx.tileset(rom, s), 16).save(g / "tilesets" / f"{s:02d}.png", optimize=True)
    for s in range(gfx.SPRITE_SET_COUNT):
        gfx.tiles_to_image(gfx.sprite_set(rom, s), 16).save(g / "sprites" / f"{s:02d}.png", optimize=True)
    pics = []
    for mid in range(200):
        p = gfx.picture(rom, mid)
        gfx.tiles_to_image(p["data"], p["width"]).save(g / "monsters" / f"{mid:03d}.png", optimize=True)
        pics.append({k: p[k] for k in ("class", "index", "tiles", "width")})
    _write(out / "graphics" / "pictures.json", {**meta, "pictures": pics})
    files = sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file())
    return {"files": len(files), "source_sha256": sha}
