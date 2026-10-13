"""Legend III: battle EXP against the monster class record (0B:470D + 4*id, byte 1).

Each case patches a ROM copy, plays a battle with A (wait 30) and reads "N EXP". Two battles:
the prologue (pre_battle.state: Diviner 0x46 x2, Sprite 0x4B x2) and a random battle forced in
the Talon (talon.state, CA2B = FF and CA2D = 0 poked: Hooligan 0x78 x1, F-Drake 0x04 x2).
The rule tested: EXP = floor(sum of byte 1 over the enemies / 4).
usage: python tools/ffl3/exp_change.py [OUT.json]   (run `python -m ffl3kster make-states`)"""
import json, os, re, sys, tempfile
sys.path.insert(0, "src")
from ffl3kster.emu import Emulator
from ffl3kster.rom import bank_to_file

ROM = "ffl3/input/original.gb"
ST = "ffl3/build/states/pre_battle.state"
OUT = sys.argv[1] if len(sys.argv) > 1 else "ffl3/build/exp_change.json"
orig = open(ROM, "rb").read()
CLS, REC = bank_to_file(0x0B, 0x470D), bank_to_file(0x0B, 0x4A19)
def c(i, b): return CLS + 4 * i + b
def r(i, b): return REC + 12 * i + b
DIV, SPR = 0x46, 0x4B
CASES = [
    # label, patches, expected EXP (prologue: Diviner 15 x2, Sprite 14 x2)
    ("baseline (15, 14)", [], (2 * 15 + 2 * 14) // 4),
    ("Diviner c1 0F->30", [(c(DIV, 1), 0x30)], (2 * 0x30 + 2 * 14) // 4),
    ("Sprite c1 0E->30", [(c(SPR, 1), 0x30)], (2 * 15 + 2 * 0x30) // 4),
    ("Diviner c1 0F->05", [(c(DIV, 1), 0x05)], (2 * 5 + 2 * 14) // 4),
    ("Sprite c1 0E->05", [(c(SPR, 1), 0x05)], (2 * 15 + 2 * 5) // 4),
    ("both c1 -> 30", [(c(DIV, 1), 0x30), (c(SPR, 1), 0x30)], 0x30),
    # falsified first: "EXP follows the level"
    ("both levels 1 -> 9 (no effect)", [(c(SPR, 0), 0xC9), (c(DIV, 0), 0x89)], 14),
    ("both c2, c3 -> 30 (no effect)", [(c(i, b), 0x30) for i in (DIV, SPR) for b in (2, 3)], 14),
    ("CONTROL class records 45 47 4A 4C all 0x77", [(c(i, b), 0x77) for i in (0x45, 0x47, 0x4A, 0x4C) for b in range(4)], 14),
]


HOOL, DRAKE = 0x78, 0x04
TALON = [   # random battle, 1 Hooligan (c1 15) and 2 F-Drakes (c1 15): unequal counts separate sum from mean
    ("talon baseline (15 x1, 15 x2)", [], 3 * 15 // 4),
    ("talon Hooligan c1 -> 30", [(c(HOOL, 1), 0x30)], (0x30 + 2 * 15) // 4),
    ("talon F-Drake c1 -> 30", [(c(DRAKE, 1), 0x30)], (15 + 2 * 0x30) // 4),
    ("talon both c1 -> 30", [(c(HOOL, 1), 0x30), (c(DRAKE, 1), 0x30)], 3 * 0x30 // 4),
    ("talon Hooligan c2 -> 30 (no effect)", [(c(HOOL, 2), 0x30)], 3 * 15 // 4),
]


def play_talon(patches):
    rom = bytearray(orig)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state("ffl3/build/states/talon.state")
            m = e.pb.memory
            m[0xCA2B], m[0xCA2D] = 0xFF, 0
            for b in ["right", "left"] * 2:
                e.press(b, hold=8, wait=12)
                if m[0xCA2C]:
                    break
            for i in range(400):
                e.press("a", wait=30)
                g = re.search(r"(\d+) EXP", " ".join(e.screen_text()))
                if g:
                    return int(g.group(1)), i
            return None, None
    finally:
        os.remove(path)


def play(patches):
    rom = bytearray(orig)
    for o, v in patches:
        rom[o] = v
    fd, path = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(rom)); os.close(fd)
    try:
        with Emulator(path) as e:
            e.load_state(ST)
            e.wait_for_text("Fight", 900, 5)
            for i in range(400):
                e.press("a", wait=30)
                g = re.search(r"(\d+) EXP", " ".join(e.screen_text()))
                if g:
                    return int(g.group(1)), i
            return None, None
    finally:
        os.remove(path)


res, ok_all = {"cases": []}, True
for label, patches, want in CASES:
    got, at = play(patches)
    ok = got == want
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "exp": got, "want": want, "press": at})
    print(f"{'PASS' if ok else 'FAIL'} {label}: {got} EXP (want {want}, press {at})")
for label, patches, want in TALON:
    got, at = play_talon(patches)
    ok = got == want
    ok_all &= ok
    res["cases"].append({"label": label, "ok": ok, "exp": got, "want": want, "press": at})
    print(f"{'PASS' if ok else 'FAIL'} {label}: {got} EXP (want {want}, press {at})")
res["all_ok"] = ok_all
open(OUT, "w").write(json.dumps(res, indent=1))
print("ALL OK" if ok_all else "SOME FAILED")
