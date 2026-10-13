"""Legend I encounters: controlled changes against the zone table (06:6400, 8-byte records:
rate + 7 weighted area ids, bit 7 = alternate formation), the area table (06:6868, 5 bytes) and
the formation table (06:72C4, 3 bytes). From the world state, walk the make-states route until the
enemy loader runs; report the step count and the monsters loaded.
usage: python tools/ffl1/encounter_change.py"""
import os, sys, tempfile
sys.path.insert(0, "src")
from ffl1kster.emu import Emulator
from ffl1kster.rom import bank_to_file
from ffl1kster.schema import monsters as M

ROM = "ffl1/input/original.gb"
orig = open(ROM, "rb").read()
ZONES, AREAS, FORMS = bank_to_file(6, 0x6400), bank_to_file(6, 0x6868), bank_to_file(6, 0x72C4)


def walk(patches, max_steps=200):
    r = bytearray(orig)
    for o, v in patches:
        r[o] = v
    fd, p = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(r)); os.close(fd)
    try:
        with Emulator(p) as e:
            m = e.pb.memory
            e.load_state("ffl1/build/states/world.state")
            seq = ["right", "right", "right", "left", "left", "left"]
            for i in range(max_steps):
                e.loader_hits.clear(); e.press(seq[i % 6])
                if e.loader_hits:
                    e.pb.tick(20, False)
                    ids = [m[0xD000 + 32 * k + 0x1F] for k in range(4, 31)]
                    return i + 1, m[0xFFBD], [x for x in ids if x != 0xFF]
            return None, None, []
    finally:
        os.remove(p)


CASES = [
    ("baseline", []),
    ("zone 0 slot 4 area 0x13->0x12", [(ZONES + 5, 0x12)]),
    ("zone 0 slot 4 area 0x13->0x93 (alternate formation)", [(ZONES + 5, 0x93)]),
    ("CONTROL zone 1 slot 4 -> 0x12", [(ZONES + 8 + 5, 0x12)]),
    ("zone 0 rate 0x18->0x02", [(ZONES, 0x02)]),
    ("area 19 formation byte 2->3 (one of each group)", [(AREAS + 5 * 19 + 3, 3)]),
    ("formation 2 '00 00 11'->'00 00 33' (three of group 3)", [(FORMS + 3 * 2 + 2, 0x33)]),
    ("CONTROL formation 1 -> '33 33 33'", [(FORMS + 3, 0x33), (FORMS + 4, 0x33), (FORMS + 5, 0x33)]),
]
if __name__ == "__main__":
    for label, pt in CASES:
        steps, area, ids = walk(pt)
        print(f"{label:54s} steps {steps}  FFBD {area if area is None else hex(area)}  monsters {[M.name(orig, i) for i in ids]}")
