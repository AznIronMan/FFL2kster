"""Legend III music (bank 0F): song table, channel streams, loops."""

from ffl3kster import music as M


def test_songs_parse_and_loop(ffl3_rom):
    for n in range(1, M.SONG_COUNT + 1):
        ev = M.events(ffl3_rom, n)
        assert len(ev) == 4 and all(ev)
        loops = [M.channel_loop(ffl3_rom, n, c) for c in range(4)]
        periods = {p for s, p in loops if s >= 0}
        assert all(max(periods) % p == 0 for p in periods) if periods else n == 7   # channels loop together
    assert [M.channel_loop(ffl3_rom, 7, c) for c in range(4)] == [(-1, 0)] * 4    # song 7 ends (a jingle)
    assert M.loop(ffl3_rom, 3) == (0, 1392)


def test_tables(ffl3_rom):
    from ffl3kster import rom as romlib
    d = romlib.bank_to_file(0x0F, M.DURATIONS)
    assert ffl3_rom[d:d + 16] == bytes([0x90, 0x60, 0x48, 0x30, 0x24, 0x20, 0x18, 0x12, 0x10, 0x0C, 0x09, 0x08,
                                        0x06, 0x04, 0x03, 0x02])
    assert M.song_pointers(ffl3_rom, 1) == [0x5D66, 0x5DE5, 0x5E81, 0x5EFB]
    hangs = [(ch, c) for ch in range(4) for c in range(0xF0, 0xFF) if M.handler(ffl3_rom, ch, c) == 0x4616]
    assert all(M.handler(ffl3_rom, ch, c) in M.HANDLER_OPS for ch in range(4) for c in range(0xF0, 0xFF)
               if (ch, c) not in hangs)
