from ffl2kster import events
from ffl2kster.schema import maps as M


def test_event_kinds_on_first_town(rom_bytes):
    h = M.header(rom_bytes, 0x4833)
    objs = M.objects(rom_bytes, h)["npcs"]
    # NPC messages 8-11 were verified as field texts by controlled change (kind 1 = field)
    assert [(n["event"]["table"], n["event"]["index"]) for n in objs[:4]] == [("field", i) for i in (8, 9, 10, 11)]
    assert objs[4]["event"] == {"kind": "script", "code": 0, "arg": 0, "table": "story", "index": 0}
    kinds = [t["event"]["kind"] for t in h["triggers"]]
    assert kinds.count("warp") == 5 and kinds.count("script") == 2


def test_script_decoding(rom_bytes):
    txt = events.render_script(events.decode_script(rom_bytes, "story", 16))
    assert txt.splitlines()[:3] == ["if_var_in(0, 1)", "    event message(table=field, index=16)", "    end"]
    assert "event warp(dest=51)" in txt and "event sound(song=11)" in txt
    assert events.event(4, 0xFF)["inn"] and events.event(6, 3)["dest"] == 259
    assert events.event(7, 0x8A) == {"kind": "sound", "code": 7, "arg": 0x8A, "sfx": 10}


def test_shops_and_chests(rom_bytes):
    s = events.shops(rom_bytes)
    assert len(s) == 24 and [i["name"] for i in s[0]["items"]][:5] == ["Hammer", "Bow", "Punch", "Rapier", "Long"]
    pl = events.placements(rom_bytes)
    assert len(pl["chests"]) == 230
    assert {c["shop"] for c in pl["shops"] if not c["inn"]} >= set(range(24))
