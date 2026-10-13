"""Legend I M7: music sequences (bank 07) and their loop timing."""

import pytest

from ffl1kster import music

from .conftest import ROOT


def test_song_table_and_channels_agree(ffl1_rom):
    assert music.durations(ffl1_rom) == [0x60, 0x48, 0x30, 0x24, 0x20, 0x18, 0x12, 0x10, 0x0C, 0x09, 0x08, 0x06,
                                         0x04, 0x03, 0x02]
    first = min(p for s in range(1, music.SONG_COUNT) for p in music.song_pointers(ffl1_rom, s))
    assert first == 0x469B == 0x462F + 6 * music.SONG_COUNT
    agree = 0
    for s in range(1, music.SONG_COUNT):
        loops = {c["loop_ticks"] for c in music.song(ffl1_rom, s)["channels"] if not c["end"]}
        intros = {c["intro_ticks"] for c in music.song(ffl1_rom, s)["channels"]}
        if len(loops) <= 1 or max(loops) % min(loops) == 0:
            agree += 1
    assert agree == music.SONG_COUNT - 1   # every song's channels loop together (or in whole multiples)


@pytest.mark.emu
def test_loop_period_frame_exact():
    pytest.importorskip("pyboy")
    import sys
    sys.path.insert(0, str(ROOT / "tools/ffl1"))
    from music_timing import measure
    s, tempo, ticks, pred, periods = measure(ROOT / "ffl1/build/states/title.state", frames=4000)
    assert (s, tempo, ticks, pred) == (14, 30, 384, 768.0) and set(periods) == {768}
    s, tempo, ticks, pred, periods = measure(ROOT / "ffl1/build/states/first_town.state", frames=8000)
    assert s == 1 and set(periods) <= {2618, 2619} and len(periods) >= 2   # 2400 ticks * 60 / 55 = 2618.18


def test_export_all_reproduces_package(ffl1_rom, tmp_path):
    """`python -m ffl1kster export-all` regenerates ffl1/data byte for byte."""
    from ffl1kster.export import export_all
    export_all(ffl1_rom, tmp_path)
    golden = ROOT / "ffl1" / "data"
    a = sorted(p.relative_to(tmp_path) for p in tmp_path.rglob("*") if p.is_file())
    b = sorted(p.relative_to(golden) for p in golden.rglob("*") if p.is_file())
    assert a == b and len(a) == 248
    assert [str(p) for p in a if (tmp_path / p).read_bytes() != (golden / p).read_bytes()] == []
