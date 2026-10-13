"""Legend I map records (02:58D0, 200 pointers): controlled changes.
From first_town.state the hero leaves the town (down x3), which loads the world map (map 88)
from its record; then the make-states route is walked until the enemy loader runs.
Record 88 = fa 00 01 01 | 00 40 | 83 01 | 00 01 04: byte 6 = flags (bit 7: no event list,
bits 6-4: zone slot absent), byte 7 = FFE0, then zone slots C5C3..C5C5.
usage: python tools/ffl1/map_change.py"""
import os, sys, tempfile
sys.path.insert(0, "src")
from ffl1kster.emu import Emulator
from ffl1kster.rom import bank_to_file
from ffl1kster.schema import monsters as M

ROM = "ffl1/input/original.gb"
orig = open(ROM, "rb").read()
TABLE = bank_to_file(2, 0x58D0)


def record(mid):
    return bank_to_file(2, orig[TABLE + 2 * mid] | orig[TABLE + 2 * mid + 1] << 8)


def run(patches):
    r = bytearray(orig)
    for o, v in patches:
        r[o] = v
    fd, p = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(r)); os.close(fd)
    try:
        with Emulator(p) as e:
            m = e.pb.memory
            e.load_state("ffl1/build/states/first_town.state")
            for _ in range(3):
                e.press("down", wait=56)
            zones = bytes(m[0xC5C2:0xC5C6]).hex(" ")
            seq = ["right", "right", "right", "left", "left", "left"]
            for i in range(200):
                e.loader_hits.clear(); e.press(seq[i % 6])
                if e.loader_hits:
                    e.pb.tick(20, False)
                    ids = [m[0xD000 + 32 * k + 0x1F] for k in range(4, 31)]
                    return m[0xCCC7], zones, i + 1, m[0xFFBD], [M.name(orig, x) for x in ids if x != 0xFF]
            return m[0xCCC7], zones, None, None, []
    finally:
        os.remove(p)


if __name__ == "__main__":
    W = record(88)
    for label, pt in [("baseline", []),
                      ("map 88 zone slot 1 (record byte 8) 00 -> 08", [(W + 8, 0x08)]),
                      ("CONTROL map 87 record byte 8 -> 08", [(record(87) + 8, 0x08)])]:
        mid, zones, steps, area, mons = run(pt)
        print(f"{label:46s} map {mid} zones {zones} step {steps} FFBD {area if area is None else hex(area)} {mons}")
