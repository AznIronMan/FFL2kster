"""Event system: script ops (text control codes), event kinds (C442/C443), shops, chests.

The field/story "text" tables are the event scripts: control codes are the script ops
(dispatch 00:13BE). Map triggers, NPC objects and script op 0x19 all raise an *event*
(kind, arg) handled by the field loop at 00:3924 (kind = C443, arg = C442).
Evidence and status: docs/EVENTS.md.
"""
from __future__ import annotations

from . import script_text as st

# Script ops: (name, status). Arg counts come from script_text.ARGS.
OPS = {
    0x00: ("end", "verified"), 0x0E: ("end", "verified: same handler as 0x00 (00:0B0F)"),
    0x01: ("cursor_right", "probable"), 0x02: ("cursor_left", "probable"),
    0x03: ("cursor_up", "probable"), 0x04: ("cursor_down", "probable"),
    0x05: ("line", "probable"), 0x06: ("newline", "verified"),
    0x0B: ("wait_button", "probable"), 0x0C: ("open_window", "probable"),
    0x0D: ("close_window", "probable"), 0x11: ("delay", "probable: n x 2 frame waits (00:0CC0)"),
    0x12: ("var_inc", "probable: progress var n += 1, max 15 (00:0B32)"),
    0x13: ("var_dec", "probable: progress var n -= 1, min 0 (00:0B3C)"),
    0x14: ("var_set", "probable: progress var a = b (00:0B4B)"),
    0x15: ("if_var_in", "probable: continue if var a in [b>>4, b&15], else skip next op (00:0BB6)"),
    0x16: ("if_yes", "probable: yes/no prompt, skip next op on No (00:0C00)"),
    0x17: ("if_has_item", "probable: party carries item n, else skip next (00:0B72)"),
    0x18: ("memo_set", "verified: set memo bit n (00:0B50)"),
    0x19: ("event", "verified: raise event (kind, arg) (00:1490)"),
    0x1A: ("if_magi_total_lt", "hypothesis: compares MAGI total C2D9 with n+1 (00:0BCE)"),
    0x1B: ("if_magi_have", "probable: MAGI n count C2DA+2n nonzero (00:0BD8)"),
    0x20: ("print_sub", "verified: re-dispatch sub-code (00:0FCC)"),
    0x2E: ("menu_item", "probable"), 0x31: ("nop", "verified: handler is ret"),
    0x32: ("menu", "probable: show menu n and wait for choice (00:0F9D)"),
    0x33: ("pay_gp", "probable: compare/subtract GP C2A2 (00:0F6A)"),
    0x36: ("cursor_x_add", "probable"),
    0x39: ("battle", "probable: fixed battle n (00:0CD0)"),
    0x40: ("memo_clear", "verified: clear memo bit n (00:0B5B)"),
    0x41: ("memo_list", "probable"), 0x44: ("if_song", "probable: continue if FFB0 == n (00:0BEF)"),
    0x45: ("if_c2a1_ge", "hypothesis: continue if C2A1 >= n (00:0BF7)"),
    0x47: ("sound_test", "probable: menu 0x45 + song list 0F:7AEE"),
    0x4A: ("game_end", "hypothesis: C765 = 3, C31B = 4"),
    0x4B: ("phrase", "verified: print phrase n + memo bit n (00:0C21)"),
}

EVENT_KINDS = {
    0: "script", 1: "message", 2: "message", 3: "message", 4: "shop", 5: "warp", 6: "warp",
    7: "sound", 8: "none", 9: "chest_item", 0x0A: "chest_magi", 0x0B: "chest_item_prompt",
    0x0C: "warp_save_return", 0x0D: "warp_save_return", 0x0E: "warp_alt",
}

SHOP_TABLE = 0x3F9E0   # 0F:79E0, 8 item ids per shop (01:6480), 0xFF = empty slot
SHOP_COUNT = 24        # ids used by map objects of kind 4 (0-23); 0xFF = inn (01:628A)


def event(kind: int, arg: int) -> dict:
    """Decode an event (C443 kind, C442 arg) per the dispatcher 00:3924 / 00:3A60."""
    if kind >= 0xF0:
        return {"kind": "special", "code": kind, "arg": arg, "status": "hypothesis"}
    name = EVENT_KINDS.get(kind, f"kind_{kind:02X}")
    d = {"kind": name, "code": kind, "arg": arg}
    if kind == 0:
        d.update(table="story", index=arg)
    elif kind in (1, 2, 3):
        d.update(table="field", index=(kind - 1) * 256 + arg)
    elif kind == 4:
        d.update(shop=None if arg == 0xFF else arg, inn=arg == 0xFF)
    elif kind in (5, 6, 0x0C, 0x0D):
        d.update(dest=arg + 256 * ((kind & 1) ^ 1))
    elif kind == 0x0E:
        d.update(dest=arg, alt=True)
    elif kind == 7:
        d.update(song=arg) if arg < 0x40 else d.update(ffb1=arg - 0x40) if arg < 0x80 else d.update(sfx=arg - 0x80)
    elif kind in (9, 0x0B):
        d.update(item=None if arg == 0xFF else arg)
    elif kind == 0x0A:
        d.update(magi=arg)
    return d


