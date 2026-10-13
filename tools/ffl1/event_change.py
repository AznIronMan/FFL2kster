"""Legend I event objects: controlled change of an object's command/parameter in the first town's
event list (02:62F0). The town is loaded fresh (party_creation state -> name the hero), then the
NPC east of the start is addressed from (20,34) facing up; the last text shown is reported.
usage: python tools/ffl1/event_change.py"""
import os, sys, tempfile
sys.path.insert(0, "src")
from ffl1kster.emu import Emulator
from ffl1kster.rom import bank_to_file

ROM = "ffl1/input/original.gb"
orig = open(ROM, "rb").read()
NPC = orig.find(bytes.fromhex("00021521010902"), bank_to_file(2, 0x62F0))   # x 0x15, y 0x21, cmd 1, param 9
STEPS = [("a", 4, 120), ("a", 4, 60), ("start", 4, 120), ("right", 4, 40), ("right", 4, 40), ("up", 4, 40),
         ("up", 4, 40), ("up", 2, 10), ("a", 4, 60)] + [("wait", 0, 60)] * 8


def talk(patches):
    r = bytearray(orig)
    for o, v in patches:
        r[o] = v
    fd, p = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(r)); os.close(fd)
    seen = []
    try:
        with Emulator(p) as e:
            e.load_state("ffl1/build/states/party_creation.state")
            for k, h, w in STEPS:
                if k == "wait":
                    e.pb.tick(w, False)
                else:
                    e.press(k, hold=h, wait=w)
                t = " ".join(x.strip(" ·") for x in e.screen_text()[:8]
                             if x.strip(" ·") and "ijij" not in x and "klkl" not in x)
                if t and (not seen or seen[-1] != t):
                    seen.append(t)
        return seen[-1] if seen else ""
    finally:
        os.remove(p)


if __name__ == "__main__":
    for label, pt in [("baseline (cmd 1, param 9 = dialogue 249)", []),
                      ("param 9 -> 8 (dialogue 248)", [(NPC + 5, 0x08)]),
                      ("param 9 -> 0 (dialogue 240)", [(NPC + 5, 0x00)])]:
        print(f"{label:42s} {talk(pt)}")
