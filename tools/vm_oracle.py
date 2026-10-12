"""Calc-VM oracle: run the ROM's own interpreter (0C:4000) in ffl2kster.sm83 from every snapshot
in build/vm_snapshots, stubbing the presentation natives rst $20 (message) and 01E0 (animation),
and write build/golden/vm/<n>.json = {script, events, changes: [[addr, before, after], ...]}."""
import json, os, sys
sys.path.insert(0, "src")
from ffl2kster.sm83 import CPU

rom = open("input/original.gb", "rb").read()
SNAP = "build/vm_snapshots"
OUT = "build/golden/vm"


def run(mem: bytes, script: int):
    cpu = CPU(rom)
    cpu.mem[0xC000:0x10000] = mem
    cpu.sp = 0xDFF0 if False else cpu.sp
    events = []

    def msg(c):
        events.append({"type": "message", "id": c.mem[0xD90C], "args": list(c.mem[0xD900:0xD90C])})

    def anim(c):
        events.append({"type": "anim", "id": c.mem[0xD910], "sfx": c.mem[0xFFB2]})

    ptr_off = 0x30000 + 0x4680 - 0x4000 + 2 * script
    de = rom[ptr_off] | rom[ptr_off + 1] << 8
    cpu.d, cpu.e = de >> 8, de & 0xFF
    cpu.bank = 0x0C
    cpu.mem[0xFF88] = 0x0C
    sp0 = 0xFFFE
    before = bytes(cpu.mem[0xC000:0x10000])
    cpu.call(0x4000, traps={0x0020: msg, 0x01E0: anim})
    after = bytes(cpu.mem[0xC000:0x10000])
    # ignore the oracle CPU stack (top of HRAM, >= FFC0)
    changes = [[0xC000 + i, a, b] for i, (a, b) in enumerate(zip(before, after)) if a != b and 0xC000 + i < 0xFFC0]
    return events, changes


def main():
    os.makedirs(OUT, exist_ok=True)
    idx = json.load(open(f"{SNAP}/index.json"))
    for e in idx:
        mem = open(f"{SNAP}/{e['snap']:04d}.bin", "rb").read()
        ev, ch = run(mem, e["script"])
        json.dump({"script": e["script"], "battle": e["battle"], "events": ev, "changes": ch},
                  open(f"{OUT}/{e['snap']:04d}.json", "w"))
    print("oracle results", len(idx))


if __name__ == "__main__":
    main()
