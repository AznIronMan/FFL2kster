"""Maps: destination (warp) records, map headers, triggers and layouts.

Evidence (docs/FINDINGS.md 2026-10-12 maps):
- Destination records 07:4000 + 4*i (511): [header ptr lo, hi, X|facing<<6, Y|flags]; the
  loader 00:1C61 sets player X = (b2 & 0x3F) - 5, facing = b2 >> 6, Y = (b3 & 0x3F) - 4,
  b3 bit 6 -> C44D, bit 7 -> sound 0x16. Warp index i comes from C442/C443:
  i = C442 + 256 * ((C443 & 1) ^ 1); C443 = 0x0E selects a second table at 07:6F80.
- Map header (bank 07, parsed by 00:1CAF/1CC4): [layout ptr lo, hi][b2][flags]
  [zone, rate if flags & 0x40][L][L x (dest lo, dest hi-flags)] ... ; flags low nibble -> C451,
  bit 7 -> C452, bits 4-5 -> C456.
- Layout pointer: high byte < 0x40 -> bank 08 at 0x4000+ptr, else bank 09 at ptr; drawn by the
  command interpreter 00:2253 into the 64x64 buffer D000-DFFF (1 byte per metatile).
- Buffer values: 0x00-0x3F metatile (tiles 4m..4m+3 TL,TR,BL,BR); 0x40+k = trigger k of the
  header list; bit 7 set = door mat / special tile (hypothesis).
- Trigger (b0, b1) and object (message, attr & 0x0F) are both events (arg, kind) dispatched by
  00:3924: kind 0 story script, 1 field message, 4 shop, 5/6 warp, 7 music, 9/0B chest item,
  0A MAGI, 0C/0D warp + save return, 0E alt warp (events.event, docs/EVENTS.md).
"""

from __future__ import annotations

from .. import rom as romlib

DEST_OFFSET = 0x1C000
DEST_COUNT = 511
ALT_DEST_OFFSET = 0x1EF80     # 07:6F80


def dest_record(rom: bytes, i: int, alt: bool = False) -> dict:
    o = (ALT_DEST_OFFSET if alt else DEST_OFFSET) + 4 * i
    r = rom[o:o + 4]
    return {"index": i, "alt": alt, "offset": o, "header": r[0] | r[1] << 8,
            "x": (r[2] & 0x3F) - 5, "facing": r[2] >> 6, "y": (r[3] & 0x3F) - 4,
            "flag6": bool(r[3] & 0x40), "sound": bool(r[3] & 0x80),
            "map_x": r[2] & 0x3F, "map_y": r[3] & 0x3F}


def _event(kind: int, arg: int) -> dict:
    from ..events import event
    return event(kind, arg)


def resolve_trigger(b0: int, b1: int) -> dict:
    """Destination-record index for warp kinds (b1 = 5/6/0C/0D; 0E = alt table). Other kinds
    are not warps (see events.event); the index is kept for reference only."""
    if b1 == 0x0E:
        return {"alt": True, "index": b0}
    return {"alt": False, "index": b0 + 256 * ((b1 & 1) ^ 1), "flags": b1}


def header(rom: bytes, ptr: int) -> dict:
    o = 0x1C000 + ptr - 0x4000
    r = rom[o:o + 64]
    lp = r[0] | r[1] << 8
    flags = r[3]
    i = 4
    zone = rate = None
    if flags & 0x40:
        zone, rate = r[4], r[5]
        i = 6
    L = r[i]
    trig = []
    for k in range(L):
        b0, b1 = r[i + 1 + 2 * k], r[i + 2 + 2 * k]
        trig.append({"tile": 0x40 + k, "b0": b0, "b1": b1, **resolve_trigger(b0, b1),
                     "event": _event(b1, b0)})
    if lp < 0x4000:
        lbank, laddr = 0x08, 0x4000 + lp
    else:
        lbank, laddr = 0x09, lp
    return {"header": ptr, "offset": o, "layout_ptr": lp, "layout_bank": lbank,
            "layout_address": laddr, "layout_offset": romlib.bank_to_file(lbank, laddr),
            "b2": r[2], "tileset": r[2], "flags": flags,
            # C451: metatiles 3..3+n-1 become trigger tiles 0x40+k at load (00:2647; probable)
            "trigger_metatiles": flags & 0x0F, "flag7": bool(flags & 0x80),
            "encounters": bool(flags & 0x40), "field_4_5": (flags >> 4) & 3,
            "zone": zone, "rate": rate, "triggers": trig,
            "tail_offset": o + i + 1 + 2 * L}


