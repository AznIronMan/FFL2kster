"""Legend III text: the script interpreter's encoding, all text spans, round trips."""

import re

from ffl3kster import script_text as T


def test_dictionary(ffl3_rom):
    d = T.dictionary(ffl3_rom)
    end = T.DICT + sum(1 + len(e) for e in d)
    assert len(d) == 80 and end == T.DICT + 0x731C - 0x71C5           # 03:71C5-731B
    assert ffl3_rom[end:end + 4] == bytes([0x9C, 0x73, 0xA2, 0x73])   # a word table follows
    r = lambda i: T.render(T.tokens(d[i] + b"\0", 0)[0], d)
    assert (r(0x1A), r(0x1B), r(0x1F), r(0x2C), r(0x33)) == ("the ", "you", "Elder", "Talon", "Sacred Sword")
    assert r(3) == "{1C}{1F 00}"                    # an entry may hold control codes
    assert T.dict_index(0x4E) == 0 and T.dict_index(0x87) == 57 and T.dict_index(0x01) == 58 and T.dict_index(0x0F) == 79


def test_spans_parse_exactly(ffl3_rom):
    rows = T.scripts(ffl3_rom)                       # raises if a span does not end exactly
    assert len(rows) == 1639
    assert {b: sum(r["bank"] == b for r in rows) for b in (3, 9, 10)} == {3: 30, 9: 588, 10: 1021}


def test_every_reference_lands_on_a_script(ffl3_rom):
    rows = T.scripts(ffl3_rom)
    starts = {(r["bank"], r["address"]) for r in rows}
    refs = [x for r in rows for x in r["refs"] if x[0] != "scene"]
    assert len(refs) == 243 and all(x in starts for x in refs)
    for name, (bank, _, n) in T.POINTER_TABLES.items():
        ptrs = T.pointer_table(ffl3_rom, name)
        assert len(ptrs) == n and all((bank, p) in starts for p in ptrs)
    assert (9, 0x6015) in starts                     # the prologue, called from 00:0250


def test_round_trips(ffl3_rom):
    rows, d = T.scripts(ffl3_rom), T.dictionary(ffl3_rom)
    same = 0
    for r in rows:
        raw = ffl3_rom[r["offset"]:r["offset"] + r["length"]]
        assert T.serialize(T.tokens(ffl3_rom, r["offset"])[0]) == raw          # byte level
        enc = T.encode(r["text"], d)
        assert T.render(T.tokens(enc, 0)[0], d) == r["text"]                  # semantic
        same += enc == raw
    assert same == 1308                              # the rest compress differently (greedy)


def test_known_texts(ffl3_rom):
    by = {r["id"]: r["text"] for r in T.scripts(ffl3_rom)}
    assert by["09:7CB2"] == "\nWon!\n{10}"
    assert by["09:7A35"] == "Received {30 00}GP.\n"
    assert by["09:7215"].startswith("New Game\nContinue")
    assert "Simulator. I'll" in by["09:6015"] and by["09:6015"].startswith("{3F 01}{3E 00 22}")
    assert "{$" not in "".join(t for t in by.values() if not re.search(r"\{\$(8[89A-F]|9[0-9A-F]|A[0-9AB])\}", t))


def test_patch_in_place(ffl3_rom):
    off, data = T.patch_in_place(ffl3_rom, "09:7BFC", "{1C}{1F FF} swung\n{1C}{1E 80} at\n")
    assert len(data) == 18 and data.endswith(b"\xff\x06\x00")
    rom = bytearray(ffl3_rom)
    rom[off:off + len(data)] = data
    assert T.render(T.tokens(bytes(rom), off)[0], T.dictionary(ffl3_rom)) == "{1C}{1F FF} swung\n{1C}{1E 80} at \n"