def shops(rom: bytes) -> list[dict]:
    from .schema import items
    out = []
    for s in range(SHOP_COUNT):
        ids = [i for i in rom[SHOP_TABLE + 8 * s:SHOP_TABLE + 8 * s + 8] if i != 0xFF]
        out.append({"shop": s, "items": [{"id": i, "name": items.name(rom, i)} for i in ids]})
    return out


def decode_script(rom: bytes, table: str, index: int) -> list[dict]:
    o, e, toks = st.entry(rom, table, index)
    ops = []
    for t in toks:
        if isinstance(t, str):
            ops.append({"op": "text", "text": t, "raw": st.encode_text(rom, t)})
            continue
        c, a = t
        name = OPS.get(c, (f"op_{c:02X}", "unknown"))[0]
        d = {"op": name, "code": c, "args": list(a)}
        if c == 0x19:
            d["event"] = event(a[0], a[1])
        ops.append(d)
    return ops


def _size(op: dict) -> int:
    return len(op.get("raw", b"")) if op["op"] == "text" else 1 + len(op["args"])


def render_script(ops: list[dict]) -> str:
    """Pseudo-code. A failed if_* skips exactly the next 4 bytes (00:0C05), which in practice
    is `event k a` + `end`; those bytes are shown indented under the condition."""
    lines, skip = [], 0
    for op in ops:
        ind = "    " if skip > 0 else ""
        skip -= _size(op) if skip > 0 else 0
        if op["op"].startswith("if_"):
            skip = 4
        if op["op"] == "text":
            lines.append(ind + repr(op["text"]))
        elif op["op"] == "newline":
            continue
        elif op["op"] == "event":
            ev = op["event"]
            if ev["kind"] == "special":
                lines.append(ind + f"event special(0x{ev['code']:02X}, 0x{ev['arg']:02X})")
            else:
                extra = ", ".join(f"{k}={v}" for k, v in ev.items() if k not in ("kind", "code", "arg"))
                lines.append(ind + f"event {ev['kind']}({extra or op['args'][1]})")
        else:
            lines.append(ind + op["op"] + ("(" + ", ".join(str(x) for x in op["args"]) + ")" if op["args"] else ""))
    return "\n".join(lines)


def export(rom: bytes) -> str:
    out = ["# FFL2 event scripts (field + story tables) decoded by ffl2kster.events; see docs/EVENTS.md"]
    for name in ("story", "field"):
        n = {"story": 192, "field": 256}[name]
        for i in range(n):
            out.append(f"\n## {name}[{i}]")
            out.append(render_script(decode_script(rom, name, i)))
    return "\n".join(out) + "\n"


def placements(rom: bytes) -> dict:
    """Chests, shops and sound events placed on maps (objects and trigger tiles)."""
    from .schema import items, maps
    out = {"chests": [], "shops": [], "sound": [], "scripts": []}
    for h in maps.all_headers(rom):
        hd = maps.header(rom, h)
        objs = maps.objects(rom, hd)["npcs"]
        srcs = [("object", n, n["event"], {"x": n["x"], "y": n["y"], "condition": n["condition"]}) for n in objs]
        srcs += [("trigger", t, t["event"], {"tile": t["tile"]}) for t in hd["triggers"]]
        for src, rec, ev, where in srcs:
            base = {"map": f"{h:04x}", "source": src, **where}
            if ev["kind"].startswith("chest"):
                it = ev.get("item")
                out["chests"].append({**base, "kind": ev["kind"], "item": it, "magi": ev.get("magi"),
                                      "name": items.name(rom, it) if it is not None else None})
            elif ev["kind"] == "shop":
                out["shops"].append({**base, "shop": ev["shop"], "inn": ev["inn"]})
            elif ev["kind"] == "sound":
                out["sound"].append({**base, **{k: v for k, v in ev.items() if k in ("song", "sfx", "ffb1")}})
            elif ev["kind"] == "script":
                out["scripts"].append({**base, "story": ev["index"]})
    return out


def add_commands(sub) -> None:
    import json
    import os
    from . import rom as romlib

    def cmd(a):
        rom = romlib.load_rom(a.rom)
        os.makedirs(a.out, exist_ok=True)
        with open(os.path.join(a.out, "scripts.txt"), "w", encoding="utf-8") as fh:
            fh.write(export(rom))
        pl = placements(rom)
        pl["shop_inventories"] = shops(rom)
        pl["ops"] = {f"{c:02X}": {"name": n, "status": s, "args": st.ARGS.get(c, 0)} for c, (n, s) in OPS.items()}
        pl["event_kinds"] = {f"{k:02X}": v for k, v in EVENT_KINDS.items()}
        pl["source_sha256"] = romlib.sha256(rom)
        with open(os.path.join(a.out, "events.json"), "w", encoding="utf-8") as fh:
            json.dump(pl, fh, ensure_ascii=False, indent=1)
        print(f"wrote {a.out}: {len(pl['chests'])} chests, {len(pl['shops'])} shop placements, "
              f"{len(pl['sound'])} sound events, {len(pl['scripts'])} script placements")
        return 0

    s = sub.add_parser("events-export", help="decode event scripts, shops, chests, sound events")
    s.add_argument("--rom", default="input/original.gb")
    s.add_argument("--out", default="data/events")
    s.set_defaults(fn=cmd)
