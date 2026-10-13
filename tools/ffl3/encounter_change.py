"""Legend III: controlled changes against the random-encounter tables.

Code: a step that ends (01:4609) rolls rand (00:39D5) < CA2B (the map's rate) and sets CA2C;
00:10F5 then picks slot c of zone CA2D (03:76C2 + 7*zone, c = how many of the six thresholds at
03:76BC exceed a second roll) and 00:1126 copies formation (slot & 7F) from 0B:758B (5 bytes:
three monster ids, CC5C, CC5D) to CC59. Bit 7 of the slot takes the counts from byte 4.

The test walks in the Talon (talon.state) with CA2B = FF and CA2D = 0 poked (the rate and zone of
the current map are 0 there; maps are M5) and compares the battle's groups (CC59-CC5B, counts
CC36-CC38) with the unpatched run.
usage: python tools/ffl3/encounter_change.py [OUT.json]   (run `python -m ffl3kster make-states`)"""
import json, os, sys, tempfile
sys.path.insert(0, "src")
from ffl3kster.emu import Emulator
from ffl3kster.rom import bank_to_file

ROM = "ffl3/input/original.gb"
ST = "ffl3/build/states/talon.state"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ffl3/build/encounter_change.json"
orig = open(ROM, "rb").read()
ZONE, THR, FORM = bank_to_file(3, 0x76C2), bank_to_file(3, 0x76BC), bank_to_file(0x0B, 0x758B)
def z(i, k): return ZONE + 7 * i + k
def fm(i, k): return FORM + 5 * i + k
STEPS = ["right", "left"] * 4


def run(patches, zone=0, rate=0xFF):
    rom = bytearray(orig)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(ST)
            m = e.pb.memory
            m[0xCA2B], m[0xCA2D] = rate, zone
            step = None
            for i, b in enumerate(STEPS):
                e.press(b, hold=8, wait=12)
                if m[0xCA2C]:
                    step = i + 1
                    break
            e.pb.tick(400, False)
            return {"step": step, "formation": m[0xFFCA], "ids": list(m[0xCC59:0xCC5C]),
                    "counts": list(m[0xCC36:0xCC39]), "cc5c": m[0xCC5C], "cc5d": m[0xCC5D]}
    finally:
        os.remove(path)


CASES = [
    # label, patches, kwargs, expected subset of the result
    ("thresholds all 00 -> slot 0 (formation 02)", [(THR + k, 0) for k in range(6)], {}, {"formation": 0x02, "ids": [0x07, 0x4B, 0xFF]}),
    ("zone 0 all slots -> 05 (Turtle, Orc-Orc)", [(z(0, k), 0x05) for k in range(7)], {}, {"formation": 0x05, "ids": [0x0D, 0x41, 0xFF]}),
    ("zone 0 last byte (slot 6) -> 05 with thresholds FF", [(THR + k, 0xFF) for k in range(6)] + [(z(0, 6), 0x05)], {},
     {"formation": 0x05}),
    ("formation 00 ids -> 46 4B FF (first bytes)", [(fm(0, 0), 0x46), (fm(0, 1), 0x4B)], {}, {"ids": [0x46, 0x4B, 0xFF]}),
    ("formation 00 third id FF -> 0D", [(fm(0, 2), 0x0D)], {}, {"ids": [0x78, 0x04, 0x0D]}),
    ("formation 00 byte 3 00 -> 40", [(fm(0, 3), 0x40)], {}, {"cc5c": 0x40}),
    # fixed counts (slot bit 7): 2-bit fields of byte 4 (bits 5-4, 3-2, 1-0), +1; the battle's counts
    # (CC36..) come out doubled in these two-group formations and not in the three-group one
    ("fixed counts: slots -> 85, formation 05 byte 4 -> 00", [(z(0, k), 0x85) for k in range(7)] + [(fm(5, 4), 0x00)], {},
     {"formation": 0x85, "cc5d": 0x00, "counts": [2, 2, 0]}),
    ("fixed counts: byte 4 -> 20 (last byte)", [(z(0, k), 0x85) for k in range(7)] + [(fm(5, 4), 0x20)], {},
     {"formation": 0x85, "cc5d": 0x20, "counts": [6, 2, 0]}),
    ("fixed counts: byte 4 -> 14", [(z(0, k), 0x85) for k in range(7)] + [(fm(5, 4), 0x14)], {},
     {"formation": 0x85, "counts": [4, 4, 0]}),
    ("fixed counts: byte 4 -> 04", [(z(0, k), 0x85) for k in range(7)] + [(fm(5, 4), 0x04)], {},
     {"formation": 0x85, "counts": [2, 4, 0]}),
    ("fixed counts, three groups: formation 03 byte 4 -> 15", [(z(0, k), 0x83) for k in range(7)] + [(fm(3, 4), 0x15)], {},
     {"formation": 0x83, "ids": [0x78, 0x3C, 0x46], "counts": [2, 2, 2]}),
    ("rate 00: no encounter in 8 steps", [], {"rate": 0}, {"step": None}),
    ("zone 1 (poked) uses its own slots", [(z(1, k), 0x0B) for k in range(7)], {"zone": 1}, {"formation": 0x0B, "ids": [0xAA, 0x4C, 0xFF]}),
    ("CONTROL zone 1 and formations 01, 7E all 0x77", [(z(1, k), 0x77) for k in range(7)] +
     [(fm(i, k), 0x77) for i in (0x01, 0x7E) for k in range(5)], {}, {}),
]

base = run([])
assert base["step"] is not None and base["formation"] == 0x00 and base["ids"] == [0x78, 0x04, 0xFF], base
res, ok_all = {"baseline": base, "cases": []}, True
for label, patches, kw, want in CASES:
    r = run(patches, **kw)
    ok = r == base if not want else all(r[k] == v for k, v in want.items())
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "result": r})
    print(f"{'PASS' if ok else 'FAIL'} {label}: {r}")
res["all_ok"] = ok_all
open(OUT, "w").write(json.dumps(res, indent=1))
print("baseline", base)
print("ALL OK" if ok_all else "SOME FAILED")
