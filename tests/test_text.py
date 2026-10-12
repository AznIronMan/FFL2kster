import pytest

from ffl2kster import script_text as st
from ffl2kster.build import build
from ffl2kster.project import Edit, load_project


def test_dictionary_and_known_strings(rom_bytes):
    d = st.dictionary(rom_bytes)
    assert len(d) == 80 and "".join(st.glyph(x) for x in d[0]) == "e "
    o, e, toks = st.entry(rom_bytes, "battle", 90)
    assert st.render(toks) == "\nRight on!\n⟨end⟩"
    o, e, toks = st.entry(rom_bytes, "field", 0)
    assert "Cannot enter." in st.render(toks)


def test_table_sizes(rom_bytes):
    rows = st.export(rom_bytes)
    from collections import Counter
    assert Counter(r["table"] for r in rows) == {"field": 256, "story": 192, "battle": 109, "menu": 77}


def test_semantic_round_trip_all_entries(rom_bytes):
    for name, i, o, end in st.table_entries(rom_bytes):
        toks, e = st.decode_stream(rom_bytes, o, limit=(end - o) if end else 2000, stop_at_end=end is None)
        enc = st.encode_tokens(rom_bytes, toks)
        assert len(enc) <= e - o
        t = bytearray(rom_bytes); t[o:o + len(enc)] = enc
        toks2, _ = st.decode_stream(bytes(t), o, limit=len(enc), stop_at_end=end is None)
        assert st.render(toks2) == st.render(toks)
        assert st.parse_rendered(st.render(toks)) == [x for x in toks]


def test_text_edit_build(rom_path, project_file, tmp_path):
    rep = build(rom_path, load_project(project_file), tmp_path / "t.gb",
                edits=[Edit("text", 90, "battle", "\nVictory!\n⟨end⟩")])
    changed = {c["offset"] for c in rep["changes"]} - {0x14E, 0x14F}
    assert changed and all(0x2F159 <= x < 0x2F159 + 12 for x in changed)


def test_text_edit_guards(rom_path, project_file, tmp_path):
    p = load_project(project_file)
    with pytest.raises(ValueError, match="only"):
        build(rom_path, p, tmp_path / "t.gb", edits=[Edit("text", 90, "battle", "\n" + "X" * 40 + "⟨end⟩")])
    with pytest.raises(ValueError, match="script commands"):
        build(rom_path, p, tmp_path / "t.gb", edits=[Edit("text", 1, "field", "Hi⟨end⟩")])
