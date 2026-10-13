"""Legend III: controlled changes against the map records (06:6C58), doors (06:6BA4).

From field.state (map 0B, the hangar) the party walks down: the first step goes through door 12
into the Talon (map 10, record 06:6EDA), the fifth leaves through door 2D back to map 0B. Each
case patches a ROM copy and compares C6E8 per step and WRAM after three steps with the original.
usage: python tools/ffl3/map_change.py [OUT.json]   (run `python -m ffl3kster make-states`)"""
import json, os, sys, tempfile
sys.path.insert(0, "src")
from ffl3kster.emu import Emulator
from ffl3kster.rom import bank_to_file

ROM = "ffl3/input/original.gb"
ST = "ffl3/build/states/field.state"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ffl3/build/map_change.json"
orig = open(ROM, "rb").read()
MAP10 = bank_to_file(6, 0x6EDA)
def obj(k, b): return MAP10 + 6 + 6 * k + b
def door(n, b): return bank_to_file(6, 0x6BA4) + 3 * (n - 1) + b


def run(patches, steps):
    rom = bytearray(orig)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(ST)
            m = e.pb.memory
            maps = []
            for _ in range(steps):
                e.press("down", hold=8, wait=12)
                maps.append(m[0xC6E8])
            return maps, e.wram()
    finally:
        os.remove(path)


CASES = [
    # label, patches, steps, expected maps per step (None: as baseline), expected WRAM {addr: value} or None (no check)
    ("header b4 0B -> EB, b5 00 -> 05 (rate class 7, zone 5)", [(MAP10 + 4, 0xEB), (MAP10 + 5, 0x05)], 3, None,
     {0xCA2B: 9, 0xCA2D: 5}),
    ("header b2 04 -> 05", [(MAP10 + 2, 0x05)], 3, None, {0xCA1E: 5}),
    ("header b3 19 -> 1A (mode)", [(MAP10 + 3, 0x1A)], 3, None, {0xCA18: 0x1A}),
    ("object 0 script E0 -> E1", [(obj(0, 1), 0xE1)], 3, None, {0xC372: 0xE1}),
    ("object 4 y 50 -> 52 (+32 px)", [(obj(4, 3), 0x52)], 3, None, {0xC244: 0x20, 0xC2C4: 0x20, 0xC30A: 41}),
    ("door 12 map 10 -> 11 (the way in)", [(door(0x12, 0), 0x11)], 5, [0x11] * 5, None),
    ("door 2D map 0B -> 0A (the way out)", [(door(0x2D, 0), 0x0A)], 5, [0x10, 0x10, 0x10, 0x10, 0x0A], None),
    ("CONTROL doors 11, 13, 2C, 2E all 0x77; map 11 header 0x77",
     [(door(n, b), 0x77) for n in (0x11, 0x13, 0x2C, 0x2E) for b in range(3)] +
     [(bank_to_file(6, 0x6EFF) + b, 0x77) for b in range(6)], 5, None, {}),
]

b3, w3 = run([], 3)
b5, _ = run([], 5)
assert b5 == [0x10, 0x10, 0x10, 0x10, 0x0B], b5
res, ok_all = {"baseline": b5, "cases": []}, True
for label, patches, steps, want_maps, want_ram in CASES:
    maps, wram = run(patches, steps)
    base_maps = b5 if steps == 5 else b3
    probs = []
    if maps != (want_maps or base_maps):
        probs.append(f"maps {maps}")
    if want_ram is not None and steps == 3:
        diff = {0xC000 + i: wram[i] for i in range(0x2000) if wram[i] != w3[i]}
        if diff != want_ram:
            probs.append(f"wram {[(hex(a), v) for a, v in diff.items()][:8]}")
    ok = not probs
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "maps": maps, "problems": probs})
    print(f"{'PASS' if ok else 'FAIL'} {label}" + ("" if ok else f": {probs}"))
res["all_ok"] = ok_all
open(OUT, "w").write(json.dumps(res, indent=1))
print("ALL OK" if ok_all else "SOME FAILED")
