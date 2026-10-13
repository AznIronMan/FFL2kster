"""Legend III: controlled byte changes against the armor table (09:5BFC, 5 bytes, ids 78-BF),
read through the Equip menu.

menu.state is the field menu after the intro. The test puts one Bronze body armor (id 91) into
the inventory (RAM poke: C705 = 91, C706 = 1, the slot after the Radar at C703), opens Equip →
Arthur → armor slot, and picks Bronze (three rows down: the list keeps a blank row between items),
which swaps out his Leather (90). The party record (C500, 0x60 bytes) is compared with the
unpatched run; with `status` the Status screen is read too.
usage: python tools/ffl3/equip_change.py [OUT.json]   (run `python -m ffl3kster make-states`)"""
import json, os, re, sys, tempfile
sys.path.insert(0, "src")
from ffl3kster.emu import Emulator
from ffl3kster.rom import bank_to_file

ROM = "ffl3/input/original.gb"
ST = "ffl3/build/states/menu.state"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ffl3/build/equip_change.json"
orig = open(ROM, "rb").read()
ARM = bank_to_file(9, 0x5BFC)
def a(i, b): return ARM + 5 * (i - 0x78) + b
EQUIP = ["down"] * 4 + ["a", "a", "down", "right", "a", "down", "down", "down", "a"]
STATUS = ["b", "b", "up", "a", "a"]
WORD = re.compile(r"(Attack|Defence|Agility|Magic|Hit|M\.Def\.|M\.Evade|Evade) *(\d+)")

CASES = [
    # label, patches, {party record offset: value}, {status word: value}
    ("Bronze b1 32->41 (Defence 3->4, M.Def 2->1)", [(a(0x91, 1), 0x41)],
     {0x19: 9, 0x3C: 4, 0x3E: 1}, {"Defence": 9, "M.Def.": 1}),
    ("Bronze b2 33->23 (Evade 3->2, M.Evade 3)", [(a(0x91, 2), 0x23)], {0x3D: 2}, {"Evade": 2, "M.Evade": 3}),
    ("Bronze b2 33->35 (M.Evade 3->5)", [(a(0x91, 2), 0x35)], {0x3F: 5}, {"M.Evade": 5}),
    ("Bronze b0 00->40 (first byte: element bit)", [(a(0x91, 0), 0x40)], {0x36: 0x10, 0x39: 0x10}, {}),
    ("Bronze b0 00->05 (status bit)", [(a(0x91, 0), 0x05)], {0x37: 0x08, 0x3A: 0x08}, {}),
    ("Bronze b4 03->07 (last byte)", [(a(0x91, 4), 0x07)], {0x28: 70, 0x2D: 7}, {}),
    ("Bronze b3 FF->12 (linked id: no change on equip)", [(a(0x91, 3), 0x12)], {}, {}),
    # Leather (90) leaves Arthur in the swap: its current record is subtracted, so a patched Leather
    # (never added) shifts the totals by the difference
    ("Leather b1 22->32 (removed: Defence 2 -> 3 subtracted)", [(a(0x90, 1), 0x32)], {0x19: 7, 0x3C: 2}, {"Defence": 7}),
    ("Leather b0 00->05 (first byte; bit cleared, was never set)", [(a(0x90, 0), 0x05)], {}, {}),
    ("Leather b4 01->05 (last byte: 1 -> 5 subtracted; +28 is a u16)", [(a(0x90, 4), 0x05)], {0x28: 0xF6, 0x29: 0xFF, 0x2D: 0xFF}, {}),
    ("CONTROL helm 8F and armor 92 all 0x77", [(a(i, b), 0x77) for i in (0x8F, 0x92) for b in range(5)], {}, {}),
]


def run(patches, status):
    rom = bytearray(orig)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(ST)
            m = e.pb.memory
            m[0xC705], m[0xC706] = 0x91, 1
            for b in EQUIP:
                e.press(b, wait=40)
            rec = bytes(m[0xC500:0xC560])
            words = {}
            if status:
                for b in STATUS:
                    e.press(b, wait=50)
                for r in e.screen_text():
                    for w, v in WORD.findall(r):
                        words[w] = int(v)
            return rec, words
    finally:
        os.remove(path)


base, bwords = run([], True)
assert base[0x43] == 0x91 and base[0x19] == 8 and base[0x3C:0x40] == bytes([3, 3, 2, 3]), base.hex(" ")
res = {"baseline": {"record": base.hex(" "), "status": bwords}, "cases": []}
ok_all = True
for label, patches, want, wwords in CASES:
    r, words = run(patches, bool(wwords))
    probs = [f"+{o:02X}={r[o]} want {v}" for o, v in want.items() if r[o] != v]
    probs += [f"+{i:02X} {base[i]}->{r[i]} unexpected" for i in range(0x60) if i not in want and r[i] != base[i]]
    probs += [f"{w}={words.get(w)} want {v}" for w, v in wwords.items() if words.get(w) != v]
    ok = not probs
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "problems": probs, "status": words})
    print(f"{'PASS' if ok else 'FAIL'} {label}" + ("" if ok else f": {probs}"))
res["all_ok"] = ok_all
open(OUT, "w").write(json.dumps(res, indent=1))
print("baseline status", bwords)
print("ALL OK" if ok_all else "SOME FAILED")
