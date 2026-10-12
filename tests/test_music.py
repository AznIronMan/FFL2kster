from ffl2kster import music


def test_all_songs_parse_and_channels_agree(rom_bytes):
    """Every channel of all 19 songs decodes without invalid bytes; looping songs have equal
    channel lengths except 5, 6, 7 (channels loop independently, confirmed for 7 in PyBoy)."""
    for n in range(1, 20):
        s = music.parse_song(rom_bytes, n)
        lens = [c["length_ticks"] for c in s["channels"]]
        assert music.tempo(s)
        if n not in (1, 5, 6, 7):
            assert len(set(lens)) == 1, (n, lens)
    s = music.parse_song(rom_bytes, 2)
    assert music.tempo(s) == 120 and s["channels"][0]["length_ticks"] == 3072
    midi = music.to_midi(s)
    assert midi[:4] == b"MThd" and midi.count(b"MTrk") == 3


def test_frequency_table_is_equal_tempered(rom_bytes):
    import math
    f = [music.hz(music.freq_reg(rom_bytes, i), False) for i in range(48)]  # C2.. (65.4 Hz first)
    for a, b in zip(f, f[1:]):
        assert abs(12 * math.log2(b / a) - 1) < 0.15  # semitones (GB register rounding grows upward)
