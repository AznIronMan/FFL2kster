"""Legend III processed data package (ffl3/data/, local like data/): every proven table decoded to
JSON plus graphics as PNG. Deterministic: `python -m ffl3kster export-all` reproduces it byte for
byte. Raw ROM bytes are not part of it (layouts are decoded metatile maps; record hex dumps are
dropped)."""

from __future__ import annotations

import json
from pathlib import Path

from . import gfx, layout, music, script_text
from . import rom as romlib
from .schema import encounters, items, maps, monsters


def _write(path: Path, obj, indent=1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=indent, ensure_ascii=False, sort_keys=True,
                               separators=None if indent else (",", ":")) + "\n")


def _rows(table, rom):
    out = []
    for r in table.extract(rom):
        r = {k: v for k, v in r.items() if k not in ("raw", "record_offset", "objects", "warps")}
        out.append(r)
    return out


def _fields(table):
    return [{k: v for k, v in f.__dict__.items()} for f in table.FIELDS]


def export_all(rom: bytes, out_dir) -> dict:
    out = Path(out_dir)
    sha = romlib.sha256(rom)
    meta = {"game": "FFL3", "source_sha256": sha}
    for name, mod in (("monsters", monsters), ("items", items), ("encounters", encounters)):
        _write(out / f"{name}.json", {**meta, "tables": {t.DOMAIN: {"fields": _fields(t), "records": _rows(t, rom)}
                                                         for t in mod.TABLES}})
    mp = {t.DOMAIN: {"fields": _fields(t), "records": _rows(t, rom)} for t in maps.TABLES}
    mp["map"]["objects"] = {f"{m:02X}": [o.hex(" ") for o in maps.objects(rom, m)] for m in range(maps.MAP_COUNT)}
    mp["map"]["warps"] = {f"{m:02X}": [w.hex(" ") for w in maps.warps(rom, m)] for m in range(maps.MAP_COUNT)}
    _write(out / "maps.json", {**meta, "tables": mp})
    lays = {}
    for n in range(1, 32):
        i = layout.info(rom, n)
        mm = layout.metatile_map(rom, n)
        w = i["width"] // 2
        lays[f"{n:02d}"] = {"width_tiles": i["width"], "tiles": i["tiles"],
                            "metatile_rows": [mm[w * y:w * (y + 1)].hex() for y in range(len(mm) // w)]}
    _write(out / "layouts.json", {**meta, "layouts": lays,
                                  "patches": {f"{m:02X}": [[f, f"{p:04X}"] for f, p in layout.patches(rom, m)]
                                              for m in range(maps.MAP_COUNT) if layout.patches(rom, m)}})
    _write(out / "text.json", {**meta, **script_text.export(rom)})
    _write(out / "music.json", {**meta, **music.export(rom)}, indent=None)
    g = out / "graphics"
    (g / "monsters").mkdir(parents=True, exist_ok=True)
    (g / "tilesets").mkdir(parents=True, exist_ok=True)
    gfx.render_tiles([gfx.font(rom)[16 * k:16 * k + 16] for k in range(128)], 16).save(g / "font.png", optimize=True)
    seen = set()
    for m in range(maps.MAP_COUNT):
        ts = gfx.map_tileset(rom, m)
        if ts in seen:
            continue
        seen.add(ts)
        gfx.render_tiles([ts[16 * k:16 * k + 16] for k in range(128)], 16).save(
            g / "tilesets" / f"map_{m:02X}.png", optimize=True)
    for mid in range(195):
        if rom[gfx.PIC_CODES + mid] >> 3 == gfx.XAGOR_SHEET:
            continue
        size = rom[gfx.PIC_SHEETS + (rom[gfx.PIC_CODES + mid] >> 3)] & 0x0F
        gfx.render_tiles(gfx.picture(rom, mid), gfx.PIC_COLUMNS[size]).save(
            g / "monsters" / f"{mid:03d}.png", optimize=True)
    files = sorted(str(p.relative_to(out)) for p in out.rglob("*") if p.is_file())
    return {"files": len(files), "source_sha256": sha}