def objects(rom: bytes, hd: dict) -> dict:
    """Sprite list + NPC records following the trigger list (parsers 00:363F and 00:3397)."""
    o = hd["tail_offset"]
    sprites = []
    while len(sprites) < 6 and rom[o] != 0xFF:
        sprites.append(rom[o]); o += 1
    if len(sprites) < 6:
        o += 1                      # FF terminator (absent when 6 sprites are listed)
    npcs = []
    while rom[o] != 0xFF and len(npcs) < 64:
        r = rom[o:o + 6]
        if r[0] == 0x80:
            cond = {"type": "flag", "flag": r[1]}
        else:
            cond = {"type": "progress", "var": r[0] & 0x1F, "min": r[1] >> 4, "max": r[1] & 0x0F,
                    "bit6": bool(r[0] & 0x40)}
        npcs.append({"offset": o, "raw": r.hex(), "condition": cond, "x": r[2] & 0x3F,
                     "y": r[3] & 0x3F, "y_flags": r[3] >> 6, "message": r[4],
                     "sprite_slot": (r[5] >> 4) & 7, "x_flag": r[5] >> 7, "kind": r[5] & 0x0F,
                     "event": _event(r[5] & 0x0F, r[4])})
        o += 6
    return {"sprites": sprites, "npcs": npcs, "end_offset": o + 1}


TILE_ATTR = 0x1F000   # 07:7000 + 32*tileset (header b2), loaded to C520 by 00:1BB9


def tile_attributes(rom: bytes, tileset: int) -> list[dict]:
    """Per-metatile attributes (index = metatile & 0x1F). Movement test 00:2739: blocked when
    attr & C434 != 0, C434 = 2 on foot (verified by RAM controlled change: 03/02 block, 01/00
    pass); bit 7 = special movement (0x80 pushed the player back; hypothesis); bit 0 = blocks
    other movement modes (hypothesis); bits 4-5 / 6 unknown (likely priority/animation)."""
    out = []
    for m in range(32):
        a = rom[TILE_ATTR + 32 * tileset + m]
        out.append({"metatile": m, "attr": a, "blocks_walking": bool(a & 2), "special": bool(a & 0x80)})
    return out


def all_headers(rom: bytes) -> list[int]:
    return sorted({dest_record(rom, i)["header"] for i in range(DEST_COUNT)})


def export(rom: bytes, layouts: dict | None = None) -> dict:
    dests = [dest_record(rom, i) for i in range(DEST_COUNT)]
    hdrs = {}
    for h in all_headers(rom):
        hd = header(rom, h)
        for t in hd["triggers"]:
            ev = t["event"]
            if "dest" in ev:
                d = dest_record(rom, ev["dest"], alt=bool(ev.get("alt"))) if ev.get("alt") else \
                    dests[ev["dest"]] if ev["dest"] < DEST_COUNT else None
                if d:
                    t["to_header"], t["to_x"], t["to_y"] = d["header"], d["x"], d["y"]
        hd.update(objects(rom, hd))
        from .. import layout as lay
        hd["layout_ops"] = lay.parse(rom, lay.stream_offset(hd["layout_ptr"]))
        if layouts and f"{h:04x}" in layouts:
            hd["layout"] = layouts[f"{h:04x}"]
        hdrs[f"{h:04x}"] = hd
    tilesets = sorted({h["b2"] for h in hdrs.values()})
    return {"destinations": dests, "headers": hdrs,
            "tile_attributes": {str(t): tile_attributes(rom, t) for t in tilesets}}


def add_commands(sub) -> None:
    import glob, json, os

    def cmd(a):
        rom = romlib.load_rom(a.rom)
        layouts = {}
        if a.captures:
            import numpy as np
            for f in sorted(glob.glob(os.path.join(a.captures, "*.npz"))):
                mp = np.load(f)["map"].reshape(64, 64)
                layouts[os.path.basename(f)[:4]] = [bytes(row).hex() for row in mp]
        data = export(rom, layouts)
        data["source_sha256"] = romlib.sha256(rom)
        data["layout_format"] = "64 rows of 64 metatile bytes (hex); 0x40+k = trigger k; bit 7 = special"
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        with open(a.out, "w") as fh:
            json.dump(data, fh, separators=(",", ":"))
        print(f"wrote {a.out}: {len(data['headers'])} headers, {len(layouts)} layouts")
        return 0
    s = sub.add_parser("maps-export", help="export warps, map headers and captured layouts")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--captures", default="build/maps", help="tools/map_capture.py output")
    s.add_argument("--out", default="data/maps/maps.json")
    s.set_defaults(fn=cmd)
