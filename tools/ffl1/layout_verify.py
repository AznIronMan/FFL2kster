"""Legend I: the Python layout decoder (ffl1kster.layout) against the ROM's own routine 00:153C run
on the SM83 oracle (ffl2kster.sm83) for every distinct layout pointer in the map table.
usage: python tools/ffl1/layout_verify.py"""
import sys
sys.path.insert(0, "src")
from ffl2kster.sm83 import CPU
from ffl1kster.layout import decode
from ffl1kster.schema import maps as MP


def oracle(rom, ptr):
    c = CPU(rom)
    c.h, c.l = ptr >> 8, ptr & 0xFF
    c.call(0x153C)
    return bytes(c.mem[0xD000:0xDF80])


if __name__ == "__main__":
    rom = open("ffl1/input/original.gb", "rb").read()
    ptrs = sorted({MP.parse_record(rom, m)["layout"] for m in range(MP.MAP_COUNT)})
    bad = [hex(p) for p in ptrs if decode(rom, p) != oracle(rom, p)]
    print(f"layouts {len(ptrs)}  equal {len(ptrs) - len(bad)}  different {bad}")
