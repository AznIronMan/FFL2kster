"""IPS patches (src/ffl2kster/ips.py): round trip, run splitting, the EOF-offset rule."""
import random

from ffl2kster.ips import apply_ips, make_ips


def test_round_trip_random_edits():
    rnd = random.Random(7)
    a = bytes(rnd.randrange(256) for _ in range(0x40000))
    b = bytearray(a)
    for _ in range(300):
        o = rnd.randrange(len(b) - 40)
        for k in range(rnd.randrange(1, 40)):
            b[o + k] = rnd.randrange(256)
    p = make_ips(a, bytes(b))
    assert p.startswith(b"PATCH") and p.endswith(b"EOF")
    assert apply_ips(a, p) == bytes(b)


def test_identical_is_empty_patch():
    a = bytes(1000)
    assert make_ips(a, a) == b"PATCHEOF"


def test_long_run_split_and_rle():
    a = bytes(0x30000)
    b = bytes([1]) * 0x20000 + bytes(0x10000)
    assert apply_ips(a, make_ips(a, b)) == b
    rle = b"PATCH" + (16).to_bytes(3, "big") + b"\0\0" + (5).to_bytes(2, "big") + b"\x07" + b"EOF"
    assert apply_ips(bytes(32), rle)[16:21] == b"\x07" * 5


def test_offset_that_reads_as_eof():
    a = bytes(0x454F50)
    b = bytearray(a)
    b[0x454F46] = 9
    p = make_ips(a, bytes(b))
    assert apply_ips(a, p) == bytes(b)
