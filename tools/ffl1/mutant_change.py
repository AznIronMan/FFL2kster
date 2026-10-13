"""Legend I mutant growth (06:539E): controlled changes against its tables in bank 06.
A MUTANT M hero walks the world-map route of make-states with HP topped up (RAM, exploration
convenience) and fights; after each battle the party record (CC00, 31 bytes) is compared. The
first change other than HP and weapon uses is reported.
Tables: 06:7F00 cumulative category thresholds (8, compared with rand(0..255)); 06:53DE handler
pointers; 06:7F0F 32 (ability, uses) pairs for the 'new ability' category.
usage: python tools/ffl1/mutant_change.py"""
import os, sys, tempfile
sys.path.insert(0, "src")
from ffl1kster.emu import Emulator
from ffl1kster.rom import bank_to_file

ROM = "ffl1/input/original.gb"
orig = open(ROM, "rb").read()
THRESH = bank_to_file(6, 0x7F00)
ABIL = bank_to_file(6, 0x7F0F)


def run(patches, battles_max=8):
    r = bytearray(orig)
    for o, v in patches:
        r[o] = v
    fd, p = tempfile.mkstemp(suffix=".gb")
    os.write(fd, bytes(r)); os.close(fd)
    try:
        with Emulator(p) as e:
            m = e.pb.memory
            e.load_state("ffl1/build/states/party_creation.state")
            for _ in range(2):
                e.press("down", wait=20)
            for k, w in (("a", 120), ("a", 60), ("start", 120)):
                e.press(k, wait=w)
            for _ in range(3):
                e.press("down", wait=56)
            seq = ["right", "right", "right", "left", "left", "left"]
            battles = 0
            for i in range(3000):
                m[0xCC06], m[0xCC07], m[0xCC08], m[0xCC09] = 0xE7, 3, 0xE7, 3
                prev = bytes(m[0xCC00:0xCC1F])
                e.loader_hits.clear()
                e.press(seq[(i + battles) % 6], wait=36 + (i % 7))
                if not e.loader_hits:
                    continue
                battles += 1
                for j in range(300):
                    e.press("a", wait=40)
                    if m[0xFF4A] == 144 and j > 10:
                        break
                cur = bytes(m[0xCC00:0xCC1F])
                ch = [(k, prev[k], cur[k]) for k in range(31) if prev[k] != cur[k] and k not in (6, 7, 8, 9, 24)]
                if ch or battles >= battles_max:
                    return battles, ch
    finally:
        os.remove(p)


CASES = [
    ("baseline", []),
    ("ability list entry 1 F2->86 (TELEPOR)", [(ABIL + 2, 0x86)]),
    ("CONTROL ability list entry 5 B9->86", [(ABIL + 10, 0x86)]),
    ("threshold[0] 0x23->0x00 (no 'new ability')", [(THRESH, 0x00)]),
]
if __name__ == "__main__":
    for label, pt in CASES:
        b, ch = run(pt)
        print(f"{label:46s} battle {b}: {ch}")
